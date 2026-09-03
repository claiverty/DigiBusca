export type Sale = {
  id: string
  leadId?: string
  businessName: string
  service: string
  amount: number
  soldAt: string
}

export type CreateSaleInput = Omit<Sale, 'id'>
