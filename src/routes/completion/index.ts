import { type CompletionRequest, type Env } from '../../types'
import { unsupported } from '../../utils/errors'
import {
  allowedFields,
  generationOptions,
  numberValue,
  readJson,
  stringValue,
} from '../../utils/validation'
import { COMPLETION_FIELDS } from './constant'
import { forwardCompletion } from './handler'

export async function completionHandler(request: Request, env: Env): Promise<Response> {
  const input = await readJson(request)

  allowedFields(input, COMPLETION_FIELDS)
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

  return forwardCompletion(request, env, input as CompletionRequest)
}
