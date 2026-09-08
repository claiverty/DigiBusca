import { Bookmark, Compass, LayoutDashboard, LogOut, Menu, Plus, Wallet, X } from 'lucide-react'
import { Fragment, useState } from 'react'
import './Sidebar.css'

export type AppView = 'overview' | 'search' | 'saved' | 'finance'

const links = [
  { label: 'Visão geral', icon: LayoutDashboard, view: 'overview' as AppView },
  { label: 'Buscar leads', icon: Compass, view: 'search' as AppView },
  { label: 'Meus leads', icon: Bookmark, view: 'saved' as AppView },
  { label: 'Financeiro', icon: Wallet, view: 'finance' as AppView },
]

type SidebarProps = {
  activeView: AppView
  onNavigate: (view: AppView) => void
  userEmail: string
  onSignOut: () => void
  onShowLanding: () => void
  onNewSale: () => void
}

export function Sidebar({ activeView, onNavigate, userEmail, onSignOut, onShowLanding, onNewSale }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [isPinnedOpen, setIsPinnedOpen] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const isRailViewport = window.matchMedia('(min-width: 1025px) and (max-width: 1280px)').matches
  const navigationExpanded = isMobileOpen || (isRailViewport ? isPinnedOpen : !isCollapsed)
  const activeLabel = links.find((link) => link.view === activeView)?.label ?? 'DigiBusca'

  function toggleNavigation() {
    if (window.matchMedia('(max-width: 1024px)').matches) {
      setIsMobileOpen((current) => !current)
      return
    }

    if (window.matchMedia('(max-width: 1280px)').matches) {
      setIsPinnedOpen((current) => !current)
      return
    }

    setIsCollapsed((current) => !current)
  }

  function navigate(view: AppView) {
    onNavigate(view)
    setIsMobileOpen(false)
  }

  function returnToLanding() {
    onShowLanding()
    setIsMobileOpen(false)
  }

  function startNewSale() {
    onNewSale()
    setIsMobileOpen(false)
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header-start">
          <button
            className="app-header-menu"
            type="button"
            aria-label={navigationExpanded ? 'Recolher navegação' : 'Expandir navegação'}
            aria-expanded={navigationExpanded}
            onClick={toggleNavigation}
          >
            {isMobileOpen ? <X size={19} /> : <Menu size={20} />}
          </button>
          <button className="app-header-brand" type="button" onClick={returnToLanding} aria-label="Ir para a página inicial">
            <span className="brand-dot" />
            <strong>DigiBusca</strong>
          </button>
          <span className="app-header-separator" aria-hidden="true">/</span>
          <span className="app-header-view">{activeLabel}</span>
        </div>
        <div className="app-header-account">
          <span className="app-header-email" title={userEmail}>{userEmail}</span>
          <span className="account-avatar" aria-hidden="true">{userEmail.charAt(0).toUpperCase()}</span>
          <button className="account-signout" type="button" onClick={onSignOut} aria-label="Sair" title="Sair">
            <LogOut size={16} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {isMobileOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Fechar navegação"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      <aside
        className={`sidebar${isCollapsed ? ' is-collapsed' : ''}${isPinnedOpen ? ' is-pinned-open' : ''}${isMobileOpen ? ' is-mobile-open' : ''}`}
      >
        <nav className="main-nav" aria-label="Navegação principal">
          {links.map(({ label, icon: Icon, view }, index) => (
            <Fragment key={label}>
              {index === 2 && (
                <button
                  className="mobile-new-sale"
                  type="button"
                  aria-label="Adicionar nova venda"
                  title="Nova venda"
                  onClick={startNewSale}
                >
                  <Plus size={25} strokeWidth={2.2} />
                </button>
              )}
              <button
                className={`nav-item${view === activeView ? ' active' : ''}`}
                type="button"
                aria-current={view === activeView ? 'page' : undefined}
                title={label}
                onClick={() => navigate(view)}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span className="sidebar-label">{label}</span>
              </button>
            </Fragment>
          ))}
        </nav>
      </aside>
    </>
  )
}
