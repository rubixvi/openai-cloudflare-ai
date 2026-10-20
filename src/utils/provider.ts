import { type Env, type JsonObject, type ProviderOperation } from '../types'
import { ApiError, upstreamError } from './errors'
import { streamToBuffer } from './stream'
import { isObject } from './validation'

const INFERENCE_TIMEOUT = 120_000

const BINDING_ERROR_STATUS: Record<number, number> = {
  5007: 400,
  5004: 400,
  3039: 400,
  3003: 400,
  5018: 403,
  5016: 403,
  3023: 403,
  3041: 403,
  5035: 403,
  5019: 405,
  5005: 405,
  3042: 404,
  3006: 413,
  3007: 408,
  3008: 408,
  3036: 429,
  3040: 429,
}

function providerError(
  status: number,
  message?: string,
  code = 'upstream_error',
  param: string | null = null,
  headers?: HeadersInit
): ApiError {
  if (status === 401 || status === 403) {
    return new ApiError(
      502,
      'Cloudflare rejected the configured provider credentials or account access.',
      'server_error',
      'provider_authentication_error'
    )
  }

  if (status === 408 || status === 504) {
    return new ApiError(
      504,
      'The inference provider timed out.',
      'server_error',
      'upstream_timeout'
    )
  }

  const mapped = status >= 400 && status < 500 ? status : 502

  return new ApiError(
    mapped,
    mapped < 500 && message
      ? message.slice(0, 2048)
      : 'The inference provider request failed.',
    mapped === 429
      ? 'rate_limit_error'
      : mapped < 500
        ? 'invalid_request_error'
        : 'server_error',
    code,
    param,
    headers
  )
}

function operationSignal(request: Request, timeout: number): ProviderOperation {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort(request.signal.reason)

  request.signal.addEventListener('abort', abort, { once: true })

  if (request.signal.aborted) {
    abort()
  }

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeout)

  return {
    signal: controller.signal,
    abort: () => controller.abort(),

    dispose() {
      clearTimeout(timer)
      request.signal.removeEventListener('abort', abort)
    },

    failure(error: unknown): Error {
      if (timedOut) {
        return providerError(504)
      }

      if (request.signal.aborted) {
        return new ApiError(
          499,
          'The request was cancelled.',
          'invalid_request_error',
          'request_cancelled'
        )
      }

      if (error instanceof ApiError) {
        return error
      }

      const message = error instanceof Error ? error.message : undefined
      const internal = message ? /\b(\d{4}):/.exec(message)?.[1] : undefined
      const status =
        isObject(error) && typeof error.status === 'number'
          ? error.status
          : internal
            ? BINDING_ERROR_STATUS[Number(internal)]
            : undefined

      return providerError(
        status ?? 502,
        message,
        internal ? `cloudflare_${internal}` : 'upstream_error'
      )
    },
  }
}

function managedStream(
  stream: ReadableStream<Uint8Array>,
  operation: ProviderOperation
): ReadableStream<Uint8Array> {
  const reader = stream.getReader()
  let ended = false
  let released = false
  let onAbort: () => void
  const finish = () => {
    operation.dispose()
    operation.signal.removeEventListener('abort', onAbort)

    if (!released) {
      released = true
      reader.releaseLock()
    }
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      onAbort = () => {
        if (ended) {
          return
        }

        ended = true
        controller.error(operation.failure(new Error('Provider stream aborted.')))
        void reader
          .cancel()
          .catch(() => {})
          .finally(finish)
      }
      operation.signal.addEventListener('abort', onAbort, { once: true })

      if (operation.signal.aborted) {
        onAbort()
      }
    },

    async pull(controller) {
      try {
        const { done, value } = await reader.read()

        if (ended) {
          return
        }

        if (done) {
          ended = true
          finish()
          controller.close()
        } else {
          controller.enqueue(value)
        }
      } catch (error) {
        if (ended) {
          return
        }

        ended = true
        finish()
        controller.error(operation.failure(error))
      }
    },

    async cancel(reason) {
      ended = true
      operation.signal.removeEventListener('abort', onAbort)
      operation.abort()

      try {
        await reader.cancel(reason)
      } finally {
        finish()
      }
    },
  })
}

export function responseHeaders(response: Response): Headers {
  const headers = new Headers()

  for (const [name, value] of response.headers) {
    if (
      ['content-type', 'retry-after'].includes(name) ||
      name.startsWith('x-ratelimit-')
    ) {
      headers.set(name, value)
    }
  }

  if ((headers.get('Content-Type') ?? '').includes('text/event-stream')) {
    headers.set('Cache-Control', 'no-cache, no-transform')
    headers.set('X-Accel-Buffering', 'no')
  }

  return headers
}

async function providerFailure(response: Response): Promise<never> {
  let body: unknown

  try {
    body = await readProviderJson(response, 1024 * 1024)
  } catch {
    /* Use a safe status-based error if the body is malformed. */
  }

  const error = isObject(body) && isObject(body.error) ? body.error : undefined
  const first = isObject(body) && Array.isArray(body.errors) ? body.errors[0] : undefined
  const details = error ?? (isObject(first) ? first : undefined)

  throw providerError(
    response.status,
    typeof details?.message === 'string' ? details.message : undefined,
    typeof details?.code === 'string' || typeof details?.code === 'number'
      ? String(details.code)
      : 'upstream_error',
    typeof error?.param === 'string' ? error.param : null,
    responseHeaders(response)
  )
}

export async function cloudflareRequest(
  request: Request,
  env: Env,
  path: string,
  init: RequestInit = {},
  timeout = INFERENCE_TIMEOUT
): Promise<Response> {
  if (!env.CLOUDFLARE_ACCOUNT_ID?.trim() || !env.CLOUDFLARE_API_TOKEN?.trim()) {
    throw new ApiError(
      503,
      'Cloudflare account credentials are not configured.',
      'server_error',
      'provider_not_configured'
    )
  }

  const operation = operationSignal(request, timeout)

  try {
    const headers = new Headers(init.headers)

    headers.set('Authorization', `Bearer ${env.CLOUDFLARE_API_TOKEN}`)

    const upstream = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/ai${path}`,
      { ...init, headers, signal: operation.signal, redirect: 'manual' }
    )

    if (upstream.status >= 300 && upstream.status < 400) {
      throw new ApiError(
        502,
        'The inference provider returned an unexpected redirect.',
        'server_error',
        'upstream_redirect'
      )
    }

    if (!upstream.ok) {
      console.error('Cloudflare provider returned an HTTP error.', {
        path: path.split('?', 1)[0],
        status: upstream.status,
        rayId: upstream.headers.get('cf-ray'),
      })
      await providerFailure(upstream)
    }

    if (!upstream.body) {
      upstreamError('The inference provider returned an empty body.')
    }

    return new Response(managedStream(upstream.body, operation), {
      status: upstream.status,
      headers: responseHeaders(upstream),
    })
  } catch (error) {
    operation.dispose()

    if (!(error instanceof ApiError)) {
      console.error('Cloudflare provider request failed.', {
        path: path.split('?', 1)[0],
        errorType: error instanceof Error ? error.name : 'UnknownError',
      })
    }

    throw operation.failure(error)
  }
}

export function nativeRequest(
  request: Request,
  env: Env,
  path: string,
  body: JsonObject
): Promise<Response> {
  return cloudflareRequest(request, env, `/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function readProviderJson(
  response: Response,
  limit = 32 * 1024 * 1024
): Promise<unknown> {
  if (!response.body) {
    upstreamError()
  }

  const bytes = await streamToBuffer(response.body, limit)

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return upstreamError('The inference provider returned invalid JSON.')
  }
}

export function unwrapResult(value: unknown): unknown {
  if (isObject(value) && value.success === false) {
    upstreamError()
  }

  return isObject(value) && Object.hasOwn(value, 'result') ? value.result : value
}

export async function runModel(
  request: Request,
  env: Env,
  model: string,
  input: JsonObject,
  returnRawResponse = false
): Promise<unknown> {
  if (!env.AI) {
    throw new ApiError(
      503,
      'The Workers AI binding is not configured.',
      'server_error',
      'provider_not_configured'
    )
  }

  const operation = operationSignal(request, INFERENCE_TIMEOUT)

  try {
    const result: unknown = await env.AI.run(model, input, {
      signal: operation.signal,
      returnRawResponse,
    })

    if (result instanceof Response) {
      if (!result.ok) {
        await providerFailure(result)
      }

      if (!result.body) {
        upstreamError('The provider returned an empty response.')
      }

      return new Response(managedStream(result.body, operation), {
        status: result.status,
        headers: responseHeaders(result),
      })
    }

    if (result instanceof ReadableStream) {
      return managedStream(result, operation)
    }

    operation.dispose()

    return result
  } catch (error) {
    operation.dispose()

    throw operation.failure(error)
  }
}
