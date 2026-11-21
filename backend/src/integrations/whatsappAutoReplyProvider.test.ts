import assert from 'node:assert/strict'
import test from 'node:test'
import { isMisleadingHumanIdentityClaim, isUnsolicitedAutomationDisclosure, WhatsAppAutoReplyProvider, type WhatsAppAutoReplyContext } from './whatsappAutoReplyProvider.js'

test('permite que o agente use o nome Cristhian sem alegar ser humano', () => {
  assert.equal(isUnsolicitedAutomationDisclosure('Aqui é o Cristhian, da DigiUP.'), false)
  assert.equal(isUnsolicitedAutomationDisclosure('Sou o Cristhian, agente de atendimento da DigiUP.'), false)
})

test('continua bloqueando divulgação espontânea de automação', () => {
  assert.equal(isUnsolicitedAutomationDisclosure('Sou um assistente virtual da DigiUP.'), true)
  assert.equal(isUnsolicitedAutomationDisclosure('Esta é uma mensagem automática.'), true)
})

test('não permite que Cristhian alegue ser a pessoa humana', () => {
  assert.equal(isMisleadingHumanIdentityClaim('Sou o próprio Cristhian, falando pessoalmente.'), true)
  assert.equal(isMisleadingHumanIdentityClaim('Cristhian aqui, sou eu mesmo.'), true)
  assert.equal(isMisleadingHumanIdentityClaim('Sou uma pessoa real chamada Cristhian.'), true)
  assert.equal(isMisleadingHumanIdentityClaim('Sou o Cristhian, agente de atendimento da DigiUP.'), false)
})

const context: WhatsAppAutoReplyContext = {
  businessName: 'DigiUP', senderIdentity: 'Cristhian', serviceSummary: 'Sites profissionais',
  approvedFacts: 'Escopo definido conforme o projeto.', escalationContact: 'este WhatsApp',
  stage: 'qualify_interest', inboundProjectInquiry: true,
  messages: [{ direction: 'inbound', body: 'Quero um sistema para organizar os agendamentos da clínica.' }],
}
const safeReply = { action: 'reply', replyText: 'Como vocês organizam os agendamentos hoje?', nextStage: 'qualify_interest' }
function replyResponse(reply = safeReply) {
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] }, finishReason: 'STOP' }] })
}

test('usa Gemini 3.5 Flash quando os modelos anteriores falham e evita repetir modelos indisponíveis', async () => {
  const calls: string[] = []
  const provider = new WhatsAppAutoReplyProvider(async (url) => {
    const model = String(url).split('/models/')[1]!.split(':')[0]!
    calls.push(model)
    return model === 'gemini-3.5-flash' ? replyResponse() : Response.json({}, { status: 503 })
  })
  assert.deepEqual(await provider.generate('test-key', context), safeReply)
  assert.deepEqual(calls, ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash'])
  calls.length = 0
  await provider.generate('test-key', context)
  assert.deepEqual(calls, ['gemini-3.5-flash'])
})

test('indisponibilidade de todos os modelos produz falha técnica e permite recuperar depois do intervalo', async () => {
  let now = 0
  let calls = 0
  let healthy = false
  const provider = new WhatsAppAutoReplyProvider(async () => {
    calls += 1
    return healthy ? replyResponse() : Response.json({}, { status: 503 })
  }, () => now)
  await assert.rejects(provider.generate('test-key', context), /gemini_reply_unavailable/)
  assert.equal(calls, 4)
  await assert.rejects(provider.generate('test-key', context), /gemini_models_cooling_down/)
  assert.equal(calls, 4)
  now = 60_001
  healthy = true
  assert.deepEqual(await provider.generate('test-key', context), safeReply)
})

test('resposta inválida tenta outro modelo e falha de credencial não dispara chamadas extras', async () => {
  let calls = 0
  const provider = new WhatsAppAutoReplyProvider(async () => {
    calls += 1
    return calls === 1 ? replyResponse({ ...safeReply, replyText: 'x'.repeat(281) }) : replyResponse()
  })
  assert.deepEqual(await provider.generate('test-key', context), safeReply)
  assert.equal(calls, 2)
  calls = 0
  const denied = new WhatsAppAutoReplyProvider(async () => { calls += 1; return Response.json({}, { status: 403 }) })
  await assert.rejects(denied.generate('test-key', context), /gemini_reply_unavailable/)
  assert.equal(calls, 1)
})

test('pedido genérico confirma serviço anterior e não chama o modelo para presumir o escopo', async () => {
  let calls = 0
  const provider = new WhatsAppAutoReplyProvider(async () => { calls += 1; return replyResponse() })
  const reply = await provider.generate('test-key', {
    ...context,
    messages: [
      { direction: 'inbound', body: 'Gostaria de uma landing page para meu escritório.' },
      { direction: 'outbound', body: 'Certo, vamos conversar sobre a estrutura.' },
      { direction: 'inbound', body: 'Olá! Vim pelo site da DigiUP e gostaria de conversar sobre um projeto.' },
    ],
  })
  assert.deepEqual(reply, { action: 'reply', replyText: 'Você quer retomar a landing page que comentou antes ou está pensando em outro projeto?', nextStage: 'understand_scenario' })
  assert.equal(calls, 0)
})

test('responde a uma saudação simples sem esperar pelo Gemini', async () => {
  let calls = 0
  const provider = new WhatsAppAutoReplyProvider(async () => { calls += 1; return replyResponse() })
  const reply = await provider.generate('test-key', {
    ...context,
    stage: 'identify_responsible',
    inboundProjectInquiry: false,
    messages: [{ direction: 'inbound', body: 'Opa boa tarde' }],
  })
  assert.deepEqual(reply, {
    action: 'reply',
    replyText: 'Opa, aqui é o Cristhian da DigiUP. Como posso te ajudar?',
    nextStage: 'identify_responsible',
  })
  assert.equal(calls, 0)
})

test('uma saudação dentro de uma solicitação não impede a resposta do Gemini', async () => {
  let calls = 0
  const provider = new WhatsAppAutoReplyProvider(async () => { calls += 1; return replyResponse() })
  await provider.generate('test-key', {
    ...context,
    messages: [{ direction: 'inbound', body: 'Boa tarde, quanto custa um sistema?' }],
  })
  assert.equal(calls, 1)
})

test('uma saudação que ficou pendente recebe um pedido de desculpas pela demora', async () => {
  const now = Date.parse('2026-11-10T15:55:00Z')
  const provider = new WhatsAppAutoReplyProvider(async () => replyResponse(), () => now)
  const reply = await provider.generate('test-key', {
    ...context,
    stage: 'identify_responsible',
    inboundProjectInquiry: false,
    inboundReceivedAt: new Date(now - 5 * 60_000).toISOString(),
    messages: [{ direction: 'inbound', body: 'Opa boa tarde' }],
  })
  assert.equal(reply.replyText, 'Desculpa a demora. Aqui é o Cristhian da DigiUP. Como posso te ajudar?')
})
