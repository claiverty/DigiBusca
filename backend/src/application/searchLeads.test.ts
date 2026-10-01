import assert from 'node:assert/strict'
import test from 'node:test'
import type { Lead, SearchLeadsQuery } from '../contracts/lead.js'
import { GoogleApiMonthlyLimitError } from './googleApiUsageLimit.js'
import type { LeadProvider, LeadSearchResult } from './searchLeads.js'
import { executeSearchLeads } from './searchLeads.js'

function lead(index: number, opportunity: Lead['opportunity'] = 'Sem site'): Lead {
  return {
    id: `place-${index}`,
    name: `Empresa ${index}`,
    category: 'Serviço local',
    address: `${index} Rua de Teste`,
    phone: '(11) 99999-0000',
    rating: 4,
    reviews: 12,
    ...(opportunity === 'Site identificado' ? { website: `https://empresa-${index}.com` } : {}),
    source: 'Google Maps',
    retrievedAt: '2026-10-01T12:00:00.000Z',
    opportunity,
    score: 90 - (index % 50),
    diagnosis: opportunity === 'Sem site' ? 'Site não informado no perfil.' : 'O perfil informa um site.',
    status: 'Novo',
  }
}

class StubLeadProvider implements LeadProvider {
  readonly calls: Array<string | undefined> = []

  constructor(private readonly pages: Record<string, LeadSearchResult>) {}

  async search(query: SearchLeadsQuery): Promise<LeadSearchResult> {
    this.calls.push(query.pageToken)
    const key = query.pageToken ?? 'first'
    const result = this.pages[key]
    if (!result) throw new Error(`Página não configurada: ${key}`)
    return result
  }

  async findById(): Promise<Lead | undefined> {
    return undefined
  }

  async update(): Promise<Lead | undefined> {
    return undefined
  }
}

const baseQuery: SearchLeadsQuery = {
  city: 'São Paulo, SP',
  segment: 'Serviços locais',
  opportunity: 'Sem site',
}

test('busca páginas adicionais para completar 20 leads filtrados e preserva excedentes', async () => {
  const provider = new StubLeadProvider({
    first: {
      leads: [
        ...Array.from({ length: 12 }, (_, index) => lead(index + 1)),
        ...Array.from({ length: 8 }, (_, index) => lead(index + 101, 'Site identificado')),
      ],
      nextPageToken: 'page-2',
    },
    'page-2': {
      leads: [
        ...Array.from({ length: 12 }, (_, index) => lead(index + 21)),
        ...Array.from({ length: 8 }, (_, index) => lead(index + 201, 'Site identificado')),
      ],
      nextPageToken: 'page-3',
    },
    'page-3': {
      leads: [
        ...Array.from({ length: 12 }, (_, index) => lead(index + 41)),
        ...Array.from({ length: 8 }, (_, index) => lead(index + 301, 'Site identificado')),
      ],
    },
  })

  const firstPage = await executeSearchLeads(provider, baseQuery)
  assert.equal(firstPage.data.length, 20)
  assert.ok(firstPage.data.every((item) => item.opportunity === 'Sem site'))
  assert.ok(firstPage.meta.nextPageToken?.startsWith('dbf1.'))
  assert.deepEqual(provider.calls, [undefined, 'page-2'])

  const secondPage = await executeSearchLeads(provider, {
    ...baseQuery,
    pageToken: firstPage.meta.nextPageToken,
  })
  assert.equal(secondPage.data.length, 16)
  assert.ok(secondPage.data.every((item) => item.opportunity === 'Sem site'))
  assert.equal(secondPage.meta.nextPageToken, undefined)
  assert.deepEqual(provider.calls, [undefined, 'page-2', 'page-3'])

  const allResults = [...firstPage.data, ...secondPage.data]
  assert.equal(new Set(allResults.map((item) => item.id)).size, 36)
})

test('retorna menos de 20 somente quando as páginas disponíveis se esgotam', async () => {
  const provider = new StubLeadProvider({
    first: {
      leads: [lead(1), lead(2), lead(101, 'Site identificado')],
      nextPageToken: 'page-2',
    },
    'page-2': {
      leads: [lead(3), lead(4)],
    },
  })

  const result = await executeSearchLeads(provider, baseQuery)

  assert.equal(result.data.length, 4)
  assert.equal(result.meta.nextPageToken, undefined)
  assert.deepEqual(provider.calls, [undefined, 'page-2'])
})

test('busca uma única página quando nenhum filtro de oportunidade está ativo', async () => {
  const provider = new StubLeadProvider({
    first: { leads: [lead(1), lead(2)], nextPageToken: 'page-2' },
  })

  const result = await executeSearchLeads(provider, { ...baseQuery, opportunity: undefined })

  assert.equal(result.data.length, 2)
  assert.equal(result.meta.nextPageToken, 'page-2')
  assert.deepEqual(provider.calls, [undefined])
})

test('devolve os resultados já encontrados se o limite mensal bloquear a próxima página', async () => {
  const calls: Array<string | undefined> = []
  const provider: LeadProvider = {
    async search(query) {
      calls.push(query.pageToken)
      if (query.pageToken) throw new GoogleApiMonthlyLimitError()
      return {
        leads: [
          ...Array.from({ length: 12 }, (_, index) => lead(index + 1)),
          ...Array.from({ length: 8 }, (_, index) => lead(index + 101, 'Site identificado')),
        ],
        nextPageToken: 'page-2',
      }
    },
    async findById() { return undefined },
    async update() { return undefined },
  }

  const result = await executeSearchLeads(provider, baseQuery)

  assert.equal(result.data.length, 12)
  assert.equal(result.meta.monthlyLimitReached, true)
  assert.equal(result.meta.nextPageToken, undefined)
  assert.deepEqual(calls, [undefined, 'page-2'])
})

test('não oferece uma próxima busca após a última consulta mensal permitida', async () => {
  const provider = new StubLeadProvider({
    first: { leads: [lead(1)], nextPageToken: 'page-2', monthlyLimitReached: true },
  })

  const result = await executeSearchLeads(provider, { ...baseQuery, opportunity: undefined })

  assert.equal(result.meta.monthlyLimitReached, true)
  assert.equal(result.meta.nextPageToken, undefined)
  assert.deepEqual(provider.calls, [undefined])
})

test('permite paginar leads já recebidos sem refazer uma chamada ao Google', async () => {
  const firstPageProvider = new StubLeadProvider({
    first: {
      leads: [
        ...Array.from({ length: 20 }, (_, index) => lead(index + 1)),
        ...Array.from({ length: 5 }, (_, index) => lead(index + 101)),
      ],
      nextPageToken: 'page-2',
      monthlyLimitReached: true,
    },
  })

  const firstPage = await executeSearchLeads(firstPageProvider, baseQuery)
  const secondPage = await executeSearchLeads(firstPageProvider, {
    ...baseQuery,
    pageToken: firstPage.meta.nextPageToken,
  })

  assert.equal(firstPage.data.length, 20)
  assert.equal(firstPage.meta.monthlyLimitReached, true)
  assert.equal(secondPage.data.length, 5)
  assert.equal(secondPage.meta.nextPageToken, undefined)
  assert.deepEqual(firstPageProvider.calls, [undefined])
})
