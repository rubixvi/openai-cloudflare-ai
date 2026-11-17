import { type ChatRequest, type Env } from '../../types'
import { invalid, unsupported, upstreamError } from '../../utils/errors'
import { readProviderJson, unwrapResult } from '../../utils/provider'
import {
  booleanValue,
  generationOptions,
  isObject,
  readJson,
} from '../../utils/validation'
import { CHAT_ROLES } from './constant'
import { forwardChat } from './handler'

export async function chatHandler(request: Request, env: Env): Promise<Response> {
  const input = await readJson(request)

  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    invalid('Provide at least one message.', 'messages')
  }

  for (const [index, message] of input.messages.entries()) {
    if (!isObject(message) || !CHAT_ROLES.has(String(message.role))) {
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
  const response = await forwardChat(request, env, body)

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
