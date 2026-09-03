import { useState } from 'react'
import { LeadDetail } from './components/LeadDetail'
import { Sidebar } from './components/Sidebar'
import { SearchPage } from './pages/SearchPage'
import type { Lead } from './types'
import './App.css'

function App() {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  if (selectedLead) {
    return <div className="app-shell"><Sidebar /><main className="content"><LeadDetail lead={selectedLead} onBack={() => setSelectedLead(null)} /></main></div>
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
