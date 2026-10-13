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
  return {
    leadData,
    leadAnalysis,
    campaignConfig: buildCampaignConfig(input),
    approachStrategy: chooseApproachStrategy(leadAnalysis),
    conversation: { stage: hasExplicitRefusal(input.lastReply ?? '') ? 'Encerrar' : input.stage ?? 'Abertura', lastReply: input.lastReply ?? '', senderName: input.senderName ?? '', greeting: input.greeting ?? 'Oi' },
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

  if (copy.whatsappMessage.length > 500) issues.push('A mensagem inicial ultrapassa 500 caracteres.')
  if (copy.followUpMessage.length > 320) issues.push('O follow-up ultrapassa 320 caracteres.')
  if (copy.salesArgument.length > 350) issues.push('O argumento ultrapassa 350 caracteres.')
  const identity = normalizedText(context.conversation.senderName)
  const opening = identity ? initial.replace(`sou ${identity}. `, '') : initial
  const isSimpleGreeting = /^(?:(?:oi|ola)(?:, (?:bom dia|boa tarde|boa noite))?|bom dia|boa tarde|boa noite)[!, .]+tudo (?:bem|certo)\?$/.test(opening)
  if (context.conversation.stage === 'Abertura' && (!isSimpleGreeting || copy.whatsappMessage.length > 140)) {
    issues.push('A abertura deve conter apenas uma saudação curta e identificação opcional.')
  }
  if (context.conversation.stage === 'Abertura' && /\b(site|google|proposta|servico|clientes|vendas|trabalho|oportunidade)\b/.test(initial)) {
    issues.push('A abertura antecipa uma oferta comercial.')
  }
  if (context.conversation.stage !== 'Encerrar' && !hasExplicitRefusal(context.conversation.lastReply) && !copy.whatsappMessage.trim().endsWith('?')) issues.push('A mensagem inicial não termina com uma pergunta.')
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
  if (hasExplicitRefusal(context.conversation.lastReply) && /\?|\b(mas|porem|insistir|oferta|proposta)\b/.test(initial)) issues.push('A resposta não respeita a recusa.')
  return issues
}

export function createSafeOutreachTemplate(context: OutreachContext): GeneratedOutreachCopy {
  const { service } = context.campaignConfig
  const { stage, senderName, greeting } = context.conversation
  const introduction = senderName ? `Sou ${senderName}. ` : ''
  const messages: Record<typeof stage, string> = {
    'Abertura': `${greeting === 'Oi' ? 'Oi' : `Oi, ${greeting.toLocaleLowerCase('pt-BR')}`}! ${senderName ? `Sou ${senderName}. ` : ''}Tudo bem?`,
    'Identificar responsável': 'Por esse contato eu falo com quem cuida da divulgação e da presença digital da empresa ou seria outra pessoa?',
    'Pedir permissão': `${introduction}Trabalho com ${service}. Queria entender como vocês cuidam dessa parte hoje. Posso te fazer uma pergunta rápida?`,
    'Entender cenário': 'Hoje vocês usam mais o Instagram e o WhatsApp para apresentar os serviços e receber contatos ou também usam um site?',
    'Explorar necessidade': 'Entendi. Esse formato atende bem vocês hoje ou tem alguma coisa nessa parte que gostariam de facilitar?',
    'Apresentar ideia': `Se fizer sentido para vocês, posso mostrar um exemplo de ${service} para avaliarmos juntos se ajuda no que precisam. Quer ver?`,
    'Retomar contato': 'Oi, tudo bem? Queria saber se podemos continuar a conversa por aqui. Se não for um bom momento, tudo bem também?',
    'Encerrar': 'Tudo bem, obrigado por me responder. Bom trabalho por aí!',
  }
  return {
    whatsappMessage: hasExplicitRefusal(context.conversation.lastReply) ? messages['Encerrar'] : messages[stage],
    followUpMessage: stage === 'Encerrar' || hasExplicitRefusal(context.conversation.lastReply) ? messages['Encerrar'] : messages['Retomar contato'],
    salesArgument: `Entenda o cenário e a necessidade antes de apresentar ${service}. Os dados públicos não comprovam problemas nem resultados futuros.`,
  }
}
