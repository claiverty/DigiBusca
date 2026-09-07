import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import './DatePicker.css'

type DatePickerProps = {
  value: string
  onChange: (value: string) => void
}

const weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

function today() {
  return toDateKey(new Date())
}

function getCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return year && month && day ? new Date(year, month - 1, day) : new Date()
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateInput(value: string) {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}/${year}` : 'Escolher data'
}

export function DatePicker({ value, onChange }: DatePickerProps) {
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
    onChange(toDateKey(nextDate))
    setVisibleMonth(nextDate)
    setIsOpen(false)
  }

  return (
    <div className="date-picker">
      <button
        className="date-picker-trigger"
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{formatDateInput(value)}</span>
        <CalendarDays size={17} aria-hidden="true" />
      </button>
      {isOpen && (
        <div className="date-picker-calendar" role="dialog" aria-label="Escolher data">
          <div className="date-picker-header">
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
          <div className="date-picker-weekdays" aria-hidden="true">
            {weekdays.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
          </div>
          <div className="date-picker-days">
            {Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} />)}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const day = index + 1
              const date = new Date(year, month, day)
              const dateKey = toDateKey(date)
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
          <div className="date-picker-actions">
            {value && <button type="button" onClick={() => { onChange(''); setIsOpen(false) }}>Limpar</button>}
            <button
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
        </div>
      )}
    </div>
  )
}
