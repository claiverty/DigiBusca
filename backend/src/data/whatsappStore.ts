import type { SupabaseClient } from '@supabase/supabase-js'
import { createUserSupabaseClient, createWhatsAppWebhookSupabaseClient } from '../config/supabase.js'
import type { WhatsAppPageOptions } from '../contracts/whatsapp.js'
import type { WhatsAppWebhookEvents } from '../application/whatsappWebhook.js'
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
      const result = await admin.from('whatsapp_phone_number_connections')
        .select('phone_number_id, platform_type').limit(0)
      return !result.error
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

  async getEvolutionInstanceName(userId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin.from('whatsapp_phone_number_connections')
      .select('phone_number_id').eq('user_id', userId).eq('platform_type', 'EVOLUTION_API')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    throwIfError(result.error, 'Não foi possível carregar a instância Evolution desta conta.')
    return (result.data as { phone_number_id: string } | null)?.phone_number_id
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
      .select('contact_wa_id')
      .single()
    throwIfError(result.error, 'Não foi possível registrar o pedido de parada desta conversa.')

    const contactWaId = (result.data as { contact_wa_id: string }).contact_wa_id
    const leadsResult = await admin.from('saved_leads')
      .select('lead_id, lead_data')
      .eq('user_id', userId)
    throwIfError(leadsResult.error, 'Não foi possível aplicar o descadastro ao lead salvo.')
    const matchingLeadIds = ((leadsResult.data ?? []) as Array<{ lead_id: string; lead_data: unknown }>)
      .filter((lead) => isRecord(lead.lead_data) && typeof lead.lead_data.phone === 'string'
        && normalizeWhatsAppContactNumber(lead.lead_data.phone) === normalizeWhatsAppContactNumber(contactWaId))
      .map((lead) => lead.lead_id)
    if (matchingLeadIds.length === 0) return

    const now = new Date().toISOString()
    const leadUpdate = await admin.from('saved_leads')
      .update({
        whatsapp_consent_status: 'opted_out',
        whatsapp_consent_source: 'Pedido de parada recebido no WhatsApp',
        whatsapp_consent_at: now,
        updated_at: now,
      })
      .eq('user_id', userId)
      .in('lead_id', matchingLeadIds)
    throwIfError(leadUpdate.error, 'Não foi possível atualizar o descadastro do lead salvo.')
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

  async listConnections(userId: string) {
    const admin = createWhatsAppWebhookSupabaseClient()
    const result = await admin
      .from('whatsapp_phone_number_connections')
      .select('phone_number_id, display_phone_number, platform_type, created_at')
      .eq('user_id', userId)
      .eq('platform_type', 'EVOLUTION_API')
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
        const failed = event.status === 'failed'
        const queueUpdate = await admin.from('whatsapp_prospecting_queue')
          .update({
            status: failed ? 'failed' : 'sent',
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
        .select('inbound_provider_message_id')
        .in('inbound_provider_message_id', ids)
      throwIfError(runs.error, 'Não foi possível verificar quais respostas já foram processadas.')
      const processed = new Set(((runs.data ?? []) as Array<{ inbound_provider_message_id: string }>).map((row) => row.inbound_provider_message_id))
      pendingRows.push(...rows.filter((row) => !processed.has(row.provider_message_id)).slice(0, limit - pendingRows.length))

      offset += rows.length
      if (rows.length < pageSize) break
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
        ...(row.body ? { body: row.body } : {}),
      })),
      statuses: [],
      contacts: [],
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
