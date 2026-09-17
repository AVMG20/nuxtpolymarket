import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSettings } from '#server/database/schema'

/**
 * Shop economics (§7.3), admin-tunable. The singleton 'shop' row overrides
 * these launch defaults; no row means the defaults apply unchanged.
 */
export interface TcgShopSettings {
    packsPerPair: number
    gemsPerPair: number
    packsPerDay: number
    bundlePacks: number
    bundleGems: number
}

export const TCG_SHOP_DEFAULTS: TcgShopSettings = {
    packsPerPair: 2,
    gemsPerPair: 1,
    packsPerDay: 4,
    bundlePacks: 36,
    bundleGems: 18
}

const ROW_ID = 'shop'

export async function getShopSettings(): Promise<TcgShopSettings> {
    const [row] = await db.select().from(tcgSettings).where(eq(tcgSettings.id, ROW_ID))
    if (!row) return { ...TCG_SHOP_DEFAULTS }
    return {
        packsPerPair: row.packsPerPair,
        gemsPerPair: row.gemsPerPair,
        packsPerDay: row.packsPerDay,
        bundlePacks: row.bundlePacks,
        bundleGems: row.bundleGems
    }
}

export async function updateShopSettings(next: TcgShopSettings): Promise<TcgShopSettings> {
    for (const [key, value] of Object.entries(next)) {
        if (!Number.isInteger(value) || value < 1 || value > 100000) {
            throw createError({ statusCode: 400, statusMessage: `Invalid ${key}` })
        }
    }
    if (next.packsPerDay < next.packsPerPair) {
        throw createError({ statusCode: 400, statusMessage: 'Daily cap below one pair — nothing would be buyable' })
    }
    await db.insert(tcgSettings)
        .values({ id: ROW_ID, ...next })
        .onConflictDoUpdate({
            target: tcgSettings.id,
            set: { ...next, updatedAt: new Date() }
        })
    return next
}
