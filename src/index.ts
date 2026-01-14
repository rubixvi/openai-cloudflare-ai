import { type ExecutionContext } from '@cloudflare/workers-types'
import { routes } from './routes/index'

export interface Env {
	ACCESS_TOKEN: string
	CLOUDFLARE_API_TOKEN: string
	CLOUDFLARE_ACCOUNT_ID: string
	MODEL_MAPPER?: Record<string, string>
	IMAGE_BUCKET: R2Bucket
	AI: Ai
}

function authenticate(request: Request, env: Env): Response | null {
	const header = request.headers.get('Authorization')
	if (!header) {
		return jsonError(401, 'Unauthorized', 'AUTH_NO_HEADER')
	}

	const [scheme, token] = header.split(' ')
	if (scheme !== 'Bearer' || token !== env.ACCESS_TOKEN) {
		return jsonError(403, 'Forbidden', 'AUTH_INVALID_TOKEN')
	}

	return null
}

function jsonError(status: number, error: string, code?: string): Response {
	return new Response(JSON.stringify({ error, code }), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

function replacePath(pathname: string): string {
	return pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
}

function withCors(response: Response): Response {
	const headers = new Headers(response.headers)

	headers.set('Access-Control-Allow-Origin', '*')
	headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
	headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type')

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			if (request.method === 'OPTIONS') {
				return withCors(new Response(null, { status: 204 }))
			}

			const url = new URL(request.url)

			const normalizedPath = replacePath(url.pathname)

			if (normalizedPath !== url.pathname) {
				return withCors(
					new Response(null, {
						status: 308,
						headers: {
							Location: normalizedPath + url.search,
						},
					})
				)
			}

			const route = routes.find((r) => r.method === request.method && r.path.test(normalizedPath))

			if (!route) {
				return withCors(new Response('Not Found', { status: 404 }))
			}

			if (route.auth) {
				const authError = authenticate(request, env)
				if (authError) return withCors(authError)
			}

			const response = await route.handler(request, env, ctx)
			return withCors(response)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return withCors(
				new Response(JSON.stringify({ error: 'Internal Server Error', message }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				})
			)
		}
	},
}
