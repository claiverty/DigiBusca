import type { SupabaseClient } from '@supabase/supabase-js'
import { createUserSupabaseClient, createWhatsAppWebhookSupabaseClient } from '../config/supabase.js'
import type { WhatsAppPageOptions } from '../contracts/whatsapp.js'
import type { WhatsAppWebhookEvents } from '../application/whatsappWebhook.js'
import type { WhatsAppAutomationProfile, WhatsAppAutomationProfileInput, WhatsAppAutomationStage } from '../contracts/whatsappAutomation.js'
import type { WhatsAppAgentQualification } from '../integrations/whatsappDigiBuscaAgent.js'
import { canManuallyRetryGeneration, nextGenerationRetryAttempt, type AutomationRunState } from '../application/whatsappAutomationRetry.js'

type ConnectionRow = { phone_number_id: string; user_id: string }
type BusinessContactRow = { contact_wa_id: string; contact_name: string | null; is_removed: boolean }
type ConversationRow = {
  id: string
  user_id: string
  phone_number_id: string
  contact_wa_id: string
  contact_name: string | null
  linked_lead_id?: string | null
  automation_handoff_note?: string | null
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
  automationPaused: boolean
  automationOptedOut: boolean
  automationPauseReason: string | null
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
    responseMode: row.response_mode === 'gemini' || row.response_mode === 'openbot' || row.response_mode === 'digibot_agent' || row.response_mode === 'openclaw' ? row.response_mode : 'handoff_only',
    openBotAgentId: typeof row.openbot_agent_id === 'string' ? row.openbot_agent_id : '',
    agentProvider: row.agent_provider === 'anthropic' || row.agent_provider === 'openai-compatible' ? row.agent_provider : 'google',
    agentModel: typeof row.agent_model === 'string' && row.agent_model ? row.agent_model : 'gemini-3.8-flash',
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

export type WhatsAppAutomationRunRecord = {
  id: string
  userId: string
  phoneNumberId: string
  conversationId: string
  inboundProviderMessageId: string
  status: 'processing' | 'sent' | 'skipped' | 'needs_human' | 'failed'
  reason: string | null
  replyProviderMessageId: string | null
  responseProvider: 'gemini' | 'openbot' | 'digibot_agent' | 'openclaw' | null
  openBotAgentId: string | null
  openBotClientMessageId: string | null
  openBotPrompt: string | null
  openBotRequestStartedAt: string | null
  openBotDeliveryId: string | null
  generatedResponse: unknown
  generatedReplyBody: string | null
  sendingStartedAt: string | null
  profileUpdatedAt: string | null
  openBotContextPreparedAt: string | null
  openBotContextClearedAt: string | null
}

function mapAutomationRun(row: Record<string, unknown>): WhatsAppAutomationRunRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    phoneNumberId: row.phone_number_id as string,
    conversationId: row.conversation_id as string,
    inboundProviderMessageId: row.inbound_provider_message_id as string,
    status: row.status as WhatsAppAutomationRunRecord['status'],
    reason: row.reason as string | null,
    replyProviderMessageId: row.reply_provider_message_id as string | null,
    responseProvider: row.response_provider as WhatsAppAutomationRunRecord['responseProvider'],
    openBotAgentId: row.openbot_agent_id as string | null,
    openBotClientMessageId: row.openbot_client_message_id as string | null,
    openBotPrompt: row.openbot_prompt as string | null,
    openBotRequestStartedAt: row.openbot_request_started_at as string | null,
    openBotDeliveryId: row.openbot_delivery_id as string | null,
    generatedResponse: row.generated_response,
    generatedReplyBody: row.generated_reply_body as string | null,
    sendingStartedAt: row.sending_started_at as string | null,
    profileUpdatedAt: row.profile_updated_at as string | null,
    openBotContextPreparedAt: row.openbot_context_prepared_at as string | null,
    openBotContextClearedAt: row.openbot_context_cleared_at as string | null,
  }
}

const automationRunSelect = 'id, user_id, phone_number_id, conversation_id, inbound_provider_message_id, status, reason, reply_provider_message_id, response_provider, openbot_agent_id, openbot_client_message_id, openbot_prompt, openbot_request_started_at, openbot_delivery_id, generated_response, generated_reply_body, sending_started_at, profile_updated_at, openbot_context_prepared_at, openbot_context_cleared_at'

function throwIfError(error: { message: string } | null, message = 'Não foi possível acessar as conversas do WhatsApp.') {
  if (error) throw new Error(message)
}

export class WhatsAppConnectionConflictError extends Error {
  constructor() {
    super('Este número WhatsApp já está associado a outra conta DigiBusca.')
    this.name = 'WhatsAppConnectionConflictError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeWhatsAppContactNumber(value: string) {
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
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

  async isEvolutionStorageReady() {
    try {
      const admin = createWhatsAppWebhookSupabaseClient()
      const results = await Promise.all([
        admin.from('whatsapp_phone_number_connections').select('phone_number_id, platform_type').limit(0),
        admin.from('whatsapp_conversations').select('id').limit(0),
        admin.from('whatsapp_messages').select('id').limit(0),
      ])
      return results.every((result) => !result.error)
    } catch {
      return false
    }
  }

  async saveEvolutionInstance(userId: string, instanceName: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const existing = await admin.from('whatsapp_phone_number_connections')
      .select('user_id').eq('phone_number_id', instanceName).maybeSingle()
    throwIfError(existing.error, 'Não foi possível verificar a instância Evolution vinculada.')
    if (existing.data && (existing.data as { user_id: string }).user_id !== userId) {
      throw new WhatsAppConnectionConflictError()
    }
    const saved = await admin.from('whatsapp_phone_number_connections').upsert({
      user_id: userId,
      phone_number_id: instanceName,
      waba_id: null,
      display_phone_number: null,
      is_on_biz_app: true,
      platform_type: 'EVOLUTION_API',
      access_token_ciphertext: null,
      access_token_iv: null,
      access_token_expires_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone_number_id' })
    throwIfError(saved.error, 'Não foi possível associar a instância Evolution à conta DigiBusca.')
  }

  async saveOpenClawConnection(userId: string, phoneNumberId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const [existing, pendingQueue] = await Promise.all([
      admin.from('whatsapp_phone_number_connections')
        .select('user_id')
        .eq('phone_number_id', phoneNumberId)
        .maybeSingle(),
      admin.from('whatsapp_prospecting_queue')
        .select('id')
        .eq('phone_number_id', phoneNumberId)
        .in('status', ['review_required', 'queued', 'sending'])
        .limit(1),
    ])
    throwIfError(existing.error, 'Não foi possível verificar a conexão WhatsApp existente.')
    throwIfError(pendingQueue.error, 'Não foi possível verificar a fila antes da troca de transporte.')
    if (existing.data && (existing.data as { user_id: string }).user_id !== userId) {
      throw new WhatsAppConnectionConflictError()
    }
    if ((pendingQueue.data ?? []).length > 0) {
      throw new Error('Cancele ou conclua os itens pendentes da fila Evolution antes de registrar o OpenClaw.')
    }

    const saved = await admin.from('whatsapp_phone_number_connections').upsert({
      user_id: userId,
      phone_number_id: phoneNumberId,
      waba_id: null,
      display_phone_number: null,
      is_on_biz_app: false,
      platform_type: 'OPENCLAW_WEB',
      access_token_ciphertext: null,
      access_token_iv: null,
      access_token_expires_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone_number_id' })
    throwIfError(saved.error, 'Não foi possível registrar a sessão WhatsApp Web do OpenClaw no DigiBusca.')
  }

  async getEvolutionInstanceName(userId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_phone_number_connections')
      .select('phone_number_id').eq('user_id', userId).eq('platform_type', 'EVOLUTION_API')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    throwIfError(result.error, 'Não foi possível carregar a instância Evolution desta conta.')
    return (result.data as { phone_number_id: string } | null)?.phone_number_id
  }

  async getConnectionPlatformType(userId: string, phoneNumberId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_phone_number_connections')
      .select('platform_type')
      .eq('user_id', userId)
      .eq('phone_number_id', phoneNumberId)
      .maybeSingle()
    throwIfError(result.error, 'Não foi possível validar o transporte do WhatsApp conectado.')
    return (result.data as { platform_type: string | null } | null)?.platform_type ?? undefined
  }

  async getPlatformTypeForPhoneNumberId(phoneNumberId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_phone_number_connections')
      .select('platform_type')
      .eq('phone_number_id', phoneNumberId)
      .maybeSingle()
    throwIfError(result.error, 'Não foi possível validar o transporte do WhatsApp recebido.')
    return (result.data as { platform_type: string | null } | null)?.platform_type ?? undefined
  }

  async isAutomationStorageReady() {
    try {
      const admin = createWhatsAppWebhookSupabaseClient()
      const result = await admin.from('whatsapp_automation_profiles').select('phone_number_id, response_mode, openbot_agent_id, agent_provider, agent_model').limit(0)
      if (result.error) return false
      const runs = await admin.from('whatsapp_automation_runs').select('id, response_provider, openbot_delivery_id').limit(0)
      return !runs.error
    } catch {
      return false
    }
  }

  async isOpenClawStorageReady() {
    try {
      const admin = createWhatsAppWebhookSupabaseClient()
      const [connection, runs, conversation, queue, interaction] = await Promise.all([
        admin.from('whatsapp_phone_number_connections').select('platform_type').limit(0),
        admin.from('whatsapp_automation_runs').select('openclaw_run_id').limit(0),
        admin.from('whatsapp_conversations').select('linked_lead_id, automation_handoff_note').limit(0),
        admin.from('whatsapp_prospecting_queue').select('contact_verified_at, contact_verification_reference, contact_identity_verified, delivery_status').limit(0),
        admin.from('lead_interactions').select('whatsapp_message_id').limit(0),
      ])
      return [connection, runs, conversation, queue, interaction].every((result) => !result.error)
    } catch {
      return false
    }
  }

  async isDigiBuscaAgentStorageReady() {
    try {
      const admin = createWhatsAppWebhookSupabaseClient()
      const result = await admin.from('whatsapp_agent_qualifications').select('conversation_id, fields').limit(0)
      return !result.error
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
      .select('phone_number_id, business_name, sender_identity, service_summary, approved_facts, escalation_contact, response_mode, openbot_agent_id, agent_provider, agent_model, automation_enabled, channel_approved_at, content_approved_at, updated_at')
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

    const existingProfile = await admin.from('whatsapp_automation_profiles')
      .select('response_mode, openbot_agent_id, agent_provider, agent_model')
      .eq('user_id', userId).eq('phone_number_id', input.phoneNumberId).maybeSingle()
    throwIfError(existingProfile.error, 'Não foi possível validar o modo de atendimento salvo.')
    const responseModeChanged = Boolean(existingProfile.data && existingProfile.data.response_mode !== input.responseMode)
    const openBotAgentChanged = Boolean(existingProfile.data && existingProfile.data.openbot_agent_id !== input.openBotAgentId)
    const agentProviderChanged = Boolean(existingProfile.data && existingProfile.data.agent_provider !== input.agentProvider)
    const agentModelChanged = Boolean(existingProfile.data && existingProfile.data.agent_model !== input.agentModel)
    const providerSettingsChanged = responseModeChanged || openBotAgentChanged || agentProviderChanged || agentModelChanged

    const approvedAt = new Date().toISOString()
    const values = {
      user_id: userId,
      phone_number_id: input.phoneNumberId,
      business_name: input.businessName,
      sender_identity: input.senderIdentity,
      service_summary: input.serviceSummary,
      approved_facts: input.approvedFacts,
      escalation_contact: input.escalationContact,
      response_mode: input.responseMode,
      openbot_agent_id: input.openBotAgentId,
      agent_provider: input.agentProvider,
      agent_model: input.agentModel,
      automation_enabled: providerSettingsChanged ? false : input.automationEnabled,
      channel_approved_at: input.channelApproved ? approvedAt : null,
      content_approved_at: input.contentApproved && !providerSettingsChanged ? approvedAt : null,
      updated_at: approvedAt,
    }
    const result = await admin.from('whatsapp_automation_profiles')
      .upsert(values, { onConflict: 'phone_number_id,user_id' })
      .select('phone_number_id, business_name, sender_identity, service_summary, approved_facts, escalation_contact, response_mode, openbot_agent_id, agent_provider, agent_model, automation_enabled, channel_approved_at, content_approved_at, updated_at')
      .single()
    throwIfError(result.error, 'Não foi possível salvar as regras de atendimento automático.')
    return mapAutomationProfile(result.data as Record<string, unknown>)
  }

  async pauseDigiBuscaAutomationForProviderChange(userId: string, provider: WhatsAppAutomationProfile['agentProvider']) {
    const result = await createWhatsAppWebhookSupabaseClient().from('whatsapp_automation_profiles')
      .update({ automation_enabled: false, content_approved_at: null, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('response_mode', 'digibot_agent')
      .eq('agent_provider', provider)
      .select('phone_number_id')
    throwIfError(result.error, 'Não foi possível pausar os perfis Cristhian antes de alterar a conexão de IA.')
    return result.data?.length ?? 0
  }

  async setConversationAutomationPaused(userId: string, conversationId: string, paused: boolean, reason = 'manual', handoffNote?: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    let query = admin.from('whatsapp_conversations')
      .update({
        automation_paused: paused,
        automation_pause_reason: paused ? reason : null,
        automation_handoff_note: paused && reason === 'handoff' ? handoffNote?.trim().slice(0, 120) || null : null,
      })
      .eq('id', conversationId).eq('user_id', userId)
    if (!paused) query = query.eq('automation_opted_out', false)
    const result = await query
      .select('id').maybeSingle()
    throwIfError(result.error, 'Não foi possível atualizar a automação desta conversa.')
    return Boolean(result.data)
  }

  async markConversationScheduleReviewRequired(userId: string, conversationId: string) {
    const result = await createWhatsAppWebhookSupabaseClient().from('whatsapp_conversations')
      .update({ automation_pause_reason: 'schedule_review_required' })
      .eq('id', conversationId).eq('user_id', userId)
      .eq('automation_paused', false).eq('automation_opted_out', false)
      .select('id').maybeSingle()
    throwIfError(result.error, 'Não foi possível registrar o pedido de agendamento.')
    return Boolean(result.data)
  }

  async clearConversationScheduleReview(userId: string, conversationId: string) {
    const result = await createWhatsAppWebhookSupabaseClient().from('whatsapp_conversations')
      .update({ automation_pause_reason: null })
      .eq('id', conversationId).eq('user_id', userId)
      .eq('automation_pause_reason', 'schedule_review_required')
      .select('id').maybeSingle()
    throwIfError(result.error, 'Não foi possível limpar o aviso de agendamento.')
    return Boolean(result.data)
  }

  async resumeRecoverableConversationAutomation(userId: string, conversationId: string, reason: 'assistant_closed' | 'provider_unavailable') {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_conversations')
      .update({ automation_paused: false, automation_pause_reason: null })
      .eq('id', conversationId).eq('user_id', userId)
      .eq('automation_paused', true).eq('automation_opted_out', false)
      .eq('automation_pause_reason', reason)
      .select('id').maybeSingle()
    throwIfError(result.error, 'Não foi possível retomar a conversa encerrada.')
    return Boolean(result.data)
  }

  async pauseConversationForGenerationFailure(userId: string, conversationId: string, lastMessageAt: string) {
    const result = await createWhatsAppWebhookSupabaseClient().from('whatsapp_conversations')
      .update({ automation_paused: true, automation_pause_reason: 'provider_unavailable' })
      .eq('id', conversationId).eq('user_id', userId)
      .eq('automation_paused', false).eq('automation_opted_out', false)
      .eq('last_message_direction', 'inbound').eq('last_message_at', lastMessageAt)
    throwIfError(result.error, 'Não foi possível registrar a indisponibilidade do Gemini.')
  }

  async markConversationOptedOut(userId: string, conversationId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_conversations')
      .update({ automation_paused: true, automation_opted_out: true, automation_pause_reason: 'opt_out' })
      .eq('id', conversationId).eq('user_id', userId)
      .select('contact_wa_id')
      .single()
    throwIfError(result.error, 'Não foi possível registrar o pedido de parada desta conversa.')

    const contactWaId = (result.data as { contact_wa_id: string }).contact_wa_id
    await this.markContactOptedOut(userId, contactWaId)
  }

  async markSavedLeadOptedOut(userId: string, leadId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const leadResult = await admin.from('saved_leads')
      .select('lead_data')
      .eq('user_id', userId)
      .eq('lead_id', leadId)
      .maybeSingle()
    throwIfError(leadResult.error, 'Não foi possível localizar o lead para aplicar o descadastro.')
    const leadData = leadResult.data?.lead_data
    const rawPhone = isRecord(leadData) && typeof leadData.phone === 'string' ? leadData.phone : ''
    const contactWaId = normalizeWhatsAppContactNumber(rawPhone)
    if (!contactWaId) return
    await this.markContactOptedOut(userId, contactWaId)
  }

  private async markContactOptedOut(userId: string, contactWaId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const now = new Date().toISOString()
    const conversationsResult = await admin.from('whatsapp_conversations')
      .update({ automation_paused: true, automation_opted_out: true, automation_pause_reason: 'opt_out' })
      .eq('user_id', userId)
      .eq('contact_wa_id', contactWaId)
      .select('id')
    throwIfError(conversationsResult.error, 'Não foi possível pausar as conversas deste contato.')
    const conversationIds = (conversationsResult.data ?? []).map((row) => row.id as string)
    if (conversationIds.length > 0) {
      const qualificationCleanup = await admin.from('whatsapp_agent_qualifications').delete()
        .eq('user_id', userId).in('conversation_id', conversationIds)
      throwIfError(qualificationCleanup.error, 'Não foi possível remover os dados de qualificação após o descadastro.')
    }

    const leadsResult = await admin.from('saved_leads')
      .select('lead_id, lead_data')
      .eq('user_id', userId)
    throwIfError(leadsResult.error, 'Não foi possível aplicar o descadastro ao lead salvo.')
    const matchingLeadIds = ((leadsResult.data ?? []) as Array<{ lead_id: string; lead_data: unknown }>)
      .filter((lead) => isRecord(lead.lead_data) && typeof lead.lead_data.phone === 'string'
        && normalizeWhatsAppContactNumber(lead.lead_data.phone) === contactWaId)
      .map((lead) => lead.lead_id)
    if (matchingLeadIds.length > 0) {
      const leadUpdate = await admin.from('saved_leads')
        .update({
          whatsapp_consent_status: 'opted_out',
          whatsapp_consent_source: 'Pedido de descadastro registrado no WhatsApp ou DigiBusca',
          whatsapp_consent_at: now,
          updated_at: now,
        })
        .eq('user_id', userId)
        .in('lead_id', matchingLeadIds)
      throwIfError(leadUpdate.error, 'Não foi possível atualizar o descadastro do lead salvo.')
    }

    const queueUpdate = await admin.from('whatsapp_prospecting_queue')
      .update({ status: 'cancelled', error_code: 'contact_opted_out', updated_at: now })
      .eq('user_id', userId)
      .eq('recipient_phone', contactWaId)
      .in('status', ['review_required', 'queued'])
    throwIfError(queueUpdate.error, 'Não foi possível cancelar os contatos ainda não enviados para este número.')
  }

  async getAutomationRuntimeContext(phoneNumberId: string, contactWaId: string): Promise<WhatsAppAutomationRuntimeContext | undefined> {
    const admin = createWhatsAppWebhookSupabaseClient()
    const connectionResult = await admin.from('whatsapp_phone_number_connections')
      .select('user_id, phone_number_id')
      .eq('phone_number_id', phoneNumberId).maybeSingle()
    throwIfError(connectionResult.error, 'Não foi possível carregar a conexão WhatsApp para responder.')
    if (!connectionResult.data) return undefined
    const connection = connectionResult.data as { user_id: string; phone_number_id: string }

    const [conversationResult, profileResult] = await Promise.all([
      admin.from('whatsapp_conversations')
        .select('id, automation_paused, automation_opted_out, automation_pause_reason, automation_stage, last_message_at, last_message_direction')
        .eq('user_id', connection.user_id).eq('phone_number_id', phoneNumberId)
        .eq('contact_wa_id', contactWaId).maybeSingle(),
      admin.from('whatsapp_automation_profiles')
        .select('phone_number_id, business_name, sender_identity, service_summary, approved_facts, escalation_contact, response_mode, openbot_agent_id, agent_provider, agent_model, automation_enabled, channel_approved_at, content_approved_at, updated_at')
        .eq('user_id', connection.user_id).eq('phone_number_id', phoneNumberId).maybeSingle(),
    ])
    throwIfError(conversationResult.error, 'Não foi possível carregar a conversa para responder.')
    throwIfError(profileResult.error, 'Não foi possível carregar as regras de atendimento automático.')
    if (!conversationResult.data) return undefined
    const conversation = conversationResult.data as {
      id: string; automation_paused: boolean | null; automation_opted_out: boolean | null; automation_pause_reason: string | null; automation_stage: string | null;
      last_message_at: string | null; last_message_direction: 'inbound' | 'outbound' | null
    }
    const stage = validAutomationStages.includes(conversation.automation_stage as WhatsAppAutomationStage)
      ? conversation.automation_stage as WhatsAppAutomationStage
      : 'identify_responsible'
    const messagesResult = await admin.from('whatsapp_messages')
      .select('provider_message_id, direction, body, occurred_at').eq('user_id', connection.user_id)
      .eq('phone_number_id', phoneNumberId).eq('conversation_id', conversation.id)
      .order('occurred_at', { ascending: false }).order('created_at', { ascending: false }).limit(40)
    throwIfError(messagesResult.error, 'Não foi possível carregar o contexto recente da conversa.')

    return {
      userId: connection.user_id,
      phoneNumberId,
      contactWaId,
      conversationId: conversation.id,
      automationPaused: conversation.automation_paused === true,
      automationOptedOut: conversation.automation_opted_out === true,
      automationPauseReason: conversation.automation_pause_reason,
      automationStage: stage,
      lastMessageAt: conversation.last_message_at,
      lastMessageDirection: conversation.last_message_direction,
      latestProviderMessageId: ((messagesResult.data ?? []) as Array<{ provider_message_id: string }>)[0]?.provider_message_id ?? null,
      profile: profileResult.data ? mapAutomationProfile(profileResult.data as Record<string, unknown>) : null,
      messages: ((messagesResult.data ?? []) as Array<{ direction: 'inbound' | 'outbound'; body: string | null; occurred_at: string }>)
        .reverse().map(({ direction, body, occurred_at }) => ({ direction, body, occurredAt: occurred_at })),
    }
  }

  async claimOpenClawAutomationRun(
    userId: string,
    phoneNumberId: string,
    conversationId: string,
    inboundProviderMessageId: string,
    openClawRunId: string,
    openClawSessionKey?: string,
  ) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_automation_runs')
      .insert({
        user_id: userId,
        phone_number_id: phoneNumberId,
        conversation_id: conversationId,
        inbound_provider_message_id: inboundProviderMessageId,
        response_provider: 'openclaw',
        openclaw_run_id: openClawRunId,
        openclaw_session_key: openClawSessionKey ?? null,
        status: 'processing',
      })
      .select('id')
      .maybeSingle()
    if (result.error?.code === '23505') return undefined
    throwIfError(result.error, 'Não foi possível registrar a entrada do Cristhian no DigiBusca.')
    return (result.data as { id: string } | null)?.id
  }

  async reserveOpenClawReplySend(
    userId: string,
    phoneNumberId: string,
    openClawRunId: string | undefined,
    openClawSessionKey: string | undefined,
    conversationId: string,
    inboundProviderMessageId: string,
  ) {
    if (!openClawRunId && !openClawSessionKey) return false
    if (!conversationId || !inboundProviderMessageId) return false
    const admin = createWhatsAppWebhookSupabaseClient()
    let pendingQuery = admin.from('whatsapp_automation_runs')
      .select('id')
      .eq('user_id', userId)
      .eq('phone_number_id', phoneNumberId)
      .eq('conversation_id', conversationId)
      .eq('inbound_provider_message_id', inboundProviderMessageId)
      .eq('response_provider', 'openclaw')
      .eq('status', 'processing')
      .is('openclaw_send_reserved_at', null)
    if (openClawRunId) pendingQuery = pendingQuery.eq('openclaw_run_id', openClawRunId)
    else pendingQuery = pendingQuery.eq('openclaw_session_key', openClawSessionKey).order('created_at', { ascending: false }).limit(1)
    const pendingResult = await pendingQuery.maybeSingle()
    throwIfError(pendingResult.error, 'Não foi possível localizar a resposta pendente do Cristhian.')
    const runId = (pendingResult.data as { id: string } | null)?.id
    if (!runId) return false
    const result = await admin.from('whatsapp_automation_runs')
      .update({ openclaw_send_reserved_at: new Date().toISOString() })
      .eq('id', runId)
      .eq('status', 'processing')
      .is('openclaw_send_reserved_at', null)
      .select('id')
    throwIfError(result.error, 'Não foi possível autorizar a resposta do Cristhian.')
    return (result.data ?? []).length === 1
  }

  async settleOpenClawAutomationRun(
    userId: string,
    phoneNumberId: string,
    openClawRunId: string,
    result: { success: boolean; providerMessageId?: string; replyBody?: string },
  ) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const now = new Date().toISOString()
    const updated = await admin.from('whatsapp_automation_runs')
      .update({
        status: result.success ? 'sent' : 'failed',
        reason: result.success ? null : 'openclaw_delivery_failed',
        ...(result.success && result.providerMessageId ? { reply_provider_message_id: result.providerMessageId } : {}),
        ...(result.success && result.replyBody ? { generated_reply_body: result.replyBody.slice(0, 8_000) } : {}),
        completed_at: now,
      })
      .eq('user_id', userId)
      .eq('phone_number_id', phoneNumberId)
      .eq('response_provider', 'openclaw')
      .eq('openclaw_run_id', openClawRunId)
      .eq('status', 'processing')
      .select('id')
    throwIfError(updated.error, 'Não foi possível registrar o resultado da resposta do Cristhian.')
    return (updated.data ?? []).length > 0
  }

  async settleLatestOpenClawAutomationRunBySession(
    userId: string,
    phoneNumberId: string,
    openClawSessionKey: string,
    result: { success: boolean; providerMessageId?: string; replyBody?: string },
  ) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const pending = await admin.from('whatsapp_automation_runs')
      .select('id')
      .eq('user_id', userId)
      .eq('phone_number_id', phoneNumberId)
      .eq('response_provider', 'openclaw')
      .eq('openclaw_session_key', openClawSessionKey)
      .eq('status', 'processing')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    throwIfError(pending.error, 'Não foi possível localizar a resposta pendente do Cristhian.')
    const runId = (pending.data as { id: string } | null)?.id
    if (!runId) return false
    const updated = await admin.from('whatsapp_automation_runs')
      .update({
        status: result.success ? 'sent' : 'failed',
        reason: result.success ? null : 'openclaw_delivery_failed',
        ...(result.success && result.providerMessageId ? { reply_provider_message_id: result.providerMessageId } : {}),
        ...(result.success && result.replyBody ? { generated_reply_body: result.replyBody.slice(0, 8_000) } : {}),
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .eq('status', 'processing')
      .select('id')
    throwIfError(updated.error, 'Não foi possível registrar o resultado da resposta do Cristhian.')
    return (updated.data ?? []).length > 0
  }

  async claimAutomationRun(
    userId: string,
    phoneNumberId: string,
    conversationId: string,
    inboundProviderMessageId: string,
    responseProvider?: 'gemini' | 'openbot' | 'digibot_agent' | 'openclaw',
    openBotAgentId?: string,
    profileUpdatedAt?: string,
  ) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_automation_runs').upsert({
      user_id: userId,
      phone_number_id: phoneNumberId,
      conversation_id: conversationId,
      inbound_provider_message_id: inboundProviderMessageId,
      status: 'processing',
      response_provider: responseProvider ?? null,
      openbot_agent_id: responseProvider === 'openbot' ? openBotAgentId ?? null : null,
      profile_updated_at: profileUpdatedAt ?? null,
    }, { onConflict: 'phone_number_id,inbound_provider_message_id', ignoreDuplicates: true })
      .select('id').maybeSingle()
    throwIfError(result.error, 'Não foi possível reservar a resposta automática.')
    if (result.data?.id) return { id: result.data.id as string, attempt: 1 }
    const existing = await admin.from('whatsapp_automation_runs')
      .select('id, status, reason, completed_at, reply_provider_message_id')
      .eq('user_id', userId).eq('phone_number_id', phoneNumberId)
      .eq('inbound_provider_message_id', inboundProviderMessageId).maybeSingle()
    throwIfError(existing.error, 'Não foi possível verificar a nova tentativa de resposta.')
    if (!existing.data) return undefined
    const attempt = nextGenerationRetryAttempt(existing.data as AutomationRunState)
    if (!attempt) return undefined
    const retried = await admin.from('whatsapp_automation_runs')
      .update({ status: 'processing', reason: null, completed_at: null })
      .eq('id', existing.data.id).eq('status', 'failed')
      .is('reply_provider_message_id', null)
      .eq('reason', existing.data.reason).eq('completed_at', existing.data.completed_at)
      .select('id').maybeSingle()
    throwIfError(retried.error, 'Não foi possível reservar a nova tentativa de resposta.')
    return retried.data?.id ? { id: retried.data.id as string, attempt } : undefined
  }

  async getAutomationRun(runId: string): Promise<WhatsAppAutomationRunRecord | undefined> {
    const result = await createWhatsAppWebhookSupabaseClient().from('whatsapp_automation_runs')
      .select(automationRunSelect).eq('id', runId).maybeSingle()
    throwIfError(result.error, 'Não foi possível carregar o estado da execução WhatsApp.')
    return result.data ? mapAutomationRun(result.data as Record<string, unknown>) : undefined
  }

  async claimOpenBotAgentLock(agentId: string, runId: string) {
    const result = await createWhatsAppWebhookSupabaseClient()
      .rpc('claim_whatsapp_openbot_agent_lock', { p_agent_id: agentId, p_run_id: runId })
    throwIfError(result.error, 'Não foi possível reservar o agente OpenBot para esta conversa.')
    return result.data === true
  }

  async releaseOpenBotAgentLock(agentId: string, runId: string) {
    const result = await createWhatsAppWebhookSupabaseClient()
      .rpc('release_whatsapp_openbot_agent_lock', { p_agent_id: agentId, p_run_id: runId })
    throwIfError(result.error, 'Não foi possível liberar o agente OpenBot.')
  }

  async claimOpenBotRun(runId: string, claimId: string) {
    const result = await createWhatsAppWebhookSupabaseClient()
      .rpc('claim_whatsapp_openbot_run', { p_run_id: runId, p_claim_id: claimId })
    throwIfError(result.error, 'Não foi possível reservar a retomada OpenBot.')
    return result.data === true
  }

  async releaseOpenBotRun(runId: string, claimId: string) {
    const result = await createWhatsAppWebhookSupabaseClient()
      .rpc('release_whatsapp_openbot_run', { p_run_id: runId, p_claim_id: claimId })
    throwIfError(result.error, 'Não foi possível liberar a retomada OpenBot.')
  }

  async prepareOpenBotRequest(input: {
    runId: string
    agentId: string
    clientMessageId: string
    prompt: string
    profileUpdatedAt: string
  }) {
    let run = await this.getAutomationRun(input.runId)
    if (!run || run.status !== 'processing') throw new Error('openbot_run_not_processing')
    if (run.openBotClientMessageId) {
      if (
        run.responseProvider !== 'openbot' || run.openBotAgentId !== input.agentId ||
        run.openBotClientMessageId !== input.clientMessageId || !run.openBotPrompt
      ) throw new Error('openbot_request_conflict')
      return run
    }

    const now = new Date().toISOString()
    const updated = await createWhatsAppWebhookSupabaseClient().from('whatsapp_automation_runs')
      .update({
        response_provider: 'openbot',
        openbot_agent_id: input.agentId,
        openbot_client_message_id: input.clientMessageId,
        openbot_prompt: input.prompt,
        openbot_request_started_at: now,
        profile_updated_at: input.profileUpdatedAt,
        reason: 'openbot_pending',
      })
      .eq('id', input.runId).eq('status', 'processing').is('openbot_client_message_id', null)
      .select(automationRunSelect).maybeSingle()
    throwIfError(updated.error, 'Não foi possível registrar a solicitação idempotente do OpenBot.')
    if (!updated.data) {
      run = await this.getAutomationRun(input.runId)
      if (
        !run || run.responseProvider !== 'openbot' || run.openBotAgentId !== input.agentId ||
        run.openBotClientMessageId !== input.clientMessageId || !run.openBotPrompt
      ) throw new Error('openbot_request_conflict')
      return run
    }
    return mapAutomationRun(updated.data as Record<string, unknown>)
  }

  async recordOpenBotDelivery(runId: string, deliveryId: string) {
    const existing = await this.getAutomationRun(runId)
    if (!existing || existing.status !== 'processing') throw new Error('openbot_run_not_processing')
    if (existing.openBotDeliveryId) {
      if (existing.openBotDeliveryId !== deliveryId) throw new Error('openbot_delivery_conflict')
      return
    }
    const result = await createWhatsAppWebhookSupabaseClient().from('whatsapp_automation_runs')
      .update({ openbot_delivery_id: deliveryId, reason: 'openbot_pending' })
      .eq('id', runId).eq('status', 'processing').is('openbot_delivery_id', null)
    throwIfError(result.error, 'Não foi possível salvar o identificador da entrega OpenBot.')
  }

  async saveOpenBotGeneratedResponse(runId: string, response: unknown, replyBody: string) {
    const existing = await this.getAutomationRun(runId)
    if (!existing || existing.status !== 'processing') throw new Error('openbot_run_not_processing')
    if (existing.generatedResponse !== null && existing.generatedResponse !== undefined) return
    const result = await createWhatsAppWebhookSupabaseClient().from('whatsapp_automation_runs')
      .update({ generated_response: response, generated_reply_body: replyBody, reason: null })
      .eq('id', runId).eq('status', 'processing').is('generated_response', null)
    throwIfError(result.error, 'Não foi possível persistir a resposta OpenBot antes do envio.')
  }

  async markOpenBotContextCleared(runId: string) {
    const result = await createWhatsAppWebhookSupabaseClient().from('whatsapp_automation_runs')
      .update({ openbot_context_cleared_at: new Date().toISOString() })
      .eq('id', runId).eq('status', 'processing')
    throwIfError(result.error, 'Não foi possível registrar a limpeza do contexto OpenBot.')
  }

  async markOpenBotContextPrepared(runId: string) {
    const result = await createWhatsAppWebhookSupabaseClient().from('whatsapp_automation_runs')
      .update({ openbot_context_prepared_at: new Date().toISOString() })
      .eq('id', runId).eq('status', 'processing')
    throwIfError(result.error, 'Não foi possível registrar a preparação do contexto OpenBot.')
  }

  async pauseAutomationRunForHuman(runId: string, reason: string, pauseReason = 'handoff_send_failed', replyMessageId?: string) {
    const run = await this.getAutomationRun(runId)
    if (!run) return
    await this.setConversationAutomationPaused(run.userId, run.conversationId, true, pauseReason)
    await this.completeAutomationRun(runId, 'needs_human', reason, replyMessageId)
  }

  async persistGeneratedAutomationResponse(runId: string, response: unknown, replyBody: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const existing = await this.getAutomationRun(runId)
    if (!existing || existing.status !== 'processing') throw new Error('automation_run_not_processing')
    if (existing.generatedResponse !== null && existing.generatedResponse !== undefined) return
    const result = await admin.from('whatsapp_automation_runs')
      .update({ generated_response: response, generated_reply_body: replyBody })
      .eq('id', runId).eq('status', 'processing').is('generated_response', null).select('id').maybeSingle()
    throwIfError(result.error, 'Não foi possível persistir a resposta antes do envio.')
    if (!result.data) {
      const current = await this.getAutomationRun(runId)
      if (!current || current.status !== 'processing' || current.generatedReplyBody !== replyBody) {
        throw new Error('automation_response_persist_conflict')
      }
    }
  }

  async updateGeneratedAutomationResponse(runId: string, response: unknown, replyBody: string) {
    const result = await createWhatsAppWebhookSupabaseClient().from('whatsapp_automation_runs')
      .update({ generated_response: response, generated_reply_body: replyBody })
      .eq('id', runId).eq('status', 'processing')
    throwIfError(result.error, 'Não foi possível atualizar a resposta validada antes do envio.')
  }

  async resolveUncertainAutomationDeliveries() {
    const admin = createWhatsAppWebhookSupabaseClient()
    const staleBefore = new Date(Date.now() - 2 * 60 * 1_000).toISOString()
    const result = await admin.from('whatsapp_automation_runs')
      .select('id, user_id, conversation_id')
      .eq('status', 'processing').eq('reason', 'sending').is('reply_provider_message_id', null)
      .or(`sending_started_at.is.null,sending_started_at.lt.${staleBefore}`)
      .order('created_at', { ascending: true }).limit(100)
    throwIfError(result.error, 'Não foi possível reconciliar envios WhatsApp sem confirmação.')
    for (const row of (result.data ?? []) as Array<{ id: string; user_id: string; conversation_id: string }>) {
      const paused = await admin.from('whatsapp_conversations')
        .update({ automation_paused: true, automation_pause_reason: 'handoff_send_failed' })
        .eq('user_id', row.user_id).eq('id', row.conversation_id)
      throwIfError(paused.error, 'Não foi possível pausar uma conversa com envio incerto.')
      const completed = await admin.from('whatsapp_automation_runs')
        .update({ status: 'needs_human', reason: 'delivery_unconfirmed', completed_at: new Date().toISOString() })
        .eq('id', row.id).eq('status', 'processing').eq('reason', 'sending').is('reply_provider_message_id', null)
      throwIfError(completed.error, 'Não foi possível sinalizar um envio WhatsApp incerto para revisão humana.')
    }
  }

  async reconcileAcceptedAutomationDeliveries() {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_automation_runs')
      .select(automationRunSelect)
      .or('and(status.eq.processing,reason.eq.delivery_accepted),and(status.eq.needs_human,reason.eq.history_sync_failed_after_send)')
      .not('reply_provider_message_id', 'is', null)
      .order('created_at', { ascending: true }).limit(100)
    throwIfError(result.error, 'Não foi possível reconciliar respostas já aceitas pelo WhatsApp.')
    for (const rawRun of (result.data ?? []) as Array<Record<string, unknown>>) {
      const run = mapAutomationRun(rawRun)
      const inbound = await admin.from('whatsapp_messages')
        .select('contact_wa_id')
        .eq('phone_number_id', run.phoneNumberId).eq('provider_message_id', run.inboundProviderMessageId)
        .eq('direction', 'inbound').maybeSingle()
      throwIfError(inbound.error, 'Não foi possível recuperar a conversa da resposta aceita pelo WhatsApp.')
      if (!inbound.data?.contact_wa_id || !run.replyProviderMessageId || !run.generatedReplyBody) {
        const paused = await admin.from('whatsapp_conversations')
          .update({ automation_paused: true, automation_pause_reason: 'handoff_send_failed' })
          .eq('user_id', run.userId).eq('id', run.conversationId)
        throwIfError(paused.error, 'Não foi possível pausar uma conversa com histórico de envio incompleto.')
        await this.completeAutomationRun(run.id, 'needs_human', 'history_sync_failed_after_send', run.replyProviderMessageId ?? undefined)
        continue
      }
      const saved = await admin.from('whatsapp_messages').upsert({
        user_id: run.userId,
        phone_number_id: run.phoneNumberId,
        conversation_id: run.conversationId,
        provider_message_id: run.replyProviderMessageId,
        contact_wa_id: inbound.data.contact_wa_id,
        direction: 'outbound',
        message_type: 'text',
        body: run.generatedReplyBody,
        source: 'live',
        is_placeholder: false,
        occurred_at: new Date().toISOString(),
      }, { onConflict: 'phone_number_id,provider_message_id' })
      throwIfError(saved.error, 'Não foi possível sincronizar o histórico de uma resposta WhatsApp aceita.')
      const nextStage = typeof run.generatedResponse === 'object' && run.generatedResponse !== null
        ? (run.generatedResponse as Record<string, unknown>).nextStage
        : undefined
      if (typeof nextStage === 'string' && validAutomationStages.includes(nextStage as WhatsAppAutomationStage)) {
        await this.updateAutomationStage(run.conversationId, nextStage as WhatsAppAutomationStage)
      }
      await this.completeAutomationRun(run.id, 'sent', undefined, run.replyProviderMessageId)
    }
  }

  async queueLatestUnansweredReply(userId: string, conversationId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const latest = await admin.from('whatsapp_messages').select('provider_message_id, direction')
      .eq('user_id', userId).eq('conversation_id', conversationId)
      .order('occurred_at', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle()
    throwIfError(latest.error)
    if (!latest.data || latest.data.direction !== 'inbound') return
    const run = await admin.from('whatsapp_automation_runs')
      .select('id, status, reason, completed_at, reply_provider_message_id')
      .eq('user_id', userId).eq('conversation_id', conversationId)
      .eq('inbound_provider_message_id', latest.data.provider_message_id).maybeSingle()
    throwIfError(run.error)
    if (!run.data || !canManuallyRetryGeneration(run.data as AutomationRunState & { reply_provider_message_id: string | null })) return
    let query = admin.from('whatsapp_automation_runs').update({
      status: 'failed', reason: 'gemini_generation_requested', completed_at: new Date().toISOString(),
    }).eq('id', run.data.id).eq('status', run.data.status).is('reply_provider_message_id', null)
    query = run.data.reason === null ? query.is('reason', null) : query.eq('reason', run.data.reason)
    const updated = await query.select('id').maybeSingle()
    throwIfError(updated.error, 'Não foi possível preparar a resposta pendente para nova tentativa.')
    return updated.data ? 'queued' : 'conflict'
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

  async markAutomationRunSending(runId: string) {
    const result = await createWhatsAppWebhookSupabaseClient().from('whatsapp_automation_runs')
      .update({ reason: 'sending', sending_started_at: new Date().toISOString() }).eq('id', runId).eq('status', 'processing')
      .is('reason', null).is('reply_provider_message_id', null).select('id').maybeSingle()
    throwIfError(result.error, 'Não foi possível reservar o envio da resposta.')
    if (!result.data) throw new Error('automation_send_claim_lost')
  }

  async recordAutomationReplyAccepted(runId: string, replyId: string) {
    const result = await createWhatsAppWebhookSupabaseClient().from('whatsapp_automation_runs')
      .update({ reply_provider_message_id: replyId, reason: 'delivery_accepted' })
      .eq('id', runId).eq('status', 'processing')
    throwIfError(result.error, 'Não foi possível registrar a resposta aceita pelo WhatsApp.')
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
      source: 'live',
      is_placeholder: false,
      occurred_at: input.occurredAt,
    }, { onConflict: 'phone_number_id,provider_message_id' })
    throwIfError(result.error, 'Não foi possível salvar a resposta automática enviada.')
  }

  async updateAutomationStage(conversationId: string, stage: WhatsAppAutomationStage) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_conversations').update({ automation_stage: stage }).eq('id', conversationId)
    throwIfError(result.error, 'Não foi possível atualizar a etapa do atendimento automático.')
  }

  async saveAgentQualification(userId: string, conversationId: string, fields: WhatsAppAgentQualification) {
    const allowedKeys = ['projectType', 'objective', 'priority', 'timeline', 'serviceInterest'] as const
    const safeFields: WhatsAppAgentQualification = {}
    for (const key of allowedKeys) {
      const value = fields[key]
      if (typeof value === 'string' && value.trim() && value.trim().length <= 180) safeFields[key] = value.trim()
    }
    if (Object.keys(safeFields).length === 0) return
    const admin = createWhatsAppWebhookSupabaseClient()
    const conversation = await admin.from('whatsapp_conversations')
      .select('automation_opted_out').eq('id', conversationId).eq('user_id', userId).maybeSingle()
    throwIfError(conversation.error, 'Não foi possível validar a conversa antes de salvar a qualificação.')
    if (!conversation.data || conversation.data.automation_opted_out === true) return
    const result = await admin.rpc('merge_whatsapp_agent_qualification', {
      p_user_id: userId,
      p_conversation_id: conversationId,
      p_fields: safeFields,
    })
    throwIfError(result.error, 'Não foi possível salvar os dados do projeto informados pelo lead.')
  }

  async getConversationQualification(accessToken: string, userId: string, conversationId: string): Promise<WhatsAppAgentQualification | undefined> {
    const result = await this.userClient(accessToken).from('whatsapp_agent_qualifications')
      .select('fields').eq('conversation_id', conversationId).eq('user_id', userId).gt('expires_at', new Date().toISOString()).maybeSingle()
    throwIfError(result.error, 'Não foi possível carregar o resumo do projeto desta conversa.')
    if (!result.data || typeof result.data.fields !== 'object' || result.data.fields === null || Array.isArray(result.data.fields)) return undefined
    return result.data.fields as WhatsAppAgentQualification
  }

  async getAgentQualification(userId: string, conversationId: string): Promise<WhatsAppAgentQualification | undefined> {
    const result = await createWhatsAppWebhookSupabaseClient().from('whatsapp_agent_qualifications')
      .select('fields').eq('conversation_id', conversationId).eq('user_id', userId)
      .gt('expires_at', new Date().toISOString()).maybeSingle()
    throwIfError(result.error, 'Não foi possível carregar as informações já declaradas pelo lead.')
    if (!result.data || typeof result.data.fields !== 'object' || result.data.fields === null || Array.isArray(result.data.fields)) return undefined
    return result.data.fields as WhatsAppAgentQualification
  }

  async purgeExpiredAgentQualifications() {
    const result = await createWhatsAppWebhookSupabaseClient().rpc('purge_expired_whatsapp_agent_qualifications')
    throwIfError(result.error, 'Não foi possível remover dados de qualificação expirados.')
    return typeof result.data === 'number' ? result.data : 0
  }

  async listConnections(userId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin
      .from('whatsapp_phone_number_connections')
      .select('phone_number_id, display_phone_number, platform_type, created_at')
      .eq('user_id', userId)
      .in('platform_type', ['EVOLUTION_API', 'OPENCLAW_WEB'])
      .order('created_at', { ascending: false })
    throwIfError(result.error, 'Não foi possível carregar as conexões WhatsApp desta conta.')
    return (result.data ?? []).map((row) => ({
      phoneNumberId: row.phone_number_id as string,
      displayPhoneNumber: row.display_phone_number as string | null,
      platformType: row.platform_type as string | null,
      connectedAt: row.created_at as string,
    }))
  }

  async persistWebhookEvents(events: WhatsAppWebhookEvents): Promise<void> {
    const phoneNumberIds = [...new Set([
      ...events.messages.map((event) => event.phoneNumberId),
      ...events.statuses.map((event) => event.phoneNumberId),
      ...events.contacts.map((event) => event.phoneNumberId),
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
        .select('id, user_id, phone_number_id, contact_wa_id, linked_lead_id')
        .eq('user_id', connection.user_id)
        .eq('phone_number_id', phoneNumberId)
        .in('contact_wa_id', contactWaIds)
      throwIfError(conversationResult.error, 'Não foi possível preparar as conversas do webhook.')
      const conversations = new Map(
        (conversationResult.data as Pick<ConversationRow, 'id' | 'user_id' | 'phone_number_id' | 'contact_wa_id' | 'linked_lead_id'>[])
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
          source: event.source,
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
          source: 'live' as const,
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

      const respondedLeadIds = [...new Set(messages.flatMap((event) => {
        if (event.direction !== 'inbound') return []
        const linkedLeadId = conversations.get(event.contactWaId)?.linked_lead_id
        return linkedLeadId ? [linkedLeadId] : []
      }))]
      if (respondedLeadIds.length > 0) {
        const leadStatusResult = await admin.from('saved_leads')
          .update({ status: 'Respondeu', updated_at: new Date().toISOString() })
          .eq('user_id', connection.user_id)
          .in('lead_id', respondedLeadIds)
          .eq('status', 'Contatado')
        throwIfError(leadStatusResult.error, 'Não foi possível avançar os leads que responderam no funil.')
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

      const latestQueueStatuses = new Map<string, (typeof statuses)[number]>()
      for (const event of statuses) {
        const current = latestQueueStatuses.get(event.providerMessageId)
        if (!current || Date.parse(event.occurredAt) >= Date.parse(current.occurredAt)) {
          latestQueueStatuses.set(event.providerMessageId, event)
        }
      }
      for (const event of latestQueueStatuses.values()) {
        // OpenClaw's public message_sent hook confirms send success or failure,
        // not WhatsApp recipient delivery/read receipts.
        if (event.status !== 'sent' && event.status !== 'failed') continue
        const failed = event.status === 'failed'
        const queueUpdate = await admin.from('whatsapp_prospecting_queue')
          .update({
            status: failed ? 'failed' : 'sent',
            delivery_status: event.status,
            ...(failed ? {} : { sent_at: event.occurredAt }),
            error_code: failed ? 'provider_delivery_failed' : null,
            updated_at: new Date().toISOString(),
          })
          .eq('provider_message_id', event.providerMessageId)
          .in('status', ['sending', 'sent', 'unknown'])
        throwIfError(queueUpdate.error, 'Não foi possível atualizar o resultado de entrega da fila.')
      }
    }
  }

  async listPendingLiveInboundTextEvents(limit = 50): Promise<WhatsAppWebhookEvents> {
    const admin = createWhatsAppWebhookSupabaseClient()
    const oldestAllowed = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString()
    const pendingRows: Array<{
      phone_number_id: string
      provider_message_id: string
      contact_wa_id: string
      occurred_at: string
      message_type: string
      body: string | null
      source: 'live' | 'history'
      automationRunId?: string
    }> = []
    const pageSize = 100
    let offset = 0
    while (pendingRows.length < limit) {
      const result = await admin.from('whatsapp_messages')
        .select('phone_number_id, provider_message_id, contact_wa_id, occurred_at, message_type, body, source')
        .eq('direction', 'inbound')
        .eq('message_type', 'text')
        .eq('source', 'live')
        .eq('is_placeholder', false)
        .not('body', 'is', null)
        .gte('occurred_at', oldestAllowed)
        .order('occurred_at', { ascending: true })
        .order('created_at', { ascending: true })
        .range(offset, offset + pageSize - 1)
      throwIfError(result.error, 'Não foi possível consultar as respostas recebidas para automação local.')
      const rows = (result.data ?? []) as typeof pendingRows
      if (rows.length === 0) break

      const ids = rows.map((row) => row.provider_message_id)
      const runs = await admin.from('whatsapp_automation_runs')
        .select('phone_number_id, inbound_provider_message_id, status, reason, completed_at, reply_provider_message_id, response_provider')
        .in('phone_number_id', [...new Set(rows.map((row) => row.phone_number_id))])
        .in('inbound_provider_message_id', ids)
      throwIfError(runs.error, 'Não foi possível verificar quais respostas já foram processadas.')
      const processed = new Set(((runs.data ?? []) as Array<AutomationRunState & { phone_number_id: string; inbound_provider_message_id: string }>)
        .filter((run) => !(run.status === 'processing' && (run as AutomationRunState & { response_provider?: string }).response_provider === 'openbot') && !nextGenerationRetryAttempt(run))
        .map((run) => `${run.phone_number_id}:${run.inbound_provider_message_id}`))
      pendingRows.push(...rows.filter((row) => !processed.has(`${row.phone_number_id}:${row.provider_message_id}`)).slice(0, limit - pendingRows.length))

      offset += rows.length
      if (rows.length < pageSize) break
    }

    const pendingRuns = await admin.from('whatsapp_automation_runs')
      .select('id, phone_number_id, inbound_provider_message_id')
      .eq('status', 'processing').eq('response_provider', 'openbot')
      .order('created_at', { ascending: true }).limit(Math.min(limit, 50))
    throwIfError(pendingRuns.error, 'Não foi possível consultar execuções OpenBot pendentes.')
    const runRows = (pendingRuns.data ?? []) as Array<{ id: string; phone_number_id: string; inbound_provider_message_id: string }>
    if (runRows.length > 0) {
      const inboundRows = await admin.from('whatsapp_messages')
        .select('phone_number_id, provider_message_id, contact_wa_id, occurred_at, message_type, body, source')
        .in('phone_number_id', [...new Set(runRows.map((run) => run.phone_number_id))])
        .in('provider_message_id', [...new Set(runRows.map((run) => run.inbound_provider_message_id))])
        .eq('direction', 'inbound').eq('source', 'live').eq('message_type', 'text')
        .eq('is_placeholder', false)
      throwIfError(inboundRows.error, 'Não foi possível carregar as mensagens das execuções OpenBot pendentes.')
      const byKey = new Map(runRows.map((run) => [`${run.phone_number_id}:${run.inbound_provider_message_id}`, run.id]))
      const known = new Set(pendingRows.map((row) => `${row.phone_number_id}:${row.provider_message_id}`))
      for (const row of (inboundRows.data ?? []) as typeof pendingRows) {
        const key = `${row.phone_number_id}:${row.provider_message_id}`
        const automationRunId = byKey.get(key)
        if (!automationRunId) continue
        const existingIndex = pendingRows.findIndex((candidate) => `${candidate.phone_number_id}:${candidate.provider_message_id}` === key)
        if (existingIndex >= 0) {
          pendingRows[existingIndex] = { ...pendingRows[existingIndex]!, automationRunId }
        } else if (!known.has(key) && pendingRows.length < limit + runRows.length) {
          pendingRows.push({ ...row, automationRunId })
          known.add(key)
        }
      }
    }

    if (pendingRows.length === 0) return { messages: [], statuses: [], contacts: [] }

    return {
      messages: pendingRows.map((row) => ({
        phoneNumberId: row.phone_number_id,
        providerMessageId: row.provider_message_id,
        contactWaId: row.contact_wa_id,
        occurredAt: row.occurred_at,
        direction: 'inbound' as const,
        source: row.source,
        messageType: row.message_type,
        ...(row.automationRunId ? { automationRunId: row.automationRunId } : {}),
        ...(row.body ? { body: row.body } : {}),
      })),
      statuses: [],
      contacts: [],
    }
  }

  async listConversations(accessToken: string, userId: string, options: WhatsAppPageOptions) {
    let query = this.userClient(accessToken)
      .from('whatsapp_conversations')
      .select('id, user_id, phone_number_id, contact_wa_id, contact_name, linked_lead_id, automation_handoff_note, last_message_at, last_message_preview, last_message_direction, automation_paused, automation_opted_out, automation_pause_reason, created_at, updated_at')
      .eq('user_id', userId)
      .not('last_message_at', 'is', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(options.limit + 1)
    if (options.before) query = query.or(cursorFilter('last_message_at', options.before))

    const result = await query
    throwIfError(result.error)
    const page = latestPage(result.data as ConversationRow[], options.limit, (row) => row.last_message_at!)
    const linkedLeadNames = await this.getLinkedLeadNames(accessToken, userId, page.data)
    return {
      data: page.data.map((row) => ({
        id: row.id,
        phoneNumberId: row.phone_number_id,
        contactWaId: row.contact_wa_id,
        contactName: row.contact_name ?? undefined,
        linkedLeadId: row.linked_lead_id ?? undefined,
        linkedLeadName: row.linked_lead_id ? linkedLeadNames.get(row.linked_lead_id) : undefined,
        automationHandoffNote: row.automation_handoff_note ?? undefined,
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

  async countHumanPendingConversations(accessToken: string, userId: string) {
    const result = await this.userClient(accessToken)
      .from('whatsapp_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('automation_pause_reason', ['handoff', 'handoff_send_failed'])
    throwIfError(result.error, 'Não foi possível consultar os atendimentos humanos pendentes.')
    return result.count ?? 0
  }

  async listHumanPendingConversations(accessToken: string, userId: string) {
    const result = await this.userClient(accessToken)
      .from('whatsapp_conversations')
      .select('id, user_id, phone_number_id, contact_wa_id, contact_name, linked_lead_id, automation_handoff_note, last_message_at, last_message_preview, last_message_direction, automation_paused, automation_opted_out, automation_pause_reason, created_at, updated_at')
      .eq('user_id', userId)
      .in('automation_pause_reason', ['handoff', 'handoff_send_failed'])
      .not('last_message_at', 'is', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(1000)
    throwIfError(result.error, 'Não foi possível carregar os atendimentos humanos pendentes.')
    const rows = (result.data ?? []) as ConversationRow[]
    const linkedLeadNames = await this.getLinkedLeadNames(accessToken, userId, rows)
    return rows.map((row) => ({
      id: row.id,
      phoneNumberId: row.phone_number_id,
      contactWaId: row.contact_wa_id,
      contactName: row.contact_name ?? undefined,
      linkedLeadId: row.linked_lead_id ?? undefined,
      linkedLeadName: row.linked_lead_id ? linkedLeadNames.get(row.linked_lead_id) : undefined,
      automationHandoffNote: row.automation_handoff_note ?? undefined,
      lastMessageAt: row.last_message_at ?? undefined,
      lastMessagePreview: row.last_message_preview ?? undefined,
      lastMessageDirection: row.last_message_direction ?? undefined,
      automationPaused: row.automation_paused === true,
      automationOptedOut: row.automation_opted_out === true,
      automationPauseReason: row.automation_pause_reason ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  private async getLinkedLeadNames(accessToken: string, userId: string, conversations: ConversationRow[]) {
    const leadIds = [...new Set(conversations.flatMap((row) => row.linked_lead_id ? [row.linked_lead_id] : []))]
    if (leadIds.length === 0) return new Map<string, string>()
    const result = await this.userClient(accessToken).from('saved_leads')
      .select('lead_id, lead_data')
      .eq('user_id', userId)
      .in('lead_id', leadIds)
    throwIfError(result.error, 'Não foi possível carregar os leads vinculados às conversas.')
    return new Map(((result.data ?? []) as Array<{ lead_id: string; lead_data: unknown }>).flatMap((row) => (
      isRecord(row.lead_data) && typeof row.lead_data.name === 'string'
        ? [[row.lead_id, row.lead_data.name] as const]
        : []
    )))
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
