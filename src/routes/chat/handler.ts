import { type ChatRequest, type Env } from '../../types'
import { ApiError } from '../../utils/errors'
import { resolveModel } from '../../utils/models'
import { nativeRequest } from '../../utils/provider'
import {
  CONTEXT_SAFETY_MARGIN,
  CONTEXT_WINDOW_ERROR,
  DEFAULT_MAX_TOKENS,
  MIN_FALLBACK_TOKENS,
} from './constant'

export async function forwardChat(
  request: Request,
  env: Env,
  body: ChatRequest
): Promise<Response> {
  const { max_completion_tokens, ...options } = body

  const limit = body.max_tokens ?? max_completion_tokens
  const maxTokens = typeof limit === 'number' ? limit : DEFAULT_MAX_TOKENS

  const payload = {
    ...options,
    model: resolveModel(env, body.model, 'chat'),
    max_tokens: maxTokens,
  }

  try {
    return await nativeRequest(request, env, '/chat/completions', payload)
  } catch (error) {
    if (
      limit !== undefined ||
      !(error instanceof ApiError) ||
      ![400, 413].includes(error.status)
    ) {
      throw error
    }

    const match = CONTEXT_WINDOW_ERROR.exec(error.message)

    if (!match) {
      throw error
    }

    const total = Number(match[1])
    const window = Number(match[2])

    const retryLimit = maxTokens - (total - window) - CONTEXT_SAFETY_MARGIN

    if (
      !Number.isSafeInteger(retryLimit) ||
      retryLimit < MIN_FALLBACK_TOKENS ||
      retryLimit >= maxTokens
    ) {
      throw error
    }

    console.warn('Adjusting output tokens for model context window.', {
      model: payload.model,
      previousLimit: maxTokens,
      adjustedLimit: retryLimit,
    })

    return nativeRequest(request, env, '/chat/completions', {
      ...payload,
      max_tokens: retryLimit,
    })
  }
}
