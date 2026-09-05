import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CircleDollarSign,
  Compass,
  LayoutDashboard,
  MapPin,
  Search,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import './LandingPage.css'

type LandingPageProps = {
  onCreateAccount: () => void
  onSignIn: () => void
}

type PreviewView = 'overview' | 'search' | 'leads' | 'finance'

const previewNavigation = [
  { id: 'overview', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'search', label: 'Buscar leads', icon: Compass },
  { id: 'leads', label: 'Meus leads', icon: Users },
  { id: 'finance', label: 'Financeiro', icon: CircleDollarSign },
] as const

function ProductChrome() {
  return (
    <div className="product-chrome" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}

function PreviewOverview() {
  return (
    <>
      <h2>Seu próximo negócio começa aqui.</h2>
      <p>Veja o que merece atenção e continue sua prospecção.</p>
      <div className="hero-app-actions">
        <span>
          <Compass size={14} /> Buscar oportunidades
        </span>
        <span>
          <CircleDollarSign size={14} /> Ver financeiro
        </span>
      </div>
      <div className="hero-app-cards">
        <article>
          <Users size={16} />
          <span>Leads salvos</span>
          <strong>12</strong>
        </article>
        <article>
          <CalendarDays size={16} />
          <span>Próximos contatos</span>
          <strong>3</strong>
        </article>
        <article>
          <CircleDollarSign size={16} />
          <span>Vendas no histórico</span>
          <strong>R$ 77.550</strong>
        </article>
      </div>
    </>
  )
}

function PreviewSearch() {
  return (
    <>
      <h2>Empresas que precisam de você.</h2>
      <p>Escolha uma região e encontre novos negócios para abordar.</p>
      <div className="hero-search-fields">
        <span>Brasil</span>
        <span>GO</span>
        <span>Formosa</span>
      </div>
      <article className="hero-preview-lead">
        <div>
          <small>SEM SITE</small>
          <strong>Padaria Central</strong>
          <span>
            <MapPin size={13} /> Centro · Formosa, GO
          </span>
        </div>
        <b>98%</b>
      </article>
    </>
  )
}

function PreviewLeads() {
  return (
    <>
      <h2>Sua agenda de contatos.</h2>
      <p>Priorize os retornos e abra a ficha certa no momento certo.</p>
      <div className="hero-agenda-list">
        <article>
          <time>HOJE</time>
          <div>
            <strong>Padaria Central</strong>
            <span>Retomar a conversa</span>
          </div>
          <ArrowUpRight size={16} />
        </article>
        <article>
          <time>AMANHÃ</time>
          <div>
            <strong>Clínica Vida</strong>
            <span>Enviar proposta</span>
          </div>
          <ArrowUpRight size={16} />
        </article>
      </div>
    </>
  )
}

function PreviewFinance() {
  return (
    <>
      <h2>O que a prospecção virou.</h2>
      <p>Registre cada venda e acompanhe seu histórico sem planilhas paralelas.</p>
      <div className="hero-finance-total">
        <span>VENDAS NO HISTÓRICO</span>
        <strong>R$ 77.550,00</strong>
        <small>Faixa de R$ 700 a R$ 2.000 por venda</small>
      </div>
      <div className="hero-finance-list">
        <span>Site institucional <strong>R$ 1.500,00</strong></span>
        <span>Landing page <strong>R$ 900,00</strong></span>
      </div>
    </>
  )
}

export function LandingPage({ onCreateAccount, onSignIn }: LandingPageProps) {
  const [previewView, setPreviewView] = useState<PreviewView>('overview')
  const selectedPreview = previewNavigation.find((item) => item.id === previewView)!

  return (
    <main className="landing-page">
      <header className="landing-nav">
        <a className="landing-brand" href="#inicio" aria-label="DigiBusca — início">
          <span className="landing-brand-mark" aria-hidden="true" />
          <span>DigiBusca</span>
        </a>
        <nav className="landing-links" aria-label="Navegação da página">
          <a href="#como-funciona">Como funciona</a>
          <a href="#sistema">O sistema</a>
        </nav>
        <button className="landing-login" type="button" onClick={onSignIn}>
          Entrar <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </header>

      <section className="landing-hero" id="inicio" aria-labelledby="landing-title">
        <div className="landing-copy">
          <h1 id="landing-title">
            <span>Onde existe um negócio,</span>
            <span>existe uma oportunidade.</span>
            <span>Encontre a sua.</span>
          </h1>
          <p>
            O DigiBusca encontra empresas, organiza seus contatos e mostra o que sua prospecção
            está trazendo de volta.
          </p>
        </div>

        <div className="landing-hero-frame" aria-label="Demonstração navegável do DigiBusca">
          <ProductChrome />
          <div className="hero-app">
            <aside className="hero-app-sidebar" aria-label="Navegação da demonstração">
              <span className="hero-app-logo" aria-hidden="true" />
              <div className="hero-app-navigation" role="tablist" aria-label="Telas da demonstração">
                {previewNavigation.map(({ id, label, icon: Icon }) => (
                  <button
                    aria-label={label}
                    aria-selected={previewView === id}
                    className={previewView === id ? 'hero-app-nav active' : 'hero-app-nav'}
                    key={id}
                    role="tab"
                    type="button"
                    onClick={() => setPreviewView(id)}
                  >
                    <Icon size={15} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </aside>
            <div className="hero-app-content" role="tabpanel" aria-label={selectedPreview.label}>
              <div className="hero-app-topline">
                <span>{selectedPreview.label.toUpperCase()}</span>
                <i>C</i>
              </div>
              {previewView === 'overview' && <PreviewOverview />}
              {previewView === 'search' && <PreviewSearch />}
              {previewView === 'leads' && <PreviewLeads />}
              {previewView === 'finance' && <PreviewFinance />}
            </div>
          </div>
        </div>
        <p className="landing-frame-hint">Use os ícones no frame para explorar cada tela.</p>
      </section>

      <section className="landing-operations" aria-labelledby="operations-title">
        <span className="eyebrow">UM SISTEMA PARA A ROTINA COMERCIAL</span>
        <div className="landing-operations-grid">
          <h2 id="operations-title">Uma busca, uma conversa e uma venda de cada vez.</h2>
          <p>
            Sem planilha paralela e sem perder a hora de retornar. Tudo o que importa fica na
            mesma rotina.
          </p>
        </div>
        <div className="landing-facts" aria-label="Benefícios do DigiBusca">
          <div>
            <strong>3 etapas</strong>
            <span>buscar, acompanhar e vender</span>
          </div>
          <div>
            <strong>1 lugar</strong>
            <span>para os seus leads e negociações</span>
          </div>
          <div>
            <strong>Dados reais</strong>
            <span>para começar cada prospecção</span>
          </div>
        </div>
      </section>

      <section className="landing-opportunity" id="como-funciona" aria-labelledby="opportunity-title">
        <div>
          <span className="eyebrow">OPORTUNIDADE VISÍVEL</span>
          <h2 id="opportunity-title">
            Na sua cidade, muitos negócios ainda precisam de uma presença digital melhor.
          </h2>
          <p>
            Eles já atendem clientes, têm avaliações e presença em mapas. Falta alguém que
            enxergue a oportunidade e faça a abordagem certa.
          </p>
          <strong>Descobrir por onde começar leva só uma busca.</strong>
        </div>
      </section>

      <section className="landing-system" id="sistema" aria-labelledby="system-title">
        <div className="landing-section-heading">
          <span className="eyebrow">DO MAPA AO ACOMPANHAMENTO</span>
          <h2 id="system-title">Tudo organizado em frames que fazem sentido para o seu trabalho.</h2>
        </div>
        <div className="system-frame-grid">
          <article className="system-frame search-frame">
            <ProductChrome />
            <div className="system-frame-content">
              <span className="system-frame-label">BUSCAR LEADS</span>
              <h3>Comece pela região certa.</h3>
              <div className="mini-search-row">
                <span>Brasil</span>
                <span>GO</span>
                <span>Formosa</span>
              </div>
              <div className="mini-search-button">
                <Search size={14} /> Restaurantes e padarias
              </div>
            </div>
          </article>
          <article className="system-frame lead-frame">
            <ProductChrome />
            <div className="system-frame-content">
              <span className="system-frame-label">FICHA DO LEAD</span>
              <div className="mini-lead-heading">
                <div>
                  <span>SEM SITE</span>
                  <h3>Padaria Central</h3>
                </div>
                <strong>98%</strong>
              </div>
              <p>
                <MapPin size={13} /> Centro · Formosa, GO
              </p>
              <div className="mini-follow-up">
                <CalendarDays size={14} /> Próximo contato: amanhã
              </div>
            </div>
          </article>
          <article className="system-frame finance-frame">
            <ProductChrome />
            <div className="system-frame-content">
              <span className="system-frame-label">FINANCEIRO</span>
              <h3>Veja o que virou resultado.</h3>
              <strong className="mini-currency">R$ 77.550,00</strong>
              <span className="mini-caption">Vendas entre R$ 700 e R$ 2.000</span>
            </div>
          </article>
        </div>
      </section>

      <section className="landing-closing" aria-labelledby="closing-title">
        <span className="eyebrow">SUA PRÓXIMA PROSPECÇÃO COMEÇA AQUI</span>
        <h2 id="closing-title">Abra o mapa. Encontre a oportunidade. Faça acontecer.</h2>
        <button className="landing-primary-action" type="button" onClick={onCreateAccount}>
          Criar minha conta <ArrowRight size={18} aria-hidden="true" />
        </button>
      </section>

      <footer className="landing-footer">
        <div>
          <span className="landing-brand">
            <span className="landing-brand-mark" aria-hidden="true" />
            <span>DigiBusca</span>
          </span>
          <p>Prospecção organizada para transformar oportunidades em negócio.</p>
        </div>
        <nav aria-label="Atalhos do rodapé">
          <a href="#como-funciona">Como funciona</a>
          <a href="#sistema">O sistema</a>
          <button type="button" onClick={onSignIn}>
            Entrar <ArrowUpRight size={16} aria-hidden="true" />
          </button>
        </nav>
        <small>© 2026 DigiBusca. Feito para a sua próxima oportunidade.</small>
      </footer>
    </main>
  )
}
