import { count, eq, sum } from 'drizzle-orm'
import { db } from '#server/database'
import { transactions, tcgSet } from '#server/database/schema'
import { requirePokemonAdmin } from '#server/utils/auth'

/**
 * The emission guard (§7.5, "not optional"): the vendor buyback is the
 * module's only Coin faucet, so its volume is watched against pack
 * purchases. At this scale a number on the admin page is the monitoring.
 */
export default defineEventHandler(async (event): Promise<{
    coinsEmitted: number
    payouts: number
    packsSold: number
}> => {
    await requirePokemonAdmin(event)

    const [[vendor], [packs]] = await Promise.all([
        db.select({ total: sum(transactions.amount), n: count() })
            .from(transactions)
            .where(eq(transactions.category, 'tcg:vendor')),
        db.select({ total: sum(tcgSet.packsSold) }).from(tcgSet)
    ])

    return {
        coinsEmitted: parseFloat(vendor?.total ?? '0') || 0,
        payouts: vendor?.n ?? 0,
        packsSold: parseInt(packs?.total ?? '0', 10) || 0
    }
})
