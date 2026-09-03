import { useEffect, useState } from 'react'
import { LeadDetail } from './components/LeadDetail'
import { Sidebar, type AppView } from './components/Sidebar'
import { FinancePage } from './pages/FinancePage'
import { SearchPage } from './pages/SearchPage'
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
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [activeView, setActiveView] = useState<AppView>('search')
  const [savedLeadIds, setSavedLeadIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    void getSavedLeads()
      .then((leads) => setSavedLeadIds(new Set(leads.map((lead) => lead.id))))
      .catch(() => undefined)
  }, [])

  async function toggleSavedLead(lead: Lead) {
    if (savedLeadIds.has(lead.id)) {
      await removeSavedLead(lead.id)
      setSavedLeadIds((current) => {
        const next = new Set(current)
        next.delete(lead.id)
        return next
      })
      return
    }

    await saveLead(lead.id)
    setSavedLeadIds((current) => new Set(current).add(lead.id))
  }

  async function updateSelectedLead(changes: LeadUpdate) {
    if (!selectedLead) {
      return
    }

    const updatedLead = await updateLead(selectedLead.id, changes)
    setSelectedLead(updatedLead)
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
        <Sidebar activeView="search" onNavigate={handleNavigate} />
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
      <Sidebar activeView={activeView} onNavigate={handleNavigate} />
      <main className="content">
        {activeView === 'finance' ? <FinancePage /> : <SearchPage onSelectLead={setSelectedLead} />}
      </main>
    </div>
  )
}

export default App
