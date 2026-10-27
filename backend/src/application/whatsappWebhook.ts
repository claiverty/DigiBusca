const encoder = new TextEncoder()

export const whatsappWebhookMaxBodyBytes = 1_000_000

export class WhatsAppWebhookPayloadError extends Error {
  constructor(message = 'O payload do webhook WhatsApp é inválido.') {
    super(message)
    this.name = 'WhatsAppWebhookPayloadError'
  }
}

export type WhatsAppWebhookMessage = {
  phoneNumberId: string
  wabaId?: string
  providerMessageId: string
  contactWaId: string
  contactName?: string
  occurredAt: string
  direction: 'inbound' | 'outbound'
  messageType: string
  body?: string
}

export type WhatsAppWebhookStatus = {
  phoneNumberId: string
  wabaId?: string
  providerMessageId: string
  recipientWaId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  occurredAt: string
}

export type WhatsAppWebhookContact = {
  contactWaId: string
  contactName?: string
  action: 'add' | 'remove'
  occurredAt: string
}

export type WhatsAppWebhookSyncState = {
  phoneNumberId: string
  syncType: 'history' | 'smb_app_state_sync'
  state: Record<string, unknown>
}

export type WhatsAppWebhookEvents = {
  messages: WhatsAppWebhookMessage[]
  statuses: WhatsAppWebhookStatus[]
  contacts: Array<{ phoneNumberId: string; wabaId?: string; contacts: WhatsAppWebhookContact[] }>
  syncStates: WhatsAppWebhookSyncState[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined
}

function unixSecondsToIso(value: unknown): string | undefined {
  const raw = typeof value === 'number' ? String(value) : value
  if (typeof raw !== 'string' || !/^\d{1,12}$/.test(raw)) return undefined
  const seconds = Number(raw)
  if (!Number.isSafeInteger(seconds)) return undefined
  const milliseconds = seconds * 1_000
  if (!Number.isSafeInteger(milliseconds)) return undefined
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index % Math.max(1, left.length)] ?? 0) ^ (right[index % Math.max(1, right.length)] ?? 0)
  }
  return difference === 0
}

async function sha256(value: string) {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

export async function matchesWhatsAppWebhookVerifyToken(candidate: string, configuredToken: string) {
  const [candidateHash, configuredHash] = await Promise.all([sha256(candidate), sha256(configuredToken)])
  return constantTimeEqual(candidateHash, configuredHash)
}

export async function verifyWhatsAppWebhookSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null | undefined,
  appSecret: string,
) {
  const match = signatureHeader?.match(/^sha256=([a-f\d]{64})$/i)
  if (!match) return false

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, toArrayBuffer(rawBody)))
  const supplied = new Uint8Array(match[1].match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)))
  return constantTimeEqual(digest, supplied)
}

function normalizeWaId(value: unknown) {
  const candidate = boundedString(value, 128)
  return candidate?.replace(/^\+/, '')
}

function parseContactNames(value: unknown) {
  const names = new Map<string, string>()
  if (!Array.isArray(value)) return names
  for (const contact of value) {
    if (!isRecord(contact)) continue
    const waId = normalizeWaId(contact.wa_id ?? contact.phone_number ?? contact.id)
    const profile = isRecord(contact.profile) ? contact.profile : undefined
    const name = boundedString(contact.full_name, 200) ??
      boundedString(profile?.name, 200) ?? boundedString(contact.name, 200) ??
      boundedString(contact.first_name, 200)
    if (waId && name) names.set(waId, name)
  }
  return names
}

function parseMessage(
  message: unknown,
  phoneNumberId: string,
  wabaId: string | undefined,
  contactWaId: string | undefined,
  contactName: string | undefined,
  direction: 'inbound' | 'outbound',
): WhatsAppWebhookMessage | undefined {
  if (!isRecord(message)) return undefined
  const providerMessageId = boundedString(message.id, 256)
  const resolvedContactId = contactWaId ?? normalizeWaId(message.from)
  const occurredAt = unixSecondsToIso(message.timestamp)
  const messageType = boundedString(message.type, 64)
  if (!providerMessageId || !resolvedContactId || !occurredAt || !messageType) return undefined

  const text = isRecord(message.text) ? boundedString(message.text.body, 10_000) : undefined
  return {
    phoneNumberId,
    ...(wabaId ? { wabaId } : {}),
    providerMessageId,
    contactWaId: resolvedContactId,
    ...(contactName ? { contactName } : {}),
    occurredAt,
    direction,
    messageType,
    ...(text ? { body: text } : {}),
  }
}

function normalizeStatus(value: unknown): WhatsAppWebhookStatus['status'] | undefined {
  if (typeof value !== 'string') return undefined
  const status = value.toLowerCase()
  return status === 'sent' || status === 'delivered' || status === 'read' || status === 'failed'
    ? status
    : undefined
}

function getContactEventRows(value: Record<string, unknown>) {
  const syncValue = value.smb_app_state_sync
  if (Array.isArray(syncValue)) return syncValue
  if (isRecord(syncValue) && Array.isArray(syncValue.contacts)) return syncValue.contacts
  if (Array.isArray(value.contacts)) return value.contacts
  return []
}

function parseAppStateContacts(value: Record<string, unknown>, occurredAt: string): WhatsAppWebhookContact[] {
  const rows = getContactEventRows(value)
  const contacts: WhatsAppWebhookContact[] = []
  for (const row of rows) {
    if (!isRecord(row)) continue
    const contactWaId = normalizeWaId(row.phone_number ?? row.wa_id ?? row.contact_id ?? row.id)
    if (!contactWaId) continue
    const action = row.action === 'remove' ? 'remove' : 'add'
    const contactName = boundedString(row.full_name, 200) ??
      boundedString(row.name, 200) ?? boundedString(row.first_name, 200)
    contacts.push({
      contactWaId,
      ...(contactName ? { contactName } : {}),
      action,
      occurredAt: unixSecondsToIso(row.timestamp) ?? occurredAt,
    })
  }
  return contacts
}

function extractHistoryState(history: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(history)) return undefined
  const newest = history.filter(isRecord).at(-1)
  if (!newest) return { receivedAt: new Date().toISOString(), chunks: history.length }
  const metadata = isRecord(newest.metadata) ? newest.metadata : {}
  const errors = Array.isArray(newest.errors) ? newest.errors.filter(isRecord).map((error) => ({
    code: typeof error.code === 'number' ? error.code : undefined,
    title: boundedString(error.title, 300),
  })) : undefined
  return {
    receivedAt: new Date().toISOString(),
    ...(typeof metadata.phase === 'number' || typeof metadata.phase === 'string' ? { phase: metadata.phase } : {}),
    ...(typeof metadata.chunk_order === 'number' ? { chunkOrder: metadata.chunk_order } : {}),
    ...(typeof metadata.progress === 'number' || typeof metadata.progress === 'string' ? { progress: metadata.progress } : {}),
    ...(errors?.length ? { errors } : {}),
    chunksInEvent: history.length,
  }
}

function isBusinessPhone(value: unknown, displayPhoneNumber: string | undefined, phoneNumberId: string) {
  const candidate = normalizeWaId(value)
  const display = normalizeWaId(displayPhoneNumber)
  return candidate === phoneNumberId || Boolean(candidate && display && candidate === display)
}

export function parseWhatsAppWebhookEvents(rawBody: Uint8Array): WhatsAppWebhookEvents {
  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody))
  } catch {
    throw new WhatsAppWebhookPayloadError('O corpo assinado do webhook não contém JSON válido.')
  }

  if (!isRecord(payload) || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    throw new WhatsAppWebhookPayloadError()
  }

  const events: WhatsAppWebhookEvents = { messages: [], statuses: [], contacts: [], syncStates: [] }
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue
    const wabaId = boundedString(entry.id, 128)
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue
      const value = change.value
      const field = boundedString(change.field, 128)
      const metadata = isRecord(value.metadata) ? value.metadata : undefined
      const nestedHistory = Array.isArray(value.history) ? value.history : []
      const nestedMetadata = nestedHistory.map((history) => (
        isRecord(history) && isRecord(history.metadata) ? history.metadata : undefined
      )).find(Boolean)
      const phoneNumberId = boundedString(metadata?.phone_number_id, 128) ??
        boundedString(value.phone_number_id, 128) ?? boundedString(nestedMetadata && isRecord(nestedMetadata) ? nestedMetadata.phone_number_id : undefined, 128)
      if (!phoneNumberId) continue

      const occurredAt = new Date().toISOString()
      const contactNames = parseContactNames(value.contacts)
      if (field === 'messages' || !field) {
        if (Array.isArray(value.messages)) {
          for (const message of value.messages) {
            if (!isRecord(message)) continue
            const contactWaId = normalizeWaId(message.from)
            const parsed = parseMessage(message, phoneNumberId, wabaId, contactWaId, contactWaId ? contactNames.get(contactWaId) : undefined, 'inbound')
            if (parsed) events.messages.push(parsed)
          }
        }
        if (Array.isArray(value.statuses)) {
          for (const status of value.statuses) {
            if (!isRecord(status)) continue
            const providerMessageId = boundedString(status.id, 256)
            const recipientWaId = normalizeWaId(status.recipient_id)
            const timestamp = unixSecondsToIso(status.timestamp)
            const normalizedStatus = normalizeStatus(status.status)
            if (!providerMessageId || !recipientWaId || !timestamp || !normalizedStatus) continue
            events.statuses.push({
              phoneNumberId,
              ...(wabaId ? { wabaId } : {}),
              providerMessageId,
              recipientWaId,
              status: normalizedStatus,
              occurredAt: timestamp,
            })
          }
        }
      }

      if (field === 'smb_message_echoes') {
        const echoes = Array.isArray(value.message_echoes) ? value.message_echoes
          : Array.isArray(value.messages) ? value.messages : []
        for (const message of echoes) {
          if (!isRecord(message)) continue
          const contactWaId = normalizeWaId(message.to ?? message.recipient_id)
          const parsed = parseMessage(message, phoneNumberId, wabaId, contactWaId, contactWaId ? contactNames.get(contactWaId) : undefined, 'outbound')
          if (parsed) events.messages.push(parsed)
        }
      }

      if (field === 'history' && Array.isArray(value.history)) {
        const state = extractHistoryState(value.history)
        if (state) events.syncStates.push({ phoneNumberId, syncType: 'history', state })
        const displayPhoneNumber = boundedString(metadata?.display_phone_number, 64)
        for (const history of value.history) {
          if (!isRecord(history) || !Array.isArray(history.threads)) continue
          for (const thread of history.threads) {
            if (!isRecord(thread) || !Array.isArray(thread.messages)) continue
            const contactWaId = normalizeWaId(thread.id)
            if (!contactWaId) continue
            for (const message of thread.messages) {
              if (!isRecord(message)) continue
              const direction = isBusinessPhone(message.from, displayPhoneNumber, phoneNumberId) ||
                normalizeWaId(message.to) === contactWaId
                ? 'outbound'
                : 'inbound'
              const parsed = parseMessage(message, phoneNumberId, wabaId, contactWaId, contactNames.get(contactWaId), direction)
              if (!parsed) continue
              events.messages.push(parsed)
              const historyStatus = isRecord(message.history_context) ? normalizeStatus(message.history_context.status) : undefined
              if (historyStatus) {
                events.statuses.push({
                  phoneNumberId,
                  ...(wabaId ? { wabaId } : {}),
                  providerMessageId: parsed.providerMessageId,
                  recipientWaId: contactWaId,
                  status: historyStatus,
                  occurredAt: parsed.occurredAt,
                })
              }
            }
          }
        }
      }

      if (field === 'smb_app_state_sync') {
        const contacts = parseAppStateContacts(value, occurredAt)
        if (contacts.length > 0) events.contacts.push({ phoneNumberId, ...(wabaId ? { wabaId } : {}), contacts })
        events.syncStates.push({
          phoneNumberId,
          syncType: 'smb_app_state_sync',
          state: {
            receivedAt: occurredAt,
            contactCount: contacts.length,
            addedCount: contacts.filter((contact) => contact.action === 'add').length,
            removedCount: contacts.filter((contact) => contact.action === 'remove').length,
          },
        })
      }
    }
  }

  return events
}
