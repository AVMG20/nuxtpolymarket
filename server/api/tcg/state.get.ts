import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgAllowance, tcgBundle } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { PACKS_PER_PAIR, GEMS_PER_PAIR, PACKS_PER_DAY, BUNDLE_PACKS, BUNDLE_GEMS } from '#server/utils/tcg/player'
import { amsterdamDateKey, amsterdamMidnightAfter, bundleWindow } from '#shared/utils/tcg/time'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const now = new Date()

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
            remaining: Math.max(PACKS_PER_DAY - boughtToday, 0),
            resetsAt: amsterdamMidnightAfter(now).toISOString()
        },
        bundle: {
            windowOpen: win.open,
            claimedThisWeek,
            windowEndsAt: win.windowEndsAt?.toISOString() ?? null,
            nextWindowAt: win.nextWindowAt.toISOString()
        },
        prices: {
            gemsPerPair: GEMS_PER_PAIR,
            packsPerPair: PACKS_PER_PAIR,
            dailyPacks: PACKS_PER_DAY,
            bundlePacks: BUNDLE_PACKS,
            bundleGems: BUNDLE_GEMS
        }
    }
})
