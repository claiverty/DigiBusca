import type { SupabaseClient } from '@supabase/supabase-js'
import { createUserSupabaseClient, createWhatsAppWebhookSupabaseClient, getWhatsAppEmbeddedSignupServerConfig } from '../config/supabase.js'
import type { WhatsAppPageOptions } from '../contracts/whatsapp.js'
import type { WhatsAppWebhookEvents } from '../application/whatsappWebhook.js'
import { decryptWhatsAppAccessToken, encryptWhatsAppAccessToken } from '../integrations/whatsappTokenVault.js'
import type { WhatsAppCoexistencePhone } from '../integrations/whatsappEmbeddedSignup.js'
import type { WhatsAppCoexistenceSyncType } from '../integrations/whatsappCoexistenceSync.js'
import type { WhatsAppAutomationProfile, WhatsAppAutomationProfileInput, WhatsAppAutomationStage } from '../contracts/whatsappAutomation.js'

type ConnectionRow = { phone_number_id: string; user_id: string }
type BusinessContactRow = { contact_wa_id: string; contact_name: string | null; is_removed: boolean }
type ConversationRow = {
  id: string
  user_id: string
  phone_number_id: string
  contact_wa_id: string
  contact_name: string | null
  last_message_at: string | null
  last_message_preview: string | null
  last_message_direction: 'inbound' | 'outbound' | null
  automation_paused?: boolean
  automation_opted_out?: boolean
  automation_pause_reason?: string | null
  automation_stage?: WhatsAppAutomationStage
  created_at: string
  updated_at: string
}

export type WhatsAppAutomationRuntimeContext = {
  userId: string
  phoneNumberId: string
  contactWaId: string
  conversationId: string
  accessTokenCiphertext: string | null
  accessTokenIv: string | null
  accessTokenExpiresAt: string | null
  automationPaused: boolean
  automationOptedOut: boolean
  automationStage: WhatsAppAutomationStage
  lastMessageAt: string | null
  lastMessageDirection: 'inbound' | 'outbound' | null
  latestProviderMessageId: string | null
  profile: WhatsAppAutomationProfile | null
  messages: Array<{ direction: 'inbound' | 'outbound'; body: string | null; occurredAt: string }>
}

const validAutomationStages: WhatsAppAutomationStage[] = [
  'identify_responsible', 'request_permission', 'understand_scenario', 'explore_need',
  'present_idea', 'qualify_interest', 'present_conditions', 'confirm_decision', 'closed',
]

function mapAutomationProfile(row: Record<string, unknown>): WhatsAppAutomationProfile {
  return {
    phoneNumberId: row.phone_number_id as string,
    businessName: row.business_name as string,
    senderIdentity: row.sender_identity as string,
    serviceSummary: row.service_summary as string,
    approvedFacts: row.approved_facts as string,
    escalationContact: row.escalation_contact as string,
    automationEnabled: row.automation_enabled === true,
    channelApprovedAt: row.channel_approved_at as string | null,
    contentApprovedAt: row.content_approved_at as string | null,
    updatedAt: row.updated_at as string,
  }
}
type MessageRow = {
  id: string
  provider_message_id: string
  phone_number_id: string
  conversation_id: string
  contact_wa_id: string
  direction: 'inbound' | 'outbound'
  message_type: string
  body: string | null
  is_placeholder: boolean
  occurred_at: string
  created_at: string
}
type StatusRow = {
  provider_message_id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  occurred_at: string
}

function throwIfError(error: { message: string } | null, message = 'Não foi possível acessar as conversas do WhatsApp.') {
  if (error) throw new Error(message)
}

export class WhatsAppConnectionConflictError extends Error {
  constructor() {
    super('Este número WhatsApp já está associado a outra conta DigiBusca.')
    this.name = 'WhatsAppConnectionConflictError'
  }
}

export class WhatsAppCoexistenceSyncStoreError extends Error {
  constructor(message: string, readonly status: 403 | 404 | 409 | 500) {
    super(message)
    this.name = 'WhatsAppCoexistenceSyncStoreError'
  }
}

function syncStateColumn(syncType: WhatsAppCoexistenceSyncType) {
  return syncType === 'history' ? 'history_sync_state' : 'app_state_sync_state'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasCoexistenceSyncRequest(value: unknown) {
  if (!isRecord(value)) return false
  return typeof value.requestStatus === 'string' ||
    typeof value.requestId === 'string' ||
    typeof value.requestedAt === 'string' ||
    typeof value.consentedAt === 'string'
}

function syncEventStatus(syncType: WhatsAppCoexistenceSyncType, state: Record<string, unknown>) {
  if (syncType === 'smb_app_state_sync') return 'in_progress'
  if (Array.isArray(state.errors) && state.errors.length > 0) return 'failed'
  const progress = typeof state.progress === 'number' ? state.progress : Number(state.progress)
  return Number.isFinite(progress) && progress >= 100 ? 'complete' : 'in_progress'
}

function mergeSyncStatus(previous: unknown, next: string) {
  const priority: Record<string, number> = {
    requesting: 0,
    accepted: 1,
    unknown: 2,
    rejected: 2,
    failed: 2,
    in_progress: 3,
    complete: 4,
  }
  return typeof previous === 'string' && (priority[previous] ?? -1) > (priority[next] ?? -1)
    ? previous
    : next
}

function dedupeByKey<T>(items: T[], keyFor: (item: T) => string) {
  const unique = new Map<string, T>()
  for (const item of items) {
    const key = keyFor(item)
    if (!unique.has(key)) unique.set(key, item)
  }
  return [...unique.values()]
}

function latestPage<T extends { id: string }>(rows: T[], limit: number, timestampFor: (row: T) => string) {
  const hasMore = rows.length > limit
  const data = rows.slice(0, limit)
  const last = data.at(-1)
  return {
    data,
    nextCursor: hasMore && last ? `${timestampFor(last)}~${last.id}` : undefined,
  }
}

function cursorFilter(column: string, cursor: NonNullable<WhatsAppPageOptions['before']>) {
  return `${column}.lt.${cursor.timestamp},and(${column}.eq.${cursor.timestamp},id.lt.${cursor.id})`
}

export class WhatsAppStore {
  private userClient(accessToken: string): SupabaseClient {
    return createUserSupabaseClient(accessToken)
  }

  async isCoexistenceStorageReady() {
    try {
      const admin = createWhatsAppWebhookSupabaseClient()
      const result = await admin.from('whatsapp_business_contacts').select('phone_number_id').limit(0)
      return !result.error
    } catch {
      return false
    }
  }

  async isAutomationStorageReady() {
    try {
      const admin = createWhatsAppWebhookSupabaseClient()
      const result = await admin.from('whatsapp_automation_profiles').select('phone_number_id').limit(0)
      if (result.error) return false
      const runs = await admin.from('whatsapp_automation_runs').select('id').limit(0)
      return !runs.error
    } catch {
      return false
    }
  }

  async getAutomationProfile(userId: string, phoneNumberId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const ownership = await admin.from('whatsapp_phone_number_connections')
      .select('phone_number_id').eq('user_id', userId).eq('phone_number_id', phoneNumberId).maybeSingle()
    throwIfError(ownership.error, 'Não foi possível validar o número WhatsApp selecionado.')
    if (!ownership.data) return undefined

    const result = await admin.from('whatsapp_automation_profiles')
      .select('phone_number_id, business_name, sender_identity, service_summary, approved_facts, escalation_contact, automation_enabled, channel_approved_at, content_approved_at, updated_at')
      .eq('user_id', userId).eq('phone_number_id', phoneNumberId).maybeSingle()
    throwIfError(result.error, 'Não foi possível carregar as regras de atendimento automático.')
    return result.data ? mapAutomationProfile(result.data as Record<string, unknown>) : undefined
  }

  async saveAutomationProfile(userId: string, input: WhatsAppAutomationProfileInput) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const ownership = await admin.from('whatsapp_phone_number_connections')
      .select('phone_number_id').eq('user_id', userId).eq('phone_number_id', input.phoneNumberId).maybeSingle()
    throwIfError(ownership.error, 'Não foi possível validar o número WhatsApp selecionado.')
    if (!ownership.data) throw new Error('O número WhatsApp não está conectado a esta conta.')

    const approvedAt = new Date().toISOString()
    const values = {
      user_id: userId,
      phone_number_id: input.phoneNumberId,
      business_name: input.businessName,
      sender_identity: input.senderIdentity,
      service_summary: input.serviceSummary,
      approved_facts: input.approvedFacts,
      escalation_contact: input.escalationContact,
      automation_enabled: input.automationEnabled,
      channel_approved_at: input.channelApproved ? approvedAt : null,
      content_approved_at: input.contentApproved ? approvedAt : null,
      updated_at: approvedAt,
    }
    const result = await admin.from('whatsapp_automation_profiles')
      .upsert(values, { onConflict: 'phone_number_id,user_id' })
      .select('phone_number_id, business_name, sender_identity, service_summary, approved_facts, escalation_contact, automation_enabled, channel_approved_at, content_approved_at, updated_at')
      .single()
    throwIfError(result.error, 'Não foi possível salvar as regras de atendimento automático.')
    return mapAutomationProfile(result.data as Record<string, unknown>)
  }

  async setConversationAutomationPaused(userId: string, conversationId: string, paused: boolean, reason = 'manual') {
    const admin = createWhatsAppWebhookSupabaseClient()
    let query = admin.from('whatsapp_conversations')
      .update({ automation_paused: paused, automation_pause_reason: paused ? reason : null })
      .eq('id', conversationId).eq('user_id', userId)
    if (!paused) query = query.eq('automation_opted_out', false)
    const result = await query
      .select('id').maybeSingle()
    throwIfError(result.error, 'Não foi possível atualizar a automação desta conversa.')
    return Boolean(result.data)
  }

  async markConversationOptedOut(userId: string, conversationId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_conversations')
      .update({ automation_paused: true, automation_opted_out: true, automation_pause_reason: 'opt_out' })
      .eq('id', conversationId).eq('user_id', userId)
    throwIfError(result.error, 'Não foi possível registrar o pedido de parada desta conversa.')
  }

  async getAutomationRuntimeContext(phoneNumberId: string, contactWaId: string): Promise<WhatsAppAutomationRuntimeContext | undefined> {
    const admin = createWhatsAppWebhookSupabaseClient()
    const connectionResult = await admin.from('whatsapp_phone_number_connections')
      .select('user_id, phone_number_id, access_token_ciphertext, access_token_iv, access_token_expires_at')
      .eq('phone_number_id', phoneNumberId).maybeSingle()
    throwIfError(connectionResult.error, 'Não foi possível carregar a conexão WhatsApp para responder.')
    if (!connectionResult.data) return undefined
    const connection = connectionResult.data as {
      user_id: string; phone_number_id: string; access_token_ciphertext: string | null;
      access_token_iv: string | null; access_token_expires_at: string | null
    }

    const [conversationResult, profileResult] = await Promise.all([
      admin.from('whatsapp_conversations')
        .select('id, automation_paused, automation_opted_out, automation_stage, last_message_at, last_message_direction')
        .eq('user_id', connection.user_id).eq('phone_number_id', phoneNumberId)
        .eq('contact_wa_id', contactWaId).maybeSingle(),
      admin.from('whatsapp_automation_profiles')
        .select('phone_number_id, business_name, sender_identity, service_summary, approved_facts, escalation_contact, automation_enabled, channel_approved_at, content_approved_at, updated_at')
        .eq('user_id', connection.user_id).eq('phone_number_id', phoneNumberId).maybeSingle(),
    ])
    throwIfError(conversationResult.error, 'Não foi possível carregar a conversa para responder.')
    throwIfError(profileResult.error, 'Não foi possível carregar as regras de atendimento automático.')
    if (!conversationResult.data) return undefined
    const conversation = conversationResult.data as {
      id: string; automation_paused: boolean | null; automation_opted_out: boolean | null; automation_stage: string | null;
      last_message_at: string | null; last_message_direction: 'inbound' | 'outbound' | null
    }
    const stage = validAutomationStages.includes(conversation.automation_stage as WhatsAppAutomationStage)
      ? conversation.automation_stage as WhatsAppAutomationStage
      : 'identify_responsible'
    const messagesResult = await admin.from('whatsapp_messages')
      .select('provider_message_id, direction, body, occurred_at').eq('user_id', connection.user_id)
      .eq('phone_number_id', phoneNumberId).eq('conversation_id', conversation.id)
      .order('occurred_at', { ascending: false }).order('created_at', { ascending: false }).limit(12)
    throwIfError(messagesResult.error, 'Não foi possível carregar o contexto recente da conversa.')

    return {
      userId: connection.user_id,
      phoneNumberId,
      contactWaId,
      conversationId: conversation.id,
      accessTokenCiphertext: connection.access_token_ciphertext,
      accessTokenIv: connection.access_token_iv,
      accessTokenExpiresAt: connection.access_token_expires_at,
      automationPaused: conversation.automation_paused === true,
      automationOptedOut: conversation.automation_opted_out === true,
      automationStage: stage,
      lastMessageAt: conversation.last_message_at,
      lastMessageDirection: conversation.last_message_direction,
      latestProviderMessageId: ((messagesResult.data ?? []) as Array<{ provider_message_id: string }>)[0]?.provider_message_id ?? null,
      profile: profileResult.data ? mapAutomationProfile(profileResult.data as Record<string, unknown>) : null,
      messages: ((messagesResult.data ?? []) as Array<{ direction: 'inbound' | 'outbound'; body: string | null; occurred_at: string }>)
        .reverse().map(({ direction, body, occurred_at }) => ({ direction, body, occurredAt: occurred_at })),
    }
  }

  async claimAutomationRun(userId: string, phoneNumberId: string, conversationId: string, inboundProviderMessageId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_automation_runs').upsert({
      user_id: userId,
      phone_number_id: phoneNumberId,
      conversation_id: conversationId,
      inbound_provider_message_id: inboundProviderMessageId,
      status: 'processing',
    }, { onConflict: 'phone_number_id,inbound_provider_message_id', ignoreDuplicates: true })
      .select('id').maybeSingle()
    throwIfError(result.error, 'Não foi possível reservar a resposta automática.')
    return result.data?.id as string | undefined
  }

  async completeAutomationRun(runId: string, status: 'sent' | 'skipped' | 'needs_human' | 'failed', reason?: string, replyMessageId?: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_automation_runs').update({
      status,
      reason: reason ?? null,
      reply_provider_message_id: replyMessageId ?? null,
      completed_at: new Date().toISOString(),
    }).eq('id', runId)
    throwIfError(result.error, 'Não foi possível registrar o resultado da resposta automática.')
  }

  async persistAutomatedReply(input: {
    userId: string; phoneNumberId: string; conversationId: string; contactWaId: string;
    providerMessageId: string; body: string; occurredAt: string
  }) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_messages').upsert({
      user_id: input.userId,
      phone_number_id: input.phoneNumberId,
      conversation_id: input.conversationId,
      provider_message_id: input.providerMessageId,
      contact_wa_id: input.contactWaId,
      direction: 'outbound',
      message_type: 'text',
      body: input.body,
      is_placeholder: false,
      occurred_at: input.occurredAt,
    }, { onConflict: 'phone_number_id,provider_message_id', ignoreDuplicates: true })
    throwIfError(result.error, 'Não foi possível salvar a resposta automática enviada.')
  }

  async updateAutomationStage(conversationId: string, stage: WhatsAppAutomationStage) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_conversations').update({ automation_stage: stage }).eq('id', conversationId)
    throwIfError(result.error, 'Não foi possível atualizar a etapa do atendimento automático.')
  }

  async connectCoexistencePhone(
    userId: string,
    wabaId: string,
    phone: WhatsAppCoexistencePhone,
    accessToken: string,
    tokenExpiresAt?: string,
  ) {
    const config = getWhatsAppEmbeddedSignupServerConfig()
    if (!config) throw new Error('A configuração segura do Embedded Signup está incompleta.')
    const encrypted = await encryptWhatsAppAccessToken(accessToken, config.encryptionKey)
    const admin = createWhatsAppWebhookSupabaseClient()
    const existing = await admin
      .from('whatsapp_phone_number_connections')
      .select('user_id')
      .eq('phone_number_id', phone.id)
      .maybeSingle()
    throwIfError(existing.error, 'Não foi possível validar a associação do número WhatsApp.')
    if (existing.data && existing.data.user_id !== userId) {
      throw new WhatsAppConnectionConflictError()
    }

    const values = {
      user_id: userId,
      phone_number_id: phone.id,
      waba_id: wabaId,
      display_phone_number: phone.display_phone_number ?? null,
      access_token_ciphertext: encrypted.ciphertext,
      access_token_iv: encrypted.iv,
      access_token_expires_at: tokenExpiresAt ?? null,
      is_on_biz_app: phone.is_on_biz_app === true,
      platform_type: phone.platform_type ?? null,
      updated_at: new Date().toISOString(),
    }
    const saved = existing.data
      ? await admin.from('whatsapp_phone_number_connections').update(values)
          .eq('phone_number_id', phone.id).eq('user_id', userId)
      : await admin.from('whatsapp_phone_number_connections').insert(values)
    throwIfError(saved.error, 'Não foi possível guardar a conexão WhatsApp desta conta.')
    return {
      phoneNumberId: phone.id,
      wabaId,
      displayPhoneNumber: phone.display_phone_number ?? null,
      isOnBizApp: phone.is_on_biz_app === true,
      platformType: phone.platform_type ?? null,
      historySyncState: null,
      appStateSyncState: null,
      connectedAt: new Date().toISOString(),
    }
  }

  async listConnections(userId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin
      .from('whatsapp_phone_number_connections')
      .select('phone_number_id, waba_id, display_phone_number, is_on_biz_app, platform_type, history_sync_state, app_state_sync_state, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    throwIfError(result.error, 'Não foi possível carregar as conexões WhatsApp desta conta.')
    return (result.data ?? []).map((row) => ({
      phoneNumberId: row.phone_number_id as string,
      wabaId: row.waba_id as string | null,
      displayPhoneNumber: row.display_phone_number as string | null,
      isOnBizApp: row.is_on_biz_app === true,
      platformType: row.platform_type as string | null,
      historySyncState: row.history_sync_state as Record<string, unknown> | null,
      appStateSyncState: row.app_state_sync_state as Record<string, unknown> | null,
      connectedAt: row.created_at as string,
    }))
  }

  async getCoexistenceSyncCredentials(userId: string, phoneNumberId: string, syncType: WhatsAppCoexistenceSyncType) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const stateColumn = syncStateColumn(syncType)
    const result = await admin.from('whatsapp_phone_number_connections')
      .select(`is_on_biz_app, access_token_ciphertext, access_token_iv, access_token_expires_at, created_at, ${stateColumn}`)
      .eq('phone_number_id', phoneNumberId)
      .eq('user_id', userId)
      .maybeSingle()
    throwIfError(result.error, 'Não foi possível validar a conexão WhatsApp para sincronização.')
    if (!result.data) {
      throw new WhatsAppCoexistenceSyncStoreError('O número não está conectado a esta conta DigiBusca.', 404)
    }

    const row = result.data as Record<string, unknown>
    if (row.is_on_biz_app !== true) {
      throw new WhatsAppCoexistenceSyncStoreError('A sincronização está disponível somente para números em coexistência com o app WhatsApp Business.', 409)
    }
    const connectedAt = typeof row.created_at === 'string' ? Date.parse(row.created_at) : Number.NaN
    if (!Number.isFinite(connectedAt) || Date.now() - connectedAt > 24 * 60 * 60 * 1_000 || connectedAt > Date.now() + 5 * 60 * 1_000) {
      throw new WhatsAppCoexistenceSyncStoreError('A janela da Meta para pedir esta sincronização (24 horas após a conexão) já expirou.', 409)
    }
    if (hasCoexistenceSyncRequest(row[stateColumn])) {
      throw new WhatsAppCoexistenceSyncStoreError('Este pedido de sincronização já foi iniciado. A Meta permite uma tentativa por tipo.', 409)
    }
    if (typeof row.access_token_ciphertext !== 'string' || typeof row.access_token_iv !== 'string') {
      throw new WhatsAppCoexistenceSyncStoreError('O token seguro desta conexão não está disponível.', 409)
    }
    const expiresAt = typeof row.access_token_expires_at === 'string' ? Date.parse(row.access_token_expires_at) : undefined
    if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30_000)) {
      throw new WhatsAppCoexistenceSyncStoreError('O token da conexão expirou. Refaça a autorização da Meta antes de sincronizar.', 409)
    }
    return {
      ciphertext: row.access_token_ciphertext,
      iv: row.access_token_iv,
    }
  }

  async reserveCoexistenceSync(
    userId: string,
    phoneNumberId: string,
    syncType: WhatsAppCoexistenceSyncType,
    consentedAt: string,
  ) {
    // Re-read and compare-and-set the nullable sync state so concurrent clicks cannot
    // trigger two one-time requests to Meta for the same phone and sync type.
    const admin = createWhatsAppWebhookSupabaseClient()
    const stateColumn = syncStateColumn(syncType)
    const current = await admin.from('whatsapp_phone_number_connections')
      .select(`is_on_biz_app, access_token_ciphertext, access_token_iv, access_token_expires_at, created_at, ${stateColumn}`)
      .eq('phone_number_id', phoneNumberId)
      .eq('user_id', userId)
      .maybeSingle()
    throwIfError(current.error, 'Não foi possível validar a conexão WhatsApp para sincronização.')
    if (!current.data) throw new WhatsAppCoexistenceSyncStoreError('O número não está conectado a esta conta DigiBusca.', 404)
    const row = current.data as Record<string, unknown>
    if (row.is_on_biz_app !== true) {
      throw new WhatsAppCoexistenceSyncStoreError('A sincronização está disponível somente para números em coexistência com o app WhatsApp Business.', 409)
    }
    const connectedAt = typeof row.created_at === 'string' ? Date.parse(row.created_at) : Number.NaN
    if (!Number.isFinite(connectedAt) || Date.now() - connectedAt > 24 * 60 * 60 * 1_000 || connectedAt > Date.now() + 5 * 60 * 1_000) {
      throw new WhatsAppCoexistenceSyncStoreError('A janela da Meta para pedir esta sincronização (24 horas após a conexão) já expirou.', 409)
    }
    if (hasCoexistenceSyncRequest(row[stateColumn])) {
      throw new WhatsAppCoexistenceSyncStoreError('Este pedido de sincronização já foi iniciado. A Meta permite uma tentativa por tipo.', 409)
    }
    if (typeof row.access_token_ciphertext !== 'string' || typeof row.access_token_iv !== 'string') {
      throw new WhatsAppCoexistenceSyncStoreError('O token seguro desta conexão não está disponível.', 409)
    }
    const expiresAt = typeof row.access_token_expires_at === 'string' ? Date.parse(row.access_token_expires_at) : undefined
    if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 30_000)) {
      throw new WhatsAppCoexistenceSyncStoreError('O token da conexão expirou. Refaça a autorização da Meta antes de sincronizar.', 409)
    }

    const requestedAt = new Date().toISOString()
    const currentState = isRecord(row[stateColumn]) ? row[stateColumn] as Record<string, unknown> : {}
    const reservation = {
      ...currentState,
      status: 'requesting',
      requestStatus: 'requesting',
      syncType,
      consentedAt,
      requestedAt,
    }
    const reserved = await admin.from('whatsapp_phone_number_connections')
      .update({ [stateColumn]: reservation, updated_at: requestedAt })
      .eq('phone_number_id', phoneNumberId)
      .eq('user_id', userId)
      .is(`${stateColumn}->>requestStatus`, null)
      .is(`${stateColumn}->>requestId`, null)
      .is(`${stateColumn}->>requestedAt`, null)
      .is(`${stateColumn}->>consentedAt`, null)
      .select('phone_number_id')
      .maybeSingle()
    throwIfError(reserved.error, 'Não foi possível reservar o pedido de sincronização.')
    if (!reserved.data) {
      throw new WhatsAppCoexistenceSyncStoreError('Outro pedido de sincronização já foi iniciado para este número.', 409)
    }
    return { requestedAt }
  }

  async recordCoexistenceSyncState(
    userId: string,
    phoneNumberId: string,
    syncType: WhatsAppCoexistenceSyncType,
    patch: Record<string, unknown>,
  ) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const stateColumn = syncStateColumn(syncType)
    const current = await admin.from('whatsapp_phone_number_connections')
      .select(stateColumn)
      .eq('phone_number_id', phoneNumberId)
      .eq('user_id', userId)
      .maybeSingle()
    throwIfError(current.error, 'Não foi possível carregar o estado da sincronização.')
    if (!current.data) throw new WhatsAppCoexistenceSyncStoreError('O número não está conectado a esta conta DigiBusca.', 404)
    const currentRow = current.data as Record<string, unknown>
    const previous = isRecord(currentRow[stateColumn]) ? currentRow[stateColumn] as Record<string, unknown> : {}
    const merged = { ...previous, ...patch }
    if (typeof patch.status === 'string') merged.status = mergeSyncStatus(previous.status, patch.status)
    if (typeof patch.requestStatus === 'string') merged.requestStatus = mergeSyncStatus(previous.requestStatus, patch.requestStatus)
    const updated = await admin.from('whatsapp_phone_number_connections')
      .update({ [stateColumn]: merged, updated_at: new Date().toISOString() })
      .eq('phone_number_id', phoneNumberId)
      .eq('user_id', userId)
    throwIfError(updated.error, 'Não foi possível salvar o estado da sincronização.')
  }

  async persistWebhookEvents(events: WhatsAppWebhookEvents): Promise<void> {
    const phoneNumberIds = [...new Set([
      ...events.messages.map((event) => event.phoneNumberId),
      ...events.statuses.map((event) => event.phoneNumberId),
      ...events.contacts.map((event) => event.phoneNumberId),
      ...events.syncStates.map((event) => event.phoneNumberId),
    ])]
    if (phoneNumberIds.length === 0) return

    const admin = createWhatsAppWebhookSupabaseClient()
    const connectionResult = await admin
      .from('whatsapp_phone_number_connections')
      .select('phone_number_id, user_id')
      .in('phone_number_id', phoneNumberIds)
    throwIfError(connectionResult.error, 'Não foi possível validar a conexão WhatsApp do webhook.')
    const connections = new Map((connectionResult.data as ConnectionRow[]).map((row) => [row.phone_number_id, row]))

    const mappedPhoneIds = phoneNumberIds.filter((phoneNumberId) => connections.has(phoneNumberId))
    for (const phoneNumberId of mappedPhoneIds) {
      const connection = connections.get(phoneNumberId)!
      const messages = events.messages.filter((event) => event.phoneNumberId === phoneNumberId)
      const statuses = events.statuses.filter((event) => event.phoneNumberId === phoneNumberId)
      const contactEvents = events.contacts.flatMap((event) => event.phoneNumberId === phoneNumberId ? event.contacts : [])
      const syncStates = events.syncStates.filter((event) => event.phoneNumberId === phoneNumberId)
      const contactNames = new Map<string, string>()
      const contacts = new Set<string>()
      for (const message of messages) {
        contacts.add(message.contactWaId)
        if (message.contactName) contactNames.set(message.contactWaId, message.contactName)
      }
      for (const status of statuses) {
        contacts.add(status.recipientWaId)
      }
      for (const contact of contactEvents) contacts.add(contact.contactWaId)

      if (contactEvents.length > 0) {
        const contactRows = dedupeByKey(contactEvents, (contact) => contact.contactWaId).map((contact) => ({
          user_id: connection.user_id,
          phone_number_id: phoneNumberId,
          contact_wa_id: contact.contactWaId,
          contact_name: contact.action === 'remove' ? null : contact.contactName ?? null,
          is_removed: contact.action === 'remove',
          updated_at: contact.occurredAt,
        }))
        const contactResult = await admin
          .from('whatsapp_business_contacts')
          .upsert(contactRows, { onConflict: 'phone_number_id,contact_wa_id' })
        throwIfError(contactResult.error, 'Não foi possível sincronizar os contatos do WhatsApp Business App.')
        for (const contact of contactEvents) {
          if (contact.action === 'remove') contactNames.delete(contact.contactWaId)
          else if (contact.contactName) contactNames.set(contact.contactWaId, contact.contactName)
        }
        const removedIds = contactEvents.filter((contact) => contact.action === 'remove').map((contact) => contact.contactWaId)
        if (removedIds.length > 0) {
          const updateNames = await admin
            .from('whatsapp_conversations')
            .update({ contact_name: null })
            .eq('user_id', connection.user_id)
            .eq('phone_number_id', phoneNumberId)
            .in('contact_wa_id', removedIds)
          throwIfError(updateNames.error, 'Não foi possível atualizar os contatos da caixa de entrada.')
        }
      }

      for (const syncState of syncStates) {
        const stateColumn = syncState.syncType === 'history' ? 'history_sync_state' : 'app_state_sync_state'
        const previousResult = await admin.from('whatsapp_phone_number_connections')
          .select(stateColumn)
          .eq('phone_number_id', phoneNumberId)
          .eq('user_id', connection.user_id)
          .maybeSingle()
        throwIfError(previousResult.error, 'Não foi possível carregar o estado da sincronização WhatsApp.')
        const previousRow = previousResult.data as Record<string, unknown> | null
        const previous = previousRow && isRecord(previousRow[stateColumn])
          ? previousRow[stateColumn] as Record<string, unknown>
          : {}
        const status = syncEventStatus(syncState.syncType, syncState.state)
        if (syncState.syncType === 'smb_app_state_sync' && !hasCoexistenceSyncRequest(previous)) continue
        const stateResult = await admin.from('whatsapp_phone_number_connections')
          .update({
            [stateColumn]: {
              ...previous,
              status: mergeSyncStatus(previous.status, status),
              requestStatus: mergeSyncStatus(previous.requestStatus, status),
              syncType: syncState.syncType,
              providerState: syncState.state,
              lastWebhookAt: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('phone_number_id', phoneNumberId)
          .eq('user_id', connection.user_id)
        throwIfError(stateResult.error, 'Não foi possível atualizar o estado da sincronização WhatsApp.')
      }

      const conversationInputs = [...contacts].map((contactWaId) => ({
        user_id: connection.user_id,
        phone_number_id: phoneNumberId,
        contact_wa_id: contactWaId,
      }))
      if (conversationInputs.length === 0) continue

      if (contacts.size > 0) {
        const linkedContactResult = await admin
          .from('whatsapp_business_contacts')
          .select('contact_wa_id, contact_name, is_removed')
          .eq('user_id', connection.user_id)
          .eq('phone_number_id', phoneNumberId)
          .in('contact_wa_id', [...contacts])
        throwIfError(linkedContactResult.error, 'Não foi possível carregar os contatos sincronizados do WhatsApp.')
        for (const contact of linkedContactResult.data as BusinessContactRow[]) {
          if (contact.is_removed) contactNames.delete(contact.contact_wa_id)
          else if (contact.contact_name) contactNames.set(contact.contact_wa_id, contact.contact_name)
        }
      }

      const conversationUpsert = await admin
        .from('whatsapp_conversations')
        .upsert(dedupeByKey(conversationInputs, (item) => item.contact_wa_id), {
          onConflict: 'phone_number_id,contact_wa_id',
          ignoreDuplicates: true,
        })
      throwIfError(conversationUpsert.error, 'Não foi possível preparar as conversas do webhook.')

      const namedConversationInputs = [...contactNames.entries()].map(([contactWaId, contactName]) => ({
        user_id: connection.user_id,
        phone_number_id: phoneNumberId,
        contact_wa_id: contactWaId,
        contact_name: contactName,
      }))
      if (namedConversationInputs.length > 0) {
        const namedConversationResult = await admin
          .from('whatsapp_conversations')
          .upsert(namedConversationInputs, { onConflict: 'phone_number_id,contact_wa_id' })
        throwIfError(namedConversationResult.error, 'Não foi possível atualizar os nomes das conversas.')
      }

      const contactWaIds = conversationInputs.map((item) => item.contact_wa_id)
      const conversationResult = await admin
        .from('whatsapp_conversations')
        .select('id, user_id, phone_number_id, contact_wa_id')
        .eq('user_id', connection.user_id)
        .eq('phone_number_id', phoneNumberId)
        .in('contact_wa_id', contactWaIds)
      throwIfError(conversationResult.error, 'Não foi possível preparar as conversas do webhook.')
      const conversations = new Map(
        (conversationResult.data as Pick<ConversationRow, 'id' | 'user_id' | 'phone_number_id' | 'contact_wa_id'>[])
          .map((row) => [row.contact_wa_id, row]),
      )

      const providerMessageRows = messages.flatMap((event) => {
        const conversation = conversations.get(event.contactWaId)
        if (!conversation) return []
        return [{
          user_id: connection.user_id,
          phone_number_id: phoneNumberId,
          conversation_id: conversation.id,
          provider_message_id: event.providerMessageId,
          contact_wa_id: event.contactWaId,
          direction: event.direction,
          message_type: event.messageType,
          body: event.body ?? null,
          is_placeholder: false,
          occurred_at: event.occurredAt,
        }]
      })
      const placeholderRows = statuses.flatMap((event) => {
        const conversation = conversations.get(event.recipientWaId)
        if (!conversation) return []
        return [{
          user_id: connection.user_id,
          phone_number_id: phoneNumberId,
          conversation_id: conversation.id,
          provider_message_id: event.providerMessageId,
          contact_wa_id: event.recipientWaId,
          direction: 'outbound' as const,
          message_type: 'unknown',
          body: null,
          is_placeholder: true,
          occurred_at: event.occurredAt,
        }]
      })
      const placeholderMessageRows = dedupeByKey(placeholderRows, (item) => item.provider_message_id)
      const messageRows = dedupeByKey(providerMessageRows, (item) => item.provider_message_id)

      if (placeholderMessageRows.length > 0) {
        const messageResult = await admin
          .from('whatsapp_messages')
          .upsert(placeholderMessageRows, {
            onConflict: 'phone_number_id,provider_message_id',
            ignoreDuplicates: true,
          })
        throwIfError(messageResult.error, 'Não foi possível salvar as mensagens do webhook.')
      }
      if (messageRows.length > 0) {
        const messageResult = await admin
          .from('whatsapp_messages')
          .upsert(messageRows, { onConflict: 'phone_number_id,provider_message_id' })
        throwIfError(messageResult.error, 'Não foi possível atualizar as mensagens do webhook.')
      }

      const statusRows = statuses.flatMap((event) => {
        const conversation = conversations.get(event.recipientWaId)
        if (!conversation) return []
        return [{
          user_id: connection.user_id,
          phone_number_id: phoneNumberId,
          conversation_id: conversation.id,
          provider_message_id: event.providerMessageId,
          recipient_wa_id: event.recipientWaId,
          status: event.status,
          occurred_at: event.occurredAt,
        }]
      })
      if (statusRows.length > 0) {
        const statusResult = await admin
          .from('whatsapp_message_status_events')
          .upsert(statusRows, {
            onConflict: 'phone_number_id,provider_message_id,status,occurred_at,recipient_wa_id',
            ignoreDuplicates: true,
          })
        throwIfError(statusResult.error, 'Não foi possível salvar os status do webhook.')
      }
    }
  }

  async listConversations(accessToken: string, userId: string, options: WhatsAppPageOptions) {
    let query = this.userClient(accessToken)
      .from('whatsapp_conversations')
      .select('id, user_id, phone_number_id, contact_wa_id, contact_name, last_message_at, last_message_preview, last_message_direction, automation_paused, automation_opted_out, automation_pause_reason, created_at, updated_at')
      .eq('user_id', userId)
      .not('last_message_at', 'is', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(options.limit + 1)
    if (options.before) query = query.or(cursorFilter('last_message_at', options.before))

    const result = await query
    throwIfError(result.error)
    const page = latestPage(result.data as ConversationRow[], options.limit, (row) => row.last_message_at!)
    return {
      data: page.data.map((row) => ({
        id: row.id,
        phoneNumberId: row.phone_number_id,
        contactWaId: row.contact_wa_id,
        contactName: row.contact_name ?? undefined,
        lastMessageAt: row.last_message_at ?? undefined,
        lastMessagePreview: row.last_message_preview ?? undefined,
        lastMessageDirection: row.last_message_direction ?? undefined,
        automationPaused: row.automation_paused === true,
        automationOptedOut: row.automation_opted_out === true,
        automationPauseReason: row.automation_pause_reason ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      nextCursor: page.nextCursor,
    }
  }

  async listConversationMessages(
    accessToken: string,
    userId: string,
    conversationId: string,
    options: WhatsAppPageOptions,
  ) {
    const client = this.userClient(accessToken)
    const conversationResult = await client
      .from('whatsapp_conversations')
      .select('id, user_id, phone_number_id, contact_wa_id')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .maybeSingle()
    throwIfError(conversationResult.error)
    if (!conversationResult.data) return undefined
    const conversation = conversationResult.data as Pick<ConversationRow, 'id' | 'user_id' | 'phone_number_id' | 'contact_wa_id'>

    let messageQuery = client
      .from('whatsapp_messages')
      .select('id, provider_message_id, phone_number_id, conversation_id, contact_wa_id, direction, message_type, body, is_placeholder, occurred_at, created_at')
      .eq('user_id', userId)
      .eq('phone_number_id', conversation.phone_number_id)
      .eq('conversation_id', conversation.id)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(options.limit + 1)
    if (options.before) messageQuery = messageQuery.or(cursorFilter('occurred_at', options.before))

    const messageResult = await messageQuery
    throwIfError(messageResult.error)
    const page = latestPage(messageResult.data as MessageRow[], options.limit, (row) => row.occurred_at)
    const messageRows = page.data
    const providerMessageIds = [...new Set(messageRows.map((row) => row.provider_message_id))]
    const statusesByMessage = new Map<string, Array<{ status: StatusRow['status']; occurredAt: string }>>()

    if (providerMessageIds.length > 0) {
      const statusResult = await client
        .from('whatsapp_message_status_events')
        .select('provider_message_id, status, occurred_at')
        .eq('user_id', userId)
        .eq('phone_number_id', conversation.phone_number_id)
        .in('provider_message_id', providerMessageIds)
        .order('occurred_at', { ascending: true })
      throwIfError(statusResult.error)
      for (const row of statusResult.data as StatusRow[]) {
        const statuses = statusesByMessage.get(row.provider_message_id) ?? []
        statuses.push({ status: row.status, occurredAt: row.occurred_at })
        statusesByMessage.set(row.provider_message_id, statuses)
      }
    }

    return {
      data: messageRows.map((row) => ({
        id: row.id,
        providerMessageId: row.provider_message_id,
        contactWaId: row.contact_wa_id,
        direction: row.direction,
        messageType: row.message_type,
        body: row.body ?? undefined,
        isPlaceholder: row.is_placeholder,
        occurredAt: row.occurred_at,
        createdAt: row.created_at,
        statuses: statusesByMessage.get(row.provider_message_id) ?? [],
      })),
      nextCursor: page.nextCursor,
    }
  }
}
