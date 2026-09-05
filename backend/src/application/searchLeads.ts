import type { Lead, LeadUpdate, SearchLeadsQuery, SearchLeadsResponse } from '../contracts/lead.js'
import { searchLeads } from '../domain/searchLeads.js'

export type LeadSearchResult = {
  leads: Lead[]
  nextPageToken?: string
}

export interface LeadProvider {
  search(query: SearchLeadsQuery): Promise<LeadSearchResult>
  findById(id: string): Promise<Lead | undefined>
  update(id: string, changes: Partial<LeadUpdate>): Promise<Lead | undefined>
}

export async function executeSearchLeads(
  provider: LeadProvider,
  query: SearchLeadsQuery,
): Promise<SearchLeadsResponse> {
  const result = await provider.search(query)
  const data = searchLeads(result.leads, query)

  return {
    data,
    meta: {
      total: data.length,
      city: query.city,
      segment: query.segment ?? 'Todos os segmentos',
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    },
  }
}
