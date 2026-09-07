import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarDays, Plus, Receipt, X } from 'lucide-react'
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

const saleServiceOptions = [
  'Site institucional',
  'Landing page',
  'Loja virtual',
  'Identidade visual',
  'Gestão de tráfego',
  'Manutenção mensal',
]

const weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

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

function sanitizeCurrency(value: string) {
  return value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
}

function parseCurrency(value: string) {
  const cents = Number(value.replace(/\D/g, ''))
  return Number.isFinite(cents) ? cents / 100 : Number.NaN
}

function formatCurrencyInput(value: string) {
  return value ? formatCurrency(parseCurrency(value)) : ''
}

function formatDateInput(value: string) {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}/${year}` : 'Escolher data'
}

function getCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function getDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

type SaleDatePickerProps = {
  value: string
  onChange: (value: string) => void
}

function SaleDatePicker({ value, onChange }: SaleDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(() => getCalendarDate(value))
  const year = visibleMonth.getFullYear()
  const month = visibleMonth.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(
    visibleMonth,
  )

  function selectDate(day: number) {
    const nextDate = new Date(year, month, day)
    onChange(getDateKey(nextDate))
    setVisibleMonth(nextDate)
    setIsOpen(false)
  }

  return (
    <div className="sale-date-picker">
      <button
        className="sale-date-trigger"
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{formatDateInput(value)}</span>
        <CalendarDays size={17} aria-hidden="true" />
      </button>
      {isOpen && (
        <div className="sale-calendar" role="dialog" aria-label="Escolher data da venda">
          <div className="sale-calendar-header">
            <button
              type="button"
              aria-label="Mês anterior"
              onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
            >
              ‹
            </button>
            <strong>{monthLabel}</strong>
            <button
              type="button"
              aria-label="Próximo mês"
              onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
            >
              ›
            </button>
          </div>
          <div className="sale-calendar-weekdays" aria-hidden="true">
            {weekdays.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
          </div>
          <div className="sale-calendar-days">
            {Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} />)}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const day = index + 1
              const date = new Date(year, month, day)
              const dateKey = getDateKey(date)
              const isSelected = dateKey === value
              const isToday = dateKey === today()
              return (
                <button
                  className={`${isSelected ? 'selected' : ''}${isToday ? ' today' : ''}`}
                  key={dateKey}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectDate(day)}
                >
                  {day}
                </button>
              )
            })}
          </div>
          <button
            className="sale-calendar-today"
            type="button"
            onClick={() => {
              const currentDate = new Date()
              onChange(today())
              setVisibleMonth(currentDate)
              setIsOpen(false)
            }}
          >
            Hoje
          </button>
        </div>
      )}
    </div>
  )
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

export function FinancePage() {
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
    const value = parseCurrency(amount)
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
                <input
                  list="sale-service-options"
                  value={service}
                  onChange={(event) => setService(event.target.value)}
                  placeholder="Ex.: Site institucional"
                />
                <datalist id="sale-service-options">
                  {saleServiceOptions.map((option) => <option key={option} value={option} />)}
                </datalist>
              </label>
              <label className="finance-field">
                <span>Valor</span>
                <input
                  inputMode="decimal"
                  value={formatCurrencyInput(amount)}
                  onChange={(event) => setAmount(sanitizeCurrency(event.target.value))}
                  placeholder="R$ 0,00"
                />
              </label>
              <label className="finance-field">
                <span>Data</span>
                <SaleDatePicker value={soldAt} onChange={setSoldAt} />
              </label>
            </div>
            <div className="sale-service-suggestions" aria-label="Sugestões de serviço">
              <span>Sugestões:</span>
              {saleServiceOptions.map((option) => (
                <button key={option} type="button" onClick={() => setService(option)}>
                  {option}
                </button>
              ))}
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
