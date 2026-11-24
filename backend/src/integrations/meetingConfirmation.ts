const timeZone = 'America/Sao_Paulo'

type LocalDateTime = { year: number; month: number; day: number; hour: number; minute: number }
type LocalDate = Pick<LocalDateTime, 'year' | 'month' | 'day'>

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR')
}

function localDateTime(value: string): LocalDateTime | undefined {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return undefined
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  const result = {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute),
  }
  return Object.values(result).every(Number.isFinite) ? result : undefined
}

function mentionedTimes(value: string) {
  const text = normalizeText(value)
  const values = new Set<string>()
  const patterns = [
    /\bas\s+(\d{1,2})(?::(\d{2})|h(\d{2})?)?\b/g,
    /\b(\d{1,2})(?::(\d{2})|h(\d{2})?|\s+horas?)\b/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const hour = Number(match[1])
      const minute = Number(match[2] ?? match[3] ?? 0)
      if (hour <= 23 && minute <= 59) values.add(`${hour}:${minute}`)
    }
  }
  return [...values].map((value) => {
    const [hour, minute] = value.split(':').map(Number)
    return { hour, minute }
  })
}

const months = new Map([
  ['janeiro', 1], ['fevereiro', 2], ['marco', 3], ['abril', 4], ['maio', 5], ['junho', 6],
  ['julho', 7], ['agosto', 8], ['setembro', 9], ['outubro', 10], ['novembro', 11], ['dezembro', 12],
])

function shiftDate(date: LocalDate, days: number): LocalDate {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: result.getUTCFullYear(), month: result.getUTCMonth() + 1, day: result.getUTCDate() }
}

function validDate(day: number, month: number, year: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
}

function mentionedDates(value: string, relativeTo: string): LocalDate[] | undefined {
  const text = normalizeText(value)
  const reference = localDateTime(relativeTo)
  if (!reference) return undefined
  const dates: LocalDate[] = []
  const numeric = /\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?\b/g
  for (const match of text.matchAll(numeric)) {
    const day = Number(match[1])
    const month = Number(match[2])
    const yearText = match[3]
    const year = yearText ? Number(yearText.length === 2 ? `20${yearText}` : yearText) : reference.year
    if (year < 2020 || year > 2200 || !validDate(day, month, year)) return undefined
    dates.push({ year: yearText ? year : 0, month, day })
  }
  const named = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${[...months.keys()].join('|')})(?:\\s+de\\s+(\\d{4}))?\\b`, 'g')
  for (const match of text.matchAll(named)) {
    const day = Number(match[1])
    const month = months.get(match[2]!)
    const year = match[3] ? Number(match[3]) : reference.year
    if (!month || year < 2020 || year > 2200 || !validDate(day, month, year)) return undefined
    dates.push({ year: match[3] ? year : 0, month, day })
  }
  if (/\bdepois de amanha\b/.test(text)) dates.push(shiftDate(reference, 2))
  else if (/\bamanha\b/.test(text)) dates.push(shiftDate(reference, 1))
  else if (/\bhoje\b/.test(text)) dates.push(reference)
  return dates
}

function dateMatches(date: LocalDate, expected: LocalDate) {
  return date.month === expected.month && date.day === expected.day && (!date.year || date.year === expected.year)
}

function timeMatches(times: Array<{ hour: number; minute: number }>, expected: LocalDateTime) {
  return times.length === 1 && times[0]!.hour === expected.hour && times[0]!.minute === expected.minute
}

/**
 * Ensures the last assistant message offered this exact slot and invited the
 * customer to accept it. The customer can then confirm naturally with “sim”,
 * “confirmo”, “pode marcar”, or a similar clear response.
 */
export function isMeetingConfirmationRequestForSlot(message: string, startAt: string, sentAt: string) {
  const text = normalizeText(message)
  const proposed = localDateTime(startAt)
  if (!proposed || !timeMatches(mentionedTimes(text), proposed)) return false
  const dates = mentionedDates(text, sentAt)
  if (!dates?.length || dates.some((date) => !dateMatches(date, proposed))) return false
  const mentionsMeeting = /\b(?:reuniao|encontro|call|meet|agenda|horario|agend\w*|marc\w*|reserv\w*|livre|confirm\w*)\b/.test(text)
  const invitesConfirmation = /\?|\b(?:me responde|me diga|me confirma|confirma pra mim|pode ser|posso (?:reservar|marcar|confirmar)|quer que eu|te serve|serve pra voce|funciona pra voce|fica bom pra voce|me avisa|me fala|se estiver bom)\b/.test(text)
  return mentionsMeeting && invitesConfirmation
}

/** Accepts a clear, natural affirmative while rejecting ambiguity or a changed slot. */
export function isClearMeetingAcceptance(message: string, startAt: string, receivedAt: string) {
  const text = normalizeText(message).trim()
  const proposed = localDateTime(startAt)
  if (!text || !proposed) return false
  if (/\b(?:nao|negativ\w*|talvez|quem sabe|acho que|nao sei|deixa|cancel\w*|vou ver|vou pensar|preciso ver|outro dia|outro horario|mais tarde|porem|mas|se|caso|agora nao|nao posso|nao consigo)\b/.test(text)) return false
  const times = mentionedTimes(text)
  if (times.length && !timeMatches(times, proposed)) return false
  const dates = mentionedDates(text, receivedAt)
  if (!dates || dates.some((date) => !dateMatches(date, proposed))) return false
  const affirmative = /\b(?:sim|claro|pode|ok|okay|confirm\w*|fechad\w*|combinad\w*|perfeit\w*|beleza|blz|show|demorou|bora|de acordo|aceito|certo|ta bom|tudo certo|tranquilo|isso mesmo|isso|com certeza|otimo|top|ate amanha|ate la|nos vemos|estarei|vou estar)\b/.test(text)
  const emojiOnly = /^[\s.,!👍👌✅🤝🙏🏻🙏🏽🙏🏾🙏🏿❤️♥️]+$/u.test(message)
  return affirmative || emojiOnly
}
