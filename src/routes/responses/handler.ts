import { type Env, type ResponsesRequest } from '../../types'
import { upstreamError } from '../../utils/errors'
import { nativeRequest, readProviderJson, unwrapResult } from '../../utils/provider'
import { isObject } from '../../utils/validation'

export async function forwardResponses(
  request: Request,
  env: Env,
  body: ResponsesRequest,
  model: string
): Promise<Response> {
  const response = await nativeRequest(request, env, '/responses', {
    ...body,
    model,
    stream: false,
    store: false,
  })

  const result = unwrapResult(await readProviderJson(response))

  if (
    !isObject(result) ||
    result.object !== 'response' ||
    typeof result.id !== 'string' ||
    typeof result.created_at !== 'number' ||
    !Array.isArray(result.output)
  ) {
    upstreamError('The provider returned an invalid Responses object.')
  }

  return Response.json(result, { headers: response.headers })
}
