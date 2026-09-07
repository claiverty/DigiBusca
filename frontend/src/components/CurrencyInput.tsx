type CurrencyInputProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

function normalizeCents(value: string) {
  return value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
}

function formatCurrency(centsValue: string) {
  if (!centsValue) return ''
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    currencyCentsToNumber(centsValue),
  )
}

export function currencyCentsToNumber(value: string) {
  const cents = Number(value.replace(/\D/g, ''))
  return Number.isFinite(cents) ? cents / 100 : Number.NaN
}

export function CurrencyInput({ value, onChange, placeholder = 'R$ 0,00' }: CurrencyInputProps) {
  return (
    <input
      inputMode="decimal"
      value={formatCurrency(value)}
      onChange={(event) => onChange(normalizeCents(event.target.value))}
      placeholder={placeholder}
    />
  )
}
