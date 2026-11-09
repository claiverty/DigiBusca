import type { WhatsAppAutomationResponseMode } from '../contracts/whatsappAutomation.js'

export type WhatsAppAutomationReplyPlan = 'gemini' | 'handoff'

export function selectWhatsAppAutomationReplyPlan(input: {
  responseMode: WhatsAppAutomationResponseMode
  shouldHandoff: boolean
  geminiConfigured: boolean
}): WhatsAppAutomationReplyPlan {
  if (input.responseMode === 'handoff_only' || input.shouldHandoff || !input.geminiConfigured) return 'handoff'
  return 'gemini'
}
