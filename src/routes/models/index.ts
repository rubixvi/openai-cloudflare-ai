import { type Env } from '../../types'
import { ApiError } from '../../utils/errors'
import { modelList } from './handler'

export async function modelsHandler(request: Request, env: Env): Promise<Response> {
  return Response.json({ object: 'list', data: await modelList(request, env) })
}

export async function modelHandler(request: Request, env: Env): Promise<Response> {
  const pathname = new URL(request.url).pathname
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '')
  const encoded = pathname.replace(/^(?:\/v1)?\/models\//, '')

  let id: string

  try {
    id = decodeURIComponent(encoded)
  } catch {
    throw new ApiError(
      400,
      'Invalid model identifier.',
      'invalid_request_error',
      'invalid_parameter',
      'model'
    )
  }

  const model = (await modelList(request, env)).find((candidate) => candidate.id === id)

  if (!model) {
    throw new ApiError(
      404,
      'The model was not found in the available Workers AI catalog.',
      'invalid_request_error',
      'model_not_found',
      'model'
    )
  }

  return Response.json(model)
}
