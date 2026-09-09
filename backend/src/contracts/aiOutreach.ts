import { opportunityTypes, type OpportunityType } from './lead.js'

export const outreachTones = ['Profissional', 'Direto', 'Informal'] as const
export type OutreachTone = (typeof outreachTones)[number]

export type GenerateOutreachInput = {
  businessName: string
  category: string
  opportunity: OpportunityType
  diagnosis: string
  service: string
  tone: OutreachTone
}

export type GeneratedOutreach = {
  salesArgument: string
  whatsappMessage: string
  followUpMessage: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requiredText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text && text.length <= maxLength ? text : undefined
}

export function parseGenerateOutreachInput(value: unknown): GenerateOutreachInput | undefined {
  if (!isRecord(value)) return undefined

  const businessName = requiredText(value.businessName, 160)
  const category = requiredText(value.category, 160)
  const diagnosis = requiredText(value.diagnosis, 600)
  const service = requiredText(value.service, 120)

  if (
    !businessName ||
    !category ||
    !diagnosis ||
    !service ||
    !opportunityTypes.includes(value.opportunity as OpportunityType) ||
    !outreachTones.includes(value.tone as OutreachTone)
  ) {
    return undefined
  }

  return {
    businessName,
    category,
    diagnosis,
    service,
    opportunity: value.opportunity as OpportunityType,
    tone: value.tone as OutreachTone,
  }
}

export function parseGeneratedOutreach(value: unknown): GeneratedOutreach | undefined {
  if (!isRecord(value)) return undefined

  const salesArgument = requiredText(value.salesArgument, 700)
  const whatsappMessage = requiredText(value.whatsappMessage, 900)
  const followUpMessage = requiredText(value.followUpMessage, 700)

  if (!salesArgument || !whatsappMessage || !followUpMessage) return undefined
  return { salesArgument, whatsappMessage, followUpMessage }
}
