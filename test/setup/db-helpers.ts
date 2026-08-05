import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user, transactions, bankHistory, bankState } from '#server/database/schema'

export const SKIP = !process.env.DATABASE_URL

export async function seedUser(id: string, { balance = '0', gems = 0 }: { balance?: string, gems?: number } = {}) {
    await db.insert(user).values({
        id,
        name: 'concurrency test user',
        email: `${id}@test.invalid`,
        balance,
        gems
    })
}

export async function cleanupUser(id: string) {
    await db.delete(transactions).where(eq(transactions.userId, id))
    await db.delete(bankHistory).where(eq(bankHistory.userId, id))
    await db.delete(bankState).where(eq(bankState.userId, id))
    await db.delete(user).where(eq(user.id, id))
}

type BankSeed = {
    balance?: string
    principal?: string
    maxPrincipal?: string
    loanPrincipal?: string
    lastSettledAt?: Date
    bailoutAt?: Date | null
    bailoutUntil?: Date | null
    bailoutDebt?: string
    bailoutRepaid?: string
}

/** Writes a bank row outright, including a mid-flight bail-out, without going through the endpoints. */
export async function seedBankState(userId: string, seed: BankSeed = {}) {
    const values = { userId, lastSettledAt: new Date(), ...seed }
    await db.insert(bankState).values(values).onConflictDoUpdate({ target: bankState.userId, set: values })
    return getBankState(userId)
}

export async function getBankState(userId: string) {
    const row = await db.query.bankState.findFirst({ where: eq(bankState.userId, userId) })
    if (!row) throw new Error(`no bank state for ${userId}`)
    return row
}

export async function burst<T>(n: number, fn: (i: number) => Promise<T>) {
    const results = await Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)))
    return {
        ok: results.filter(r => r.status === 'fulfilled').length,
        rejected: results.filter(r => r.status === 'rejected').length
    }
}
