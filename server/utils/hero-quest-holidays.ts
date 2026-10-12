/**
 * Holiday gifts on the server (`holiday-events.md`, `shared/utils/hero-quest/holidays.ts`): what
 * each open gift pays as of now, and a claim.
 *
 * Claim-then-reward: the claim row goes in first, and its unique key on (user, holiday, year) is
 * the once-per-holiday-per-year guard. A burst of claims all try the insert; one gets a row back,
 * the rest find the conflict and are refused before anything is paid.
 */

import { eq } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { hqHolidayClaims, hqState } from '#server/database/schema'
import { credit, creditGems } from '#server/utils/balance'
import { bankedGoldOf, getCollections, getShopLevels, getTraitBoard, heroSnapshotOf, sealGrant } from '#server/utils/hero-quest'
import { calendarGoldPerHour } from '#server/utils/hero-quest-calendar'
import { holidayGift, holidayGiftGold, openHolidayWindow, openHolidayWindows } from '#shared/utils/hero-quest/holidays'
import { isHolidayId } from '#shared/utils/hero-quest/content/holidays'
import { GACHA_SYSTEMS, type GachaSystem } from '#shared/utils/hero-quest/gacha'
import type { HolidayGift } from '#shared/utils/hero-quest/constants'

export async function getHolidayClaims(userId: string, executor: DbExecutor = db) {
    return executor.select({ holidayId: hqHolidayClaims.holidayId, year: hqHolidayClaims.year })
        .from(hqHolidayClaims)
        .where(eq(hqHolidayClaims.userId, userId))
}

/** A gift's Seals as a list, in the gachas' own order. */
function giftSeals(gift: HolidayGift): { system: GachaSystem, amount: number }[] {
    return GACHA_SYSTEMS.flatMap(system => (gift.seals[system] ?? 0) > 0 ? [{ system, amount: gift.seals[system]! }] : [])
}

/**
 * The gifts open now, for the battle view's gift icon: whether each is claimed and what it pays at
 * the run's current income.
 */
export function serializeHolidays(claims: readonly { holidayId: string, year: number }[], goldPerHour: number, now = Date.now()) {
    return {
        open: openHolidayWindows(now).map((w) => {
            const gift = holidayGift(w.holiday.id)
            return {
                id: w.holiday.id,
                name: w.holiday.name,
                year: w.year,
                closesAt: w.closesAt,
                claimed: claims.some(c => c.holidayId === w.holiday.id && c.year === w.year),
                gold: String(holidayGiftGold(gift, goldPerHour)),
                gems: gift.gems,
                seals: giftSeals(gift)
            }
        })
    }
}

/**
 * Claim an open holiday's gift. Call it inside a transaction, after a settle, so the Gold is sized
 * off the run as it stands. The claim row comes first; the Seals, the Gold and the Gems only once
 * it is in.
 */
export async function claimHoliday(tx: DbExecutor, userId: string, holidayId: unknown, now = Date.now()) {
    if (!isHolidayId(holidayId)) throw createError({ statusCode: 400, statusMessage: 'Unknown holiday' })
    const window = openHolidayWindow(holidayId, now)
    if (!window) throw createError({ statusCode: 400, statusMessage: 'That holiday gift is not open' })

    const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId))
    if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })

    const [claimed] = await tx.insert(hqHolidayClaims)
        .values({ userId, holidayId, year: window.year })
        .onConflictDoNothing()
        .returning()
    if (!claimed) throw createError({ statusCode: 400, statusMessage: `${window.holiday.name}'s gift is already claimed` })

    const gift = holidayGift(holidayId)
    const seals = giftSeals(gift)
    if (seals.length) {
        await tx.update(hqState)
            .set(Object.assign({}, ...seals.map(s => sealGrant(s.system, s.amount))))
            .where(eq(hqState.userId, userId))
    }

    let goldPerHour = 0
    if (gift.goldMinutes > 0) {
        // with the banked Gold, as `state.get.ts` sizes it, so the Gold paid is the Gold shown
        const [shopLevels, collections, bankedGold, traits] = await Promise.all([getShopLevels(userId, tx), getCollections(userId, tx), bankedGoldOf(tx, userId), getTraitBoard(userId, tx)])
        goldPerHour = calendarGoldPerHour(state, heroSnapshotOf(state, shopLevels, collections, bankedGold, traits))
    }
    const gold = holidayGiftGold(gift, goldPerHour)
    if (gold > 0) await credit(userId, gold.toFixed(4), 'hero-quest:holiday', tx)
    if (gift.gems > 0) await creditGems(userId, gift.gems, tx)

    return { holidayId, year: window.year, gold: String(gold), gems: gift.gems, seals }
}
