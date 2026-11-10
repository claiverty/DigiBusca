import assert from 'node:assert/strict'
import test from 'node:test'
import { canManuallyRetryGeneration, generationFailureReason, nextGenerationRetryAttempt } from './whatsappAutomationRetry.js'

const now = Date.parse('2026-11-10T12:00:00Z')

test('retenta apenas geração falha após o intervalo e encerra depois da terceira tentativa', () => {
  const run = { status: 'failed', reason: generationFailureReason(1), completed_at: new Date(now - 29_999).toISOString() }
  assert.equal(nextGenerationRetryAttempt(run, now), undefined)
  assert.equal(nextGenerationRetryAttempt(run, now + 1), 2)
  assert.equal(nextGenerationRetryAttempt({ ...run, reply_provider_message_id: 'accepted-message' }, now + 1), undefined)
  assert.equal(nextGenerationRetryAttempt({ ...run, reason: generationFailureReason(2), completed_at: new Date(now - 90_000).toISOString() }, now), 3)
  assert.equal(nextGenerationRetryAttempt({ ...run, reason: generationFailureReason(3) }, now), undefined)
})

test('não retenta envio aceito, incerto, em andamento ou atendimento humano automaticamente', () => {
  for (const [status, reason] of [['sent', null], ['processing', 'sending'], ['failed', 'delivery_unconfirmed'], ['failed', 'history_sync_failed_after_send'], ['needs_human', 'human_review_required']]) {
    assert.equal(nextGenerationRetryAttempt({ status: status!, reason: reason ?? null, completed_at: new Date(now - 600_000).toISOString() }, now), undefined)
  }
})

test('botão só recoloca na fila uma resposta ainda não enviada e nunca um envio incerto', () => {
  const run = { status: 'failed', reason: generationFailureReason(3), completed_at: new Date(now).toISOString(), reply_provider_message_id: null }
  assert.equal(canManuallyRetryGeneration(run), true)
  assert.equal(canManuallyRetryGeneration({ ...run, reply_provider_message_id: 'accepted-message' }), false)
  assert.equal(canManuallyRetryGeneration({ ...run, status: 'sent' }), false)
  assert.equal(canManuallyRetryGeneration({ ...run, reason: 'delivery_unconfirmed' }), false)
  assert.equal(canManuallyRetryGeneration({ ...run, status: 'needs_human', reason: 'explicit_human_or_commercial_request' }), false)
  assert.equal(canManuallyRetryGeneration({ ...run, status: 'needs_human', reason: 'human_review_required' }), false)
  assert.equal(nextGenerationRetryAttempt({ ...run, reason: 'gemini_generation_requested' }, now), 1)
})
