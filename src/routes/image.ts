import { type Env, type ImageData, type ImageRequest, type JsonObject } from '../types'
import { base64ToUint8Array, uint8ArrayToBase64 } from '../utils/converters'
import { ApiError, invalid, unsupported, upstreamError } from '../utils/errors'
import { IMAGE_PROFILES, resolveModel } from '../utils/models'
import { runModel } from '../utils/provider'
import { streamToBuffer } from '../utils/stream'
import {
  allowedFields,
  isObject,
  numberValue,
  readJson,
  stringValue,
} from '../utils/validation'

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

  if (result instanceof ReadableStream) {
    bytes = await streamToBuffer(result)
  } else if (result instanceof Uint8Array) {
    bytes = result
  } else if (result instanceof ArrayBuffer) {
    bytes = new Uint8Array(result)
  } else if (Array.isArray(result) && result.length === 1) {
    return imageBytes(result[0])
  } else if (isObject(result) && typeof result.image === 'string') {
    if (result.image.length > 44 * 1024 * 1024) {
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

  if (!bytes.length || bytes.byteLength > 32 * 1024 * 1024) {
    upstreamError('The generated image has an invalid size.')
  }

  imageType(bytes)

  return bytes
}

export async function imageGenerationHandler(
  request: Request,
  env: Env
): Promise<Response> {
  const input = await readJson(request)
  const model = resolveModel(env, input.model, 'image')
  const profile = Object.hasOwn(IMAGE_PROFILES, model) ? IMAGE_PROFILES[model] : undefined

  if (!profile) {
    unsupported(
      'model',
      'This image model requires an adapter. Choose a supported image model from /v1/models.'
    )
  }

  allowedFields(input, [
    'model',
    'prompt',
    'n',
    'response_format',
    'format',
    'size',
    'user',
    ...profile.parameters,
  ])

  const prompt = stringValue(input.prompt, 'prompt', true)

  if (prompt.length > profile.maxPrompt) {
    invalid(`The model accepts prompts up to ${profile.maxPrompt} characters.`, 'prompt')
  }

  const n = numberValue(input.n, 'n', 1, 10, true) ?? 1

  for (const key of ['response_format', 'format']) {
    if (input[key] !== undefined && input[key] !== 'url' && input[key] !== 'b64_json') {
      invalid('Use url or b64_json.', key)
    }
  }

  if (
    input.format !== undefined &&
    input.response_format !== undefined &&
    input.format !== input.response_format
  ) {
    invalid('format and response_format must agree.', 'response_format')
  }

  const body = input as ImageRequest
  const format = body.response_format ?? body.format ?? 'url'
  const bucket = env.IMAGE_BUCKET

  if (format === 'url' && !bucket) {
    throw new ApiError(
      503,
      'IMAGE_BUCKET is required for URL output. Use response_format b64_json for inline images.',
      'server_error',
      'storage_not_configured'
    )
  }

  const parameters: JsonObject = { prompt }

  for (const key of profile.parameters) {
    if (body[key] === undefined) {
      continue
    }

    if (key === 'negative_prompt') {
      stringValue(body[key], key)
    } else if (key === 'width' || key === 'height') {
      numberValue(body[key], key, 256, 2048, true)
    } else if (key === 'seed') {
      numberValue(body[key], key, 0, 4294967295, true)
    } else if (key === 'steps' || key === 'num_steps') {
      numberValue(body[key], key, 1, profile.maxSteps ?? 50, true)
    } else {
      numberValue(body[key], key, 0, 100)
    }

    parameters[key] = body[key]
  }

  if (body.size !== undefined) {
    if (!profile.dimensions) {
      unsupported('size', 'This model uses a fixed image size.')
    }

    const size = typeof body.size === 'string' ? /^(\d+)x(\d+)$/.exec(body.size) : null

    if (!size) {
      invalid('Use WIDTHxHEIGHT.', 'size')
    }

    const width = Number(size[1])
    const height = Number(size[2])

    numberValue(width, 'size', 256, 2048, true)
    numberValue(height, 'size', 256, 2048, true)

    if (
      (parameters.width !== undefined && parameters.width !== width) ||
      (parameters.height !== undefined && parameters.height !== height)
    ) {
      invalid('size conflicts with width or height.', 'size')
    }

    parameters.width = width
    parameters.height = height
  }

  const multiple = profile.input === 'multipart' ? 16 : 8

  for (const key of ['width', 'height']) {
    if (typeof parameters[key] === 'number' && parameters[key] % multiple !== 0) {
      invalid(`Dimensions must be divisible by ${multiple}.`, key)
    }
  }

  const data: ImageData[] = []
  const stored: string[] = []
  let total = 0

  try {
    for (let index = 0; index < n; index++) {
      let options = parameters

      if (profile.input === 'multipart') {
        const form = new FormData()

        for (const [key, value] of Object.entries(parameters)) {
          form.set(key, String(value))
        }

        const multipart = new Request('https://multipart.invalid', {
          method: 'POST',
          body: form,
        })

        options = {
          multipart: {
            body: multipart.body,
            contentType: multipart.headers.get('Content-Type'),
          },
        }
      }

      const bytes = await imageBytes(await runModel(request, env, model, options))

      total += bytes.byteLength

      if (format === 'b64_json') {
        if (total > 24 * 1024 * 1024) {
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

  if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(name)) {
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

    return new Response(null, { status: 304, headers })
  }

  headers.set('Content-Length', String(image.size))

  return new Response(
    'body' in image && image.body instanceof ReadableStream ? image.body : null,
    {
      headers,
    }
  )
}
