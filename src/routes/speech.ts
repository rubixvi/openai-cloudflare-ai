import { type Env, type SpeechRequest } from '../types'
import { invalid, unsupported, upstreamError } from '../utils/errors'
import { resolveModel, SPEECH_VOICES } from '../utils/models'
import { runModel } from '../utils/provider'
import { allowedFields, readJson, stringValue } from '../utils/validation'

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
    unsupported('model', 'Choose an Aura speech model from /v1/models.')
  }

  if (!voices.includes(voice)) {
    invalid(
      'Use a speaker name supported by the selected Aura model. OpenAI voice names are not automatically mapped.',
      'voice'
    )
  }

  const format = input.response_format ?? 'mp3'
  const formats = {
    mp3: { encoding: 'mp3', container: 'none', type: 'audio/mpeg' },
    opus: { encoding: 'opus', container: 'ogg', type: 'audio/ogg' },
    aac: { encoding: 'aac', container: 'none', type: 'audio/aac' },
    flac: { encoding: 'flac', container: 'none', type: 'audio/flac' },
    wav: { encoding: 'linear16', container: 'wav', type: 'audio/wav' },
    pcm: { encoding: 'linear16', container: 'none', type: 'audio/pcm' },
  }

  if (typeof format !== 'string' || !Object.hasOwn(formats, format)) {
    invalid('Use mp3, opus, aac, flac, wav, or pcm.', 'response_format')
  }

  const settings = formats[format as NonNullable<SpeechRequest['response_format']>]
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

  if (!(result instanceof Response)) {
    return upstreamError('The provider returned unsupported speech audio.')
  }

  if ((result.headers.get('Content-Type') ?? '').includes('application/json')) {
    await result.body?.cancel()

    return upstreamError('The provider returned JSON instead of speech audio.')
  }

  const headers = new Headers(result.headers)

  if (!headers.get('Content-Type')?.startsWith('audio/')) {
    headers.set('Content-Type', settings.type)
  }

  return new Response(result.body, { headers })
}
