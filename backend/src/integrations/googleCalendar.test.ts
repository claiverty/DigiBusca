import assert from 'node:assert/strict'
import test from 'node:test'
import { configureRuntimeEnvironment } from '../config/supabase.js'
import {
  createGoogleCalendarAuthorizationUrl,
  GoogleCalendarIntegrationError,
  validateGoogleCalendarRange,
} from './googleCalendar.js'

test('Google Calendar exige datas futuras em ISO com fuso e intervalo limitado', () => {
  const start = new Date(Date.now() + 5 * 60_000)
  const end = new Date(start.getTime() + 30 * 60_000)
  assert.deepEqual(validateGoogleCalendarRange(start.toISOString(), end.toISOString()), {
    start: start.toISOString(),
    end: end.toISOString(),
  })
  assert.throws(() => validateGoogleCalendarRange('2026-11-25T10:00:00', '2026-11-25T10:30:00'), GoogleCalendarIntegrationError)
  assert.throws(() => validateGoogleCalendarRange(start.toISOString(), new Date(start.getTime() + 8 * 24 * 60 * 60_000).toISOString()), GoogleCalendarIntegrationError)
})

test('OAuth solicita acesso offline com escopos restritos a eventos próprios e disponibilidade', async () => {
  configureRuntimeEnvironment({
    SUPABASE_SERVICE_ROLE_KEY: 'test-supabase-service-role-key',
    GOOGLE_CALENDAR_CLIENT_ID: 'test-client.apps.googleusercontent.com',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_CALENDAR_REDIRECT_URI: 'https://whatsapp-api.example.com/api/integrations/google-calendar/callback',
    DIGIBUSCA_APP_ORIGINS: 'https://digibusca.example.com',
  })
  try {
    const authorizationUrl = new URL(await createGoogleCalendarAuthorizationUrl(
      '00000000-0000-4000-8000-000000000000',
      'https://digibusca.example.com',
    ))
    assert.equal(authorizationUrl.hostname, 'accounts.google.com')
    assert.equal(authorizationUrl.searchParams.get('access_type'), 'offline')
    assert.equal(authorizationUrl.searchParams.get('redirect_uri'), 'https://whatsapp-api.example.com/api/integrations/google-calendar/callback')
    assert.match(authorizationUrl.searchParams.get('scope') ?? '', /calendar\.events\.owned/)
    assert.match(authorizationUrl.searchParams.get('scope') ?? '', /calendar\.freebusy/)
    assert.match(authorizationUrl.searchParams.get('state') ?? '', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    await assert.rejects(createGoogleCalendarAuthorizationUrl('00000000-0000-4000-8000-000000000000', 'https://attacker.example.com'), GoogleCalendarIntegrationError)
  } finally {
    configureRuntimeEnvironment({})
  }
})
