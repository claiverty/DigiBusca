import assert from 'node:assert/strict'
import test from 'node:test'
import { asksForCristhian, asksForHumanHandoff, asksForUnapprovedCommercialTerms, requiresHumanReview } from './whatsappEscalationRules.js'

test('menções comuns a proposta, resultado, escopo e investimento não pausam a conversa', () => {
  for (const message of [
    'Quero entender a proposta de vocês.',
    'Quais resultados esse projeto pode trazer?',
    'Vamos definir o escopo juntos.',
    'Estou avaliando o investimento em uma landing page.',
  ]) {
    assert.equal(requiresHumanReview(message), false, message)
  }
})

test('pedidos explícitos de preço ou condição comercial pedem revisão humana', () => {
  for (const message of [
    'Quanto custa uma landing page?',
    'Qual é o investimento?',
    'Vocês aceitam Pix?',
    'Pode me enviar uma proposta?',
  ]) {
    assert.equal(asksForUnapprovedCommercialTerms(message), true, message)
  }
})

test('só o pedido explícito de atendimento humano pede revisão', () => {
  assert.equal(asksForHumanHandoff('Quero falar com uma pessoa de verdade.'), true)
  assert.equal(asksForHumanHandoff('Quero falar com o Cristhian, uma pessoa real.'), true)
  assert.equal(asksForHumanHandoff('Quero falar com o Cristhian que é uma pessoa real.'), true)
  assert.equal(asksForHumanHandoff('Quero falar com o Cristhian, uma pessoa humana.'), true)
  assert.equal(asksForHumanHandoff('Tem um atendente no site?'), false)
})

test('Cristhian é reconhecido como o agente, não como destino do encaminhamento', () => {
  assert.equal(asksForCristhian('Quero falar com o Cristhian.'), true)
  assert.equal(asksForHumanHandoff('Quero falar com o Cristhian.'), false)
  assert.equal(requiresHumanReview('Quero falar com o Cristhian.'), false)
})
