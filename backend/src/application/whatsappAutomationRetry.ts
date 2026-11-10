export type AutomationRunState = {
  status: string
  reason: string | null
  completed_at: string | null
  reply_provider_message_id?: string | null
}

const generationRetryDelaysMs = [30_000, 90_000]

export function generationFailureReason(attempt: number) {
  return attempt < 3 ? `gemini_generation_retry_${attempt}` : 'gemini_generation_retry_exhausted'
}

export function nextGenerationRetryAttempt(run: AutomationRunState, now = Date.now()) {
  if (run.status !== 'failed' || !run.completed_at || run.reply_provider_message_id) return undefined
  if (run.reason === 'gemini_generation_requested') return 1
  const failedAttempt = run.reason === 'gemini_generation_retry_1' ? 1 : run.reason === 'gemini_generation_retry_2' ? 2 : undefined
  if (!failedAttempt) return undefined
  const completedAt = Date.parse(run.completed_at)
  if (!Number.isFinite(completedAt) || now - completedAt < generationRetryDelaysMs[failedAttempt - 1]!) return undefined
  return failedAttempt + 1
}

export function canManuallyRetryGeneration(run: AutomationRunState & { reply_provider_message_id: string | null }) {
  if (run.reply_provider_message_id) return false
  return run.status === 'failed' && (run.reason === 'gemini_generation_requested' || run.reason?.startsWith('gemini_generation_retry_') === true)
}
