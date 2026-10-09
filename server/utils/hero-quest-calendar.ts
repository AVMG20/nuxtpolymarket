/**
 * The login calendar on the server (`shared/utils/hero-quest/calendar.ts`): what each day pays as
 * of now, and a claim.
 *
 * A claim is a compare-and-swap on the three integer calendar columns, never a `hq_state` lock: a
 * day's Keys go to the raid's row first, and a raid entry locks its raid row before touching
 * `hq_state`, so taking `hq_state` first here could deadlock against it. Two claims at once read
 * the same columns; the second's swap matches nothing and throws, rolling back its Keys.
 */

import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DbExecutor } from '#server/database'
import { hqRaidState, hqState } from '#server/database/schema'
import { credit, creditGems } from '#server/utils/balance'
import { bankedGoldOf, getCollections, getShopLevels, heroSnapshotOf, positionOf, sealGrant, tenureDaysOf, type HqStateRow } from '#server/utils/hero-quest'
import { RAID_KEYS_PER_DAY, type CalendarReward } from '#shared/utils/hero-quest/constants'
import { CALENDAR_REWARDS, calendarAfterClaim, calendarClaimDay, calendarCycle, calendarReward, type CalendarStored } from '#shared/utils/hero-quest/calendar'
import { goldPerHourAt } from '#shared/utils/hero-quest/settle'
import { D, fromStore, toStore } from '#shared/utils/hero-quest/numbers'
import type { HeroSnapshot } from '#shared/utils/hero-quest/types'

export function calendarStoredOf(state: HqStateRow): CalendarStored {
    return { start: state.calendarStart, claimed: state.calendarClaimed, makeups: state.calendarMakeups }
}

/** The Gold an hour of the run pays now: what a day's minutes of income are worth. */
export function calendarGoldPerHour(state: HqStateRow, hero: HeroSnapshot): number {
    return goldPerHourAt(hero, positionOf(state), tenureDaysOf(state))
}

/** What a day pays as of now: the Gold its minutes of income buy (whole coins), or its count. */
export function calendarPayout(reward: CalendarReward, goldPerHour: number): string {
    if (reward.kind === 'gold') return String(Math.floor(goldPerHour * reward.amount / 60))
    return String(reward.amount)
}

/** The calendar as the scene draws it: every day's reward and state, the make-ups, and the clocks. */
export function serializeCalendar(state: HqStateRow, goldPerHour: number, now = Date.now()) {
    const cycle = calendarCycle(calendarStoredOf(state), now)
    return {
        /** 0-based. */
        today: cycle.today,
        days: CALENDAR_REWARDS.map((reward, i) => ({
            day: i + 1,
            state: cycle.states[i]!,
            kind: reward.kind,
            system: reward.kind === 'seals' ? reward.system : null,
            raid: reward.kind === 'keys' ? reward.raid : null,
            amount: calendarPayout(reward, goldPerHour)
        })),
        makeupsLeft: cycle.makeupsLeft,
        /** The day a make-up would take, 0-based; null when none is missed. */
        makeupDay: cycle.makeupDay,
        nextDayAt: cycle.nextDayAt,
        endsAt: cycle.endsAt
    }
}

/**
 * Claim today's reward, or with `makeup` the oldest missed day's. Call it inside a transaction,
 * after a settle, so the Gold is sized off the run as it stands.
 */
export async function claimCalendar(tx: DbExecutor, userId: string, makeup: boolean, now = Date.now()) {
    const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId))
    if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })

    const stored = calendarStoredOf(state)
    const cycle = calendarCycle(stored, now)
    const pick = calendarClaimDay(cycle, makeup)
    if ('refused' in pick) throw createError({ statusCode: 400, statusMessage: pick.refused })
    const reward = calendarReward(pick.day)
    const next = calendarAfterClaim(cycle, pick.day, makeup)

    let goldPerHour = 0
    if (reward.kind === 'gold') {
        // with the banked Gold, as `state.get.ts` sizes it, so the Gold paid is the Gold shown
        const [shopLevels, collections, bankedGold] = await Promise.all([getShopLevels(userId, tx), getCollections(userId, tx), bankedGoldOf(tx, userId)])
        goldPerHour = calendarGoldPerHour(state, heroSnapshotOf(state, shopLevels, collections, bankedGold))
    }
    const amount = calendarPayout(reward, goldPerHour)

    // Keys before the swap: a raid entry takes its raid row before hq_state, so this keeps that order.
    // A raid never visited starts with a day's Keys, as `lockRaid` would create it.
    if (reward.kind === 'keys') {
        await tx.insert(hqRaidState)
            .values({ userId, raidId: reward.raid, keyBalance: RAID_KEYS_PER_DAY + reward.amount })
            .onConflictDoUpdate({
                target: [hqRaidState.userId, hqRaidState.raidId],
                set: { keyBalance: sql`${hqRaidState.keyBalance} + ${reward.amount}` }
            })
    }

    const paid = reward.kind === 'seals'
        ? sealGrant(reward.system, reward.amount)
        : reward.kind === 'trait_gems'
            ? { traitGems: sql`${hqState.traitGems} + ${reward.amount}` }
            : reward.kind === 'void_shards'
                ? { voidShards: toStore(fromStore(state.voidShards).add(D(amount))) }
                : {}
    const [claimed] = await tx.update(hqState)
        .set({ calendarStart: next.start, calendarClaimed: next.claimed, calendarMakeups: next.makeups, ...paid })
        .where(and(
            eq(hqState.userId, userId),
            stored.start === null ? isNull(hqState.calendarStart) : eq(hqState.calendarStart, stored.start),
            eq(hqState.calendarClaimed, stored.claimed),
            eq(hqState.calendarMakeups, stored.makeups),
            // Void Shards are rewritten from the read, so a spend since then must fail the swap too
            ...(reward.kind === 'void_shards' ? [eq(hqState.voidShards, state.voidShards)] : [])
        ))
        .returning()
    if (!claimed) throw createError({ statusCode: 409, statusMessage: 'The calendar changed; try again' })

    if (reward.kind === 'gold' && Number(amount) > 0) await credit(userId, Number(amount).toFixed(4), 'hero-quest:calendar', tx)
    if (reward.kind === 'gems') await creditGems(userId, reward.amount, tx)

    return { day: pick.day + 1, makeup, kind: reward.kind, amount }
}
