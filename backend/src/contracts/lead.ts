export const opportunityTypes = ['Sem site', 'Site identificado', 'Perfil incompleto'] as const
export type OpportunityType = (typeof opportunityTypes)[number]
export type LeadStatus = 'Novo' | 'Contatado' | 'Respondeu' | 'Proposta' | 'Ganhou' | 'Perdeu'

export type Lead = {
  id: string
  name: string
  category: string
  address: string
  phone: string
  rating: number
  reviews: number
  website?: string
  googleMapsUri?: string
  source: 'Google Maps'
  retrievedAt: string
  opportunity: OpportunityType
  score: number
  diagnosis: string
  status: LeadStatus
  notes?: string
  nextFollowUp?: string
  draftMessage?: string
}

export type LeadSnapshot = Pick<
  Lead,
  | 'id'
  | 'name'
  | 'category'
  | 'address'
  | 'phone'
  | 'rating'
  | 'reviews'
  | 'website'
  | 'googleMapsUri'
  | 'source'
  | 'retrievedAt'
  | 'opportunity'
  | 'score'
  | 'diagnosis'
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseLeadSnapshot(value: unknown, leadId: string): LeadSnapshot | undefined {
  if (!isRecord(value)) return undefined

  const { id, name, category, address, phone, rating, reviews, website, googleMapsUri, source, retrievedAt, opportunity, score, diagnosis } = value
  if (
    id !== leadId ||
    typeof name !== 'string' || !name.trim() || name.length > 300 ||
    typeof category !== 'string' || !category.trim() || category.length > 200 ||
    typeof address !== 'string' || address.length > 500 ||
    typeof phone !== 'string' || phone.length > 100 ||
    typeof rating !== 'number' || !Number.isFinite(rating) || rating < 0 || rating > 5 ||
    typeof reviews !== 'number' || !Number.isInteger(reviews) || reviews < 0 ||
    (website !== undefined && (typeof website !== 'string' || website.length > 2_000)) ||
    (googleMapsUri !== undefined && (typeof googleMapsUri !== 'string' || googleMapsUri.length > 2_000)) ||
    source !== 'Google Maps' ||
    typeof retrievedAt !== 'string' || Number.isNaN(Date.parse(retrievedAt)) ||
    !opportunityTypes.includes(opportunity as OpportunityType) ||
    typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100 ||
    typeof diagnosis !== 'string' || diagnosis.length > 2_000
  ) {
    return undefined
  }

  return {
    id,
    name: name.trim(),
    category: category.trim(),
    address: address.trim(),
    phone: phone.trim(),
    rating,
    reviews,
    ...(website ? { website } : {}),
    ...(googleMapsUri ? { googleMapsUri } : {}),
    source,
    retrievedAt,
    opportunity: opportunity as OpportunityType,
    score,
    diagnosis: diagnosis.trim(),
  }
}

export type LeadUpdate = Pick<Lead, 'status' | 'notes' | 'nextFollowUp' | 'draftMessage'>

export type SearchLeadsQuery = {
  city: string
  segment?: string
  opportunity?: OpportunityType
  languageCode?: string
  regionCode?: string
  pageToken?: string
}

export type SearchLeadsResponse = {
  data: Lead[]
  meta: {
    total: number
    city: string
    segment: string
    nextPageToken?: string
  }
}
