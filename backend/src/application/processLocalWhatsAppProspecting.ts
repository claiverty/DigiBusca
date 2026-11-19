import {
  getEvolutionApiConfig,
  isWhatsAppAutomationRuntimeEnabled,
  isWhatsAppOpenBotReplyRecoveryConfigured,
  isWhatsAppProspectingRuntimeEnabled,
} from '../config/supabase.js'
import { WhatsAppProspectingStore, type WhatsAppProspectingQueueItem } from '../data/whatsappProspectingStore.js'
import { WhatsAppStore } from '../data/whatsappStore.js'
import { EvolutionApiError, sendEvolutionTextMessage } from '../integrations/evolutionApi.js'
import { logWarning } from '../observability/logger.js'
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
    try {
      const context = await store.getDispatchContext(item)
      providerMessageId = await sendEvolutionTextMessage(item.phoneNumberId, item.recipientPhone, item.message)
      const sentAt = new Date().toISOString()
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
      const unknownOutcome = Boolean(providerMessageId) || (error instanceof EvolutionApiError && error.status >= 500)
      const errorCode = providerMessageId
        ? 'history_sync_failed'
        : error instanceof EvolutionApiError
        ? error.status >= 500 ? 'provider_outcome_unknown' : 'provider_rejected'
        : 'contact_not_eligible_or_connection_unavailable'
      try {
        await store.finishQueueItem(item.id, unknownOutcome ? 'unknown' : 'failed', {
          ...(providerMessageId ? { providerMessageId } : {}),
          errorCode,
        })
      } catch {
        logWarning('whatsapp_local_prospecting_result_failed', { reason: 'queue_result_unavailable' })
      }
      logWarning('whatsapp_local_prospecting_send_failed', { reason: errorCode })
    }
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
  if (!replyRuntimeEnabled && !openBotRecoveryEnabled && !prospectingRuntimeEnabled) return undefined

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
