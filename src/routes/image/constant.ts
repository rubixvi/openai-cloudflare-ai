export const IMAGE_FIELDS = [
  'model',
  'prompt',
  'n',
  'response_format',
  'format',
  'size',
  'user',
] as const

export const IMAGE_FORMATS = ['url', 'b64_json'] as const

export const IMAGE_SIZE = /^(\d+)x(\d+)$/
export const IMAGE_NAME = /^[a-f0-9-]{36}\.(png|jpg|webp)$/

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024
export const MAX_IMAGE_LENGTH = 44 * 1024 * 1024
export const MAX_INLINE_BYTES = 24 * 1024 * 1024
