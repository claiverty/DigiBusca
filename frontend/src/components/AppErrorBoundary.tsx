import { Component, type ErrorInfo, type PropsWithChildren } from 'react'
import { Home, RefreshCw } from 'lucide-react'
import './AppErrorBoundary.css'

type AppErrorBoundaryState = {
  hasError: boolean
}

function reportFatalUiError(error: Error, info: ErrorInfo) {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    service: 'digibusca-frontend',
    event: 'ui_render_failed',
    error: { name: error.name, message: error.message },
    componentStack: info.componentStack || undefined,
  }))
}

export class AppErrorBoundary extends Component<PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportFatalUiError(error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main className="app-error-page">
        <section className="app-error-card" role="alert" aria-labelledby="app-error-title">
          <button
            className="app-error-brand"
            type="button"
            onClick={() => window.location.assign('/')}
            aria-label="Voltar ao início do DigiBusca"
          >
            <span aria-hidden="true" />
            DigiBusca
          </button>
          <p className="eyebrow">ALGO SAIU DO ESPERADO</p>
          <h1 id="app-error-title">Não foi possível carregar esta tela.</h1>
          <p>Seus dados continuam seguros. Recarregue a página para tentar novamente.</p>
          <div className="app-error-actions">
            <button className="primary-button" type="button" onClick={() => window.location.reload()}>
              <RefreshCw size={17} aria-hidden="true" /> Tentar novamente
            </button>
            <button className="secondary-button" type="button" onClick={() => window.location.assign('/')}>
              <Home size={17} aria-hidden="true" /> Voltar ao início
            </button>
          </div>
        </section>
      </main>
    )
  }
}
