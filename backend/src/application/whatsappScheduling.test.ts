import assert from 'node:assert/strict'
import test from 'node:test'
import { getWhatsAppSchedulingReply } from './whatsappScheduling.js'

test('reconhece pedido para marcar a conversa e não confirma a disponibilidade', () => {
  const result = getWhatsAppSchedulingReply([
    { direction: 'outbound', body: 'Que tal marcarmos uma breve conversa de diagnóstico para alinhar o projeto?' },
    { direction: 'inbound', body: 'Acho perfeito, vocês conseguem marcar para hoje às 17h?' },
  ])

  assert.deepEqual(result, {
    replyText: 'Vou conferir esse horário e te confirmo por aqui',
    requiresAvailabilityCheck: true,
  })
})

test('pede dia e horário quando a pessoa aceita conversar sem sugerir uma data', () => {
  const result = getWhatsAppSchedulingReply([
    { direction: 'outbound', body: 'Podemos marcar uma conversa para entender melhor o projeto.' },
    { direction: 'inbound', body: 'Podemos sim, vamos marcar.' },
  ])

  assert.equal(result?.replyText, 'Que dia e horário seriam melhores? Vou conferir e te confirmo por aqui')
})

test('não confunde pedido de sistema de agendamento com pedido de reunião', () => {
  assert.equal(getWhatsAppSchedulingReply([
    { direction: 'inbound', body: 'Eu gostaria de um sistema de agendamento de horários com pagamento integrado.' },
  ]), undefined)
})

test('não trata conversa sobre calendário sem intenção de marcar como agendamento', () => {
  assert.equal(getWhatsAppSchedulingReply([
    { direction: 'inbound', body: 'O sistema precisa mostrar uma agenda para os clientes.' },
  ]), undefined)
})
