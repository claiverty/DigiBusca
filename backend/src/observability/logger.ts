type LogContext = Record<string, boolean | number | string | null | undefined>

export function createRequestId(value?: string | null) {
  return value?.trim() || crypto.randomUUID()
}

export function getRequestId(request: Request) {
  return createRequestId(request.headers.get('cf-ray') ?? request.headers.get('x-request-id'))
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }

  return { name: 'UnknownError', message: 'Erro sem detalhes disponíveis.' }
}

function writeLog(
  level: 'error' | 'info' | 'warn',
  event: string,
  context: LogContext = {},
  error?: unknown,
) {
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'digibusca-api',
    event,
    ...context,
    ...(error === undefined ? {} : { error: serializeError(error) }),
  })

  console[level](record)
}

export function logError(event: string, error: unknown, context?: LogContext) {
  writeLog('error', event, context, error)
}

export function logInfo(event: string, context?: LogContext) {
  writeLog('info', event, context)
}

export function logWarning(event: string, context?: LogContext, error?: unknown) {
  writeLog('warn', event, context, error)
}
