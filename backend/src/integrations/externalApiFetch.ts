import { lookup as dnsLookup } from 'node:dns'
import { isIP, type LookupFunction } from 'node:net'
import { Agent } from 'undici'

function isPublicIPv4(address: string) {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false
  const [first, second, third] = octets
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false
  if (first === 100 && second >= 64 && second <= 127) return false
  if (first === 169 && second === 254) return false
  if (first === 172 && second >= 16 && second <= 31) return false
  if (first === 192 && ((second === 0 && (third === 0 || third === 2)) || second === 168 || (second === 31 && third === 196) || (second === 52 && third === 193) || (second === 88 && third === 99) || (second === 175 && third === 48))) return false
  if (first === 198 && ((second === 18 || second === 19) || (second === 51 && third === 100))) return false
  if (first === 203 && second === 0 && third === 113) return false
  return true
}

function isPublicIPv6(address: string) {
  const normalized = address.toLowerCase().split('%')[0]
  if (normalized.includes('::ffff:')) return false
  const ipVersion = isIP(normalized)
  if (ipVersion !== 6) return false
  const [head, tail] = normalized.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const zeros = Math.max(0, 8 - left.length - right.length)
  const words = [...left, ...Array(zeros).fill('0'), ...right].map((word) => Number.parseInt(word || '0', 16))
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) return false
  // Only globally allocated unicast addresses (2000::/3) are allowed.
  if (words[0] < 0x2000 || words[0] > 0x3fff) return false
  if (words[0] === 0x2001 && words[1] === 0x0db8) return false // Documentation range.
  if (words[0] === 0x2001 && words[1] <= 1) return false // IETF special-purpose range, including Teredo.
  if (words[0] === 0x2001 && (words[1] === 2 || (words[1] & 0xfff0) === 0x0010 || (words[1] & 0xfff0) === 0x0020)) return false // Benchmarking and ORCHID ranges.
  if (words[0] === 0x2002) return false // 6to4 transition range.
  if (words[0] === 0x3fff && (words[1] & 0xf000) === 0) return false // Documentation range.
  return true
}

function isPublicAddress(address: string, family: number) {
  return family === 4 ? isPublicIPv4(address) : family === 6 && isPublicIPv6(address)
}

const publicNetworkLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, '', 0)
      return
    }
    if (addresses.length === 0 || addresses.some(({ address, family }) => !isPublicAddress(address, family))) {
      callback(new Error('External provider hostname resolved to a non-public address.'), '', 0)
      return
    }
    if (typeof options === 'object' && options.all) {
      callback(null, addresses)
      return
    }
    callback(null, addresses[0].address, addresses[0].family)
  })
}

const externalApiDispatcher = new Agent({
  connect: { lookup: publicNetworkLookup },
})

const maxProviderResponseBytes = 4 * 1024 * 1024

export const safeExternalApiFetch: typeof fetch = async (input, init = {}) => {
  const target = input instanceof Request ? new URL(input.url) : new URL(input.toString())
  const hostname = target.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const localDevEndpoint = process.env.NODE_ENV !== 'production' && target.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '::1'].includes(hostname)
  if (target.username || target.password) {
    throw new TypeError('External API requests require a public HTTPS URL.')
  }
  // Reject literal IP hosts before Undici can bypass DNS lookup protections.
  if (!localDevEndpoint && (target.protocol !== 'https:' || isIP(hostname) !== 0)) {
    throw new TypeError('External API requests require a public HTTPS hostname.')
  }
  const response = await fetch(input, {
    ...init,
    redirect: 'error',
    ...(localDevEndpoint ? {} : { dispatcher: externalApiDispatcher }),
  } as RequestInit)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxProviderResponseBytes) {
    await response.body?.cancel()
    throw new TypeError('External provider response exceeds the allowed size.')
  }
  if (!response.body) return response

  let byteLength = 0
  const limitedBody = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      byteLength += chunk.byteLength
      if (byteLength > maxProviderResponseBytes) throw new TypeError('External provider response exceeds the allowed size.')
      controller.enqueue(chunk)
    },
  }))
  return new Response(limitedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
