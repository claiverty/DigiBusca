import assert from 'node:assert/strict'
import test from 'node:test'
import { isMisleadingHumanIdentityClaim, isUnsolicitedAutomationDisclosure } from './whatsappAutoReplyProvider.js'

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
