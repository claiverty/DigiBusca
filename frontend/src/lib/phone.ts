export function hasContactPhone(phone: string): boolean {
  return phone.replace(/\D/g, '').length >= 8
}

export function toWhatsappPhone(phone: string): string | undefined {
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)

  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`
  }

  return undefined
}
