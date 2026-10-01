export class GoogleApiMonthlyLimitError extends Error {
  constructor() {
    super('O limite mensal de consultas do Google foi atingido. Novas buscas estarão disponíveis no próximo mês.')
    this.name = 'GoogleApiMonthlyLimitError'
  }
}

export function isGoogleApiMonthlyLimitError(error: unknown): error is GoogleApiMonthlyLimitError {
  return error instanceof GoogleApiMonthlyLimitError
}
