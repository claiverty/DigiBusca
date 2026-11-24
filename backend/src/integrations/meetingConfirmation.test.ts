import assert from 'node:assert/strict'
import test from 'node:test'
import { isClearMeetingAcceptance, isMeetingConfirmationRequestForSlot } from './meetingConfirmation.js'

const startAt = '2026-11-25T17:00:00-03:00'
const offerAt = '2026-11-24T14:50:00-03:00'
const replyAt = '2026-11-24T14:51:00-03:00'
const screenshotOffer = 'Amanhã, 25/11, às 17h está livre. Para eu confirmar a reunião, me responde “confirmo às 17h”, por favor.'
const screenshotFollowUp = 'Só pra confirmar, a reunião fica amanhã, 25/11, às 17h, com duração de 30 minutos. Confirma esse horário?'
const screenshotLastOffer = 'A confirmação ainda não foi aceita pelo sistema. Pode escrever “Confirmo amanhã, 25/11, às 17h”?'

test('a oferta pode pedir uma confirmação natural sem exigir frase decorada', () => {
  assert.equal(isMeetingConfirmationRequestForSlot(screenshotOffer, startAt, offerAt), true)
  assert.equal(isMeetingConfirmationRequestForSlot(screenshotFollowUp, startAt, offerAt), true)
  assert.equal(isMeetingConfirmationRequestForSlot(screenshotLastOffer, startAt, offerAt), true)
  for (const reply of ['Confirmo', 'Sim', 'Pode marcar', 'Fechado', 'Ok', 'Perfeito', 'Sim, pode ser?', 'Até amanhã', '👍']) {
    assert.equal(isClearMeetingAcceptance(reply, startAt, replyAt), true, `${reply} should confirm the offered slot`)
  }
})

test('a oferta precisa indicar claramente a mesma data e horário', () => {
  assert.equal(isMeetingConfirmationRequestForSlot('Às 17h está livre, te serve?', startAt, offerAt), false)
  assert.equal(isMeetingConfirmationRequestForSlot('Amanhã às 17h está livre, te serve?', startAt, offerAt), true)
  assert.equal(isMeetingConfirmationRequestForSlot('Amanhã, 25/11, às 18h está livre, te serve?', startAt, offerAt), false)
  assert.equal(isMeetingConfirmationRequestForSlot('Amanhã, 25/11, às 17h está livre. Posso reservar?', startAt, offerAt), true)
})

test('recusas, dúvidas e mudanças de horário não confirmam a reunião', () => {
  for (const reply of ['Não', 'Talvez', 'Sim, mas vou confirmar depois', 'Pode ser às 18h', 'Confirmo amanhã às 18h', 'Acho que sim?']) {
    assert.equal(isClearMeetingAcceptance(reply, startAt, replyAt), false, `${reply} should not confirm the offered slot`)
  }
})

test('aceita respostas afirmativas que repetem o dia e horário corretos', () => {
  assert.equal(isClearMeetingAcceptance('Confirmo amanhã às 17h', startAt, replyAt), true)
  assert.equal(isClearMeetingAcceptance('Fechado, 25/11 às 17h', startAt, replyAt), true)
  assert.equal(isClearMeetingAcceptance('Pode ser dia 25/11 às 17h', startAt, replyAt), true)
})
