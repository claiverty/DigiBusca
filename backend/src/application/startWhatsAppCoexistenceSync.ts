import { getWhatsAppEmbeddedSignupServerConfig } from '../config/supabase.js'
import { WhatsAppCoexistenceSyncStoreError, WhatsAppStore } from '../data/whatsappStore.js'
import {
  requestWhatsAppCoexistenceSync,
  WhatsAppCoexistenceSyncProviderError,
  type WhatsAppCoexistenceSyncType,
} from '../integrations/whatsappCoexistenceSync.js'
import { decryptWhatsAppAccessToken, WhatsAppTokenVaultError } from '../integrations/whatsappTokenVault.js'

export type WhatsAppCoexistenceSyncInput = {
  phoneNumberId: string
  syncType: WhatsAppCoexistenceSyncType
}

export class WhatsAppCoexistenceSyncError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'WhatsAppCoexistenceSyncError'
  }
}

export function parseWhatsAppCoexistenceSyncInput(value: unknown): WhatsAppCoexistenceSyncInput | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const body = value as Record<string, unknown>
  if (
    typeof body.phoneNumberId !== 'string' || !body.phoneNumberId.trim() || body.phoneNumberId.length > 128 ||
    (body.syncType !== 'history' && body.syncType !== 'smb_app_state_sync')
  ) return undefined

  const hasConsent = body.syncType === 'history'
    ? body.historyConsent === true
    : body.contactsConsent === true
  if (!hasConsent) return undefined

  return { phoneNumberId: body.phoneNumberId.trim(), syncType: body.syncType }
}

export async function startWhatsAppCoexistenceSync(
  store: WhatsAppStore,
  userId: string,
  input: WhatsAppCoexistenceSyncInput,
) {
  const config = getWhatsAppEmbeddedSignupServerConfig()
  if (!config) {
    throw new WhatsAppCoexistenceSyncError('A configuração segura da Meta e do token de conexão ainda não está disponível.', 503)
  }

  const consentedAt = new Date().toISOString()
  let accessToken: string
  try {
    const credentials = await store.getCoexistenceSyncCredentials(userId, input.phoneNumberId, input.syncType)
    accessToken = await decryptWhatsAppAccessToken(credentials.ciphertext, credentials.iv, config.encryptionKey)
  } catch (error) {
    if (error instanceof WhatsAppCoexistenceSyncStoreError) throw error
    if (error instanceof WhatsAppTokenVaultError) {
      throw new WhatsAppCoexistenceSyncError('O token da conexão não pôde ser aberto com segurança. Refaça a autorização da Meta.', 409)
    }
    throw error
  }

  const { requestedAt } = await store.reserveCoexistenceSync(userId, input.phoneNumberId, input.syncType, consentedAt)

  try {
    const result = await requestWhatsAppCoexistenceSync(
      input.phoneNumberId,
      input.syncType,
      accessToken,
      config.graphApiVersion,
    )
    const acceptedAt = new Date().toISOString()
    await store.recordCoexistenceSyncState(userId, input.phoneNumberId, input.syncType, {
      status: 'accepted',
      syncType: input.syncType,
      consentedAt,
      requestedAt,
      acceptedAt,
      requestId: result.requestId,
    })
    return { status: 'accepted' as const, syncType: input.syncType, requestedAt, requestId: result.requestId }
  } catch (error) {
    if (!(error instanceof WhatsAppCoexistenceSyncProviderError)) throw error
    await store.recordCoexistenceSyncState(userId, input.phoneNumberId, input.syncType, {
      status: error.outcome,
      syncType: input.syncType,
      consentedAt,
      requestedAt,
      resolvedAt: new Date().toISOString(),
      ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
      ...(error.graphErrorCode ? { graphErrorCode: error.graphErrorCode } : {}),
    })
    throw new WhatsAppCoexistenceSyncError(error.message, 502)
  }
}
