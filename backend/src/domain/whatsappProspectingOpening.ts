export function buildWhatsAppProspectingOpening(businessName: string, variant = 0) {
  const safeName = businessName.trim().replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').slice(0, 100)
  const subject = safeName ? `o perfil de ${safeName}` : 'o perfil do negócio de vocês'
  const openings = [
    `Oi, tudo bem? Aqui é o Cristhian, da DigiUP. Vi ${subject} no Google e queria saber se vocês já têm um site próprio.`,
    `Opa, tudo bem? Sou o Cristhian, da DigiUP. Encontrei ${subject} no Google. Vocês têm um site próprio hoje?`,
    `Oi, aqui é o Cristhian, da DigiUP. Vi ${subject} no Google e fiquei com uma dúvida: vocês já têm um site?`,
  ]
  return openings[Math.abs(Math.trunc(variant)) % openings.length]
}
