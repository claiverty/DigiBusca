import type { WhatsAppAgentProvider } from '../contracts/whatsappAutomation.js'
import { createWhatsAppWebhookSupabaseClient } from '../config/supabase.js'

export type WhatsAppAiProviderCredential = {
  enabled: boolean
  apiKey?: string
  baseUrl?: string
}

export type WhatsAppAiProviderConnectionStatus = {
  provider: WhatsAppAgentProvider
  enabled: boolean
  hasCredential: boolean
}

export class WhatsAppAiProviderCredentialStorageError extends Error {
  constructor(public readonly reason: 'migration_missing' | 'storage_unavailable') {
    super(reason)
    this.name = 'WhatsAppAiProviderCredentialStorageError'
  }
}

function isMissingCredentialMigration(error: { code?: string; message?: string }) {
  return error.code === 'PGRST202' || error.code === '42883'
}

function firstRow<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined
  return value && typeof value === 'object' ? value as T : undefined
}

export async function getWhatsAppAiProviderCredential(userId: string, provider: WhatsAppAgentProvider): Promise<WhatsAppAiProviderCredential | undefined> {
  let result
  try {
    result = await createWhatsAppWebhookSupabaseClient().rpc('get_whatsapp_ai_provider_credential', {
      p_user_id: userId,
      p_provider: provider,
    })
  } catch {
    throw new WhatsAppAiProviderCredentialStorageError('storage_unavailable')
  }
  if (result.error) {
    if (isMissingCredentialMigration(result.error)) throw new WhatsAppAiProviderCredentialStorageError('migration_missing')
    throw new WhatsAppAiProviderCredentialStorageError('storage_unavailable')
  }

  const row = firstRow<{ enabled: boolean; api_key: string | null; base_url: string | null }>(result.data)
  if (!row) return undefined
  return {
    enabled: row.enabled === true,
    apiKey: typeof row.api_key === 'string' ? row.api_key : undefined,
    baseUrl: typeof row.base_url === 'string' ? row.base_url : undefined,
  }
}

export async function listWhatsAppAiProviderConnections(userId: string): Promise<WhatsAppAiProviderConnectionStatus[] | undefined> {
  let result
  try {
    result = await createWhatsAppWebhookSupabaseClient().rpc('list_whatsapp_ai_provider_connections', {
      p_user_id: userId,
    })
  } catch {
    throw new WhatsAppAiProviderCredentialStorageError('storage_unavailable')
  }
  if (result.error) {
    if (isMissingCredentialMigration(result.error)) throw new WhatsAppAiProviderCredentialStorageError('migration_missing')
    throw new WhatsAppAiProviderCredentialStorageError('storage_unavailable')
  }
  const rows = Array.isArray(result.data) ? result.data : []
  return rows.flatMap((row): WhatsAppAiProviderConnectionStatus[] => {
    if (!row || typeof row !== 'object') return []
    const value = row as { provider?: unknown; enabled?: unknown; has_credential?: unknown }
    if (value.provider !== 'google' && value.provider !== 'anthropic' && value.provider !== 'openai-compatible') return []
    return [{
      provider: value.provider,
      enabled: value.enabled === true,
      hasCredential: value.has_credential === true,
    }]
  })
}

export async function saveWhatsAppAiProviderCredential(input: {
  userId: string
  provider: WhatsAppAgentProvider
  apiKey: string
  baseUrl?: string
}): Promise<void> {
  let result
  try {
    result = await createWhatsAppWebhookSupabaseClient().rpc('save_whatsapp_ai_provider_credential', {
      p_user_id: input.userId,
      p_provider: input.provider,
      p_api_key: input.apiKey,
      p_base_url: input.baseUrl ?? null,
    })
  } catch {
    throw new WhatsAppAiProviderCredentialStorageError('storage_unavailable')
  }
  if (result.error) {
    if (isMissingCredentialMigration(result.error)) throw new WhatsAppAiProviderCredentialStorageError('migration_missing')
    throw new WhatsAppAiProviderCredentialStorageError('storage_unavailable')
  }
}

export async function disableWhatsAppAiProviderCredential(userId: string, provider: WhatsAppAgentProvider): Promise<void> {
  let result
  try {
    result = await createWhatsAppWebhookSupabaseClient().rpc('disable_whatsapp_ai_provider_credential', {
      p_user_id: userId,
      p_provider: provider,
    })
  } catch {
    throw new WhatsAppAiProviderCredentialStorageError('storage_unavailable')
  }
  if (result.error) {
    if (isMissingCredentialMigration(result.error)) throw new WhatsAppAiProviderCredentialStorageError('migration_missing')
    throw new WhatsAppAiProviderCredentialStorageError('storage_unavailable')
  }
}
