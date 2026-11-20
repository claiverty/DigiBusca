import type { WhatsAppAgentProvider } from '../contracts/whatsappAutomation.js'
import { getWhatsAppAgentProviderConfig, type WhatsAppAgentProviderConfig } from '../config/supabase.js'
import { safeExternalApiFetch } from './externalApiFetch.js'

export type WhatsAppAgentModelChoice = {
  id: string
  label: string
}

type ModelCatalog = {
  expiresAt: number
  models: WhatsAppAgentModelChoice[]
}

type ProviderPayload = Record<string, unknown>

const modelCache = new Map<string, ModelCatalog>()
const modelCacheDurationMs = 5 * 60 * 1_000
const catalogTimeoutMs = 8_000
const maxModelCount = 500
const maxCatalogResponseBytes = 1024 * 1024
const defaultModelByProvider: Record<WhatsAppAgentProvider, string> = {
  google: 'gemini-3.8-flash',
  anthropic: 'claude-3-5-haiku-latest',
  'openai-compatible': 'gpt-4o-mini',
}

export class WhatsAppAgentModelCatalogError extends Error {
  constructor(public readonly reason: 'provider_not_configured' | 'catalog_unavailable' | 'catalog_empty') {
    super(reason)
    this.name = 'WhatsAppAgentModelCatalogError'
  }
}

function isRecord(value: unknown): value is ProviderPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function modelId(value: unknown) {
  if (typeof value !== 'string') return undefined
  const id = value.replace(/^models\//, '').trim()
  return /^[A-Za-z0-9_.:/-]{1,128}$/.test(id) ? id : undefined
}

function modelLabel(displayName: unknown, id: string) {
  const name = typeof displayName === 'string' ? displayName.trim().slice(0, 100) : ''
  return name && name !== id ? `${name} · ${id}` : id
}

function uniqueModels(models: WhatsAppAgentModelChoice[]) {
  return [...new Map(models.map((model) => [model.id, model])).values()].slice(0, maxModelCount)
}

async function readCatalogJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxCatalogResponseBytes) {
    await response.body?.cancel()
    throw new Error('Provider model catalog response is too large.')
  }
  if (!response.body) return undefined
  const reader = response.body.getReader()
  const bytes = new Uint8Array(maxCatalogResponseBytes)
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maxCatalogResponseBytes) {
        await reader.cancel()
        throw new Error('Provider model catalog response is too large.')
      }
      bytes.set(value, byteLength - value.byteLength)
    }
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(new TextDecoder().decode(bytes.subarray(0, byteLength))) as unknown
}

async function requestJson(url: URL, apiKey: string, headers: Record<string, string> = {}) {
  let response: Response
  try {
    const requestHeaders = { ...headers }
    if (!requestHeaders.Authorization && !requestHeaders['x-api-key'] && !requestHeaders['x-goog-api-key']) {
      requestHeaders.Authorization = `Bearer ${apiKey}`
    }
    response = await safeExternalApiFetch(url, {
      headers: requestHeaders,
      signal: AbortSignal.timeout(catalogTimeoutMs),
    })
  } catch {
    throw new WhatsAppAgentModelCatalogError('catalog_unavailable')
  }
  if (!response.ok) throw new WhatsAppAgentModelCatalogError('catalog_unavailable')
  try {
    return await readCatalogJson(response)
  } catch {
    throw new WhatsAppAgentModelCatalogError('catalog_unavailable')
  }
}

async function listGoogleModels(apiKey: string): Promise<WhatsAppAgentModelChoice[]> {
  const models: WhatsAppAgentModelChoice[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 5 && models.length < maxModelCount; page += 1) {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models')
    url.searchParams.set('pageSize', '100')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const payload = await requestJson(url, apiKey, { 'x-goog-api-key': apiKey })
    if (!isRecord(payload) || !Array.isArray(payload.models)) {
      throw new WhatsAppAgentModelCatalogError('catalog_unavailable')
    }
    for (const item of payload.models) {
      if (!isRecord(item) || !Array.isArray(item.supportedGenerationMethods) || !item.supportedGenerationMethods.includes('generateContent')) continue
      const id = modelId(item.baseModelId) ?? modelId(item.name)
      if (id) models.push({ id, label: modelLabel(item.displayName, id) })
    }
    pageToken = typeof payload.nextPageToken === 'string' ? payload.nextPageToken : undefined
    if (!pageToken) break
  }
  return uniqueModels(models)
}

async function listAnthropicModels(apiKey: string): Promise<WhatsAppAgentModelChoice[]> {
  const models: WhatsAppAgentModelChoice[] = []
  let afterId: string | undefined
  for (let page = 0; page < 5 && models.length < maxModelCount; page += 1) {
    const url = new URL('https://api.anthropic.com/v1/models')
    url.searchParams.set('limit', '1000')
    url.searchParams.set('lifecycle', 'active')
    if (afterId) url.searchParams.set('after_id', afterId)
    const payload = await requestJson(url, apiKey, {
      'x-api-key': apiKey,
      'anthropic-version': '2026-10-21',
    })
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new WhatsAppAgentModelCatalogError('catalog_unavailable')
    }
    for (const item of payload.data) {
      if (!isRecord(item) || (item.lifecycle !== undefined && item.lifecycle !== 'active')) continue
      const id = modelId(item.id)
      if (id) models.push({ id, label: modelLabel(item.display_name, id) })
    }
    const hasMore = payload.has_more === true
    afterId = typeof payload.last_id === 'string' ? payload.last_id : undefined
    if (!hasMore || !afterId) break
  }
  return uniqueModels(models)
}

async function listOpenAICompatibleModels(apiKey: string, baseUrl: string): Promise<WhatsAppAgentModelChoice[]> {
  const url = new URL('models', `${baseUrl.replace(/\/+$/, '')}/`)
  const payload = await requestJson(url, apiKey)
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new WhatsAppAgentModelCatalogError('catalog_unavailable')
  }
  return uniqueModels(payload.data.flatMap((item): WhatsAppAgentModelChoice[] => {
    if (!isRecord(item)) return []
    const id = modelId(item.id)
    if (!id) return []
    if (typeof item.shutdown_date === 'string' && Date.parse(item.shutdown_date) <= Date.now()) return []
    return [{ id, label: modelLabel(item.name, id) }]
  }))
}

async function loadModels(provider: WhatsAppAgentProvider, config: WhatsAppAgentProviderConfig): Promise<WhatsAppAgentModelChoice[]> {
  const models = config.provider === 'google'
    ? await listGoogleModels(config.apiKey)
    : config.provider === 'anthropic'
      ? await listAnthropicModels(config.apiKey)
      : await listOpenAICompatibleModels(config.apiKey, config.baseUrl!)
  if (models.length === 0) throw new WhatsAppAgentModelCatalogError('catalog_empty')
  return models
}

export async function listWhatsAppAgentModelsForConfig(
  provider: WhatsAppAgentProvider,
  config: WhatsAppAgentProviderConfig,
): Promise<WhatsAppAgentModelChoice[]> {
  return loadModels(provider, config)
}

export async function listWhatsAppAgentModels(
  provider: WhatsAppAgentProvider,
  options: { config?: WhatsAppAgentProviderConfig; cacheScope?: string } = {},
): Promise<WhatsAppAgentModelChoice[]> {
  const cacheKey = `${options.cacheScope ?? 'environment'}:${provider}`
  const cached = modelCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.models

  const config = options.config ?? getWhatsAppAgentProviderConfig(provider, defaultModelByProvider[provider])
  if (!config) throw new WhatsAppAgentModelCatalogError('provider_not_configured')

  const models = await loadModels(provider, config)

  modelCache.set(cacheKey, { models, expiresAt: Date.now() + modelCacheDurationMs })
  return models
}

export function invalidateWhatsAppAgentModelCache(provider: WhatsAppAgentProvider, cacheScope = 'environment') {
  modelCache.delete(`${cacheScope}:${provider}`)
}
