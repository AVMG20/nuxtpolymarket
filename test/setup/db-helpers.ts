import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user, transactions } from '#server/database/schema'

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
    await db.delete(user).where(eq(user.id, id))
}

export async function burst<T>(n: number, fn: (i: number) => Promise<T>) {
    const results = await Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)))
    return {
        ok: results.filter(r => r.status === 'fulfilled').length,
        rejected: results.filter(r => r.status === 'rejected').length
    }
}
