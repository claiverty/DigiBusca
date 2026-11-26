function cleanBusinessName(businessName: string) {
  return businessName.trim().replace(/\s+/g, ' ').slice(0, 100)
}

export function buildWhatsAppProspectingOpening(businessName: string, variant = 0) {
  const name = cleanBusinessName(businessName)
  const openings = [
    `Oi, aqui é o Cristhian da DigiUP. Encontrei ${name || 'vocês'} pelo Google. A gente cria sites pra mostrar os serviços do negócio e facilitar o contato pelo WhatsApp. Posso te mostrar um exemplo?`,
    'Opa, tudo bem? Sou o Cristhian da DigiUP. Vi a ficha de vocês no Google. A gente monta sites pra reunir serviços e informações num lugar só, com um botão pra chamar no WhatsApp. Faz sentido eu te mostrar como ficaria?',
    'Oi, aqui é o Cristhian da DigiUP. Achei vocês pelo Google. A gente faz sites pra quem quer mostrar melhor o que oferece e facilitar o contato com novos clientes pelo WhatsApp. Quer ver um exemplo?',
  ]
  return openings[Math.abs(Math.trunc(variant)) % openings.length]
}

export function resolveWhatsAppProspectingOpening(businessName: string, draft?: string | null, variant = 0) {
  const message = draft?.trim()
  if (!message) return buildWhatsAppProspectingOpening(businessName, variant)

  const name = cleanBusinessName(businessName)
  const subject = name ? `o perfil de ${name}` : 'o perfil do negócio de vocês'
  const previousOpenings = [
    `Oi, tudo bem? Aqui é o Cristhian, da DigiUP. Vi ${subject} no Google e queria saber se vocês já têm um site próprio.`,
    `Opa, tudo bem? Sou o Cristhian, da DigiUP. Encontrei ${subject} no Google. Vocês têm um site próprio hoje?`,
    'Oi, aqui é o Cristhian da DigiUP. Achei vocês pelo Google. Vocês já têm um site?',
  ]
  const previousVariant = previousOpenings.indexOf(message)
  if (previousVariant !== -1) return buildWhatsAppProspectingOpening(businessName, previousVariant)

  const originalOpening = `Oi, aqui é o Cristhian, da DigiUP. Vi ${subject} no Google e fiquei com uma dúvida: vocês já têm um site?`
  if (message === originalOpening) return buildWhatsAppProspectingOpening(businessName, 2)
  return message
}
