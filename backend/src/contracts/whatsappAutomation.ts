export const whatsappAutomationStages = [
  'identify_responsible',
  'request_permission',
  'understand_scenario',
  'explore_need',
  'present_idea',
  'qualify_interest',
  'present_conditions',
  'confirm_decision',
  'closed',
] as const

export type WhatsAppAutomationStage = (typeof whatsappAutomationStages)[number]

export type WhatsAppAutomationProfileInput = {
  phoneNumberId: string
  businessName: string
  senderIdentity: string
  serviceSummary: string
  approvedFacts: string
  escalationContact: string
  automationEnabled: boolean
  channelApproved: boolean
  contentApproved: boolean
}

export type WhatsAppAutomationProfile = Omit<WhatsAppAutomationProfileInput,
  'channelApproved' | 'contentApproved'> & {
  channelApprovedAt: string | null
  contentApprovedAt: string | null
  updatedAt: string
}

export function parseWhatsAppAutomationProfileInput(value: unknown): WhatsAppAutomationProfileInput | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  const boundedText = (key: string, max: number) => {
    const field = candidate[key]
    return typeof field === 'string' && field.length <= max ? field.trim() : undefined
  }
  const phoneNumberId = candidate.phoneNumberId
  const automationEnabled = candidate.automationEnabled
  const channelApproved = candidate.channelApproved
  const contentApproved = candidate.contentApproved
  const businessName = boundedText('businessName', 120)
  const senderIdentity = boundedText('senderIdentity', 120)
  const serviceSummary = boundedText('serviceSummary', 1_500)
  const approvedFacts = boundedText('approvedFacts', 2_000)
  const escalationContact = boundedText('escalationContact', 180)

  if (
    typeof phoneNumberId !== 'string' || !/^\d{1,128}$/.test(phoneNumberId) ||
    businessName === undefined || senderIdentity === undefined || serviceSummary === undefined ||
    approvedFacts === undefined || escalationContact === undefined ||
    typeof automationEnabled !== 'boolean' || typeof channelApproved !== 'boolean' ||
    typeof contentApproved !== 'boolean'
  ) return undefined

  if (automationEnabled && (
    !businessName || !senderIdentity || !serviceSummary || !escalationContact ||
    !channelApproved || !contentApproved
  )) return undefined

  return {
    phoneNumberId,
    businessName,
    senderIdentity,
    serviceSummary,
    approvedFacts,
    escalationContact,
    automationEnabled,
    channelApproved,
    contentApproved,
  }
}
