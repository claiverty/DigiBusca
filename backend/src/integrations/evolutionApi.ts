import { getEvolutionApiConfig } from '../config/supabase.js'

export class EvolutionApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'EvolutionApiError'
  }
}

export type EvolutionInstanceState = {
  state: string
  owner?: string
}

function configOrThrow() {
  const config = getEvolutionApiConfig()
  if (!config) throw new EvolutionApiError('Configure EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_WEBHOOK_SECRET no backend.', 503)
  return config
}

async function evolutionRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = configOrThrow()
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        apikey: config.apiKey,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new EvolutionApiError('Não foi possível conectar à Evolution API. Confira se o serviço está ativo no Mac.', 502)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new EvolutionApiError(
      response.status >= 500
        ? `A Evolution API não conseguiu concluir a operação agora (HTTP ${response.status}).`
        : `A Evolution API recusou a operação (HTTP ${response.status}). Confira a instância e a chave configurada.`,
      response.status,
    )
  }
  return await response.json() as T
}

function webhookUrlFor(config: NonNullable<ReturnType<typeof getEvolutionApiConfig>>) {
  if (config.webhookUrl) return config.webhookUrl.replace(/\/+$/, '')
  const port = typeof process !== 'undefined' ? process.env.PORT?.trim() || '3001' : '3001'
  return `http://host.docker.internal:${port}/api/webhooks/evolution`
}

function webhookConfig() {
  const config = configOrThrow()
  return {
    webhook: {
      enabled: true,
      url: webhookUrlFor(config),
      events: ['MESSAGES_UPSERT'],
      headers: { 'x-digibot-webhook-secret': config.webhookSecret },
      base64: false,
    },
  }
}

export async function createEvolutionInstance(instanceName: string) {
  return evolutionRequest<Record<string, unknown>>('/instance/create', {
    method: 'POST',
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    }),
  })
}

export async function configureEvolutionWebhook(instanceName: string) {
  return evolutionRequest<Record<string, unknown>>(`/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: JSON.stringify(webhookConfig()),
  })
}

export async function getEvolutionQrCode(instanceName: string) {
  return evolutionRequest<Record<string, unknown>>(`/instance/connect/${encodeURIComponent(instanceName)}`)
}

export async function getEvolutionConnectionState(instanceName: string): Promise<EvolutionInstanceState> {
  const result = await evolutionRequest<Record<string, unknown>>(`/instance/connectionState/${encodeURIComponent(instanceName)}`)
  const instance = typeof result.instance === 'object' && result.instance !== null
    ? result.instance as Record<string, unknown>
    : result
  const state = typeof instance.state === 'string'
    ? instance.state
    : typeof result.state === 'string' ? result.state : 'unknown'
  const owner = typeof instance.owner === 'string'
    ? instance.owner
    : typeof instance.ownerJid === 'string' ? instance.ownerJid : undefined
  return { state, ...(owner ? { owner } : {}) }
}

export async function sendEvolutionTextMessage(instanceName: string, phone: string, text: string) {
  const result = await evolutionRequest<Record<string, unknown>>(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: JSON.stringify({ number: phone, text, linkPreview: false }),
  })
  const key = typeof result.key === 'object' && result.key !== null ? result.key as Record<string, unknown> : undefined
  const messageId = typeof key?.id === 'string'
    ? key.id
    : typeof result.messageId === 'string' ? result.messageId : undefined
  if (!messageId) throw new EvolutionApiError('A Evolution API não confirmou o identificador da mensagem.', 502)
  return messageId
}

export async function logoutEvolutionInstance(instanceName: string) {
  return evolutionRequest<Record<string, unknown>>(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: 'DELETE' })
}

export function evolutionWebhookSecretMatches(candidate: string | undefined) {
  const config = getEvolutionApiConfig()
  if (!config || !candidate) return false
  const encoder = new TextEncoder()
  const left = encoder.encode(candidate)
  const right = encoder.encode(config.webhookSecret)
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

export function getEvolutionWebhookUrl() {
  return webhookUrlFor(configOrThrow())
}
