import { count, desc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { serializeSet } from '#server/utils/tcg/engine'
import { getShopSettings } from '#server/utils/tcg/settings'

export default defineEventHandler(async (event) => {
    await requireUserId(event)

    const [sets, cardCounts, printingCounts, shop] = await Promise.all([
        db.select().from(tcgSet).where(eq(tcgSet.status, 'committed')).orderBy(desc(tcgSet.createdAt)),
        db.select({ setId: tcgCard.setId, count: count() }).from(tcgCard).groupBy(tcgCard.setId),
        db.select({ setId: tcgPrinting.setId, count: count() }).from(tcgPrinting).groupBy(tcgPrinting.setId),
        getShopSettings()
    ])
    const cardCountBySet = new Map(cardCounts.map(row => [row.setId, row.count]))
    const printingCountBySet = new Map(printingCounts.map(row => [row.setId, row.count]))

    return {
        sets: sets.map((set) => {
            const { publishedRates: _publishedRates, ...serialized } = serializeSet(set)
            return {
                ...serialized,
                remaining: ((set.targetPackCount ?? 0) - set.packsSold) + serialized.restockCount,
                cardCount: cardCountBySet.get(set.id) ?? 0,
                printingCount: printingCountBySet.get(set.id) ?? 0
            }
        }),
        prices: {
            gemsPerPair: shop.gemsPerPair,
            packsPerPair: shop.packsPerPair,
            dailyPacks: shop.packsPerDay,
            bundlePacks: shop.bundlePacks,
            bundleGems: shop.bundleGems
        }
    }
})
