import type { WhatsAppAutomationResponseMode } from '../contracts/whatsappAutomation.js'

export type WhatsAppAutomationReplyPlan = 'gemini' | 'openbot' | 'handoff'

export function selectWhatsAppAutomationReplyPlan(input: {
  responseMode: WhatsAppAutomationResponseMode
  shouldHandoff: boolean
  geminiConfigured: boolean
}): WhatsAppAutomationReplyPlan {
  if (input.responseMode === 'handoff_only' || input.shouldHandoff) return 'handoff'
  if (input.responseMode === 'openbot') return 'openbot'
  if (!input.geminiConfigured) return 'handoff'
  return 'gemini'
}
