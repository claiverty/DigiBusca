import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { stepCountIs, ToolLoopAgent, tool, type LanguageModel } from 'ai'
import { z } from 'zod'
import { logWarning } from '../observability/logger.js'
import type { WhatsAppAgentProvider } from '../contracts/whatsappAutomation.js'
import type { WhatsAppAutoReply, WhatsAppAutoReplyContext } from './whatsappAutoReplyProvider.js'
import { buildWhatsAppAutoReplyPrompt, parseWhatsAppAutoReplyAnswer, WhatsAppAutoReplyError } from './whatsappAutoReplyProvider.js'
import { getWhatsAppAgentProviderConfig } from '../config/supabase.js'

export type WhatsAppAgentQualification = NonNullable<WhatsAppAutoReplyContext['verifiedLeadQualification']>
export type WhatsAppAgentQualificationField = keyof WhatsAppAgentQualification

type WhatsAppDigiBuscaAgentRequest = {
  provider: WhatsAppAgentProvider
  model: string
  context: WhatsAppAutoReplyContext
  saveQualification: (fields: WhatsAppAgentQualification) => Promise<void>
}

type QualificationToolInput = Partial<Record<WhatsAppAgentQualificationField, { value: string; sourceQuote: string }>>
const googleFallbackModel = 'gemini-3.5-flash'

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

function createAgentModel(provider: WhatsAppAgentProvider, modelId: string): LanguageModel | undefined {
  const config = getWhatsAppAgentProviderConfig(provider, modelId)
  if (!config) return undefined
  if (config.provider === 'google') return createGoogle({ apiKey: config.apiKey })(config.model)
  if (config.provider === 'anthropic') return createAnthropic({ apiKey: config.apiKey })(config.model)
  return createOpenAICompatible({
    name: 'DigiBusca OpenAI Compatible',
    baseURL: config.baseUrl!,
    apiKey: config.apiKey,
  }).chatModel(config.model)
}

export async function generateWhatsAppDigiBuscaAgentReply(request: WhatsAppDigiBuscaAgentRequest): Promise<WhatsAppAutoReply> {
  const inboundTexts = request.context.messages
    .filter((message) => message.direction === 'inbound' && message.body?.trim())
    .map((message) => message.body!.trim())
  const models = [request.model]
  if (request.provider === 'google' && request.model !== googleFallbackModel) models.push(googleFallbackModel)

  let lastError: unknown
  for (const [index, modelId] of models.entries()) {
    try {
      const model = createAgentModel(request.provider, modelId)
      if (!model) throw new WhatsAppAutoReplyError('digibot_agent_provider_not_configured', 503)
      return await generateWithAgentModel(model, request, inboundTexts)
    } catch (error) {
      lastError = error
      const fallbackModel = models[index + 1]
      if (!fallbackModel || !shouldFallbackModel(error)) throw error
      logWarning('whatsapp_digibot_agent_model_fallback', {
        primaryModel: modelId,
        fallbackModel,
        reason: modelFailureReason(error),
      })
    }
  }

  throw lastError ?? new WhatsAppAutoReplyError('digibot_agent_generation_failed', 502)
}

async function generateWithAgentModel(
  model: LanguageModel,
  request: Pick<WhatsAppDigiBuscaAgentRequest, 'context' | 'saveQualification'>,
  inboundTexts: string[],
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
  })

  const result = await agent.generate({
    prompt: buildWhatsAppAutoReplyPrompt(request.context, true),
    abortSignal: AbortSignal.timeout(10_000),
  })
  if (requestedHumanReview) {
    await persistPendingQualifications(request.saveQualification, pendingQualifications)
    return { action: 'handoff', replyText: '', nextStage: request.context.stage }
  }
  const generated = parseWhatsAppAutoReplyAnswer(result.text)
  if (!generated) throw new WhatsAppAutoReplyError('digibot_agent_reply_invalid', 502)
  await persistPendingQualifications(request.saveQualification, pendingQualifications)
  return generated
}

function shouldFallbackModel(error: unknown) {
  if (error instanceof WhatsAppAutoReplyError && error.reason === 'digibot_agent_reply_invalid') return true
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) return true
  if (error instanceof TypeError) return true
  const status = modelErrorStatus(error)
  return typeof status === 'number' && (status === 404 || status === 408 || status === 429 || status >= 500)
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
