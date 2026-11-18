import { type Env } from '../../types'
import { invalid, unsupported } from '../../utils/errors'
import { resolveModel, SPEECH_VOICES } from '../../utils/models'
import { allowedFields, readJson, stringValue } from '../../utils/validation'
import {
  AUDIO_FORMATS,
  type AudioFormat,
  MAX_SPEECH_INPUT_LENGTH,
  SPEECH_FIELDS,
} from './constant'
import { forwardSpeech } from './handler'

export async function speechHandler(request: Request, env: Env): Promise<Response> {
  const input = await readJson(request)

  allowedFields(input, SPEECH_FIELDS)

  const text = stringValue(input.input, 'input', true)

  if (text.length > MAX_SPEECH_INPUT_LENGTH) {
    invalid(
      `Speech input must not exceed ${MAX_SPEECH_INPUT_LENGTH} characters.`,
      'input'
    )
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

  return forwardSpeech(request, env, {
    model,
    text,
    voice,
    format: format as AudioFormat,
  })
}
