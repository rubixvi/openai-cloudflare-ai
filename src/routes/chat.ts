import { type ChatRequest, type Env } from '../types'
import { ApiError, invalid, unsupported, upstreamError } from '../utils/errors'
import { resolveModel } from '../utils/models'
import { nativeRequest, readProviderJson, unwrapResult } from '../utils/provider'
import { booleanValue, generationOptions, isObject, readJson } from '../utils/validation'

const DEFAULT_MAX_TOKENS = 4096
const CONTEXT_SAFETY_MARGIN = 128
const MIN_FALLBACK_TOKENS = 256

const CONTEXT_WINDOW_ERROR =
  /estimated number of input and maximum output tokens \((\d+)\) exceeded this model context window limit \((\d+)\)/i

export async function chatHandler(request: Request, env: Env): Promise<Response> {
  const input = await readJson(request)

  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    invalid('Provide at least one message.', 'messages')
  }

  for (const [index, message] of input.messages.entries()) {
    if (
      !isObject(message) ||
      !['system', 'developer', 'user', 'assistant', 'tool', 'function'].includes(
        String(message.role)
      )
    ) {
      invalid('Invalid message role.', `messages[${index}].role`)
    }

    if (
      typeof message.content !== 'string' &&
      !Array.isArray(message.content) &&
      !(
        message.role === 'assistant' &&
        (message.content === undefined || message.content === null)
      )
    ) {
      invalid(
        'Provide message content or an assistant tool call.',
        `messages[${index}].content`
      )
    }

    if (Array.isArray(message.content) && !message.content.every(isObject)) {
      invalid('Content parts must be objects.', `messages[${index}].content`)
    }

    if (
      message.role === 'tool' &&
      (typeof message.tool_call_id !== 'string' || !message.tool_call_id)
    ) {
      invalid('Tool messages require tool_call_id.', `messages[${index}].tool_call_id`)
    }
  }

  generationOptions(input)
  booleanValue(input.store, 'store')

  if (input.store === true) {
    unsupported('store', 'Stored Chat Completions are not implemented by this gateway.')
  }

  if (input.stream_options !== undefined && !isObject(input.stream_options)) {
    invalid('Expected an object.', 'stream_options')
  }

  const body = input as ChatRequest
  const { max_completion_tokens, ...options } = body

  const explicitLimit = body.max_tokens ?? max_completion_tokens
  const maxTokens = typeof explicitLimit === 'number' ? explicitLimit : DEFAULT_MAX_TOKENS

  const payload = {
    ...options,
    model: resolveModel(env, body.model, 'chat'),
    max_tokens: maxTokens,
  }

  let response: Response

  try {
    response = await nativeRequest(request, env, '/chat/completions', payload)
  } catch (error) {
    if (
      explicitLimit !== undefined ||
      !(error instanceof ApiError) ||
      ![400, 413].includes(error.status)
    ) {
      throw error
    }

    const match = CONTEXT_WINDOW_ERROR.exec(error.message)

    if (!match) {
      throw error
    }

    const estimatedTotal = Number(match[1])
    const contextWindow = Number(match[2])

    const retryLimit =
      maxTokens - (estimatedTotal - contextWindow) - CONTEXT_SAFETY_MARGIN

    if (
      !Number.isSafeInteger(retryLimit) ||
      retryLimit < MIN_FALLBACK_TOKENS ||
      retryLimit >= maxTokens
    ) {
      throw error
    }

    console.warn('Adjusting output tokens for model context window.', {
      model: payload.model,
      previousLimit: maxTokens,
      adjustedLimit: retryLimit,
    })

    response = await nativeRequest(request, env, '/chat/completions', {
      ...payload,
      max_tokens: retryLimit,
    })
  }

  if (body.stream) {
    if (!(response.headers.get('Content-Type') ?? '').includes('text/event-stream')) {
      await response.body?.cancel()
      upstreamError('The provider did not return an event stream.')
    }

    return response
  }

  const result = unwrapResult(await readProviderJson(response))

  if (
    !isObject(result) ||
    !Array.isArray(result.choices) ||
    result.object !== 'chat.completion'
  ) {
    upstreamError()
  }

  return Response.json(result, { headers: response.headers })
}
