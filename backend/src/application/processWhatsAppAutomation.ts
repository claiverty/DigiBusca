import { getEvolutionApiConfig, getGeminiApiKey, isWhatsAppAutomationRuntimeEnabled } from '../config/supabase.js'
import { WhatsAppStore } from '../data/whatsappStore.js'
import { generateWhatsAppAutoReply } from '../integrations/whatsappAutoReplyProvider.js'
import { selectWhatsAppAutomationReplyPlan } from './whatsappAutomationPolicy.js'
import { getEvolutionConnectionState, sendEvolutionTextMessage } from '../integrations/evolutionApi.js'
import { logWarning } from '../observability/logger.js'
import type { WhatsAppAutomationStage } from '../contracts/whatsappAutomation.js'
import type { WhatsAppWebhookMessage, WhatsAppWebhookEvents } from './whatsappWebhook.js'

const customerServiceWindowMs = 24 * 60 * 60 * 1_000
const optOutPattern = /^\s*(?:por favor[, ]+)?(?:parar(?: de me (?:procurar|contatar|ligar|chamar|mandar mensagens?))?|pare(?: de (?:me )?(?:procur\w*|contat\w*|lig\w*|cham\w*|mandar mensagens?|enviar mensagens?))?|cancelar|cancele|sair|remover|descadastrar|stop|unsubscribe|nao entre(?: mais)? em contato(?: comigo)?(?: nunca mais| de novo| novamente)?|nao quero(?: mais)? contato|nao quero(?: mais)? receber(?: mensagens?| contato| comunicacoes?)?|nao quero que (?:voces? )?(?:me )?(?:procurem?|contatem?|liguem?|chamem?)|nao quero ser contatad[oa]|nao me (?:envie|mande|contate|procure|ligue|chame)(?: mais| de novo| novamente)?|nao mandar(?: mais)?|nao envie(?: mais)?|nao mande(?: mais)?|nunca mais (?:me )?(?:procure|contate|ligue|chame|mande|envie)|me (?:remova|remove|retire|tire) da lista)(?: por favor)?(?:[.!?,\s]|$)/i
const refusalPattern = /^\s*(nao tenho interesse|nao quero|sem interesse)(?:[.!?,\s]|$)/i
const humanHandoffPattern = /\b(?:atendente|humano|pessoa real|pessoa de verdade|falar com (?:uma? )?(?:pessoa|gente|humano|atendente|alguem)|conversar com (?:uma? )?(?:pessoa|gente|humano|atendente|alguem)|(?:quero|gostaria|preciso|prefiro) falar com (?:uma? )?(?:pessoa|gente|humano|atendente|alguem)|me (?:encaminha|conecta) com (?:uma? )?(?:pessoa|gente|humano|atendente|alguem))\b/i
const cristhianHandoffPattern = /\b(?:(?:quero|gostaria|preciso|prefiro) (?:falar|conversar) com (?:o )?cristhian|(?:falar|conversar) com (?:o )?cristhian|(?:me )?(?:encaminha|conecta|passa) com (?:o )?cristhian|chama (?:o )?cristhian)\b/i
const commercialHandoffPattern = /\b(?:precos?|valores?|custos?|quanto (?:custa|fica|ficaria|sai|seria|e|voc[eê]s cobram|voc[eê]s cobrariam)|orcamentos?|descontos?|prazos?|formas? de pagamento|condicoes?(?: comerciais| de pagamento)?|pagamento (?:do|pelo) (?:projeto|servico|orcamento|contrato)|(?:voces )?aceitam (?:pix|cartao|parcelamento)|pagamento (?:mensal|recorrente)|(?:voces )?parcelam|quantas parcelas|parcelamento (?:do projeto|da proposta|do servico)|contratos?|garantias?|escopos?|propostas?|resultados?|investimentos?|quanto tempo (?:demora|leva|fica|seria)|quando (?:fica pronto|entrega|comeca)|qual (?:e )?o prazo|tem prazo)\b/i
const sensitiveHandoffPattern = /\b(?:consulta juridica pessoal|aconselhamento juridico pessoal|meu problema juridico|minha situacao juridica|cpf\s*(?:e|:)?\s*\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d{2}|rg\s*(?:e|:)?\s*\d{1,2}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d?|(?:minha )?senha\s*(?:e|:|=)\s*\S+|senha\s*[:=]\s*\S+|(?:meu )?codigo(?: de autenticacao| de seguranca| sms| 2fa)?\s*(?:e|:|=)\s*\S+|meus dados bancarios\s*(?:sao|e|:|=)\s*\S+|dados bancarios\s*[:=]\s*\S+|(?:numero|agencia) da minha conta(?: bancaria)?\s*(?:e|:|=)\s*\d+|(?:meu cartao|numero do cartao|dados do cartao)\s*(?:e|:|=)\s*(?:\d{4}(?:[ -]?\d{4}){2,3}|final \d{4})|minha saude|meu estado de saude|problema de saude pessoal|condicao de saude pessoal|meu diagnostico|meus sintomas|meu tratamento|diagnostico medico pessoal|tratamento medico pessoal|minha doenca|aconselhamento financeiro pessoal|orientacao financeira pessoal|minhas financas pessoais|minha situacao financeira pessoal|estou endividado[oa]?|minha divida pessoal|fui vitima de fraud\w*|sofri fraud\w*|denunciar fraud\w*|fraude na minha conta|cai (?:em|num) (?:um )?golpe|me aplicaram (?:um )?golpe|sofri ameaca|fui ameacad\w*|me ameacaram|estou sendo ameacad\w*|ameaca contra mim|sofri assedio|fui vitima de assedio|fui assediad\w*|estou sendo assediad\w*|sofri violencia|fui vitima de violencia|sofri discriminacao|fui discriminad\w*)\b/i
const repeatedQuestionFeedbackPattern = /\b(?:(?:nao (?:quero|vou) (?:repetir|responder(?: isso)? de novo|falar disso de novo))|(?:(?:eu\s+)?(?:ja\s+)?(?:te\s+)?(?:respondi|respondeu|respondemos|respondido|falei|falado|disse|dizia|informei|informado|passei|contei|expliquei|mencionei)(?:\s+(?:isso|essa pergunta|a mesma coisa|sobre isso|essas informacoes|disso|aquilo))?)|(?:essa pergunta|essa questao)\s+ja\s+foi\s+respondida|(?:voce|vc)\s+(?:perguntou|repetiu)\s+(?:isso|a mesma coisa)(?:\s+(?:de novo|novamente))?|(?:pergunta|questao)\s+repetida|(?:perguntou|repetiu)\s+(?:isso|a mesma coisa)\s+(?:de novo|novamente))\b/i
const identityQuestionPattern = /\b(?:quem (?:esta|ta) (?:me )?(?:respondendo|falando|atendendo)|quem (?:responde|atende)|com quem (?:eu )?(?:estou|to) falando|quem (?:e|eh) voce|voce (?:e|eh) (?:o )?(?:proprio )?cristhian|voce (?:esta|ta) falando com (?:o )?(?:proprio )?cristhian|e voce (?:o )?(?:proprio )?cristhian|estou falando com (?:o )?(?:proprio )?cristhian|cristhian (?:esta|ta) respondendo|e (?:o )?cristhian que (?:esta|ta) (?:respondendo|falando|atendendo)|voce (?:e|eh) (?:uma? )?(?:pessoa|humano|ia|inteligencia artificial|bot|robo|assistente(?: virtual)?)|(?:essa|esta) (?:e )?(?:uma? )?mensagem automatica|e (?:uma? )?mensagem automatica|isso (?:e|eh) (?:uma? )?(?:mensagem|resposta) automatica|(?:suas|essas) respostas? (?:sao )?automaticas?|(?:esse|este|seu) atendimento (?:e|eh) automatizado|(?:essa|sua) resposta (?:foi )?gerada por (?:uma? )?ia)\b/i

function normalizeMessage(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim()
}

function messageClauses(text: string) {
  return normalizeMessage(text).split(/[.!?,;\n]+|\b(?:e|mas)\b/).map((clause) => clause.trim()).filter(Boolean)
}

function hasOptOutRequest(text: string) {
  return messageClauses(text).some((clause) => optOutPattern.test(clause))
}

function hasRefusal(text: string) {
  const repeatComplaintRefusalPattern = /^nao (?:quero|vou) (?:repetir|responder(?: isso)? de novo|falar disso de novo)\b/i
  return messageClauses(text).some((clause) => refusalPattern.test(clause) && !repeatComplaintRefusalPattern.test(clause))
}

function hasStopOrRefusal(text: string) {
  return hasOptOutRequest(text) || hasRefusal(text)
}

function isInboundProjectInquiry(text: string) {
  const normalized = normalizeMessage(text)
  if (/\b(?:nao tenho interesse|nao quero|sem interesse|nao preciso)\b/.test(normalized)) return false
  return /\b(?:projeto|pagina|paginas|site|landing page|sistema|aplicativo|app|loja virtual|marketing|presenca digital|automacao)\b/.test(normalized)
    && /\b(?:vim pelo site|gostaria|queria|quero|preciso|estou procurando|busco|procuro|tenho interesse|conversar|falar)\b/.test(normalized)
}

function isColdProspectingReply(text: string) {
  const normalized = normalizeMessage(text)
  return /\b(?:pessoa que cuida|voce cuida|responsavel pela|responsavel por|divulgacao|presenca digital|posso falar com quem|falar sobre nossos servicos|sou .*\bda\b.*\bdigiup\b)\b/.test(normalized)
}

const repeatedQuestionTopics = [
  { key: 'project_goal', pattern: /\b(?:objetivo|prioridade|expectativa|meta|finalidade|foco principal|resultado esperado)\b/ },
  { key: 'project_type', pattern: /\b(?:tipo de projeto|que tipo|qual tipo|qual projeto|qual pagina|que pagina|qual site|qual sistema|qual servico|qual solucao)\b/ },
] as const

function getQuestionText(text: string) {
  if (!text.includes('?')) return undefined
  const questionStart = text.slice(0, text.indexOf('?'))
  const questionBoundary = Math.max(questionStart.lastIndexOf('.'), questionStart.lastIndexOf('!'), questionStart.lastIndexOf('\n'))
  const question = normalizeMessage(questionStart.slice(questionBoundary + 1))
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return question || undefined
}

function getRepeatedQuestionTopic(replyText: string, messages: Array<{ direction: 'inbound' | 'outbound'; body: string | null }>) {
  const normalizedQuestion = getQuestionText(replyText)
  if (!normalizedQuestion) return undefined
  return repeatedQuestionTopics.find(({ pattern }) => (
    pattern.test(normalizedQuestion)
    && messages.some(({ direction, body }) => {
      if (direction !== 'outbound' || !body) return false
      return pattern.test(getQuestionText(body) ?? '')
    })
  ))?.key
}

function isRepeatedQuestionComplaint(text: string) {
  const normalized = normalizeMessage(text)
  return repeatedQuestionFeedbackPattern.test(normalized)
    && !hasStopOrRefusal(normalized)
    && !humanHandoffPattern.test(normalized)
    && !cristhianHandoffPattern.test(normalized)
    && !commercialHandoffPattern.test(normalized)
    && !sensitiveHandoffPattern.test(normalized)
}

function isDirectIdentityQuestion(text: string) {
  return identityQuestionPattern.test(normalizeMessage(text))
}

function identityDisclosure(text: string) {
  const normalized = normalizeMessage(text)
  const asksIfHumanOrCristhian = /\b(?:voce (?:e|eh) (?:o )?(?:proprio )?cristhian|voce (?:esta|ta) falando com (?:o )?(?:proprio )?cristhian|e voce (?:o )?(?:proprio )?cristhian|estou falando com (?:o )?(?:proprio )?cristhian|cristhian (?:esta|ta) respondendo|e (?:o )?cristhian que (?:esta|ta) (?:respondendo|falando|atendendo)|voce (?:e|eh) (?:uma? )?(?:pessoa|humano))\b/.test(normalized)
  const asksIfAutomated = /\b(?:(?:essa|esta) (?:e )?(?:uma? )?mensagem automatica|e (?:uma? )?mensagem automatica|isso (?:e|eh) (?:uma? )?(?:mensagem|resposta) automatica|(?:suas|essas) respostas? (?:sao )?automaticas?|(?:esse|este|seu) atendimento (?:e|eh) automatizado|(?:essa|sua) resposta (?:foi )?gerada por (?:uma? )?ia|(?:voce|vc) (?:e|eh) (?:uma? )?(?:ia|inteligencia artificial|bot|robo|assistente(?: virtual)?))\b/.test(normalized)
  const answerPrefix = asksIfHumanOrCristhian ? 'Não. ' : asksIfAutomated ? 'Sim. ' : ''
  return `${answerPrefix}Sou uma IA que auxilia no atendimento da DigiUP.`
}

function identityReply(text: string) {
  return `${identityDisclosure(text)} O Cristhian pode continuar por aqui se você preferir.`
}

function advanceStageAfterRepeatedQuestion(stage: WhatsAppAutomationStage): WhatsAppAutomationStage {
  switch (stage) {
    case 'identify_responsible': return 'request_permission'
    case 'request_permission': return 'understand_scenario'
    case 'understand_scenario': return 'explore_need'
    case 'explore_need':
    case 'qualify_interest': return 'present_idea'
    default: return stage
  }
}

function distinctFollowUpQuestion(messages: Array<{ direction: 'inbound' | 'outbound'; body: string | null }>) {
  const transcript = normalizeMessage(messages.map(({ body }) => body ?? '').join(' '))
  if (/\b(?:pagina|landing page|site)\b/.test(transcript)) {
    return 'Entendi. Vocês já têm algum site ou referência visual para o estilo dessa página?'
  }
  return 'Entendi. Já existe algum exemplo ou material que represente o que vocês imaginam para esse projeto?'
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
    return humanHandoffPattern.test(normalized)
      || cristhianHandoffPattern.test(normalized)
      || commercialHandoffPattern.test(normalized)
      || sensitiveHandoffPattern.test(normalized)
  })
}

function handoffMessage(leadAskedIdentity: boolean, inboundText: string) {
  const disclosure = leadAskedIdentity ? `${identityDisclosure(inboundText)} ` : ''
  const message = `${disclosure}Claro, vou encaminhar isso para o Cristhian continuar por aqui.`
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
    if (!hasStopOrRefusal(normalized)) continue
    try {
      const context = await store.getAutomationRuntimeContext(message.phoneNumberId, message.contactWaId)
      if (!context) continue
      if (hasOptOutRequest(normalized)) {
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
      if (hasStopOrRefusal(normalized)) {
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
      const leadAskedIdentity = isDirectIdentityQuestion(message.body ?? '')
      const inboundProjectInquiry = isInboundProjectInquiry(message.body ?? '')
      const apiKey = getGeminiApiKey()
      const replyPlan = selectWhatsAppAutomationReplyPlan({
        responseMode: profile.responseMode,
        shouldHandoff,
        geminiConfigured: Boolean(apiKey),
      })
      const repeatedQuestionRecovery = replyPlan === 'gemini'
        && !shouldHandoff
        && isRepeatedQuestionComplaint(message.body ?? '')
      const identityDisclosureResponse = leadAskedIdentity && !shouldHandoff
      const deterministicReply = repeatedQuestionRecovery || identityDisclosureResponse
      let generated: Awaited<ReturnType<typeof generateWhatsAppAutoReply>>
      if (deterministicReply) {
        generated = {
          action: 'reply',
          replyText: [
            repeatedQuestionRecovery ? 'Você tem razão, desculpa por repetir. Vou considerar o que você já me contou e seguir daqui.' : undefined,
            identityDisclosureResponse ? identityReply(message.body ?? '') : undefined,
          ].filter(Boolean).join(' '),
          nextStage: repeatedQuestionRecovery
            ? advanceStageAfterRepeatedQuestion(context.automationStage)
            : context.automationStage,
        }
      } else if (replyPlan === 'handoff' || !apiKey) {
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

      if (generated.action === 'reply' && getRepeatedQuestionTopic(generated.replyText, context.messages)) {
        generated = {
          ...generated,
          replyText: distinctFollowUpQuestion(context.messages),
        }
      }

      if (inboundProjectInquiry && generated.action === 'reply' && isColdProspectingReply(generated.replyText)) {
        generated = {
          action: 'reply',
          replyText: 'Oi! Claro, vamos conversar. Qual é o objetivo principal do projeto?',
          nextStage: 'qualify_interest',
        }
      }

      if (generated.action === 'handoff') {
        const body = handoffMessage(leadAskedIdentity, message.body ?? '')
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
      if (repeatedQuestionRecovery) {
        await store.updateAutomationStage(context.conversationId, generated.nextStage)
      } else if (!identityDisclosureResponse) {
        await store.updateAutomationStage(context.conversationId, generated.nextStage)
        if (generated.nextStage === 'closed') {
          await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'assistant_closed')
        }
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
