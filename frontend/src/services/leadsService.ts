import type { Lead, LeadUpdate, SearchLeadsResponse } from '../types'
import type { CreateSaleInput, Sale } from '../types/sales'

type SearchLeadsParams = {
  city: string
  segment: string
}

const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001/api'

export async function searchLeads({ city, segment }: SearchLeadsParams): Promise<SearchLeadsResponse> {
  const params = new URLSearchParams({ city, segment })
  const response = await fetch(`${apiBaseUrl}/leads?${params.toString()}`)

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível buscar os leads.')
  }

  return response.json() as Promise<SearchLeadsResponse>
}

export async function getSavedLeads(): Promise<Lead[]> {
  const response = await fetch(`${apiBaseUrl}/saved-leads`)

  if (!response.ok) {
    throw new Error('Não foi possível carregar os leads salvos.')
  }

  const payload = await response.json() as { data: Lead[] }
  return payload.data
}

export async function saveLead(leadId: string): Promise<Lead> {
  const response = await fetch(`${apiBaseUrl}/leads/${encodeURIComponent(leadId)}/save`, { method: 'POST' })

  if (!response.ok) {
    throw new Error('Não foi possível salvar este lead.')
  }

  const payload = await response.json() as { data: Lead }
  return payload.data
}

export async function removeSavedLead(leadId: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/leads/${encodeURIComponent(leadId)}/save`, { method: 'DELETE' })

  if (!response.ok) {
    throw new Error('Não foi possível remover este lead dos salvos.')
  }
}

export async function updateLead(leadId: string, changes: LeadUpdate): Promise<Lead> {
  const response = await fetch(`${apiBaseUrl}/leads/${encodeURIComponent(leadId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível atualizar este lead.')
  }

  const payload = await response.json() as { data: Lead }
  return payload.data
}

export async function getSales(): Promise<Sale[]> {
  const response = await fetch(`${apiBaseUrl}/sales`)

  if (!response.ok) {
    throw new Error('Não foi possível carregar o histórico financeiro.')
  }

  const payload = await response.json() as { data: Sale[] }
  return payload.data
}

export async function createSale(input: CreateSaleInput): Promise<Sale> {
  const response = await fetch(`${apiBaseUrl}/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error ?? 'Não foi possível registrar a venda.')
  }

  const payload = await response.json() as { data: Sale }
  return payload.data
}

export type { Lead }
