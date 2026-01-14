import { type Env } from '../index'

interface CloudflareAIModel {
  name: string
  source: number
}

interface CloudflareModelsResponse {
  result: CloudflareAIModel[]
}

const getModels = async (env: Env): Promise<CloudflareAIModel[]> => {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    return []
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, 2_000)
  
  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/models/search?hide_experimental=false&search=Text+Generation`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Cloudflare API ${response.status}`)
    }
    
    const data = (await response.json()) as CloudflareModelsResponse
    return data.result ?? []
  } catch (err) {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

export const modelsHandler = async (_request: Request, env: Env): Promise<Response> => {
  let models: CloudflareAIModel[] = []
  
  try {
    models = await getModels(env)
  } catch {
    // fail soft
  }
  
  const modelList = models.map((model) => ({
    id: model.name,
    object: 'model' as const,
    created: 0,
    owned_by: model.source === 1 ? 'cloudflare' : 'huggingface',
  }))

  return new Response(JSON.stringify({
    object: 'list',
    data: modelList,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}