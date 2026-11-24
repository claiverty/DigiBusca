import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWhatsAppAutomationProfileInput } from '../contracts/whatsappAutomation.js'
import { configureRuntimeEnvironment, getEvolutionApiConfig, isWhatsAppEvolutionIntegrationEnabled } from '../config/supabase.js'
import { selectWhatsAppAutomationReplyPlan } from './whatsappAutomationPolicy.js'

test('handoff_only nunca envia contexto para o Gemini, mesmo com chave configurada', () => {
  assert.equal(selectWhatsAppAutomationReplyPlan({
    responseMode: 'handoff_only',
    shouldHandoff: false,
    geminiConfigured: true,
  }), 'handoff')
})

test('OpenClaw nunca cai no fluxo Gemini ou no encaminhamento da Evolution', () => {
  assert.equal(selectWhatsAppAutomationReplyPlan({
    responseMode: 'openclaw',
    shouldHandoff: true,
    geminiConfigured: true,
  }), 'openclaw')
})

test('Evolution fica bloqueada mesmo com credenciais presentes quando o modo exclusivo está ativo', () => {
  configureRuntimeEnvironment({
    WHATSAPP_INTEGRATION_ENABLED: 'true',
    WHATSAPP_EVOLUTION_INTEGRATION_ENABLED: 'false',
    EVOLUTION_API_URL: 'https://evolution.example.com',
    EVOLUTION_API_KEY: 'test-api-key',
    EVOLUTION_WEBHOOK_SECRET: 'x'.repeat(32),
    EVOLUTION_WEBHOOK_URL: 'https://backend.example.com/api/webhooks/evolution',
  })

  assert.equal(isWhatsAppEvolutionIntegrationEnabled(), false)
  assert.equal(getEvolutionApiConfig(), undefined)
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
