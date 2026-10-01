import assert from 'node:assert/strict'
import test from 'node:test'
import { GoogleApiMonthlyLimitError } from '../application/googleApiUsageLimit.js'
import { GooglePlacesProvider } from './googlePlacesProvider.js'

const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test('bloqueia a chamada ao Google quando a reserva mensal é negada', async () => {
  let fetchCalled = false
  globalThis.fetch = async () => {
    fetchCalled = true
    return Response.json({ places: [] })
  }

  const provider = new GooglePlacesProvider('test-api-key', async () => 'blocked')

  await assert.rejects(
    provider.search({ city: 'São Paulo', segment: 'Restaurantes' }),
    GoogleApiMonthlyLimitError,
  )
  assert.equal(fetchCalled, false)
})

test('marca a última chamada permitida e preserva o resultado', async () => {
  const events: string[] = []
  globalThis.fetch = async () => {
    events.push('google')
    return Response.json({ places: [] , nextPageToken: 'should-not-be-used' })
  }

  const provider = new GooglePlacesProvider('test-api-key', async () => {
    events.push('reserve')
    return 'reserved_at_limit'
  })

  const result = await provider.search({ city: 'São Paulo', segment: 'Restaurantes' })

  assert.deepEqual(events, ['reserve', 'google'])
  assert.equal(result.monthlyLimitReached, true)
  assert.equal(result.nextPageToken, 'should-not-be-used')
})
