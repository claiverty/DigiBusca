import type { SupabaseClient } from '@supabase/supabase-js'
import { createUserSupabaseClient, createWhatsAppWebhookSupabaseClient, getWhatsAppEmbeddedSignupServerConfig } from '../config/supabase.js'
import type { WhatsAppPageOptions } from '../contracts/whatsapp.js'
import type { WhatsAppWebhookEvents } from '../application/whatsappWebhook.js'
import { encryptWhatsAppAccessToken } from '../integrations/whatsappTokenVault.js'
import type { WhatsAppCoexistencePhone } from '../integrations/whatsappEmbeddedSignup.js'

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
  created_at: string
  updated_at: string
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
        const stateResult = await admin
          .from('whatsapp_phone_number_connections')
          .update({ [stateColumn]: syncState.state, updated_at: new Date().toISOString() })
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
      .select('id, user_id, phone_number_id, contact_wa_id, contact_name, last_message_at, last_message_preview, last_message_direction, created_at, updated_at')
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
