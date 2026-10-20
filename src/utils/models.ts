import { type Env, type ImageProfile, type ModelKind } from '../types'
import { ApiError, invalid } from './errors'
import { isObject, stringValue } from './validation'

const DEFAULTS: Record<ModelKind, string> = {
  chat: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  completion: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  responses: '@cf/openai/gpt-oss-120b',
  embedding: '@cf/baai/bge-base-en-v1.5',
  image: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
  audio: '@cf/openai/whisper-large-v3-turbo',
  speech: '@cf/deepgram/aura-2-en',
}

export const IMAGE_PROFILES: Record<string, ImageProfile> = {
  '@cf/stabilityai/stable-diffusion-xl-base-1.0': {
    input: 'json',
    parameters: ['negative_prompt', 'num_steps', 'guidance', 'seed', 'width', 'height'],
    maxPrompt: 2048,
    maxSteps: 20,
    dimensions: true,
  },
  '@cf/bytedance/stable-diffusion-xl-lightning': {
    input: 'json',
    parameters: ['negative_prompt', 'num_steps', 'guidance', 'seed', 'width', 'height'],
    maxPrompt: 2048,
    maxSteps: 20,
    dimensions: true,
  },
  '@cf/lykon/dreamshaper-8-lcm': {
    input: 'json',
    parameters: ['negative_prompt', 'num_steps', 'guidance', 'seed', 'width', 'height'],
    maxPrompt: 2048,
    maxSteps: 20,
    dimensions: true,
  },
  '@cf/black-forest-labs/flux-1-schnell': {
    input: 'json',
    parameters: ['steps', 'seed'],
    maxPrompt: 2048,
    maxSteps: 8,
  },
  '@cf/black-forest-labs/flux-2-dev': {
    input: 'multipart',
    parameters: ['width', 'height', 'seed'],
    maxPrompt: 32000,
    dimensions: true,
  },
  '@cf/black-forest-labs/flux-2-klein-4b': {
    input: 'multipart',
    parameters: ['width', 'height', 'seed'],
    maxPrompt: 32000,
    dimensions: true,
  },
  '@cf/black-forest-labs/flux-2-klein-9b': {
    input: 'multipart',
    parameters: ['width', 'height', 'seed'],
    maxPrompt: 32000,
    dimensions: true,
  },
}

export const AUDIO_MODELS = new Set([
  '@cf/openai/whisper',
  '@cf/openai/whisper-large-v3-turbo',
  '@cf/openai/whisper-tiny-en',
])

export const SPEECH_VOICES: Record<string, readonly string[]> = {
  '@cf/deepgram/aura-1': [
    'angus',
    'asteria',
    'arcas',
    'orion',
    'orpheus',
    'athena',
    'luna',
    'zeus',
    'perseus',
    'helios',
    'hera',
    'stella',
  ],
  '@cf/deepgram/aura-2-en': [
    'amalthea',
    'andromeda',
    'apollo',
    'arcas',
    'aries',
    'asteria',
    'athena',
    'atlas',
    'aurora',
    'callista',
    'cora',
    'cordelia',
    'delia',
    'draco',
    'electra',
    'harmonia',
    'helena',
    'hera',
    'hermes',
    'hyperion',
    'iris',
    'janus',
    'juno',
    'jupiter',
    'luna',
    'mars',
    'minerva',
    'neptune',
    'odysseus',
    'ophelia',
    'orion',
    'orpheus',
    'pandora',
    'phoebe',
    'pluto',
    'saturn',
    'thalia',
    'theia',
    'vesta',
    'zeus',
  ],
  '@cf/deepgram/aura-2-es': [
    'sirio',
    'nestor',
    'carina',
    'celeste',
    'alvaro',
    'diana',
    'aquila',
    'selena',
    'estrella',
    'javier',
  ],
}

export const SPEECH_MODELS = new Set(Object.keys(SPEECH_VOICES))

export const RESPONSES_MODELS = new Set([
  '@cf/openai/gpt-oss-120b',
  '@cf/openai/gpt-oss-20b',
])

export function modelMapper(env: Env): Record<string, string> {
  let mapper: unknown = env.MODEL_MAPPER ?? {}

  if (typeof mapper === 'string') {
    try {
      mapper = JSON.parse(mapper)
    } catch {
      throw new ApiError(
        503,
        'MODEL_MAPPER must contain a JSON object of model aliases.',
        'server_error',
        'invalid_configuration'
      )
    }
  }

  if (
    !isObject(mapper) ||
    !Object.values(mapper).every(
      (value) => typeof value === 'string' && /^@(cf|hf)\/[\w.-]+\/[\w./-]+$/.test(value)
    )
  ) {
    throw new ApiError(
      503,
      'MODEL_MAPPER must map aliases to Workers AI model IDs.',
      'server_error',
      'invalid_configuration'
    )
  }

  return mapper as Record<string, string>
}

export function resolveModel(env: Env, requested: unknown, kind: ModelKind): string {
  const value =
    requested === undefined ? undefined : stringValue(requested, 'model', true)
  const configured: Record<ModelKind, string | undefined> = {
    chat: env.DEFAULT_CHAT_MODEL,
    completion: env.DEFAULT_COMPLETION_MODEL ?? env.DEFAULT_CHAT_MODEL,
    responses: env.DEFAULT_RESPONSES_MODEL,
    embedding: env.DEFAULT_EMBEDDING_MODEL,
    image: env.DEFAULT_IMAGE_MODEL,
    audio: env.DEFAULT_AUDIO_MODEL,
    speech: env.DEFAULT_SPEECH_MODEL,
  }
  const selected = value ?? configured[kind] ?? DEFAULTS[kind]
  const mapper = modelMapper(env)
  const model = Object.hasOwn(mapper, selected)
    ? (mapper[selected] ?? selected)
    : selected

  if (!/^@(cf|hf)\/[\w.-]+\/[\w./-]+$/.test(model) || model.includes('..')) {
    invalid(
      'Use a Workers AI model ID or a configured MODEL_MAPPER alias. OpenAI-hosted model IDs are not Cloudflare models.',
      'model'
    )
  }

  return model
}
