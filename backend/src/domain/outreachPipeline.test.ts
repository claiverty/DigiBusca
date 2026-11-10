import assert from 'node:assert/strict'
import test from 'node:test'
import { conversationStages, parseGenerateOutreachInput, type GenerateOutreachInput, type GeneratedOutreachCopy } from '../contracts/aiOutreach.js'
import {
  buildOutreachContext,
  createSafeOutreachTemplate,
  validateGeneratedOutreach,
} from './outreachPipeline.js'

const baseInput: GenerateOutreachInput = {
  businessName: 'Empresa Exemplo',
  category: 'Serviços profissionais',
  websiteStatus: 'not_listed',
  googleProfileStatus: 'complete',
  service: 'site institucional',
  tone: 'Profissional',
  senderName: 'Cristhian',
}

test('classifica site não informado com oportunidade única e confiança alta', () => {
  const context = buildOutreachContext(baseInput)

  assert.equal(context.leadAnalysis.leadType, 'NO_WEBSITE')
  assert.equal(context.leadAnalysis.primaryOpportunity, 'website')
  assert.equal(context.leadAnalysis.confidence, 'high')
  assert.deepEqual(context.leadAnalysis.secondaryOpportunities, [])
})

test('classifica perfil incompleto sem avaliar a qualidade do site', () => {
  const context = buildOutreachContext({
    ...baseInput,
    websiteStatus: 'listed',
    googleProfileStatus: 'incomplete',
  })

  assert.equal(context.leadAnalysis.leadType, 'INCOMPLETE_GOOGLE_PROFILE')
  assert.equal(context.leadAnalysis.primaryOpportunity, 'google_profile')
  assert.equal(context.leadAnalysis.confidence, 'medium')
})

test('não inventa problema quando há site e o perfil está completo', () => {
  const context = buildOutreachContext({
    ...baseInput,
    websiteStatus: 'listed',
    googleProfileStatus: 'complete',
  })

  assert.equal(context.leadAnalysis.leadType, 'NO_CLEAR_OPPORTUNITY')
  assert.equal(context.leadAnalysis.primaryOpportunity, 'general_outreach')
  assert.equal(context.leadAnalysis.confidence, 'low')
})

test('modelo seguro passa pelas mesmas validações da resposta da IA', () => {
  const context = buildOutreachContext(baseInput)
  const copy = createSafeOutreachTemplate(context)

  assert.deepEqual(validateGeneratedOutreach(copy, context), [])
})

test('aceita variações factuais sem afirmar que a empresa não possui site', () => {
  const context = buildOutreachContext({ ...baseInput, stage: 'Apresentar ideia' })
  const copy: GeneratedOutreachCopy = {
    whatsappMessage: 'Encontrei a empresa de vocês no Google e não localizei um site vinculado ao perfil. Trabalho com sites institucionais. Posso enviar uma ideia para esse canal próprio?',
    followUpMessage: 'Oi! Posso enviar uma ideia simples por aqui?',
    salesArgument: 'Um site é um canal próprio para apresentar informações e facilitar o contato.',
  }

  assert.deepEqual(validateGeneratedOutreach(copy, context), [])
})

test('aceita observações naturais que continuam vinculadas ao perfil público', () => {
  const context = buildOutreachContext({ ...baseInput, stage: 'Apresentar ideia' })
  const variations = [
    'Notei que a empresa não tem um site informado no perfil do Google. Posso enviar uma ideia rápida?',
    'No perfil do Google não consta um site cadastrado. Posso compartilhar uma sugestão?',
    'Não identifiquei um site vinculado ao perfil da empresa no Google. Posso mostrar uma possibilidade?',
  ]

  for (const whatsappMessage of variations) {
    const copy: GeneratedOutreachCopy = {
      whatsappMessage,
      followUpMessage: 'Oi! Posso enviar uma ideia simples por aqui?',
      salesArgument: 'Um site é um canal próprio para apresentar informações e facilitar o contato.',
    }

    assert.deepEqual(validateGeneratedOutreach(copy, context), [])
  }
})

test('rejeita nome pessoal na saudação, voz de equipe e afirmação sem evidência', () => {
  const context = buildOutreachContext(baseInput)
  const unsafeCopy: GeneratedOutreachCopy = {
    whatsappMessage: 'Oi, Gabriela, tudo bem? Vimos que vocês não possuem site e estão perdendo clientes. Podemos conversar?',
    followUpMessage: 'Nossa equipe pode enviar uma proposta?',
    salesArgument: 'A empresa está perdendo dinheiro sem um site.',
  }
  const issues = validateGeneratedOutreach(unsafeCopy, context)

  assert.ok(issues.includes('A abertura deve confirmar se o contato cuida da presença digital.'))
  assert.ok(issues.includes('A abertura usa um nome que não foi fornecido.'))
  assert.ok(issues.includes('A resposta usa voz de equipe.'))
  assert.ok(issues.includes('A resposta contém uma afirmação comercial proibida.'))
  assert.ok(issues.includes('A resposta afirma que a empresa não possui site.'))
})


test('abertura apresenta Cristhian e confirma o responsável sem antecipar a oferta', () => {
  const copy = createSafeOutreachTemplate(buildOutreachContext(baseInput))
  assert.match(copy.whatsappMessage, /Cristhian, da DigiUP/)
  assert.match(copy.whatsappMessage, /quem cuida da presença digital/)
  assert.doesNotMatch(copy.whatsappMessage, /site|Google|proposta|clientes/)
})

test('etapa de identificação avança se o lead já confirmou que é responsável', () => {
  const context = buildOutreachContext({ ...baseInput, stage: 'Identificar responsável', lastReply: 'Sim, sou eu.' })
  const copy = createSafeOutreachTemplate(context)
  assert.match(copy.whatsappMessage, /Prazer!/)
  assert.match(copy.whatsappMessage, /perfil de vocês no Google/)
  assert.doesNotMatch(copy.whatsappMessage, /Você cuida da divulgação/)
  assert.deepEqual(validateGeneratedOutreach(copy, context), [])
})

test('etapa de identificação respeita resposta que direciona para outra pessoa', () => {
  for (const lastReply of ['Não sou eu, é minha sócia.', 'Não sou responsável, é minha sócia.', 'Não cuido dessa parte.']) {
    const context = buildOutreachContext({ ...baseInput, stage: 'Identificar responsável', lastReply })
    const copy = createSafeOutreachTemplate(context)
    assert.match(copy.whatsappMessage, /me indicar quem cuida/, lastReply)
    assert.doesNotMatch(copy.whatsappMessage, /Prazer!/, lastReply)
    assert.deepEqual(validateGeneratedOutreach(copy, context), [], lastReply)
  }
})

test('apresentação da ideia não promete uma prévia que não foi aprovada', () => {
  const context = buildOutreachContext({ ...baseInput, stage: 'Apresentar ideia', lastReply: 'Preciso organizar melhor as informações do escritório.' })
  const copy = createSafeOutreachTemplate(context)
  assert.match(copy.whatsappMessage, /caminho possível/)
  assert.doesNotMatch(copy.whatsappMessage, /mostrar um exemplo|enviar uma prévia|criar uma amostra/)
  assert.deepEqual(validateGeneratedOutreach(copy, context), [])
})

test('modelos de todas as etapas passam pela validação com entradas máximas', () => {
  for (const stage of conversationStages) {
    const context = buildOutreachContext({ ...baseInput, stage, senderName: 'N'.repeat(80), service: 'S'.repeat(120), greeting: 'Boa tarde' })
    assert.deepEqual(validateGeneratedOutreach(createSafeOutreachTemplate(context), context), [], stage)
  }
})

test('identificação do responsável rejeita oferta antecipada', () => {
  const context = buildOutreachContext({ ...baseInput, stage: 'Identificar responsável' })
  const copy = { ...createSafeOutreachTemplate(context), whatsappMessage: 'Trabalho com sites. Posso enviar uma proposta?' }
  assert.ok(validateGeneratedOutreach(copy, context).length > 0)
})

test('recusa explícita encerra mesmo que outra etapa esteja selecionada', () => {
  const context = buildOutreachContext({ ...baseInput, stage: 'Apresentar ideia', lastReply: 'Obrigado, mas não tenho interesse.' })
  const copy = createSafeOutreachTemplate(context)
  assert.match(copy.whatsappMessage, /obrigado por me responder/)
  assert.doesNotMatch(copy.whatsappMessage + copy.followUpMessage, /\?/)
  assert.deepEqual(validateGeneratedOutreach(copy, context), [])
  assert.ok(validateGeneratedOutreach({ ...copy, whatsappMessage: 'Mas posso enviar uma proposta?' }, context).length > 0)
})

test('contrato preserva contexto e rejeita etapas e respostas inválidas', () => {
  assert.equal(parseGenerateOutreachInput(baseInput)?.stage, 'Abertura')
  assert.equal(parseGenerateOutreachInput({ ...baseInput, stage: 'Entender cenário', lastReply: 'Sou o responsável.' })?.lastReply, 'Sou o responsável.')
  assert.equal(parseGenerateOutreachInput({ ...baseInput, stage: 'Oferta agressiva' }), undefined)
  assert.equal(parseGenerateOutreachInput({ ...baseInput, lastReply: 'x'.repeat(2001) }), undefined)
})
