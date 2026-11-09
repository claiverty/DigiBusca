import { getEvolutionApiConfig, getGeminiApiKey, isWhatsAppAutomationRuntimeEnabled } from '../config/supabase.js'
import { WhatsAppStore } from '../data/whatsappStore.js'
import { generateWhatsAppAutoReply } from '../integrations/whatsappAutoReplyProvider.js'
import { selectWhatsAppAutomationReplyPlan } from './whatsappAutomationPolicy.js'
import { getEvolutionConnectionState, sendEvolutionTextMessage } from '../integrations/evolutionApi.js'
import { logWarning } from '../observability/logger.js'
import type { WhatsAppWebhookMessage, WhatsAppWebhookEvents } from './whatsappWebhook.js'

const customerServiceWindowMs = 24 * 60 * 60 * 1_000
const optOutPattern = /^\s*(?:por favor[, ]+)?(parar|pare|cancelar|cancele|sair|remover|descadastrar|stop|unsubscribe|nao enviar(?: mais)?|nao envie(?: mais)?|nao mandar(?: mais)?|nao mande(?: mais)?|nao quero(?: mais)? receber|nao me (?:envie|mande|contate)(?: mais)?)(?:[.!?,\s]|$)/i
const refusalPattern = /^\s*(nao tenho interesse|nao quero|sem interesse)(?:[.!?,\s]|$)/i
const humanHandoffPattern = /\b(?:atendente|humano|pessoa real|pessoa de verdade|falar com (?:uma? )?(?:pessoa|gente|humano|atendente|alguem)|conversar com (?:uma? )?(?:pessoa|gente|humano|atendente|alguem)|(?:quero|gostaria|preciso|prefiro) falar com (?:uma? )?(?:pessoa|gente|humano|atendente|alguem)|me (?:encaminha|conecta) com (?:uma? )?(?:pessoa|gente|humano|atendente|alguem))\b/i
const commercialHandoffPattern = /\b(?:precos?|valores?|custos?|quanto (?:custa|fica|ficaria|sai|seria|e|voc[eê]s cobram|voc[eê]s cobrariam)|orcamentos?|descontos?|prazos?|pagamentos?|parcel\w*|condicoes?(?: comerciais| de pagamento)?|contratos?|garantias?|escopos?|propostas?|resultados?|investimentos?|quanto tempo (?:demora|leva|fica|seria)|quando (?:fica pronto|entrega|comeca)|qual (?:e )?o prazo|tem prazo)\b/i

function normalizeMessage(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim()
}

function isInboundProjectInquiry(text: string) {
  const normalized = normalizeMessage(text)
  if (/\b(?:nao tenho interesse|nao quero|sem interesse|nao preciso)\b/.test(normalized)) return false
  return /\b(?:projeto|site|landing page|sistema|aplicativo|app|loja virtual|marketing|presenca digital|automacao)\b/.test(normalized)
    && /\b(?:vim pelo site|gostaria|queria|quero|preciso|estou procurando|busco|procuro|tenho interesse|conversar|falar)\b/.test(normalized)
}

function isColdProspectingReply(text: string) {
  const normalized = normalizeMessage(text)
  return /\b(?:pessoa que cuida|voce cuida|responsavel pela|responsavel por|divulgacao|presenca digital|posso falar com quem|falar sobre nossos servicos|sou .*\bda\b.*\bdigiup\b)\b/.test(normalized)
}

function requiresHumanHandoff(messages: Array<{ direction: 'inbound' | 'outbound'; body: string | null; occurredAt?: string }>) {
  const chronologicalMessages = [...messages].sort((left, right) => (
    Date.parse(left.occurredAt ?? '') - Date.parse(right.occurredAt ?? '')
  ))
  let lastOutboundIndex = -1
  for (let index = chronologicalMessages.length - 1; index >= 0; index -= 1) {
    if (chronologicalMessages[index]?.direction === 'outbound') {
      lastOutboundIndex = index
      break
    }
  }

  return chronologicalMessages.slice(lastOutboundIndex + 1).some(({ direction, body }) => {
    if (direction !== 'inbound' || !body?.trim()) return false
    const normalized = normalizeMessage(body)
    return humanHandoffPattern.test(normalized) || commercialHandoffPattern.test(normalized)
  })
}

function handoffMessage(contact: string) {
  const message = `Vou pausar as respostas automáticas. Para atendimento humano, a rota disponível é ${contact}.`
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
  const inboundMessages = events.messages.filter((message) => (
    message.source === 'live' && message.direction === 'inbound' && message.messageType === 'text' && Boolean(message.body?.trim())
  ))
  const messages = newestInboundMessages(inboundMessages)
  if (messages.length === 0) return
  const store = new WhatsAppStore()
  if (!(await store.isAutomationStorageReady())) return

  const newestByConversation = new Map(messages.map((message) => [
    `${message.phoneNumberId}:${message.contactWaId}`,
    message.providerMessageId,
  ]))

  for (const message of inboundMessages) {
    const normalized = normalizeMessage(message.body ?? '')
    if (!optOutPattern.test(normalized) && !refusalPattern.test(normalized)) continue
    try {
      const context = await store.getAutomationRuntimeContext(message.phoneNumberId, message.contactWaId)
      if (!context) continue
      if (optOutPattern.test(normalized)) {
        await store.markConversationOptedOut(context.userId, context.conversationId)
      } else {
        await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'refusal')
      }
    } catch {
      logWarning('whatsapp_automation_stop_request_failed', { reason: 'stop_request_state_unavailable' })
    }
  }

  for (const message of inboundMessages) {
    const key = `${message.phoneNumberId}:${message.contactWaId}`
    if (newestByConversation.get(key) === message.providerMessageId) continue
    try {
      const context = await store.getAutomationRuntimeContext(message.phoneNumberId, message.contactWaId)
      if (!context) continue
      const skippedRunId = await store.claimAutomationRun(context.userId, message.phoneNumberId, context.conversationId, message.providerMessageId)
      if (skippedRunId) await store.completeAutomationRun(skippedRunId, 'skipped', 'superseded_by_newer_inbound')
    } catch {
      logWarning('whatsapp_automation_superseded_message_failed', { reason: 'superseded_message_state_unavailable' })
    }
  }

  for (const message of messages) {
    let runId: string | undefined
    let handoffSendAttempted = false
    let handoffReplyId: string | undefined
    try {
      const context = await store.getAutomationRuntimeContext(message.phoneNumberId, message.contactWaId)
      if (!context) continue

      const normalized = normalizeMessage(message.body ?? '')
      if (optOutPattern.test(normalized) || refusalPattern.test(normalized)) {
        continue
      }

      if (context.latestProviderMessageId !== message.providerMessageId || context.lastMessageDirection !== 'inbound') {
        const skippedRunId = await store.claimAutomationRun(context.userId, message.phoneNumberId, context.conversationId, message.providerMessageId)
        if (skippedRunId) await store.completeAutomationRun(skippedRunId, 'skipped', 'superseded_before_processing')
        continue
      }

      if (!isWhatsAppAutomationRuntimeEnabled()) continue
      const evolutionConfig = getEvolutionApiConfig()
      if (!evolutionConfig) continue

      const profile = context.profile
      if (
        context.automationPaused || context.automationOptedOut || context.latestProviderMessageId !== message.providerMessageId ||
        context.lastMessageDirection !== 'inbound' || !context.lastMessageAt ||
        !profile?.automationEnabled || !profile.channelApprovedAt || !profile.contentApprovedAt ||
        !profile.businessName || !profile.senderIdentity || !profile.serviceSummary || !profile.escalationContact
      ) continue

      const ageMs = Date.now() - Date.parse(message.occurredAt)
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= customerServiceWindowMs) continue
      const connectionState = await getEvolutionConnectionState(message.phoneNumberId)
      if (connectionState.state.toLowerCase() !== 'open') continue

      runId = await store.claimAutomationRun(context.userId, message.phoneNumberId, context.conversationId, message.providerMessageId)
      if (!runId) continue

      const handoffMessages = [
        ...context.messages,
        ...inboundMessages
          .filter((candidate) => candidate.phoneNumberId === message.phoneNumberId && candidate.contactWaId === message.contactWaId)
          .map(({ direction, body, occurredAt }) => ({ direction, body: body ?? null, occurredAt })),
      ]
      const shouldHandoff = requiresHumanHandoff(handoffMessages)
      const inboundProjectInquiry = isInboundProjectInquiry(message.body ?? '')
      const apiKey = getGeminiApiKey()
      const replyPlan = selectWhatsAppAutomationReplyPlan({
        responseMode: profile.responseMode,
        shouldHandoff,
        geminiConfigured: Boolean(apiKey),
      })
      let generated: Awaited<ReturnType<typeof generateWhatsAppAutoReply>>
      if (replyPlan === 'handoff' || !apiKey) {
        generated = { action: 'handoff', replyText: '', nextStage: context.automationStage }
      } else {
        try {
          generated = await generateWhatsAppAutoReply(apiKey, {
            businessName: profile.businessName,
            senderIdentity: profile.senderIdentity,
            serviceSummary: profile.serviceSummary,
            approvedFacts: profile.approvedFacts,
            escalationContact: profile.escalationContact,
            stage: inboundProjectInquiry ? 'qualify_interest' : context.automationStage,
            inboundProjectInquiry,
            messages: context.messages.map(({ direction, body }) => ({ direction, body })),
          })
        } catch {
          generated = { action: 'handoff', replyText: '', nextStage: context.automationStage }
          logWarning('whatsapp_automation_gemini_fallback', { reason: 'gemini_unavailable' })
        }
      }

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

      if (inboundProjectInquiry && generated.action === 'reply' && isColdProspectingReply(generated.replyText)) {
        generated = {
          action: 'reply',
          replyText: 'Oi! Claro, vamos conversar. Qual é o objetivo principal do projeto?',
          nextStage: 'qualify_interest',
        }
      }

      if (generated.action === 'handoff') {
        const body = handoffMessage(profile.escalationContact)
        if (!body) {
          await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'handoff')
          await store.completeAutomationRun(runId, 'needs_human', 'handoff_contact_too_long')
          continue
        }
        await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'handoff')
        handoffSendAttempted = true
        const replyId = await sendEvolutionTextMessage(message.phoneNumberId, message.contactWaId, body)
        handoffReplyId = replyId
        const sentAt = new Date().toISOString()
        await store.persistAutomatedReply({
          userId: context.userId, phoneNumberId: message.phoneNumberId, conversationId: context.conversationId,
          contactWaId: message.contactWaId, providerMessageId: replyId, body, occurredAt: sentAt,
        })
        await store.completeAutomationRun(runId, 'needs_human', 'handoff', replyId)
        continue
      }

      const body = generated.replyText.trim()
      const replyId = await sendEvolutionTextMessage(message.phoneNumberId, message.contactWaId, body)
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
      if (handoffSendAttempted && !handoffReplyId) {
        try {
          const context = await store.getAutomationRuntimeContext(message.phoneNumberId, message.contactWaId)
          if (context) await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'handoff_send_failed')
        } catch {
          logWarning('whatsapp_automation_handoff_failure_state_failed', { reason: 'conversation_state_unavailable' })
        }
      }
      if (runId) {
        await store.completeAutomationRun(runId, 'failed', 'processing_error').catch(() => undefined)
      }
      logWarning('whatsapp_automation_message_skipped', {
        reason: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }
}
