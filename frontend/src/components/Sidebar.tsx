import { Compass, LayoutDashboard, LogOut, Settings, Wallet } from 'lucide-react'
import './Sidebar.css'

export type AppView = 'overview' | 'search' | 'finance'

const links = [
  { label: 'Visão geral', icon: LayoutDashboard, view: 'overview' as AppView },
  { label: 'Buscar leads', icon: Compass, view: 'search' as AppView },
  { label: 'Financeiro', icon: Wallet, view: 'finance' as AppView },
]

type SidebarProps = {
  activeView: AppView
  onNavigate: (view: AppView) => void
  userEmail: string
  onSignOut: () => void
}

export function Sidebar({ activeView, onNavigate, userEmail, onSignOut }: SidebarProps) {
  return (
    <header className="sidebar">
      <div className="brand-mark" aria-label="DigiBusca">
        <span className="brand-dot" />
        <span>DigiBusca</span>
      </div>

      <nav className="main-nav" aria-label="Navegação principal">
        {links.map(({ label, icon: Icon, view }) => (
          <button
            className={`nav-item${view === activeView ? ' active' : ''}`}
            key={label}
            type="button"
            onClick={() => onNavigate(view)}
          >
            <Icon size={18} strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="nav-item settings-link" type="button">
          <Settings size={18} strokeWidth={1.8} />
          Configurações
        </button>
        <div className="account-row">
          <span className="account-avatar" aria-hidden="true">
            {userEmail.charAt(0).toUpperCase()}
          </span>
          <span className="account-email" title={userEmail}>
            {userEmail}
          </span>
          <button className="account-signout" type="button" onClick={onSignOut} aria-label="Sair">
            <LogOut size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </header>
  )
}
