import { routes } from './routes/index'
import { type Env } from './types'
import { ApiError, errorResponse } from './utils/errors'

export type { Env } from './types'

async function authenticate(request: Request, env: Env): Promise<void> {
  if (!env.ACCESS_TOKEN?.trim()) {
    throw new ApiError(
      503,
      'API authentication is not configured.',
      'server_error',
      'authentication_not_configured'
    )
  }

  const token = /^Bearer[\t ]+([^\s]+)$/i.exec(
    request.headers.get('Authorization') ?? ''
  )?.[1]

  if (!token || token.length > 8192) {
    throw new ApiError(
      401,
      'Provide a valid Bearer token.',
      'authentication_error',
      'invalid_api_key',
      null,
      { 'WWW-Authenticate': 'Bearer' }
    )
  }

  const encoder = new TextEncoder()
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(token)),
    crypto.subtle.digest('SHA-256', encoder.encode(env.ACCESS_TOKEN)),
  ])
  const left = new DataView(actual)
  const right = new DataView(expected)
  let difference = 0

  for (let offset = 0; offset < left.byteLength; offset += 4) {
    difference |= left.getUint32(offset) ^ right.getUint32(offset)
  }

  if (difference !== 0) {
    throw new ApiError(
      401,
      'The API token is invalid.',
      'authentication_error',
      'invalid_api_key',
      null,
      { 'WWW-Authenticate': 'Bearer' }
    )
  }
}

function finalize(response: Response, request: Request, requestId: string): Response {
  const headers = new Headers(response.headers)

  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,If-None-Match')
  headers.set('Access-Control-Expose-Headers', 'X-Request-Id,Retry-After,ETag')
  headers.set('X-Request-Id', requestId)
  headers.set('X-Content-Type-Options', 'nosniff')

  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'no-store')
  }

  if (request.method === 'HEAD' && response.body) {
    void response.body.cancel().catch(() => {})
  }

  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestId = crypto.randomUUID()
    let response: Response

    try {
      if (request.method === 'OPTIONS') {
        return finalize(new Response(null, { status: 204 }), request, requestId)
      }

      const path =
        new URL(request.url).pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
      const matching = routes.filter((route) => route.path.test(path))

      if (!matching.length) {
        throw new ApiError(
          404,
          'The requested endpoint does not exist.',
          'invalid_request_error',
          'not_found'
        )
      }

      const method = request.method === 'HEAD' ? 'GET' : request.method
      const route = matching.find((candidate) => candidate.method === method)

      if (!route) {
        const methods = new Set(matching.map((candidate) => candidate.method as string))

        if (methods.has('GET')) {
          methods.add('HEAD')
        }

        methods.add('OPTIONS')

        throw new ApiError(
          405,
          'This HTTP method is not allowed.',
          'invalid_request_error',
          'method_not_allowed',
          null,
          { Allow: [...methods].join(', ') }
        )
      }

      if (route.auth) {
        await authenticate(request, env)
      }

      response = await route.handler(request, env, ctx)
    } catch (error) {
      response = errorResponse(error)
    }

    return finalize(response, request, requestId)
  },
}
