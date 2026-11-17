export const DEFAULT_MAX_TOKENS = 4096
export const CONTEXT_SAFETY_MARGIN = 128
export const MIN_FALLBACK_TOKENS = 256

export const CHAT_ROLES = new Set([
  'system',
  'developer',
  'user',
  'assistant',
  'tool',
  'function',
])

export const CONTEXT_WINDOW_ERROR =
  /estimated number of input and maximum output tokens \((\d+)\) exceeded this model context window limit \((\d+)\)/i
