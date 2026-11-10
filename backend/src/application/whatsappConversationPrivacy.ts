export type WhatsAppConversationMessage = {
  direction: 'inbound' | 'outbound'
  body: string | null
}

const privateTopicPattern = /\b(?:minha saude|meu estado de saude|problema de saude pessoal|condicao de saude pessoal|meu diagnostico|meus sintomas|sintomas pessoais|meu tratamento|tratamento medico|meus remedios|minha medicacao|medicacao|medicamentos|minha doenca|minha condicao medica|consulta medica|minha cirurgia|aconselhamento juridico pessoal|meu problema juridico|minha situacao juridica|processo judicial proprio|aconselhamento financeiro pessoal|orientacao financeira pessoal|minhas financas pessoais|minha situacao financeira pessoal|estou endividado[oa]?|minha divida pessoal|meus dados bancarios|dados bancarios|conta bancaria|conta corrente|conta poupanca|numero da conta|dados de pagamento pessoais|minha agencia bancaria|meu rg|numero do rg|minha identidade|meu passaporte|numero do passaporte|data de nascimento|dia do meu nascimento|nasci em|meu endereco residencial|meu endereco de casa|endereco da minha casa|onde eu moro|moro na rua|moro na avenida|minha casa fica|senha|codigo de autenticacao|codigo de seguranca|codigo sms|2fa)\b/i
const cpfPattern = /\b(?:cpf\s*[:=]?\s*)?\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d{2}\b/i
const personalDocumentPattern = /\b(?:rg|identidade|passaporte)\s*(?:numero|n[.ºo])?\s*[:#=-]?\s*[a-z0-9.-]{5,}\b/i
const dateOfBirthPattern = /\b(?:data de nascimento|nasc(?:i|ido|ida) em|meu aniversario e|nasceu em)\s*[:=]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/i
const personalAddressPattern = /\b(?:meu endereco|endereco residencial|minha casa fica|moro na (?:rua|avenida|av\.?|travessa|alameda|estrada|rodovia)|resido na (?:rua|avenida|av\.?|travessa|alameda|estrada|rodovia))\b/i
const personalBankPattern = /\b(?:agencia|ag\.?|conta(?: corrente| poupanca)?|banco)\s*(?:numero|n[.ºo])?\s*[:#=-]?\s*\d{3,}\b/i
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const phonePattern = /(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}(?!\d)/g
const cardPattern = /\b(?:\d[ -]?){13,19}\b/

function normalize(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR')
}

export function sanitizeWhatsAppHistoryForGemini(messages: WhatsAppConversationMessage[]) {
  return messages.slice(-20).map((message) => {
    const body = message.body
    if (!body) return message
    const normalized = normalize(body)
    if (
      privateTopicPattern.test(normalized) || cpfPattern.test(body) || cardPattern.test(body) ||
      personalDocumentPattern.test(normalized) || dateOfBirthPattern.test(normalized) ||
      personalAddressPattern.test(normalized) || personalBankPattern.test(normalized)
    ) {
      return { ...message, body: '[mensagem omitida por conter dado pessoal ou sensível]' }
    }

    return {
      ...message,
      body: body.replace(emailPattern, '[e-mail ocultado]').replace(phonePattern, '[telefone ocultado]'),
    }
  })
}
