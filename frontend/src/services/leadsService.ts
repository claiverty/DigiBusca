import type { Lead, LeadUpdate, OpportunityType, SearchLeadsResponse } from '../types'
import type { CreateSaleInput, Sale } from '../types/sales'
import { supabase } from '../lib/supabase'

type SearchLeadsParams = {
  city: string
  segment: string
  opportunity?: OpportunityType
  pageToken?: string
}

export type SavedLeadState = {
  leadId: string
  status: Lead['status']
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

const apiBaseUrl = import.meta.env.VITE_API_URL ?? '/api'

export async function authenticatedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!supabase) {
    throw new Error('O Supabase ainda não está configurado.')
  }

  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) {
    throw new Error('Sua sessão expirou. Faça login novamente.')
  }

  const requestWithSession = (accessToken: string) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${accessToken}`)
    return fetch(input, { ...init, headers })
  }

  const response = await requestWithSession(data.session.access_token)

  if (response.status !== 401) {
    return response
  }

  const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError || !refreshedData.session) {
    throw new Error('Sua sessão expirou. Faça login novamente.')
  }

  return requestWithSession(refreshedData.session.access_token)
}

export async function searchLeads({
  city,
  segment,
  opportunity,
  pageToken,
}: SearchLeadsParams): Promise<SearchLeadsResponse> {
  const params = new URLSearchParams({
    city,
    segment,
    ...(opportunity ? { opportunity } : {}),
    ...(pageToken ? { pageToken } : {}),
  })
  const response = await authenticatedFetch(`${apiBaseUrl}/leads?${params.toString()}`)

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível buscar os leads.')
  }

  return response.json() as Promise<SearchLeadsResponse>
}

export async function getSavedLeads(): Promise<SavedLeadState[]> {
  const response = await authenticatedFetch(`${apiBaseUrl}/saved-leads`)

  if (!response.ok) {
    throw new Error('Não foi possível carregar os leads salvos.')
  }

  const payload = (await response.json()) as { data: SavedLeadState[] }
  return payload.data
}

export async function getSavedLead(leadId: string): Promise<Lead> {
  const response = await authenticatedFetch(`${apiBaseUrl}/saved-leads/${encodeURIComponent(leadId)}`)

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível abrir este lead.')
  }

  const payload = (await response.json()) as { data: Lead }
  return payload.data
}

export async function getSavedLeadIds(): Promise<string[]> {
  const response = await authenticatedFetch(`${apiBaseUrl}/saved-lead-ids`)

  if (!response.ok) {
    throw new Error('Não foi possível carregar seus leads salvos.')
  }

  const payload = (await response.json()) as { data: SavedLeadState[] }
  return payload.data.map((lead) => lead.leadId)
}

function mergeSavedLeadState(lead: Lead, state: SavedLeadState): Lead {
  const { leadId: _leadId, ...changes } = state
  return { ...lead, ...changes }
}

export async function saveLead(lead: Lead): Promise<Lead> {
  const response = await authenticatedFetch(`${apiBaseUrl}/leads/${encodeURIComponent(lead.id)}/save`, {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error('Não foi possível salvar este lead.')
  }

  const payload = (await response.json()) as { data: SavedLeadState }
  return mergeSavedLeadState(lead, payload.data)
}

export async function removeSavedLead(leadId: string): Promise<void> {
  const response = await authenticatedFetch(`${apiBaseUrl}/leads/${encodeURIComponent(leadId)}/save`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error('Não foi possível remover este lead dos salvos.')
  }
}

export async function updateLead(lead: Lead, changes: LeadUpdate): Promise<Lead> {
  const response = await authenticatedFetch(`${apiBaseUrl}/leads/${encodeURIComponent(lead.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível atualizar este lead.')
  }

  const payload = (await response.json()) as { data: SavedLeadState }
  return mergeSavedLeadState(lead, payload.data)
}

export async function getSales(): Promise<Sale[]> {
  const response = await authenticatedFetch(`${apiBaseUrl}/sales`)

  if (!response.ok) {
    throw new Error('Não foi possível carregar o histórico financeiro.')
  }

  const payload = (await response.json()) as { data: Sale[] }
  return payload.data
}

export async function getGoogleApiUsage(): Promise<GoogleApiUsage> {
  const response = await authenticatedFetch(`${apiBaseUrl}/google-api-usage`)

  if (!response.ok) {
    throw new Error('Não foi possível carregar o contador de uso do Google.')
  }

  const payload = (await response.json()) as { data: GoogleApiUsage }
  return payload.data
}

export async function createSale(input: CreateSaleInput): Promise<Sale> {
  const response = await authenticatedFetch(`${apiBaseUrl}/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível registrar a venda.')
  }

  const payload = (await response.json()) as { data: Sale }
  return payload.data
}

export type { Lead }
