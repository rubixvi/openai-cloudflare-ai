import { type AudioResult, type Env, type JsonObject } from '../types'
import {
  normalizeNova,
  normalizeWhisper,
  subtitleResponse,
  verboseResponse,
} from '../utils/audio'
import { uint8ArrayToBase64 } from '../utils/converters'
import { ApiError, invalid, unsupported, upstreamError } from '../utils/errors'
import { AUDIO_MODELS, resolveModel } from '../utils/models'
import {
  cloudflareRequest,
  readProviderJson,
  runModel,
  unwrapResult,
} from '../utils/provider'
import { AUDIO_LIMIT, formString, readAudioForm } from '../utils/validation'

const NOVA_MODEL = '@cf/deepgram/nova-3'
const TURBO_MODEL = '@cf/openai/whisper-large-v3-turbo'
const FORM_FIELDS = [
  'file',
  'model',
  'language',
  'prompt',
  'response_format',
  'temperature',
  'timestamp_granularities[]',
  'vad_filter',
] as const

function booleanForm(form: FormData, field: string): boolean | undefined {
  const value = formString(form, field)

  if (value === undefined) {
    return undefined
  }

  if (value !== 'true' && value !== 'false') {
    invalid('Use true or false.', field)
  }

  return value === 'true'
}

async function inferenceJson(value: unknown): Promise<unknown> {
  return unwrapResult(value instanceof Response ? await readProviderJson(value) : value)
}

async function transcribeWhisper(
  request: Request,
  env: Env,
  file: File,
  model: string,
  translate: boolean,
  language?: string,
  prompt?: string,
  vadFilter?: boolean
): Promise<AudioResult> {
  if (model !== TURBO_MODEL) {
    const response = await cloudflareRequest(request, env, `/run/${model}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: await file.arrayBuffer(),
    })

    return normalizeWhisper(await inferenceJson(response))
  }

  const input: JsonObject = {
    audio: uint8ArrayToBase64(new Uint8Array(await file.arrayBuffer())),
    task: translate ? 'translate' : 'transcribe',
  }

  if (language) {
    input.language = language.toLowerCase()
  }

  if (prompt !== undefined) {
    input.initial_prompt = prompt
  }

  if (vadFilter !== undefined) {
    input.vad_filter = vadFilter
  }

  return normalizeWhisper(await inferenceJson(await runModel(request, env, model, input)))
}

async function transcribeNova(
  request: Request,
  env: Env,
  file: File,
  language?: string
): Promise<AudioResult> {
  const input: JsonObject = {
    audio: {
      body: file.stream(),
      contentType: file.type || 'application/octet-stream',
    },
    detect_language: language === undefined,
  }

  if (language) {
    input.language = language
  }

  const output = await inferenceJson(await runModel(request, env, NOVA_MODEL, input))

  return normalizeNova(output, language)
}

async function audioHandler(
  request: Request,
  env: Env,
  translate: boolean
): Promise<Response> {
  const form = await readAudioForm(request)

  for (const [key] of form) {
    if (!FORM_FIELDS.includes(key as (typeof FORM_FIELDS)[number])) {
      unsupported(key)
    }
  }

  const files = form.getAll('file')
  const file = files[0]

  if (files.length !== 1 || !(file instanceof File) || file.size === 0) {
    invalid('Provide one non-empty audio file.', 'file')
  }

  if (file.size > AUDIO_LIMIT) {
    throw new ApiError(
      413,
      'The audio file must not exceed 25 MiB.',
      'invalid_request_error',
      'payload_too_large',
      'file'
    )
  }

  const model = resolveModel(env, formString(form, 'model'), 'audio')

  if (!AUDIO_MODELS.has(model)) {
    unsupported('model', 'Choose a supported transcription model from /v1/models.')
  }

  const turbo = model === TURBO_MODEL
  const nova = model === NOVA_MODEL

  if (translate && !turbo) {
    unsupported('model', 'Audio translation requires @cf/openai/whisper-large-v3-turbo.')
  }

  const format = formString(form, 'response_format') ?? 'json'

  if (!['json', 'text', 'verbose_json', 'srt', 'vtt'].includes(format)) {
    invalid('Use json, text, verbose_json, srt, or vtt.', 'response_format')
  }

  const language = formString(form, 'language')
  const prompt = formString(form, 'prompt')
  const temperature = formString(form, 'temperature')
  const vadFilter = booleanForm(form, 'vad_filter')

  if (translate && language !== undefined) {
    unsupported('language', 'The translations endpoint detects the source language.')
  }

  if (
    language !== undefined &&
    !(nova ? /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i : /^[a-z]{2}$/i).test(language)
  ) {
    invalid(
      nova ? 'Use a BCP-47 language tag.' : 'Use a two-letter ISO 639-1 language code.',
      'language'
    )
  }

  if (
    temperature !== undefined &&
    (!temperature.trim() ||
      !Number.isFinite(Number(temperature)) ||
      Number(temperature) !== 0)
  ) {
    unsupported(
      'temperature',
      'This adapter supports the provider default decoding only.'
    )
  }

  if (prompt !== undefined && (prompt.length > 2000 || !turbo)) {
    unsupported(
      'prompt',
      'Only Whisper Large v3 Turbo supports prompts up to 2000 characters.'
    )
  }

  if (!turbo && vadFilter !== undefined) {
    unsupported('vad_filter', 'Voice activity filtering requires Whisper Large v3 Turbo.')
  }

  if (
    model === '@cf/openai/whisper-tiny-en' &&
    language !== undefined &&
    language !== 'en'
  ) {
    unsupported('language', 'Whisper Tiny English accepts English audio only.')
  }

  if (!turbo && !nova && language !== undefined) {
    unsupported('language', 'Use Whisper Large v3 Turbo or Nova-3 for language control.')
  }

  if (!turbo && !nova && format === 'verbose_json') {
    unsupported(
      'response_format',
      'Verbose metadata requires Whisper Large v3 Turbo or Nova-3.'
    )
  }

  const granularities = form.getAll('timestamp_granularities[]')

  if (
    granularities.length > 2 ||
    new Set(granularities).size !== granularities.length ||
    !granularities.every((value) => value === 'word' || value === 'segment')
  ) {
    invalid(
      'Use distinct word or segment timestamp granularities.',
      'timestamp_granularities[]'
    )
  }

  if (granularities.length && (translate || format !== 'verbose_json')) {
    unsupported(
      'timestamp_granularities[]',
      'Timestamp granularities require transcription with verbose_json.'
    )
  }

  const result = nova
    ? await transcribeNova(request, env, file, language)
    : await transcribeWhisper(
        request,
        env,
        file,
        model,
        translate,
        language,
        prompt,
        vadFilter
      )

  if (format === 'json') {
    return Response.json({ text: result.text })
  }

  if (format === 'text') {
    return new Response(result.text, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  if (format === 'srt' || format === 'vtt') {
    return subtitleResponse(result, format)
  }

  if (format === 'verbose_json') {
    return verboseResponse(result, granularities as string[], translate, language)
  }

  return upstreamError('Unsupported transcription output format.')
}

export const transcriptionHandler = (request: Request, env: Env): Promise<Response> =>
  audioHandler(request, env, false)

export const translationHandler = (request: Request, env: Env): Promise<Response> =>
  audioHandler(request, env, true)
