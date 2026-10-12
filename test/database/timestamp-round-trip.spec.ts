/**
 * A `defaultNow()` timestamp must come back as the instant it was written.
 *
 * Every idle game here founds its state row with a settle clock defaulted by Postgres and then
 * accrues from `Date.now() - clock.getTime()`. The two halves of that round trip are written by
 * different parties and only agree if they agree about time zones: drizzle's node-postgres driver
 * reads a naive `timestamp` as UTC, while `now()` is rendered by Postgres in the **session's**
 * zone. Unpinned, a developer machine in Europe/Amsterdam wrote `13:50:02` for an instant whose
 * UTC time was `11:50:02` and read it back two hours in the future.
 *
 * The consequence was total, not marginal. `settleHq` takes its `elapsedMs <= 0` early return on a
 * future clock — *before* the write that would correct it — so a brand-new run accrued nothing
 * whatsoever for exactly the UTC offset while the client's projection walked forward on its own
 * ticker. The screen advanced, every refresh snapped it back to the founding position, and the
 * run looked like it was being restarted on reload. `bank_state`, `colony_state` and the miner
 * are all built the same way and were all equally dead on a fresh row.
 *
 * `server/database/index.ts` pins the connection to UTC. This is the assertion that says so.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hqState } from '#server/database/schema'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

describe.skipIf(SKIP)('timestamp round trip', () => {
    const USER_ID = 'test-database-timestamp-round-trip-user'

    async function cleanup() {
        await db.delete(hqState).where(eq(hqState.userId, USER_ID))
        await cleanupUser(USER_ID)
    }
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    it('reads a Postgres-defaulted clock back as the instant it was written', async () => {
        await cleanup()
        await seedUser(USER_ID, { balance: '0' })

        const before = Date.now()
        await db.insert(hqState).values({ userId: USER_ID })
        const [row] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
        const after = Date.now()

        // Bracketed by the two readings around the insert, with a second of slack for the round
        // trip. An offset time zone misses this by whole hours, so the slack cannot hide one.
        expect(row!.lastSettledAt.getTime()).toBeGreaterThan(before - 1000)
        expect(row!.lastSettledAt.getTime()).toBeLessThan(after + 1000)

        // Stated separately because it is the exact condition that froze the game: a settle
        // clock in the future makes every window non-positive, and the early return that takes
        // never writes the clock back, so nothing ever corrects it.
        expect(row!.lastSettledAt.getTime()).toBeLessThanOrEqual(after)
        expect(row!.createdAt.getTime()).toBeLessThanOrEqual(after)
    })

    it('has the session pinned to UTC, which is what makes that true', async () => {
        const result = await db.execute<{ zone: string }>(sql`select current_setting('TimeZone') as zone`)
        expect(result.rows[0]!.zone).toBe('UTC')
    })
})
