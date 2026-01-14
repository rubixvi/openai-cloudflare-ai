import { type Env } from '../index'

interface CompletionRequestBody {
	model?: string
	prompt?: string
}

export const completionHandler = async (request: Request, env: Env): Promise<Response> => {
	let model = '@cf/mistral/mistral-7b-instruct-v0.1'
	const created = Math.floor(Date.now() / 1000)
	const id = crypto.randomUUID()

	try {
		const contentType = request.headers.get('Content-Type') ?? ''
		if (!contentType.startsWith('application/json')) {
			return Response.json({ error: 'invalid content type' }, { status: 400 })
		}

		const body = (await request.json()) as CompletionRequestBody

		if (!body.prompt || typeof body.prompt !== 'string') {
			return Response.json({ error: 'no prompt provided' }, { status: 400 })
		}

		if (body.model) {
			const mapper = env.MODEL_MAPPER ?? {}
			model = mapper[body.model] ?? body.model
		}

		const aiResp = await env.AI.run(model as keyof AiModels, { prompt: body.prompt })

		const text =
			(aiResp as any)?.response ?? (aiResp as any)?.text ?? (aiResp as any)?.output_text ?? ''

		if (!text) {
			return Response.json({ error: 'empty completion' }, { status: 502 })
		}

		return Response.json({
			id,
			object: 'text_completion',
			created,
			model,
			choices: [
				{
					index: 0,
					finish_reason: 'stop',
					text,
					logprobs: null,
				},
			],
		})
	} catch (e) {
		const message = e instanceof Error ? e.message : 'invalid request'
		return Response.json({ error: message }, { status: 400 })
	}
}
