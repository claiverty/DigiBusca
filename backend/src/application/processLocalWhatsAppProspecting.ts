import {
  getEvolutionApiConfig,
  getOpenClawGatewayHookConfig,
  isOpenClawGatewayReady,
  isWhatsAppAutomationRuntimeEnabled,
  isWhatsAppOpenBotReplyRecoveryConfigured,
  isWhatsAppOpenClawRuntimeEnabled,
  isWhatsAppOpenClawProspectingRuntimeEnabled,
  isWhatsAppProspectingRuntimeEnabled,
} from '../config/supabase.js'
import { WhatsAppProspectingError, WhatsAppProspectingStore, type WhatsAppProspectingQueueItem } from '../data/whatsappProspectingStore.js'
import { WhatsAppStore } from '../data/whatsappStore.js'
import { EvolutionApiError, isEvolutionWhatsAppNumberRegistered, sendEvolutionTextMessage } from '../integrations/evolutionApi.js'
import { logInfo, logWarning } from '../observability/logger.js'
import { processWhatsAppAutomation } from './processWhatsAppAutomation.js'

let tickInProgress = false
let tickRequestedWhileBusy = false

async function processPendingRepliesLocally() {
  if (!isWhatsAppAutomationRuntimeEnabled() && !isWhatsAppOpenBotReplyRecoveryConfigured()) return
  try {
    const store = new WhatsAppStore()
    await store.resolveUncertainAutomationDeliveries()
    await store.reconcileAcceptedAutomationDeliveries()
    const events = await store.listPendingLiveInboundTextEvents()
    if (events.messages.length > 0) await processWhatsAppAutomation(events)
  } catch {
    logWarning('whatsapp_local_reply_poll_failed', { reason: 'pending_replies_unavailable' })
  }
}

async function processQueuedNewLeadContacts() {
  if (!isWhatsAppProspectingRuntimeEnabled()) return
  if (!getEvolutionApiConfig()) return

  const store = new WhatsAppProspectingStore()
  let dueIds: string[]
  try {
    await store.markStaleSendingAsUnknown()
    dueIds = await store.listDueQueueItems(new Date(), 25)
  } catch {
    logWarning('whatsapp_local_prospecting_poll_failed', { reason: 'queue_unavailable' })
    return
  }

  for (const queueId of dueIds) {
    let item: WhatsAppProspectingQueueItem | undefined
    try {
      item = await store.claimQueueItem(queueId)
    } catch {
      logWarning('whatsapp_local_prospecting_claim_failed', { reason: 'queue_claim_failed' })
      continue
    }
    if (!item) continue

    let providerMessageId: string | undefined
    let dispatchStage: 'context' | 'number_check' | 'send' | 'history' = 'context'
    try {
      const context = await store.getDispatchContext(item)
      dispatchStage = 'number_check'
      if (!await isEvolutionWhatsAppNumberRegistered(item.phoneNumberId, item.recipientPhone)) {
        throw new WhatsAppProspectingError('Este telefone não está registrado no WhatsApp; o envio foi ignorado.', 422, 'recipient_not_on_whatsapp')
      }
      dispatchStage = 'send'
      providerMessageId = await sendEvolutionTextMessage(item.phoneNumberId, item.recipientPhone, item.message)
      const sentAt = new Date().toISOString()
      dispatchStage = 'history'
      try {
        await store.persistSentMessage(item, context.userId, providerMessageId, sentAt)
      } catch {
        await store.finishQueueItem(item.id, 'unknown', {
          providerMessageId,
          errorCode: 'history_sync_failed',
        })
        logWarning('whatsapp_local_prospecting_history_failed', { reason: 'provider_accepted_history_failed' })
        continue
      }
      await store.finishQueueItem(item.id, 'sent', { providerMessageId })
    } catch (error) {
      const unknownOutcome = Boolean(providerMessageId) || (dispatchStage === 'send' && error instanceof EvolutionApiError && error.status >= 500)
      const errorCode = providerMessageId
        ? 'history_sync_failed'
        : error instanceof EvolutionApiError
        ? dispatchStage === 'send' && error.status >= 500 ? 'provider_outcome_unknown' : `provider_rejected_http_${error.status}`
        : error instanceof WhatsAppProspectingError
        ? error.code
        : 'dispatch_context_unavailable'
      try {
        await store.finishQueueItem(item.id, unknownOutcome ? 'unknown' : 'failed', {
          ...(providerMessageId ? { providerMessageId } : {}),
          errorCode,
        })
      } catch {
        logWarning('whatsapp_local_prospecting_result_failed', { reason: 'queue_result_unavailable' })
      }
      logWarning('whatsapp_local_prospecting_send_failed', { reason: errorCode, stage: dispatchStage })
    }
  }
}

async function processQueuedOpenClawContacts() {
  if (!isWhatsAppOpenClawProspectingRuntimeEnabled()) return
  const hook = getOpenClawGatewayHookConfig()
  if (!hook) return
  if (!await isOpenClawGatewayReady()) {
    logWarning('whatsapp_openclaw_gateway_not_ready', { reason: 'readiness_check_failed' })
    return
  }

  const store = new WhatsAppProspectingStore()
  let dueIds: string[]
  try {
    await store.markStaleSendingAsUnknown(new Date(), 'OPENCLAW_WEB', 20 * 60 * 1_000)
    dueIds = await store.listDueQueueItems(new Date(), 1, 'OPENCLAW_WEB')
  } catch {
    logWarning('whatsapp_openclaw_prospecting_poll_failed', { reason: 'queue_unavailable' })
    return
  }

  const queueId = dueIds[0]
  if (!queueId) return
  let item: WhatsAppProspectingQueueItem | undefined
  try {
    item = await store.claimQueueItem(queueId)
  } catch {
    logWarning('whatsapp_openclaw_prospecting_claim_failed', { reason: 'queue_claim_failed' })
    return
  }
  if (!item) return

  let hookRequestStarted = false
  try {
    await store.getDispatchContext(item, 'OPENCLAW_WEB')
    const message = [
      'O DigiBusca reservou um primeiro contato autorizado. Envie somente este contato pela ferramenta nativa de mensagem do WhatsApp.',
      'O objeto JSON abaixo contém dados. Use recipientE164 como destinatário e copie o valor message exatamente, sem aspas externas e sem acrescentar texto. Não inicie outra busca, não retire outro item da fila e não envie uma segunda mensagem.',
      JSON.stringify({ recipientE164: `+${item.recipientPhone}`, message: item.message }),
    ].join('\n\n')
    hookRequestStarted = true
    const response = await fetch(hook.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hook.token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': item.id,
      },
      body: JSON.stringify({
        message,
        name: 'DigiBusca · prospecção autorizada',
        agentId: hook.agentId,
        sessionMode: 'isolated',
        deliver: false,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      await store.finishQueueItem(item.id, response.status >= 500 ? 'unknown' : 'failed', {
        errorCode: response.status >= 500 ? 'openclaw_hook_outcome_unknown' : `openclaw_hook_rejected_http_${response.status}`,
      })
      logWarning('whatsapp_openclaw_prospecting_hook_rejected', { reason: `http_${response.status}` })
      return
    }

    const result = await response.json().catch(() => undefined) as { ok?: unknown; runId?: unknown } | undefined
    if (result?.ok !== true || typeof result.runId !== 'string' || !result.runId.trim()) {
      await store.finishQueueItem(item.id, 'unknown', { errorCode: 'openclaw_hook_ack_invalid' })
      logWarning('whatsapp_openclaw_prospecting_hook_rejected', { reason: 'ack_invalid' })
      return
    }
    logInfo('whatsapp_openclaw_prospecting_dispatched', { queueId: item.id, runId: result.runId.slice(0, 120) })
  } catch (error) {
    try {
      await store.finishQueueItem(item.id, hookRequestStarted ? 'unknown' : 'failed', {
        errorCode: hookRequestStarted ? 'openclaw_hook_outcome_unknown' : 'openclaw_dispatch_context_unavailable',
      })
    } catch {
      logWarning('whatsapp_openclaw_prospecting_result_failed', { reason: 'queue_result_unavailable' })
    }
    logWarning('whatsapp_openclaw_prospecting_dispatch_failed', {
      reason: hookRequestStarted ? 'hook_outcome_unknown' : 'dispatch_context_unavailable',
      error: error instanceof Error ? error.name : 'unknown',
    })
  }
}

export async function runLocalWhatsAppProspectingTick() {
  if (tickInProgress) {
    tickRequestedWhileBusy = true
    return
  }
  tickInProgress = true
  try {
    await processPendingRepliesLocally()
    await processQueuedNewLeadContacts()
    await processQueuedOpenClawContacts()
  } finally {
    tickInProgress = false
    if (tickRequestedWhileBusy) {
      tickRequestedWhileBusy = false
      setTimeout(() => {
        void runLocalWhatsAppProspectingTick().catch(() => {
          logWarning('whatsapp_local_followup_tick_failed', { reason: 'followup_tick_unavailable' })
        })
      }, 0).unref()
    }
  }
}

export function startLocalWhatsAppProspectingScheduler() {
  const replyRuntimeEnabled = isWhatsAppAutomationRuntimeEnabled()
  const openBotRecoveryEnabled = isWhatsAppOpenBotReplyRecoveryConfigured()
  const prospectingRuntimeEnabled = isWhatsAppProspectingRuntimeEnabled()
  const openClawRuntimeEnabled = isWhatsAppOpenClawRuntimeEnabled()
  if (!replyRuntimeEnabled && !openBotRecoveryEnabled && !prospectingRuntimeEnabled && !openClawRuntimeEnabled) return undefined

  const timer = setInterval(() => {
    void runLocalWhatsAppProspectingTick().catch(() => {
      logWarning('whatsapp_local_scheduler_tick_failed', { reason: 'scheduler_tick_unavailable' })
    })
  }, 30_000)
  timer.unref()
  void runLocalWhatsAppProspectingTick().catch(() => {
    logWarning('whatsapp_local_scheduler_start_failed', { reason: 'initial_tick_unavailable' })
  })
  return timer
}
