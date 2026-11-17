import { type Env, type ImageRequest, type JsonObject } from '../../types'
import { ApiError, invalid, unsupported } from '../../utils/errors'
import { IMAGE_PROFILES, resolveModel } from '../../utils/models'
import { allowedFields, numberValue, readJson, stringValue } from '../../utils/validation'
import { IMAGE_FIELDS, IMAGE_FORMATS, IMAGE_SIZE } from './constant'
import { generateImages } from './handler'

export { getImageHandler } from './handler'

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

  allowedFields(input, [...IMAGE_FIELDS, ...profile.parameters])

  const prompt = stringValue(input.prompt, 'prompt', true)

  if (prompt.length > profile.maxPrompt) {
    invalid(`The model accepts prompts up to ${profile.maxPrompt} characters.`, 'prompt')
  }

  const count = numberValue(input.n, 'n', 1, 10, true) ?? 1

  for (const key of ['response_format', 'format']) {
    if (
      input[key] !== undefined &&
      !IMAGE_FORMATS.includes(input[key] as 'url' | 'b64_json')
    ) {
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

  if (format === 'url' && !env.IMAGE_BUCKET) {
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

    const size = typeof body.size === 'string' ? IMAGE_SIZE.exec(body.size) : null

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

  return generateImages(request, env, { model, profile, parameters, count, format })
}
