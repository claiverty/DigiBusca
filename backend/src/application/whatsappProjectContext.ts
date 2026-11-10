export type ProjectMessage = { direction: 'inbound' | 'outbound'; body: string | null }

function normalize(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim()
}

const serviceNames = [
  { label: 'landing page', pattern: /\blanding\s*page\b/ },
  { label: 'loja virtual', pattern: /\b(?:loja virtual|e-?commerce)\b/ },
  { label: 'automação', pattern: /\b(?:automacao|automatizar|automatizacoes)\b/ },
  { label: 'sistema', pattern: /\b(?:sistema|software|plataforma|aplicativo)\b/ },
  { label: 'site', pattern: /\b(?:site|website)\b/ },
]

function serviceMention(text: string) {
  const normalized = normalize(text)
    .replace(/\b(?:vim|cheguei|entrei|encontrei voces) pel[oa] site(?: d[ao] digi\s*up)?/g, '')
    .split(/\b(?:em vez de|ao inves de)\b/)[0]!
  const clauses = normalized.split(/[,;.!?\n]+|\b(?:mas|e sim)\b/).reverse()
  for (const clause of clauses) {
    if (/\bnao (?:quero|preciso|e|seria|tem a ver com)\b/.test(clause)) continue
    const service = serviceNames.find(({ pattern }) => pattern.test(clause))
    if (service) return service.label
  }
  return undefined
}

function lastLeadService(messages: ProjectMessage[]) {
  for (const message of [...messages].reverse()) {
    if (message.direction !== 'inbound' || !message.body) continue
    const service = serviceMention(message.body)
    if (service) return service
    if (isProjectServiceCorrection(message.body)) return undefined
  }
  return undefined
}

function isProjectOpening(text: string) {
  const normalized = normalize(text)
  if (/\b(?:novo|outro) (?:projeto|servico)\b/.test(normalized)) return true
  if (/\b(?:retomando|continuar|continuando|como combinamos|projeto de (?:ontem|antes)|sobre o mesmo projeto)\b/.test(normalized)) return false
  if (/^(?:oi|ola|bom dia|boa tarde|boa noite|tudo bem)[.!? ]*$/.test(normalized)) return true
  return /\b(?:vim pelo site|(?:novo|outro) projeto|(?:gostaria|quero|queria|preciso)(?: de)? (?:conversar|falar)(?: com voces)? sobre (?:um |o )?projeto)\b/.test(normalized)
}

const confirmationQuestion = /\b(?:e sobre (?:a |o )?.+que voce comentou antes ou e outro projeto|voce quer retomar (?:a |o )?.+que comentou antes ou esta pensando em outro projeto)\b/
const neutralDiscoveryReply = 'Me conta um pouco do que você está pensando para esse projeto'

export function isProjectServiceCorrection(text: string) {
  const normalized = normalize(text)
  return /\bnao (?:quero|preciso|e|seria)\b/.test(normalized)
    && serviceNames.some(({ pattern }) => pattern.test(normalized))
    && !/\b(?:pare|parar|mensagens?|contato|propaganda|receber|descadastrar)\b/.test(normalized)
}

export function resolveWhatsAppProjectContext(messages: ProjectMessage[]) {
  let openingIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.direction === 'inbound' && message.body && isProjectOpening(message.body)) {
      openingIndex = index
      break
    }
  }
  const currentMessages = openingIndex >= 0 ? messages.slice(openingIndex) : messages
  const priorService = openingIndex > 0 ? lastLeadService(messages.slice(0, openingIndex)) : undefined
  const currentService = lastLeadService(currentMessages)
  const latestInbound = [...currentMessages].reverse().find(({ direction }) => direction === 'inbound')
  const latestText = normalize(latestInbound?.body ?? '')
  const lastOutbound = [...currentMessages].reverse().find(({ direction }) => direction === 'outbound')
  const answeredConfirmation = Boolean(lastOutbound?.body && confirmationQuestion.test(normalize(lastOutbound.body)))
  let previousProjectConfirmed = false
  let awaitingConfirmation = false
  for (const message of currentMessages) {
    if (message.direction === 'outbound' && message.body && confirmationQuestion.test(normalize(message.body))) {
      awaitingConfirmation = true
    } else if (message.direction === 'inbound' && awaitingConfirmation) {
      previousProjectConfirmed = Boolean(priorService
        && !/\b(?:novo|outro) (?:projeto|servico)\b/.test(normalize(message.body ?? ''))
        && /^(?:sim|isso|isso mesmo|exato|exatamente|correto|o mesmo|e isso|e sobre ela|e sobre ele|pode ser)(?:[.! ,]|$)/.test(normalize(message.body ?? '')))
      awaitingConfirmation = false
    }
    if (message.direction === 'inbound' && message.body && isProjectServiceCorrection(message.body) && !serviceMention(message.body)) {
      previousProjectConfirmed = false
    }
  }
  if (currentService && currentService !== priorService) previousProjectConfirmed = false
  const latestIsOpening = Boolean(latestInbound?.body && isProjectOpening(latestInbound.body))
  const wantsDifferentProject = /\b(?:novo|outro) (?:projeto|servico)\b/.test(latestText)
  let clarificationReply: string | undefined
  if (latestIsOpening && !currentService) {
    clarificationReply = priorService && !wantsDifferentProject
      ? `Você quer retomar ${priorService === 'landing page' || priorService === 'loja virtual' || priorService === 'automação' ? 'a' : 'o'} ${priorService} que comentou antes ou está pensando em outro projeto?`
      : neutralDiscoveryReply
  } else if (!currentService && ((answeredConfirmation && !previousProjectConfirmed && /^(?:nao|outro|e outro|na verdade)(?:[.! ,]|$)/.test(latestText)) || isProjectServiceCorrection(latestInbound?.body ?? ''))) {
    clarificationReply = neutralDiscoveryReply
  }
  return {
    messages: previousProjectConfirmed ? messages : currentMessages,
    priorService,
    currentService: currentService ?? (previousProjectConfirmed ? priorService : undefined),
    previousProjectConfirmed,
    startsNewRequest: latestIsOpening,
    clarificationReply,
  }
}
