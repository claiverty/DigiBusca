import assert from 'node:assert/strict'
import test from 'node:test'
import type { GenerateOutreachInput, GeneratedOutreachCopy } from '../contracts/aiOutreach.js'
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
  const context = buildOutreachContext(baseInput)
  const copy: GeneratedOutreachCopy = {
    whatsappMessage: 'Oi, tudo bem? Encontrei a empresa de vocês no Google e não localizei um site vinculado ao perfil. Trabalho com sites institucionais. Já consideraram ter esse canal próprio?',
    followUpMessage: 'Oi! Posso enviar uma ideia simples por aqui?',
    salesArgument: 'Um site é um canal próprio para apresentar informações e facilitar o contato.',
  }

  assert.deepEqual(validateGeneratedOutreach(copy, context), [])
})

test('aceita observações naturais que continuam vinculadas ao perfil público', () => {
  const context = buildOutreachContext(baseInput)
  const variations = [
    'Oi, tudo bem? Notei que a empresa não tem um site informado no perfil do Google. Posso enviar uma ideia rápida?',
    'Oi, tudo bem? No perfil do Google não consta um site cadastrado. Posso compartilhar uma sugestão?',
    'Oi, tudo bem? Não identifiquei um site vinculado ao perfil da empresa no Google. Posso mostrar uma possibilidade?',
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

  assert.ok(issues.includes('A saudação inicial não é neutra.'))
  assert.ok(issues.includes('A resposta usa voz de equipe.'))
  assert.ok(issues.includes('A resposta contém uma afirmação comercial proibida.'))
  assert.ok(issues.includes('A resposta afirma que a empresa não possui site.'))
})
