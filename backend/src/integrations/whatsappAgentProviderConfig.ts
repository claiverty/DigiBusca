import type { WhatsAppAgentProvider } from '../contracts/whatsappAutomation.js'
import {
  buildWhatsAppAgentProviderConfig,
  getWhatsAppAgentProviderConfig,
  getWhatsAppAgentProvidersStatus,
  type WhatsAppAgentProviderConfig,
} from '../config/supabase.js'
import { getWhatsAppAiProviderCredential, listWhatsAppAiProviderConnections } from '../data/whatsappAiProviderCredentials.js'

export type WhatsAppAgentProviderConnectionSource = 'panel' | 'server' | 'disconnected' | 'none' | 'unavailable'
export type WhatsAppAgentProvidersState = {
  configured: ReturnType<typeof getWhatsAppAgentProvidersStatus>
  source: Record<'google' | 'anthropic' | 'openaiCompatible', WhatsAppAgentProviderConnectionSource>
}

const defaultModelByProvider: Record<WhatsAppAgentProvider, string> = {
  google: 'gemini-4-hydrogen',
  anthropic: 'claude-3-5-haiku-latest',
  'openai-compatible': 'gpt-4o-mini',
}

export async function getWhatsAppAgentProviderConfigForUser(
  userId: string,
  provider: WhatsAppAgentProvider,
  model: string,
): Promise<WhatsAppAgentProviderConfig | undefined> {
  const storedCredential = await getWhatsAppAiProviderCredential(userId, provider)
  if (!storedCredential) return getWhatsAppAgentProviderConfig(provider, model)
  if (!storedCredential.enabled || !storedCredential.apiKey) return undefined
  return buildWhatsAppAgentProviderConfig(provider, model, storedCredential.apiKey, storedCredential.baseUrl, true)
}

export async function getWhatsAppAgentProvidersStateForUser(userId: string): Promise<WhatsAppAgentProvidersState> {
  const configured = getWhatsAppAgentProvidersStatus()
  const source: WhatsAppAgentProvidersState['source'] = {
    google: configured.google ? 'server' : 'none',
    anthropic: configured.anthropic ? 'server' : 'none',
    openaiCompatible: configured.openaiCompatible ? 'server' : 'none',
  }
  const stored = await listWhatsAppAiProviderConnections(userId)
  if (!stored) return { configured, source }

  for (const connection of stored) {
    const isConfigured = connection.enabled && connection.hasCredential
    const providerKey = connection.provider === 'openai-compatible' ? 'openaiCompatible' : connection.provider
    configured[providerKey] = isConfigured
    source[providerKey] = isConfigured ? 'panel' : 'disconnected'
  }
  return { configured, source }
}

export function getDefaultWhatsAppAgentModel(provider: WhatsAppAgentProvider) {
  return defaultModelByProvider[provider]
}
