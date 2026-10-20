import {
  type CompletionRequest,
  type Env,
  type GenerationResult,
  type JsonObject,
} from '../types'
import { errorResponse, unsupported, upstreamError } from '../utils/errors'
import { resolveModel } from '../utils/models'
import { runModel } from '../utils/provider'
import { eventStream, readSse } from '../utils/stream'
import {
  allowedFields,
  generationOptions,
  isObject,
  numberValue,
  readJson,
  stringValue,
} from '../utils/validation'

function generationResult(value: unknown): GenerationResult {
  if (!isObject(value)) {
    upstreamError()
  }

  if (value.error !== undefined) {
    upstreamError()
  }

  const choice = Array.isArray(value.choices) ? value.choices[0] : undefined
  const message =
    isObject(choice) && isObject(choice.message) ? choice.message : undefined
  const text =
    value.response ??
    value.text ??
    value.output_text ??
    message?.content ??
    (isObject(choice) ? choice.text : undefined)

  if (typeof text !== 'string') {
    upstreamError('The provider returned no completion text.')
  }

  const usage = isObject(value.usage) ? value.usage : undefined

  return {
    text,
    finishReason:
      isObject(choice) && typeof choice.finish_reason === 'string'
        ? choice.finish_reason
        : 'stop',
    ...(usage ? { usage } : {}),
  }
}

export async function completionHandler(request: Request, env: Env): Promise<Response> {
  const input = await readJson(request)

  allowedFields(input, [
    'model',
    'prompt',
    'stream',
    'max_tokens',
    'temperature',
    'top_p',
    'top_k',
    'seed',
    'repetition_penalty',
    'frequency_penalty',
    'presence_penalty',
    'n',
    'echo',
    'logprobs',
    'best_of',
    'suffix',
    'stop',
    'user',
    'stream_options',
  ])
  stringValue(input.prompt, 'prompt', true)
  generationOptions(input)
  numberValue(input.top_k, 'top_k', 1, Number.MAX_SAFE_INTEGER, true)
  numberValue(input.seed, 'seed', 0, 4294967295, true)
  numberValue(input.repetition_penalty, 'repetition_penalty', 0, Number.MAX_VALUE)

  if (input.n !== undefined && input.n !== 1) {
    unsupported('n', 'Workers AI returns one completion per request.')
  }

  if (input.best_of !== undefined && input.best_of !== 1) {
    unsupported('best_of')
  }

  if (input.echo !== undefined && input.echo !== false) {
    unsupported('echo')
  }

  if (input.logprobs !== undefined && input.logprobs !== null) {
    unsupported('logprobs')
  }

  if (input.suffix !== undefined && input.suffix !== null) {
    unsupported('suffix')
  }

  if (input.stop !== undefined && input.stop !== null) {
    unsupported(
      'stop',
      'The binding does not provide reliable stop-sequence control for all completion models.'
    )
  }

  if (input.stream_options !== undefined) {
    unsupported('stream_options')
  }

  const body = input as CompletionRequest
  const model = resolveModel(env, body.model, 'completion')
  const options: JsonObject = {
    prompt: body.prompt,
    stream: body.stream ?? false,
  }

  for (const key of [
    'max_tokens',
    'temperature',
    'top_p',
    'top_k',
    'seed',
    'repetition_penalty',
    'frequency_penalty',
    'presence_penalty',
  ]) {
    if (body[key] !== undefined) {
      options[key] = body[key]
    }
  }

  const cancellation = new AbortController()
  const inferenceRequest = new Request(request.url, {
    signal: AbortSignal.any([request.signal, cancellation.signal]),
  })
  const result = await runModel(inferenceRequest, env, model, options)
  const id = `cmpl-${crypto.randomUUID().replaceAll('-', '')}`
  const created = Math.floor(Date.now() / 1000)
  const base = { id, object: 'text_completion', created, model }

  if (!body.stream) {
    const completion = generationResult(result)

    return Response.json({
      ...base,
      choices: [
        {
          index: 0,
          text: completion.text,
          logprobs: null,
          finish_reason: completion.finishReason,
        },
      ],
      ...(completion.usage ? { usage: completion.usage } : {}),
    })
  }

  if (!(result instanceof ReadableStream)) {
    upstreamError('The provider did not return an event stream.')
  }

  async function* events(): AsyncGenerator<string> {
    let finished = false
    let sawDone = false

    try {
      for await (const event of readSse(result as ReadableStream<Uint8Array>)) {
        if (event.data === '[DONE]') {
          sawDone = true

          break
        }

        let value: unknown

        try {
          value = JSON.parse(event.data)
        } catch {
          upstreamError('Invalid provider stream JSON.')
        }

        if (!isObject(value) || value.error !== undefined || event.event === 'error') {
          upstreamError('The provider stream failed.')
        }

        const choice = Array.isArray(value.choices) ? value.choices[0] : undefined
        const delta =
          isObject(choice) && isObject(choice.delta) ? choice.delta : undefined

        if (delta?.tool_calls !== undefined) {
          upstreamError('A text completion cannot contain tool calls.')
        }

        const text =
          value.response ??
          delta?.content ??
          (isObject(choice) ? choice.text : undefined) ??
          ''

        if (typeof text !== 'string') {
          upstreamError()
        }

        const reason =
          isObject(choice) && typeof choice.finish_reason === 'string'
            ? choice.finish_reason
            : null

        if (finished && (text || reason)) {
          upstreamError('The provider sent data after completing the stream.')
        }

        if (reason) {
          finished = true
        }

        if (text || reason) {
          yield `data: ${JSON.stringify({ ...base, choices: [{ index: 0, text, logprobs: null, finish_reason: reason }] })}\n\n`
        }

        if (isObject(value.usage)) {
          yield `data: ${JSON.stringify({ ...base, choices: [], usage: value.usage })}\n\n`
        }
      }

      if (!finished && !sawDone) {
        upstreamError('The provider stream ended before completion.')
      }

      if (!finished) {
        yield `data: ${JSON.stringify({ ...base, choices: [{ index: 0, text: '', logprobs: null, finish_reason: 'stop' }] })}\n\n`
      }

      yield 'data: [DONE]\n\n'
    } catch (error) {
      yield `data: ${await errorResponse(error).text()}\n\n`
    }
  }

  return new Response(
    eventStream(events(), () => cancellation.abort()),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    }
  )
}
