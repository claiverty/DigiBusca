import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWhatsAppAutomationProfileInput } from '../contracts/whatsappAutomation.js'
import { selectWhatsAppAutomationReplyPlan } from './whatsappAutomationPolicy.js'

test('handoff_only nunca envia contexto para o Gemini, mesmo com chave configurada', () => {
  assert.equal(selectWhatsAppAutomationReplyPlan({
    responseMode: 'handoff_only',
    shouldHandoff: false,
    geminiConfigured: true,
  }), 'handoff')
})

test('Gemini só é escolhido quando está selecionado, configurado e não há motivo de encaminhamento', () => {
  assert.equal(selectWhatsAppAutomationReplyPlan({
    responseMode: 'gemini',
    shouldHandoff: false,
    geminiConfigured: true,
  }), 'gemini')
  assert.equal(selectWhatsAppAutomationReplyPlan({
    responseMode: 'gemini',
    shouldHandoff: true,
    geminiConfigured: true,
  }), 'handoff')
  assert.equal(selectWhatsAppAutomationReplyPlan({
    responseMode: 'gemini',
    shouldHandoff: false,
    geminiConfigured: false,
  }), 'handoff')
})

test('perfil antigo sem modo explícito usa encaminhamento humano por padrão', () => {
  const profile = parseWhatsAppAutomationProfileInput({
    phoneNumberId: 'numero_teste',
    businessName: '',
    senderIdentity: '',
    serviceSummary: '',
    approvedFacts: '',
    escalationContact: '',
    automationEnabled: false,
    channelApproved: false,
    contentApproved: false,
  })

  assert.equal(profile?.responseMode, 'handoff_only')
})
