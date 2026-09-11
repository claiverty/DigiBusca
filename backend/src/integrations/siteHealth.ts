export type SiteHealthStatus = 'healthy' | 'insecure' | 'not_found' | 'http_error' | 'unreachable'

export type SiteHealthResult = {
  status: SiteHealthStatus
  statusCode?: number
  checkedAt: string
}

const siteHealthTimeoutMs = 5_000

function isIpAddress(hostname: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')
}

function parsePublicSiteUrl(value: string): URL | undefined {
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol)) return undefined
    if (url.username || url.password || isIpAddress(url.hostname)) return undefined
    if (
      ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname) ||
      url.hostname.endsWith('.local') ||
      url.hostname.endsWith('.localhost') ||
      url.hostname.endsWith('.internal')
    ) {
      return undefined
    }
    if (url.port && !['80', '443'].includes(url.port)) return undefined
    url.hash = ''
    return url
  } catch {
    return undefined
  }
}

async function requestSite(url: URL, method: 'HEAD' | 'GET') {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), siteHealthTimeoutMs)

  try {
    return await fetch(url, {
      method,
      redirect: 'manual',
      headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function checkSiteHealth(value: string): Promise<SiteHealthResult> {
  const url = parsePublicSiteUrl(value)
  const checkedAt = new Date().toISOString()

  if (!url) return { status: 'unreachable', checkedAt }

  try {
    let response = await requestSite(url, 'HEAD')
    if (response.status === 405 || response.status === 501) {
      response = await requestSite(url, 'GET')
    }

    if (response.status === 404 || response.status === 410) {
      return { status: 'not_found', statusCode: response.status, checkedAt }
    }

    if (response.status >= 400) {
      return { status: 'http_error', statusCode: response.status, checkedAt }
    }

    const redirectTarget = response.headers.get('location')
    if (redirectTarget) {
      try {
        if (new URL(redirectTarget, url).protocol === 'http:') {
          return { status: 'insecure', statusCode: response.status, checkedAt }
        }
      } catch {
        return { status: 'http_error', statusCode: response.status, checkedAt }
      }
    }

    return {
      status: url.protocol === 'http:' ? 'insecure' : 'healthy',
      statusCode: response.status,
      checkedAt,
    }
  } catch {
    return { status: 'unreachable', checkedAt }
  }
}
