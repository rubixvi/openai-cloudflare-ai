import { type AudioResult, type JsonObject, type TimedText } from '../types'
import { upstreamError } from './errors'
import { isObject } from './validation'

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function timedText(value: unknown, textKey: 'text' | 'word'): TimedText {
  if (
    !isObject(value) ||
    !isTimestamp(value.start) ||
    !isTimestamp(value.end) ||
    value.end < value.start ||
    typeof value[textKey] !== 'string'
  ) {
    upstreamError('The provider returned invalid audio timestamps.')
  }

  return { start: value.start, end: value.end, text: value[textKey] as string }
}

function formatTimestamp(seconds: number, separator: ',' | '.'): string {
  const milliseconds = Math.round(seconds * 1000)
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor(milliseconds / 60_000) % 60
  const secs = Math.floor(milliseconds / 1000) % 60
  const millis = milliseconds % 1000

  const clock = [hours, minutes, secs].map((value) => String(value).padStart(2, '0'))

  return `${clock.join(':')}${separator}${String(millis).padStart(3, '0')}`
}

export function normalizeWhisper(value: unknown): AudioResult {
  if (!isObject(value) || typeof value.text !== 'string') {
    upstreamError('The provider returned an invalid transcription.')
  }

  if (value.segments !== undefined && !Array.isArray(value.segments)) {
    upstreamError('The provider returned invalid transcription segments.')
  }

  if (value.words !== undefined && !Array.isArray(value.words)) {
    upstreamError('The provider returned invalid transcription words.')
  }

  if (value.transcription_info !== undefined && !isObject(value.transcription_info)) {
    upstreamError('The provider returned invalid transcription metadata.')
  }

  const segments = (value.segments as unknown[] | undefined)?.map((segment) => {
    const time = timedText(segment, 'text')
    const original = segment as JsonObject

    if (original.words !== undefined && !Array.isArray(original.words)) {
      upstreamError('The provider returned invalid word timestamps.')
    }

    return {
      ...original,
      ...time,
      ...(Array.isArray(original.words)
        ? {
            words: original.words.map((word) => {
              const time = timedText(word, 'word')

              return { start: time.start, end: time.end, word: time.text }
            }),
          }
        : {}),
    }
  })

  const words = (value.words as unknown[] | undefined)?.map((word) => {
    const time = timedText(word, 'word')

    return { start: time.start, end: time.end, word: time.text }
  })

  const info = value.transcription_info

  if (
    info !== undefined &&
    ((info.language !== undefined && typeof info.language !== 'string') ||
      (info.duration !== undefined && !isTimestamp(info.duration)))
  ) {
    upstreamError('The provider returned invalid transcription metadata.')
  }

  return {
    text: value.text,
    ...(segments ? { segments } : {}),
    ...(words ? { words } : {}),
    ...(info
      ? {
          transcription_info: {
            ...(typeof info.language === 'string' ? { language: info.language } : {}),
            ...(typeof info.duration === 'number' ? { duration: info.duration } : {}),
          },
        }
      : {}),
    ...(typeof value.vtt === 'string' ? { vtt: value.vtt } : {}),
  }
}

function groupWords(words: AudioResult['words']): TimedText[] {
  if (!words?.length) {
    return []
  }

  const segments: TimedText[] = []

  let current: TimedText | undefined

  for (const word of words) {
    const next = { ...timedText(word, 'word') }
    const text = next.text.trim()

    if (!text) {
      continue
    }

    if (
      current &&
      (next.start - current.end > 0.7 ||
        next.end - current.start > 8 ||
        current.text.length + text.length > 85)
    ) {
      segments.push(current)
      current = undefined
    }

    if (!current) {
      current = { start: next.start, end: next.end, text }
    } else {
      current.end = next.end
      current.text += /^[.,!?;:]/.test(text) ? text : ` ${text}`
    }

    if (/[.!?]$/.test(text)) {
      segments.push(current)
      current = undefined
    }
  }

  if (current) {
    segments.push(current)
  }

  return segments
}

export function normalizeNova(value: unknown, requestedLanguage?: string): AudioResult {
  if (
    !isObject(value) ||
    !isObject(value.results) ||
    !Array.isArray(value.results.channels)
  ) {
    upstreamError('The provider returned invalid Nova-3 transcription data.')
  }

  const alternatives = value.results.channels.map((channel: unknown) => {
    if (!isObject(channel) || !Array.isArray(channel.alternatives)) {
      upstreamError('The provider returned invalid Nova-3 channels.')
    }

    const alternative = channel.alternatives[0]

    if (!isObject(alternative) || typeof alternative.transcript !== 'string') {
      upstreamError('The provider returned no Nova-3 transcript.')
    }

    if (alternative.words !== undefined && !Array.isArray(alternative.words)) {
      upstreamError('The provider returned invalid Nova-3 word timestamps.')
    }

    const words = (alternative.words as unknown[] | undefined)?.map((word) => {
      const time = timedText(word, 'word')

      return { start: time.start, end: time.end, word: time.text }
    })

    return { text: alternative.transcript, words: words ?? [] }
  })

  const words = alternatives.flatMap((alternative) => alternative.words)
  const segments = groupWords(words)
  const text = alternatives
    .map((alternative) => alternative.text)
    .filter(Boolean)
    .join('\n')
  const metadata = isObject(value.metadata) ? value.metadata : undefined
  const duration = isTimestamp(metadata?.duration)
    ? metadata.duration
    : words.length
      ? words.reduce((max, word) => Math.max(max, word.end), 0)
      : undefined
  const detectedLanguage = value.results.channels.find(
    (channel: unknown) =>
      isObject(channel) && typeof channel.detected_language === 'string'
  )
  const language =
    (typeof metadata?.language === 'string' ? metadata.language : undefined) ??
    (isObject(detectedLanguage)
      ? (detectedLanguage.detected_language as string)
      : undefined) ??
    requestedLanguage

  return {
    text,
    segments,
    words,
    ...(duration !== undefined && language
      ? { transcription_info: { duration, language } }
      : {}),
  }
}

export function audioSegments(result: AudioResult): TimedText[] {
  if (result.segments?.length) {
    return result.segments.map((segment) => timedText(segment, 'text'))
  }

  return groupWords(result.words)
}

export function subtitleResponse(result: AudioResult, format: 'srt' | 'vtt'): Response {
  const segments = audioSegments(result)

  if (!segments.length && result.text.trim()) {
    if (format === 'vtt' && result.vtt?.startsWith('WEBVTT')) {
      return new Response(result.vtt, {
        headers: { 'Content-Type': 'text/vtt; charset=utf-8' },
      })
    }

    upstreamError('The provider did not return subtitle timestamps.')
  }

  const separator = format === 'srt' ? ',' : '.'
  const subtitles = segments
    .map((segment, index) => {
      const start = formatTimestamp(segment.start, separator)
      const end = formatTimestamp(segment.end, separator)
      const range = `${start} --> ${end}`
      const number = format === 'srt' ? `${index + 1}\n` : ''

      return `${number}${range}\n${segment.text.trim()}`
    })
    .join('\n\n')

  const prefix = format === 'vtt' ? 'WEBVTT\n\n' : ''
  const content = `${prefix}${subtitles}${subtitles ? '\n' : ''}`
  const contentType =
    format === 'vtt' ? 'text/vtt; charset=utf-8' : 'application/x-subrip; charset=utf-8'

  return new Response(content, {
    headers: { 'Content-Type': contentType },
  })
}

export function verboseResponse(
  result: AudioResult,
  granularity: readonly string[],
  translate: boolean,
  language?: string
): Response {
  const info = result.transcription_info
  const words =
    result.words ??
    result.segments?.flatMap((segment) =>
      Array.isArray(segment.words) ? segment.words : []
    ) ??
    []
  const segments = result.segments?.length ? result.segments : audioSegments(result)
  const includeSegments = !granularity.length || granularity.includes('segment')

  if (granularity.includes('word') && !words.length && result.text.trim()) {
    upstreamError('The provider did not return word timestamps.')
  }

  if (
    !info ||
    !isTimestamp(info.duration) ||
    typeof (info.language || language) !== 'string'
  ) {
    upstreamError('The provider did not return complete verbose audio metadata.')
  }

  return Response.json({
    task: translate ? 'translate' : 'transcribe',
    language: translate ? 'english' : info.language || language,
    duration: info.duration,
    text: result.text,
    ...(includeSegments
      ? { segments: segments.map((segment, id) => ({ id, ...segment })) }
      : {}),
    ...(granularity.includes('word') ? { words } : {}),
  })
}
