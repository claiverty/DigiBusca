import { getWhatsAppCloudConfig } from '../config/supabase.js'
import type { SupabaseStore } from '../data/supabaseStore.js'
import { sendApprovedTemplateMessage, WhatsAppCloudApiError } from '../integrations/whatsappCloudApi.js'

export class WhatsAppSendFlowError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export function parseWhatsAppTemplateSendInput(value: unknown): { leadId: string; message: string } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const body = value as Record<string, unknown>
  if (
    typeof body.leadId !== 'string' || !body.leadId.trim() || body.leadId.length > 200 ||
    typeof body.message !== 'string' || !body.message.trim() || body.message.trim().length > 1_024
  ) return undefined

  return { leadId: body.leadId.trim(), message: body.message.trim() }
}

function normalizeBrazilianPhone(phone: string): string | undefined {
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return undefined
}

export async function sendWhatsAppTemplateForLead(
  store: SupabaseStore,
  accessToken: string,
  userId: string,
  leadId: string,
  message: string,
): Promise<{ messageId: string; logSaved: boolean }> {
  const savedLead = await store.getSavedLeadState(accessToken, userId, leadId)
  if (!savedLead) {
    throw new WhatsAppSendFlowError('Salve este lead antes de enviar pela API do WhatsApp.', 404)
  }
  if (savedLead.whatsappConsentStatus === 'opted_out') {
    throw new WhatsAppSendFlowError('Este contato pediu para não receber mensagens. O envio está bloqueado.', 403)
  }
  if (
    savedLead.whatsappConsentStatus !== 'opted_in' ||
    !savedLead.whatsappConsentSource?.trim() ||
    !savedLead.whatsappConsentAt ||
    !Number.isFinite(Date.parse(savedLead.whatsappConsentAt)) ||
    Date.parse(savedLead.whatsappConsentAt) > Date.now()
  ) {
    throw new WhatsAppSendFlowError('Registre a autorização explícita deste contato antes de enviar.', 403)
  }
  if (!savedLead.lead) {
    throw new WhatsAppSendFlowError('Atualize os dados deste lead salvo antes de enviar.', 409)
  }

  const phone = normalizeBrazilianPhone(savedLead.lead.phone)
  if (!phone) {
    throw new WhatsAppSendFlowError('O telefone salvo não está em um formato brasileiro válido.', 422)
  }

  const config = getWhatsAppCloudConfig()
  if (!config) {
    throw new WhatsAppSendFlowError('Configure a WhatsApp Cloud API e o template aprovado no backend.', 503)
  }

  let messageId: string
  try {
    messageId = await sendApprovedTemplateMessage(config, phone, message)
  } catch (error) {
    if (error instanceof WhatsAppCloudApiError) {
      throw new WhatsAppSendFlowError(error.message, error.status === 429 ? 429 : 502)
    }
    throw error
  }

  let logSaved = true
  try {
    await store.createLeadInteraction(accessToken, userId, leadId, {
      channel: 'WhatsApp',
      occurredAt: new Date().toISOString().slice(0, 10),
      notes: `Template ${config.templateName} aceito pela API oficial do WhatsApp. ID: ${messageId}`,
      outcome: 'Aceita pela API oficial',
    })
  } catch {
    logSaved = false
  }

  return { messageId, logSaved }
}
