export function normalizeWhatsAppReplyText(text: string) {
  let normalized = text.trim()
    .replace(/!+\s*([\p{Ll}])/gu, (_match, letter: string) => `. ${letter.toLocaleUpperCase('pt-BR')}`)
    .replace(/!+/g, '.')
    .replace(/\?{2,}/g, '?')
    .replace(/\.{2,}/g, '.')
    .replace(/,{2,}/g, ',')
    .replace(/\?\./g, '?')
    .replace(/\.\?/g, '?')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/([,;])(?=\S)/g, '$1 ')
    .replace(/([.!?])(?=\S)/g, '$1 ')
    .replace(/\s+/g, ' ')

  if (normalized.endsWith('.')) normalized = normalized.slice(0, -1)
  return normalized.trim()
}
