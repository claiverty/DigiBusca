type RateLimitOptions = {
  key: string
  limit: number
  windowMs: number
}

type RateLimitResult = {
  allowed: boolean
  retryAfterSeconds: number
}

const requestWindows = new Map<string, number[]>()
const maxTrackedKeys = 2_000

/**
 * A small per-isolate guard against accidental repeated Places requests. Cloudflare can run
 * more than one isolate, so this is intentionally a friendly throttle, not a global quota.
 */
export function checkRateLimit({ key, limit, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  const oldestAllowed = now - windowMs
  const attempts = (requestWindows.get(key) ?? []).filter((attempt) => attempt > oldestAllowed)

  if (attempts.length >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((attempts[0] + windowMs - now) / 1_000))
    requestWindows.set(key, attempts)
    return { allowed: false, retryAfterSeconds }
  }

  attempts.push(now)
  requestWindows.set(key, attempts)

  if (requestWindows.size > maxTrackedKeys) {
    requestWindows.clear()
  }

  return { allowed: true, retryAfterSeconds: 0 }
}
