import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hackerzState, transactions, user } from '#server/database/schema'
import {
    HACKERZ_MAINFRAME_IDS,
    HACKERZ_WAVE_MS,
    hackerzMainframe,
    hackerzMainframeCost,
    type HackerzRunSave
} from '#shared/utils/gamelogic/hackerz'
import { HACKERZ_LEVEL_COLUMN } from '#server/utils/hackerz'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

// The handlers are driven as Nitro would drive them: the request's user comes
// from the session, the body from the request. Both are stood in for here.
vi.mock('#server/utils/auth', () => ({
    requireUserId: async (event: { userId: string }) => event.userId
}))

type Event = { userId: string, body?: unknown }
type Handler = (event: Event) => Promise<Record<string, unknown>>
let startRun: Handler
let putRun: Handler
let finishRun: Handler
let upgrade: Handler
let rushCooldown: Handler

beforeAll(async () => {
    Object.assign(globalThis, {
        defineEventHandler: (handler: unknown) => handler,
        readBody: async (event: Event) => event.body
    })
    startRun = (await import('#server/api/hackerz/start-run.post')).default as unknown as Handler
    putRun = (await import('#server/api/hackerz/run.put')).default as unknown as Handler
    finishRun = (await import('#server/api/hackerz/finish-run.post')).default as unknown as Handler
    upgrade = (await import('#server/api/hackerz/upgrade.post')).default as unknown as Handler
    rushCooldown = (await import('#server/api/hackerz/rush-cooldown.post')).default as unknown as Handler
})

const ids: string[] = []
afterEach(async () => {
    for (const id of ids.splice(0)) await cleanupUser(id)
})

const BURST = 10

async function account(seed: { balance?: string, gems?: number } = {}) {
    const id = `hackerz-burst-${crypto.randomUUID()}`
    ids.push(id)
    await seedUser(id, seed)
    await db.insert(hackerzState).values({ userId: id })
    return id
}

/** Fires the same request `BURST` times at once, as a double-clicking player or a script would. */
async function burst(fn: () => Promise<Record<string, unknown>>) {
    const results = await Promise.allSettled(Array.from({ length: BURST }, fn))
    return {
        ok: results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []),
        rejected: results.filter(r => r.status === 'rejected').length
    }
}

async function wallet(userId: string) {
    const [row] = await db.select({ balance: user.balance, gems: user.gems }).from(user).where(eq(user.id, userId))
    return { balance: Number(row!.balance), gems: row!.gems }
}

async function state(userId: string) {
    const [row] = await db.select().from(hackerzState).where(eq(hackerzState.userId, userId))
    return row!
}

/** A run three waves in, its save banking `coins`. */
async function runInProgress(userId: string, coins: number) {
    const started = await startRun({ userId, body: { difficultyId: 'breach' } })
    await db.update(hackerzState)
        .set({ runStartedAt: new Date(Date.now() - 4 * HACKERZ_WAVE_MS) })
        .where(eq(hackerzState.userId, userId))
    const save: HackerzRunSave = { ...(started.save as HackerzRunSave), wave: 3, coins, kills: 30 }
    await putRun({ userId, body: { revision: 0, save } })
}

describe.skipIf(SKIP)('hackerz endpoints under a burst of identical requests', () => {
    it('settles a run once, however many finishes arrive together', async () => {
        const userId = await account()
        await runInProgress(userId, 500)

        const { ok, rejected } = await burst(() => finishRun({ userId, body: { reason: 'retire' } }))

        expect(ok).toHaveLength(1)
        expect(rejected).toBe(BURST - 1)
        // What a bare account may bank by wave 3 is bounded below 500; the point
        // is that it lands in the wallet once.
        const awarded = ok[0]!.awarded as number
        expect(awarded).toBeGreaterThan(0)
        expect((await wallet(userId)).balance).toBe(awarded)
        const credits = await db.select().from(transactions).where(eq(transactions.userId, userId))
        expect(credits).toHaveLength(1)
        expect((await state(userId)).runsPlayed).toBe(1)
    })

    it('charges each Mainframe level once, and only for the levels bought', async () => {
        const id = HACKERZ_MAINFRAME_IDS[0]!
        const userId = await account({ balance: '1000000000' })

        const { ok } = await burst(() => upgrade({ userId, body: { upgradeId: id } }))

        // However many got through, the levels and the bill must agree: each
        // buy paid its own level's price, none paid a level someone else bought.
        const level = (await state(userId))[HACKERZ_LEVEL_COLUMN[id]]
        expect(level).toBe(ok.length)
        expect(ok.map(r => r.level).sort((a, b) => Number(a) - Number(b))).toEqual(Array.from({ length: ok.length }, (_, i) => i + 1))
        let billed = 0
        for (let l = 0; l < ok.length; l++) billed += hackerzMainframeCost(hackerzMainframe(id), l)!
        expect((await wallet(userId)).balance).toBeCloseTo(1_000_000_000 - billed, 2)
    })

    it('sells a Mainframe level once when the wallet only covers one', async () => {
        const id = HACKERZ_MAINFRAME_IDS[0]!
        const first = hackerzMainframeCost(hackerzMainframe(id), 0)!
        const userId = await account({ balance: first.toFixed(4) })

        const { ok, rejected } = await burst(() => upgrade({ userId, body: { upgradeId: id } }))

        expect(ok).toHaveLength(1)
        expect(rejected).toBe(BURST - 1)
        expect((await state(userId))[HACKERZ_LEVEL_COLUMN[id]]).toBe(1)
        expect((await wallet(userId)).balance).toBeCloseTo(0, 4)
    })

    it('spends gems on a cooldown rush once', async () => {
        const userId = await account({ gems: 1_000_000 })
        await db.update(hackerzState).set({ lastRunFinishedAt: new Date() }).where(eq(hackerzState.userId, userId))

        const { ok, rejected } = await burst(() => rushCooldown({ userId }))

        expect(ok).toHaveLength(1)
        expect(rejected).toBe(BURST - 1)
        expect((await wallet(userId)).gems).toBe(1_000_000 - (ok[0]!.cost as number))
        expect((await state(userId)).lastRunFinishedAt).toBeNull()
    })
})

describe.skipIf(SKIP)('a save that loses a race', () => {
    it('says the run has ended when it was settled first', async () => {
        const userId = await account()
        const started = await startRun({ userId, body: { difficultyId: 'breach' } })
        await finishRun({ userId, body: { reason: 'retire' } })
        // The save read the run as still active just before the finish landed:
        // its checks pass, and only its write finds the save row gone.
        await db.update(hackerzState)
            .set({ runStartedAt: new Date(), runDifficultySnapshot: 'breach' })
            .where(eq(hackerzState.userId, userId))

        await expect(putRun({ userId, body: { revision: 0, save: started.save } }))
            .rejects.toMatchObject({ statusCode: 410, statusMessage: 'This Hackerz run has already ended' })
    })

    it('says another session saved first when its revision is stale', async () => {
        const userId = await account()
        const started = await startRun({ userId, body: { difficultyId: 'breach' } })
        await putRun({ userId, body: { revision: 0, save: started.save } })

        await expect(putRun({ userId, body: { revision: 0, save: started.save } }))
            .rejects.toMatchObject({ statusCode: 409, statusMessage: 'The Hackerz save changed in another session' })
    })
})
