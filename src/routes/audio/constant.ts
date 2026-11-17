export const NOVA_MODEL = '@cf/deepgram/nova-3'
export const TURBO_MODEL = '@cf/openai/whisper-large-v3-turbo'

export const FORM_FIELDS = [
  'file',
  'model',
  'language',
  'prompt',
  'response_format',
  'temperature',
  'timestamp_granularities[]',
  'vad_filter',
] as const

export const RESPONSE_FORMATS = ['json', 'text', 'verbose_json', 'srt', 'vtt'] as const
