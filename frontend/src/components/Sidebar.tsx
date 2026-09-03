import { Compass, LayoutDashboard, Settings, Wallet } from 'lucide-react'
import './Sidebar.css'

export type AppView = 'search' | 'finance'

const links = [
  { label: 'Visão geral', icon: LayoutDashboard, view: 'search' as AppView },
  { label: 'Buscar leads', icon: Compass, view: 'search' as AppView },
  { label: 'Financeiro', icon: Wallet, view: 'finance' as AppView },
]

type SidebarProps = { activeView: AppView; onNavigate: (view: AppView) => void }

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  return (
    <header className="sidebar">
      <div className="brand-mark" aria-label="DigiBusca">
        <span className="brand-dot" />
        <span>DigiBusca</span>
      </div>

      <nav className="main-nav" aria-label="Navegação principal">
        {links.map(({ label, icon: Icon, view }) => (
          <button className={`nav-item${view === activeView ? ' active' : ''}`} key={label} type="button" onClick={() => onNavigate(view)}>
            <Icon size={18} strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </nav>

      <button className="nav-item settings-link" type="button">
        <Settings size={18} strokeWidth={1.8} />
        Configurações
      </button>
    </header>
  )
}
