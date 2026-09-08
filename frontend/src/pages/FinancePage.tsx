import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarDays, Plus, Receipt, X } from 'lucide-react'
import { CurrencyInput, currencyCentsToNumber } from '../components/CurrencyInput'
import { DatePicker } from '../components/DatePicker'
import { SaleServiceField } from '../components/SaleServiceField'
import { createSale, getSales } from '../services/leadsService'
import type { Sale } from '../types/sales'
import './FinancePage.css'

type Period = 'today' | '7d' | '30d' | 'all'

const periods: Array<{ id: Period; label: string }> = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: 'Últimos 7 dias' },
  { id: '30d', label: 'Últimos 30 dias' },
  { id: 'all', label: 'Sempre' },
]

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}
function today() {
  return dateKey(new Date())
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(
    new Date(`${value}T12:00:00`),
  )
}
function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function isInPeriod(value: string, period: Period) {
  if (period === 'all') return true
  const saleDate = new Date(`${value}T12:00:00`)
  const start = new Date()
  start.setHours(12, 0, 0, 0)
  if (period === 'today') return value === dateKey(start)
  start.setDate(start.getDate() - (period === '7d' ? 6 : 29))
  return saleDate >= start
}

function chartDates(period: Period) {
  const days = period === 'today' ? 1 : period === '30d' ? 30 : 7
  const points = period === '30d' ? 7 : days
  return Array.from({ length: points }, (_, index) => {
    const date = new Date()
    date.setHours(12, 0, 0, 0)
    date.setDate(
      date.getDate() - Math.round((points - 1 - index) * ((days - 1) / Math.max(points - 1, 1))),
    )
    return dateKey(date)
  })
}

function formatChartDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(
    new Date(`${value}T12:00:00`),
  )
}

function buildChartPath(dates: string[], sales: Sale[], max: number) {
  return dates
    .map((date, index) => {
      const total = sales
        .filter((sale) => sale.soldAt === date)
        .reduce((sum, sale) => sum + sale.amount, 0)
      const x = dates.length === 1 ? 50 : (index / (dates.length - 1)) * 100
      const y = max ? 100 - (total / max) * 76 - 12 : 88
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
}

type FinancePageProps = {
  openNewSale?: boolean
  onNewSaleOpened?: () => void
}

export function FinancePage({ openNewSale = false, onNewSaleOpened }: FinancePageProps) {
  const [sales, setSales] = useState<Sale[]>([])
  const [period, setPeriod] = useState<Period>('7d')
  const [businessName, setBusinessName] = useState('')
  const [service, setService] = useState('')
  const [amount, setAmount] = useState('')
  const [soldAt, setSoldAt] = useState(today())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [showSaleForm, setShowSaleForm] = useState(false)
  const [saleToast, setSaleToast] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    setStatus('loading')

    void getSales()
      .then((items) => {
        if (!active) return
        setSales(items)
        setStatus('ready')
      })
      .catch(() => {
        if (active) setStatus('error')
      })

    return () => {
      active = false
    }
  }, [loadAttempt])

  useEffect(() => {
    if (!showSaleForm) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSaleForm(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [showSaleForm])

  useEffect(() => {
    if (!openNewSale) return
    setFeedback('')
    setShowSaleForm(true)
    onNewSaleOpened?.()
  }, [onNewSaleOpened, openNewSale])

  const periodSales = useMemo(
    () => sales.filter((sale) => isInPeriod(sale.soldAt, period)),
    [period, sales],
  )
  const periodTotal = periodSales.reduce((total, sale) => total + sale.amount, 0)
  const dates = useMemo(() => chartDates(period), [period])
  const chartMax = Math.max(
    ...dates.map((date) =>
      periodSales
        .filter((sale) => sale.soldAt === date)
        .reduce((sum, sale) => sum + sale.amount, 0),
    ),
    0,
  )
  const chartPath = buildChartPath(dates, periodSales, chartMax)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback('')
    const value = currencyCentsToNumber(amount)
    if (
      !businessName.trim() ||
      !service.trim() ||
      !Number.isFinite(value) ||
      value < 0 ||
      !soldAt
    ) {
      setFeedback('Preencha comércio, serviço, valor e data.')
      return
    }
    try {
      setIsSubmitting(true)
      const sale = await createSale({ businessName, service, amount: value, soldAt })
      setSales((current) => [sale, ...current])
      setBusinessName('')
      setService('')
      setAmount('')
      setFeedback('')
      setShowSaleForm(false)
      setSaleToast('Venda registrada.')
      window.setTimeout(() => setSaleToast(''), 3000)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível registrar a venda.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="finance-page">
      <header className="page-header finance-header">
        <div>
          <span className="eyebrow">CONTROLE FINANCEIRO</span>
          <h1>Acompanhe suas vendas.</h1>
          <p>Registre o que você vendeu e acompanhe seu histórico.</p>
        </div>
      </header>

      <button
        className="primary-button floating-sale-button"
        type="button"
        aria-expanded={showSaleForm}
        onClick={() => {
          setFeedback('')
          setShowSaleForm(true)
        }}
      >
        <Plus size={17} /> Nova venda
      </button>
      {saleToast && (
        <div className="sale-toast" role="status">
          {saleToast}
        </div>
      )}

      <section className="finance-dashboard" aria-label="Dashboard financeiro">
        <div className="period-tabs" role="tablist" aria-label="Período financeiro">
          {periods.map((item) => (
            <button
              className={period === item.id ? 'period-tab active' : 'period-tab'}
              type="button"
              role="tab"
              aria-selected={period === item.id}
              key={item.id}
              onClick={() => setPeriod(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="finance-summary" aria-label="Resumo financeiro">
          <div className="finance-metric panel">
            <span className="metric-label">Total no período</span>
            <strong>{formatCurrency(periodTotal)}</strong>
          </div>
          <div className="finance-metric panel">
            <span className="metric-label">Vendas no período</span>
            <strong>{periodSales.length}</strong>
          </div>
        </div>
        <section className="panel sales-chart" aria-label="Gráfico de vendas">
          <div className="chart-grid" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          {chartMax > 0 && (
            <svg
              className="chart-line"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d={chartPath} />
            </svg>
          )}
          <div className="chart-labels">
            {dates.map((date) => (
              <span key={date}>{formatChartDate(date)}</span>
            ))}
          </div>
        </section>
      </section>

      <section className="panel sales-history">
        <div className="section-heading">
          <div>
            <span className="eyebrow">HISTÓRICO</span>
            <h2>Vendas registradas</h2>
          </div>
          <Receipt size={19} className="section-muted-icon" />
        </div>
        {status === 'loading' && <div className="data-state">Carregando histórico...</div>}
        {status === 'error' && (
          <div className="data-state" role="alert">
            <p>Não foi possível carregar o histórico.</p>
            <button className="secondary-button" type="button" onClick={() => setLoadAttempt((value) => value + 1)}>
              Tentar novamente
            </button>
          </div>
        )}
        {status === 'ready' && sales.length === 0 && (
          <div className="empty-history">
            <CalendarDays size={22} />
            <p>Nenhuma venda registrada ainda.</p>
            <span>As vendas convertidas de um lead também aparecerão aqui.</span>
          </div>
        )}
        {sales.length > 0 && (
          <div className="sales-list">
            {sales.map((sale) => (
              <article className="sale-row" key={sale.id}>
                <div>
                  <strong>{sale.businessName}</strong>
                  <span>{sale.service}</span>
                </div>
                <div className="sale-row-meta">
                  <time>{formatDate(sale.soldAt)}</time>
                  <strong>{formatCurrency(sale.amount)}</strong>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {showSaleForm && (
        <div
          className="sale-modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowSaleForm(false)}
        >
          <form
            className="sale-modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sale-modal-title"
            onSubmit={handleSubmit}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">NOVA VENDA</span>
                <h2 id="sale-modal-title">Adicionar ao histórico</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Fechar formulário"
                onClick={() => setShowSaleForm(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="finance-entry-grid">
              <label className="finance-field">
                <span>Comércio ou cliente</span>
                <input
                  autoFocus
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  placeholder="Ex.: Padaria Central"
                />
              </label>
              <label className="finance-field">
                <span>O que foi vendido</span>
                <SaleServiceField value={service} onChange={setService} />
              </label>
              <label className="finance-field">
                <span>Valor</span>
                <CurrencyInput value={amount} onChange={setAmount} />
              </label>
              <label className="finance-field">
                <span>Data</span>
                <DatePicker value={soldAt} onChange={setSoldAt} />
              </label>
            </div>
            <div className="panel-actions">
              <button className="primary-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Registrando...' : 'Registrar venda'}
              </button>
              {feedback && (
                <span className="form-feedback" role="alert">
                  {feedback}
                </span>
              )}
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
