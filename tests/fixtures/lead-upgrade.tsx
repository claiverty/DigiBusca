import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AiOutreachAssistant } from '../../frontend/src/components/AiOutreachAssistant'
import { SavedLeadsPage } from '../../frontend/src/pages/SavedLeadsPage'
import { SearchPage } from '../../frontend/src/pages/SearchPage'
import { LeadDetail } from '../../frontend/src/components/LeadDetail'
import type { Lead, LeadUpdate } from '../../frontend/src/types'
import '../../frontend/src/styles/tokens.css'
import '../../frontend/src/styles/base.css'
import '../../frontend/src/App.css'

declare global {
  interface Window {
    fixtureLead: Lead
    fixtureView: string
    usedStage?: string
    savedChanges?: LeadUpdate
  }
}

function Harness() {
  const [lead, setLead] = useState(window.fixtureLead)
  const [used, setUsed] = useState('')
  if (window.fixtureView === 'assistant') return <main style={{ padding: 24 }}>
    <AiOutreachAssistant lead={lead} onUseMessage={(text, stage) => { setUsed(text); window.usedStage = stage }} />
    <p id="used-message">{used}</p>
  </main>
  if (window.fixtureView === 'portfolio') return <main style={{ padding: 16 }}>
    <SavedLeadsPage cachedLeads={[]} onOpenLead={async () => {}} onRemoveLead={async () => {}} onSearch={() => {}} />
  </main>
  if (window.fixtureView === 'detail') return <main style={{ padding: 16 }}>
    <LeadDetail lead={lead} isSaved onBack={() => {}} onToggleSave={async () => {}} onUpdateLead={async (changes) => { window.savedChanges = changes; setLead({ ...lead, ...changes }) }} onRegisterSale={async () => {}} />
  </main>
  return <main style={{ padding: 16 }}><SearchPage savedLeadIds={new Set([lead.id])} onSelectLead={() => {}} /></main>
}

createRoot(document.getElementById('root')!).render(<Harness />)
