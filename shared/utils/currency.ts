/** The two currencies the `transactions` ledger records. */
export type Currency = 'coins' | 'gems'

export const CURRENCIES: Currency[] = ['coins', 'gems']

export function parseCurrency(raw: unknown): Currency {
    return raw === 'gems' ? 'gems' : 'coins'
}
