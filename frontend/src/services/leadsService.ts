import type { Lead, SearchLeadsResponse } from '../types'

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

export type { Lead }
