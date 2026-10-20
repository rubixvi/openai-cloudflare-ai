import { type EmbeddingsRequest, type Env, type JsonObject } from '../types'
import { uint8ArrayToBase64 } from '../utils/converters'
import { invalid, unsupported, upstreamError } from '../utils/errors'
import { resolveModel } from '../utils/models'
import { nativeRequest, readProviderJson, unwrapResult } from '../utils/provider'
import { allowedFields, isObject, numberValue, readJson } from '../utils/validation'

export async function embeddingsHandler(request: Request, env: Env): Promise<Response> {
  const input = await readJson(request)

  allowedFields(input, ['model', 'input', 'encoding_format', 'dimensions', 'user'])

  const texts = typeof input.input === 'string' ? [input.input] : input.input

  if (
    !Array.isArray(texts) ||
    texts.length === 0 ||
    texts.length > 2048 ||
    !texts.every((text) => typeof text === 'string' && text.trim().length > 0)
  ) {
    invalid(
      'Provide a non-empty string or an array of up to 2048 non-empty strings. Token IDs are not supported by Workers AI.',
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

  const dimensions = numberValue(input.dimensions, 'dimensions', 1, 65536, true)
  const body = input as EmbeddingsRequest
  const response = await nativeRequest(request, env, '/embeddings', {
    ...body,
    model: resolveModel(env, body.model, 'embedding'),
    encoding_format: 'float',
  })
  const result = unwrapResult(await readProviderJson(response))

  if (
    !isObject(result) ||
    !Array.isArray(result.data) ||
    result.data.length !== texts.length
  ) {
    upstreamError('The provider returned an incomplete embedding batch.')
  }

  const seen = new Set<number>()
  const data: JsonObject[] = result.data.map((item: unknown) => {
    if (
      !isObject(item) ||
      !Number.isInteger(item.index) ||
      (item.index as number) < 0 ||
      (item.index as number) >= texts.length ||
      seen.has(item.index as number) ||
      !Array.isArray(item.embedding) ||
      !item.embedding.length ||
      !item.embedding.every(
        (value) =>
          typeof value === 'number' &&
          Number.isFinite(value) &&
          Number.isFinite(Math.fround(value))
      )
    ) {
      upstreamError('The provider returned an invalid embedding.')
    }

    seen.add(item.index as number)

    if (dimensions !== undefined && item.embedding.length !== dimensions) {
      unsupported(
        'dimensions',
        'This model does not support the requested embedding dimensions.'
      )
    }

    if (body.encoding_format !== 'base64') {
      return item
    }

    const bytes = new Uint8Array(item.embedding.length * 4)
    const view = new DataView(bytes.buffer)

    item.embedding.forEach((value: number, index: number) => {
      view.setFloat32(index * 4, value, true)
    })

    return { ...item, embedding: uint8ArrayToBase64(bytes) }
  })

  data.sort((a, b) => (a.index as number) - (b.index as number))

  return Response.json({ ...result, data }, { headers: response.headers })
}
