import { useEffect, useRef, useState } from 'react'
import './AppUpdatePrompt.css'

const VERSION_URL = '/app-version.json'
const CHECK_INTERVAL_MS = 60_000
const DISMISSED_VERSION_KEY = 'digibusca:update-dismissed-version'

function readDismissedVersion() {
  try {
    return window.sessionStorage.getItem(DISMISSED_VERSION_KEY)
  } catch {
    return null
  }
}

export function AppUpdatePrompt() {
  const [availableVersion, setAvailableVersion] = useState<string | null>(null)
  const dismissedVersionInMemory = useRef<string | null>(null)

  useEffect(() => {
    let isMounted = true
    let requestInFlight = false
    let checkAgainWhenVisible = false

    async function checkForUpdate(recheckAfterCurrent = false) {
      if (document.visibilityState !== 'visible') return
      if (requestInFlight) {
        if (recheckAfterCurrent) checkAgainWhenVisible = true
        return
      }

      requestInFlight = true
      try {
        const response = await fetch(VERSION_URL, { cache: 'no-store' })
        if (!response.ok) return

        const payload: unknown = await response.json()
        if (
          typeof payload !== 'object' ||
          payload === null ||
          !('version' in payload) ||
          typeof payload.version !== 'string'
        ) {
          return
        }

        const remoteVersion = payload.version.trim()
        if (!remoteVersion || !isMounted) return

        if (
          remoteVersion === __APP_VERSION__ ||
          readDismissedVersion() === remoteVersion ||
          dismissedVersionInMemory.current === remoteVersion
        ) {
          setAvailableVersion(null)
          return
        }

        setAvailableVersion(remoteVersion)
      } catch {
        // A temporary network or parsing error should not interrupt the app.
      } finally {
        requestInFlight = false
        if (checkAgainWhenVisible && document.visibilityState === 'visible') {
          checkAgainWhenVisible = false
          void checkForUpdate()
        }
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void checkForUpdate(true)
      }
    }

    void checkForUpdate()
    const intervalId = window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  function dismissForNow() {
    if (availableVersion) {
      dismissedVersionInMemory.current = availableVersion
      try {
        window.sessionStorage.setItem(DISMISSED_VERSION_KEY, availableVersion)
      } catch {
        // The prompt remains dismissible for the current render if storage is unavailable.
      }
    }
    setAvailableVersion(null)
  }

  if (!availableVersion) return null

  return (
    <section className="app-update-prompt" aria-labelledby="app-update-title">
      <div className="app-update-prompt__message" role="status" aria-live="polite" aria-atomic="true">
        <span className="app-update-prompt__eyebrow">DigiBusca</span>
        <h2 id="app-update-title">Atualização disponível</h2>
        <p>Uma nova versão está pronta para você.</p>
      </div>
      <div className="app-update-prompt__actions">
        <button className="app-update-prompt__dismiss" type="button" onClick={dismissForNow}>
          Dispensar por enquanto
        </button>
        <button
          className="app-update-prompt__update"
          type="button"
          onClick={() => window.location.reload()}
        >
          Atualizar agora
        </button>
      </div>
    </section>
  )
}
