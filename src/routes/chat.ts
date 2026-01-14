import { type Env } from '../index'

type Role = 'system' | 'user' | 'assistant' | (string & {})

interface ChatMessage {
	role: Role
	content: string
}

interface ChatRequestBody {
	model?: string
	messages?: ChatMessage[]
	stream?: boolean
}

export const chatHandler = async (request: Request, env: Env): Promise<Response> => {
	let model = '@cf/mistral/mistral-7b-instruct-v0.1'
	const created = Math.floor(Date.now() / 1000)
	const id = crypto.randomUUID()

	try {
		const contentType = request.headers.get('Content-Type') ?? ''
		if (!contentType.startsWith('application/json')) {
			return Response.json({ error: 'invalid content type' }, { status: 400 })
		}

		const body = (await request.json()) as ChatRequestBody

		if (!Array.isArray(body.messages) || body.messages.length === 0) {
			return Response.json({ error: 'no messages provided' }, { status: 400 })
		}

		if (body.model) {
			const mapper = env.MODEL_MAPPER ?? {}
			model = mapper[body.model] ?? body.model
		}

		const stream = Boolean(body.stream)

		const aiResp = await env.AI.run(model as keyof AiModels, { messages: body.messages, stream })

		if (!stream) {
			const content =
				(aiResp as any)?.response ?? (aiResp as any)?.text ?? (aiResp as any)?.output_text ?? ''

			if (!content) {
				return Response.json({ error: 'empty model response' }, { status: 502 })
			}

			return Response.json({
				id,
				object: 'chat.completion',
				created,
				model,
				choices: [
					{
						index: 0,
						message: {
							role: 'assistant',
							content,
						},
						finish_reason: 'stop',
					},
				],
			})
		}

		const decoder = new TextDecoder()
		const encoder = new TextEncoder()
		let buffer = ''
		let sentRole = false

		const transformer = new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				buffer += decoder.decode(chunk, { stream: true })

				while (true) {
					const newlineIndex = buffer.indexOf('\n')
					if (newlineIndex === -1) break

					const line = buffer.slice(0, newlineIndex).trim()
					buffer = buffer.slice(newlineIndex + 1)

					if (!line.startsWith('data:')) continue

					const payload = line.slice(5).trim()
					if (payload === '[DONE]') {
						controller.enqueue(
							encoder.encode(
								`data: ${JSON.stringify({
									id,
									object: 'chat.completion.chunk',
									created,
									model,
									choices: [
										{
											index: 0,
											delta: {},
											finish_reason: 'stop',
										},
									],
								})}\n\n`
							)
						)
						controller.enqueue(encoder.encode('data: [DONE]\n\n'))
						return
					}

					const data = JSON.parse(payload) as { response?: string }
					if (!data.response) continue

					const delta: any = { content: data.response }
					if (!sentRole) {
						delta.role = 'assistant'
						sentRole = true
					}

					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({
								id,
								object: 'chat.completion.chunk',
								created,
								model,
								choices: [
									{
										index: 0,
										delta,
										finish_reason: null,
									},
								],
							})}\n\n`
						)
					)
				}
			},
			flush() {
				decoder.decode()
			},
		})

		return new Response((aiResp as ReadableStream<Uint8Array>).pipeThrough(transformer), {
			headers: {
				'content-type': 'text/event-stream',
				'cache-control': 'no-cache',
				connection: 'keep-alive',
			},
		})
	} catch (e) {
		const message = e instanceof Error ? e.message : 'invalid request'
		return Response.json({ error: message }, { status: 400 })
	}
}
