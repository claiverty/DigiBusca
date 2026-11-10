import assert from 'node:assert/strict'
import test from 'node:test'
import { isProjectServiceCorrection, resolveWhatsAppProjectContext, type ProjectMessage } from './whatsappProjectContext.js'

const prior: ProjectMessage[] = [
  { direction: 'inbound', body: 'Gostaria de uma landing page para meu escritório de advocacia.' },
  { direction: 'inbound', body: 'Quero mostrar áreas de atuação, profissionais e contatos.' },
  { direction: 'outbound', body: 'Entendi.' },
]
const opening: ProjectMessage = { direction: 'inbound', body: 'Olá! Vim pelo site da DigiUP e gostaria de conversar sobre um projeto.' }
const confirmation: ProjectMessage = { direction: 'outbound', body: 'Claro! É sobre a landing page que você comentou antes ou é outro projeto?' }

test('usa serviço anterior como hipótese a confirmar sem reutilizar o escopo antigo', () => {
  const result = resolveWhatsAppProjectContext([...prior, opening])
  assert.equal(result.priorService, 'landing page')
  assert.equal(result.currentService, undefined)
  assert.equal(result.previousProjectConfirmed, false)
  assert.match(result.clarificationReply!, /É sobre a landing page.*ou é outro projeto\?/)
  assert.deepEqual(result.messages, [opening])
})

test('não trata origem no site nem uma sugestão do próprio bot como serviço solicitado', () => {
  for (const messages of [[opening], [{ direction: 'outbound' as const, body: 'Você quer uma landing page.' }, opening]]) {
    const result = resolveWhatsAppProjectContext(messages)
    assert.equal(result.priorService, undefined)
    assert.equal(result.currentService, undefined)
    assert.doesNotMatch(result.clarificationReply!, /landing page|site|sistema|automação/)
  }
})

test('confirmação explícita libera o histórico e permanece válida nas próximas respostas', () => {
  const messages: ProjectMessage[] = [...prior, opening, confirmation, { direction: 'inbound', body: 'Sim, é isso mesmo.' }]
  for (const conversation of [messages, [...messages, { direction: 'outbound' as const, body: 'Você já tem identidade visual?' }, { direction: 'inbound' as const, body: 'Sim, já tenho logo e cores.' }]]) {
    const result = resolveWhatsAppProjectContext(conversation)
    assert.equal(result.previousProjectConfirmed, true)
    assert.equal(result.currentService, 'landing page')
    assert.equal(result.clarificationReply, undefined)
    assert.deepEqual(result.messages, conversation)
  }
})

test('correção para sistema ou automação prevalece sobre o projeto antigo', () => {
  for (const [body, service] of [['Não, agora quero um sistema de agendamento.', 'sistema'], ['Não quero landing page, quero automação.', 'automação']]) {
    const result = resolveWhatsAppProjectContext([...prior, opening, confirmation, { direction: 'inbound', body: body! }])
    assert.equal(result.previousProjectConfirmed, false)
    assert.equal(result.currentService, service)
    assert.equal(result.clarificationReply, undefined)
    assert.ok(!result.messages.includes(prior[0]!))
  }
})

test('outro projeto ou negativa sem detalhes leva a uma pergunta neutra', () => {
  for (const body of ['Não, é outro projeto.', 'Não quero landing page.', 'Quero conversar sobre um novo projeto.']) {
    const result = resolveWhatsAppProjectContext([...prior, opening, confirmation, { direction: 'inbound', body }])
    assert.equal(result.currentService, undefined)
    assert.match(result.clarificationReply!, /o que você quer criar ou melhorar/)
  }
})

test('continuidade explícita preserva o pedido e correção de serviço não é descadastro', () => {
  const result = resolveWhatsAppProjectContext([...prior, { direction: 'inbound', body: 'Podemos continuar o projeto de ontem?' }])
  assert.equal(result.currentService, 'landing page')
  assert.equal(result.clarificationReply, undefined)
  assert.equal(isProjectServiceCorrection('Não quero landing page, quero automação.'), true)
  assert.equal(isProjectServiceCorrection('Não quero landing page.'), true)
  assert.equal(isProjectServiceCorrection('Não quero mais receber mensagens sobre sites.'), false)
})

test('uma correção posterior revoga até um serviço que já havia sido confirmado', () => {
  const result = resolveWhatsAppProjectContext([...prior, opening, confirmation,
    { direction: 'inbound', body: 'Sim, é a landing page.' },
    { direction: 'outbound', body: 'Você já tem alguma referência visual?' },
    { direction: 'inbound', body: 'Na verdade, não quero landing page.' },
  ])
  assert.equal(result.previousProjectConfirmed, false)
  assert.equal(result.currentService, undefined)
  assert.match(result.clarificationReply!, /o que você quer criar ou melhorar/)
})

test('outro projeto do mesmo tipo não herda o escopo anterior mesmo começando com sim', () => {
  for (const body of ['Sim, é outro projeto, também quero uma landing page, agora para outra empresa.', 'Sim, vamos continuar, mas é outro serviço: uma landing page para outra empresa.']) {
    const latest: ProjectMessage = { direction: 'inbound', body }
    const result = resolveWhatsAppProjectContext([...prior, opening, confirmation, latest])
    assert.equal(result.previousProjectConfirmed, false)
    assert.equal(result.currentService, 'landing page')
    assert.deepEqual(result.messages, [latest])
  }
})
