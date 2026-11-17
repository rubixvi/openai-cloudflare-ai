import { type EmbeddingsRequest, type Env, type JsonObject } from '../../types'
import { uint8ArrayToBase64 } from '../../utils/converters'
import { unsupported, upstreamError } from '../../utils/errors'
import { resolveModel } from '../../utils/models'
import { nativeRequest, readProviderJson, unwrapResult } from '../../utils/provider'
import { isObject } from '../../utils/validation'

function encodeEmbedding(embedding: number[]): string {
  const bytes = new Uint8Array(embedding.length * 4)
  const view = new DataView(bytes.buffer)

  embedding.forEach((value, index) => {
    view.setFloat32(index * 4, value, true)
  })

  return uint8ArrayToBase64(bytes)
}

function normalizeEmbedding(
  item: unknown,
  expectedCount: number,
  seen: Set<number>,
  dimensions?: number,
  encodingFormat?: string
): JsonObject {
  if (
    !isObject(item) ||
    !Number.isInteger(item.index) ||
    (item.index as number) < 0 ||
    (item.index as number) >= expectedCount ||
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

  if (encodingFormat !== 'base64') {
    return item
  }

  return {
    ...item,
    embedding: encodeEmbedding(item.embedding),
  }
}

export async function forwardEmbeddings(
  request: Request,
  env: Env,
  body: EmbeddingsRequest,
  expectedCount: number,
  dimensions?: number
): Promise<Response> {
  const response = await nativeRequest(request, env, '/embeddings', {
    ...body,
    model: resolveModel(env, body.model, 'embedding'),
    encoding_format: 'float',
  })

  const result = unwrapResult(await readProviderJson(response))

  if (
    !isObject(result) ||
    !Array.isArray(result.data) ||
    result.data.length !== expectedCount
  ) {
    upstreamError('The provider returned an incomplete embedding batch.')
  }

  const seen = new Set<number>()

  const data: JsonObject[] = result.data.map((item: unknown) =>
    normalizeEmbedding(item, expectedCount, seen, dimensions, body.encoding_format)
  )

  data.sort((a, b) => (a.index as number) - (b.index as number))

  return Response.json({ ...result, data }, { headers: response.headers })
}
