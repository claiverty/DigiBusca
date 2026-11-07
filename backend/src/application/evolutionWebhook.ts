import type { WhatsAppWebhookEvents } from './whatsappWebhook.js'
import { WhatsAppStore } from '../data/whatsappStore.js'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function phoneFromJid(value: unknown) {
  if (typeof value !== 'string' || value.length > 256) return undefined
  if (value.endsWith('@g.us') || value.endsWith('@broadcast') || value === 'status@broadcast') return undefined
  const user = value.split('@')[0]?.split(':')[0]
  if (!user || !/^\+?\d{6,20}$/.test(user)) return undefined
  return user.replace(/^\+/, '')
}

function textFromMessage(message: JsonRecord) {
  for (const value of [
    message.conversation,
    isRecord(message.extendedTextMessage) ? message.extendedTextMessage.text : undefined,
    isRecord(message.imageMessage) ? message.imageMessage.caption : undefined,
    isRecord(message.videoMessage) ? message.videoMessage.caption : undefined,
    isRecord(message.documentMessage) ? message.documentMessage.caption : undefined,
    isRecord(message.buttonsResponseMessage) ? message.buttonsResponseMessage.selectedDisplayText : undefined,
    isRecord(message.listResponseMessage) ? message.listResponseMessage.title : undefined,
    isRecord(message.templateButtonReplyMessage) ? message.templateButtonReplyMessage.selectedDisplayText : undefined,
  ]) {
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 10_000)
  }
  return undefined
}

function timestamp(value: unknown) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (typeof number === 'number' && Number.isFinite(number)) {
    const millis = number > 10_000_000_000 ? number : number * 1_000
    const parsed = new Date(millis)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return new Date().toISOString()
}

function mapEvolutionMessages(instance: string, data: unknown): WhatsAppWebhookEvents['messages'] {
  const entries = Array.isArray(data) ? data : [data]
  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const key = isRecord(entry.key) ? entry.key : {}
    const rawJid = key.remoteJidAlt ?? key.remoteJid ?? entry.remoteJid
    const contactWaId = phoneFromJid(rawJid)
    const id = key.id ?? entry.id
    if (!contactWaId || typeof id !== 'string' || !id.trim()) return []
    const content = isRecord(entry.message) ? entry.message : {}
    const type = typeof entry.messageType === 'string' ? entry.messageType
      : Object.keys(content)[0] ?? 'unknown'
    const body = textFromMessage(content)
    return [{
      phoneNumberId: instance,
      providerMessageId: id.slice(0, 256),
      contactWaId,
      ...(typeof entry.pushName === 'string' && entry.pushName.trim() ? { contactName: entry.pushName.trim().slice(0, 160) } : {}),
      occurredAt: timestamp(entry.messageTimestamp ?? entry.messageTimestampMs),
      direction: key.fromMe === true ? 'outbound' as const : 'inbound' as const,
      source: 'live' as const,
      messageType: (body ? 'text' : type).slice(0, 80),
      ...(body ? { body } : {}),
    }]
  })
}

export async function persistEvolutionWebhook(body: unknown) {
  if (!isRecord(body)) return
  const event = typeof body.event === 'string' ? body.event.toLowerCase() : ''
  const instance = typeof body.instance === 'string' ? body.instance.trim() : ''
  if (!instance || !/^[-_a-zA-Z0-9]{1,128}$/.test(instance) || event !== 'messages.upsert') return
  const messages = mapEvolutionMessages(instance, body.data)
  if (messages.length === 0) return
  await new WhatsAppStore().persistWebhookEvents({ messages, statuses: [], contacts: [] })
}
