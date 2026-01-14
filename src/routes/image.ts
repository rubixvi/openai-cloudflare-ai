import { uint8ArrayToBase64 } from '../utils/converters'
import { uuidv4 } from '../utils/uuid'
import { streamToBuffer } from '../utils/stream'
import { type Env } from '../index'

interface ImageRequestBody {
	prompt: string
	format?: 'b64_json' | 'url'
}

export const imageGenerationHandler = async (request: Request, env: Env): Promise<Response> => {
	const model = '@cf/stabilityai/stable-diffusion-xl-base-1.0'
	let format: 'b64_json' | 'url' = 'url'
	const created = Math.floor(Date.now() / 1000)

	try {
		const contentType = request.headers.get('Content-Type') ?? ''
		if (!contentType.startsWith('application/json')) {
			throw new Error('invalid content type')
		}

		const body = (await request.json()) as ImageRequestBody

		if (!body?.prompt || typeof body.prompt !== 'string') {
			throw new Error('no prompt provided')
		}

		if (body.format) {
			if (body.format !== 'b64_json' && body.format !== 'url') {
				throw new Error('invalid format. must be b64_json or url')
			}
			format = body.format
		}

		const aiResult = await env.AI.run(model as keyof AiModels, { prompt: body.prompt })

		let imageBuffer: Uint8Array

		if (aiResult instanceof ReadableStream) {
			imageBuffer = await streamToBuffer(aiResult)
		} else if (Array.isArray(aiResult)) {
			const first = aiResult[0]

			if (first instanceof ReadableStream) {
				imageBuffer = await streamToBuffer(first)
			} else if (first instanceof Uint8Array) {
				imageBuffer = first
			} else {
				throw new Error('unsupported image output format')
			}
		} else if (aiResult instanceof Uint8Array) {
			imageBuffer = aiResult
		} else {
			throw new Error('unknown image response format')
		}

		if (format === 'b64_json') {
			const b64_json = uint8ArrayToBase64(imageBuffer)

			return new Response(
				JSON.stringify({
					created,
					data: [{ b64_json }],
				}),
				{
					headers: {
						'Content-Type': 'application/json',
					},
				}
			)
		}

		const name = `${uuidv4()}.png`
		await env.IMAGE_BUCKET.put(name, imageBuffer)

		const url = `${new URL(request.url).origin}/v1/images/get/${name}`

		return new Response(
			JSON.stringify({
				created,
				data: [{ url }],
			}),
			{
				headers: {
					'Content-Type': 'application/json',
				},
			}
		)
	} catch (e) {
		const message = e instanceof Error ? e.message : 'invalid request'
		return new Response(JSON.stringify({ error: message }), {
			status: 400,
			headers: {
				'Content-Type': 'application/json',
			},
		})
	}
}

export const getImageHandler = async (
  request: Request,
  env: Env
): Promise<Response> => {
  const url = new URL(request.url)

  const path = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '')
  const match = path.match(/\/images\/get\/(.+)$/)

  const name = match?.[1]

  if (!name) {
    return new Response(null, { status: 404 })
  }

  const image = await env.IMAGE_BUCKET.get(name)

  if (!image) {
    return new Response(null, { status: 404 })
  }

  return new Response(image.body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
