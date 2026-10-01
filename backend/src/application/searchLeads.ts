import {
  opportunityTypes,
  parseLeadSnapshot,
  type Lead,
  type LeadUpdate,
  type OpportunityType,
  type SearchLeadsQuery,
  type SearchLeadsResponse,
} from '../contracts/lead.js'
import { searchLeads } from '../domain/searchLeads.js'
import { isGoogleApiMonthlyLimitError } from './googleApiUsageLimit.js'

export type LeadSearchResult = {
  leads: Lead[]
  monthlyLimitReached?: boolean
  nextPageToken?: string
}

export interface LeadProvider {
  search(query: SearchLeadsQuery): Promise<LeadSearchResult>
  findById(id: string): Promise<Lead | undefined>
  update(id: string, changes: Partial<LeadUpdate>): Promise<Lead | undefined>
}

const filteredCursorPrefix = 'dbf1.'
const resultPageSize = 20
const maxProviderPagesPerRequest = 3

type FilteredSearchCursor = {
  version: 1
  queryKey: string
  providerPageToken?: string
  pendingLeads: Lead[]
}

const base64UrlAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let encoded = ''

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    const block = (first << 16) | ((second ?? 0) << 8) | (third ?? 0)

    encoded += base64UrlAlphabet[(block >> 18) & 63]
    encoded += base64UrlAlphabet[(block >> 12) & 63]
    if (second !== undefined) encoded += base64UrlAlphabet[(block >> 6) & 63]
    if (third !== undefined) encoded += base64UrlAlphabet[block & 63]
  }

  return encoded
}

function decodeBase64Url(value: string): string | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return undefined

  const bytes: number[] = []
  let bits = 0
  let buffer = 0

  for (const character of value) {
    const digit = base64UrlAlphabet.indexOf(character)
    if (digit < 0) return undefined
    buffer = (buffer << 6) | digit
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 255)
      buffer &= (1 << bits) - 1
    }
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
  } catch {
    return undefined
  }
}

function getQueryKey(query: SearchLeadsQuery): string {
  return JSON.stringify([
    query.city,
    query.segment ?? 'Todos os segmentos',
    query.opportunity ?? '',
    query.languageCode ?? '',
    query.regionCode ?? '',
  ])
}

function serializeLead(lead: Lead): Lead {
  return {
    id: lead.id,
    name: lead.name,
    category: lead.category,
    address: lead.address,
    phone: lead.phone,
    rating: lead.rating,
    reviews: lead.reviews,
    ...(lead.website ? { website: lead.website } : {}),
    ...(lead.googleMapsUri ? { googleMapsUri: lead.googleMapsUri } : {}),
    source: lead.source,
    retrievedAt: lead.retrievedAt,
    opportunity: lead.opportunity,
    score: lead.score,
    diagnosis: lead.diagnosis,
    status: 'Novo',
  }
}

function encodeFilteredCursor(cursor: FilteredSearchCursor): string {
  return `${filteredCursorPrefix}${encodeBase64Url(JSON.stringify(cursor))}`
}

function decodeFilteredCursor(
  token: string,
  query: SearchLeadsQuery,
): FilteredSearchCursor | undefined {
  if (!token.startsWith(filteredCursorPrefix)) return undefined

  const serialized = decodeBase64Url(token.slice(filteredCursorPrefix.length))
  if (!serialized) throw new Error('A continuação desta busca é inválida. Faça uma nova busca.')

  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error('A continuação desta busca é inválida. Faça uma nova busca.')
  }

  if (typeof value !== 'object' || value === null) {
    throw new Error('A continuação desta busca é inválida. Faça uma nova busca.')
  }

  const candidate = value as Record<string, unknown>
  if (
    candidate.version !== 1 ||
    candidate.queryKey !== getQueryKey(query) ||
    (candidate.providerPageToken !== undefined &&
      (typeof candidate.providerPageToken !== 'string' || candidate.providerPageToken.length > 2_048)) ||
    !Array.isArray(candidate.pendingLeads) ||
    candidate.pendingLeads.length > resultPageSize - 1
  ) {
    throw new Error('A continuação desta busca não corresponde aos filtros atuais. Faça uma nova busca.')
  }

  const pendingLeads = candidate.pendingLeads.map((item) => {
    if (typeof item !== 'object' || item === null || typeof (item as Record<string, unknown>).id !== 'string') {
      return undefined
    }
    const snapshot = parseLeadSnapshot(item, (item as Record<string, unknown>).id as string)
    return snapshot ? { ...snapshot, status: 'Novo' as const } : undefined
  })

  if (pendingLeads.some((lead) => !lead)) {
    throw new Error('A continuação desta busca contém dados inválidos. Faça uma nova busca.')
  }

  return {
    version: 1,
    queryKey: candidate.queryKey as string,
    ...(candidate.providerPageToken
      ? { providerPageToken: candidate.providerPageToken as string }
      : {}),
    pendingLeads: pendingLeads as Lead[],
  }
}

async function executeFilteredSearch(
  provider: LeadProvider,
  query: SearchLeadsQuery,
): Promise<SearchLeadsResponse> {
  let providerPageToken: string | undefined
  let pendingLeads: Lead[] = []
  let monthlyLimitReached = false
  let sourceExhausted = false

  if (query.pageToken) {
    const cursor = decodeFilteredCursor(query.pageToken, query)
    if (cursor) {
      providerPageToken = cursor.providerPageToken
      pendingLeads = cursor.pendingLeads
      sourceExhausted = !providerPageToken
    } else {
      // Accept previously issued Google Places page tokens during rollout.
      providerPageToken = query.pageToken
    }
  }

  const visitedTokens = new Set<string>()
  let fetchedPages = 0

  while (
    !sourceExhausted &&
    pendingLeads.length < resultPageSize &&
    fetchedPages < maxProviderPagesPerRequest
  ) {
    if (providerPageToken && visitedTokens.has(providerPageToken)) break
    if (providerPageToken) visitedTokens.add(providerPageToken)

    let result: LeadSearchResult
    try {
      result = await provider.search({
        ...query,
        pageToken: providerPageToken,
        opportunity: undefined,
      })
    } catch (error) {
      if (!isGoogleApiMonthlyLimitError(error) || pendingLeads.length === 0) throw error
      monthlyLimitReached = true
      providerPageToken = undefined
      sourceExhausted = true
      break
    }
    const knownIds = new Set(pendingLeads.map((lead) => lead.id))
    pendingLeads.push(
      ...searchLeads(result.leads, query).filter((lead) => !knownIds.has(lead.id)),
    )
    if (result.monthlyLimitReached) {
      monthlyLimitReached = true
      providerPageToken = undefined
      sourceExhausted = true
      break
    }
    providerPageToken = result.nextPageToken
    fetchedPages += 1
    if (!providerPageToken) {
      sourceExhausted = true
      break
    }
  }

  const data = pendingLeads.slice(0, resultPageSize)
  const remainingLeads = pendingLeads.slice(resultPageSize)
  const nextPageToken =
    remainingLeads.length > 0 || (!monthlyLimitReached && providerPageToken)
      ? encodeFilteredCursor({
          version: 1,
          queryKey: getQueryKey(query),
          ...(providerPageToken ? { providerPageToken } : {}),
          pendingLeads: remainingLeads.map(serializeLead),
        })
      : undefined

  return {
    data,
    meta: {
      total: data.length,
      city: query.city,
      segment: query.segment ?? 'Todos os segmentos',
      ...(monthlyLimitReached ? { monthlyLimitReached: true } : {}),
      ...(nextPageToken ? { nextPageToken } : {}),
    },
  }
}

export async function executeSearchLeads(
  provider: LeadProvider,
  query: SearchLeadsQuery,
): Promise<SearchLeadsResponse> {
  if (query.opportunity && opportunityTypes.includes(query.opportunity as OpportunityType)) {
    return executeFilteredSearch(provider, query)
  }

  const result = await provider.search(query)
  const data = searchLeads(result.leads, query)

  return {
    data,
    meta: {
      total: data.length,
      city: query.city,
      segment: query.segment ?? 'Todos os segmentos',
      ...(result.monthlyLimitReached ? { monthlyLimitReached: true } : {}),
      ...(!result.monthlyLimitReached && result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    },
  }
}
