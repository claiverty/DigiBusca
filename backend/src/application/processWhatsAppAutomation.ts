import { getEvolutionApiConfig, getGeminiApiKey, isWhatsAppAutomationRuntimeEnabled } from '../config/supabase.js'
import { WhatsAppStore } from '../data/whatsappStore.js'
import { autoReplyFailureDetails, generateWhatsAppAutoReply, WhatsAppAutoReplyError } from '../integrations/whatsappAutoReplyProvider.js'
import { selectWhatsAppAutomationReplyPlan } from './whatsappAutomationPolicy.js'
import { getEvolutionConnectionState, sendEvolutionTextMessage } from '../integrations/evolutionApi.js'
import { logWarning } from '../observability/logger.js'
import { asksForCristhian, asksForHumanHandoff, asksForUnapprovedCommercialTerms, requiresHumanReview } from './whatsappEscalationRules.js'
import { sanitizeWhatsAppHistoryForGemini } from './whatsappConversationPrivacy.js'
import { generationFailureReason } from './whatsappAutomationRetry.js'
import { isProjectServiceCorrection, resolveWhatsAppProjectContext } from './whatsappProjectContext.js'
import type { WhatsAppAutomationStage } from '../contracts/whatsappAutomation.js'
import type { WhatsAppWebhookMessage, WhatsAppWebhookEvents } from './whatsappWebhook.js'

const customerServiceWindowMs = 24 * 60 * 60 * 1_000
const optOutPattern = /^\s*(?:por favor[, ]+)?(?:parar(?: de me (?:procurar|contatar|ligar|chamar|mandar mensagens?))?|pare(?: de (?:me )?(?:procur\w*|contat\w*|lig\w*|cham\w*|mandar mensagens?|enviar mensagens?))?|cancelar|cancele|sair|remover|descadastrar|stop|unsubscribe|nao entre(?: mais)? em contato(?: comigo)?(?: nunca mais| de novo| novamente)?|nao quero(?: mais)? contato|nao quero(?: mais)? receber(?: mensagens?| contato| comunicacoes?)?|nao quero que (?:voces? )?(?:me )?(?:procurem?|contatem?|liguem?|chamem?)|nao quero ser contatad[oa]|nao me (?:envie|mande|contate|procure|ligue|chame)(?: mais| de novo| novamente)?|nao mandar(?: mais)?|nao envie(?: mais)?|nao mande(?: mais)?|nunca mais (?:me )?(?:procure|contate|ligue|chame|mande|envie)|me (?:remova|remove|retire|tire) da lista)(?: por favor)?(?:[.!?,\s]|$)/i
const refusalPattern = /^\s*(nao tenho interesse|nao quero|sem interesse)(?:[.!?,\s]|$)/i
const sensitiveHandoffPattern = /\b(?:consulta juridica pessoal|aconselhamento juridico pessoal|meu problema juridico|minha situacao juridica|cpf\s*(?:e|:)?\s*\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d{2}|rg\s*(?:e|:)?\s*\d{1,2}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d?|(?:minha )?senha\s*(?:e|:|=)\s*\S+|senha\s*[:=]\s*\S+|(?:meu )?codigo(?: de autenticacao| de seguranca| sms| 2fa)?\s*(?:e|:|=)\s*\S+|meus dados bancarios\s*(?:sao|e|:|=)\s*\S+|dados bancarios\s*[:=]\s*\S+|(?:numero|agencia) da minha conta(?: bancaria)?\s*(?:e|:|=)\s*\d+|(?:meu cartao|numero do cartao|dados do cartao)\s*(?:e|:|=)\s*(?:\d{4}(?:[ -]?\d{4}){2,3}|final \d{4})|minha saude|meu estado de saude|problema de saude pessoal|condicao de saude pessoal|meu diagnostico|meus sintomas|meu tratamento|diagnostico medico pessoal|tratamento medico pessoal|minha doenca|aconselhamento financeiro pessoal|orientacao financeira pessoal|minhas financas pessoais|minha situacao financeira pessoal|estou endividado[oa]?|minha divida pessoal|fui vitima de fraud\w*|sofri fraud\w*|denunciar fraud\w*|fraude na minha conta|cai (?:em|num) (?:um )?golpe|me aplicaram (?:um )?golpe|sofri ameaca|fui ameacad\w*|me ameacaram|estou sendo ameacad\w*|ameaca contra mim|sofri assedio|fui vitima de assedio|fui assediad\w*|estou sendo assediad\w*|sofri violencia|fui vitima de violencia|sofri discriminacao|fui discriminad\w*)\b/i
const repeatedQuestionFeedbackPattern = /\b(?:(?:nao (?:quero|vou) (?:repetir|responder(?: isso)? de novo|falar disso de novo))|(?:(?:eu\s+)?(?:ja\s+)?(?:te\s+)?(?:respondi|respondeu|respondemos|respondido|falei|falado|disse|dizia|informei|informado|passei|contei|expliquei|mencionei)(?:\s+(?:isso|essa pergunta|a mesma coisa|sobre isso|essas informacoes|disso|aquilo))?)|(?:essa pergunta|essa questao)\s+ja\s+foi\s+respondida|(?:voce|vc)\s+(?:perguntou|repetiu)\s+(?:isso|a mesma coisa)(?:\s+(?:de novo|novamente))?|(?:pergunta|questao)\s+repetida|(?:perguntou|repetiu)\s+(?:isso|a mesma coisa)\s+(?:de novo|novamente))\b/i
const automationStageOrder: WhatsAppAutomationStage[] = [
  'identify_responsible', 'request_permission', 'understand_scenario', 'explore_need',
  'present_idea', 'qualify_interest', 'present_conditions', 'confirm_decision', 'closed',
]
const explicitOptOutPattern = /\b(?:nao entre(?: mais)? em contato(?: comigo)?(?: nunca mais| de novo| novamente)?|nao quero(?: mais)? contato|nao quero(?: mais)? receber (?:mensagens?|contato|comunicacoes?)|nao quero que (?:voces? )?(?:me )?(?:procurem?|contatem?|liguem?|chamem?)|nao quero ser contatad[oa]|nao me (?:envie|mande|contate|procure|ligue|chame)(?: mais| de novo| novamente)?|nunca mais (?:me )?(?:procure|contate|ligue|chame|mande|envie))\b/i
const identityQuestionPattern = /\b(?:quem (?:esta|ta) (?:me )?(?:respondendo|falando|atendendo)|quem (?:responde|atende)|com quem (?:eu )?(?:estou|to) falando|quem (?:e|eh) voce|voce (?:e|eh) (?:o )?(?:proprio )?cristhian|voce (?:esta|ta) falando com (?:o )?(?:proprio )?cristhian|e voce (?:o )?(?:proprio )?cristhian|estou falando com (?:o )?(?:proprio )?cristhian|cristhian (?:esta|ta) respondendo|e (?:o )?cristhian que (?:esta|ta) (?:respondendo|falando|atendendo)|voce (?:e|eh) (?:uma? )?(?:pessoa|humano|ia|inteligencia artificial|bot|robo|assistente(?: virtual)?)|(?:essa|esta) (?:e )?(?:uma? )?mensagem automatica|e (?:uma? )?mensagem automatica|isso (?:e|eh) (?:uma? )?(?:mensagem|resposta) automatica|(?:suas|essas) respostas? (?:sao )?automaticas?|(?:esse|este|seu) atendimento (?:e|eh) automatizado|(?:essa|sua) resposta (?:foi )?gerada por (?:uma? )?ia)\b/i

function normalizeMessage(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim()
}

function messageClauses(text: string) {
  return normalizeMessage(text).split(/[.!?,;\n]+|\b(?:e|mas)\b/).map((clause) => clause.trim()).filter(Boolean)
}

function hasOptOutRequest(text: string) {
  const normalized = normalizeMessage(text)
  return explicitOptOutPattern.test(normalized) || messageClauses(normalized).some((clause) => optOutPattern.test(clause))
}

function hasRefusal(text: string) {
  if (isProjectServiceCorrection(text)) return false
  const repeatComplaintRefusalPattern = /\bnao (?:quero|vou) (?:repetir|responder(?: isso)? de novo|falar disso de novo)\b/i
  const refusalMentionPattern = /\b(?:nao tenho interesse|nao quero|sem interesse)\b/i
  return messageClauses(text).some((clause) => refusalMentionPattern.test(clause) && !repeatComplaintRefusalPattern.test(clause))
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
    && !asksForHumanHandoff(normalized)
    && !asksForUnapprovedCommercialTerms(normalized)
    && !sensitiveHandoffPattern.test(normalized)
}

function isDirectIdentityQuestion(text: string) {
  const normalized = normalizeMessage(text)
  return identityQuestionPattern.test(normalized) || asksForCristhian(normalized)
}

function identityDisclosure(text: string) {
  const normalized = normalizeMessage(text)
  const asksIfCristhian = /\b(?:voce (?:e|eh) (?:o )?(?:proprio )?cristhian|voce (?:esta|ta) falando com (?:o )?(?:proprio )?cristhian|e voce (?:o )?(?:proprio )?cristhian|estou falando com (?:o )?(?:proprio )?cristhian|cristhian (?:esta|ta) respondendo|e (?:o )?cristhian que (?:esta|ta) (?:respondendo|falando|atendendo))\b/.test(normalized)
  const asksIfAutomated = /\b(?:(?:essa|esta) (?:e )?(?:uma? )?mensagem automatica|e (?:uma? )?mensagem automatica|isso (?:e|eh) (?:uma? )?(?:mensagem|resposta) automatica|(?:suas|essas) respostas? (?:sao )?automaticas?|(?:esse|este|seu) atendimento (?:e|eh) automatizado|(?:essa|sua) resposta (?:foi )?gerada por (?:uma? )?ia|(?:voce|vc) (?:e|eh) (?:uma? )?(?:ia|inteligencia artificial|bot|robo|assistente(?: virtual)?|pessoa|humano))\b/.test(normalized)
  if (asksForCristhian(normalized)) {
    return 'Sou o Cristhian, agente virtual da DigiUP.'
  }
  if (asksIfCristhian || asksIfAutomated) return 'Sou o Cristhian, agente virtual da DigiUP.'
  return 'Sou o Cristhian, agente virtual da DigiUP.'
}

function identityReply(text: string) {
  return identityDisclosure(text)
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

function keepStageFromMovingBackward(current: WhatsAppAutomationStage, next: WhatsAppAutomationStage): WhatsAppAutomationStage {
  return automationStageOrder.indexOf(next) < automationStageOrder.indexOf(current) ? current : next
}

function distinctFollowUpQuestion(messages: Array<{ direction: 'inbound' | 'outbound'; body: string | null }>) {
  const project = resolveWhatsAppProjectContext(messages)
  if (project.currentService === 'landing page' || project.currentService === 'site') {
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
    return requiresHumanReview(normalized)
      || sensitiveHandoffPattern.test(normalized)
  })
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
      if (skippedRunId) await store.completeAutomationRun(skippedRunId.id, 'skipped', 'superseded_by_newer_inbound')
    } catch {
      logWarning('whatsapp_automation_superseded_message_failed', { reason: 'superseded_message_state_unavailable' })
    }
  }

  for (const message of messages) {
    let runId: string | undefined
    let sendingStarted = false
    let acceptedReplyId: string | undefined
    try {
      let context = await store.getAutomationRuntimeContext(message.phoneNumberId, message.contactWaId)
      if (!context) continue

      if (context.latestProviderMessageId !== message.providerMessageId || context.lastMessageDirection !== 'inbound') {
        const skippedRun = await store.claimAutomationRun(context.userId, message.phoneNumberId, context.conversationId, message.providerMessageId)
        if (skippedRun) await store.completeAutomationRun(skippedRun.id, 'skipped', 'superseded_before_processing')
        continue
      }

      const recoverablePause = context.automationPaused && !context.automationOptedOut
        && (context.automationPauseReason === 'assistant_closed' || context.automationPauseReason === 'provider_unavailable')
        ? context.automationPauseReason : undefined

      const normalized = normalizeMessage(message.body ?? '')
      if (hasStopOrRefusal(normalized)) {
        continue
      }

      if (!isWhatsAppAutomationRuntimeEnabled()) continue
      const evolutionConfig = getEvolutionApiConfig()
      if (!evolutionConfig) continue

      const profile = context.profile
      if (
        (context.automationPaused && !recoverablePause) || context.automationOptedOut || context.latestProviderMessageId !== message.providerMessageId ||
        context.lastMessageDirection !== 'inbound' || !context.lastMessageAt ||
        !profile?.automationEnabled || !profile.channelApprovedAt || !profile.contentApprovedAt ||
        !profile.businessName || !profile.senderIdentity || !profile.serviceSummary || !profile.escalationContact
      ) continue

      const ageMs = Date.now() - Date.parse(message.occurredAt)
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= customerServiceWindowMs) continue
      const connectionState = await getEvolutionConnectionState(message.phoneNumberId)
      if (connectionState.state.toLowerCase() !== 'open') continue

      const run = await store.claimAutomationRun(context.userId, message.phoneNumberId, context.conversationId, message.providerMessageId)
      if (!run) continue
      runId = run.id

      if (recoverablePause) {
        const resumed = await store.resumeRecoverableConversationAutomation(context.userId, context.conversationId, recoverablePause)
        if (!resumed) {
          await store.completeAutomationRun(runId, 'skipped', 'state_changed_before_resume')
          continue
        }
        const resumedStage: WhatsAppAutomationStage = context.automationStage === 'closed' ? 'qualify_interest' : context.automationStage
        if (resumedStage !== context.automationStage) await store.updateAutomationStage(context.conversationId, resumedStage)
        context = { ...context, automationPaused: false, automationPauseReason: null, automationStage: resumedStage }
      }

      const handoffMessages = [
        ...context.messages,
        ...inboundMessages
          .filter((candidate) => candidate.phoneNumberId === message.phoneNumberId && candidate.contactWaId === message.contactWaId)
          .map(({ direction, body, occurredAt }) => ({ direction, body: body ?? null, occurredAt })),
      ]
      const shouldHandoff = requiresHumanHandoff(handoffMessages)
      const leadAskedIdentity = isDirectIdentityQuestion(message.body ?? '')
      const inboundProjectInquiry = isInboundProjectInquiry(message.body ?? '')
      const projectContext = resolveWhatsAppProjectContext(context.messages)
      const requestStage = projectContext.startsNewRequest || projectContext.clarificationReply
        || (inboundProjectInquiry && context.automationStage === 'identify_responsible')
        ? 'understand_scenario' : context.automationStage
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
      } else if (shouldHandoff || profile.responseMode === 'handoff_only') {
        generated = { action: 'handoff', replyText: '', nextStage: context.automationStage }
      } else {
        try {
          if (!apiKey) throw new WhatsAppAutoReplyError('gemini_not_configured', 401)
          generated = await generateWhatsAppAutoReply(apiKey, {
            businessName: profile.businessName,
            senderIdentity: profile.senderIdentity,
            serviceSummary: profile.serviceSummary,
            approvedFacts: profile.approvedFacts,
            escalationContact: profile.escalationContact,
            stage: requestStage,
            inboundProjectInquiry,
            messages: sanitizeWhatsAppHistoryForGemini(context.messages),
          })
        } catch (error) {
          const failureReason = generationFailureReason(run.attempt)
          await store.completeAutomationRun(runId, 'failed', failureReason)
          if (run.attempt >= 3 && context.lastMessageAt) {
            await store.pauseConversationForGenerationFailure(context.userId, context.conversationId, context.lastMessageAt)
          }
          logWarning('whatsapp_automation_generation_failed', { attempt: run.attempt, ...autoReplyFailureDetails(error) })
          continue
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

      const assistantRequestedClosure = generated.action === 'stop'
      if (assistantRequestedClosure) {
        generated = {
          action: 'reply',
          replyText: 'Perfeito! Se surgir mais alguma dúvida, pode me chamar por aqui.',
          nextStage: 'closed',
        }
      }

      if (generated.action === 'reply') {
        generated = { ...generated, nextStage: keepStageFromMovingBackward(requestStage, generated.nextStage) }
      }

      if (generated.action === 'reply' && getRepeatedQuestionTopic(generated.replyText, projectContext.messages)) {
        generated = {
          ...generated,
          replyText: distinctFollowUpQuestion(projectContext.messages),
        }
      }

      const inboundSignalsClosure = /^(?:(?:obrigado|obrigada|valeu)(?:[,. ]+(?:era isso|por enquanto))?|era isso|so isso|por enquanto e isso|nao precisa mais)[.! ]*$/.test(normalized)
      if (generated.action === 'reply' && inboundSignalsClosure && !assistantRequestedClosure) {
        generated = {
          action: 'reply',
          replyText: 'Perfeito! Se precisar de algo, fico à disposição por aqui.',
          nextStage: 'closed',
        }
      }
      if (generated.action === 'reply' && generated.nextStage === 'closed' && !assistantRequestedClosure && !inboundSignalsClosure && context.automationStage !== 'closed') {
        generated = { ...generated, nextStage: context.automationStage }
      }

      if (inboundProjectInquiry && generated.action === 'reply' && isColdProspectingReply(generated.replyText)) {
        generated = {
          action: 'reply',
          replyText: 'Oi! Claro, vamos conversar. Qual é o objetivo principal do projeto?',
          nextStage: 'understand_scenario',
        }
      }

      if (generated.action === 'handoff') {
        await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'handoff')
        await store.completeAutomationRun(runId, 'needs_human', shouldHandoff ? 'explicit_human_or_commercial_request' : 'human_review_required')
        continue
      }

      const body = generated.replyText.trim()
      await store.markAutomationRunSending(runId)
      sendingStarted = true
      const replyId = await sendEvolutionTextMessage(message.phoneNumberId, message.contactWaId, body)
      acceptedReplyId = replyId
      await store.recordAutomationReplyAccepted(runId, replyId)
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
      if (runId) {
        const reason = acceptedReplyId ? 'history_sync_failed_after_send' : sendingStarted ? 'delivery_unconfirmed' : 'processing_error'
        await store.completeAutomationRun(runId, 'failed', reason, acceptedReplyId).catch(() => undefined)
      }
      logWarning('whatsapp_automation_message_skipped', {
        reason: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }
}
