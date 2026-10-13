export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function localDay(value: string): Date {
  return new Date(`${value}T00:00:00`)
}
export function isOpenStatus(status: string): boolean {
  return status !== 'Ganhou' && status !== 'Perdeu'
}
