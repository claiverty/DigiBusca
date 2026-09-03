import { Compass, LayoutDashboard, Settings, Wallet } from 'lucide-react'
import './Sidebar.css'

const links = [
  { label: 'Visão geral', icon: LayoutDashboard, active: false },
  { label: 'Buscar leads', icon: Compass, active: true },
  { label: 'Financeiro', icon: Wallet, active: false },
]

export function Sidebar() {
  return (
    <header className="sidebar">
      <div className="brand-mark" aria-label="DigiBusca">
        <span className="brand-dot" />
        <span>DigiBusca</span>
      </div>

      <nav className="main-nav" aria-label="Navegação principal">
        {links.map(({ label, icon: Icon, active }) => (
          <button className={`nav-item${active ? ' active' : ''}`} key={label} type="button">
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
