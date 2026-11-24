import type { WhatsAppAutomationResponseMode } from '../contracts/whatsappAutomation.js'

export type WhatsAppAutomationReplyPlan = 'gemini' | 'openbot' | 'digibot_agent' | 'openclaw' | 'handoff'

export function selectWhatsAppAutomationReplyPlan(input: {
  responseMode: WhatsAppAutomationResponseMode
  shouldHandoff: boolean
  geminiConfigured: boolean
  agentConfigured?: boolean
}): WhatsAppAutomationReplyPlan {
  if (input.responseMode === 'openclaw') return 'openclaw'
  if (input.responseMode === 'handoff_only' || input.shouldHandoff) return 'handoff'
  if (input.responseMode === 'openbot') return 'openbot'
  if (input.responseMode === 'digibot_agent') return input.agentConfigured ? 'digibot_agent' : 'handoff'
  if (!input.geminiConfigured) return 'handoff'
  return 'gemini'
}
