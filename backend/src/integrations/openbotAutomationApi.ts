import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type OpenBotAgent = { id: string; name: string }
export type OpenBotDelivery = {
  id: string
  status: 'queued' | 'starting' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled'
  answer: string | null
}

export class OpenBotAutomationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function automationDirectory() {
  const override = typeof process !== 'undefined' ? process.env.OPENBOT_AUTOMATION_DIR?.trim() : ''
  if (override) return override

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'OpenBot', 'automation')
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'OpenBot', 'automation')
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'OpenBot', 'automation')
}

async function getAutomationConnection() {
  const directory = automationDirectory()
  let baseUrl: string
  let headersText: string

  try {
    ;[baseUrl, headersText] = await Promise.all([
      readFile(join(directory, 'url'), 'utf8'),
      readFile(join(directory, 'headers'), 'utf8'),
    ])
  } catch {
    throw new OpenBotAutomationError(
      'Ative Local scripts no agente DigiProspector em OpenBot > Configurações do agente > Permissões para conectar.',
      503,
    )
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(baseUrl.trim())
  } catch {
    throw new OpenBotAutomationError('A conexão local do OpenBot está inválida. Reinicie o OpenBot e tente novamente.', 503)
  }

  if (parsedUrl.protocol !== 'http:' || parsedUrl.hostname !== '127.0.0.1' || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
    throw new OpenBotAutomationError('A URL do serviço local do OpenBot não passou na validação de segurança.', 503)
  }

  const authorization = headersText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^Authorization:\s*Bearer\s+\S+$/i.test(line))
  if (!authorization) {
    throw new OpenBotAutomationError('A credencial local do OpenBot não está disponível. Reinicie o OpenBot e tente novamente.', 503)
  }

  const [name, value] = authorization.split(/:\s*/, 2)
  return {
    baseUrl: parsedUrl,
    headers: { [name]: value },
  }
}

async function requestOpenBot<T>(path: string, init?: RequestInit): Promise<T> {
  const connection = await getAutomationConnection()
  let response: Response
  try {
    const headers = new Headers(connection.headers)
    if (init?.body) headers.set('Content-Type', 'application/json')
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
    response = await fetch(new URL(path.replace(/^\//, ''), connection.baseUrl), {
      ...init,
      headers,
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new OpenBotAutomationError('Não foi possível alcançar a API local do OpenBot. Confira se ele continua aberto.', 503)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new OpenBotAutomationError('A sessão local da API do OpenBot expirou. Reinicie o OpenBot para renová-la.', 503)
    }
    if (response.status === 403) {
      throw new OpenBotAutomationError('O OpenBot recusou o acesso. Confirme se Local scripts está ativo no agente escolhido.', 403)
    }
    throw new OpenBotAutomationError('O OpenBot não aceitou esta solicitação. Confira o agente e tente novamente.', response.status >= 500 ? 502 : response.status)
  }

  return payload as T
}

export async function listOpenBotAgents(): Promise<OpenBotAgent[]> {
  const payload = await requestOpenBot<unknown>('v1/agents')
  if (!Array.isArray(payload)) {
    throw new OpenBotAutomationError('O OpenBot retornou uma lista de agentes inválida.', 502)
  }

  return payload.flatMap((item): OpenBotAgent[] => {
    if (typeof item !== 'object' || item === null) return []
    const record = item as Record<string, unknown>
    return typeof record.id === 'string' && record.id && typeof record.name === 'string' && record.name
      ? [{ id: record.id, name: record.name }]
      : []
  })
}

export async function sendOpenBotAgentMessage(
  agentId: string,
  text: string,
  clientMessageId: string,
): Promise<{ deliveryId: string; agentName: string }> {
  const agents = await listOpenBotAgents()
  const agent = agents.find((candidate) => candidate.id === agentId)
  if (!agent) throw new OpenBotAutomationError('Este agente não está disponível para Local scripts no OpenBot.', 404)

  const payload = await requestOpenBot<unknown>(`v1/agents/${encodeURIComponent(agentId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text, clientMessageId }),
  })
  if (typeof payload !== 'object' || payload === null) {
    throw new OpenBotAutomationError('O OpenBot retornou uma confirmação inválida.', 502)
  }

  const deliveries = (payload as { deliveries?: unknown }).deliveries
  if (!Array.isArray(deliveries)) throw new OpenBotAutomationError('O OpenBot não confirmou o recebimento da tarefa.', 502)
  const delivery = deliveries.find((item) =>
    typeof item === 'object' && item !== null &&
    (item as Record<string, unknown>).recipientAgentId === agentId &&
    typeof (item as Record<string, unknown>).id === 'string',
  ) as Record<string, unknown> | undefined
  if (!delivery || typeof delivery.id !== 'string') {
    throw new OpenBotAutomationError('O OpenBot não criou uma entrega para o agente escolhido.', 502)
  }

  return { deliveryId: delivery.id, agentName: agent.name }
}

export async function getOpenBotDelivery(agentId: string, deliveryId: string): Promise<OpenBotDelivery> {
  const payload = await requestOpenBot<unknown>(
    `v1/agents/${encodeURIComponent(agentId)}/deliveries/${encodeURIComponent(deliveryId)}`,
  )
  if (typeof payload !== 'object' || payload === null) {
    throw new OpenBotAutomationError('O OpenBot retornou o estado da tarefa em formato inválido.', 502)
  }

  const record = payload as Record<string, unknown>
  const statuses: OpenBotDelivery['status'][] = ['queued', 'starting', 'running', 'completed', 'failed', 'interrupted', 'cancelled']
  if (
    typeof record.id !== 'string' ||
    !statuses.includes(record.status as OpenBotDelivery['status']) ||
    (record.answer !== null && typeof record.answer !== 'string')
  ) {
    throw new OpenBotAutomationError('O OpenBot retornou o estado da tarefa em formato inválido.', 502)
  }

  return { id: record.id, status: record.status as OpenBotDelivery['status'], answer: record.answer as string | null }
}
