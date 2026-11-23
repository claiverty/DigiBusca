import { getOpenClawBridgeConfig } from '../config/supabase.js'
import type { WhatsAppWebhookEvents } from './whatsappWebhook.js'
import { persistWhatsAppStopRequests } from './processWhatsAppAutomation.js'
import { WhatsAppStore } from '../data/whatsappStore.js'
import { WhatsAppProspectingError, WhatsAppProspectingStore } from '../data/whatsappProspectingStore.js'

export class OpenClawBridgeError extends Error {
  constructor(readonly status: 400 | 403 | 409 | 503, message: string) {
    super(message)
    this.name = 'OpenClawBridgeError'
  }
}

type OpenClawInboundInput = {
  phoneNumberId: string
  senderE164: string
  providerMessageId: string
  openClawRunId?: string
  openClawSessionKey?: string
  contactName?: string
  content?: string
  messageType?: string
  occurredAt: string
}

type OpenClawOutboundInput = {
  phoneNumberId: string
  recipientE164: string
  providerMessageId: string
  openClawRunId?: string
  openClawSessionKey?: string
  content?: string
  messageType?: string
  occurredAt: string
  success: boolean
}

type OpenClawOutboundAuthorizationInput = {
  phoneNumberId: string
  recipientE164: string
  openClawRunId?: string
  openClawSessionKey?: string
  content: string
}

function normalizeE164(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15 ? digits : undefined
}

function assertPhoneNumberId(phoneNumberId: string) {
  const config = getOpenClawBridgeConfig()
  if (!config) throw new OpenClawBridgeError(503, 'A ponte privada do Cristhian não está configurada.')
  if (phoneNumberId !== config.phoneNumberId) throw new OpenClawBridgeError(403, 'Este número não pertence à conexão OpenClaw configurada.')
  return config
}

function validTime(value: string) {
  const time = Date.parse(value)
  if (!Number.isFinite(time) || time > Date.now() + 5 * 60_000) return undefined
  return new Date(time).toISOString()
}

function validateMessageId(value: string) {
  return value.length <= 240 && /^[A-Za-z0-9_.:@/-]{1,240}$/.test(value)
}

function validSessionKey(value: string | undefined) {
  const key = value?.trim()
  return key && key.length <= 512 && !/[\u0000-\u001f]/.test(key) ? key : undefined
}

async function requireOpenClawTransport(ownerUserId: string, phoneNumberId: string) {
  const store = new WhatsAppStore()
  const platformType = await store.getConnectionPlatformType(ownerUserId, phoneNumberId)
  if (platformType !== 'OPENCLAW_WEB') {
    throw new OpenClawBridgeError(409, 'A conexão ainda não foi transferida para o WhatsApp Web do OpenClaw.')
  }
  return store
}

export async function persistOpenClawInbound(input: OpenClawInboundInput) {
  const config = assertPhoneNumberId(input.phoneNumberId)
  const sender = normalizeE164(input.senderE164)
  const occurredAt = validTime(input.occurredAt)
  if (!sender || !input.senderE164.startsWith('+')) throw new OpenClawBridgeError(400, 'Remetente WhatsApp inválido.')
  if (!validateMessageId(input.providerMessageId)) throw new OpenClawBridgeError(400, 'Identificador da mensagem inválido.')
  if (!occurredAt) throw new OpenClawBridgeError(400, 'Data da mensagem inválida.')
  if (Date.now() - Date.parse(occurredAt) >= 24 * 60 * 60_000) {
    return { dispatch: false, reason: 'outside_reply_window' }
  }
  if (input.content !== undefined && (typeof input.content !== 'string' || input.content.length > 10_000)) {
    throw new OpenClawBridgeError(400, 'A mensagem ultrapassa o limite permitido.')
  }

  const store = await requireOpenClawTransport(config.ownerUserId, config.phoneNumberId)
  const providerMessageId = `openclaw:${input.providerMessageId}`.slice(0, 256)
  const events: WhatsAppWebhookEvents = {
    messages: [{
      phoneNumberId: config.phoneNumberId,
      providerMessageId,
      contactWaId: sender,
      ...(input.contactName?.trim() ? { contactName: input.contactName.trim().slice(0, 160) } : {}),
      occurredAt,
      direction: 'inbound',
      source: 'live',
      messageType: (input.messageType?.trim() || (input.content ? 'text' : 'unknown')).slice(0, 80),
      ...(input.content?.trim() ? { body: input.content.trim() } : {}),
    }],
    statuses: [],
    contacts: [],
  }
  await store.persistWebhookEvents(events)
  await persistWhatsAppStopRequests(events)

  const context = await store.getAutomationRuntimeContext(config.phoneNumberId, sender)
  const profile = context?.profile
  if (
    !context || context.userId !== config.ownerUserId || !profile ||
    profile.responseMode !== 'openclaw' || !profile.automationEnabled ||
    !profile.channelApprovedAt || !profile.contentApprovedAt ||
    context.automationPaused || context.automationOptedOut
  ) {
    return { dispatch: false, reason: context?.automationOptedOut ? 'opted_out' : context?.automationPaused ? 'paused' : 'profile_not_ready' }
  }

  const openClawRunId = input.openClawRunId?.trim() || input.providerMessageId
  if (openClawRunId.length > 240 || !validateMessageId(openClawRunId)) {
    throw new OpenClawBridgeError(400, 'Identificador da execução inválido.')
  }
  const claim = await store.claimOpenClawAutomationRun(
    config.ownerUserId,
    config.phoneNumberId,
    context.conversationId,
    providerMessageId,
    openClawRunId,
    validSessionKey(input.openClawSessionKey),
  )
  if (!claim) return { dispatch: false, reason: 'duplicate' }
  return { dispatch: true, reason: 'approved', runId: openClawRunId }
}

export async function authorizeOpenClawOutbound(input: OpenClawOutboundAuthorizationInput) {
  const config = assertPhoneNumberId(input.phoneNumberId)
  const recipient = normalizeE164(input.recipientE164)
  if (!recipient || !input.recipientE164.startsWith('+')) throw new OpenClawBridgeError(400, 'Destinatário WhatsApp inválido.')
  if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 10_000) {
    throw new OpenClawBridgeError(400, 'A mensagem de saída é inválida.')
  }
  if (`+${recipient}` === config.operatorE164) return { allowed: true, reason: 'operator' }

  const store = await requireOpenClawTransport(config.ownerUserId, config.phoneNumberId)
  const context = await store.getAutomationRuntimeContext(config.phoneNumberId, recipient)
  if (context) {
    const profile = context.profile
    const lastInbound = context.lastMessageAt ? Date.parse(context.lastMessageAt) : Number.NaN
    const inReplyWindow = Number.isFinite(lastInbound) && Date.now() - lastInbound >= 0 && Date.now() - lastInbound < 24 * 60 * 60_000
    const profileAllowsReply =
      context.userId === config.ownerUserId && profile?.responseMode === 'openclaw' && profile.automationEnabled &&
      Boolean(profile.channelApprovedAt && profile.contentApprovedAt) &&
      !context.automationPaused && !context.automationOptedOut &&
      context.lastMessageDirection === 'inbound' && inReplyWindow
    if (!profileAllowsReply) return { allowed: false, reason: context.automationOptedOut ? 'opted_out' : 'reply_not_eligible' }
    const runReserved = await store.reserveOpenClawReplySend(
      config.ownerUserId,
      config.phoneNumberId,
      input.openClawRunId?.trim(),
      validSessionKey(input.openClawSessionKey),
      context.conversationId,
      context.latestProviderMessageId ?? '',
    )
    return { allowed: runReserved, reason: runReserved ? 'approved_reply' : 'no_pending_reply' }
  }

  const prospecting = new WhatsAppProspectingStore()
  try {
    const queueReserved = await prospecting.authorizeOpenClawQueueSend(
      config.ownerUserId,
      config.phoneNumberId,
      input.recipientE164,
      input.content,
    )
    return { allowed: queueReserved, reason: queueReserved ? 'approved_queue_item' : 'no_authorized_queue_item' }
  } catch (error) {
    if (error instanceof WhatsAppProspectingError) return { allowed: false, reason: error.code }
    throw error
  }
}

export async function persistOpenClawOutbound(input: OpenClawOutboundInput) {
  const config = assertPhoneNumberId(input.phoneNumberId)
  const recipient = normalizeE164(input.recipientE164)
  const occurredAt = validTime(input.occurredAt)
  if (!recipient || !input.recipientE164.startsWith('+')) throw new OpenClawBridgeError(400, 'Destinatário WhatsApp inválido.')
  if (!validateMessageId(input.providerMessageId)) throw new OpenClawBridgeError(400, 'Identificador da mensagem inválido.')
  if (!occurredAt) throw new OpenClawBridgeError(400, 'Data da mensagem inválida.')
  if (input.content !== undefined && (typeof input.content !== 'string' || input.content.length > 10_000)) {
    throw new OpenClawBridgeError(400, 'A mensagem ultrapassa o limite permitido.')
  }

  const store = await requireOpenClawTransport(config.ownerUserId, config.phoneNumberId)
  const runId = input.openClawRunId?.trim()
  const sessionKey = validSessionKey(input.openClawSessionKey)
  const providerMessageId = `openclaw:${input.providerMessageId}`.slice(0, 256)
  const prospecting = new WhatsAppProspectingStore()
  if (input.content?.trim()) {
    const settledQueue = await prospecting.settleAuthorizedOpenClawQueueSend(
      config.ownerUserId,
      config.phoneNumberId,
      input.recipientE164,
      input.content,
      input.success,
      providerMessageId,
    )
    if (settledQueue) return { persisted: input.success, queueSettled: true, delivery: input.success ? 'sent' : 'failed' }
  }
  if (!input.success) {
    if (runId) {
      await store.settleOpenClawAutomationRun(config.ownerUserId, config.phoneNumberId, runId, { success: false })
    } else if (sessionKey) {
      await store.settleLatestOpenClawAutomationRunBySession(config.ownerUserId, config.phoneNumberId, sessionKey, { success: false })
    }
    return { persisted: false, delivery: 'failed' }
  }

  await store.persistWebhookEvents({
    messages: [{
      phoneNumberId: config.phoneNumberId,
      providerMessageId,
      contactWaId: recipient,
      occurredAt,
      direction: 'outbound',
      source: 'live',
      messageType: (input.messageType?.trim() || (input.content ? 'text' : 'unknown')).slice(0, 80),
      ...(input.content?.trim() ? { body: input.content.trim() } : {}),
    }],
    statuses: [],
    contacts: [],
  })
  const runSettled = runId
    ? await store.settleOpenClawAutomationRun(config.ownerUserId, config.phoneNumberId, runId, {
        success: true,
        providerMessageId,
        ...(input.content ? { replyBody: input.content } : {}),
      })
    : sessionKey
      ? await store.settleLatestOpenClawAutomationRunBySession(config.ownerUserId, config.phoneNumberId, sessionKey, {
          success: true,
          providerMessageId,
          ...(input.content ? { replyBody: input.content } : {}),
        })
      : false
  return { persisted: true, runSettled, queueSettled: false }
}
