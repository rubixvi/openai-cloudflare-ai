import { type EmbeddingsRequest, type Env } from '../../types'
import { invalid } from '../../utils/errors'
import { allowedFields, numberValue, readJson } from '../../utils/validation'
import {
  EMBEDDING_FIELDS,
  MAX_EMBEDDING_DIMENSIONS,
  MAX_EMBEDDING_INPUTS,
} from './constant'
import { forwardEmbeddings } from './handler'

export async function embeddingsHandler(request: Request, env: Env): Promise<Response> {
  const input = await readJson(request)

  allowedFields(input, EMBEDDING_FIELDS)

  const texts = typeof input.input === 'string' ? [input.input] : input.input

  if (
    !Array.isArray(texts) ||
    texts.length === 0 ||
    texts.length > MAX_EMBEDDING_INPUTS ||
    !texts.every((text) => typeof text === 'string' && text.trim().length > 0)
  ) {
    invalid(
      `Provide a non-empty string or an array of up to ${MAX_EMBEDDING_INPUTS} non-empty strings. Token IDs are not supported by Workers AI.`,
      'input'
    )
  }

  if (
    input.encoding_format !== undefined &&
    input.encoding_format !== 'float' &&
    input.encoding_format !== 'base64'
  ) {
    invalid('Use float or base64.', 'encoding_format')
  }

  const dimensions = numberValue(
    input.dimensions,
    'dimensions',
    1,
    MAX_EMBEDDING_DIMENSIONS,
    true
  )

  return forwardEmbeddings(
    request,
    env,
    input as EmbeddingsRequest,
    texts.length,
    dimensions
  )
}
