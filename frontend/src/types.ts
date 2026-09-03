export type OpportunityType = 'Sem site' | 'Site desatualizado' | 'Perfil incompleto'

export type Lead = {
  id: string
  name: string
  category: string
  address: string
  phone: string
  rating: number
  reviews: number
  website?: string
  opportunity: OpportunityType
  score: number
  diagnosis: string
}

export type SearchLeadsResponse = {
  data: Lead[]
  meta: {
    total: number
    city: string
    segment: string
  }
}
