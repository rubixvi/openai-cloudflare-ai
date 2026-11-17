import { type Env, type SpeechRequest } from '../types'
import { invalid, unsupported, upstreamError } from '../utils/errors'
import { resolveModel, SPEECH_VOICES } from '../utils/models'
import { runModel } from '../utils/provider'
import { allowedFields, readJson, stringValue } from '../utils/validation'

const AUDIO_FORMATS = {
  mp3: { encoding: 'mp3', container: 'none', contentType: 'audio/mpeg' },
  opus: { encoding: 'opus', container: 'ogg', contentType: 'audio/ogg' },
  aac: { encoding: 'aac', container: 'none', contentType: 'audio/aac' },
  flac: { encoding: 'flac', container: 'none', contentType: 'audio/flac' },
  wav: { encoding: 'linear16', container: 'wav', contentType: 'audio/wav' },
  pcm: {
    encoding: 'linear16',
    container: 'none',
    contentType: 'application/octet-stream',
  },
} as const

export async function speechHandler(request: Request, env: Env): Promise<Response> {
  const input = await readJson(request)

  allowedFields(input, ['model', 'input', 'voice', 'response_format', 'speed'])

  const text = stringValue(input.input, 'input', true)

  if (text.length > 2000) {
    invalid('Speech input must not exceed 2000 characters.', 'input')
  }

  const voice = stringValue(input.voice, 'voice', true)

  if (input.speed !== undefined && input.speed !== 1) {
    unsupported('speed', "Aura does not expose OpenAI's speed control.")
  }

  const model = resolveModel(env, input.model, 'speech')
  const voices = Object.hasOwn(SPEECH_VOICES, model) ? SPEECH_VOICES[model] : undefined

  if (!voices) {
    unsupported('model', 'Choose a supported Aura speech model from /v1/models.')
  }

  if (!voices.includes(voice)) {
    invalid(
      'Use a speaker supported by the selected Aura model. ' +
        'OpenAI voice names are not mapped.',
      'voice'
    )
  }

  const format = input.response_format ?? 'mp3'

  if (typeof format !== 'string' || !Object.hasOwn(AUDIO_FORMATS, format)) {
    invalid('Use mp3, opus, aac, flac, wav, or pcm.', 'response_format')
  }

  const settings = AUDIO_FORMATS[format as NonNullable<SpeechRequest['response_format']>]
  const result = await runModel(
    request,
    env,
    model,
    {
      text,
      speaker: voice,
      encoding: settings.encoding,
      container: settings.container,
      ...(format === 'pcm' ? { sample_rate: 24000 } : {}),
    },
    true
  )

  if (result instanceof Response) {
    const type = result.headers.get('Content-Type') ?? ''

    if (type.includes('json') || type.includes('text/')) {
      await result.body?.cancel()
      upstreamError('The provider returned JSON or text instead of speech audio.')
    }

    if (!result.body) {
      upstreamError('The provider returned no speech audio.')
    }

    const headers = new Headers(result.headers)

    if (!type.startsWith('audio/') || type === 'application/octet-stream') {
      headers.set('Content-Type', settings.contentType)
    }

    return new Response(result.body, { headers })
  }

  if (result instanceof ReadableStream) {
    return new Response(result, {
      headers: { 'Content-Type': settings.contentType },
    })
  }

  if (result instanceof Uint8Array || result instanceof ArrayBuffer) {
    return new Response(result, {
      headers: { 'Content-Type': settings.contentType },
    })
  }

  return upstreamError('The provider returned unsupported speech audio.')
}
