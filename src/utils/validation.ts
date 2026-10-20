import { type JsonObject } from '../types'
import { ApiError, invalid, unsupported } from './errors'
import { streamToBuffer } from './stream'

export const JSON_LIMIT = 2 * 1024 * 1024

export const AUDIO_LIMIT = 25 * 1024 * 1024

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringValue(value: unknown, param: string, required: true): string
export function stringValue(
  value: unknown,
  param: string,
  required?: false
): string | undefined
export function stringValue(
  value: unknown,
  param: string,
  required = false
): string | undefined {
  if (value === undefined && !required) {
    return undefined
  }

  if (typeof value !== 'string' || (required && !value.trim())) {
    invalid('Expected a non-empty string.', param)
  }

  return value
}

export function booleanValue(value: unknown, param: string): boolean | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    invalid('Expected a boolean.', param)
  }

  return value
}

export function numberValue(
  value: unknown,
  param: string,
  min: number,
  max: number,
  integer = false
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    invalid(
      `Expected ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`,
      param
    )
  }

  return value
}

export function allowedFields(body: JsonObject, fields: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!fields.includes(key)) {
      unsupported(key)
    }
  }
}

export function mediaType(request: Request): string {
  const [contentType = ''] = (request.headers.get('Content-Type') ?? '').split(';', 1)

  return contentType.trim().toLowerCase()
}

export async function readRequestBytes(
  request: Request,
  limit: number
): Promise<Uint8Array> {
  const length = Number(request.headers.get('Content-Length'))

  if (Number.isFinite(length) && length > limit) {
    throw new ApiError(
      413,
      'Request body is too large.',
      'invalid_request_error',
      'payload_too_large'
    )
  }

  if (!request.body) {
    invalid('A request body is required.')
  }

  return streamToBuffer(request.body, limit, 413)
}

export async function readJson(request: Request): Promise<JsonObject> {
  if (mediaType(request) !== 'application/json') {
    throw new ApiError(
      415,
      'Use application/json.',
      'invalid_request_error',
      'unsupported_media_type'
    )
  }

  const bytes = await readRequestBytes(request, JSON_LIMIT)
  let body: unknown

  try {
    body = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
    )
  } catch {
    invalid('The request body must contain valid JSON.')
  }

  if (!isObject(body)) {
    invalid('The request body must be a JSON object.')
  }

  return body
}

export async function readAudioForm(request: Request): Promise<FormData> {
  const contentType = request.headers.get('Content-Type')

  if (!contentType || mediaType(request) !== 'multipart/form-data') {
    throw new ApiError(
      415,
      'Use multipart/form-data.',
      'invalid_request_error',
      'unsupported_media_type'
    )
  }

  const bytes = await readRequestBytes(request, AUDIO_LIMIT + 1024 * 1024)

  try {
    return await new Response(bytes, {
      headers: { 'Content-Type': contentType },
    }).formData()
  } catch {
    return invalid('Invalid multipart form data.')
  }
}

export function formString(form: FormData, name: string): string | undefined {
  const values = form.getAll(name)

  if (values.length > 1 || (values.length === 1 && typeof values[0] !== 'string')) {
    invalid('Expected a single text field.', name)
  }

  return values[0] as string | undefined
}

export function generationOptions(body: JsonObject): void {
  booleanValue(body.stream, 'stream')
  numberValue(body.max_tokens, 'max_tokens', 1, Number.MAX_SAFE_INTEGER, true)
  numberValue(
    body.max_completion_tokens,
    'max_completion_tokens',
    1,
    Number.MAX_SAFE_INTEGER,
    true
  )
  numberValue(body.temperature, 'temperature', 0, 2)
  numberValue(body.top_p, 'top_p', 0, 1)
  numberValue(body.presence_penalty, 'presence_penalty', -2, 2)
  numberValue(body.frequency_penalty, 'frequency_penalty', -2, 2)

  if (
    body.stop !== undefined &&
    body.stop !== null &&
    typeof body.stop !== 'string' &&
    !(
      Array.isArray(body.stop) &&
      body.stop.length <= 4 &&
      body.stop.every((value) => typeof value === 'string')
    )
  ) {
    invalid('Expected a string or up to four stop strings.', 'stop')
  }

  if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined) {
    invalid('Specify only one token limit.', 'max_completion_tokens')
  }
}
