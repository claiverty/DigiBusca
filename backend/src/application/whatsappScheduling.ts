export type WhatsAppConversationText = {
  direction: 'inbound' | 'outbound'
  body: string | null
}

export type WhatsAppSchedulingReply = {
  replyText: string
  requiresAvailabilityCheck: true
}

function normalizeMessage(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim()
}

const scheduleActionPattern = /\b(?:marcar|agendar|reservar|combinar)\b/i
const meetingPattern = /\b(?:reuniao|conversa|chamada|ligacao|call|diagnostico)\b/i
const dateOrTimePattern = /\b(?:hoje|amanha|segunda(?: feira)?|terca(?: feira)?|quarta(?: feira)?|quinta(?: feira)?|sexta(?: feira)?|sabado|domingo|dia\s+\d{1,2}|as\s+\d{1,2}(?:\s*h(?:\s*\d{1,2})?|\s*:\s*\d{2})?|pela\s+manha|a\s+tarde|a\s+noite)\b/i
const projectFeaturePattern = /\b(?:sistema|aplicativo|app|plataforma|software|funcionalidade|site|landing page|loja virtual)\b/i
const scheduleAvailabilityQuestionPattern = /\b(?:tem|ha|existe)\b.{0,32}\b(?:horario|agenda|disponibilidade)\b/i
const appointmentInvitationPattern = /\b(?:marc(?:ar|armos)|agend(?:ar|armos)|reuniao|conversa|diagnostico)\b/i

export function getWhatsAppSchedulingReply(messages: WhatsAppConversationText[]): WhatsAppSchedulingReply | undefined {
  let latestInboundIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.direction === 'inbound' && messages[index]?.body?.trim()) {
      latestInboundIndex = index
      break
    }
  }
  if (latestInboundIndex < 0) return undefined

  const latestInbound = normalizeMessage(messages[latestInboundIndex]?.body ?? '')
  const hasExplicitAppointmentRequest = scheduleActionPattern.test(latestInbound)
    && (meetingPattern.test(latestInbound)
      || dateOrTimePattern.test(latestInbound) && !projectFeaturePattern.test(latestInbound))
  const hasPriorAppointmentInvitation = messages.slice(0, latestInboundIndex)
    .filter((message) => message.direction === 'outbound' && message.body)
    .slice(-3)
    .some((message) => appointmentInvitationPattern.test(normalizeMessage(message.body ?? '')))
  const respondsToAppointmentInvitation = hasPriorAppointmentInvitation
    && (scheduleActionPattern.test(latestInbound) || scheduleAvailabilityQuestionPattern.test(latestInbound))

  if (!hasExplicitAppointmentRequest && !respondsToAppointmentInvitation) return undefined

  const hasRequestedTime = dateOrTimePattern.test(latestInbound)
  return {
    replyText: hasRequestedTime
      ? 'Vou conferir esse horário e te confirmo por aqui'
      : 'Que dia e horário seriam melhores? Vou conferir e te confirmo por aqui',
    requiresAvailabilityCheck: true,
  }
}
