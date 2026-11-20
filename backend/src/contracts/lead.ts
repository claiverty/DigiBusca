export const opportunityTypes = ['Sem site', 'Site identificado', 'Perfil incompleto'] as const
export type OpportunityType = (typeof opportunityTypes)[number]
export type LeadStatus = 'Novo' | 'Contatado' | 'Respondeu' | 'Proposta' | 'Ganhou' | 'Perdeu'
export const leadStatuses: LeadStatus[] = ['Novo', 'Contatado', 'Respondeu', 'Proposta', 'Ganhou', 'Perdeu']
export const authorizedGoogleSearchSource = 'Busca DigiBusca/Google configurada pelo titular para retornar leads autorizados ao contato por WhatsApp'

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
  conversationStage?: string
  contactName?: string
  nextAction?: string
  draftMessage?: string
  whatsappConsentStatus?: 'unknown' | 'opted_in' | 'opted_out'
  whatsappConsentSource?: string
  whatsappConsentAt?: string
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

const bulkLeadIdsLimit = 200
const bulkLeadIdLengthLimit = 256

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const ownKeys = Object.keys(value)
  return ownKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function parseBulkLeadIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > bulkLeadIdsLimit) return undefined
  if (!value.every((id) => (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= bulkLeadIdLengthLimit &&
    id.trim() === id &&
    !/\s/u.test(id)
  ))) return undefined

  const leadIds = value as string[]
  return new Set(leadIds).size === leadIds.length ? leadIds : undefined
}

export function parseBulkLeadStatusUpdateInput(value: unknown): { leadIds: string[]; status: LeadStatus } | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ['leadIds', 'status'])) return undefined
  const leadIds = parseBulkLeadIds(value.leadIds)
  if (!leadIds || typeof value.status !== 'string' || !leadStatuses.includes(value.status as LeadStatus)) return undefined
  return { leadIds, status: value.status as LeadStatus }
}

export function parseBulkLeadDeleteInput(value: unknown): { leadIds: string[] } | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ['leadIds'])) return undefined
  const leadIds = parseBulkLeadIds(value.leadIds)
  return leadIds ? { leadIds } : undefined
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

export type LeadUpdate = Pick<Lead, 'status' | 'notes' | 'nextFollowUp' | 'draftMessage' | 'conversationStage' | 'contactName' | 'nextAction' | 'whatsappConsentStatus' | 'whatsappConsentSource' | 'whatsappConsentAt'>

export function parseWhatsAppConsentChanges(value: Record<string, unknown>): Pick<LeadUpdate, 'whatsappConsentStatus' | 'whatsappConsentSource' | 'whatsappConsentAt'> | undefined {
  const consentKeys = ['whatsappConsentStatus', 'whatsappConsentSource', 'whatsappConsentAt'] as const
  if (!consentKeys.some((key) => value[key] !== undefined)) return undefined

  const status = value.whatsappConsentStatus
  if (status !== 'unknown' && status !== 'opted_in' && status !== 'opted_out') return undefined

  if (status !== 'opted_in') {
    return { whatsappConsentStatus: status, whatsappConsentSource: '', whatsappConsentAt: '' }
  }

  const source = typeof value.whatsappConsentSource === 'string' ? value.whatsappConsentSource.trim() : ''
  if (!source || source.length > 250) return undefined

  const suppliedAt = value.whatsappConsentAt
  const consentAt = typeof suppliedAt === 'string' && suppliedAt ? suppliedAt : new Date().toISOString()
  const consentTime = Date.parse(consentAt)
  if (!Number.isFinite(consentTime) || consentTime > Date.now()) return undefined

  return {
    whatsappConsentStatus: 'opted_in',
    whatsappConsentSource: source,
    whatsappConsentAt: new Date(consentTime).toISOString(),
  }
}

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
    monthlyLimitReached?: boolean
    nextPageToken?: string
  }
}
