export const interactionChannels = ['WhatsApp', 'Telefone', 'E-mail', 'Outro'] as const
export type InteractionChannel = (typeof interactionChannels)[number]

export type LeadInteraction = {
  id: string
  leadId: string
  channel: InteractionChannel
  occurredAt: string
  notes: string
  outcome?: string
  createdAt: string
}

export type CreateLeadInteractionInput = Pick<LeadInteraction, 'channel' | 'occurredAt' | 'notes'> & {
  outcome?: string
}
