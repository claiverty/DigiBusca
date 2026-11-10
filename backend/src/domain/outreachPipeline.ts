import type {
  ApproachStrategy,
  CampaignConfig,
  GenerateOutreachInput,
  GeneratedOutreachCopy,
  LeadAnalysis,
  LeadData,
  OutreachContext,
} from '../contracts/aiOutreach.js'

const forbiddenClaims = [
  'perdendo clientes',
  'perdendo dinheiro',
  'ficando para trás',
  'resultados garantidos',
  'dominar o mercado',
  'revolucionar sua empresa',
  'analisamos sua empresa',
  'analisei sua empresa',
  'auditei',
  'detectei falhas',
]

function normalizedText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}

export function normalizeLeadData(input: GenerateOutreachInput): LeadData {
  return {
    companyName: input.businessName,
    industry: input.category,
    language: 'pt-BR',
    websiteStatus: input.websiteStatus,
    googleProfileStatus: input.googleProfileStatus,
    source: 'google_maps',
  }
}

export function analyzeLead(leadData: LeadData): LeadAnalysis {
  if (leadData.websiteStatus === 'not_listed') {
    return {
      leadType: 'NO_WEBSITE',
      primaryOpportunity: 'website',
      secondaryOpportunities: [],
      confidence: 'high',
      evidence: ['Nenhum site foi informado nos dados públicos do perfil do Google.'],
    }
  }

  if (leadData.googleProfileStatus === 'incomplete') {
    return {
      leadType: 'INCOMPLETE_GOOGLE_PROFILE',
      primaryOpportunity: 'google_profile',
      secondaryOpportunities: [],
      confidence: 'medium',
      evidence: ['O perfil do Google não apresenta todos os dados públicos esperados.'],
    }
  }

  return {
    leadType: 'NO_CLEAR_OPPORTUNITY',
    primaryOpportunity: 'general_outreach',
    secondaryOpportunities: [],
    confidence: 'low',
    evidence: ['Há um site informado e não existem dados suficientes para avaliar sua qualidade.'],
  }
}

export function buildCampaignConfig(input: GenerateOutreachInput): CampaignConfig {
  const toneMap: Record<GenerateOutreachInput['tone'], CampaignConfig['tone']> = {
    Profissional: 'natural_professional',
    Direto: 'direct',
    Informal: 'informal',
  }

  return {
    language: 'pt-BR',
    country: 'BR',
    channel: 'whatsapp',
    service: input.service,
    senderVoice: 'individual',
    tone: toneMap[input.tone],
    ctaLevel: 'low_commitment',
  }
}

export function chooseApproachStrategy(analysis: LeadAnalysis): ApproachStrategy {
  return {
    approach: analysis.leadType === 'NO_CLEAR_OPPORTUNITY'
      ? 'RESPECTFUL_EXPLORATION'
      : 'OBSERVATION_QUESTION',
    mentionCompanyName: true,
    mentionPersonName: false,
    mentionProblemDirectly: false,
    salesPressure: 'low',
  }
}

export function buildOutreachContext(input: GenerateOutreachInput): OutreachContext {
  const leadData = normalizeLeadData(input)
  const leadAnalysis = analyzeLead(leadData)
  const senderName = (input.senderName ?? '').replace(/(?:,\s*|\s+)da DigiUP$/i, '').trim()
  return {
    leadData,
    leadAnalysis,
    campaignConfig: buildCampaignConfig(input),
    approachStrategy: chooseApproachStrategy(leadAnalysis),
    conversation: {
      stage: hasExplicitRefusal(input.lastReply ?? '') ? 'Encerrar' : input.stage ?? 'Abertura',
      lastReply: input.lastReply ?? '',
      senderName,
      greeting: input.greeting ?? 'Oi',
      offerDetails: input.offerDetails?.trim() ?? '',
    },
  }
}

export function hasExplicitRefusal(reply: string): boolean {
  return /\b(nao (?:tenho|temos) interesse|sem interesse|nao (?:quero|queremos|preciso|precisamos)|nao (?:me |nos )?(?:mande|envie|contate)|pare de|remova (?:meu|nosso) contato)\b/.test(normalizedText(reply))
}

export function validateGeneratedOutreach(
  copy: GeneratedOutreachCopy,
  context: OutreachContext,
): string[] {
  const issues: string[] = []
  const initial = normalizedText(copy.whatsappMessage)
  const allText = normalizedText(`${copy.whatsappMessage} ${copy.followUpMessage} ${copy.salesArgument}`)
  const customerFacingText = normalizedText(`${copy.whatsappMessage} ${copy.followUpMessage}`)

  if (copy.whatsappMessage.length > 500) issues.push('A mensagem inicial ultrapassa 500 caracteres.')
  if (copy.followUpMessage.length > 320) issues.push('O follow-up ultrapassa 320 caracteres.')
  if (copy.salesArgument.length > 350) issues.push('O argumento ultrapassa 350 caracteres.')
  const opening = initial
  if (context.conversation.stage === 'Abertura' && (!/^(?:oi|ola|bom dia|boa tarde|boa noite)\b/.test(opening) || copy.whatsappMessage.length > 220)) {
    issues.push('A abertura deve começar com uma saudação natural e ter no máximo 220 caracteres.')
  }
  if (context.conversation.stage === 'Abertura' && !/\b(?:falo com|voce cuida|quem cuida|responsavel pela)\b/.test(initial)) {
    issues.push('A abertura deve confirmar se o contato cuida da presença digital.')
  }
  if (
    context.conversation.stage === 'Abertura' && context.conversation.senderName &&
    !initial.includes(normalizedText(context.conversation.senderName))
  ) issues.push('A abertura deve apresentar o nome informado para quem envia.')
  const personalizedGreeting = initial.match(/^(?:oi|ola),\s+(?!aqui\b)([\p{Letter}]+)/u)?.[1]
  const knownNames = [normalizedText(context.conversation.senderName), normalizedText(context.leadData.companyName)]
  if (
    context.conversation.stage === 'Abertura' && personalizedGreeting && !['bom', 'boa'].includes(personalizedGreeting) &&
    !knownNames.some((name) => name && name.split(/\s+/).includes(personalizedGreeting))
  ) issues.push('A abertura usa um nome que não foi fornecido.')
  if (context.conversation.stage === 'Abertura' && /\b(?:proposta|oferta|preco|valor|desconto|orcamento|parcelamento)\b/.test(initial)) {
    issues.push('A abertura antecipa condições comerciais.')
  }
  if (context.conversation.stage === 'Abertura' && !hasExplicitRefusal(context.conversation.lastReply) && !copy.whatsappMessage.trim().endsWith('?')) issues.push('A abertura deve confirmar o responsável com uma pergunta.')
  if ((copy.whatsappMessage.match(/\?/g)?.length ?? 0) > 1) issues.push('A mensagem deve fazer no máximo uma pergunta por vez.')
  if (/https?:\/\/|www\./i.test(allText)) issues.push('A resposta contém uma URL.')
  if (/\b(vimos|encontramos|trabalhamos|nossa equipe)\b/.test(allText)) {
    issues.push('A resposta usa voz de equipe.')
  }
  if (forbiddenClaims.some((claim) => allText.includes(normalizedText(claim)))) {
    issues.push('A resposta contém uma afirmação comercial proibida.')
  }

  if (/\b(?:nao tem|nao possuem?|nao existe)(?: um)?\s+site\b|\bsem(?: um)?\s+site\b/.test(initial) && !/perfil|google/.test(initial)) issues.push('A resposta afirma que a empresa não possui site.')

  if (context.leadAnalysis.leadType === 'NO_WEBSITE' && /nao encontrei|nao localizei|nao identifiquei|nao consta|nao aparece|nao foi informado/.test(initial)) {
    const hasScopedSiteObservation = /\bsite\b/.test(initial)
      && /\b(informado|vinculado|cadastrado|listado|const[aá])\b/.test(initial)
      && /\b(perfil|google)\b/.test(initial)
    const assertsNoWebsite = /\b(?:nao tem|nao possuem?|nao existe)(?: um)?\s+site\b|\bsem(?: um)?\s+site\b/.test(initial)
    if (assertsNoWebsite && !hasScopedSiteObservation) {
      issues.push('A resposta afirma que a empresa não possui site.')
    }
    const reportsSearchResult = /\b(nao encontrei|nao localizei|nao identifiquei|nao consta|nao aparece|nao foi informado|nao esta informado)\b/.test(initial)
      || /\bnao tem (?:um )?site informado\b/.test(initial)
    const describesPublicListing = hasScopedSiteObservation
    if (!reportsSearchResult || !describesPublicListing) {
      issues.push('A observação sobre o site não está formulada de maneira factual.')
    }
  }

  if (context.conversation.stage === 'Identificar responsável' && /\b(proposta|ofereco|oferecer|trabalho com|vender|compra)\b/.test(initial)) issues.push('A identificação do responsável antecipa uma oferta.')
  if (
    !context.conversation.offerDetails &&
    /\br\$\s*\d|\b\d+(?:[.,]\d+)?\s*(?:reais|parcelas|x)\b|\b(?:a vista|parcel\w*|desconto|entrada|cartao|taxa)\b/.test(customerFacingText)
  ) issues.push('A resposta apresenta condições comerciais que não foram informadas.')
  if (hasExplicitRefusal(context.conversation.lastReply) && /\?|\b(mas|porem|insistir|oferta|proposta)\b/.test(initial)) issues.push('A resposta não respeita a recusa.')
  return issues
}

export function createSafeOutreachTemplate(context: OutreachContext): GeneratedOutreachCopy {
  const { service } = context.campaignConfig
  const { stage, senderName, greeting, offerDetails } = context.conversation
  const introduction = senderName ? `Aqui é o ${senderName} da DigiUP. ` : 'Aqui é da DigiUP. '
  const lastReply = normalizedText(context.conversation.lastReply)
  const redirectedToOtherResponsible = /\b(?:nao sou eu|nao sou (?:a )?pessoa responsavel|nao sou responsavel|nao cuido|outra pessoa|minha socia|meu socio|fale com|procure (?:o|a))\b/.test(lastReply)
  const confirmedResponsible = !redirectedToOtherResponsible
    && /\b(?:sou eu|eu que cuido|comigo|sim[,! ]|sou responsavel|sou a responsavel|sou o responsavel)\b/.test(lastReply)
  const openingGreeting = greeting === 'Oi' ? 'Oi' : greeting
  const messages: Record<typeof stage, string> = {
    'Abertura': `${openingGreeting}, ${senderName ? `aqui é o ${senderName} da DigiUP` : 'aqui é da DigiUP'}. Você cuida da presença digital da empresa?`,
    'Identificar responsável': confirmedResponsible
      ? `${introduction}Queria entender como vocês apresentam os serviços online hoje`
      : redirectedToOtherResponsible
        ? 'Entendi, você consegue me indicar quem cuida dessa parte?'
        : `${introduction}Você cuida da divulgação e da presença digital da empresa?`,
    'Pedir permissão': `${introduction}Queria entender como vocês apresentam os serviços e recebem contatos hoje. Posso te perguntar uma coisa?`,
    'Entender cenário': 'Hoje vocês usam mais o Instagram e o WhatsApp para apresentar os serviços e receber contatos ou também usam um site?',
    'Explorar necessidade': 'Esse formato funciona bem para vocês ou tem alguma coisa que gostariam de mudar?',
    'Apresentar ideia': `Pelo que você contou, ${service} pode fazer sentido para esse objetivo. Quer que eu explique como poderia funcionar?`,
    'Qualificar interesse': 'O que seria mais importante para esse projeto?',
    'Responder dúvida': 'Qual ponto você quer entender melhor?',
    'Apresentar condições': offerDetails
      ? `A opção definida é ${offerDetails}. Faz sentido para vocês?`
      : 'O que deve entrar nessa opção para eu confirmar as condições?',
    'Confirmar decisão': offerDetails
      ? `Combinamos estas condições: ${offerDetails}. Quer seguir com essa opção?`
      : 'Qual ponto ainda precisa de confirmação?',
    'Retomar contato': 'Oi, podemos continuar a conversa por aqui?',
    'Encerrar': 'Tá bem, obrigado por me responder',
  }
  const salesArgument = stage === 'Apresentar condições'
    ? 'Apresente somente o escopo e as condições informadas. Não invente preço, prazo, desconto ou forma de pagamento.'
    : stage === 'Confirmar decisão'
      ? 'Confirme a intenção sem presumir aceite. Registre o próximo passo e só marque a venda depois de um acordo explícito.'
      : `Entenda o cenário e a necessidade antes de apresentar ${service}. Os dados públicos não comprovam problemas nem resultados futuros.`
  return {
    whatsappMessage: hasExplicitRefusal(context.conversation.lastReply) ? messages['Encerrar'] : messages[stage],
    followUpMessage: stage === 'Encerrar' || hasExplicitRefusal(context.conversation.lastReply) ? messages['Encerrar'] : messages['Retomar contato'],
    salesArgument,
  }
}
