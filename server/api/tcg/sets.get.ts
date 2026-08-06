import { count, desc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { serializeSet } from '#server/utils/tcg/engine'
import { PACKS_PER_PAIR, GEMS_PER_PAIR, PACKS_PER_DAY, BUNDLE_PACKS, BUNDLE_GEMS } from '#server/utils/tcg/player'

export default defineEventHandler(async (event) => {
    await requireUserId(event)

    const [sets, cardCounts, printingCounts] = await Promise.all([
        db.select().from(tcgSet).where(eq(tcgSet.status, 'committed')).orderBy(desc(tcgSet.createdAt)),
        db.select({ setId: tcgCard.setId, count: count() }).from(tcgCard).groupBy(tcgCard.setId),
        db.select({ setId: tcgPrinting.setId, count: count() }).from(tcgPrinting).groupBy(tcgPrinting.setId)
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
            gemsPerPair: GEMS_PER_PAIR,
            packsPerPair: PACKS_PER_PAIR,
            dailyPacks: PACKS_PER_DAY,
            bundlePacks: BUNDLE_PACKS,
            bundleGems: BUNDLE_GEMS
        }
    }
})
