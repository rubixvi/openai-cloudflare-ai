import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { default: worker } = require('../.test-dist/index.js')

const TURBO = '@cf/openai/whisper-large-v3-turbo'
const NOVA = '@cf/deepgram/nova-3'
const AURA = '@cf/deepgram/aura-2-en'

function environment(run) {
  return {
    ACCESS_TOKEN: 'test-secret',
    AI: { run },
    MODEL_MAPPER: JSON.stringify({ 'whisper-1': TURBO }),
  }
}

function audioRequest(path, fields = {}) {
  const form = new FormData()

  form.set(
    'file',
    new File([new Uint8Array([82, 73, 70, 70])], 'sample.wav', {
      type: 'audio/wav',
    })
  )

  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        form.append(key, entry)
      }
    } else {
      form.set(key, String(value))
    }
  }

  return new Request(`https://api.example${path}`, {
    method: 'POST',
    body: form,
    headers: { Authorization: 'Bearer test-secret' },
  })
}

function speechRequest(body) {
  return new Request('https://api.example/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

const whisper = {
  text: 'Testing one two.',
  transcription_info: { language: 'en', duration: 2.5 },
  segments: [
    {
      start: 0.1,
      end: 2.3,
      text: 'Testing one two.',
      avg_logprob: -0.1,
      words: [
        { start: 0.1, end: 0.8, word: 'Testing' },
        { start: 0.9, end: 1.4, word: 'one' },
        { start: 1.5, end: 2.3, word: 'two.' },
      ],
    },
  ],
}

const nova = {
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'Testing one two.',
            words: [
              { start: 0.1, end: 0.6, word: 'Testing' },
              { start: 0.7, end: 1.2, word: 'one' },
              { start: 1.3, end: 2.1, word: 'two.' },
            ],
          },
        ],
      },
    ],
  },
  metadata: { duration: 2.5, language: 'en' },
}

test('Whisper STT works with standard and alias routes', async () => {
  let seenModel
  let seenInput
  const env = environment(async (model, input) => {
    seenModel = model
    seenInput = input
    return whisper
  })

  const response = await worker.fetch(
    audioRequest('/v1/audio/transcriptions', { model: 'whisper-1' }),
    env,
    {}
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { text: whisper.text })
  assert.equal(seenModel, TURBO)
  assert.equal(seenInput.task, 'transcribe')
  assert.equal(typeof seenInput.audio, 'string')
  assert.ok(response.headers.get('X-Request-Id'))

  const unversioned = await worker.fetch(audioRequest('/audio/transcriptions'), env, {})
  assert.equal(unversioned.status, 200)
})

test('Whisper verbose JSON includes segment and word timestamps', async () => {
  const env = environment(
    async () =>
      new Response(JSON.stringify({ result: whisper }), {
        headers: { 'Content-Type': 'application/json' },
      })
  )

  const response = await worker.fetch(
    audioRequest('/v1/audio/transcriptions', {
      response_format: 'verbose_json',
      'timestamp_granularities[]': ['word', 'segment'],
      vad_filter: 'true',
    }),
    env,
    {}
  )

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.duration, 2.5)
  assert.equal(body.language, 'en')
  assert.equal(body.words.length, 3)
  assert.equal(body.segments[0].avg_logprob, -0.1)
})

test('Whisper WebVTT and SRT subtitles use correct timestamps', async () => {
  const env = environment(async () => whisper)
  const vtt = await worker.fetch(
    audioRequest('/audio/transcriptions', {
      response_format: 'vtt',
    }),
    env,
    {}
  )
  const srt = await worker.fetch(
    audioRequest('/audio/transcriptions', {
      response_format: 'srt',
    }),
    env,
    {}
  )

  assert.equal(vtt.status, 200)
  assert.match(await vtt.text(), /^WEBVTT\n\n00:00:00\.100 --> 00:00:02\.300\n/)
  assert.match(await srt.text(), /^1\n00:00:00,100 --> 00:00:02,300\n/)
})

test('Whisper translation selects the translate task', async () => {
  let task
  const env = environment(async (_, input) => {
    task = input.task
    return whisper
  })
  const response = await worker.fetch(audioRequest('/audio/translations'), env, {})

  assert.equal(response.status, 200)
  assert.equal(task, 'translate')
  assert.deepEqual(await response.json(), { text: whisper.text })
})

test('Nova-3 STT sends an audio stream and normalizes output', async () => {
  let submitted
  const env = environment(async (model, input) => {
    assert.equal(model, NOVA)
    submitted = input
    assert.equal(input.audio.contentType, 'audio/wav')
    assert.ok(input.audio.body instanceof ReadableStream)
    assert.ok((await new Response(input.audio.body).arrayBuffer()).byteLength > 0)
    return nova
  })

  const response = await worker.fetch(
    audioRequest('/v1/audio/transcriptions', {
      model: NOVA,
      language: 'en-AU',
      response_format: 'verbose_json',
      'timestamp_granularities[]': 'word',
    }),
    env,
    {}
  )

  assert.equal(response.status, 200)
  assert.equal(submitted.language, 'en-AU')
  assert.equal(submitted.detect_language, false)
  const body = await response.json()
  assert.equal(body.text, 'Testing one two.')
  assert.equal(body.words.length, 3)
  assert.equal(body.duration, 2.5)
  assert.equal(body.language, 'en')
  assert.equal(body.segments, undefined)
})

test('Nova-3 builds readable subtitle segments from word timing', async () => {
  const env = environment(async () => nova)
  const response = await worker.fetch(
    audioRequest('/audio/transcriptions', {
      model: NOVA,
      response_format: 'srt',
    }),
    env,
    {}
  )

  assert.equal(response.status, 200)
  assert.equal(
    await response.text(),
    '1\n00:00:00,100 --> 00:00:02,100\nTesting one two.\n'
  )
})

test('Nova-3 cannot be used for translation', async () => {
  const env = environment(async () => {
    throw new Error('Must not invoke provider')
  })
  const response = await worker.fetch(
    audioRequest('/audio/translations', {
      model: NOVA,
    }),
    env,
    {}
  )

  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.param, 'model')
})

test('Speech endpoint accepts streamed Aura TTS audio', async () => {
  let seenInput
  const env = environment(async (model, input) => {
    assert.equal(model, AURA)
    seenInput = input
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]))
        controller.close()
      },
    })
  })

  const response = await worker.fetch(
    speechRequest({
      model: AURA,
      input: 'Hello from Cloudflare.',
      voice: 'luna',
      response_format: 'wav',
    }),
    env,
    {}
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'audio/wav')
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array([1, 2, 3, 4])
  )
  assert.equal(seenInput.encoding, 'linear16')
  assert.equal(seenInput.container, 'wav')
})

test('Speech endpoint accepts a binary Response and rejects JSON', async () => {
  const binary = environment(
    async () =>
      new Response(new Uint8Array([1, 2]), {
        headers: { 'Content-Type': 'audio/mpeg' },
      })
  )
  const request = { model: AURA, input: 'Hello.', voice: 'luna' }
  const accepted = await worker.fetch(speechRequest(request), binary, {})

  assert.equal(accepted.status, 200)
  assert.equal(accepted.headers.get('Content-Type'), 'audio/mpeg')
  assert.equal((await accepted.arrayBuffer()).byteLength, 2)

  const invalid = environment(
    async () =>
      new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
      })
  )
  const rejected = await worker.fetch(speechRequest(request), invalid, {})

  assert.equal(rejected.status, 502)
})

test('Non-turbo Whisper uses Cloudflare binary HTTP API', async (t) => {
  const previousFetch = globalThis.fetch
  let seenPath
  let seenType

  globalThis.fetch = async (url, init) => {
    seenPath = new URL(url).pathname
    seenType = new Headers(init.headers).get('Content-Type')

    return Response.json({ success: true, result: { text: 'Binary recognized.' } })
  }

  t.after(() => {
    globalThis.fetch = previousFetch
  })

  const env = {
    ...environment(async () => {
      throw new Error('Must not invoke binding for classic Whisper')
    }),
    CLOUDFLARE_ACCOUNT_ID: 'account-id',
    CLOUDFLARE_API_TOKEN: 'provider-secret',
  }
  const response = await worker.fetch(
    audioRequest('/audio/transcriptions', {
      model: '@cf/openai/whisper',
    }),
    env,
    {}
  )

  assert.equal(response.status, 200)
  assert.equal((await response.json()).text, 'Binary recognized.')
  assert.match(seenPath, /\/ai\/run\/@cf\/openai\/whisper$/)
  assert.equal(seenType, 'audio/wav')
})

test('Transcription validation rejects malformed inputs before inference', async () => {
  const env = environment(async () => {
    throw new Error('Unexpected inference')
  })

  const duplicate = await worker.fetch(
    audioRequest('/audio/transcriptions', {
      response_format: 'verbose_json',
      'timestamp_granularities[]': ['word', 'word'],
    }),
    env,
    {}
  )
  assert.equal(duplicate.status, 400)

  const unsupported = await worker.fetch(
    audioRequest('/audio/transcriptions', {
      model: '@cf/openai/whisper',
      vad_filter: 'true',
    }),
    env,
    {}
  )
  assert.equal(unsupported.status, 400)

  const unknown = await worker.fetch(
    audioRequest('/audio/transcriptions', {
      unknown_parameter: 'true',
    }),
    env,
    {}
  )
  assert.equal(unknown.status, 400)
})

test('Authentication and routing are enforced', async () => {
  const env = environment(async () => whisper)
  const invalidAuth = audioRequest('/audio/transcriptions')
  invalidAuth.headers.delete('Authorization')
  const rejected = await worker.fetch(invalidAuth, env, {})
  assert.equal(rejected.status, 401)

  const notFound = await worker.fetch(
    new Request('https://api.example/v1/audio/does-not-exist'),
    env,
    {}
  )
  assert.equal(notFound.status, 404)

  const wrongMethod = await worker.fetch(
    new Request('https://api.example/v1/audio/speech', { method: 'GET' }),
    env,
    {}
  )
  assert.equal(wrongMethod.status, 405)
})

test('Model discovery includes transcription models and configured aliases', async (t) => {
  const previousFetch = globalThis.fetch

  globalThis.fetch = async () =>
    Response.json({
      success: true,
      result: [
        { name: NOVA, task: { name: 'Automatic Speech Recognition' } },
        { name: TURBO, task: { name: 'Automatic Speech Recognition' } },
      ],
      result_info: { total_pages: 1 },
    })

  t.after(() => {
    globalThis.fetch = previousFetch
  })

  const env = {
    ...environment(async () => {}),
    CLOUDFLARE_ACCOUNT_ID: 'account-id',
    CLOUDFLARE_API_TOKEN: 'provider-secret',
    MODEL_MAPPER: JSON.stringify({ 'whisper-1': TURBO, 'nova-3': NOVA }),
  }
  const request = new Request('https://api.example/v1/models', {
    headers: { Authorization: 'Bearer test-secret' },
  })
  const response = await worker.fetch(request, env, {})

  assert.equal(response.status, 200)
  const ids = (await response.json()).data.map((model) => model.id)
  assert.ok(ids.includes(NOVA))
  assert.ok(ids.includes(TURBO))
  assert.ok(ids.includes('whisper-1'))
  assert.ok(ids.includes('nova-3'))
})
