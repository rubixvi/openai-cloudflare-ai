export interface Env {
  ACCESS_TOKEN: string
  AI: Ai
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_API_TOKEN: string
  DEFAULT_AUDIO_MODEL?: string
  DEFAULT_CHAT_MODEL?: string
  DEFAULT_COMPLETION_MODEL?: string
  DEFAULT_EMBEDDING_MODEL?: string
  DEFAULT_IMAGE_MODEL?: string
  DEFAULT_RESPONSES_MODEL?: string
  DEFAULT_SPEECH_MODEL?: string
  IMAGE_BUCKET?: R2Bucket
  MODEL_MAPPER?: Record<string, string> | string
}

export type JsonObject = Record<string, unknown>

export type ModelKind =
  | 'chat'
  | 'completion'
  | 'responses'
  | 'embedding'
  | 'image'
  | 'audio'
  | 'speech'

export type RouteHandler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext
) => Response | Promise<Response>

export interface Route {
  auth?: boolean
  handler: RouteHandler
  method: 'GET' | 'POST'
  path: RegExp
}

export interface ApiErrorBody {
  error: {
    message: string
    type: string
    param: string | null
    code: string | null
  }
}

export interface CloudflareModel {
  created_at?: string
  name: string
  task?: { name?: string }
}

export interface OpenAIModel {
  created: number
  id: string
  object: 'model'
  owned_by: string
}

export interface ChatMessage extends JsonObject {
  content?: string | JsonObject[] | null
  role: 'developer' | 'system' | 'user' | 'assistant' | 'tool' | 'function'
}

export interface ChatRequest extends JsonObject {
  messages: ChatMessage[]
  model?: string
  stream?: boolean
}

export interface CompletionRequest extends JsonObject {
  model?: string
  prompt: string
  stream?: boolean
}

export interface EmbeddingsRequest extends JsonObject {
  encoding_format?: 'float' | 'base64'
  input: string | string[]
  model?: string
}

export interface ResponsesRequest extends JsonObject {
  input: string | JsonObject[]
  model?: string
  stream?: boolean
}

export interface ImageRequest extends JsonObject {
  format?: 'url' | 'b64_json'
  model?: string
  n?: number
  prompt: string
  response_format?: 'url' | 'b64_json'
  size?: string
}

export interface ImageData {
  b64_json?: string
  url?: string
}

export interface SpeechRequest extends JsonObject {
  input: string
  model?: string
  response_format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'
  voice: string
}

export interface TimedText {
  end: number
  start: number
  text: string
}

export interface AudioResult {
  segments?: Array<Partial<TimedText> & JsonObject>
  text: string
  transcription_info?: { language?: string; duration?: number }
  vtt?: string
  word_count?: number
  words?: Array<{ word: string; start: number; end: number }>
}

export interface GenerationResult {
  finishReason: string
  text: string
  usage?: JsonObject
}

export interface StreamEvent {
  data: string
  event?: string
}

export interface ImageProfile {
  dimensions?: boolean
  input: 'json' | 'multipart'
  maxPrompt: number
  maxSteps?: number
  parameters: readonly string[]
}

export interface ProviderOperation {
  abort(): void
  dispose(): void
  failure(error: unknown): Error
  signal: AbortSignal
}

export interface ModelCacheEntry {
  account: string
  expires: number
  models: CloudflareModel[]
  token: string
}
