import type { CreateSaleInput, Sale, UpdateSaleInput } from '../contracts/sale.js'

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

  update(id: string, input: UpdateSaleInput): Sale | undefined {
    const sale = this.sales.get(id)
    if (!sale) return undefined

    const updatedSale = { ...sale, ...input }
    this.sales.set(id, updatedSale)
    return updatedSale
  }

  delete(id: string): boolean {
    return this.sales.delete(id)
  }
}
