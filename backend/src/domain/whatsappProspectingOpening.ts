function businessProfile(businessName: string) {
  const safeName = businessName.trim().replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').slice(0, 100)
  return safeName ? `o perfil de ${safeName}` : 'o perfil do negócio de vocês'
}

export function buildWhatsAppProspectingOpening(businessName: string, variant = 0) {
  const subject = businessProfile(businessName)
  const openings = [
    `Oi, tudo bem? Aqui é o Cristhian, da DigiUP. Vi ${subject} no Google e queria saber se vocês já têm um site próprio.`,
    `Opa, tudo bem? Sou o Cristhian, da DigiUP. Encontrei ${subject} no Google. Vocês têm um site próprio hoje?`,
    'Oi, aqui é o Cristhian da DigiUP. Achei vocês pelo Google. Vocês já têm um site?',
  ]
  return openings[Math.abs(Math.trunc(variant)) % openings.length]
}

export function resolveWhatsAppProspectingOpening(businessName: string, draft?: string | null, variant = 0) {
  const message = draft?.trim()
  const previousOpening = `Oi, aqui é o Cristhian, da DigiUP. Vi ${businessProfile(businessName)} no Google e fiquei com uma dúvida: vocês já têm um site?`
  if (message === previousOpening) return buildWhatsAppProspectingOpening(businessName, 2)
  return message || buildWhatsAppProspectingOpening(businessName, variant)
}
