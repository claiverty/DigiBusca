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

function App() {
  const { user, signOut, showLanding } = useAuth()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [activeView, setActiveView] = useState<AppView>('overview')
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

  function handleNavigate(view: AppView) {
    setSelectedLead(null)
    setActiveView(view)
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
            onSearch={() => handleNavigate('search')}
          />
        )}
        {activeView === 'finance' && <FinancePage />}
        {activeView === 'search' && (
          <SearchPage onSelectLead={(lead) => setSelectedLead(savedLeads.current.get(lead.id) ?? lead)} />
        )}
      </main>
    </div>
  )
}

export default App
