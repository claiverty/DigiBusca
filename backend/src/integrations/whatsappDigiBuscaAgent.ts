import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { NoObjectGeneratedError, Output, stepCountIs, ToolLoopAgent, tool, type LanguageModel } from 'ai'
import { z } from 'zod'
import { logInfo, logWarning } from '../observability/logger.js'
import type { WhatsAppAgentProvider } from '../contracts/whatsappAutomation.js'
import type { WhatsAppAutoReply, WhatsAppAutoReplyContext } from './whatsappAutoReplyProvider.js'
import { buildWhatsAppAutoReplyPrompt, parseWhatsAppAutoReplyAnswer, WhatsAppAutoReplyError } from './whatsappAutoReplyProvider.js'
import type { WhatsAppAgentProviderConfig } from '../config/supabase.js'
import { safeExternalApiFetch } from './externalApiFetch.js'

export type WhatsAppAgentQualification = NonNullable<WhatsAppAutoReplyContext['verifiedLeadQualification']>
export type WhatsAppAgentQualificationField = keyof WhatsAppAgentQualification

type WhatsAppDigiBuscaAgentRequest = {
  provider: WhatsAppAgentProvider
  model: string
  providerConfig: WhatsAppAgentProviderConfig
  context: WhatsAppAutoReplyContext
  saveQualification: (fields: WhatsAppAgentQualification) => Promise<void>
}

type QualificationToolInput = Partial<Record<WhatsAppAgentQualificationField, { value: string; sourceQuote: string }>>
const googleFallbackModel = 'gemini-3.5-flash'
const generationDeadlineMs = 30_000
const perModelTimeoutMs = 20_000
const whatsappAutomationStages = [
  'identify_responsible', 'request_permission', 'understand_scenario', 'explore_need',
  'present_idea', 'qualify_interest', 'present_conditions', 'confirm_decision', 'closed',
] as const

const whatsappAgentReplySchema = z.object({
  action: z.enum(['reply', 'handoff', 'stop']),
  replyText: z.string().max(280),
  nextStage: z.enum(whatsappAutomationStages),
}).strict()

const qualificationFieldSchema = z.object({
  value: z.string().trim().min(1).max(180),
  sourceQuote: z.string().trim().min(3).max(220),
}).strict()

const qualificationToolSchema = z.object({
  projectType: qualificationFieldSchema.optional(),
  objective: qualificationFieldSchema.optional(),
  priority: qualificationFieldSchema.optional(),
  timeline: qualificationFieldSchema.optional(),
  serviceInterest: qualificationFieldSchema.optional(),
}).strict()

function normalizeForQuoteMatch(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim()
}

function createAgentModel(config: WhatsAppAgentProviderConfig, modelId: string): LanguageModel {
  const modelConfig = { ...config, model: modelId }
  if (modelConfig.provider === 'google') {
    return createGoogle({ apiKey: modelConfig.apiKey, fetch: createGoogleOverloadRetryFetch(safeExternalApiFetch) })(modelConfig.model)
  }
  if (modelConfig.provider === 'anthropic') return createAnthropic({ apiKey: modelConfig.apiKey, fetch: safeExternalApiFetch })(modelConfig.model)
  return createOpenAICompatible({
    name: 'DigiBusca OpenAI Compatible',
    baseURL: modelConfig.baseUrl!,
    apiKey: modelConfig.apiKey,
    fetch: safeExternalApiFetch,
  }).chatModel(modelConfig.model)
}

export async function generateWhatsAppDigiBuscaAgentReply(request: WhatsAppDigiBuscaAgentRequest): Promise<WhatsAppAutoReply> {
  const inboundTexts = request.context.messages
    .filter((message) => message.direction === 'inbound' && message.body?.trim())
    .map((message) => message.body!.trim())
  const models = [request.model]
  if (request.provider === 'google' && request.model !== googleFallbackModel) models.push(googleFallbackModel)

  let lastError: unknown
  const deadlineAt = Date.now() + generationDeadlineMs
  for (const [index, modelId] of models.entries()) {
    const remainingMs = deadlineAt - Date.now()
    if (remainingMs <= 0) throw lastError ?? new WhatsAppAutoReplyError('gemini_timeout', 504)
    const modelTimeoutMs = Math.min(perModelTimeoutMs, remainingMs)
    const startedAt = Date.now()
    try {
      const model = createAgentModel(request.providerConfig, modelId)
      const generated = await generateWithAgentModel(model, request, inboundTexts, modelTimeoutMs)
      logInfo('whatsapp_digibot_agent_model_succeeded', {
        model: modelId,
        elapsedMs: Date.now() - startedAt,
      })
      return generated
    } catch (error) {
      lastError = normalizeModelError(error)
      const fallbackModel = models[index + 1]
      if (!fallbackModel || !shouldFallbackModel(lastError)) throw lastError
      logWarning('whatsapp_digibot_agent_model_fallback', {
        primaryModel: modelId,
        fallbackModel,
        reason: modelFailureReason(lastError),
        status: modelErrorStatus(lastError),
        elapsedMs: Date.now() - startedAt,
      })
    }
  }

  throw lastError ?? new WhatsAppAutoReplyError('digibot_agent_generation_failed', 502)
}

async function generateWithAgentModel(
  model: LanguageModel,
  request: Pick<WhatsAppDigiBuscaAgentRequest, 'context' | 'saveQualification'>,
  inboundTexts: string[],
  timeoutMs: number,
): Promise<WhatsAppAutoReply> {
  let requestedHumanReview = false
  const pendingQualifications: WhatsAppAgentQualification = {}

  const agent = new ToolLoopAgent({
    id: 'digibusca-cristhian-whatsapp',
    model,
    instructions: 'Você é Cristhian, o agente comercial da DigiUP no WhatsApp. Siga integralmente as regras, o histórico e os fatos aprovados recebidos no pedido. Use ferramentas somente quando houver evidência explícita no texto do lead. A resposta final deve ser apenas o JSON de ação, mensagem e etapa solicitado.',
    tools: {
      save_project_qualification: tool({
        description: 'Salva no DigiBusca os dados de projeto que o lead já declarou explicitamente. Para cada campo, inclua uma citação curta e literal de uma mensagem recebida do lead. Nunca infira ou preencha com suposições.',
        inputSchema: qualificationToolSchema,
        execute: async (toolInput: QualificationToolInput) => {
          const verified: WhatsAppAgentQualification = {}
          for (const key of ['projectType', 'objective', 'priority', 'timeline', 'serviceInterest'] as const) {
            const candidate = toolInput[key]
            if (!candidate) continue
            const quote = normalizeForQuoteMatch(candidate.sourceQuote)
            const value = normalizeForQuoteMatch(candidate.value)
            if (
              quote.length < 3 || !value || !quote.includes(value) ||
              !inboundTexts.some((text) => normalizeForQuoteMatch(text).includes(quote))
            ) continue
            verified[key] = candidate.value
          }
          if (Object.keys(verified).length === 0) return { saved: false, reason: 'no_verifiable_lead_quote' }
          Object.assign(pendingQualifications, verified)
          return { accepted: true, fields: Object.keys(verified) }
        },
      }),
      request_human_review: tool({
        description: 'Marca a conversa para atendimento humano quando a pessoa pedir alguém da equipe, fizer reclamação formal ou trouxer um assunto sensível que as regras mandam encaminhar.',
        inputSchema: z.object({ reason: z.string().trim().min(1).max(180) }).strict(),
        execute: async ({ reason }) => {
          requestedHumanReview = true
          return { requested: true, reason: reason.slice(0, 180) }
        },
      }),
    },
    toolCallConcurrency: 1,
    stopWhen: stepCountIs(4),
    maxRetries: 0,
    maxOutputTokens: 600,
    temperature: 0.25,
    output: Output.object({ schema: whatsappAgentReplySchema }),
  })

  const result = await agent.generate({
    prompt: buildWhatsAppAutoReplyPrompt(request.context, true),
    abortSignal: AbortSignal.timeout(timeoutMs),
  })
  if (requestedHumanReview) {
    await persistPendingQualifications(request.saveQualification, pendingQualifications)
    return { action: 'handoff', replyText: '', nextStage: request.context.stage }
  }
  const generated = parseWhatsAppAutoReplyAnswer(JSON.stringify(result.output ?? null))
  if (!generated) throw new WhatsAppAutoReplyError('digibot_agent_reply_invalid', 502)
  await persistPendingQualifications(request.saveQualification, pendingQualifications)
  return generated
}

function shouldFallbackModel(error: unknown) {
  if (error instanceof WhatsAppAutoReplyError && error.reason === 'digibot_agent_reply_invalid') return true
  if (NoObjectGeneratedError.isInstance(error)) return true
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) return true
  if (error instanceof TypeError) return true
  const status = modelErrorStatus(error)
  return typeof status === 'number' && (status === 404 || status === 408 || status === 429 || status >= 500)
}

function normalizeModelError(error: unknown) {
  if (error instanceof WhatsAppAutoReplyError) return error
  if (NoObjectGeneratedError.isInstance(error)) return new WhatsAppAutoReplyError('digibot_agent_reply_invalid', 502)
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) {
    return new WhatsAppAutoReplyError('gemini_timeout', 504)
  }
  const status = modelErrorStatus(error)
  if (typeof status === 'number') {
    const reason = status === 429 ? 'gemini_rate_limited'
      : status >= 500 ? 'gemini_provider_unavailable'
        : 'gemini_provider_error'
    return new WhatsAppAutoReplyError(reason, status)
  }
  return error
}

function createGoogleOverloadRetryFetch(fetcher: typeof fetch): typeof fetch {
  return async (input, init = {}) => {
    const response = await fetcher(input, init)
    if (response.status !== 503) return response

    const signal = init.signal ?? (input instanceof Request ? input.signal : undefined)
    await response.body?.cancel().catch(() => undefined)
    await waitForGoogleRetry(signal)
    return fetcher(input, init)
  }
}

function waitForGoogleRetry(signal?: AbortSignal | null) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('A chamada foi cancelada.', 'AbortError'))

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, 800 + Math.floor(Math.random() * 401))
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason ?? new DOMException('A chamada foi cancelada.', 'AbortError'))
    }
    function finish() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function modelFailureReason(error: unknown) {
  if (error instanceof WhatsAppAutoReplyError) return error.reason
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) return 'model_timeout'
  if (error instanceof TypeError) return 'model_network_error'
  const status = modelErrorStatus(error)
  return status === undefined ? 'model_error' : `model_http_${status}`
}

function modelErrorStatus(error: unknown) {
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = 'statusCode' in error ? (error as { statusCode?: unknown }).statusCode
    : 'status' in error ? (error as { status?: unknown }).status
      : undefined
  return typeof candidate === 'number' ? candidate : undefined
}

async function persistPendingQualifications(
  saveQualification: (fields: WhatsAppAgentQualification) => Promise<void>,
  fields: WhatsAppAgentQualification,
) {
  if (Object.keys(fields).length === 0) return
  try {
    await saveQualification(fields)
  } catch {
    logWarning('whatsapp_digibot_qualification_save_failed', { reason: 'qualification_storage_unavailable' })
  }
}
