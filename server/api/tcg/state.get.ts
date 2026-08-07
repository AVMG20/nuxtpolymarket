import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgAllowance, tcgBundle } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { getShopSettings } from '#server/utils/tcg/settings'
import { amsterdamDateKey, amsterdamMidnightAfter, bundleWindow } from '#shared/utils/tcg/time'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const now = new Date()
    const shop = await getShopSettings()

    const [allowanceRow] = await db.select().from(tcgAllowance)
        .where(and(eq(tcgAllowance.userId, userId), eq(tcgAllowance.dateKey, amsterdamDateKey(now))))
    const boughtToday = allowanceRow?.packsBought ?? 0

    const win = bundleWindow(now)
    // When the window is closed, win.weekKey already points at the NEXT
    // Friday (see bundleWindow) — nobody can hold a claim for it, so only an
    // open window can show claimedThisWeek.
    let claimedThisWeek = false
    if (win.open) {
        const [bundle] = await db.select({ id: tcgBundle.id }).from(tcgBundle)
            .where(and(eq(tcgBundle.ownerId, userId), eq(tcgBundle.weekKey, win.weekKey)))
        claimedThisWeek = Boolean(bundle)
    }

    return {
        allowance: {
            boughtToday,
            remaining: Math.max(shop.packsPerDay - boughtToday, 0),
            resetsAt: amsterdamMidnightAfter(now).toISOString()
        },
        bundle: {
            windowOpen: win.open,
            claimedThisWeek,
            windowEndsAt: win.windowEndsAt?.toISOString() ?? null,
            nextWindowAt: win.nextWindowAt.toISOString()
        },
        prices: {
            gemsPerPair: shop.gemsPerPair,
            packsPerPair: shop.packsPerPair,
            dailyPacks: shop.packsPerDay,
            bundlePacks: shop.bundlePacks,
            bundleGems: shop.bundleGems
        }
    }
})
