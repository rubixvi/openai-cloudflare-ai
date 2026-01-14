import { type Env } from '../index'

export const transcriptionHandler = async (request: Request, env: Env): Promise<Response> => {
	const model = '@cf/openai/whisper'

	try {
		const contentType = request.headers.get('Content-Type')
		if (!contentType || !contentType.includes('multipart/form-data')) {
			throw new Error('invalid content type')
		}

		const formData = await request.formData()
		const audio = formData.get('file')

		if (!(audio instanceof File)) {
			return Response.json({ error: 'no audio provided' }, { status: 400 })
		}

		const blob = await audio.arrayBuffer()
		const input = {
			audio: Array.from(new Uint8Array(blob)),
		}

		const resp = (await env.AI.run(model as keyof AiModels, input)) as { text: string }

		return Response.json({
			text: resp.text,
		})
	} catch (e) {
		const message = e instanceof Error ? e.message : 'invalid request'

		return Response.json({ error: message }, { status: 400 })
	}
}

function getLanguageId(text: string): string {
	const lower = text.toLowerCase()

	if (lower.includes('\n')) {
		return lower.split('\n')[0]
	}

	if (lower.includes(' ')) {
		return lower.split(' ')[0]
	}

	return lower
}

export const translationHandler = async (request: Request, env: Env): Promise<Response> => {
	const model = '@cf/openai/whisper'

	try {
		const contentType = request.headers.get('Content-Type')
		if (!contentType || !contentType.includes('multipart/form-data')) {
			throw new Error('invalid content type')
		}

		const formData = await request.formData()
		const audio = formData.get('file')

		if (!(audio instanceof File)) {
			throw new Error('no audio provided')
		}

		const blob = await audio.arrayBuffer()
		const input = {
			audio: Array.from(new Uint8Array(blob)),
		}

		const resp = (await env.AI.run(model as keyof AiModels, input)) as { text: string }

		const languageIdResp = (await env.AI.run('@cf/meta/llama-2-7b-chat-int8' as keyof AiModels, {
			messages: [
				{
					role: 'user',
					content:
						"Output one of the following: english, chinese, french, spanish, arabic, russian, german, japanese, portuguese, hindi. Identify the following languages.\nQ:'Hola mi nombre es brian y el tuyo?'",
				},
				{ role: 'assistant', content: 'spanish' },
				{ role: 'user', content: 'Was für ein schönes Baby!' },
				{ role: 'assistant', content: 'german' },
				{ role: 'user', content: resp.text },
			],
		})) as { response: string }

		const sourceLang = getLanguageId(languageIdResp.response as string)

		const translationResp = (await env.AI.run('@cf/meta/m2m100-1.2b' as keyof AiModels, {
			text: resp.text,
			source_lang: sourceLang,
			target_lang: 'english',
		})) as { translated_text: string }

		if (!translationResp.translated_text) {
			throw new Error('translation failed')
		}

		return Response.json({
			text: translationResp.translated_text as string,
		})
	} catch (e) {
		const message = e instanceof Error ? e.message : 'invalid request'

		return Response.json({ error: message }, { status: 400 })
	}
}
