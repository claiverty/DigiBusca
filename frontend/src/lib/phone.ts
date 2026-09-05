export function hasContactPhone(phone: string): boolean {
  return phone.replace(/\D/g, '').length >= 8
}
