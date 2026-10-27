const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class WhatsAppTokenVaultError extends Error {
  constructor(message = 'O armazenamento seguro do token do WhatsApp não está configurado.') {
    super(message)
    this.name = 'WhatsAppTokenVaultError'
  }
}

function decodeKey(value: string) {
  let bytes: Uint8Array
  try {
    const decoded = atob(value)
    bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  } catch {
    throw new WhatsAppTokenVaultError('WHATSAPP_TOKEN_ENCRYPTION_KEY precisa ser Base64 válido.')
  }
  if (bytes.byteLength !== 32) {
    throw new WhatsAppTokenVaultError('WHATSAPP_TOKEN_ENCRYPTION_KEY precisa representar 32 bytes.')
  }
  return bytes
}

export function isWhatsAppTokenEncryptionKeyValid(value: string | undefined) {
  if (!value?.trim()) return false
  try {
    decodeKey(value.trim())
    return true
  } catch {
    return false
  }
}

function encodeBase64(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64(value: string) {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
  } catch {
    throw new WhatsAppTokenVaultError('O token salvo não pôde ser descriptografado.')
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

async function importEncryptionKey(value: string, usage: KeyUsage[]) {
  return globalThis.crypto.subtle.importKey('raw', toArrayBuffer(decodeKey(value)), 'AES-GCM', false, usage)
}

export async function encryptWhatsAppAccessToken(accessToken: string, encryptionKey: string) {
  const key = await importEncryptionKey(encryptionKey, ['encrypt'])
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const encrypted = new Uint8Array(await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(accessToken),
  ))
  return { ciphertext: encodeBase64(encrypted), iv: encodeBase64(iv) }
}

export async function decryptWhatsAppAccessToken(ciphertext: string, iv: string, encryptionKey: string) {
  try {
    const key = await importEncryptionKey(encryptionKey, ['decrypt'])
    const decrypted = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(decodeBase64(iv)) },
      key,
      toArrayBuffer(decodeBase64(ciphertext)),
    )
    return decoder.decode(decrypted)
  } catch (error) {
    if (error instanceof WhatsAppTokenVaultError) throw error
    throw new WhatsAppTokenVaultError('O token salvo não pôde ser descriptografado.')
  }
}
