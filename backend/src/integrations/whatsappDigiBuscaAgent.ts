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

type QualificationToolInput = Partial<Record<WhatsAppAgentQualificationField, { value: string; sourceQuote: string }>>

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

export async function generateWhatsAppDigiBuscaAgentReply(request: {
  provider: WhatsAppAgentProvider
  model: string
  context: WhatsAppAutoReplyContext
  saveQualification: (fields: WhatsAppAgentQualification) => Promise<void>
}): Promise<WhatsAppAutoReply> {
  const model = createAgentModel(request.provider, request.model)
  if (!model) throw new WhatsAppAutoReplyError('digibot_agent_provider_not_configured', 503)

  const inboundTexts = request.context.messages
    .filter((message) => message.direction === 'inbound' && message.body?.trim())
    .map((message) => message.body!.trim())
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
    abortSignal: AbortSignal.timeout(18_000),
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
