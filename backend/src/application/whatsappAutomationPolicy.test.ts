import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWhatsAppAutomationProfileInput } from '../contracts/whatsappAutomation.js'
import { configureRuntimeEnvironment, getEvolutionApiConfig, isWhatsAppAutomationModeRuntimeEnabled, isWhatsAppEvolutionIntegrationEnabled } from '../config/supabase.js'
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

test('o runtime OpenClaw independe do interruptor global das rotas legadas', () => {
  configureRuntimeEnvironment({
    WHATSAPP_INTEGRATION_ENABLED: 'true',
    WHATSAPP_AUTOMATION_RUNTIME_ENABLED: 'false',
    WHATSAPP_OPENCLAW_RUNTIME_ENABLED: 'true',
    OPENCLAW_OWNER_USER_ID: '123e4567-e89b-42d3-a456-426614174000',
    OPENCLAW_PHONE_NUMBER_ID: 'numero_teste',
    OPENCLAW_OPERATOR_E164: '+5511999999999',
    OPENCLAW_MCP_TOKEN: 'a'.repeat(64),
    OPENCLAW_BRIDGE_TOKEN: 'b'.repeat(64),
  })

  assert.equal(isWhatsAppAutomationModeRuntimeEnabled('openclaw'), true)
  assert.equal(isWhatsAppAutomationModeRuntimeEnabled('gemini'), false)
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
