import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from './auth/AuthGate'
import { AppUpdatePrompt } from './components/AppUpdatePrompt'
import { LeadDetail } from './components/LeadDetail'
import { Sidebar, type AppView } from './components/Sidebar'
import { FinancePage } from './pages/FinancePage'
import { OverviewPage } from './pages/OverviewPage'
import { LeadWorkspacePage } from './pages/LeadWorkspacePage'
import { SavedLeadsPage } from './pages/SavedLeadsPage'
import { WhatsAppPage } from './pages/WhatsAppPage'
import {
  createSale,
  getSavedLead,
  getSavedLeadIds,
  removeSavedLead,
  removeSavedLeads,
  saveLead,
  updateLead,
  updateSavedLeadsStatus,
} from './services/leadsService'
import type { Lead, LeadStatus, LeadUpdate } from './types'
import type { CreateSaleInput } from './types/sales'
import './App.css'

const viewPaths: Record<AppView, string> = {
  overview: '/sistema',
  search: '/sistema/buscar',
  saved: '/sistema/leads',
  whatsapp: '/sistema/whatsapp',
  finance: '/sistema/financeiro',
}

const pathViews = Object.fromEntries(
  Object.entries(viewPaths).map(([view, path]) => [path, view]),
) as Record<string, AppView>

function getViewFromPathname(pathname = window.location.pathname): AppView {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/'

  if (normalizedPath === viewPaths.whatsapp && new URLSearchParams(window.location.search).get('tab') === 'prospecting') {
    return 'search'
  }

  return pathViews[normalizedPath] ?? 'overview'
}

function App() {
  const { user, signOut, showLanding } = useAuth()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [activeView, setActiveView] = useState<AppView>(getViewFromPathname)
  const [isNewSaleRequested, setIsNewSaleRequested] = useState(false)
  const [savedLeadIds, setSavedLeadIds] = useState<Set<string>>(new Set())
  const [savedLeadIdsLoaded, setSavedLeadIdsLoaded] = useState(false)
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
      .finally(() => setSavedLeadIdsLoaded(true))
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

  async function removeLeadsBulk(leadIds: string[]) {
    const result = await removeSavedLeads(leadIds)
    result.deletedLeadIds.forEach((leadId) => savedLeads.current.delete(leadId))
    setSavedLeadIds((current) => {
      const next = new Set(current)
      result.deletedLeadIds.forEach((leadId) => next.delete(leadId))
      return next
    })
    if (selectedLead && result.deletedLeadIds.includes(selectedLead.id)) setSelectedLead(null)
    return result
  }

  async function updateLeadsStatusBulk(leadIds: string[], status: LeadStatus) {
    const result = await updateSavedLeadsStatus(leadIds, status)
    result.updatedLeadIds.forEach((leadId) => {
      const cachedLead = savedLeads.current.get(leadId)
      if (cachedLead) savedLeads.current.set(leadId, { ...cachedLead, status })
    })
    if (selectedLead && result.updatedLeadIds.includes(selectedLead.id)) {
      setSelectedLead((current) => current ? { ...current, status } : current)
    }
    return result
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

  async function openProspectingFromLead(draftMessage: string) {
    if (!selectedLead) return

    let savedLead: Lead
    if (savedLeadIds.has(selectedLead.id)) {
      savedLead = await updateLead(selectedLead, { status: selectedLead.status, draftMessage })
    } else {
      const createdLead = await saveLead(selectedLead)
      savedLead = await updateLead(createdLead, { status: createdLead.status, draftMessage })
    }
    savedLeads.current.set(savedLead.id, savedLead)
    setSavedLeadIds((current) => new Set(current).add(savedLead.id))

    const nextPath = `${viewPaths.search}?tab=prospecting`
    if (window.location.pathname + window.location.search !== nextPath) {
      window.history.pushState({}, '', nextPath)
    }
    setSelectedLead(null)
    setActiveView('search')
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

  async function openSearchLead(lead: Lead) {
    let knownSavedLeadIds = savedLeadIds
    if (!savedLeadIdsLoaded) {
      const leadIds = await getSavedLeadIds()
      knownSavedLeadIds = new Set(leadIds)
      setSavedLeadIds(knownSavedLeadIds)
      setSavedLeadIdsLoaded(true)
    }
    if (knownSavedLeadIds.has(lead.id)) {
      await openSavedLead(lead.id)
      return
    }
    setSelectedLead(lead)
  }

  function handleNavigate(view: AppView) {
    const keepProspectingTab = view === 'search' && activeView === 'search' && new URLSearchParams(window.location.search).get('tab') === 'prospecting'
    const nextPath = keepProspectingTab ? `${viewPaths.search}?tab=prospecting` : viewPaths[view]

    if (`${window.location.pathname}${window.location.search}` !== nextPath || window.location.hash) {
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
        <AppUpdatePrompt />
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
            key={selectedLead.id}
            lead={selectedLead}
            isSaved={savedLeadIds.has(selectedLead.id)}
            onBack={() => setSelectedLead(null)}
            onToggleSave={() => toggleSavedLead(selectedLead)}
            onUpdateLead={updateSelectedLead}
            onRegisterSale={registerSaleFromLead}
            onOpenProspecting={openProspectingFromLead}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <AppUpdatePrompt />
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
            onRemoveLeadsBulk={removeLeadsBulk}
            onUpdateLeadsStatusBulk={updateLeadsStatusBulk}
            onSearch={() => handleNavigate('search')}
          />
        )}
        {activeView === 'finance' && (
          <FinancePage
            openNewSale={isNewSaleRequested}
            onNewSaleOpened={() => setIsNewSaleRequested(false)}
          />
        )}
        {activeView === 'whatsapp' && (
          <WhatsAppPage initialTab={
            new URLSearchParams(window.location.search).get('tab') === 'settings' ? 'settings' : 'inbox'
          } />
        )}
        {activeView === 'search' && (
          <LeadWorkspacePage savedLeadIds={savedLeadIds} onSelectLead={(lead) => void openSearchLead(lead)} />
        )}
      </main>
    </div>
  )
}

export default App
