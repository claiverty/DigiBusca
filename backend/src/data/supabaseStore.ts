import type { SupabaseClient } from '@supabase/supabase-js'
import type { Lead, LeadSnapshot, LeadStatus } from '../contracts/lead.js'
import type { CreateSaleInput, Sale, UpdateSaleInput } from '../contracts/sale.js'
import type {
  CreateLeadInteractionInput,
  InteractionChannel,
  LeadInteraction,
} from '../contracts/interaction.js'
import { createUserSupabaseClient } from '../config/supabase.js'
import type {
  GooglePlacesRequestType,
  GoogleRequestReservation,
} from '../integrations/googlePlacesProvider.js'

type SavedLeadRow = {
  lead_id: string
  lead_data: LeadSnapshot | { id: string } | null
  lead_data_expires_at: string | null
  status: LeadStatus
  notes: string | null
  next_follow_up: string | null
  conversation_stage: string | null
  contact_name: string | null
  next_action: string | null
  draft_message: string | null
  whatsapp_consent_status?: 'unknown' | 'opted_in' | 'opted_out' | null
  whatsapp_consent_source?: string | null
  whatsapp_consent_at?: string | null
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
  lead?: LeadSnapshot
  leadDataExpiresAt?: string
  status: LeadStatus
  notes?: string
  nextFollowUp?: string
  conversationStage?: string
  contactName?: string
  nextAction?: string
  draftMessage?: string
  whatsappConsentStatus: 'unknown' | 'opted_in' | 'opted_out'
  whatsappConsentSource?: string
  whatsappConsentAt?: string
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
  const hasValidSnapshot = row.lead_data && row.lead_data_expires_at
    && new Date(row.lead_data_expires_at).getTime() > Date.now()
    && 'name' in row.lead_data

  return {
    leadId: row.lead_id,
    ...(hasValidSnapshot ? { lead: row.lead_data as LeadSnapshot, leadDataExpiresAt: row.lead_data_expires_at! } : {}),
    status: row.status,
    notes: row.notes ?? undefined,
    nextFollowUp: row.next_follow_up ?? undefined,
    conversationStage: row.conversation_stage ?? undefined,
    contactName: row.contact_name ?? undefined,
    nextAction: row.next_action ?? undefined,
    draftMessage: row.draft_message ?? undefined,
    whatsappConsentStatus: row.whatsapp_consent_status ?? 'unknown',
    whatsappConsentSource: row.whatsapp_consent_source ?? undefined,
    whatsappConsentAt: row.whatsapp_consent_at ?? undefined,
    updatedAt: row.updated_at,
  }
}

const leadSnapshotTtlMs = 30 * 24 * 60 * 60 * 1_000

function getSnapshotExpiry() {
  return new Date(Date.now() + leadSnapshotTtlMs).toISOString()
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

const savedLeadSelect = 'lead_id, lead_data, lead_data_expires_at, status, notes, next_follow_up, draft_message, conversation_stage, contact_name, next_action, whatsapp_consent_status, whatsapp_consent_source, whatsapp_consent_at, updated_at'
const savedLeadLegacySelect = 'lead_id, lead_data, lead_data_expires_at, status, notes, next_follow_up, draft_message, conversation_stage, contact_name, next_action, updated_at'

function isMissingWhatsAppConsentColumns(error: { code?: string; message: string } | null): boolean {
  if (!error || !/whatsapp_consent_(status|source|at)/i.test(error.message)) return false
  return error.code === '42703' || error.code === 'PGRST204' || /does not exist|schema cache|could not find/i.test(error.message)
}

export class WhatsAppConsentSchemaMissingError extends Error {
  constructor() {
    super('Aplique a migration 008 do WhatsApp no Supabase para salvar o consentimento deste contato.')
  }
}

export class SupabaseStore {
  private client(accessToken: string): SupabaseClient {
    return createUserSupabaseClient(accessToken)
  }

  async listSavedLeadStates(accessToken: string, userId: string): Promise<SavedLeadState[]> {
    const store = this.client(accessToken)
    const currentResult = await store
      .from('saved_leads')
      .select(savedLeadSelect)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
    let data: unknown = currentResult.data
    let error = currentResult.error as { code?: string; message: string } | null

    if (isMissingWhatsAppConsentColumns(error)) {
      const legacyResult = await store
        .from('saved_leads')
        .select(savedLeadLegacySelect)
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
      data = legacyResult.data
      error = legacyResult.error
    }

    throwIfError(error)
    return (data as SavedLeadRow[]).map(mapSavedLeadState)
  }

  async saveLeadState(
    accessToken: string,
    userId: string,
    leadId: string,
    lead?: LeadSnapshot,
    changes: Partial<Omit<SavedLeadState, 'leadId'>> = {},
  ): Promise<SavedLeadState> {
    const store = this.client(accessToken)
    let hasWhatsAppConsentColumns = true
    const existingResult = await store
      .from('saved_leads')
      .select(savedLeadSelect)
      .eq('user_id', userId)
      .eq('lead_id', leadId)
      .maybeSingle()
    let existingData: unknown = existingResult.data
    let existingError = existingResult.error as { code?: string; message: string } | null

    if (isMissingWhatsAppConsentColumns(existingError)) {
      hasWhatsAppConsentColumns = false
      const legacyResult = await store
        .from('saved_leads')
        .select(savedLeadLegacySelect)
        .eq('user_id', userId)
        .eq('lead_id', leadId)
        .maybeSingle()
      existingData = legacyResult.data
      existingError = legacyResult.error
    }

    throwIfError(existingError)

    if (!hasWhatsAppConsentColumns && (
      changes.whatsappConsentStatus === 'opted_in' ||
      changes.whatsappConsentStatus === 'opted_out' ||
      Boolean(changes.whatsappConsentSource?.trim()) ||
      Boolean(changes.whatsappConsentAt?.trim())
    )) {
      throw new WhatsAppConsentSchemaMissingError()
    }

    const now = new Date().toISOString()
    const payload = {
      ...(lead ? { lead_data: lead, lead_data_expires_at: getSnapshotExpiry() } : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      ...(changes.notes !== undefined ? { notes: changes.notes || null } : {}),
      ...(changes.nextFollowUp !== undefined ? { next_follow_up: changes.nextFollowUp || null } : {}),
      ...(changes.draftMessage !== undefined ? { draft_message: changes.draftMessage || null } : {}),
      ...(changes.conversationStage !== undefined ? { conversation_stage: changes.conversationStage || null } : {}),
      ...(changes.contactName !== undefined ? { contact_name: changes.contactName || null } : {}),
      ...(changes.nextAction !== undefined ? { next_action: changes.nextAction || null } : {}),
      ...(hasWhatsAppConsentColumns && changes.whatsappConsentStatus !== undefined ? { whatsapp_consent_status: changes.whatsappConsentStatus } : {}),
      ...(hasWhatsAppConsentColumns && changes.whatsappConsentSource !== undefined ? { whatsapp_consent_source: changes.whatsappConsentSource || null } : {}),
      ...(hasWhatsAppConsentColumns && changes.whatsappConsentAt !== undefined ? { whatsapp_consent_at: changes.whatsappConsentAt || null } : {}),
      updated_at: now,
    }

    const query = existingData
      ? store.from('saved_leads').update(payload).eq('user_id', userId).eq('lead_id', leadId)
      : store.from('saved_leads').insert({
          user_id: userId,
          lead_id: leadId,
          lead_data: lead ?? { id: leadId },
          lead_data_expires_at: lead ? getSnapshotExpiry() : null,
          status: changes.status ?? 'Novo',
          notes: changes.notes || null,
          next_follow_up: changes.nextFollowUp || null,
          draft_message: changes.draftMessage || null,
          conversation_stage: changes.conversationStage || null,
          contact_name: changes.contactName || null,
          next_action: changes.nextAction || null,
          ...(hasWhatsAppConsentColumns ? {
            whatsapp_consent_status: changes.whatsappConsentStatus ?? 'unknown',
            whatsapp_consent_source: changes.whatsappConsentSource || null,
            whatsapp_consent_at: changes.whatsappConsentAt || null,
          } : {}),
          updated_at: now,
        })

    let savedData: unknown
    let savedError: { message: string } | null
    if (hasWhatsAppConsentColumns) {
      const savedResult = await query.select(savedLeadSelect).single()
      savedData = savedResult.data
      savedError = savedResult.error
    } else {
      const savedResult = await query.select(savedLeadLegacySelect).single()
      savedData = savedResult.data
      savedError = savedResult.error
    }

    throwIfError(savedError)
    return mapSavedLeadState(savedData as SavedLeadRow)
  }

  async getSavedLeadState(
    accessToken: string,
    userId: string,
    leadId: string,
  ): Promise<SavedLeadState | undefined> {
    const store = this.client(accessToken)
    const currentResult = await store
      .from('saved_leads')
      .select(savedLeadSelect)
      .eq('user_id', userId)
      .eq('lead_id', leadId)
      .maybeSingle()
    let data: unknown = currentResult.data
    let error = currentResult.error as { code?: string; message: string } | null

    if (isMissingWhatsAppConsentColumns(error)) {
      const legacyResult = await store
        .from('saved_leads')
        .select(savedLeadLegacySelect)
        .eq('user_id', userId)
        .eq('lead_id', leadId)
        .maybeSingle()
      data = legacyResult.data
      error = legacyResult.error
    }

    throwIfError(error)
    return data ? mapSavedLeadState(data as SavedLeadRow) : undefined
  }

  async refreshSavedLeadSnapshot(
    accessToken: string,
    userId: string,
    lead: Lead,
  ): Promise<void> {
    const { status: _status, notes: _notes, nextFollowUp: _nextFollowUp, draftMessage: _draftMessage, conversationStage: _stage, contactName: _contact, nextAction: _action, whatsappConsentStatus: _consentStatus, whatsappConsentSource: _consentSource, whatsappConsentAt: _consentAt, ...snapshot } = lead
    const { error } = await this.client(accessToken)
      .from('saved_leads')
      .update({
        lead_data: snapshot,
        lead_data_expires_at: getSnapshotExpiry(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('lead_id', lead.id)

    throwIfError(error)
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

  async updateSale(
    accessToken: string,
    userId: string,
    saleId: string,
    input: UpdateSaleInput,
  ): Promise<Sale | undefined> {
    const { data, error } = await this.client(accessToken)
      .from('sales')
      .update({
        business_name: input.businessName,
        service: input.service,
        amount: input.amount,
        sold_at: input.soldAt,
      })
      .eq('id', saleId)
      .eq('user_id', userId)
      .select('id, lead_id, business_name, service, amount, sold_at')
      .maybeSingle()

    throwIfError(error)
    return data ? mapSale(data as SaleRow) : undefined
  }

  async deleteSale(accessToken: string, userId: string, saleId: string): Promise<boolean> {
    const { data, error } = await this.client(accessToken)
      .from('sales')
      .delete()
      .eq('id', saleId)
      .eq('user_id', userId)
      .select('id')

    throwIfError(error)
    return Array.isArray(data) && data.length > 0
  }

  async reserveGoogleApiRequest(
    accessToken: string,
    requestType: GooglePlacesRequestType,
  ): Promise<GoogleRequestReservation> {
    const client = this.client(accessToken)
    const { data, error } = await client.rpc('reserve_google_api_usage', {
      google_request_type: requestType,
    })

    if (error?.code === 'PGRST202' && error.message.includes('reserve_google_api_usage')) {
      // Older Supabase deployments only had best-effort usage tracking; keep Places requests available.
      await client.rpc('increment_google_api_usage', { google_request_type: requestType })
      return 'reserved'
    }

    throwIfError(error)
    if (data !== 'reserved' && data !== 'reserved_at_limit' && data !== 'blocked') {
      throw new Error('Não foi possível confirmar o limite mensal de consultas do Google.')
    }
    return data
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
