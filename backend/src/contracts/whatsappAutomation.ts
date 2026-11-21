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

export const whatsappAutomationResponseModes = ['handoff_only', 'gemini', 'openbot', 'digibot_agent'] as const

export type WhatsAppAutomationResponseMode = (typeof whatsappAutomationResponseModes)[number]
export const whatsappAgentProviders = ['google', 'anthropic', 'openai-compatible'] as const
export type WhatsAppAgentProvider = (typeof whatsappAgentProviders)[number]

export type WhatsAppAutomationProfileInput = {
  phoneNumberId: string
  businessName: string
  senderIdentity: string
  serviceSummary: string
  approvedFacts: string
  escalationContact: string
  responseMode: WhatsAppAutomationResponseMode
  openBotAgentId: string
  agentProvider: WhatsAppAgentProvider
  agentModel: string
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
  const responseMode = candidate.responseMode === undefined ? 'handoff_only' : candidate.responseMode
  const openBotAgentId = candidate.openBotAgentId === undefined ? '' : boundedText('openBotAgentId', 128)
  const agentProvider = candidate.agentProvider === undefined ? 'google' : candidate.agentProvider
  const agentModel = candidate.agentModel === undefined ? 'gemini-4-hydrogen' : boundedText('agentModel', 128)
  const automationEnabled = candidate.automationEnabled
  const channelApproved = candidate.channelApproved
  const contentApproved = candidate.contentApproved
  const businessName = boundedText('businessName', 120)
  const senderIdentity = boundedText('senderIdentity', 120)
  const serviceSummary = boundedText('serviceSummary', 1_500)
  const approvedFacts = boundedText('approvedFacts', 2_000)
  const escalationContact = boundedText('escalationContact', 180)

  if (
    typeof phoneNumberId !== 'string' || !/^[-_a-zA-Z0-9]{1,128}$/.test(phoneNumberId) ||
    businessName === undefined || senderIdentity === undefined || serviceSummary === undefined ||
    approvedFacts === undefined || escalationContact === undefined ||
    openBotAgentId === undefined ||
    agentModel === undefined || !whatsappAgentProviders.includes(agentProvider as WhatsAppAgentProvider) ||
    !/^[A-Za-z0-9_.:/-]{1,128}$/.test(agentModel) ||
    (responseMode !== 'handoff_only' && responseMode !== 'gemini' && responseMode !== 'openbot' && responseMode !== 'digibot_agent') ||
    typeof automationEnabled !== 'boolean' || typeof channelApproved !== 'boolean' ||
    typeof contentApproved !== 'boolean'
  ) return undefined

  if (automationEnabled && (
    !businessName || !senderIdentity || !serviceSummary || !escalationContact ||
    !channelApproved || !contentApproved || (responseMode === 'openbot' && !/^[A-Za-z0-9_-]{1,128}$/.test(openBotAgentId))
  )) return undefined

  return {
    phoneNumberId,
    businessName,
    senderIdentity,
    serviceSummary,
    approvedFacts,
    escalationContact,
    responseMode,
    openBotAgentId,
    agentProvider: agentProvider as WhatsAppAgentProvider,
    agentModel,
    automationEnabled,
    channelApproved,
    contentApproved,
  }
}
