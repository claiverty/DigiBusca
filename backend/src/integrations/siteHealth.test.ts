import assert from 'node:assert/strict'
import test from 'node:test'
import { checkSiteHealth } from './siteHealth.js'

const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test('classifica um site HTTPS que responde', async () => {
  globalThis.fetch = async () => new Response(null, { status: 200 })

  const result = await checkSiteHealth('https://empresa.example')

  assert.equal(result.status, 'healthy')
  assert.equal(result.statusCode, 200)
})

test('classifica site HTTP como inseguro', async () => {
  globalThis.fetch = async () => new Response(null, { status: 200 })

  const result = await checkSiteHealth('http://empresa.example')

  assert.equal(result.status, 'insecure')
})

test('tenta GET quando o servidor rejeita HEAD', async () => {
  const methods: string[] = []
  globalThis.fetch = async (_input, init) => {
    methods.push(init?.method ?? 'GET')
    return new Response(null, { status: methods.length === 1 ? 405 : 200 })
  }

  const result = await checkSiteHealth('https://empresa.example')

  assert.deepEqual(methods, ['HEAD', 'GET'])
  assert.equal(result.status, 'healthy')
})

test('não consulta endereços locais ou com porta arbitrária', async () => {
  let called = false
  globalThis.fetch = async () => {
    called = true
    return new Response(null, { status: 200 })
  }

  const localhost = await checkSiteHealth('http://localhost:3000')
  const customPort = await checkSiteHealth('https://empresa.example:8443')

  assert.equal(localhost.status, 'unreachable')
  assert.equal(customPort.status, 'unreachable')
  assert.equal(called, false)
})
