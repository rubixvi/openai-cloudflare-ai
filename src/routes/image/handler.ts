import { type Env, type ImageData, type ImageProfile, type JsonObject } from '../../types'
import { base64ToUint8Array, uint8ArrayToBase64 } from '../../utils/converters'
import { ApiError, upstreamError } from '../../utils/errors'
import { runModel } from '../../utils/provider'
import { streamToBuffer } from '../../utils/stream'
import { isObject } from '../../utils/validation'
import {
  IMAGE_NAME,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LENGTH,
  MAX_INLINE_BYTES,
} from './constant'

type Options = {
  model: string
  profile: ImageProfile
  parameters: JsonObject
  count: number
  format: 'url' | 'b64_json'
}

function imageType(bytes: Uint8Array): string {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    return 'image/png'
  }

  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return 'image/jpeg'
  }

  if (
    new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }

  return upstreamError('The provider returned unsupported or invalid image data.')
}

async function imageBytes(result: unknown): Promise<Uint8Array> {
  let bytes: Uint8Array

  if (result instanceof Response) {
    if (!result.body) {
      upstreamError('The provider returned an empty image response.')
    }

    bytes = await streamToBuffer(result.body)
  } else if (result instanceof ReadableStream) {
    bytes = await streamToBuffer(result)
  } else if (result instanceof Uint8Array) {
    bytes = result
  } else if (result instanceof ArrayBuffer) {
    bytes = new Uint8Array(result)
  } else if (Array.isArray(result) && result.length === 1) {
    return imageBytes(result[0])
  } else if (isObject(result) && typeof result.image === 'string') {
    if (result.image.length > MAX_IMAGE_LENGTH) {
      upstreamError('The generated image is too large.')
    }

    try {
      bytes = base64ToUint8Array(result.image)
    } catch {
      return upstreamError('Invalid provider image encoding.')
    }
  } else {
    return upstreamError('The provider returned an unsupported image output.')
  }

  if (!bytes.length || bytes.byteLength > MAX_IMAGE_BYTES) {
    upstreamError('The generated image has an invalid size.')
  }

  imageType(bytes)

  return bytes
}

function imageOptions(parameters: JsonObject, profile: ImageProfile): JsonObject {
  if (profile.input !== 'multipart') {
    return parameters
  }

  const form = new FormData()

  for (const [key, value] of Object.entries(parameters)) {
    form.set(key, String(value))
  }

  const multipart = new Request('https://multipart.invalid', {
    method: 'POST',
    body: form,
  })

  return {
    multipart: {
      body: multipart.body,
      contentType: multipart.headers.get('Content-Type'),
    },
  }
}

export async function generateImages(
  request: Request,
  env: Env,
  { model, profile, parameters, count, format }: Options
): Promise<Response> {
  const bucket = env.IMAGE_BUCKET
  const data: ImageData[] = []
  const stored: string[] = []
  let total = 0

  try {
    for (let index = 0; index < count; index++) {
      const options = imageOptions(parameters, profile)
      const bytes = await imageBytes(await runModel(request, env, model, options))

      total += bytes.byteLength

      if (format === 'b64_json') {
        if (total > MAX_INLINE_BYTES) {
          upstreamError(
            'The image batch is too large for an inline response. Use URL output or a smaller batch.'
          )
        }

        data.push({ b64_json: uint8ArrayToBase64(bytes) })
      } else {
        const type = imageType(bytes)
        const name = `${crypto.randomUUID()}.${type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png'}`

        if (!bucket) {
          throw new ApiError(
            503,
            'Image storage is not configured.',
            'server_error',
            'storage_not_configured'
          )
        }

        await bucket.put(name, bytes, {
          httpMetadata: {
            contentType: type,
            cacheControl: 'public, max-age=31536000, immutable',
          },
        })
        stored.push(name)
        data.push({
          url: `${new URL(request.url).origin}/v1/images/get/${name}`,
        })
      }
    }
  } catch (error) {
    if (stored.length && bucket) {
      await bucket.delete(stored).catch(() => {})
    }

    throw error
  }

  return Response.json({ created: Math.floor(Date.now() / 1000), data })
}

export async function getImageHandler(request: Request, env: Env): Promise<Response> {
  const name =
    new URL(request.url).pathname
      .replace(/\/{2,}/g, '/')
      .replace(/\/$/, '')
      .split('/')
      .pop() ?? ''

  if (!IMAGE_NAME.test(name)) {
    throw new ApiError(404, 'Image not found.', 'invalid_request_error', 'not_found')
  }

  if (!env.IMAGE_BUCKET) {
    throw new ApiError(
      503,
      'Image storage is not configured.',
      'server_error',
      'storage_not_configured'
    )
  }

  const image =
    request.method === 'HEAD'
      ? await env.IMAGE_BUCKET.head(name)
      : await env.IMAGE_BUCKET.get(name)

  if (!image) {
    throw new ApiError(404, 'Image not found.', 'invalid_request_error', 'not_found')
  }

  const headers = new Headers()

  image.writeHttpMetadata(headers)
  headers.set('Content-Type', image.httpMetadata?.contentType ?? 'image/png')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('ETag', image.httpEtag)

  const condition = request.headers.get('If-None-Match')

  if (
    condition
      ?.split(',')
      .some(
        (value) =>
          value.trim().replace(/^W\//, '') === image.httpEtag || value.trim() === '*'
      )
  ) {
    if ('body' in image && image.body instanceof ReadableStream) {
      await image.body.cancel()
    }

    return new Response(null, {
      status: 304,
      headers,
    })
  }

  headers.set('Content-Length', String(image.size))

  return new Response(
    'body' in image && image.body instanceof ReadableStream ? image.body : null,
    { headers }
  )
}
