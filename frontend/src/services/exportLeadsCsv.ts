import type { Lead } from '../types'

const headers = [
  'Empresa',
  'Categoria',
  'Endereço',
  'Telefone',
  'Avaliação',
  'Quantidade de avaliações',
  'Site',
  'Oportunidade',
  'Pontuação',
  'Status',
  'Próximo follow-up',
  'Observações',
  'Fonte',
  'Consultado em',
]

function escapeCsvCell(value: string | number | undefined) {
  const text = String(value ?? '')
  const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replaceAll('"', '""')}"`
}

function getTodayForFilename() {
  return new Intl.DateTimeFormat('en-CA').format(new Date())
}

export function exportLeadsCsv(leads: Lead[]) {
  const rows = leads.map((lead) => [
    lead.name,
    lead.category,
    lead.address,
    lead.phone,
    lead.rating,
    lead.reviews,
    lead.website,
    lead.opportunity,
    lead.score,
    lead.status,
    lead.nextFollowUp,
    lead.notes,
    lead.source,
    lead.retrievedAt,
  ])
  const csv = [headers, ...rows]
    .map((row) => row.map((value) => escapeCsvCell(value)).join(';'))
    .join('\r\n')
  const file = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const objectUrl = URL.createObjectURL(file)
  const downloadLink = document.createElement('a')

  downloadLink.href = objectUrl
  downloadLink.download = `leads-digibusca-${getTodayForFilename()}.csv`
  document.body.append(downloadLink)
  downloadLink.click()
  downloadLink.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}
