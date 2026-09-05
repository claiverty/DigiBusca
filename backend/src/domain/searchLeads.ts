import type { Lead, SearchLeadsQuery } from '../contracts/lead.js'

export function searchLeads(leads: Lead[], query: SearchLeadsQuery): Lead[] {
  // Location and segment filtering are performed by the external provider.
  // The opportunity type is derived from returned public data, so it is applied here.
  const matchingLeads = query.opportunity
    ? leads.filter((lead) => lead.opportunity === query.opportunity)
    : leads

  return [...matchingLeads].sort((left, right) => right.score - left.score)
}
