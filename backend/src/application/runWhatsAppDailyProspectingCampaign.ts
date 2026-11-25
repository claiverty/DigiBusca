import type { Lead, SearchLeadsResponse } from '../contracts/lead.js'
import type { SupabaseStore, SavedLeadState } from '../data/supabaseStore.js'
import type { WhatsAppProspectingStore, WhatsAppDailyProspectingCampaign } from '../data/whatsappProspectingStore.js'
import type { LeadProvider } from './searchLeads.js'
import { executeSearchLeads } from './searchLeads.js'
import { buildWhatsAppProspectingOpening } from '../domain/whatsappProspectingOpening.js'

const maxSearchPages = 3

export type DailyProspectingCampaignResult = {
  campaign: WhatsAppDailyProspectingCampaign
  searchedCount: number
  savedCount: number
  candidateCount: number
  queuedCount: number
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
        opportunity: 'Sem site',
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
    let candidateCount = 0
    for (let index = 0; index < savedResults.length; index += 1) {
      const { lead, saved } = savedResults[index]
      if (
        !saved || saved.status !== 'Novo' || saved.whatsappConsentStatus === 'opted_out' || !lead.phone.trim() ||
        !(
          (saved.whatsappConsentStatus === 'opted_in' && Boolean(saved.whatsappConsentSource?.trim()) && Boolean(saved.whatsappConsentAt)) ||
          (saved.whatsappOutboundAuthorizationStatus === 'authorized_by_owner' && Boolean(saved.whatsappOutboundAuthorizationSource?.trim()) && Boolean(saved.whatsappOutboundAuthorizationAt))
        )
      ) continue

      const message = buildWhatsAppProspectingOpening(lead.name, index)
      try {
        await input.persistenceStore.saveLeadState(input.accessToken, input.userId, lead.id, undefined, { draftMessage: message })
        candidateCount += 1
      } catch {
        // Keep unsaved drafts out of the candidate count; no queue or send is created here.
      }
    }

    const unsaved = Math.max(0, leads.length - savedCount)
    const message = `Encontrei ${leads.length} empresas sem site informado no Google em ${input.city}, salvei ${savedCount} e preparei ${candidateCount} candidatas para sua seleção. Nenhuma entrou na fila nem será enviada pela busca.`
    const completedCampaign = await prospectingStore.finishDailyCampaign(input.userId, campaign.id, {
      searched: leads.length,
      saved: savedCount,
      queued: 0,
      summary: unsaved > 0 ? `${message} ${unsaved} não puderam ser salvos nesta rodada.` : message,
    })
    return { campaign: completedCampaign, searchedCount: leads.length, savedCount, candidateCount, queuedCount: 0 }
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
