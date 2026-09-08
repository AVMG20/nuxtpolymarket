import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user, transactions, bankHistory, bankState, townPlots } from '#server/database/schema'
import { townPlotIsFlat, townSpiralCoords } from '#shared/utils/gamelogic/town'

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

// Far enough out on the spiral that nothing a spec founds near the origin can
// land on it, and offset per process so two test files running side by side do
// not fight over the same squares.
const FLAT_SCAN_BASE = 250_000 + Math.floor(Math.random() * 250_000)
let flatScanCursor = 0

/**
 * Move a town's plot onto flat grassland — the one kind of plot with no water
 * and no production bonuses on it.
 *
 * Terrain differs from plot to plot, so a fixture that builds on fixed tile
 * coordinates is otherwise placing buildings on whatever the realm happened to
 * put there: a pond blocks the tile outright, and a farm on fertile soil
 * out-produces the number the spec asserts. Flat ground makes the coordinates
 * mean exactly what they say.
 */
export async function moveTownToFlatGround(plotId: string) {
    for (let i = 0; i < 20_000; i++) {
        const spot = townSpiralCoords(FLAT_SCAN_BASE + flatScanCursor++)
        if (!townPlotIsFlat(spot.x, spot.y)) continue
        try {
            const [moved] = await db.update(townPlots)
                .set({ x: spot.x, y: spot.y })
                .where(eq(townPlots.id, plotId))
                .returning()
            if (moved) return moved
        } catch {
            // Somebody else's plot already sits there — take the next square.
        }
    }
    throw new Error('no free flat ground left in the test realm')
}

export async function burst<T>(n: number, fn: (i: number) => Promise<T>) {
    const results = await Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)))
    return {
        ok: results.filter(r => r.status === 'fulfilled').length,
        rejected: results.filter(r => r.status === 'rejected').length
    }
}
