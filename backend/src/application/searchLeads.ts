import type { Lead, SearchLeadsQuery, SearchLeadsResponse } from '../contracts/lead.js'
import { searchLeads } from '../domain/searchLeads.js'

export interface LeadProvider {
  search(query: SearchLeadsQuery): Promise<Lead[]>
}

export async function executeSearchLeads(provider: LeadProvider, query: SearchLeadsQuery): Promise<SearchLeadsResponse> {
  const candidates = await provider.search(query)
  const data = searchLeads(candidates, query)

  return {
    data,
    meta: {
      total: data.length,
      city: query.city,
      segment: query.segment ?? 'Todos os segmentos',
    },
  }
}
