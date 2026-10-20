import { type AudioResult, type Env, type JsonObject, type TimedText } from '../types'
import { uint8ArrayToBase64 } from '../utils/converters'
import { ApiError, invalid, unsupported, upstreamError } from '../utils/errors'
import { AUDIO_MODELS, resolveModel } from '../utils/models'
import {
  cloudflareRequest,
  readProviderJson,
  runModel,
  unwrapResult,
} from '../utils/provider'
import { AUDIO_LIMIT, formString, isObject, readAudioForm } from '../utils/validation'

function timestamp(seconds: number, separator: string): string {
  const milliseconds = Math.round(seconds * 1000)

  return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}${separator}${String(milliseconds % 1000).padStart(3, '0')}`
}

function timedSegments(result: AudioResult): TimedText[] {
  const segments =
    result.segments ??
    result.words?.map((word) => ({
      start: word.start,
      end: word.end,
      text: word.word,
    }))

  if (!segments) {
    return []
  }

  return segments.map((segment) => {
    if (
      typeof segment.start !== 'number' ||
      !Number.isFinite(segment.start) ||
      segment.start < 0 ||
      typeof segment.end !== 'number' ||
      !Number.isFinite(segment.end) ||
      segment.end < segment.start ||
      typeof segment.text !== 'string'
    ) {
      upstreamError('The provider returned invalid subtitle timestamps.')
    }

    return { start: segment.start, end: segment.end, text: segment.text }
  })
}

async function audioHandler(
  request: Request,
  env: Env,
  translate: boolean
): Promise<Response> {
  const form = await readAudioForm(request)

  for (const [key] of form) {
    if (
      ![
        'file',
        'model',
        'language',
        'prompt',
        'response_format',
        'temperature',
        'timestamp_granularities[]',
      ].includes(key)
    ) {
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
    unsupported('model', 'Choose a supported Whisper model from /v1/models.')
  }

  const turbo = model === '@cf/openai/whisper-large-v3-turbo'

  if (translate && !turbo) {
    unsupported(
      'model',
      'Audio translation requires @cf/openai/whisper-large-v3-turbo, which exposes the translate task.'
    )
  }

  const format = formString(form, 'response_format') ?? 'json'

  if (!['json', 'text', 'verbose_json', 'srt', 'vtt'].includes(format)) {
    invalid('Use json, text, verbose_json, srt, or vtt.', 'response_format')
  }

  const language = formString(form, 'language')

  if (translate && language !== undefined) {
    unsupported(
      'language',
      'The translations endpoint automatically detects the source language.'
    )
  }

  if (language !== undefined && !/^[a-z]{2}$/i.test(language)) {
    invalid('Use a two-letter ISO 639-1 language code.', 'language')
  }

  const prompt = formString(form, 'prompt')
  const temperature = formString(form, 'temperature')

  if (
    temperature !== undefined &&
    (!temperature.trim() ||
      !Number.isFinite(Number(temperature)) ||
      Number(temperature) !== 0)
  ) {
    unsupported(
      'temperature',
      "This Whisper adapter supports the provider's default decoding only."
    )
  }

  if (!turbo && (language !== undefined || prompt !== undefined)) {
    unsupported(
      language !== undefined ? 'language' : 'prompt',
      'Use whisper-large-v3-turbo for language and prompt controls.'
    )
  }

  if (!turbo && format === 'verbose_json') {
    unsupported('response_format', 'Use whisper-large-v3-turbo for verbose metadata.')
  }

  const granularities = form.getAll('timestamp_granularities[]')

  if (!granularities.every((value) => value === 'word' || value === 'segment')) {
    invalid('Use word or segment timestamp granularity.', 'timestamp_granularities')
  }

  if (granularities.length && (translate || format !== 'verbose_json')) {
    unsupported(
      'timestamp_granularities',
      'Timestamp granularities require transcription with verbose_json.'
    )
  }

  let output: unknown

  if (turbo) {
    const options: JsonObject = {
      audio: uint8ArrayToBase64(new Uint8Array(await file.arrayBuffer())),
      task: translate ? 'translate' : 'transcribe',
    }

    if (language) {
      options.language = language.toLowerCase()
    }

    if (prompt !== undefined) {
      options.initial_prompt = prompt
    }

    output = await runModel(request, env, model, options)
  } else {
    const response = await cloudflareRequest(request, env, `/run/${model}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: await file.arrayBuffer(),
    })

    output = unwrapResult(await readProviderJson(response))
  }

  if (!isObject(output) || typeof output.text !== 'string') {
    upstreamError('The provider returned an invalid transcription.')
  }

  if (
    output.segments !== undefined &&
    (!Array.isArray(output.segments) || !output.segments.every(isObject))
  ) {
    upstreamError()
  }

  if (
    output.words !== undefined &&
    (!Array.isArray(output.words) || !output.words.every(isObject))
  ) {
    upstreamError()
  }

  if (output.transcription_info !== undefined && !isObject(output.transcription_info)) {
    upstreamError()
  }

  const result = output as unknown as AudioResult

  if (format === 'json') {
    return Response.json({ text: result.text })
  }

  if (format === 'text') {
    return new Response(result.text, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  if (format === 'vtt' || format === 'srt') {
    const segments = timedSegments(result)

    if (!segments.length && result.text.trim()) {
      if (
        format === 'vtt' &&
        typeof result.vtt === 'string' &&
        result.vtt.startsWith('WEBVTT')
      ) {
        return new Response(result.vtt, {
          headers: { 'Content-Type': 'text/vtt; charset=utf-8' },
        })
      }

      upstreamError('The provider did not return subtitle timestamps.')
    }

    const separator = format === 'srt' ? ',' : '.'
    const subtitles = segments
      .map(
        (segment, index) =>
          `${index + 1}\n${timestamp(segment.start, separator)} --> ${timestamp(segment.end, separator)}\n${segment.text.trim()}\n`
      )
      .join('\n')

    return new Response(`${format === 'vtt' ? 'WEBVTT\n\n' : ''}${subtitles}`, {
      headers: {
        'Content-Type':
          format === 'vtt'
            ? 'text/vtt; charset=utf-8'
            : 'application/x-subrip; charset=utf-8',
      },
    })
  }

  const info = result.transcription_info

  if (
    typeof info?.duration !== 'number' ||
    !Number.isFinite(info.duration) ||
    typeof info.language !== 'string'
  ) {
    upstreamError('The provider did not return verbose audio metadata.')
  }

  const segments = result.segments ?? []
  const words = segments.flatMap((segment) =>
    Array.isArray(segment.words) ? segment.words : []
  )
  const includeSegments = !granularities.length || granularities.includes('segment')

  if (granularities.includes('word') && !words.length && result.text.trim()) {
    unsupported(
      'timestamp_granularities',
      'The provider did not supply word timestamps for this result.'
    )
  }

  return Response.json({
    task: translate ? 'translate' : 'transcribe',
    language: translate ? 'english' : info.language,
    duration: info.duration,
    text: result.text,
    ...(includeSegments
      ? { segments: segments.map((segment, id) => ({ ...segment, id })) }
      : {}),
    ...(granularities.includes('word') ? { words } : {}),
  })
}

export const transcriptionHandler = (request: Request, env: Env): Promise<Response> =>
  audioHandler(request, env, false)

export const translationHandler = (request: Request, env: Env): Promise<Response> =>
  audioHandler(request, env, true)
