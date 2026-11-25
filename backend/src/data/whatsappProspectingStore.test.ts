import assert from 'node:assert/strict'
import test from 'node:test'
import { configureRuntimeEnvironment } from '../config/supabase.js'
import { WhatsAppProspectingStore } from './whatsappProspectingStore.js'

const queueId = '00000000-0000-4000-8000-000000000026'

function postgrestResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('settles an authorized OpenClaw send through the atomic CRM RPC', async () => {
  const previousFetch = globalThis.fetch
  const requests: Array<{ url: URL; init?: RequestInit }> = []
  configureRuntimeEnvironment({
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  })
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    requests.push({ url, init })
    if (url.pathname.endsWith('/whatsapp_prospecting_queue')) return postgrestResponse({ id: queueId })
    if (url.pathname.endsWith('/rpc/settle_openclaw_prospecting_delivery')) {
      return postgrestResponse({ settled: true, duplicate: false, delivery: 'sent' })
    }
    return postgrestResponse({ message: 'unexpected request' }, 404)
  }) as typeof fetch

  try {
    const settled = await new WhatsAppProspectingStore().settleAuthorizedOpenClawQueueSend(
      'owner-user-id',
      'whatsapp-phone-id',
      '+5511999999999',
      'Oi, aqui é o Cristhian da DigiUP',
      true,
      'openclaw:run-abc123',
      '2026-11-25T15:00:00.000Z',
    )

    assert.equal(settled, true)
    assert.equal(requests.length, 2)
    assert.match(requests[0]?.url.search ?? '', /status=in\.%28sending%2Cunknown%29/)
    assert.equal(requests[1]?.url.pathname, '/rest/v1/rpc/settle_openclaw_prospecting_delivery')
    assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
      p_queue_id: queueId,
      p_user_id: 'owner-user-id',
      p_phone_number_id: 'whatsapp-phone-id',
      p_recipient_phone: '5511999999999',
      p_message: 'Oi, aqui é o Cristhian da DigiUP',
      p_provider_message_id: 'openclaw:run-abc123',
      p_success: true,
      p_occurred_at: '2026-11-25T15:00:00.000Z',
    })
  } finally {
    globalThis.fetch = previousFetch
    configureRuntimeEnvironment({})
  }
})

test('does not call settlement when no active or matching late queue result exists', async () => {
  const previousFetch = globalThis.fetch
  let requestCount = 0
  configureRuntimeEnvironment({
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  })
  globalThis.fetch = (async () => {
    requestCount += 1
    return postgrestResponse(null)
  }) as typeof fetch

  try {
    const settled = await new WhatsAppProspectingStore().settleAuthorizedOpenClawQueueSend(
      'owner-user-id',
      'whatsapp-phone-id',
      '+5511999999999',
      'Mensagem reservada',
      true,
      'openclaw:run-missing',
      '2026-11-25T15:00:00.000Z',
    )
    assert.equal(settled, false)
    assert.equal(requestCount, 2)
  } finally {
    globalThis.fetch = previousFetch
    configureRuntimeEnvironment({})
  }
})
