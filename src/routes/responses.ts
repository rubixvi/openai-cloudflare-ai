import { type Env, type ResponsesRequest } from '../types'
import { invalid, unsupported, upstreamError } from '../utils/errors'
import { RESPONSES_MODELS, resolveModel } from '../utils/models'
import { nativeRequest, readProviderJson, unwrapResult } from '../utils/provider'
import {
  booleanValue,
  isObject,
  numberValue,
  readJson,
  stringValue,
} from '../utils/validation'

export async function responsesHandler(request: Request, env: Env): Promise<Response> {
  const input = await readJson(request)

  if (
    typeof input.input !== 'string' &&
    !(Array.isArray(input.input) && input.input.every(isObject))
  ) {
    invalid('Provide text or an array of Responses input items.', 'input')
  }

  booleanValue(input.stream, 'stream')

  if (input.stream === true) {
    unsupported(
      'stream',
      'Cloudflare supports non-streaming Responses requests only. Use Chat Completions for streaming.'
    )
  }

  for (const key of ['store', 'background']) {
    booleanValue(input[key], key)

    if (input[key] === true) {
      unsupported(key, 'This gateway does not store responses or run background jobs.')
    }
  }

  for (const key of ['previous_response_id', 'conversation']) {
    if (input[key] !== undefined && input[key] !== null) {
      unsupported(
        key,
        'Send the full conversation in input. Server-side conversation state is not available.'
      )
    }
  }

  stringValue(input.instructions, 'instructions')
  numberValue(
    input.max_output_tokens,
    'max_output_tokens',
    1,
    Number.MAX_SAFE_INTEGER,
    true
  )
  numberValue(input.temperature, 'temperature', 0, 2)
  numberValue(input.top_p, 'top_p', 0, 1)

  if (
    input.tools !== undefined &&
    (!Array.isArray(input.tools) ||
      !input.tools.every((tool) => isObject(tool) && tool.type === 'function'))
  ) {
    unsupported(
      'tools',
      'Only provider-supported function tools are accepted. OpenAI-hosted tools are not available on Cloudflare.'
    )
  }

  const body = input as ResponsesRequest
  const model = resolveModel(env, body.model, 'responses')

  if (!RESPONSES_MODELS.has(model)) {
    unsupported(
      'model',
      'Cloudflare Responses supports @cf/openai/gpt-oss-120b and @cf/openai/gpt-oss-20b only.'
    )
  }

  const response = await nativeRequest(request, env, '/responses', {
    ...body,
    model,
    stream: false,
    store: false,
  })
  const result = unwrapResult(await readProviderJson(response))

  if (
    !isObject(result) ||
    result.object !== 'response' ||
    typeof result.id !== 'string' ||
    typeof result.created_at !== 'number' ||
    !Array.isArray(result.output)
  ) {
    upstreamError('The provider returned an invalid Responses object.')
  }

  return Response.json(result, { headers: response.headers })
}
