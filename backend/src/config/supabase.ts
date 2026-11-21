import { createClient, type User } from '@supabase/supabase-js'
import type { WhatsAppAgentProvider } from '../contracts/whatsappAutomation.js'

export type RuntimeEnvironment = {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  GOOGLE_MAPS_API_KEY?: string
  GEMINI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  OPENAI_COMPATIBLE_API_KEY?: string
  OPENAI_COMPATIBLE_BASE_URL?: string
  WHATSAPP_INTEGRATION_ENABLED?: string
  WHATSAPP_AUTOMATION_RUNTIME_ENABLED?: string
  WHATSAPP_PROSPECTING_RUNTIME_ENABLED?: string
  WHATSAPP_OPENBOT_REPLY_RUNTIME_ENABLED?: string
  WHATSAPP_OPENBOT_AGENT_SAFETY_CONFIRMED?: string
  WHATSAPP_OPENBOT_AGENT_ID?: string
  WHATSAPP_DIGIBOT_AGENT_RUNTIME_ENABLED?: string
  WHATSAPP_OPENBOT_BRIDGE_URL?: string
  WHATSAPP_OPENBOT_BRIDGE_TOKEN?: string
  DIGIBUSCA_APP_ORIGINS?: string
  EVOLUTION_API_URL?: string
  EVOLUTION_API_KEY?: string
  EVOLUTION_WEBHOOK_SECRET?: string
  EVOLUTION_WEBHOOK_URL?: string
  PORT?: string
}

let runtimeEnvironment: RuntimeEnvironment | undefined

function localEnvironment(): RuntimeEnvironment {
  if (typeof process === 'undefined') {
    return {}
  }

  return process.env
}

function environment() {
  return runtimeEnvironment ?? localEnvironment()
}

export function configureRuntimeEnvironment(nextEnvironment: RuntimeEnvironment) {
  runtimeEnvironment = nextEnvironment
}

export function getGoogleMapsApiKey() {
  return environment().GOOGLE_MAPS_API_KEY
}

export function getGeminiApiKey() {
  return environment().GEMINI_API_KEY
}

export type WhatsAppAgentProviderConfig = {
  provider: WhatsAppAgentProvider
  model: string
  apiKey: string
  baseUrl?: string
}

export function buildWhatsAppAgentProviderConfig(
  provider: WhatsAppAgentProvider,
  model: string,
  suppliedApiKey: string,
  suppliedBaseUrl?: string,
  allowLocalHttp = false,
): WhatsAppAgentProviderConfig | undefined {
  if (!/^[A-Za-z0-9_.:/-]{1,128}$/.test(model)) return undefined
  const apiKey = suppliedApiKey.trim()
  if (apiKey.length < 8 || apiKey.length > 4_096) return undefined
  if (provider === 'google') {
    return { provider, model, apiKey }
  }
  if (provider === 'anthropic') {
    return { provider, model, apiKey }
  }

  const rawBaseUrl = suppliedBaseUrl?.trim().replace(/\/+$/, '')
  if (!rawBaseUrl || rawBaseUrl.length > 512) return undefined
  try {
    const url = new URL(rawBaseUrl)
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    const localHttp = allowLocalHttp && process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(host)
    const ipLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')
    if (ipLiteral && !localHttp) return undefined
    if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.search || url.hash) return undefined
  } catch {
    return undefined
  }
  return { provider, model, apiKey, baseUrl: rawBaseUrl }
}

export function getWhatsAppAgentProviderConfig(provider: WhatsAppAgentProvider, model: string): WhatsAppAgentProviderConfig | undefined {
  const values = environment()
  const apiKey = provider === 'google'
    ? values.GEMINI_API_KEY
    : provider === 'anthropic'
      ? values.ANTHROPIC_API_KEY
      : values.OPENAI_COMPATIBLE_API_KEY
  const baseUrl = provider === 'openai-compatible' ? values.OPENAI_COMPATIBLE_BASE_URL : undefined
  return apiKey ? buildWhatsAppAgentProviderConfig(provider, model, apiKey, baseUrl, true) : undefined
}

export function getWhatsAppAgentProvidersStatus() {
  return {
    google: Boolean(getWhatsAppAgentProviderConfig('google', 'gemini-4-hydrogen')),
    anthropic: Boolean(getWhatsAppAgentProviderConfig('anthropic', 'claude-3-5-haiku-latest')),
    openaiCompatible: Boolean(getWhatsAppAgentProviderConfig('openai-compatible', 'gpt-4o-mini')),
  }
}

export function isWhatsAppDigiBuscaAgentRuntimeEnabled() {
  return isWhatsAppAutomationRuntimeEnabled() &&
    environment().WHATSAPP_DIGIBOT_AGENT_RUNTIME_ENABLED?.trim().toLowerCase() === 'true'
}

export function getEvolutionApiConfig() {
  const values = environment()
  const baseUrl = values.EVOLUTION_API_URL?.trim().replace(/\/+$/, '')
  const apiKey = values.EVOLUTION_API_KEY?.trim()
  const webhookSecret = values.EVOLUTION_WEBHOOK_SECRET?.trim()
  const webhookUrl = values.EVOLUTION_WEBHOOK_URL?.trim()
  if (!baseUrl || !apiKey || !webhookSecret || !webhookUrl) return undefined
  try {
    const url = new URL(baseUrl)
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    const isLoopbackHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(hostname)
    const isEvolutionContainerHttp = url.protocol === 'http:' && hostname === 'evolution-api'
    if (url.protocol !== 'https:' && !isLoopbackHttp && !isEvolutionContainerHttp) return undefined
    if (url.username || url.password || url.search || url.hash) return undefined
    if (new TextEncoder().encode(webhookSecret).byteLength < 32) return undefined

    const webhookTarget = new URL(webhookUrl)
    const webhookHostname = webhookTarget.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    const isLocalWebhook = ['localhost', '127.0.0.1', '::1', 'host.docker.internal', 'digibusca-webhook', 'digibusca-backend'].includes(webhookHostname)
    if (webhookTarget.protocol !== 'https:' && !(webhookTarget.protocol === 'http:' && isLocalWebhook)) return undefined
    if (webhookTarget.username || webhookTarget.password || webhookTarget.search || webhookTarget.hash) return undefined
  } catch {
    return undefined
  }
  return { baseUrl, apiKey, webhookSecret, webhookUrl }
}

export function getAdditionalAllowedAppOrigins() {
  return new Set(
    (environment().DIGIBUSCA_APP_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
}

export function getWhatsAppEvolutionSetupStatus() {
  const config = getEvolutionApiConfig()
  return {
    integrationEnabled: isWhatsAppIntegrationEnabled(),
    evolutionConfigured: Boolean(config),
    webhookConfigured: Boolean(config),
    persistenceConfigured: isWhatsAppWebhookPersistenceConfigured(),
    automationRuntimeEnabled: isWhatsAppAutomationRuntimeEnabled(),
    digiBuscaAgentRuntimeEnabled: isWhatsAppDigiBuscaAgentRuntimeEnabled(),
    agentProviders: getWhatsAppAgentProvidersStatus(),
    prospectingRuntimeEnabled: isWhatsAppProspectingRuntimeEnabled(),
    openBotReplyRuntimeEnabled: isWhatsAppOpenBotReplyRuntimeEnabled(),
    openBotBridgeConfigured: Boolean(getWhatsAppOpenBotBridgeConfig()),
    openBotAgentSafetyConfirmed: environment().WHATSAPP_OPENBOT_AGENT_SAFETY_CONFIRMED?.trim().toLowerCase() === 'true',
  }
}

export function isWhatsAppIntegrationEnabled() {
  return environment().WHATSAPP_INTEGRATION_ENABLED?.trim().toLowerCase() === 'true'
}

export function isWhatsAppAutomationRuntimeEnabled() {
  return isWhatsAppIntegrationEnabled() && environment().WHATSAPP_AUTOMATION_RUNTIME_ENABLED?.trim().toLowerCase() === 'true'
}

export function isWhatsAppProspectingRuntimeEnabled() {
  return isWhatsAppIntegrationEnabled() && environment().WHATSAPP_PROSPECTING_RUNTIME_ENABLED?.trim().toLowerCase() === 'true'
}

export function getWhatsAppOpenBotBridgeConfig() {
  const values = environment()
  const baseUrl = values.WHATSAPP_OPENBOT_BRIDGE_URL?.trim().replace(/\/+$/, '')
  const token = values.WHATSAPP_OPENBOT_BRIDGE_TOKEN?.trim()
  const agentId = getConfiguredWhatsAppOpenBotAgentId()
  if (!baseUrl || !token || !agentId || !/^[a-f0-9]{64}$/.test(token)) return undefined

  try {
    const url = new URL(baseUrl)
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    const isLocalBridge = hostname === '127.0.0.1' && Boolean(url.port)
    const isRemoteOpenBotBridge = hostname === '10.0.4.10' && url.port === '4181'
    if (
      url.protocol !== 'http:' || (!isLocalBridge && !isRemoteOpenBotBridge) ||
      url.pathname !== '/' || url.username || url.password || url.search || url.hash
    ) return undefined
  } catch {
    return undefined
  }

  return { baseUrl, token, agentId }
}

export function getConfiguredWhatsAppOpenBotAgentId() {
  const agentId = environment().WHATSAPP_OPENBOT_AGENT_ID?.trim()
  return agentId && !agentId.startsWith('REPLACE_') && /^[A-Za-z0-9_-]{1,128}$/.test(agentId) ? agentId : undefined
}

export function isWhatsAppOpenBotReplyRuntimeEnabled() {
  const values = environment()
  return isWhatsAppAutomationRuntimeEnabled() &&
    values.WHATSAPP_OPENBOT_REPLY_RUNTIME_ENABLED?.trim().toLowerCase() === 'true' &&
    values.WHATSAPP_OPENBOT_AGENT_SAFETY_CONFIRMED?.trim().toLowerCase() === 'true' &&
    Boolean(getWhatsAppOpenBotBridgeConfig())
}

export function isWhatsAppOpenBotReplyRecoveryConfigured() {
  return Boolean(getConfiguredWhatsAppOpenBotAgentId())
}

function getSupabaseConfig() {
  const values = environment()
  return {
    url: values.SUPABASE_URL ?? values.VITE_SUPABASE_URL,
    anonKey: values.SUPABASE_ANON_KEY ?? values.VITE_SUPABASE_ANON_KEY,
  }
}

export function isSupabaseConfigured() {
  const { url, anonKey } = getSupabaseConfig()
  return Boolean(url && anonKey)
}

export function isWhatsAppWebhookPersistenceConfigured() {
  const values = environment()
  const { url } = getSupabaseConfig()
  return Boolean(url?.trim() && values.SUPABASE_SERVICE_ROLE_KEY?.trim())
}

export function createWhatsAppWebhookSupabaseClient() {
  const values = environment()
  const { url } = getSupabaseConfig()
  const serviceRoleKey = values.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) {
    throw new Error('A persistência autenticada do webhook WhatsApp não está configurada.')
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export type AuthenticatedRequest = {
  accessToken: string
  user: User
}

export function getBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Bearer ')) {
    return undefined
  }

  const token = authorization.slice('Bearer '.length).trim()
  return token || undefined
}

export async function authenticateRequest(
  authorization: string | undefined,
): Promise<AuthenticatedRequest | undefined> {
  const accessToken = getBearerToken(authorization)
  const { url, anonKey } = getSupabaseConfig()
  if (!accessToken || !url || !anonKey) {
    return undefined
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
  const { data, error } = await client.auth.getUser(accessToken)

  if (error || !data.user) {
    return undefined
  }

  return { accessToken, user: data.user }
}

export function createUserSupabaseClient(accessToken: string) {
  const { url, anonKey } = getSupabaseConfig()
  if (!url || !anonKey) {
    throw new Error('Supabase não está configurado no backend.')
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}
