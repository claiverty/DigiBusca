import type { SupabaseClient } from '@supabase/supabase-js'
import type { LeadStatus } from '../contracts/lead.js'
import type { CreateSaleInput, Sale } from '../contracts/sale.js'
import type {
  CreateLeadInteractionInput,
  InteractionChannel,
  LeadInteraction,
} from '../contracts/interaction.js'
import { createUserSupabaseClient } from '../config/supabase.js'
import type { GooglePlacesRequestType } from '../integrations/googlePlacesProvider.js'

type SavedLeadRow = {
  lead_id: string
  status: LeadStatus
  notes: string | null
  next_follow_up: string | null
  draft_message: string | null
  updated_at: string
}

type SaleRow = {
  id: string
  lead_id: string | null
  business_name: string
  service: string
  amount: number | string
  sold_at: string
}

type GoogleApiUsageRow = {
  requests_today: number | string
  requests_this_month: number | string
  text_search_requests: number | string
  place_details_requests: number | string
  historical_requests: number | string
  monthly_limit: number | string
}

type LeadInteractionRow = {
  id: string
  lead_id: string
  channel: InteractionChannel
  occurred_at: string
  notes: string
  outcome: string | null
  created_at: string
}

export type SavedLeadState = {
  leadId: string
  status: LeadStatus
  notes?: string
  nextFollowUp?: string
  draftMessage?: string
  updatedAt: string
}

export type GoogleApiUsage = {
  requestsToday: number
  requestsThisMonth: number
  textSearchRequests: number
  placeDetailsRequests: number
  historicalRequests: number
  monthlyLimit: number
}

function mapSavedLeadState(row: SavedLeadRow): SavedLeadState {
  return {
    leadId: row.lead_id,
    status: row.status,
    notes: row.notes ?? undefined,
    nextFollowUp: row.next_follow_up ?? undefined,
    draftMessage: row.draft_message ?? undefined,
    updatedAt: row.updated_at,
  }
}

function mapSale(row: SaleRow): Sale {
  return {
    id: row.id,
    ...(row.lead_id ? { leadId: row.lead_id } : {}),
    businessName: row.business_name,
    service: row.service,
    amount: Number(row.amount),
    soldAt: row.sold_at,
  }
}

function mapLeadInteraction(row: LeadInteractionRow): LeadInteraction {
  return {
    id: row.id,
    leadId: row.lead_id,
    channel: row.channel,
    occurredAt: row.occurred_at,
    notes: row.notes,
    outcome: row.outcome ?? undefined,
    createdAt: row.created_at,
  }
}

function throwIfError(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message)
  }
}

export class SupabaseStore {
  private client(accessToken: string): SupabaseClient {
    return createUserSupabaseClient(accessToken)
  }

  async listSavedLeadStates(accessToken: string, userId: string): Promise<SavedLeadState[]> {
    const { data, error } = await this.client(accessToken)
      .from('saved_leads')
      .select('lead_id, status, notes, next_follow_up, draft_message, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })

    throwIfError(error)
    return (data as SavedLeadRow[]).map(mapSavedLeadState)
  }

  async saveLeadState(
    accessToken: string,
    userId: string,
    leadId: string,
    changes: Partial<Omit<SavedLeadState, 'leadId'>> = {},
  ): Promise<SavedLeadState> {
    const { data, error } = await this.client(accessToken)
      .from('saved_leads')
      .upsert(
        {
          user_id: userId,
          lead_id: leadId,
          // Only the Google Place ID is stored permanently. Business details stay in the
          // active browser session and are requested from Google only when necessary.
          lead_data: { id: leadId },
          status: changes.status ?? 'Novo',
          notes: changes.notes ?? null,
          next_follow_up: changes.nextFollowUp ?? null,
          draft_message: changes.draftMessage ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,lead_id' },
      )
      .select('lead_id, status, notes, next_follow_up, draft_message, updated_at')
      .single()

    throwIfError(error)
    return mapSavedLeadState(data as SavedLeadRow)
  }

  async getSavedLeadState(
    accessToken: string,
    userId: string,
    leadId: string,
  ): Promise<SavedLeadState | undefined> {
    const { data, error } = await this.client(accessToken)
      .from('saved_leads')
      .select('lead_id, status, notes, next_follow_up, draft_message, updated_at')
      .eq('user_id', userId)
      .eq('lead_id', leadId)
      .maybeSingle()

    throwIfError(error)
    return data ? mapSavedLeadState(data as SavedLeadRow) : undefined
  }

  async removeSavedLead(accessToken: string, userId: string, leadId: string): Promise<void> {
    const { error } = await this.client(accessToken)
      .from('saved_leads')
      .delete()
      .eq('user_id', userId)
      .eq('lead_id', leadId)

    throwIfError(error)
  }

  async listLeadInteractions(
    accessToken: string,
    userId: string,
    leadId: string,
  ): Promise<LeadInteraction[]> {
    const { data, error } = await this.client(accessToken)
      .from('lead_interactions')
      .select('id, lead_id, channel, occurred_at, notes, outcome, created_at')
      .eq('user_id', userId)
      .eq('lead_id', leadId)
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false })

    throwIfError(error)
    return (data as LeadInteractionRow[]).map(mapLeadInteraction)
  }

  async createLeadInteraction(
    accessToken: string,
    userId: string,
    leadId: string,
    input: CreateLeadInteractionInput,
  ): Promise<LeadInteraction> {
    const { data, error } = await this.client(accessToken)
      .from('lead_interactions')
      .insert({
        user_id: userId,
        lead_id: leadId,
        channel: input.channel,
        occurred_at: input.occurredAt,
        notes: input.notes,
        outcome: input.outcome || null,
      })
      .select('id, lead_id, channel, occurred_at, notes, outcome, created_at')
      .single()

    throwIfError(error)
    return mapLeadInteraction(data as LeadInteractionRow)
  }

  async listSales(accessToken: string, userId: string): Promise<Sale[]> {
    const { data, error } = await this.client(accessToken)
      .from('sales')
      .select('id, lead_id, business_name, service, amount, sold_at')
      .eq('user_id', userId)
      .order('sold_at', { ascending: false })

    throwIfError(error)
    return (data as SaleRow[]).map(mapSale)
  }

  async createSale(accessToken: string, userId: string, input: CreateSaleInput): Promise<Sale> {
    const { data, error } = await this.client(accessToken)
      .from('sales')
      .insert({
        user_id: userId,
        lead_id: input.leadId ?? null,
        business_name: input.businessName,
        service: input.service,
        amount: input.amount,
        sold_at: input.soldAt,
      })
      .select('id, lead_id, business_name, service, amount, sold_at')
      .single()

    throwIfError(error)
    return mapSale(data as SaleRow)
  }

  async recordGoogleApiCall(accessToken: string, requestType: GooglePlacesRequestType): Promise<void> {
    const { error } = await this.client(accessToken).rpc('increment_google_api_usage', {
      google_request_type: requestType,
    })
    throwIfError(error)
  }

  async getGoogleApiUsage(accessToken: string): Promise<GoogleApiUsage> {
    const { data, error } = await this.client(accessToken).rpc('get_google_api_usage')
    throwIfError(error)

    const usage = (data as GoogleApiUsageRow[] | null)?.[0]
    return {
      requestsToday: Number(usage?.requests_today ?? 0),
      requestsThisMonth: Number(usage?.requests_this_month ?? 0),
      textSearchRequests: Number(usage?.text_search_requests ?? 0),
      placeDetailsRequests: Number(usage?.place_details_requests ?? 0),
      historicalRequests: Number(usage?.historical_requests ?? 0),
      monthlyLimit: Number(usage?.monthly_limit ?? 1000),
    }
  }
}
