import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { townStreak, user } from '#server/database/schema'
import { deleteTownForUser, foundTown } from '#server/utils/town'
import { claimTownStreakStep, getTownStreak, resetTownStreak } from '#server/utils/town-streak'
import { TOWN_STREAK_CHESTS, getTownStreakStep, townStreakBit, townStreakDayKey, townStreakYesterday } from '#shared/utils/gamelogic/town-streak'
import { SKIP, burst, cleanupUser, lockTownRealm, seedUser } from '../setup/db-helpers'

const OWNER = 'test-town-streak-owner'

function gemsOn(step: number) {
    const def = getTownStreakStep(step)
    return def?.kind === 'gems' ? def.gems : 0
}
const DAY4_GEMS = gemsOn(4)

async function cleanup() {
    await db.delete(townStreak).where(eq(townStreak.userId, OWNER))
    await deleteTownForUser(OWNER)
    await cleanupUser(OWNER)
}

async function streakRow() {
    const [row] = await db.select().from(townStreak).where(eq(townStreak.userId, OWNER))
    return row!
}

async function wallet() {
    const [row] = await db.select({ balance: user.balance, gems: user.gems }).from(user).where(eq(user.id, OWNER))
    return { balance: parseFloat(row!.balance), gems: row!.gems }
}

describe.skipIf(SKIP)('Polytown mayor streak (database)', () => {
    let releaseRealm: () => Promise<void>
    beforeAll(async () => { releaseRealm = await lockTownRealm() }, 120_000)

    beforeEach(async () => {
        await cleanup()
        await seedUser(OWNER, { balance: '100000000', gems: 0 })
        await foundTown(OWNER)
    })
    afterEach(cleanup)
    afterAll(async () => { await releaseRealm() })

    it('unlocks day 1 once, however many requests race for it', async () => {
        const results = await Promise.all(Array.from({ length: 8 }, () => getTownStreak(OWNER)))
        expect(results.filter(r => r.initialized && r.advancedToday)).toHaveLength(1)
        expect((await streakRow()).step).toBe(1)
    })

    it('advances once on the next day and breaks after a missed one', async () => {
        const today = townStreakDayKey(Date.now())
        await getTownStreak(OWNER)
        await db.update(townStreak).set({ step: 4, lastDay: townStreakYesterday(today) }).where(eq(townStreak.userId, OWNER))
        const results = await Promise.all(Array.from({ length: 8 }, () => getTownStreak(OWNER)))
        expect(results.filter(r => r.initialized && r.advancedToday)).toHaveLength(1)
        const advanced = await streakRow()
        expect(advanced.step).toBe(5)
        // Day 1 from the first visit, day 5 from the advance: the burst locked exactly the step it unlocked.
        expect(Object.keys(advanced.locked).sort()).toEqual(['1', '5'])
        expect(advanced.locked['5']?.reward).toBeDefined()

        await db.update(townStreak).set({ lastDay: townStreakYesterday(townStreakYesterday(today)) }).where(eq(townStreak.userId, OWNER))
        const broken = await getTownStreak(OWNER)
        expect(broken.initialized && broken.status).toBe('broken')
        expect((await streakRow()).step).toBe(5)
    })

    it('pays a claimed step once under a burst', async () => {
        await getTownStreak(OWNER)
        await db.update(townStreak).set({ step: 4 }).where(eq(townStreak.userId, OWNER))
        const before = await wallet()
        const { ok } = await burst(10, () => claimTownStreakStep(OWNER, 4))
        expect(ok).toBe(1)
        const after = await wallet()
        expect(after.gems - before.gems).toBe(DAY4_GEMS)
        expect((await streakRow()).claimed).toBe(townStreakBit(4))
    })

    it('locks a step at unlock, so growing the town before a late claim pays nothing extra', async () => {
        await getTownStreak(OWNER)
        const locked = (await streakRow()).locked['1']
        expect(locked?.reward?.coins).toBeGreaterThan(0)
        // Pretend the town got much richer since: the lock, not the town, decides the payout.
        await db.update(townStreak).set({ locked: { 1: { ...locked!, reward: { ...locked!.reward!, coins: 12_345 } } } }).where(eq(townStreak.userId, OWNER))
        const before = await wallet()
        await claimTownStreakStep(OWNER, 1)
        expect((await wallet()).balance - before.balance).toBeCloseTo(12_345, 0)
    })

    it('refuses a locked step', async () => {
        await getTownStreak(OWNER)
        await expect(claimTownStreakStep(OWNER, 2)).rejects.toMatchObject({ statusCode: 400 })
        await expect(claimTownStreakStep(OWNER, 0)).rejects.toMatchObject({ statusCode: 400 })
    })

    it('resets a broken track once, paying every unclaimed step', async () => {
        await getTownStreak(OWNER)
        const today = townStreakDayKey(Date.now())
        await db.update(townStreak)
            .set({ step: 10, lastDay: townStreakYesterday(townStreakYesterday(today)), claimed: townStreakBit(1) })
            .where(eq(townStreak.userId, OWNER))
        await expect(resetTownStreak(OWNER).then(() => null)).resolves.toBeNull()
        const row = await streakRow()
        expect(row).toMatchObject({ step: 1, lastDay: today, claimed: 0, cycle: 1 })
        expect(Object.keys(row.locked)).toEqual(['1'])

        await db.update(townStreak)
            .set({ step: 10, lastDay: townStreakYesterday(townStreakYesterday(today)), claimed: 0 })
            .where(eq(townStreak.userId, OWNER))
        const before = await wallet()
        const { ok } = await burst(6, () => resetTownStreak(OWNER))
        expect(ok).toBe(1)
        const after = await wallet()
        // Days 4 and 10 are the gem days among the first ten, plus whatever the day 7 chest holds.
        const fixed = DAY4_GEMS + gemsOn(10)
        expect(after.gems - before.gems).toBeGreaterThanOrEqual(fixed + TOWN_STREAK_CHESTS.wooden.gems[0])
        expect(after.gems - before.gems).toBeLessThanOrEqual(fixed + TOWN_STREAK_CHESTS.wooden.gems[1])
        expect((await streakRow()).cycle).toBe(2)
    })

    it('never pays a step to both a claim and a reset racing it', async () => {
        await getTownStreak(OWNER)
        const today = townStreakDayKey(Date.now())
        // Days 1 to 6 hold gems only on day 4, and no chest.
        await db.update(townStreak)
            .set({ step: 6, lastDay: townStreakYesterday(townStreakYesterday(today)), claimed: 0 })
            .where(eq(townStreak.userId, OWNER))
        const before = await wallet()
        await Promise.allSettled([
            ...Array.from({ length: 5 }, () => claimTownStreakStep(OWNER, 4)),
            ...Array.from({ length: 3 }, () => resetTownStreak(OWNER))
        ])
        expect((await wallet()).gems - before.gems).toBe(DAY4_GEMS)
        expect((await streakRow()).cycle).toBe(1)
    })

    it('does not unlock day 1 on the day that unlocked day 30', async () => {
        await getTownStreak(OWNER)
        const today = townStreakDayKey(Date.now())
        await db.update(townStreak).set({ step: 30, lastDay: today, claimed: 0 }).where(eq(townStreak.userId, OWNER))
        await resetTownStreak(OWNER)
        expect(await streakRow()).toMatchObject({ step: 0, lastDay: today, claimed: 0, cycle: 1 })
        expect((await streakRow()).locked).toEqual({})
        await expect(claimTownStreakStep(OWNER, 1)).rejects.toMatchObject({ statusCode: 400 })

        // The next day's visit unlocks day 1 and locks it.
        await db.update(townStreak).set({ lastDay: townStreakYesterday(today) }).where(eq(townStreak.userId, OWNER))
        await getTownStreak(OWNER)
        const restarted = await streakRow()
        expect(restarted.step).toBe(1)
        expect(Object.keys(restarted.locked)).toEqual(['1'])

        // Finished on an earlier day: today's visit counts as day 1.
        await db.update(townStreak).set({ step: 30, lastDay: townStreakYesterday(today) }).where(eq(townStreak.userId, OWNER))
        await resetTownStreak(OWNER)
        expect(await streakRow()).toMatchObject({ step: 1, lastDay: today, cycle: 2 })
        expect(Object.keys((await streakRow()).locked)).toEqual(['1'])
    })

    it('refuses to reset an active track', async () => {
        await getTownStreak(OWNER)
        await expect(resetTownStreak(OWNER)).rejects.toMatchObject({ statusCode: 400 })
    })
})
