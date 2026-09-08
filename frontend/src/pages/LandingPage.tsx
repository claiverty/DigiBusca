import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Compass,
  LayoutDashboard,
  MapPin,
  Plus,
  Search,
  UserRound,
  Users,
} from 'lucide-react'
import { Fragment, useState } from 'react'
import './LandingPage.css'

type LandingPageProps = {
  onCreateAccount: () => void
  onSignIn: () => void
  onShowLegalPage: (page: 'privacy' | 'terms') => void
}

type PreviewView = 'overview' | 'search' | 'leads' | 'finance'

const previewNavigation = [
  { id: 'overview', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'search', label: 'Buscar leads', icon: Compass },
  { id: 'leads', label: 'Meus leads', icon: Users },
  { id: 'finance', label: 'Financeiro', icon: CircleDollarSign },
] as const

const faqItems = [
  {
    question: 'Como encontro novos leads?',
    answer:
      'Escolha país, estado, cidade e segmento. O DigiBusca reúne empresas da região para você decidir por onde começar.',
  },
  {
    question: 'De onde vêm os dados das empresas?',
    answer:
      'Os resultados da busca usam dados do Google Maps. Assim, você parte de informações públicas que já ajudam a identificar a oportunidade.',
  },
  {
    question: 'Consigo entrar em contato pelo DigiBusca?',
    answer:
      'Sim. A ficha prepara uma mensagem de abordagem e, quando houver telefone público, você pode abrir a conversa no WhatsApp.',
  },
  {
    question: 'O que fica salvo nos meus leads?',
    answer:
      'Você salva os negócios que interessam, define o status, registra o próximo retorno e anota o contexto da conversa.',
  },
  {
    question: 'Para que serve o Financeiro?',
    answer:
      'Para registrar vendas simples e enxergar o total do dia, da semana e do mês sem depender de planilhas paralelas.',
  },
]

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
      <article className="hero-dashboard-card hero-google-card">
        <span className="hero-dashboard-label">ACOMPANHAMENTO</span>
        <strong>Uso geral do Google</strong>
        <small>Solicitações de todas as contas neste mês.</small>
        <div className="hero-usage-metrics">
          <span><b>0%</b><small>1 / 1.000</small></span>
          <span><b>0%</b><small>4 / 1.000</small></span>
        </div>
      </article>
      <article className="hero-dashboard-card hero-recent-card">
        <span className="hero-dashboard-label">ACOMPANHAMENTO</span>
        <strong>Leads recentes</strong>
        <small>Você ainda não salvou nenhum lead.</small>
      </article>
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
      <h2>Acompanhe suas vendas.</h2>
      <p>Registre o que você vendeu e acompanhe seu histórico.</p>
      <div className="hero-finance-periods" aria-label="Períodos financeiros">
        <span>Hoje</span>
        <span className="active">Últimos 7 dias</span>
        <span>Últimos 30 dias</span>
        <span>Sempre</span>
      </div>
      <div className="hero-finance-summary">
        <article>
          <span>Total no período</span>
          <strong>R$ 77.550</strong>
        </article>
        <article>
          <span>Vendas no período</span>
          <strong>3</strong>
        </article>
      </div>
      <div className="hero-finance-chart" aria-hidden="true">
        <svg viewBox="0 0 100 34" preserveAspectRatio="none">
          <path d="M0 29 L16 25 L32 27 L48 17 L64 20 L80 9 L100 13" />
        </svg>
        <div>
          <span>01/09</span>
          <span>03/09</span>
          <span>05/09</span>
          <span>07/09</span>
        </div>
      </div>
      <div className="hero-finance-history">
        <span className="hero-dashboard-label">HISTÓRICO</span>
        <strong>Vendas registradas</strong>
        <div className="hero-finance-list">
          <span>Site institucional <strong>R$ 1.500</strong></span>
          <span>Landing page <strong>R$ 900</strong></span>
        </div>
      </div>
    </>
  )
}

export function LandingPage({ onCreateAccount, onSignIn, onShowLegalPage }: LandingPageProps) {
  const [previewView, setPreviewView] = useState<PreviewView>('overview')
  const selectedPreview = previewNavigation.find((item) => item.id === previewView)!

  return (
    <main className="landing-page">
      <header className="landing-nav">
        <a className="landing-brand" href="#inicio" aria-label="DigiBusca — início">
          <span className="landing-brand-mark" aria-hidden="true" />
          <span>DigiBusca</span>
        </a>
        <button className="landing-login" type="button" onClick={onSignIn}>
          Entrar <UserRound size={16} aria-hidden="true" />
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
          <div className="landing-actions">
            <button className="landing-primary-action" type="button" onClick={onCreateAccount}>
              Criar minha conta <ArrowRight size={18} aria-hidden="true" />
            </button>
            <a className="landing-secondary-action" href="#como-funciona">
              Ver como funciona
            </a>
          </div>
        </div>

        <div className="landing-hero-frame" aria-label="Demonstração navegável do DigiBusca">
          <ProductChrome />
          <div className="hero-app">
            <aside className="hero-app-sidebar" aria-label="Navegação da demonstração">
              <span className="hero-app-logo" aria-hidden="true" />
              <div className="hero-app-navigation" role="tablist" aria-label="Telas da demonstração">
                {previewNavigation.map(({ id, label, icon: Icon }, index) => (
                  <Fragment key={id}>
                    <button
                      aria-label={label}
                      aria-selected={previewView === id}
                      className={previewView === id ? 'hero-app-nav active' : 'hero-app-nav'}
                      role="tab"
                      type="button"
                      onClick={() => setPreviewView(id)}
                    >
                      <Icon size={15} aria-hidden="true" />
                    </button>
                    {index === 1 && (
                      <button
                        aria-label="Ver exemplo de nova venda"
                        className="hero-app-add"
                        type="button"
                        onClick={() => setPreviewView('finance')}
                      >
                        <Plus size={16} aria-hidden="true" />
                      </button>
                    )}
                  </Fragment>
                ))}
              </div>
            </aside>
            <div className="hero-app-content" role="tabpanel" aria-label={selectedPreview.label}>
              <div className="hero-app-mobile-header">
                <span className="hero-app-brand-mark" aria-hidden="true" />
                <strong>DigiBusca</strong>
                <i>C</i>
              </div>
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
          <div className="mobile-status-bar" aria-hidden="true">
            <strong>9:41</strong>
            <span className="mobile-status-island" />
            <span className="mobile-status-icons">
              <svg viewBox="0 0 18 12" fill="currentColor">
                <rect x="0" y="8" width="3" height="4" rx="0.8" />
                <rect x="5" y="5.5" width="3" height="6.5" rx="0.8" />
                <rect x="10" y="3" width="3" height="9" rx="0.8" />
                <rect x="15" width="3" height="12" rx="0.8" />
              </svg>
              <svg viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="2.1">
                <path d="M1 3.2a10.4 10.4 0 0 1 14 0M3.5 6a6.5 6.5 0 0 1 9 0M6 8.8a2.8 2.8 0 0 1 4 0" />
                <circle cx="8" cy="10.7" r="0.7" fill="currentColor" stroke="none" />
              </svg>
              <svg viewBox="0 0 27 13" fill="currentColor">
                <rect x="0.6" y="0.6" width="23" height="11.8" rx="3" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" />
                <rect x="2.5" y="2.5" width="19.2" height="8" rx="1.5" />
                <path d="M25 4.2v4.6c2-0.4 2-4.2 0-4.6" opacity="0.5" />
              </svg>
            </span>
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

      <section className="landing-faq" id="faq" aria-labelledby="faq-title">
        <div className="landing-faq-heading">
          <span className="eyebrow">DÚVIDAS RÁPIDAS</span>
          <h2 id="faq-title">Tudo para começar a prospectar com mais clareza.</h2>
        </div>
        <div className="landing-faq-list">
          {faqItems.map((item) => (
            <details key={item.question}>
              <summary>
                <span>{item.question}</span>
                <ChevronDown size={19} aria-hidden="true" />
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
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
          <a href="#faq">Dúvidas</a>
          <button type="button" onClick={() => onShowLegalPage('privacy')}>Privacidade</button>
          <button type="button" onClick={() => onShowLegalPage('terms')}>Termos</button>
          <button type="button" onClick={onSignIn}>
            Entrar <ArrowUpRight size={16} aria-hidden="true" />
          </button>
        </nav>
        <small>© 2026 DigiBusca. Feito para a sua próxima oportunidade.</small>
      </footer>
    </main>
  )
}
