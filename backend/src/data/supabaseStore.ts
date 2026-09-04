import type { SupabaseClient } from '@supabase/supabase-js'
import type { Lead, LeadStatus } from '../contracts/lead.js'
import type { CreateSaleInput, Sale } from '../contracts/sale.js'
import { createUserSupabaseClient } from '../config/supabase.js'

type SavedLeadRow = {
  lead_id: string
  lead_data: Lead
  status: LeadStatus
  notes: string | null
  next_follow_up: string | null
  draft_message: string | null
}

type SaleRow = {
  id: string
  lead_id: string | null
  business_name: string
  service: string
  amount: number | string
  sold_at: string
}

function mapSavedLead(row: SavedLeadRow): Lead {
  return {
    ...row.lead_data,
    status: row.status,
    notes: row.notes ?? undefined,
    nextFollowUp: row.next_follow_up ?? undefined,
    draftMessage: row.draft_message ?? undefined,
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

function throwIfError(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message)
  }
}

export class SupabaseStore {
  private client(accessToken: string): SupabaseClient {
    return createUserSupabaseClient(accessToken)
  }

  async listSavedLeads(accessToken: string, userId: string): Promise<Lead[]> {
    const { data, error } = await this.client(accessToken)
      .from('saved_leads')
      .select('lead_id, lead_data, status, notes, next_follow_up, draft_message')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })

    throwIfError(error)
    return (data as SavedLeadRow[]).map(mapSavedLead)
  }

  async saveLead(accessToken: string, userId: string, lead: Lead): Promise<Lead> {
    const { data, error } = await this.client(accessToken)
      .from('saved_leads')
      .upsert(
        {
          user_id: userId,
          lead_id: lead.id,
          lead_data: lead,
          status: lead.status,
          notes: lead.notes ?? null,
          next_follow_up: lead.nextFollowUp ?? null,
          draft_message: lead.draftMessage ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,lead_id' },
      )
      .select('lead_id, lead_data, status, notes, next_follow_up, draft_message')
      .single()

    throwIfError(error)
    return mapSavedLead(data as SavedLeadRow)
  }

  async getSavedLead(accessToken: string, userId: string, leadId: string): Promise<Lead | undefined> {
    const { data, error } = await this.client(accessToken)
      .from('saved_leads')
      .select('lead_id, lead_data, status, notes, next_follow_up, draft_message')
      .eq('user_id', userId)
      .eq('lead_id', leadId)
      .maybeSingle()

    throwIfError(error)
    return data ? mapSavedLead(data as SavedLeadRow) : undefined
  }

  async removeSavedLead(accessToken: string, userId: string, leadId: string): Promise<void> {
    const { error } = await this.client(accessToken)
      .from('saved_leads')
      .delete()
      .eq('user_id', userId)
      .eq('lead_id', leadId)

    throwIfError(error)
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
}
