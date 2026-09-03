import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarDays, Plus, Receipt } from 'lucide-react'
import { createSale, getSales } from '../services/leadsService'
import type { Sale } from '../types/sales'
import './FinancePage.css'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`))
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function isCurrentMonth(value: string) {
  const date = new Date(`${value}T12:00:00`)
  const current = new Date()
  return date.getMonth() === current.getMonth() && date.getFullYear() === current.getFullYear()
}

export function FinancePage() {
  const [sales, setSales] = useState<Sale[]>([])
  const [businessName, setBusinessName] = useState('')
  const [service, setService] = useState('')
  const [amount, setAmount] = useState('')
  const [soldAt, setSoldAt] = useState(today())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    void getSales().then((items) => { setSales(items); setStatus('ready') }).catch(() => setStatus('error'))
  }, [])

  const periodSales = useMemo(() => sales.filter((sale) => isCurrentMonth(sale.soldAt)), [sales])
  const periodTotal = periodSales.reduce((total, sale) => total + sale.amount, 0)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback('')

    const value = Number(amount.replace(',', '.'))
    if (!businessName.trim() || !service.trim() || !Number.isFinite(value) || value < 0 || !soldAt) {
      setFeedback('Preencha comércio, serviço, valor e data.')
      return
    }

    try {
      const sale = await createSale({ businessName, service, amount: value, soldAt })
      setSales((current) => [sale, ...current])
      setBusinessName('')
      setService('')
      setAmount('')
      setFeedback('Venda registrada.')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível registrar a venda.')
    }
  }

  return (
    <section className="finance-page">
      <header className="page-header finance-header">
        <div>
          <span className="eyebrow">CONTROLE FINANCEIRO</span>
          <h1>Suas vendas, em um só lugar.</h1>
          <p>Registre o que você vendeu e consulte seu histórico quando precisar.</p>
        </div>
      </header>

      <div className="finance-summary" aria-label="Resumo financeiro">
        <div className="finance-metric panel">
          <span className="eyebrow">VENDAS NO PERÍODO</span>
          <strong>{periodSales.length}</strong>
          <span className="muted">Neste mês</span>
        </div>
        <div className="finance-metric panel">
          <span className="eyebrow">TOTAL NO PERÍODO</span>
          <strong>{formatCurrency(periodTotal)}</strong>
          <span className="muted">Neste mês</span>
        </div>
      </div>

      <div className="finance-layout">
        <form className="panel sale-form" onSubmit={handleSubmit}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">NOVA VENDA</span>
              <h2>Adicionar ao histórico</h2>
            </div>
            <div className="section-icon"><Plus size={18} /></div>
          </div>
          <label className="finance-field"><span>Comércio ou cliente</span><input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Ex.: Padaria Central" /></label>
          <label className="finance-field"><span>O que foi vendido</span><input value={service} onChange={(event) => setService(event.target.value)} placeholder="Ex.: Site institucional" /></label>
          <div className="finance-form-grid">
            <label className="finance-field"><span>Valor</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="R$ 0,00" /></label>
            <label className="finance-field"><span>Data</span><input type="date" value={soldAt} onChange={(event) => setSoldAt(event.target.value)} /></label>
          </div>
          <button className="primary-button" type="submit">Registrar venda</button>
          {feedback && <span className="form-feedback" role="status">{feedback}</span>}
        </form>

        <section className="panel sales-history">
          <div className="section-heading">
            <div>
              <span className="eyebrow">HISTÓRICO</span>
              <h2>Vendas registradas</h2>
            </div>
            <Receipt size={19} className="section-muted-icon" />
          </div>
          {status === 'loading' && <div className="data-state">Carregando histórico...</div>}
          {status === 'error' && <div className="data-state" role="alert">Não foi possível carregar o histórico.</div>}
          {status === 'ready' && sales.length === 0 && <div className="empty-history"><CalendarDays size={22} /><p>Nenhuma venda registrada ainda.</p><span>As vendas convertidas de um lead também aparecerão aqui.</span></div>}
          {sales.length > 0 && <div className="sales-list">{sales.map((sale) => <article className="sale-row" key={sale.id}><div><strong>{sale.businessName}</strong><span>{sale.service}</span></div><div className="sale-row-meta"><time>{formatDate(sale.soldAt)}</time><strong>{formatCurrency(sale.amount)}</strong></div></article>)}</div>}
        </section>
      </div>
    </section>
  )
}
