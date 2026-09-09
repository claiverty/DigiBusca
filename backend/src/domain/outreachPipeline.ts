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
  }
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
  if (!/^(oi|ola), tudo bem\?/.test(initial)) issues.push('A saudação inicial não é neutra.')
  if (!copy.whatsappMessage.trim().endsWith('?')) issues.push('A mensagem inicial não termina com uma pergunta.')
  if (/https?:\/\/|www\./i.test(allText)) issues.push('A resposta contém uma URL.')
  if (/\b(vimos|encontramos|trabalhamos|nossa equipe)\b/.test(allText)) {
    issues.push('A resposta usa voz de equipe.')
  }
  if (forbiddenClaims.some((claim) => allText.includes(normalizedText(claim)))) {
    issues.push('A resposta contém uma afirmação comercial proibida.')
  }

  if (context.leadAnalysis.leadType === 'NO_WEBSITE') {
    if (/\b(nao tem|nao possuem?|sem um site|sem site proprio)\b/.test(initial)) {
      issues.push('A resposta afirma que a empresa não possui site.')
    }
    const reportsSearchResult = /\b(nao encontrei|nao localizei)\b/.test(initial)
    const describesPublicListing = /\bsite\b/.test(initial)
      && /\b(informado|vinculado|cadastrado|listado)\b/.test(initial)
      && /\b(perfil|google)\b/.test(initial)
    if (!reportsSearchResult || !describesPublicListing) {
      issues.push('A observação sobre o site não está formulada de maneira factual.')
    }
  }

  return issues
}

export function createSafeOutreachTemplate(context: OutreachContext): GeneratedOutreachCopy {
  const { service } = context.campaignConfig
  const { leadType } = context.leadAnalysis

  if (leadType === 'NO_WEBSITE') {
    return {
      whatsappMessage: `Oi, tudo bem? Encontrei a empresa de vocês pelo Google e resolvi entrar em contato. Trabalho com ${service} e não encontrei um site informado no perfil. Vocês já pensaram em ter um espaço próprio para apresentar melhor a empresa e os serviços?`,
      followUpMessage: `Oi, tudo bem? Passando só para saber se faz sentido eu enviar uma sugestão de ${service} para a empresa de vocês. Posso resumir a ideia em poucos pontos por aqui?`,
      salesArgument: 'Um site pode funcionar como um canal próprio para apresentar a empresa, explicar seus serviços e facilitar o contato de quem já encontrou o negócio pelo Google.',
    }
  }

  if (leadType === 'INCOMPLETE_GOOGLE_PROFILE') {
    return {
      whatsappMessage: `Oi, tudo bem? Encontrei a empresa de vocês pelo Google e notei que algumas informações públicas não aparecem no perfil. Trabalho com ${service}. Vocês já pensaram em organizar melhor essa apresentação para quem chega pelo Google?`,
      followUpMessage: `Oi, tudo bem? Passando só para saber se posso enviar uma sugestão simples de ${service} para melhorar a apresentação das informações da empresa no Google?`,
      salesArgument: 'Informações organizadas e completas ajudam quem já encontrou a empresa no Google a entender os serviços e escolher o canal de contato.',
    }
  }

  return {
    whatsappMessage: `Oi, tudo bem? Encontrei a empresa de vocês pelo Google e resolvi entrar em contato. Trabalho com ${service} para negócios do segmento de ${context.leadData.industry}. Posso enviar uma ideia rápida e sem compromisso por aqui?`,
    followUpMessage: `Oi, tudo bem? Passando só para saber se faz sentido eu compartilhar aquela ideia de ${service}. Posso resumir em poucos pontos por aqui?`,
    salesArgument: `Os dados disponíveis não comprovam uma falha específica. A abordagem inicia uma conversa respeitosa sobre ${service}.`,
  }
}
