import { ArrowUpRight, CalendarDays, CircleDollarSign, Compass, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSales, getSavedLeads, type SavedLeadState } from '../services/leadsService'
import type { Sale } from '../types/sales'
import type { AppView } from '../components/Sidebar'
import './OverviewPage.css'

type OverviewPageProps = {
  onNavigate: (view: AppView) => void
}

type OverviewStatus = 'loading' | 'ready' | 'error'

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  })
    .format(new Date(`${value}T12:00:00`))
    .replace('.', '')
}

function isWithinNextWeek(value?: string) {
  if (!value) {
    return false
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const nextWeek = new Date(today)
  nextWeek.setDate(today.getDate() + 7)
  const followUp = new Date(`${value}T12:00:00`)

  return followUp >= today && followUp <= nextWeek
}

export function OverviewPage({ onNavigate }: OverviewPageProps) {
  const [leads, setLeads] = useState<SavedLeadState[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [status, setStatus] = useState<OverviewStatus>('loading')

  const loadData = useCallback(async () => {
    setStatus('loading')

    try {
      const [savedLeads, savedSales] = await Promise.all([getSavedLeads(), getSales()])
      setLeads(savedLeads)
      setSales(savedSales)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const openLeads = leads.filter((lead) => lead.status !== 'Ganhou' && lead.status !== 'Perdeu')
  const upcomingFollowUps = leads.filter((lead) => isWithinNextWeek(lead.nextFollowUp))
  const recentSales = sales.slice(0, 3)
  const totalSales = sales.reduce((total, sale) => total + sale.amount, 0)
  const recentLeads = useMemo(() => leads.slice(0, 3), [leads])

  if (status === 'loading') {
    return <div className="overview-state">Carregando sua visão geral...</div>
  }

  if (status === 'error') {
    return (
      <div className="overview-state" role="alert">
        Não foi possível carregar sua visão geral agora.
        <button className="secondary-button" type="button" onClick={() => void loadData()}>
          Tentar novamente
        </button>
      </div>
    )
  }

  return (
    <section className="overview-page">
      <header className="page-header overview-header">
        <div>
          <span className="eyebrow">VISÃO GERAL</span>
          <h1>Seu próximo negócio começa aqui.</h1>
          <p>Veja o que merece atenção e continue sua prospecção.</p>
        </div>
        <button className="avatar overview-avatar" type="button" aria-label="Conta do usuário">
          C
        </button>
      </header>

      <div className="overview-actions">
        <button className="primary-button" type="button" onClick={() => onNavigate('search')}>
          <Compass size={17} /> Buscar oportunidades
        </button>
        <button className="secondary-button" type="button" onClick={() => onNavigate('finance')}>
          <CircleDollarSign size={17} /> Ver financeiro
        </button>
      </div>

      <section className="overview-metrics" aria-label="Resumo da operação">
        <article className="overview-metric panel">
          <Users size={19} />
          <span>Leads salvos</span>
          <strong>{leads.length}</strong>
          <small>{openLeads.length} em acompanhamento</small>
        </article>
        <article className="overview-metric panel">
          <CalendarDays size={19} />
          <span>Próximos follow-ups</span>
          <strong>{upcomingFollowUps.length}</strong>
          <small>Para os próximos 7 dias</small>
        </article>
        <article className="overview-metric panel">
          <CircleDollarSign size={19} />
          <span>Vendas registradas</span>
          <strong>{formatCurrency(totalSales)}</strong>
          <small>{sales.length} venda(s) no histórico</small>
        </article>
      </section>

      <div className="overview-grid">
        <section className="panel overview-list-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">ACOMPANHAMENTO</span>
              <h2>Leads recentes</h2>
            </div>
            <button className="text-button" type="button" onClick={() => onNavigate('saved')}>
              Ver todos <ArrowUpRight size={15} />
            </button>
          </div>
          {recentLeads.length === 0 ? (
            <div className="overview-empty">
              <p>Você ainda não salvou nenhum lead.</p>
              <button className="secondary-button" type="button" onClick={() => onNavigate('search')}>
                Começar uma busca
              </button>
            </div>
          ) : (
            <div className="overview-record-list">
              {recentLeads.map((lead) => (
                <article className="overview-record" key={lead.leadId}>
                  <div>
                    <strong>Lead salvo</strong>
                    <span>{lead.nextFollowUp ? `Próximo contato: ${formatDate(lead.nextFollowUp)}` : 'Sem contato agendado'}</span>
                    <button className="text-button" type="button" onClick={() => onNavigate('saved')}>
                      Abrir acompanhamento
                    </button>
                  </div>
                  <div className="overview-record-meta">
                    <span>{lead.status}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel overview-list-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">FINANCEIRO</span>
              <h2>Últimas vendas</h2>
            </div>
            <button className="text-button" type="button" onClick={() => onNavigate('finance')}>
              Abrir <ArrowUpRight size={15} />
            </button>
          </div>
          {recentSales.length === 0 ? (
            <div className="overview-empty">
              <p>Nenhuma venda registrada ainda.</p>
              <button className="secondary-button" type="button" onClick={() => onNavigate('finance')}>
                Registrar venda
              </button>
            </div>
          ) : (
            <div className="overview-record-list">
              {recentSales.map((sale) => (
                <article className="overview-record" key={sale.id}>
                  <div>
                    <strong>{sale.businessName}</strong>
                    <span>{sale.service}</span>
                  </div>
                  <div className="overview-record-meta">
                    <span>{formatDate(sale.soldAt)}</span>
                    <strong>{formatCurrency(sale.amount)}</strong>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
