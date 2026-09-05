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
  getSavedLeads,
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
    void getSavedLeads()
      .then((leads) => {
        savedLeads.current = new Map(leads.map((lead) => [lead.id, lead]))
        setSavedLeadIds(new Set(leads.map((lead) => lead.id)))
      })
      .catch(() => undefined)
  }, [])

  async function toggleSavedLead(lead: Lead) {
    if (savedLeadIds.has(lead.id)) {
      await removeSavedLead(lead.id)
      savedLeads.current.delete(lead.id)
      setSavedLeadIds((current) => {
        const next = new Set(current)
        next.delete(lead.id)
        return next
      })
      return
    }

    const saved = await saveLead(lead.id)
    savedLeads.current.set(lead.id, saved)
    setSavedLeadIds((current) => new Set(current).add(lead.id))
  }

  async function updateSelectedLead(changes: LeadUpdate) {
    if (!selectedLead) {
      return
    }

    const updatedLead = await updateLead(selectedLead.id, changes)
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
          <OverviewPage onNavigate={handleNavigate} onSelectLead={setSelectedLead} />
        )}
        {activeView === 'saved' && (
          <SavedLeadsPage
            onSelectLead={(lead) => {
              setSavedLeadIds((current) => new Set(current).add(lead.id))
              setSelectedLead(lead)
            }}
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
