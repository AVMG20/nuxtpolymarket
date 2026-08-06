// Player-facing purchase flows (design doc §7.3 + Appendix D).
// Both entry points follow mutation-is-the-guard: the daily-cap upsert and the
// weekly bundle insert ARE the checks — no SELECT-then-UPDATE anywhere.

import { sql } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgAllowance, tcgBundle } from '#server/database/schema'
import type { tcgPack } from '#server/database/schema'
import { buyPackIn } from '#server/utils/tcg/engine'
import { debitGems } from '#server/utils/balance'
import { amsterdamDateKey, bundleWindow } from '#shared/utils/tcg/time'

type PackRow = typeof tcgPack.$inferSelect
type BundleRow = typeof tcgBundle.$inferSelect

export const PACKS_PER_PAIR = 2
export const GEMS_PER_PAIR = 1
export const PACKS_PER_DAY = 4
export const BUNDLE_PACKS = 36
export const BUNDLE_GEMS = 18

/**
 * Buy `pairs` pack-pairs (2 packs / 1 gem each) against the global daily cap.
 * One transaction: the conditional allowance upsert is the cap guard, the gem
 * debit is the affordability guard, and a sellout mid-loop rolls everything
 * back (allowance and gems included).
 */
export async function playerBuyPacks(setId: string, userId: string, pairs: number, now: Date = new Date()): Promise<PackRow[]> {
    if (!Number.isInteger(pairs) || pairs < 1 || pairs * PACKS_PER_PAIR > PACKS_PER_DAY) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid pair count' })
    }
    const packCount = pairs * PACKS_PER_PAIR
    const dateKey = amsterdamDateKey(now)

    return await db.transaction(async (tx) => {
        // Atomic upsert on (userId, dateKey): the increment only applies while
        // the resulting total stays within the cap — no returned row means the
        // daily allowance is spent. Concurrent requests serialize on the row.
        const [claimed] = await tx.insert(tcgAllowance)
            .values({ userId, dateKey, packsBought: packCount })
            .onConflictDoUpdate({
                target: [tcgAllowance.userId, tcgAllowance.dateKey],
                set: { packsBought: sql`${tcgAllowance.packsBought} + ${packCount}` },
                setWhere: sql`${tcgAllowance.packsBought} + ${packCount} <= ${PACKS_PER_DAY}`
            })
            .returning()
        if (!claimed) throw createError({ statusCode: 400, statusMessage: 'Daily pack allowance reached' })

        await debitGems(userId, pairs * GEMS_PER_PAIR, tx)

        const packs: PackRow[] = []
        for (let i = 0; i < packCount; i++) {
            packs.push(await buyPackIn(tx, setId, userId))
        }
        return packs
    })
}

/**
 * Claim the weekly Friday bundle: 36 packs of one set for 18 gems, once per
 * (player, window). The insert under the (ownerId, weekKey) unique constraint
 * is the claim; gems and pack draws roll back with it on sellout, so a failed
 * claim never consumes the week.
 */
export async function claimBundle(setId: string, userId: string, now: Date = new Date()): Promise<{ bundle: BundleRow, packs: PackRow[] }> {
    const win = bundleWindow(now)
    if (!win.open) throw createError({ statusCode: 400, statusMessage: 'Bundle window is closed' })

    return await db.transaction(async (tx) => {
        const [bundle] = await tx.insert(tcgBundle)
            .values({ setId, ownerId: userId, weekKey: win.weekKey })
            .onConflictDoNothing()
            .returning()
        if (!bundle) throw createError({ statusCode: 400, statusMessage: 'Bundle already claimed this week' })

        await debitGems(userId, BUNDLE_GEMS, tx)

        // 36 sequential draws serialize concurrent buyers under the set row
        // lock for the duration of this transaction — acceptable at 7 players.
        const packs: PackRow[] = []
        for (let i = 0; i < BUNDLE_PACKS; i++) {
            packs.push(await buyPackIn(tx, setId, userId, bundle.id))
        }
        return { bundle, packs }
    })
}
