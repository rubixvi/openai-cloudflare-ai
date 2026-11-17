import { type AudioResult, type Env, type JsonObject } from '../../types'
import { normalizeNova, normalizeWhisper } from '../../utils/audio'
import { uint8ArrayToBase64 } from '../../utils/converters'
import {
  cloudflareRequest,
  readProviderJson,
  runModel,
  unwrapResult,
} from '../../utils/provider'
import { NOVA_MODEL, TURBO_MODEL } from './constant'

type Options = {
  request: Request
  env: Env
  file: File
  model: string
  translate: boolean
  language?: string
  prompt?: string
  vadFilter?: boolean
}

async function inferenceJson(value: unknown): Promise<unknown> {
  return unwrapResult(value instanceof Response ? await readProviderJson(value) : value)
}

async function transcribeWhisper({
  request,
  env,
  file,
  model,
  translate,
  language,
  prompt,
  vadFilter,
}: Options): Promise<AudioResult> {
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

async function transcribeNova({
  request,
  env,
  file,
  language,
}: Options): Promise<AudioResult> {
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

export function transcribeAudio(options: Options): Promise<AudioResult> {
  return options.model === NOVA_MODEL
    ? transcribeNova(options)
    : transcribeWhisper(options)
}
