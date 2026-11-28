import { useEffect, useState } from 'react'
import { Compass, Search, Send, ShieldCheck } from 'lucide-react'
import { SearchPage } from './SearchPage'
import { WhatsAppProspectingPanel } from './WhatsAppProspectingPanel'
import { getWhatsAppConnections, type WhatsAppConnection } from '../services/whatsappService'
import type { Lead } from '../types'
import './LeadWorkspacePage.css'

type WorkspaceTab = 'manual' | 'automatic'

function getWorkspaceTab(): WorkspaceTab {
  const tab = new URLSearchParams(window.location.search).get('tab')
  return tab === 'prospecting' || tab === 'automatic' ? 'automatic' : 'manual'
}

export function LeadWorkspacePage({
  onSelectLead,
  savedLeadIds,
}: {
  onSelectLead: (lead: Lead) => void
  savedLeadIds: Set<string>
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(getWorkspaceTab)
  const [connections, setConnections] = useState<WhatsAppConnection[]>([])
  const [connectionState, setConnectionState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [connectionError, setConnectionError] = useState('')

  useEffect(() => {
    if (activeTab !== 'automatic') return
    let active = true
    setConnectionState('loading')
    setConnectionError('')
    void getWhatsAppConnections()
      .then((items) => {
        if (!active) return
        setConnections(items)
        setConnectionState('ready')
      })
      .catch((error: unknown) => {
        if (!active) return
        setConnections([])
        setConnectionError(error instanceof Error ? error.message : 'Não foi possível consultar a conexão do WhatsApp.')
        setConnectionState('error')
      })
    return () => { active = false }
  }, [activeTab])

  useEffect(() => {
    function syncTabWithUrl() {
      setActiveTab(getWorkspaceTab())
    }
    window.addEventListener('popstate', syncTabWithUrl)
    return () => window.removeEventListener('popstate', syncTabWithUrl)
  }, [])

  function selectTab(tab: WorkspaceTab) {
    setActiveTab(tab)
    const url = new URL(window.location.href)
    url.pathname = '/sistema/buscar'
    if (tab === 'automatic') url.searchParams.set('tab', 'prospecting')
    else url.searchParams.delete('tab')
    window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }

  return (
    <section className="lead-workspace">
      <header className="lead-workspace-header">
        <div>
          <span className="eyebrow">PROSPECÇÃO</span>
          <h1>Buscar leads</h1>
          <p>Encontre empresas, revise as oportunidades e prepare o próximo contato no mesmo lugar.</p>
        </div>
      </header>

      <nav className="lead-workspace-tabs" role="tablist" aria-label="Formas de buscar leads">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'manual'}
          aria-controls="lead-workspace-manual"
          className={activeTab === 'manual' ? 'active' : ''}
          onClick={() => selectTab('manual')}
        >
          <Search size={16} aria-hidden="true" />
          Busca manual
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'automatic'}
          aria-controls="lead-workspace-automatic"
          className={activeTab === 'automatic' ? 'active' : ''}
          onClick={() => selectTab('automatic')}
        >
          <Compass size={16} aria-hidden="true" />
          Prospecção automática
        </button>
      </nav>

      <div id="lead-workspace-manual" role="tabpanel" aria-label="Busca manual" hidden={activeTab !== 'manual'}>
        {activeTab === 'manual' && (
          <SearchPage
            showHeader={false}
            savedLeadIds={savedLeadIds}
            onSelectLead={onSelectLead}
          />
        )}
      </div>
      <div id="lead-workspace-automatic" role="tabpanel" aria-label="Prospecção automática" hidden={activeTab !== 'automatic'}>
        {activeTab === 'automatic' && (
          <>
          <section className="panel lead-workflow-card" aria-label="Etapas da prospecção">
            <div className="lead-workflow-heading">
              <span className="eyebrow">DA DESCOBERTA AO CONTATO</span>
              <p>A busca prepara oportunidades. Você confere a identidade antes de liberar qualquer envio.</p>
            </div>
            <ol className="lead-workflow-steps">
              <li>
                <span className="lead-workflow-icon"><Search size={17} aria-hidden="true" /></span>
                <span className="lead-workflow-copy"><strong>Encontrar</strong><small>Negócios cujo perfil do Google não informa um site</small></span>
              </li>
              <li>
                <span className="lead-workflow-icon"><ShieldCheck size={17} aria-hidden="true" /></span>
                <span className="lead-workflow-copy"><strong>Conferir</strong><small>Selecionar oportunidades e validar um sinal além do telefone</small></span>
              </li>
              <li>
                <span className="lead-workflow-icon"><Send size={17} aria-hidden="true" /></span>
                <span className="lead-workflow-copy"><strong>Preparar o contato</strong><small>Revisar a fila e respeitar horário e limite configurados</small></span>
              </li>
            </ol>
          </section>

          {connectionState === 'loading' && <p className="lead-workspace-connection-state" role="status">Verificando o WhatsApp conectado…</p>}
          {connectionState === 'error' && <p className="lead-workspace-connection-state is-error" role="alert">{connectionError}</p>}
          <WhatsAppProspectingPanel connections={connections} onSelectLead={onSelectLead} />
          </>
        )}
      </div>
    </section>
  )
}
