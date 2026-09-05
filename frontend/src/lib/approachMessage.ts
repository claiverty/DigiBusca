import type { Lead } from '../types'

function getOpportunityContext(lead: Lead): string {
  switch (lead.opportunity) {
    case 'Sem site':
      return 'não encontrei um site listado nos dados públicos do Google'
    case 'Perfil incompleto':
      return 'algumas informações públicas ainda podem ser melhor organizadas para quem procura pelo Google'
    case 'Site desatualizado':
      return 'vocês já têm um site e talvez exista espaço para deixá-lo mais claro para quem quer entrar em contato'
  }
}

export function createApproachMessage(lead: Lead): string {
  const category = lead.category === 'Negócio local' ? 'negócios locais' : lead.category

  return `Olá, pessoal da ${lead.name}! Tudo bem? Encontrei vocês enquanto pesquisava ${category} na região e notei que ${getOpportunityContext(lead)}. Eu ajudo negócios locais a transformar a presença online em mais contatos. Posso enviar uma ideia rápida para vocês?`
}
