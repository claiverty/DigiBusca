import { useEffect, useState } from 'react'
import { LeadDetail } from './components/LeadDetail'
import { Sidebar } from './components/Sidebar'
import { SearchPage } from './pages/SearchPage'
import { getSavedLeads, removeSavedLead, saveLead } from './services/leadsService'
import type { Lead } from './types'
import './App.css'

function App() {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [savedLeadIds, setSavedLeadIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    void getSavedLeads().then((leads) => setSavedLeadIds(new Set(leads.map((lead) => lead.id)))).catch(() => undefined)
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

  if (selectedLead) {
    return <div className="app-shell"><Sidebar /><main className="content"><LeadDetail lead={selectedLead} isSaved={savedLeadIds.has(selectedLead.id)} onBack={() => setSelectedLead(null)} onToggleSave={() => toggleSavedLead(selectedLead)} /></main></div>
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="content">
        <SearchPage onSelectLead={setSelectedLead} />
      </main>
    </div>
  )
}

export default App
