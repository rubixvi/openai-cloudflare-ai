import { type Env } from '../index'

interface EmbeddingsRequestBody {
	input: string | string[]
	// model?: string
}

export const embeddingsHandler = async (request: Request, env: Env): Promise<Response> => {
	const model = '@cf/baai/bge-base-en-v1.5'

	try {
		if (request.headers.get('Content-Type') !== 'application/json') {
			throw new Error('invalid content type')
		}

		const body = (await request.json()) as EmbeddingsRequestBody

		const embeddings = (await env.AI.run(model as keyof AiModels, { text: body.input })) as {
			data: number[][]
		}

		return Response.json({
			object: 'list',
			data: [
				{
					object: 'embedding',
					embedding: embeddings.data[0],
					index: 0,
				},
			],
			model,
			usage: {
				prompt_tokens: 0,
				total_tokens: 0,
			},
		})
	} catch (e) {
		const message = e instanceof Error ? e.message : 'invalid request'
		return Response.json({ error: message }, { status: 400 })
	}
}
