import type { SearchLeadsQuery, Lead } from '../contracts/lead.js'
import type { LeadProvider } from '../application/searchLeads.js'

export class MockLeadProvider implements LeadProvider {
  constructor(private readonly leads: Lead[]) {}

  async search(_query: SearchLeadsQuery): Promise<Lead[]> {
    return this.leads
  }

  async findById(id: string): Promise<Lead | undefined> {
    return this.leads.find((lead) => lead.id === id)
  }
}
