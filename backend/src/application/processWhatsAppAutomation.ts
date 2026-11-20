import { randomUUID } from 'node:crypto'
import { getEvolutionApiConfig, getGeminiApiKey, getWhatsAppOpenBotBridgeConfig, isWhatsAppAutomationRuntimeEnabled, isWhatsAppDigiBuscaAgentRuntimeEnabled, isWhatsAppOpenBotReplyRuntimeEnabled } from '../config/supabase.js'
import { WhatsAppStore, type WhatsAppAutomationRunRecord } from '../data/whatsappStore.js'
import { autoReplyFailureDetails, buildWhatsAppAutoReplyPrompt, generateWhatsAppAutoReply, isTransparentWhatsAppIdentityAnswer, parseWhatsAppAutoReplyAnswer, simpleWhatsAppGreetingReply, WhatsAppAutoReplyError, type WhatsAppAutoReplyContext } from '../integrations/whatsappAutoReplyProvider.js'
import { clearOpenBotWhatsAppContext, getOpenBotWhatsAppDelivery, OpenBotWhatsAppBridgeError, sendOpenBotWhatsAppMessage } from '../integrations/openBotWhatsAppBridge.js'
import { normalizeWhatsAppReplyText } from '../domain/whatsappTextStyle.js'
import { selectWhatsAppAutomationReplyPlan } from './whatsappAutomationPolicy.js'
import { getEvolutionConnectionState, sendEvolutionTextMessage } from '../integrations/evolutionApi.js'
import { logWarning } from '../observability/logger.js'
import { asksForCristhian, asksForHumanHandoff, asksForUnapprovedCommercialTerms, requiresHumanReview } from './whatsappEscalationRules.js'
import { sanitizeWhatsAppHistoryForGemini } from './whatsappConversationPrivacy.js'
import { generationFailureReason } from './whatsappAutomationRetry.js'
import { isProjectServiceCorrection, resolveWhatsAppProjectContext } from './whatsappProjectContext.js'
import { getWhatsAppSchedulingReply } from './whatsappScheduling.js'
import { generateWhatsAppDigiBuscaAgentReply } from '../integrations/whatsappDigiBuscaAgent.js'
import { getWhatsAppAgentProviderConfigForUser } from '../integrations/whatsappAgentProviderConfig.js'
import type { WhatsAppAutomationProfile, WhatsAppAutomationStage } from '../contracts/whatsappAutomation.js'
import type { WhatsAppWebhookMessage, WhatsAppWebhookEvents } from './whatsappWebhook.js'

const customerServiceWindowMs = 24 * 60 * 60 * 1_000
const optOutPattern = /^\s*(?:por favor[, ]+)?(?:parar(?: de me (?:procurar|contatar|ligar|chamar|mandar mensagens?))?|pare(?: de (?:me )?(?:procur\w*|contat\w*|lig\w*|cham\w*|mandar mensagens?|enviar mensagens?))?|cancelar|cancele|sair|remover|descadastrar|stop|unsubscribe|nao entre(?: mais)? em contato(?: comigo)?(?: nunca mais| de novo| novamente)?|nao quero(?: mais)? contato|nao quero(?: mais)? receber(?: mensagens?| contato| comunicacoes?)?|nao quero que (?:voces? )?(?:me )?(?:procurem?|contatem?|liguem?|chamem?)|nao quero ser contatad[oa]|nao me (?:envie|mande|contate|procure|ligue|chame)(?: mais| de novo| novamente)?|nao mandar(?: mais)?|nao envie(?: mais)?|nao mande(?: mais)?|nunca mais (?:me )?(?:procure|contate|ligue|chame|mande|envie)|me (?:remova|remove|retire|tire) da lista)(?: por favor)?(?:[.!?,\s]|$)/i
const refusalPattern = /^\s*(nao tenho interesse|nao quero|sem interesse)(?:[.!?,\s]|$)/i
const formalComplaintPattern = /\b(?:reclamacao formal|registrar (?:uma )?reclamacao formal|abrir (?:uma )?reclamacao formal|fazer (?:uma )?reclamacao formal|reclamar formalmente)\b/i
const sensitiveHandoffPattern = /\b(?:consulta juridica pessoal|aconselhamento juridico pessoal|meu problema juridico|minha situacao juridica|cpf\s*(?:e|:)?\s*\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d{2}|rg\s*(?:e|:)?\s*\d{1,2}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d?|(?:minha )?senha\s*(?:e|:|=)\s*\S+|senha\s*[:=]\s*\S+|(?:meu )?codigo(?: de autenticacao| de seguranca| sms| 2fa)?\s*(?:e|:|=)\s*\S+|meus dados bancarios\s*(?:sao|e|:|=)\s*\S+|dados bancarios\s*[:=]\s*\S+|(?:numero|agencia) da minha conta(?: bancaria)?\s*(?:e|:|=)\s*\d+|(?:meu cartao|numero do cartao|dados do cartao)\s*(?:e|:|=)\s*(?:\d{4}(?:[ -]?\d{4}){2,3}|final \d{4})|minha saude|meu estado de saude|problema de saude pessoal|condicao de saude pessoal|meu diagnostico|meus sintomas|meu tratamento|diagnostico medico pessoal|tratamento medico pessoal|minha doenca|aconselhamento financeiro pessoal|orientacao financeira pessoal|minhas financas pessoais|minha situacao financeira pessoal|estou endividado[oa]?|minha divida pessoal|fui vitima de fraud\w*|sofri fraud\w*|denunciar fraud\w*|fraude na minha conta|cai (?:em|num) (?:um )?golpe|me aplicaram (?:um )?golpe|sofri ameaca|fui ameacad\w*|me ameacaram|estou sendo ameacad\w*|ameaca contra mim|sofri assedio|fui vitima de assedio|fui assediad\w*|estou sendo assediad\w*|sofri violencia|fui vitima de violencia|sofri discriminacao|fui discriminad\w*)\b/i
const repeatedQuestionFeedbackPattern = /\b(?:(?:nao (?:quero|vou) (?:repetir|responder(?: isso)? de novo|falar disso de novo))|(?:(?:eu\s+)?(?:ja\s+)?(?:te\s+)?(?:respondi|respondeu|respondemos|respondido|falei|falado|disse|dizia|informei|informado|passei|contei|expliquei|mencionei)(?:\s+(?:isso|essa pergunta|a mesma coisa|sobre isso|essas informacoes|disso|aquilo))?)|(?:essa pergunta|essa questao)\s+ja\s+foi\s+respondida|(?:voce|vc)\s+(?:perguntou|repetiu)\s+(?:isso|a mesma coisa)(?:\s+(?:de novo|novamente))?|(?:pergunta|questao)\s+repetida|(?:perguntou|repetiu)\s+(?:isso|a mesma coisa)\s+(?:de novo|novamente))\b/i
const automationStageOrder: WhatsAppAutomationStage[] = [
  'identify_responsible', 'request_permission', 'understand_scenario', 'explore_need',
  'present_idea', 'qualify_interest', 'present_conditions', 'confirm_decision', 'closed',
]
const explicitOptOutPattern = /\b(?:nao entre(?: mais)? em contato(?: comigo)?(?: nunca mais| de novo| novamente)?|nao quero(?: mais)? contato|nao quero(?: mais)? receber (?:mensagens?|contato|comunicacoes?)|nao quero que (?:voces? )?(?:me )?(?:procurem?|contatem?|liguem?|chamem?)|nao quero ser contatad[oa]|nao me (?:envie|mande|contate|procure|ligue|chame)(?: mais| de novo| novamente)?|nunca mais (?:me )?(?:procure|contate|ligue|chame|mande|envie))\b/i
const identityQuestionPattern = /\b(?:quem (?:esta|ta) (?:me )?(?:respondendo|falando|atendendo)|quem (?:responde|atende)|com quem (?:eu )?(?:estou|to) falando|quem (?:e|eh) voce|voce (?:e|eh) (?:o )?(?:proprio )?cristhian|voce (?:esta|ta) falando com (?:o )?(?:proprio )?cristhian|e voce (?:o )?(?:proprio )?cristhian|estou falando com (?:o )?(?:proprio )?cristhian|cristhian (?:esta|ta) respondendo|e (?:o )?cristhian que (?:esta|ta) (?:respondendo|falando|atendendo)|voce (?:e|eh) (?:(?:uma?|a) )?(?:pessoa|humano|ia|inteligencia artificial|bot|robo|assistente(?: virtual)?|sistema automatizado|automacao|automatizad[oa]|automatic[oa])|(?:essa|esta) (?:e )?(?:uma? )?mensagem automatica|e (?:uma? )?mensagem automatica|isso (?:e|eh) (?:uma? )?(?:mensagem|resposta) automatica?|isso (?:e|eh) (?:uma? )?automacao|(?:suas|essas) respostas? (?:sao )?automaticas?|(?:esse|este|seu) atendimento (?:e|eh) automatizado|(?:essa|sua) resposta (?:foi )?gerada por (?:(?:uma?|a) )?ia)\b/i

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
  const asksIfAutomated = /\b(?:(?:essa|esta) (?:e )?(?:uma? )?mensagem automatica|e (?:uma? )?mensagem automatica|isso (?:e|eh) (?:uma? )?(?:mensagem|resposta) automatica?|isso (?:e|eh) (?:uma? )?automacao|(?:suas|essas) respostas? (?:sao )?automaticas?|(?:esse|este|seu) atendimento (?:e|eh) automatizado|(?:essa|sua) resposta (?:foi )?gerada por (?:uma? )?ia|(?:voce|vc|tu) (?:e|eh) (?:uma? )?(?:ia|inteligencia artificial|bot|robo|assistente(?: virtual)?|pessoa|humano|sistema automatizado|automacao|automatizad[oa]|automatic[oa]))\b/.test(normalized)
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

function keepConversationActive(stage: WhatsAppAutomationStage): WhatsAppAutomationStage {
  return stage === 'closed' ? 'qualify_interest' : stage
}

function distinctFollowUpQuestion(messages: Array<{ direction: 'inbound' | 'outbound'; body: string | null }>) {
  const project = resolveWhatsAppProjectContext(messages)
  if (project.currentService === 'landing page' || project.currentService === 'site') {
    return 'Vocês já têm alguma referência visual para essa página?'
  }
  return 'Já existe algum exemplo ou material que represente o que vocês imaginam para esse projeto?'
}

function commercialQualificationReply(messages: Array<{ direction: 'inbound' | 'outbound'; body: string | null }>) {
  const project = resolveWhatsAppProjectContext(messages)
  const outbound = messages.filter(({ direction, body }) => direction === 'outbound' && body).map(({ body }) => normalizeMessage(body ?? ''))
  const isSystem = project.currentService === 'sistema'
    || messages.some(({ direction, body }) => direction === 'inbound' && Boolean(body && /\b(?:sistema|software|aplicativo|app)\b/i.test(normalizeMessage(body))))
  const isWebsite = project.currentService === 'site' || project.currentService === 'landing page'

  if (isSystem) {
    const alreadyAskedProcess = outbound.some((body) => /\b(?:controlar|controle|rotina|dia a dia|etapas|processo|estoque|recebimento)\b/.test(body))
    const alreadyAskedTeam = outbound.some((body) => /\b(?:quantas pessoas|quem vai usar|equipe|usuarios|acessar o sistema)\b/.test(body))
    if (!alreadyAskedProcess) return 'Quais etapas do processo você precisa controlar primeiro?'
    if (!alreadyAskedTeam) return 'Quantas pessoas precisariam usar o sistema no dia a dia?'
    return 'Tem alguma informação ou relatório que seja indispensável na rotina?'
  }

  if (isWebsite) {
    const alreadyAskedReference = outbound.some((body) => /\b(?:referencia|exemplo|inspiracao|site que gosta)\b/.test(body))
    if (!alreadyAskedReference) return 'Já tem algum site ou referência visual que você gosta?'
    return 'Qual ação você gostaria que a pessoa conseguisse fazer ao acessar o site?'
  }

  return 'O que você considera indispensável incluir nesse projeto?'
}

function openBotSafeFallback(
  text: string,
  messages: Array<{ direction: 'inbound' | 'outbound'; body: string | null }>,
  stage: WhatsAppAutomationStage,
  receivedAt: string,
) {
  const repeatedQuestionRecovery = isRepeatedQuestionComplaint(text)
  const greetingReply = simpleWhatsAppGreetingReply(text, stage, receivedAt)
  const schedulingReply = getWhatsAppSchedulingReply(messages)
  const replyText = repeatedQuestionRecovery
    ? 'Você tem razão, desculpa por repetir. Vou seguir com o que você já me contou'
    : greetingReply?.replyText
      ?? (isDirectIdentityQuestion(text) ? identityReply(text) : undefined)
      ?? schedulingReply?.replyText
      ?? commercialQualificationReply(messages)
  return {
    action: 'reply' as const,
    replyText,
    nextStage: keepConversationActive(repeatedQuestionRecovery ? advanceStageAfterRepeatedQuestion(stage) : stage),
  }
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

function createAutoReplyContext(
  profile: WhatsAppAutomationProfile,
  stage: WhatsAppAutomationStage,
  inboundProjectInquiry: boolean,
  receivedAt: string,
  messages: Array<{ direction: 'inbound' | 'outbound'; body: string | null }>,
): WhatsAppAutoReplyContext {
  return {
    businessName: profile.businessName,
    senderIdentity: profile.senderIdentity,
    serviceSummary: profile.serviceSummary,
    approvedFacts: profile.approvedFacts,
    escalationContact: profile.escalationContact,
    stage,
    inboundProjectInquiry,
    inboundReceivedAt: receivedAt,
    messages,
  }
}

function buildSanitizedOpenBotPrompt(context: WhatsAppAutoReplyContext) {
  const sanitizedMessages = sanitizeWhatsAppHistoryForGemini(context.messages).slice(-10).map((message) => ({
    ...message,
    body: message.body && message.body.length > 700 ? `${message.body.slice(0, 680)} [trecho omitido]` : message.body,
  }))
  const prompt = buildWhatsAppAutoReplyPrompt({ ...context, messages: sanitizedMessages })
  return Buffer.byteLength(prompt, 'utf8') <= 24_000 ? prompt : undefined
}

function parseSavedAutoReply(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  try { return parseWhatsAppAutoReplyAnswer(JSON.stringify(value)) } catch { return undefined }
}

function openBotClientMessageId(runId: string) {
  return `whatsapp-${runId}`
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function pollOpenBotDeliveryBriefly(agentId: string, deliveryId: string) {
  let delivery: Awaited<ReturnType<typeof getOpenBotWhatsAppDelivery>> | undefined
  for (let attempt = 0; attempt <= 8; attempt += 1) {
    try {
      delivery = await getOpenBotWhatsAppDelivery(agentId, deliveryId)
    } catch (error) {
      if (!(error instanceof OpenBotWhatsAppBridgeError) || ![429, 502, 503].includes(error.status) || attempt === 8) throw error
    }
    if (delivery && !['queued', 'starting', 'running'].includes(delivery.status)) break
    if (attempt < 8) await wait(1_500)
  }
  if (!delivery) throw new OpenBotWhatsAppBridgeError(503, 'bridge_delivery_unavailable')
  return delivery
}

async function resumeOpenBotAutomationRun(
  store: WhatsAppStore,
  message: WhatsAppWebhookMessage,
  events: WhatsAppWebhookEvents,
) {
  const runId = message.automationRunId
  if (!runId) return
  const claimId = randomUUID()
  if (!(await store.claimOpenBotRun(runId, claimId))) return

  let run: WhatsAppAutomationRunRecord | undefined
  let agentLockOwned = false
  let terminal = false
  let sendingStarted = false
  let safeFallbackUsed = false
  let acceptedReplyId: string | undefined
  let context: Awaited<ReturnType<WhatsAppStore['getAutomationRuntimeContext']>>
  try {
    run = await store.getAutomationRun(runId)
    if (!run || run.status !== 'processing' || run.responseProvider !== 'openbot') return
    if (run.replyProviderMessageId || run.reason === 'delivery_accepted') {
      await store.reconcileAcceptedAutomationDeliveries()
      terminal = true
      return
    }
    if (run.reason === 'sending') {
      const sendingStartedAt = Date.parse(run.sendingStartedAt ?? '')
      if (Number.isFinite(sendingStartedAt) && Date.now() - sendingStartedAt < 2 * 60 * 1_000) return
      await store.pauseAutomationRunForHuman(run.id, 'delivery_unconfirmed', 'handoff_send_failed')
      terminal = true
      return
    }
    const agentId = run.openBotAgentId
    const bridge = getWhatsAppOpenBotBridgeConfig()
    if (!agentId || !bridge || bridge.agentId !== agentId) {
      await store.pauseAutomationRunForHuman(run.id, 'openbot_bridge_unavailable', 'handoff')
      terminal = true
      return
    }

    agentLockOwned = await store.claimOpenBotAgentLock(agentId, run.id)
    if (!agentLockOwned) {
      await store.pauseAutomationRunForHuman(run.id, 'openbot_agent_busy', 'handoff')
      terminal = true
      return
    }

    context = await store.getAutomationRuntimeContext(message.phoneNumberId, message.contactWaId)
    const profile = context?.profile
    let generated = parseSavedAutoReply(run.generatedResponse)

    if (!run.openBotClientMessageId) {
      if (!isWhatsAppOpenBotReplyRuntimeEnabled()) {
        await store.pauseAutomationRunForHuman(run.id, 'openbot_runtime_unavailable', 'handoff')
        terminal = true
        return
      }
      if (
        !context || !profile ||
        !profile.automationEnabled || profile.responseMode !== 'openbot' || profile.openBotAgentId !== agentId ||
        !profile.channelApprovedAt || !profile.contentApprovedAt || profile.updatedAt !== run.profileUpdatedAt ||
        context.automationPaused || context.automationOptedOut || context.latestProviderMessageId !== message.providerMessageId ||
        context.lastMessageDirection !== 'inbound'
      ) {
        await store.completeAutomationRun(run.id, 'skipped', 'openbot_state_changed_before_request')
        terminal = true
        return
      }
      const projectContext = resolveWhatsAppProjectContext(context.messages)
      const inboundProjectInquiry = isInboundProjectInquiry(message.body ?? '')
      const requestStage = projectContext.startsNewRequest || projectContext.clarificationReply
        || (inboundProjectInquiry && context.automationStage === 'identify_responsible')
        ? 'understand_scenario' : context.automationStage
      const promptContext = createAutoReplyContext(
        profile,
        requestStage,
        inboundProjectInquiry,
        message.occurredAt,
        sanitizeWhatsAppHistoryForGemini(context.messages),
      )
      const prompt = buildSanitizedOpenBotPrompt(promptContext)
      if (!prompt) {
        await store.pauseAutomationRunForHuman(run.id, 'openbot_prompt_too_large', 'handoff')
        terminal = true
        return
      }
      if (!run.openBotContextPreparedAt) {
        try {
          await clearOpenBotWhatsAppContext(agentId)
          await store.markOpenBotContextPrepared(run.id)
        } catch {
          await store.pauseAutomationRunForHuman(run.id, 'openbot_context_unavailable', 'handoff')
          terminal = true
          return
        }
      }
      run = await store.prepareOpenBotRequest({
        runId: run.id,
        agentId,
        clientMessageId: openBotClientMessageId(run.id),
        prompt,
        profileUpdatedAt: profile.updatedAt,
      })
    }

    if (!run.openBotClientMessageId || !run.openBotPrompt || !run.openBotRequestStartedAt) {
      await store.pauseAutomationRunForHuman(run.id, 'openbot_request_state_unknown', 'handoff')
      terminal = true
      return
    }
    const openBotRunId = run.id
    const openBotClientId = run.openBotClientMessageId
    const openBotPrompt = run.openBotPrompt

    if (!generated) {
      const requestedAt = Date.parse(run.openBotRequestStartedAt)
      if (!Number.isFinite(requestedAt) || Date.now() - requestedAt >= 24 * 60 * 60 * 1_000) {
        await store.pauseAutomationRunForHuman(run.id, 'openbot_receipt_expired', 'handoff')
        terminal = true
        return
      }

      if (!run.openBotDeliveryId) {
        try {
          const receipt = await sendOpenBotWhatsAppMessage(agentId, openBotPrompt, openBotClientId)
          await store.recordOpenBotDelivery(openBotRunId, receipt.deliveryId)
          run = await store.getAutomationRun(openBotRunId)
          if (!run || !run.openBotDeliveryId) return
        } catch (error) {
          if (error instanceof OpenBotWhatsAppBridgeError && error.status >= 400 && error.status < 500 && error.status !== 429) {
            await store.pauseAutomationRunForHuman(openBotRunId, 'openbot_request_rejected', 'handoff')
            terminal = true
          } else {
            logWarning('whatsapp_openbot_delivery_pending', { reason: 'request_receipt_not_confirmed' })
          }
          return
        }
      }

      let delivery
      const deliveryId = run?.openBotDeliveryId
      if (!deliveryId) return
      try {
        delivery = await pollOpenBotDeliveryBriefly(agentId, deliveryId)
      } catch (error) {
        if (error instanceof OpenBotWhatsAppBridgeError && error.status === 404) {
          try {
            const receipt = await sendOpenBotWhatsAppMessage(agentId, openBotPrompt, openBotClientId)
            await store.recordOpenBotDelivery(openBotRunId, receipt.deliveryId)
          } catch (retryError) {
            if (retryError instanceof OpenBotWhatsAppBridgeError && retryError.status >= 400 && retryError.status < 500 && retryError.status !== 429) {
              await store.pauseAutomationRunForHuman(openBotRunId, 'openbot_delivery_unavailable', 'handoff')
              terminal = true
            }
          }
        }
        return
      }

      if (delivery.status === 'queued' || delivery.status === 'starting' || delivery.status === 'running') return
      if (delivery.status !== 'completed' || !delivery.answer) {
        try {
          await clearOpenBotWhatsAppContext(agentId)
          await store.markOpenBotContextCleared(run.id)
        } catch {
          return
        }
        await store.pauseAutomationRunForHuman(run.id, 'openbot_delivery_failed', 'handoff')
        terminal = true
        return
      }

      generated = simpleWhatsAppGreetingReply(
        message.body ?? '',
        context?.automationStage ?? 'identify_responsible',
        message.occurredAt,
      ) ?? parseWhatsAppAutoReplyAnswer(delivery.answer)
      if (!generated && isDirectIdentityQuestion(message.body ?? '')) {
        generated = { action: 'reply', replyText: identityReply(message.body ?? ''), nextStage: context?.automationStage ?? 'identify_responsible' }
      }
      if (generated) await store.saveOpenBotGeneratedResponse(run.id, generated, generated.replyText)
    }

    run = await store.getAutomationRun(run.id)
    if (!run || run.status !== 'processing') return
    generated = parseSavedAutoReply(run.generatedResponse)
    if (!generated) {
      const fallbackMessages = context?.messages ?? []
      const latestText = message.body ?? ''
      const needsHumanReview = hasStopOrRefusal(latestText)
        || requiresHumanHandoff(fallbackMessages)
        || sensitiveHandoffPattern.test(normalizeMessage(latestText))
        || formalComplaintPattern.test(normalizeMessage(latestText))
      if (!run.openBotContextClearedAt) {
        try {
          await clearOpenBotWhatsAppContext(agentId)
          await store.markOpenBotContextCleared(run.id)
        } catch {
          logWarning('whatsapp_openbot_context_clear_failed_before_fallback', { reason: 'continuing_with_safe_reply' })
        }
      }
      if (needsHumanReview) {
        await store.pauseAutomationRunForHuman(run.id, 'openbot_reply_invalid_requires_review', 'handoff')
        terminal = true
        return
      }
      generated = openBotSafeFallback(latestText, fallbackMessages, context?.automationStage ?? 'qualify_interest', message.occurredAt)
      await store.updateGeneratedAutomationResponse(run.id, generated, generated.replyText)
      safeFallbackUsed = true
      logWarning('whatsapp_openbot_safe_fallback_used', { reason: 'invalid_agent_reply' })
      run = await store.getAutomationRun(run.id)
      if (!run || run.status !== 'processing') return
      generated = parseSavedAutoReply(run.generatedResponse)
      if (!generated) {
        await store.pauseAutomationRunForHuman(run.id, 'openbot_reply_invalid_requires_review', 'handoff')
        terminal = true
        return
      }
    }

    if (!run.openBotContextClearedAt && !safeFallbackUsed) {
      try {
        await clearOpenBotWhatsAppContext(agentId)
        await store.markOpenBotContextCleared(run.id)
      } catch {
        return
      }
    }

    context = await store.getAutomationRuntimeContext(message.phoneNumberId, message.contactWaId)
    const currentProfile = context?.profile
    const currentAgeMs = Date.now() - Date.parse(message.occurredAt)
    if (!isWhatsAppAutomationRuntimeEnabled() || !isWhatsAppOpenBotReplyRuntimeEnabled()) {
      await store.pauseAutomationRunForHuman(run.id, 'openbot_runtime_unavailable', 'handoff')
      terminal = true
      return
    }
    if (
      !context || !currentProfile || !currentProfile.automationEnabled || currentProfile.responseMode !== 'openbot' ||
      currentProfile.openBotAgentId !== agentId || currentProfile.updatedAt !== run.profileUpdatedAt ||
      !currentProfile.channelApprovedAt || !currentProfile.contentApprovedAt || context.automationPaused || context.automationOptedOut ||
      context.latestProviderMessageId !== message.providerMessageId || context.lastMessageDirection !== 'inbound' ||
      !Number.isFinite(currentAgeMs) || currentAgeMs < 0 || currentAgeMs >= customerServiceWindowMs || !getEvolutionApiConfig()
    ) {
      await store.completeAutomationRun(run.id, 'skipped', 'state_changed_before_openbot_send')
      terminal = true
      return
    }
    try {
      const connectionState = await getEvolutionConnectionState(message.phoneNumberId)
      if (connectionState.state.toLowerCase() !== 'open') {
        await store.pauseAutomationRunForHuman(run.id, 'evolution_connection_unavailable', 'handoff')
        terminal = true
        return
      }
    } catch {
      await store.pauseAutomationRunForHuman(run.id, 'evolution_connection_unavailable', 'handoff')
      terminal = true
      return
    }

    const repeatedQuestionRecovery = isRepeatedQuestionComplaint(message.body ?? '')
    const handoffMessages = [
      ...context.messages,
      ...events.messages.filter((candidate) => candidate.phoneNumberId === message.phoneNumberId && candidate.contactWaId === message.contactWaId)
        .map(({ direction, body, occurredAt }) => ({ direction, body: body ?? null, occurredAt })),
    ]
    const leadAskedIdentity = isDirectIdentityQuestion(message.body ?? '')
    const requiresHumanAfterIdentity = leadAskedIdentity && requiresHumanHandoff(handoffMessages)
    if (leadAskedIdentity && (requiresHumanAfterIdentity || generated.action !== 'reply' || !isTransparentWhatsAppIdentityAnswer(generated.replyText))) {
      generated = { action: 'reply', replyText: identityReply(message.body ?? ''), nextStage: context?.automationStage ?? 'identify_responsible' }
    }
    const commercialQualificationRequired = asksForUnapprovedCommercialTerms(message.body ?? '')
      && !requiresHumanHandoff(handoffMessages)
      && !hasStopOrRefusal(message.body ?? '')
      && !sensitiveHandoffPattern.test(normalizeMessage(message.body ?? ''))
    if (commercialQualificationRequired && !leadAskedIdentity) {
      generated = {
        action: 'reply',
        replyText: commercialQualificationReply(handoffMessages),
        nextStage: keepConversationActive(context?.automationStage ?? 'qualify_interest'),
      }
    }
    if ((requiresHumanHandoff(handoffMessages) || generated.action === 'handoff') && !repeatedQuestionRecovery && !requiresHumanAfterIdentity) {
      await store.pauseAutomationRunForHuman(run.id, 'openbot_requested_human_handoff', 'handoff')
      terminal = true
      return
    }
    if (repeatedQuestionRecovery) {
      generated = {
        action: 'reply',
        replyText: 'Você tem razão, desculpa por repetir. Vou seguir com o que você já me contou',
        nextStage: advanceStageAfterRepeatedQuestion(context?.automationStage ?? 'identify_responsible'),
      }
    }

    const projectContext = resolveWhatsAppProjectContext(context.messages)
    const inboundProjectInquiry = isInboundProjectInquiry(message.body ?? '')
    const schedulingReply = getWhatsAppSchedulingReply(context.messages)
    const requestStage = projectContext.startsNewRequest || projectContext.clarificationReply
      || (inboundProjectInquiry && context.automationStage === 'identify_responsible')
      ? 'understand_scenario' : context.automationStage

    if (leadAskedIdentity && generated.action === 'reply' && !isTransparentWhatsAppIdentityAnswer(generated.replyText)) {
      generated = { action: 'reply', replyText: identityReply(message.body ?? ''), nextStage: context.automationStage }
    }
    if (generated.action === 'stop') {
      generated = { action: 'reply', replyText: 'Se surgir outra dúvida, pode me chamar por aqui', nextStage: 'closed' }
    }
    if (generated.action === 'reply') {
      generated = { ...generated, nextStage: keepStageFromMovingBackward(requestStage, generated.nextStage) }
    }
    if (repeatedQuestionRecovery && generated.action === 'reply' && generated.replyText.includes('?')) {
      generated = {
        action: 'reply',
        replyText: 'Você tem razão, desculpa por repetir. Vou seguir com o que você já me contou',
        nextStage: advanceStageAfterRepeatedQuestion(context.automationStage),
      }
    }
    if (generated.action === 'reply' && getRepeatedQuestionTopic(generated.replyText, projectContext.messages)) {
      generated = { ...generated, replyText: distinctFollowUpQuestion(projectContext.messages) }
    }
    if (schedulingReply && !repeatedQuestionRecovery && !leadAskedIdentity) generated = { ...generated, replyText: schedulingReply.replyText }
    if (inboundProjectInquiry && generated.action === 'reply' && isColdProspectingReply(generated.replyText)) {
      generated = { action: 'reply', replyText: 'Oi, me conta um pouco do que você está pensando para o projeto', nextStage: 'understand_scenario' }
    }

    const body = normalizeWhatsAppReplyText(generated.replyText)
    await store.updateGeneratedAutomationResponse(run.id, generated, body)
    if (schedulingReply) await store.markConversationScheduleReviewRequired(context.userId, context.conversationId)
    await store.markAutomationRunSending(run.id)
    sendingStarted = true
    const replyId = await sendEvolutionTextMessage(message.phoneNumberId, message.contactWaId, body)
    acceptedReplyId = replyId
    await store.recordAutomationReplyAccepted(run.id, replyId)
    await store.persistAutomatedReply({
      userId: context.userId, phoneNumberId: message.phoneNumberId, conversationId: context.conversationId,
      contactWaId: message.contactWaId, providerMessageId: replyId, body, occurredAt: new Date().toISOString(),
    })
    await store.updateAutomationStage(context.conversationId, generated.nextStage)
    if (generated.nextStage === 'closed' && !repeatedQuestionRecovery) {
      await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'assistant_closed')
    }
    if (requiresHumanAfterIdentity) {
      await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'handoff')
      await store.completeAutomationRun(run.id, 'needs_human', 'identity_answer_handoff', replyId)
      terminal = true
      return
    }
    await store.completeAutomationRun(run.id, 'sent', undefined, replyId)
    terminal = true
  } catch (error) {
    if (run && sendingStarted) {
      const reason = acceptedReplyId ? 'history_sync_failed_after_send' : 'delivery_unconfirmed'
      await store.pauseAutomationRunForHuman(run.id, reason, 'handoff_send_failed', acceptedReplyId).catch(() => undefined)
      terminal = true
    } else if (run && error instanceof OpenBotWhatsAppBridgeError && error.status >= 400 && error.status < 500 && error.status !== 429) {
      await store.pauseAutomationRunForHuman(run.id, 'openbot_bridge_rejected', 'handoff').catch(() => undefined)
      terminal = true
    }
    logWarning('whatsapp_openbot_run_recovery_failed', { reason: sendingStarted ? 'delivery_outcome_unknown' : 'recovery_unavailable' })
  } finally {
    if (agentLockOwned && terminal && run?.openBotAgentId) {
      await store.releaseOpenBotAgentLock(run.openBotAgentId, run.id).catch(() => undefined)
    }
    await store.releaseOpenBotRun(runId, claimId).catch(() => undefined)
  }
}

export async function persistWhatsAppStopRequests(events: WhatsAppWebhookEvents) {
  const inboundMessages = events.messages.filter((message) => (
    message.source === 'live' && message.direction === 'inbound' && message.messageType === 'text' && Boolean(message.body?.trim())
  ))
  const store = new WhatsAppStore()
  if (!(await store.isAutomationStorageReady())) return

  for (const message of inboundMessages) {
    const normalized = normalizeMessage(message.body ?? '')
    if (!hasStopOrRefusal(normalized)) continue
    const context = await store.getAutomationRuntimeContext(message.phoneNumberId, message.contactWaId)
    if (!context) continue
    if (hasOptOutRequest(normalized)) {
      await store.markConversationOptedOut(context.userId, context.conversationId)
    } else {
      await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'refusal')
    }
  }
}

export async function processWhatsAppAutomation(events: WhatsAppWebhookEvents) {
  const allInboundMessages = events.messages.filter((message) => (
    message.source === 'live' && message.direction === 'inbound' && message.messageType === 'text' && Boolean(message.body?.trim())
  ))
  const store = new WhatsAppStore()
  if (!(await store.isAutomationStorageReady())) return
  await persistWhatsAppStopRequests(events)

  for (const message of allInboundMessages.filter((candidate) => candidate.automationRunId)) {
    await resumeOpenBotAutomationRun(store, message, events)
  }

  const inboundMessages = allInboundMessages.filter((message) => !message.automationRunId && !message.contactWaId.startsWith('lid:'))
  const messages = newestInboundMessages(inboundMessages)
  if (messages.length === 0) return
  const newestByConversation = new Map(messages.map((message) => [
    `${message.phoneNumberId}:${message.contactWaId}`,
    message.providerMessageId,
  ]))

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

      const run = await store.claimAutomationRun(
        context.userId,
        message.phoneNumberId,
        context.conversationId,
        message.providerMessageId,
        profile.responseMode === 'openbot' ? 'openbot' : profile.responseMode === 'digibot_agent' ? 'digibot_agent' : profile.responseMode === 'gemini' ? 'gemini' : undefined,
        profile.responseMode === 'openbot' ? profile.openBotAgentId : undefined,
        profile.updatedAt,
      )
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
      const commercialQualificationRequired = asksForUnapprovedCommercialTerms(message.body ?? '')
        && !shouldHandoff
        && !hasStopOrRefusal(message.body ?? '')
        && !sensitiveHandoffPattern.test(normalizeMessage(message.body ?? ''))
      const leadAskedIdentity = isDirectIdentityQuestion(message.body ?? '')
      const inboundProjectInquiry = isInboundProjectInquiry(message.body ?? '')
      const projectContext = resolveWhatsAppProjectContext(context.messages)
      const schedulingReply = shouldHandoff ? undefined : getWhatsAppSchedulingReply(context.messages)
      const requestStage = projectContext.startsNewRequest || projectContext.clarificationReply
        || (inboundProjectInquiry && context.automationStage === 'identify_responsible')
        ? 'understand_scenario' : context.automationStage
      const apiKey = getGeminiApiKey()
      let agentProviderConfig: Awaited<ReturnType<typeof getWhatsAppAgentProviderConfigForUser>>
      const needsAgentProvider = profile.responseMode === 'digibot_agent'
        && isWhatsAppDigiBuscaAgentRuntimeEnabled()
        && !shouldHandoff
        && !commercialQualificationRequired
        && !leadAskedIdentity
        && !schedulingReply
      if (needsAgentProvider) {
        try {
          agentProviderConfig = await getWhatsAppAgentProviderConfigForUser(context.userId, profile.agentProvider, profile.agentModel)
        } catch {
          agentProviderConfig = undefined
        }
      }
      const agentConfigured = Boolean(agentProviderConfig)
      const replyPlan = selectWhatsAppAutomationReplyPlan({
        responseMode: profile.responseMode,
        shouldHandoff,
        geminiConfigured: Boolean(apiKey),
        agentConfigured,
      })
      const repeatedQuestionRecovery = (replyPlan === 'gemini' || replyPlan === 'digibot_agent')
        && !shouldHandoff
        && isRepeatedQuestionComplaint(message.body ?? '')
      const identityDisclosureResponse = leadAskedIdentity && !shouldHandoff && replyPlan !== 'openbot'
      const deterministicReply = commercialQualificationRequired || repeatedQuestionRecovery || identityDisclosureResponse || (Boolean(schedulingReply) && replyPlan !== 'openbot')
      let generated: Awaited<ReturnType<typeof generateWhatsAppAutoReply>>
      if (replyPlan === 'openbot') {
        await resumeOpenBotAutomationRun(store, { ...message, automationRunId: runId }, events)
        continue
      } else if (deterministicReply) {
        generated = {
          action: 'reply',
          replyText: commercialQualificationRequired
            ? commercialQualificationReply(handoffMessages)
            : [
            repeatedQuestionRecovery ? 'Você tem razão, desculpa por repetir. Vou seguir com o que você já me contou' : undefined,
            identityDisclosureResponse ? identityReply(message.body ?? '') : undefined,
          schedulingReply?.replyText,
          ].filter(Boolean).join(' '),
          nextStage: repeatedQuestionRecovery
            ? advanceStageAfterRepeatedQuestion(context.automationStage)
            : commercialQualificationRequired
              ? keepConversationActive(context.automationStage)
              : context.automationStage,
        }
      } else if (shouldHandoff || replyPlan === 'handoff') {
        generated = { action: 'handoff', replyText: '', nextStage: context.automationStage }
      } else {
        try {
          const replyContext: WhatsAppAutoReplyContext = {
            businessName: profile.businessName,
            senderIdentity: profile.senderIdentity,
            serviceSummary: profile.serviceSummary,
            approvedFacts: profile.approvedFacts,
            escalationContact: profile.escalationContact,
            stage: requestStage,
            inboundProjectInquiry,
            inboundReceivedAt: message.occurredAt,
            messages: sanitizeWhatsAppHistoryForGemini(context.messages),
          }
          if (replyPlan === 'digibot_agent') {
            let verifiedLeadQualification: Awaited<ReturnType<typeof store.getAgentQualification>>
            try {
              verifiedLeadQualification = await store.getAgentQualification(context.userId, context.conversationId)
            } catch {
              verifiedLeadQualification = undefined
              logWarning('whatsapp_digibot_qualification_load_failed', { reason: 'qualification_storage_unavailable' })
            }
            generated = await generateWhatsAppDigiBuscaAgentReply({
              provider: profile.agentProvider,
              model: profile.agentModel,
              providerConfig: agentProviderConfig!,
              context: { ...replyContext, verifiedLeadQualification },
              saveQualification: (fields) => store.saveAgentQualification(context!.userId, context!.conversationId, fields),
            })
          } else {
            if (!apiKey) throw new WhatsAppAutoReplyError('gemini_not_configured', 401)
            generated = await generateWhatsAppAutoReply(apiKey, replyContext)
          }
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
          replyText: 'Se surgir outra dúvida, pode me chamar por aqui',
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
          replyText: 'Imagina, se precisar é só me chamar por aqui',
          nextStage: 'closed',
        }
      }
      if (generated.action === 'reply' && generated.nextStage === 'closed' && !assistantRequestedClosure && !inboundSignalsClosure && context.automationStage !== 'closed') {
        generated = { ...generated, nextStage: context.automationStage }
      }

      if (inboundProjectInquiry && generated.action === 'reply' && isColdProspectingReply(generated.replyText)) {
        generated = {
          action: 'reply',
          replyText: 'Oi, me conta um pouco do que você está pensando para o projeto',
          nextStage: 'understand_scenario',
        }
      }

      if (generated.action === 'handoff') {
        await store.setConversationAutomationPaused(context.userId, context.conversationId, true, 'handoff')
        await store.completeAutomationRun(runId, 'needs_human', shouldHandoff ? 'explicit_human_or_commercial_request' : 'human_review_required')
        continue
      }

      if (schedulingReply) {
        try {
          await store.markConversationScheduleReviewRequired(context.userId, context.conversationId)
        } catch {
          logWarning('whatsapp_schedule_review_mark_failed', { reason: 'schedule_review_state_unavailable' })
        }
      }

      const body = normalizeWhatsAppReplyText(generated.replyText)
      await store.persistGeneratedAutomationResponse(runId, generated, body)
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
        if (sendingStarted) {
          const reason = acceptedReplyId ? 'history_sync_failed_after_send' : 'delivery_unconfirmed'
          await store.pauseAutomationRunForHuman(runId, reason, 'handoff_send_failed', acceptedReplyId).catch(() => undefined)
        } else {
          await store.completeAutomationRun(runId, 'failed', 'processing_error').catch(() => undefined)
        }
      }
      logWarning('whatsapp_automation_message_skipped', {
        reason: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }
}
