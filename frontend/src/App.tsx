import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from './auth/AuthGate'
import { LeadDetail } from './components/LeadDetail'
import { Sidebar, type AppView } from './components/Sidebar'
import { FinancePage } from './pages/FinancePage'
import { OverviewPage } from './pages/OverviewPage'
import { SearchPage } from './pages/SearchPage'
import { SavedLeadsPage } from './pages/SavedLeadsPage'
import {
  createSale,
  getSavedLead,
  getSavedLeadIds,
  removeSavedLead,
  saveLead,
  updateLead,
} from './services/leadsService'
import type { Lead, LeadUpdate } from './types'
import type { CreateSaleInput } from './types/sales'
import './App.css'

const viewPaths: Record<AppView, string> = {
  overview: '/sistema',
  search: '/sistema/buscar',
  saved: '/sistema/leads',
  finance: '/sistema/financeiro',
}

const pathViews = Object.fromEntries(
  Object.entries(viewPaths).map(([view, path]) => [path, view]),
) as Record<string, AppView>

function getViewFromPathname(pathname = window.location.pathname): AppView {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/'

  return pathViews[normalizedPath] ?? 'overview'
}

function App() {
  const { user, signOut, showLanding } = useAuth()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [activeView, setActiveView] = useState<AppView>(getViewFromPathname)
  const [isNewSaleRequested, setIsNewSaleRequested] = useState(false)
  const [savedLeadIds, setSavedLeadIds] = useState<Set<string>>(new Set())
  const savedLeads = useRef(new Map<string, Lead>())

  useLayoutEffect(() => {
    if (selectedLead) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    }
  }, [selectedLead?.id])

  useEffect(() => {
    void getSavedLeadIds()
      .then((leadIds) => {
        setSavedLeadIds(new Set(leadIds))
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const syncViewWithUrl = () => {
      setSelectedLead(null)
      setActiveView(getViewFromPathname())
    }

    window.addEventListener('popstate', syncViewWithUrl)
    return () => window.removeEventListener('popstate', syncViewWithUrl)
  }, [])

  async function toggleSavedLead(lead: Lead) {
    if (savedLeadIds.has(lead.id)) {
      await removeLead(lead.id)
      return
    }

    const saved = await saveLead(lead)
    savedLeads.current.set(lead.id, saved)
    setSavedLeadIds((current) => new Set(current).add(lead.id))
  }

  async function removeLead(leadId: string) {
    await removeSavedLead(leadId)
    savedLeads.current.delete(leadId)
    setSavedLeadIds((current) => {
      const next = new Set(current)
      next.delete(leadId)
      return next
    })
  }

  async function updateSelectedLead(changes: LeadUpdate) {
    if (!selectedLead) {
      return
    }

    const updatedLead = await updateLead(selectedLead, changes)
    savedLeads.current.set(updatedLead.id, updatedLead)
    setSelectedLead(updatedLead)
    setSavedLeadIds((current) => new Set(current).add(updatedLead.id))
  }

  async function registerSaleFromLead(input: Omit<CreateSaleInput, 'businessName' | 'leadId'>) {
    if (!selectedLead) {
      return
    }

    await createSale({ ...input, businessName: selectedLead.name, leadId: selectedLead.id })
  }

  async function openSavedLead(leadId: string) {
    const cachedLead = savedLeads.current.get(leadId)
    if (cachedLead) {
      setSelectedLead(cachedLead)
      return
    }

    const lead = await getSavedLead(leadId)
    savedLeads.current.set(lead.id, lead)
    setSelectedLead(lead)
  }

  function cacheSavedLead(lead: Lead) {
    savedLeads.current.set(lead.id, lead)
  }

  function handleNavigate(view: AppView) {
    const nextPath = viewPaths[view]

    if (window.location.pathname !== nextPath || window.location.search || window.location.hash) {
      window.history.pushState({}, '', nextPath)
    }

    setSelectedLead(null)
    setActiveView(view)
  }

  function handleNewSale() {
    const nextPath = viewPaths.finance

    if (window.location.pathname !== nextPath || window.location.search || window.location.hash) {
      window.history.pushState({}, '', nextPath)
    }

    setSelectedLead(null)
    setActiveView('finance')
    setIsNewSaleRequested(true)
  }

  if (selectedLead) {
    return (
      <div className="app-shell">
        <Sidebar
          activeView={activeView}
          onNavigate={handleNavigate}
          userEmail={user.email ?? 'Conta conectada'}
          onSignOut={() => void signOut()}
          onShowLanding={showLanding}
          onNewSale={handleNewSale}
        />
        <main className="content">
          <LeadDetail
            lead={selectedLead}
            isSaved={savedLeadIds.has(selectedLead.id)}
            onBack={() => setSelectedLead(null)}
            onToggleSave={() => toggleSavedLead(selectedLead)}
            onUpdateLead={updateSelectedLead}
            onRegisterSale={registerSaleFromLead}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeView={activeView}
        onNavigate={handleNavigate}
        userEmail={user.email ?? 'Conta conectada'}
        onSignOut={() => void signOut()}
        onShowLanding={showLanding}
        onNewSale={handleNewSale}
      />
      <main className="content">
        {activeView === 'overview' && (
          <OverviewPage onNavigate={handleNavigate} />
        )}
        {activeView === 'saved' && (
          <SavedLeadsPage
            cachedLeads={Array.from(savedLeads.current.values())}
            onOpenLead={openSavedLead}
            onRemoveLead={removeLead}
            onHydrateLead={cacheSavedLead}
            onSearch={() => handleNavigate('search')}
          />
        )}
        {activeView === 'finance' && (
          <FinancePage
            openNewSale={isNewSaleRequested}
            onNewSaleOpened={() => setIsNewSaleRequested(false)}
          />
        )}
        {activeView === 'search' && (
          <SearchPage onSelectLead={(lead) => setSelectedLead(savedLeads.current.get(lead.id) ?? lead)} />
        )}
      </main>
    </div>
  )
}

export default App
