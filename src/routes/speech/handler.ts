import { type Env } from '../../types'
import { upstreamError } from '../../utils/errors'
import { runModel } from '../../utils/provider'
import { AUDIO_FORMATS, type AudioFormat } from './constant'

type Options = {
  model: string
  text: string
  voice: string
  format: AudioFormat
}

function speechResponse(result: unknown, contentType: string): Response {
  if (result instanceof Response) {
    const type = result.headers.get('Content-Type') ?? ''

    if (type.includes('json') || type.includes('text/')) {
      void result.body?.cancel()
      upstreamError('The provider returned JSON or text instead of speech audio.')
    }

    if (!result.body) {
      upstreamError('The provider returned no speech audio.')
    }

    const headers = new Headers(result.headers)

    if (!type.startsWith('audio/') || type === 'application/octet-stream') {
      headers.set('Content-Type', contentType)
    }

    return new Response(result.body, { headers })
  }

  if (result instanceof ReadableStream) {
    return new Response(result, {
      headers: { 'Content-Type': contentType },
    })
  }

  if (result instanceof Uint8Array || result instanceof ArrayBuffer) {
    return new Response(result, {
      headers: { 'Content-Type': contentType },
    })
  }

  return upstreamError('The provider returned unsupported speech audio.')
}

export async function forwardSpeech(
  request: Request,
  env: Env,
  { model, text, voice, format }: Options
): Promise<Response> {
  const settings = AUDIO_FORMATS[format]

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

  return speechResponse(result, settings.contentType)
}
