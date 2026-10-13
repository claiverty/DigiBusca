import type { Lead } from '../types'
import { buildOutreachContext, createSafeOutreachTemplate } from '../../../backend/src/domain/outreachPipeline'

export function createApproachMessage(lead: Lead): string {
  const hour = new Date().getHours()
  const context = buildOutreachContext({ businessName: lead.name, category: lead.category, websiteStatus: lead.website ? 'listed' : 'not_listed', googleProfileStatus: 'complete', service: 'sites e presença digital', tone: 'Informal', stage: 'Abertura', greeting: hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite' })
  return createSafeOutreachTemplate(context).whatsappMessage
}
