import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeWhatsAppHistoryForGemini } from './whatsappConversationPrivacy.js'

test('limita o contexto enviado ao Gemini às vinte mensagens mais recentes', () => {
  const messages = Array.from({ length: 25 }, (_, index) => ({ direction: 'inbound' as const, body: `Mensagem ${index + 1}` }))
  const sanitized = sanitizeWhatsAppHistoryForGemini(messages)

  assert.equal(sanitized.length, 20)
  assert.equal(sanitized[0]?.body, 'Mensagem 6')
  assert.equal(sanitized[19]?.body, 'Mensagem 25')
})

test('remove assuntos pessoais sensíveis e oculta identificadores do histórico', () => {
  const sanitized = sanitizeWhatsAppHistoryForGemini([
    { direction: 'inbound', body: 'Meu diagnóstico foi confirmado.' },
    { direction: 'inbound', body: 'Meu CPF é 123.456.789-09, e-mail teste@example.com, telefone (11) 99999-1234.' },
    { direction: 'inbound', body: 'Pode responder pelo e-mail teste@example.com ou pelo telefone (11) 99999-1234.' },
    { direction: 'outbound', body: 'O site de vocês é exemplo.com.' },
  ])

  assert.equal(sanitized[0]?.body, '[mensagem omitida por conter dado pessoal ou sensível]')
  assert.doesNotMatch(sanitized[1]?.body ?? '', /123\.456\.789-09|teste@example\.com|99999-1234/)
  assert.match(sanitized[1]?.body ?? '', /\[mensagem omitida por conter dado pessoal ou sensível\]/)
  assert.doesNotMatch(sanitized[2]?.body ?? '', /teste@example\.com|99999-1234/)
  assert.match(sanitized[2]?.body ?? '', /\[e-mail ocultado\]/)
  assert.match(sanitized[2]?.body ?? '', /\[telefone ocultado\]/)
  assert.equal(sanitized[3]?.body, 'O site de vocês é exemplo.com.')
})

test('omite documento, endereço residencial, nascimento, conta bancária e saúde pessoal', () => {
  const messages = [
    'Meu RG é 12.345.678-9.',
    'Meu passaporte: AB1234567.',
    'Minha data de nascimento é 10/02/1990.',
    'Meu endereço residencial é Rua Exemplo, 123.',
    'Agência 1234, conta 567890.',
    'Estou tomando medicação por causa dos sintomas.',
  ].map((body) => ({ direction: 'inbound' as const, body }))

  for (const message of sanitizeWhatsAppHistoryForGemini(messages)) {
    assert.equal(message.body, '[mensagem omitida por conter dado pessoal ou sensível]')
  }
})
