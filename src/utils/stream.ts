import { type StreamEvent } from '../types'
import { ApiError, upstreamError } from './errors'

export async function streamToBuffer(
  stream: ReadableStream<Uint8Array>,
  limit = 32 * 1024 * 1024,
  status = 502
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  let length = 0

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      length += value.byteLength

      if (length > limit) {
        await reader.cancel('Body size limit exceeded.').catch(() => {})

        throw new ApiError(
          status,
          'Body size limit exceeded.',
          status === 413 ? 'invalid_request_error' : 'server_error',
          'payload_too_large'
        )
      }

      chunks.push(value)
    }

    const result = new Uint8Array(length)
    let offset = 0

    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }

    return result
  } finally {
    reader.releaseLock()
  }
}

export async function* readSse(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<StreamEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  let eventLength = 0
  let event: string | undefined
  let finished = false

  function line(value: string): StreamEvent | undefined {
    if (!value) {
      if (!data.length) {
        event = undefined

        return
      }

      const result: StreamEvent = {
        data: data.join('\n'),
        ...(event ? { event } : {}),
      }

      data = []
      eventLength = 0
      event = undefined

      return result
    }

    if (value.startsWith('data:')) {
      eventLength += value.length

      if (eventLength > 2 * 1024 * 1024) {
        upstreamError('Provider stream event is too large.')
      }

      data.push(value.slice(5).replace(/^ /, ''))
    } else if (value.startsWith('event:')) {
      event = value.slice(6).trim()
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()

      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })

      if (buffer.length > 2 * 1024 * 1024) {
        upstreamError('Provider stream event is too large.')
      }

      while (true) {
        const index = buffer.search(/[\r\n]/)

        if (index === -1) {
          break
        }

        if (buffer[index] === '\r' && index === buffer.length - 1 && !done) {
          break
        }

        const width = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1
        const parsed = line(buffer.slice(0, index))

        buffer = buffer.slice(index + width)

        if (parsed) {
          yield parsed
        }
      }

      if (done) {
        if (buffer) {
          line(buffer)
        }

        const tail = line('')

        if (tail) {
          yield tail
        }

        finished = true

        break
      }
    }
  } finally {
    if (!finished) {
      await reader.cancel().catch(() => {})
    }

    reader.releaseLock()
  }
}

export function eventStream(
  events: AsyncGenerator<string>,
  onCancel?: () => void
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next()

        if (next.done) {
          controller.close()
        } else {
          controller.enqueue(encoder.encode(next.value))
        }
      } catch (error) {
        controller.error(error)
      }
    },

    async cancel() {
      onCancel?.()
      await events.return(undefined)
    },
  })
}
