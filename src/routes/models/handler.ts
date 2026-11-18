import {
  type CloudflareModel,
  type Env,
  type ModelCacheEntry,
  type OpenAIModel,
} from '../../types'
import { upstreamError } from '../../utils/errors'
import {
  AUDIO_MODELS,
  IMAGE_PROFILES,
  modelMapper,
  SPEECH_MODELS,
} from '../../utils/models'
import { cloudflareRequest, readProviderJson } from '../../utils/provider'
import { isObject } from '../../utils/validation'
import {
  EXPOSED_MODEL_TASKS,
  MAX_MODEL_PAGES,
  MODEL_CACHE_MS,
  MODEL_PAGE_SIZE,
  MODEL_TIMEOUT_MS,
} from './constant'

const cache = new WeakMap<Env, ModelCacheEntry>()

async function getModels(request: Request, env: Env): Promise<CloudflareModel[]> {
  const cached = cache.get(env)

  if (
    cached &&
    cached.token === env.CLOUDFLARE_API_TOKEN &&
    cached.account === env.CLOUDFLARE_ACCOUNT_ID &&
    cached.expires > Date.now()
  ) {
    return cached.models
  }

  const models = new Map<string, CloudflareModel>()

  for (let page = 1; page <= MAX_MODEL_PAGES; page++) {
    const params = new URLSearchParams({
      hide_experimental: 'false',
      include_deprecated: 'false',
      per_page: String(MODEL_PAGE_SIZE),
      page: String(page),
    })
    const response = await cloudflareRequest(
      request,
      env,
      `/models/search?${params}`,
      {},
      MODEL_TIMEOUT_MS
    )
    const body = await readProviderJson(response)

    if (!isObject(body) || body.success === false || !Array.isArray(body.result)) {
      upstreamError('Cloudflare model discovery failed.')
    }

    let added = 0

    for (const value of body.result) {
      if (!isObject(value) || typeof value.name !== 'string') {
        upstreamError('Cloudflare returned invalid model metadata.')
      }

      if (!models.has(value.name)) {
        added++
      }

      models.set(value.name, {
        name: value.name,
        ...(isObject(value.task) && typeof value.task.name === 'string'
          ? { task: { name: value.task.name } }
          : {}),
        ...(typeof value.created_at === 'string' ? { created_at: value.created_at } : {}),
      })
    }

    const info = isObject(body.result_info) ? body.result_info : undefined
    const totalPages =
      info && typeof info.total_pages === 'number' ? info.total_pages : undefined
    const total =
      info && typeof info.total_count === 'number' ? info.total_count : undefined

    if (
      body.result.length === 0 ||
      (totalPages !== undefined && page >= totalPages) ||
      (total !== undefined && models.size >= total) ||
      (totalPages === undefined &&
        total === undefined &&
        body.result.length < MODEL_PAGE_SIZE)
    ) {
      const result = [...models.values()]

      cache.set(env, {
        token: env.CLOUDFLARE_API_TOKEN,
        account: env.CLOUDFLARE_ACCOUNT_ID,
        expires: Date.now() + MODEL_CACHE_MS,
        models: result,
      })

      return result
    }

    if (!added) {
      upstreamError('Cloudflare model pagination did not advance.')
    }
  }

  return upstreamError('Cloudflare model discovery exceeded the pagination limit.')
}

function exposed(model: CloudflareModel): boolean {
  const task = model.task?.name

  return (
    (task !== undefined && EXPOSED_MODEL_TASKS.has(task)) ||
    Object.hasOwn(IMAGE_PROFILES, model.name) ||
    AUDIO_MODELS.has(model.name) ||
    SPEECH_MODELS.has(model.name)
  )
}

function asOpenAIModel(model: CloudflareModel, id = model.name): OpenAIModel {
  const date = model.created_at ? Date.parse(model.created_at) : Number.NaN

  return {
    id,
    object: 'model',
    created: Number.isFinite(date) ? Math.floor(date / 1000) : 0,
    owned_by: model.name.split('/')[1] ?? 'cloudflare',
  }
}

export async function modelList(request: Request, env: Env): Promise<OpenAIModel[]> {
  const available = (await getModels(request, env)).filter(exposed)
  const result = new Map(available.map((model) => [model.name, asOpenAIModel(model)]))
  const byName = new Map(available.map((model) => [model.name, model]))

  for (const [alias, target] of Object.entries(modelMapper(env))) {
    const model = byName.get(target)

    if (model && !result.has(alias)) {
      result.set(alias, asOpenAIModel(model, alias))
    }
  }

  return [...result.values()].sort((left, right) => left.id.localeCompare(right.id))
}
