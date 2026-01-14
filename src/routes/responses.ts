import { type Env } from '../index'

type Role = 'system' | 'user' | 'assistant' | (string & {})

interface ResponseInputMessage {
	role: Role
	content: string
}

interface ResponsesRequestBody {
	model?: string
	input?: string | ResponseInputMessage[]
}

export const responsesHandler = async (request: Request, env: Env): Promise<Response> => {
	let model = '@cf/mistral/mistral-7b-instruct-v0.1'
	const created = Math.floor(Date.now() / 1000)
	const id = crypto.randomUUID()

	try {
		const contentType = request.headers.get('Content-Type') ?? ''
		if (!contentType.startsWith('application/json')) {
			return Response.json({ error: 'invalid content type' }, { status: 400 })
		}

		const body = (await request.json()) as ResponsesRequestBody

		if (body.model) {
			const mapper = env.MODEL_MAPPER ?? {}
			model = mapper[body.model] ?? body.model
		}

		if (!body.input) {
			return Response.json({ error: 'no input provided' }, { status: 400 })
		}

		const messages: ResponseInputMessage[] =
			typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : body.input

		const aiResp = await env.AI.run(model as keyof AiModels, { messages })

		const text =
			(aiResp as any)?.response ?? (aiResp as any)?.text ?? (aiResp as any)?.output_text ?? ''

		if (!text) {
			return Response.json({ error: 'empty model response' }, { status: 502 })
		}

		return Response.json({
			id,
			object: 'response',
			created,
			model,
			output: [
				{
					id: crypto.randomUUID(),
					type: 'message',
					role: 'assistant',
					content: [
						{
							type: 'output_text',
							text,
						},
					],
				},
			],
			output_text: text,
		})
	} catch (e) {
		const message = e instanceof Error ? e.message : 'invalid request'
		return Response.json({ error: message }, { status: 400 })
	}
}
