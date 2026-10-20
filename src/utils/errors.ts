import { type ApiErrorBody } from '../types'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type = 'invalid_request_error',
    readonly code: string | null = null,
    readonly param: string | null = null,
    readonly headers?: HeadersInit
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function invalid(message: string, param: string | null = null): never {
  throw new ApiError(400, message, 'invalid_request_error', 'invalid_parameter', param)
}

export function unsupported(
  param: string,
  message = 'This parameter is not supported by this provider.'
): never {
  throw new ApiError(
    400,
    message,
    'invalid_request_error',
    'unsupported_parameter',
    param
  )
}

export function errorResponse(error: unknown): Response {
  const failure =
    error instanceof ApiError
      ? error
      : new ApiError(
          500,
          'An internal server error occurred.',
          'server_error',
          'internal_error'
        )
  const body: ApiErrorBody = {
    error: {
      message: failure.message,
      type: failure.type,
      param: failure.param,
      code: failure.code,
    },
  }
  const headers = new Headers(failure.headers)

  headers.set('Content-Type', 'application/json')

  return Response.json(body, { status: failure.status, headers })
}

export function upstreamError(
  message = 'The inference provider returned an invalid response.'
): never {
  throw new ApiError(502, message, 'server_error', 'upstream_error')
}
