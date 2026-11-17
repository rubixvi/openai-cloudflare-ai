import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { default: worker } = require('../.test-dist/index.js')

function jsonRequest(path, body) {
  return new Request(`https://api.example/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function environment(run = async () => {}) {
  return {
    ACCESS_TOKEN: 'secret',
    CLOUDFLARE_ACCOUNT_ID: 'account',
    CLOUDFLARE_API_TOKEN: 'provider-secret',
    AI: { run },
  }
}

test('Chat completions preserve the native provider response', async (t) => {
  const previousFetch = globalThis.fetch
  let requestedPath

  globalThis.fetch = async (url) => {
    requestedPath = new URL(url).pathname

    return Response.json({
      success: true,
      result: {
        object: 'chat.completion',
        id: 'chat-1',
        choices: [{ message: { role: 'assistant', content: 'Hello.' } }],
      },
    })
  }

  t.after(() => {
    globalThis.fetch = previousFetch
  })

  const response = await worker.fetch(
    jsonRequest('/chat/completions', {
      messages: [{ role: 'user', content: 'Hello.' }],
    }),
    environment(),
    {}
  )

  assert.equal(response.status, 200)
  assert.equal((await response.json()).id, 'chat-1')
  assert.match(requestedPath, /\/ai\/v1\/chat\/completions$/)
})

test('Legacy completions normalize binding text output', async () => {
  const env = environment(async () => ({ response: 'Completed.' }))
  const response = await worker.fetch(
    jsonRequest('/completions', {
      prompt: 'Finish this sentence.',
    }),
    env,
    {}
  )

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.object, 'text_completion')
  assert.equal(body.choices[0].text, 'Completed.')
})

test('Embeddings retain float vectors from native API', async (t) => {
  const previousFetch = globalThis.fetch

  globalThis.fetch = async () =>
    Response.json({
      success: true,
      result: {
        object: 'list',
        data: [{ index: 0, object: 'embedding', embedding: [0.125, -0.5] }],
      },
    })

  t.after(() => {
    globalThis.fetch = previousFetch
  })

  const response = await worker.fetch(
    jsonRequest('/embeddings', {
      input: 'Hello.',
      encoding_format: 'base64',
    }),
    environment(),
    {}
  )

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.data.length, 1)
  assert.equal(typeof body.data[0].embedding, 'string')
  assert.equal(Buffer.from(body.data[0].embedding, 'base64').byteLength, 8)
})

test('Responses endpoint returns supported GPT-OSS result', async (t) => {
  const previousFetch = globalThis.fetch

  globalThis.fetch = async () =>
    Response.json({
      success: true,
      result: {
        object: 'response',
        id: 'resp-1',
        created_at: 100,
        output: [],
      },
    })

  t.after(() => {
    globalThis.fetch = previousFetch
  })

  const response = await worker.fetch(
    jsonRequest('/responses', {
      input: 'Hello.',
    }),
    environment(),
    {}
  )

  assert.equal(response.status, 200)
  assert.equal((await response.json()).id, 'resp-1')
})

test('Image generation still supports base64 responses', async () => {
  const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const env = environment(async () => pngHeader)
  const response = await worker.fetch(
    jsonRequest('/images/generations', {
      prompt: 'Simple abstract artwork',
      response_format: 'b64_json',
    }),
    env,
    {}
  )

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.data.length, 1)
  assert.deepEqual(Buffer.from(body.data[0].b64_json, 'base64'), Buffer.from(pngHeader))
})

test('Image generation accepts streamed Response output', async () => {
  const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const env = environment(
    async () =>
      new Response(pngHeader, {
        headers: { 'Content-Type': 'image/png' },
      })
  )
  const response = await worker.fetch(
    jsonRequest('/images/generations', {
      prompt: 'An abstract symbol',
      response_format: 'b64_json',
    }),
    env,
    {}
  )

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(Buffer.from(body.data[0].b64_json, 'base64'), Buffer.from(pngHeader))
})
