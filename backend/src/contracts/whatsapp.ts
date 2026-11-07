const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type WhatsAppPageOptions = {
  limit: number
  before?: { timestamp: string; id: string }
}

export function isUuid(value: string) {
  return uuidPattern.test(value)
}

export function parseWhatsAppPageOptions(searchParams: URLSearchParams): WhatsAppPageOptions | undefined {
  const rawLimit = searchParams.get('limit')
  const limit = rawLimit === null ? 50 : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return undefined

  const rawCursor = searchParams.get('before')
  if (!rawCursor) return { limit }
  const separatorIndex = rawCursor.lastIndexOf('~')
  if (separatorIndex < 0) return undefined
  const timestamp = rawCursor.slice(0, separatorIndex)
  const id = rawCursor.slice(separatorIndex + 1)
  const parsedDate = new Date(timestamp)
  if (!isUuid(id) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString() !== timestamp) return undefined
  return { limit, before: { timestamp, id } }
}

export function makeWhatsAppCursor(timestamp: string, id: string) {
  return `${timestamp}~${id}`
}
