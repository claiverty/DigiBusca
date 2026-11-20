import type { Lead, SearchLeadsResponse } from '../contracts/lead.js'
import type { SupabaseStore, SavedLeadState } from '../data/supabaseStore.js'
import type { WhatsAppProspectingStore, WhatsAppDailyProspectingCampaign } from '../data/whatsappProspectingStore.js'
import type { LeadProvider } from './searchLeads.js'
import { executeSearchLeads } from './searchLeads.js'

const maxSearchPages = 3

export type DailyProspectingCampaignResult = {
  campaign: WhatsAppDailyProspectingCampaign
  searchedCount: number
  savedCount: number
  queuedCount: number
}

function prospectingOpening(lead: Lead, index: number) {
  const name = lead.name.trim().replace(/[\r\n]+/g, ' ').slice(0, 100)
  const messages = [
    `Oi, aqui é o Cristhian da DigiUP. Quem cuida da presença digital da ${name}?`,
    `Bom dia, aqui é o Cristhian, da DigiUP. Falo com quem cuida do site e do digital da ${name}?`,
    `Oi, Cristhian da DigiUP por aqui. Você consegue me orientar sobre quem cuida da presença digital da ${name}?`,
  ]
  return messages[index % messages.length]
}

async function saveWithLimitedConcurrency(
  persistenceStore: SupabaseStore,
  accessToken: string,
  userId: string,
  leads: Lead[],
): Promise<Array<{ lead: Lead; saved?: SavedLeadState }>> {
  const results: Array<{ lead: Lead; saved?: SavedLeadState } | undefined> = new Array(leads.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < leads.length) {
      const index = cursor++
      const lead = leads[index]
      try {
        const saved = await persistenceStore.saveLeadState(accessToken, userId, lead.id, lead)
        results[index] = { lead, saved }
      } catch {
        results[index] = { lead }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, leads.length) }, () => worker()))
  return results.filter((result): result is { lead: Lead; saved?: SavedLeadState } => Boolean(result))
}

export async function runWhatsAppDailyProspectingCampaign(input: {
  userId: string
  accessToken: string
  city: string
  segment: string
  phoneNumberId?: string
  queueSendingAvailable: boolean
  campaign: WhatsAppDailyProspectingCampaign
  provider: LeadProvider
  persistenceStore: SupabaseStore
  prospectingStore: WhatsAppProspectingStore
}): Promise<DailyProspectingCampaignResult> {
  const { campaign, prospectingStore } = input
  try {
    const leads: Lead[] = []
    const seenLeadIds = new Set<string>()
    let pageToken: string | undefined
    for (let page = 0; page < maxSearchPages; page += 1) {
      const result: SearchLeadsResponse = await executeSearchLeads(input.provider, {
        city: input.city,
        segment: input.segment,
        languageCode: 'pt-BR',
        regionCode: 'BR',
        ...(pageToken ? { pageToken } : {}),
      })
      for (const lead of result.data) {
        if (!seenLeadIds.has(lead.id)) {
          seenLeadIds.add(lead.id)
          leads.push(lead)
        }
      }
      pageToken = result.meta.nextPageToken
      if (!pageToken || leads.length >= 60) break
    }

    const savedResults = await saveWithLimitedConcurrency(input.persistenceStore, input.accessToken, input.userId, leads)
    const savedCount = savedResults.filter((item) => item.saved).length
    const settings = await prospectingStore.getSettings(input.userId)
    const dailyCount = await prospectingStore.getDailyCount(input.userId)
    const pendingCount = await prospectingStore.getPendingQueueCount(input.userId)
    let availableSlots = input.queueSendingAvailable && settings.enabled
      ? Math.max(0, settings.dailyNewLeadLimit - dailyCount - pendingCount)
      : 0
    let queuedCount = 0

    if (availableSlots > 0 && input.phoneNumberId) {
      for (let index = 0; index < savedResults.length && availableSlots > 0; index += 1) {
        const { lead, saved } = savedResults[index]
        if (
          !saved || saved.status !== 'Novo' || saved.whatsappConsentStatus !== 'opted_in' ||
          !saved.whatsappConsentSource?.trim() || !saved.whatsappConsentAt || !lead.phone.trim()
        ) continue

        const message = prospectingOpening(lead, index)
        try {
          await input.persistenceStore.saveLeadState(input.accessToken, input.userId, lead.id, undefined, { draftMessage: message })
          await prospectingStore.enqueueNewLead(input.userId, input.phoneNumberId, lead.id, message)
          queuedCount += 1
          availableSlots -= 1
        } catch {
          // A previously contacted, opted-out, duplicate, or invalid lead is skipped.
        }
      }
    }

    const unsaved = Math.max(0, leads.length - savedCount)
    const message = queuedCount > 0
      ? `Encontrei ${leads.length} leads em ${input.city}, salvei ${savedCount} e coloquei ${queuedCount} contatos novos na fila. Os envios respeitam o limite e o horário que você configurou.`
      : !input.queueSendingAvailable
        ? `Encontrei ${leads.length} leads em ${input.city} e salvei ${savedCount}. Não coloquei mensagens na fila porque o WhatsApp não está conectado ou o runtime de prospecção não está pronto.`
        : !settings.enabled
          ? `Encontrei ${leads.length} leads em ${input.city} e salvei ${savedCount}. A fila está pausada, então nenhum contato foi agendado para envio.`
          : availableSlots === 0
            ? `Encontrei ${leads.length} leads em ${input.city} e salvei ${savedCount}. O limite diário já está reservado por envios feitos ou itens que aguardam na fila.`
            : `Encontrei ${leads.length} leads em ${input.city} e salvei ${savedCount}, mas não achei novos contatos elegíveis para a fila.`
    const completedCampaign = await prospectingStore.finishDailyCampaign(input.userId, campaign.id, {
      searched: leads.length,
      saved: savedCount,
      queued: queuedCount,
      summary: unsaved > 0 ? `${message} ${unsaved} não puderam ser salvos nesta rodada.` : message,
    })
    return { campaign: completedCampaign, searchedCount: leads.length, savedCount, queuedCount }
  } catch (error) {
    await prospectingStore.failDailyCampaign(
      input.userId,
      campaign.id,
      'campaign_processing_failed',
      error instanceof Error ? `Não consegui concluir a busca agora. ${error.message}` : 'Não consegui concluir a busca agora. Tente novamente em instantes.',
    )
    throw error
  }
}
