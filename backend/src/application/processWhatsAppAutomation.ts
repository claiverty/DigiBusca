import { getGeminiApiKey, getWhatsAppEmbeddedSignupServerConfig, isWhatsAppAutomationRuntimeEnabled } from '../config/supabase.js'
import { WhatsAppStore } from '../data/whatsappStore.js'
import { decryptWhatsAppAccessToken } from '../integrations/whatsappTokenVault.js'
import { generateWhatsAppAutoReply } from '../integrations/whatsappAutoReplyProvider.js'
import { sendWhatsAppTextMessage } from '../integrations/whatsappCloudApi.js'
import { logWarning } from '../observability/logger.js'
import type { WhatsAppWebhookMessage, WhatsAppWebhookEvents } from './whatsappWebhook.js'

const customerServiceWindowMs = 24 * 60 * 60 * 1_000
const optOutPattern = /^\s*(parar|pare|cancelar|cancele|sair|remover|stop|unsubscribe|não enviar|nao enviar|não quero receber|nao quero receber|não me contate|nao me contate)(?:[.!\s]|$)/i
const refusalPattern = /^\s*(não tenho interesse|nao tenho interesse|não quero|nao quero|sem interesse)(?:[.!\s]|$)/i

function escalationLine(contact: string) {
  return `Atendimento humano: ${contact}.`
}

function addEscalationLine(reply: string, contact: string) {
  const message = `${reply.trim()}\n\n${escalationLine(contact)}`
  return message.length <= 500 ? message : undefined
}

function handoffMessage(contact: string) {
  const message = `Para atendimento humano, use: ${contact}. Vou pausar minhas respostas automáticas nesta conversa.`
  return message.length <= 500 ? message : undefined
}

function newestInboundMessages(messages: WhatsAppWebhookMessage[]) {
  const newest = new Map<string, WhatsAppWebhookMessage>()
  for (const message of messages) {
    if (message.source !== 'live' || message.direction !== 'inbound' || message.messageType !== 'text' || !message.body?.trim()) continue
    const key = `${message.phoneNumberId}:${message.contactWaId}`
    const current = newest.get(key)
    if (!current || Date.parse(message.occurredAt) >= Date.parse(current.occurredAt)) newest.set(key, message)
  }
  return [...newest.values()]
}

export async function processWhatsAppAutomation(events: WhatsAppWebhookEvents) {
  const messages = newestInboundMessages(events.messages)
  if (messages.length === 0) return
  const store = new WhatsAppStore()
  if (!(await store.isAutomationStorageReady())) return
  for (const message of messages) {
    let runId: string | undefined
    try {
      const context = await store.getAutomationRuntimeContext(message.phoneNumberId, message.contactWaId)
      if (!context) continue

      if (optOutPattern.test(message.body ?? '')) {
        await store.markConversationOptedOut(context.userId, context.conversationId)
        continue
      }
      if (refusalPattern.test(message.body ?? '')) {
        await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'refusal')
        continue
      }

      if (!isWhatsAppAutomationRuntimeEnabled()) continue
      const apiKey = getGeminiApiKey()
      const serverConfig = getWhatsAppEmbeddedSignupServerConfig()
      if (!apiKey || !serverConfig) continue

      const profile = context.profile
      if (
        context.automationPaused || context.automationOptedOut || context.latestProviderMessageId !== message.providerMessageId ||
        context.lastMessageDirection !== 'inbound' || !context.lastMessageAt ||
        !profile?.automationEnabled || !profile.channelApprovedAt || !profile.contentApprovedAt ||
        !profile.businessName || !profile.senderIdentity || !profile.serviceSummary || !profile.escalationContact
      ) continue

      const ageMs = Date.now() - Date.parse(message.occurredAt)
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= customerServiceWindowMs) continue
      if (!context.accessTokenCiphertext || !context.accessTokenIv) continue
      if (context.accessTokenExpiresAt && Date.parse(context.accessTokenExpiresAt) <= Date.now() + 60_000) continue

      runId = await store.claimAutomationRun(context.userId, message.phoneNumberId, context.conversationId, message.providerMessageId)
      if (!runId) continue

      const accessToken = await decryptWhatsAppAccessToken(
        context.accessTokenCiphertext,
        context.accessTokenIv,
        serverConfig.encryptionKey,
      )
      const generated = await generateWhatsAppAutoReply(apiKey, {
        businessName: profile.businessName,
        senderIdentity: profile.senderIdentity,
        serviceSummary: profile.serviceSummary,
        approvedFacts: profile.approvedFacts,
        escalationContact: profile.escalationContact,
        stage: context.automationStage,
        messages: context.messages.map(({ direction, body }) => ({ direction, body })),
      })

      const currentContext = await store.getAutomationRuntimeContext(message.phoneNumberId, message.contactWaId)
      const currentAgeMs = Date.now() - Date.parse(message.occurredAt)
      if (
        !isWhatsAppAutomationRuntimeEnabled() || !currentContext || currentContext.automationPaused || currentContext.automationOptedOut ||
        currentContext.latestProviderMessageId !== message.providerMessageId || currentContext.lastMessageDirection !== 'inbound' ||
        currentContext.profile?.automationEnabled !== true || !currentContext.profile.channelApprovedAt ||
        !currentContext.profile.contentApprovedAt || currentContext.profile.updatedAt !== profile.updatedAt ||
        !Number.isFinite(currentAgeMs) || currentAgeMs < 0 || currentAgeMs >= customerServiceWindowMs
      ) {
        await store.completeAutomationRun(runId, 'skipped', 'state_changed_before_send')
        continue
      }

      if (generated.action === 'stop') {
        await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'assistant_closed')
        await store.completeAutomationRun(runId, 'skipped', 'assistant_closed')
        continue
      }

      if (generated.action === 'handoff') {
        const body = handoffMessage(profile.escalationContact)
        if (!body) {
          await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'handoff')
          await store.completeAutomationRun(runId, 'needs_human', 'handoff_contact_too_long')
          continue
        }
        await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'handoff')
        const replyId = await sendWhatsAppTextMessage({
          accessToken,
          phoneNumberId: message.phoneNumberId,
          graphApiVersion: serverConfig.graphApiVersion,
        }, message.contactWaId, body)
        const sentAt = new Date().toISOString()
        await store.persistAutomatedReply({
          userId: context.userId, phoneNumberId: message.phoneNumberId, conversationId: context.conversationId,
          contactWaId: message.contactWaId, providerMessageId: replyId, body, occurredAt: sentAt,
        })
        await store.completeAutomationRun(runId, 'needs_human', 'handoff', replyId)
        continue
      }

      const body = addEscalationLine(generated.replyText, profile.escalationContact)
      if (!body) {
        await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'handoff')
        await store.completeAutomationRun(runId, 'needs_human', 'reply_validation_failed')
        continue
      }
      const replyId = await sendWhatsAppTextMessage({
        accessToken,
        phoneNumberId: message.phoneNumberId,
        graphApiVersion: serverConfig.graphApiVersion,
      }, message.contactWaId, body)
      const sentAt = new Date().toISOString()
      await store.persistAutomatedReply({
        userId: context.userId, phoneNumberId: message.phoneNumberId, conversationId: context.conversationId,
        contactWaId: message.contactWaId, providerMessageId: replyId, body, occurredAt: sentAt,
      })
      await store.updateAutomationStage(context.conversationId, generated.nextStage)
      if (generated.nextStage === 'closed') {
        await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'assistant_closed')
      }
      await store.completeAutomationRun(runId, 'sent', undefined, replyId)
    } catch (error) {
      if (runId) {
        await store.completeAutomationRun(runId, 'failed', 'processing_error').catch(() => undefined)
      }
      logWarning('whatsapp_automation_message_skipped', {
        reason: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }
}
