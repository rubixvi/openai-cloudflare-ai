export const MAX_SPEECH_INPUT_LENGTH = 2000

export const SPEECH_FIELDS = [
  'model',
  'input',
  'voice',
  'response_format',
  'speed',
] as const

export const AUDIO_FORMATS = {
  mp3: {
    encoding: 'mp3',
    container: 'none',
    contentType: 'audio/mpeg',
  },
  opus: {
    encoding: 'opus',
    container: 'ogg',
    contentType: 'audio/ogg',
  },
  aac: {
    encoding: 'aac',
    container: 'none',
    contentType: 'audio/aac',
  },
  flac: {
    encoding: 'flac',
    container: 'none',
    contentType: 'audio/flac',
  },
  wav: {
    encoding: 'linear16',
    container: 'wav',
    contentType: 'audio/wav',
  },
  pcm: {
    encoding: 'linear16',
    container: 'none',
    contentType: 'application/octet-stream',
  },
} as const

export type AudioFormat = keyof typeof AUDIO_FORMATS
