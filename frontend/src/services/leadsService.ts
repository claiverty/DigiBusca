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

export type { Lead }
