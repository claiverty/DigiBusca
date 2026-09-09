export const outreachTones = ['Profissional', 'Direto', 'Informal'] as const
export type OutreachTone = (typeof outreachTones)[number]

export const websiteStatuses = ['listed', 'not_listed'] as const
export type WebsiteStatus = (typeof websiteStatuses)[number]

export const googleProfileStatuses = ['complete', 'incomplete'] as const
export type GoogleProfileStatus = (typeof googleProfileStatuses)[number]

export type GenerateOutreachInput = {
  businessName: string
  category: string
  websiteStatus: WebsiteStatus
  googleProfileStatus: GoogleProfileStatus
  service: string
  tone: OutreachTone
}

export type LeadType =
  | 'NO_WEBSITE'
  | 'INCOMPLETE_GOOGLE_PROFILE'
  | 'NO_CLEAR_OPPORTUNITY'

export type PrimaryOpportunity = 'website' | 'google_profile' | 'general_outreach'
export type AnalysisConfidence = 'high' | 'medium' | 'low'

export type LeadData = {
  companyName: string
  industry: string
  language: 'pt-BR'
  websiteStatus: WebsiteStatus
  googleProfileStatus: GoogleProfileStatus
  source: 'google_maps'
}

export type LeadAnalysis = {
  leadType: LeadType
  primaryOpportunity: PrimaryOpportunity
  secondaryOpportunities: PrimaryOpportunity[]
  confidence: AnalysisConfidence
  evidence: string[]
}

export type CampaignConfig = {
  language: 'pt-BR'
  country: 'BR'
  channel: 'whatsapp'
  service: string
  senderVoice: 'individual'
  tone: 'natural_professional' | 'direct' | 'informal'
  ctaLevel: 'low_commitment'
}

export type ApproachStrategy = {
  approach: 'OBSERVATION_QUESTION' | 'RESPECTFUL_EXPLORATION'
  mentionCompanyName: true
  mentionPersonName: false
  mentionProblemDirectly: false
  salesPressure: 'low'
}

export type OutreachContext = {
  leadData: LeadData
  leadAnalysis: LeadAnalysis
  campaignConfig: CampaignConfig
  approachStrategy: ApproachStrategy
}

export type GeneratedOutreachCopy = {
  salesArgument: string
  whatsappMessage: string
  followUpMessage: string
}

export type GeneratedOutreach = GeneratedOutreachCopy & {
  analysis: LeadAnalysis
  generationSource: 'ai' | 'safe_template'
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
  const service = requiredText(value.service, 120)

  if (
    !businessName ||
    !category ||
    !service ||
    !websiteStatuses.includes(value.websiteStatus as WebsiteStatus) ||
    !googleProfileStatuses.includes(value.googleProfileStatus as GoogleProfileStatus) ||
    !outreachTones.includes(value.tone as OutreachTone)
  ) {
    return undefined
  }

  return {
    businessName,
    category,
    service,
    websiteStatus: value.websiteStatus as WebsiteStatus,
    googleProfileStatus: value.googleProfileStatus as GoogleProfileStatus,
    tone: value.tone as OutreachTone,
  }
}

export function parseGeneratedOutreachCopy(value: unknown): GeneratedOutreachCopy | undefined {
  if (!isRecord(value)) return undefined

  const salesArgument = requiredText(value.salesArgument, 2_000)
  const whatsappMessage = requiredText(value.whatsappMessage, 2_000)
  const followUpMessage = requiredText(value.followUpMessage, 2_000)

  if (!salesArgument || !whatsappMessage || !followUpMessage) return undefined
  return { salesArgument, whatsappMessage, followUpMessage }
}
