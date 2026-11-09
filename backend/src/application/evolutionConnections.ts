import { getEvolutionApiConfig } from '../config/supabase.js'
import { WhatsAppStore } from '../data/whatsappStore.js'
import { configureEvolutionWebhook, createEvolutionInstance, getEvolutionConnectionState, getEvolutionQrCode } from '../integrations/evolutionApi.js'

function qrFromPayload(payload: unknown) {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as Record<string, unknown>
  const qr = typeof record.qrcode === 'object' && record.qrcode !== null
    ? record.qrcode as Record<string, unknown>
    : record
  const value = typeof qr.base64 === 'string' ? qr.base64
    : typeof qr.code === 'string' && qr.code.startsWith('data:image/') ? qr.code
      : undefined
  if (!value) return undefined
  return value.startsWith('data:image/') ? value : `data:image/png;base64,${value}`
}

function newInstanceName(userId: string) {
  return `digibot_${userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`
}

export async function startEvolutionConnection(userId: string) {
  if (!getEvolutionApiConfig()) throw new Error('Configure a Evolution API no arquivo backend/.env antes de conectar.')
  const store = new WhatsAppStore()
  if (!(await store.isEvolutionStorageReady())) {
    throw new Error('Aplique as migrations 009_whatsapp_webhook.sql e 010_whatsapp_coexistence.sql no Supabase antes de conectar.')
  }
  const instanceName = await store.getEvolutionInstanceName(userId) ?? newInstanceName(userId)
  const alreadySaved = await store.getEvolutionInstanceName(userId)
  let createdPayload: unknown
  if (!alreadySaved) {
    try {
      createdPayload = await createEvolutionInstance(instanceName)
    } catch (error) {
      // A previous connection attempt may have created the instance before DigiBusca saved it.
      try {
        await getEvolutionConnectionState(instanceName)
      } catch {
        throw error
      }
    }
    await configureEvolutionWebhook(instanceName)
    await store.saveEvolutionInstance(userId, instanceName)
  } else {
    await configureEvolutionWebhook(instanceName)
  }

  let state = await getEvolutionConnectionState(instanceName)
  let qrCode = state.state.toLowerCase() === 'open' ? undefined : qrFromPayload(createdPayload)
  if (!qrCode && state.state.toLowerCase() !== 'open') {
    qrCode = qrFromPayload(await getEvolutionQrCode(instanceName))
  }
  return { instanceName, state: state.state, qrCode }
}

export async function getEvolutionPairingStatus(userId: string) {
  const instanceName = await new WhatsAppStore().getEvolutionInstanceName(userId)
  if (!instanceName) throw new Error('Gere um QR Code para iniciar a conexão.')
  const state = await getEvolutionConnectionState(instanceName)
  const qrCode = state.state.toLowerCase() === 'connecting'
    ? qrFromPayload(await getEvolutionQrCode(instanceName))
    : undefined
  return { instanceName, state: state.state, qrCode }
}

export async function getEvolutionConnections(userId: string) {
  const connections = await new WhatsAppStore().listConnections(userId)
  return Promise.all(connections.map(async (connection) => {
    try {
      const state = await getEvolutionConnectionState(connection.phoneNumberId)
      return { ...connection, connectionState: state.state, displayPhoneNumber: state.owner ?? connection.displayPhoneNumber }
    } catch {
      return { ...connection, connectionState: 'unavailable' }
    }
  }))
}
