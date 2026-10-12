/**
 * Free 10-pull entitlements (session-1 playtest, finding 3).
 *
 * Two halves, and they are tested very differently on purpose:
 *
 * - `freePullState` is pure and is the *only* place availability is decided. The server enforces
 *   with it and the client counts down against it, so a bug here is a bug in both at once — which
 *   is exactly why it is worth this many specs.
 * - The route half is a **concurrency** question, not a logic one. An entitlement is value, so
 *   the only interesting question is what happens when two claims race, and that needs a real
 *   database and a real row lock.
 *
 * The DB half needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqCollection, hqState } from '#server/database/schema'
import { claimFreePull, ensureHqState } from '#server/utils/hero-quest'
import { freePullState, ladderDateKey, nextDayResetAt } from '#shared/utils/hero-quest/gacha'
import { FREE_PULLS_PER_DAY, FREE_PULL_COOLDOWN_MINUTES } from '#shared/utils/hero-quest/constants'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const NOW = Date.UTC(2026, 7, 17, 12, 0, 0)
const TODAY = ladderDateKey(NOW)
const COOLDOWN_MS = FREE_PULL_COOLDOWN_MINUTES * 60_000

describe('freePullState', () => {
    it('offers the full daily allowance to an account that has never claimed', () => {
        const state = freePullState(0, null, null, NOW)
        expect(state.available).toBe(true)
        expect(state.remaining).toBe(FREE_PULLS_PER_DAY)
        expect(state.unlocksAt).toBeNull()
    })

    it('holds the next claim for exactly the cooldown', () => {
        const justClaimed = freePullState(1, TODAY, NOW, NOW)
        expect(justClaimed.available).toBe(false)
        expect(justClaimed.unlocksAt).toBe(NOW + COOLDOWN_MS)

        // Boundary is inclusive: at exactly the cooldown it is takeable, not one tick later.
        expect(freePullState(1, TODAY, NOW, NOW + COOLDOWN_MS).available).toBe(true)
        expect(freePullState(1, TODAY, NOW, NOW + COOLDOWN_MS - 1).available).toBe(false)
    })

    it('stops at the daily allowance even when the cooldown has long expired', () => {
        const spent = freePullState(FREE_PULLS_PER_DAY, TODAY, NOW - COOLDOWN_MS * 10, NOW)
        expect(spent.available).toBe(false)
        expect(spent.remaining).toBe(0)
    })

    it('points a spent allowance at the next UTC day, not at the cooldown', () => {
        // The two gates answer different questions and the wrong one would show a cooldown
        // countdown that expires into another refusal.
        const spent = freePullState(FREE_PULLS_PER_DAY, TODAY, NOW, NOW)
        expect(spent.unlocksAt).toBe(nextDayResetAt(NOW))
    })

    it('takes the later gate when the allowance resets while a cooldown is still running', () => {
        // Claim the last one just before midnight: the day rolls over first, but the cooldown
        // has not. A naive `nextDayResetAt` would hand out a pull a minute early.
        const nearMidnight = nextDayResetAt(NOW) - 60_000
        const state = freePullState(FREE_PULLS_PER_DAY, TODAY, nearMidnight, nearMidnight)
        expect(state.unlocksAt).toBe(nearMidnight + COOLDOWN_MS)
        expect(state.unlocksAt).toBeGreaterThan(nextDayResetAt(NOW))
    })

    it('resets the counter when the stored day key is stale', () => {
        // Nothing runs at midnight — a yesterday key simply reads as zero used, which is the
        // same trick the Gold ladder uses and the reason neither needs a scheduled job.
        const yesterday = ladderDateKey(NOW - 24 * 3600_000)
        const state = freePullState(FREE_PULLS_PER_DAY, yesterday, NOW - COOLDOWN_MS, NOW)
        expect(state.used).toBe(0)
        expect(state.remaining).toBe(FREE_PULLS_PER_DAY)
        expect(state.available).toBe(true)
    })

    it('still honours the cooldown across a day boundary', () => {
        // The reset must not be farmable by claiming at 23:59 and again at 00:00.
        const yesterday = ladderDateKey(NOW - 24 * 3600_000)
        const state = freePullState(FREE_PULLS_PER_DAY, yesterday, NOW - 60_000, NOW)
        expect(state.remaining).toBe(FREE_PULLS_PER_DAY)
        expect(state.available).toBe(false)
        expect(state.unlocksAt).toBe(NOW - 60_000 + COOLDOWN_MS)
    })

    it('never reports available and a countdown at the same time', () => {
        // `unlocksAt === null` is the client's only signal to render a live button, so the two
        // fields disagreeing would put a countdown on an enabled button or vice versa.
        for (const used of [0, 1, FREE_PULLS_PER_DAY, FREE_PULLS_PER_DAY + 5]) {
            for (const last of [null, NOW, NOW - COOLDOWN_MS, NOW - COOLDOWN_MS * 3]) {
                const state = freePullState(used, TODAY, last, NOW)
                expect(state.available, `${used}/${last}`).toBe(state.unlocksAt === null)
            }
        }
    })

    it('treats a corrupt negative counter as unspent rather than as extra allowance', () => {
        expect(freePullState(-5, TODAY, null, NOW).remaining).toBe(FREE_PULLS_PER_DAY)
    })
})

describe.skipIf(SKIP)('free pull claiming', () => {
    const USER_ID = 'test-hero-quest-freepull-user'

    async function cleanup() {
        await db.delete(hqCollection).where(eq(hqCollection.userId, USER_ID))
        await db.delete(hqState).where(eq(hqState.userId, USER_ID))
        await cleanupUser(USER_ID)
    }

    async function readState() {
        const [row] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
        return row!
    }

    /** Spends today's whole Champion allowance, one claim per cooldown, all within the same day. */
    async function exhaustTodaysAllowance() {
        for (let claim = 0; claim < FREE_PULLS_PER_DAY; claim++) {
            await db.transaction(tx => claimFreePull(tx, USER_ID, 'champion', NOW + COOLDOWN_MS * claim))
        }
    }

    beforeEach(async () => {
        await cleanup()
        await seedUser(USER_ID, { balance: '0' })
        await ensureHqState(USER_ID)
    })
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    it('starts every gacha with its full allowance and an empty clock', async () => {
        const state = await readState()
        expect(state.freePullDate).toBeNull()
        expect(state.freePullsUsedToday).toEqual({})
        expect(state.freePullClaimedAt).toEqual({})

        for (const system of ['gear', 'champion', 'skill', 'artifact']) {
            const resolved = freePullState(0, state.freePullDate, null, NOW)
            expect(resolved.available, system).toBe(true)
        }
    })

    it('keeps each gacha on its own allowance and its own clock', async () => {
        // The whole reason these are per-system maps rather than integers: taking the Champion
        // entitlement must not consume or delay the Skill one.
        await db.update(hqState)
            .set({
                freePullDate: TODAY,
                freePullsUsedToday: { champion: FREE_PULLS_PER_DAY },
                freePullClaimedAt: { champion: new Date(NOW).toISOString() }
            })
            .where(eq(hqState.userId, USER_ID))

        const state = await readState()
        const used = state.freePullsUsedToday as Record<string, number>
        const clocks = state.freePullClaimedAt as Record<string, string>

        const champion = freePullState(used.champion ?? 0, state.freePullDate, Date.parse(clocks.champion!), NOW)
        const skill = freePullState(used.skill ?? 0, state.freePullDate, null, NOW)

        expect(champion.available).toBe(false)
        expect(skill.available).toBe(true)
        expect(skill.remaining).toBe(FREE_PULLS_PER_DAY)
    })

    it('lets exactly one of a concurrent burst spend the entitlement', async () => {
        // The reason `claimFreePull` is lock-then-read rather than read-then-write. Ten parallel
        // claims all see "0 used, no cooldown" without a lock, and all ten pay out — the exact
        // shape that once turned one rakeback claim into ten. With the lock, the first writes a
        // claim timestamp and the other nine read it and refuse.
        //
        // One winner, not two, even though the allowance is more than one: the cooldown
        // gates every claim after the first.
        const results = await burst(10, () =>
            db.transaction(tx => claimFreePull(tx, USER_ID, 'champion'))
        )

        expect(results.ok).toBe(1)
        expect(results.rejected).toBe(9)

        const state = await readState()
        expect((state.freePullsUsedToday as Record<string, number>).champion).toBe(1)
    })

    it('lets the rest through as the cooldown passes, and no further that day', async () => {
        // Time is injected rather than waited on — the specs must not take half an hour, and the
        // clock being a parameter is what makes the boundary testable at all.
        //
        // Anchored at midday UTC, not `Date.now()`, and kept to a few cooldowns: advancing far
        // enough to cross UTC midnight legitimately refills the allowance. "Long enough later"
        // and "still today" are different ideas here.
        //
        // Walks the whole allowance rather than assuming its size — the count is a tuned
        // constant, and this spec is about the two gates, not about it being any one number.
        await exhaustTodaysAllowance()

        expect((await readState()).freePullsUsedToday).toMatchObject({ champion: FREE_PULLS_PER_DAY })

        // One more is refused on the daily allowance, cooldown long since irrelevant.
        await expect(
            db.transaction(tx => claimFreePull(tx, USER_ID, 'champion', NOW + COOLDOWN_MS * (FREE_PULLS_PER_DAY + 2)))
        ).rejects.toThrowError(expect.objectContaining({ statusCode: 400 }))
    })

    it('refills the allowance after the UTC day rolls over', async () => {
        // The other half of the spec above: exhausting today is not exhausting forever.
        await exhaustTodaysAllowance()

        const tomorrow = nextDayResetAt(NOW)
        await db.transaction(tx => claimFreePull(tx, USER_ID, 'champion', tomorrow))
        expect((await readState()).freePullsUsedToday).toMatchObject({ champion: 1 })
    })

    it('refuses a second claim inside the cooldown and says when', async () => {
        await db.transaction(tx => claimFreePull(tx, USER_ID, 'skill', NOW))

        let message = ''
        try {
            await db.transaction(tx => claimFreePull(tx, USER_ID, 'skill', NOW + 60_000))
        } catch (error) {
            message = (error as { statusMessage?: string }).statusMessage ?? ''
        }
        // A bare refusal is useless on a timed mechanic — the wait has to be in the message.
        expect(message).toContain('min')
    })

    it('drops a stale day map instead of carrying other systems forward', async () => {
        // The route rebuilds the map on a rollover rather than spreading it. Spreading would
        // carry yesterday's Skill count into today and silently eat an allowance for a gacha
        // the request never touched.
        const yesterday = ladderDateKey(NOW - 24 * 3600_000)
        await db.update(hqState)
            .set({
                freePullDate: yesterday,
                freePullsUsedToday: { champion: 2, skill: 2, gear: 2 }
            })
            .where(eq(hqState.userId, USER_ID))

        const state = await readState()
        for (const system of ['champion', 'skill', 'gear']) {
            const used = (state.freePullsUsedToday as Record<string, number>)[system] ?? 0
            expect(freePullState(used, state.freePullDate, null, NOW).available, system).toBe(true)
        }
    })
})
