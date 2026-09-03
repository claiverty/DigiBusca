import type { CreateSaleInput, Sale } from '../contracts/sale.js'

export class SalesStore {
  private readonly sales = new Map<string, Sale>()

  list(): Sale[] {
    return Array.from(this.sales.values()).sort((first, second) =>
      second.soldAt.localeCompare(first.soldAt),
    )
  }

  create(input: CreateSaleInput): Sale {
    const sale: Sale = {
      ...input,
      id: `sale-${Date.now()}-${this.sales.size + 1}`,
    }

    this.sales.set(sale.id, sale)
    return sale
  }
}
