import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hackerzRuns, hackerzState, user } from '#server/database/schema'
import {
    HACKERZ_MAX_WAVE,
    HACKERZ_WAVE_MS,
    hackerzDifficulty,
    hackerzMaxPayout,
    type HackerzRunSave
} from '#shared/utils/gamelogic/hackerz'
import { hackerzFreshBuild, hackerzSimulateRun } from '#shared/utils/gamelogic/hackerz-sim'
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

beforeAll(async () => {
    Object.assign(globalThis, {
        defineEventHandler: (handler: unknown) => handler,
        readBody: async (event: Event) => event.body
    })
    startRun = (await import('#server/api/hackerz/start-run.post')).default as unknown as Handler
    putRun = (await import('#server/api/hackerz/run.put')).default as unknown as Handler
    finishRun = (await import('#server/api/hackerz/finish-run.post')).default as unknown as Handler
})

const ids: string[] = []
afterEach(async () => {
    for (const id of ids.splice(0)) await cleanupUser(id)
})

/** A bare account: no Mainframe at all, nothing played. */
async function bareAccount() {
    const id = `hackerz-forge-${crypto.randomUUID()}`
    ids.push(id)
    await seedUser(id)
    await db.insert(hackerzState).values({ userId: id })
    return id
}

/** Pretends the run started long enough ago for the clock check to allow `waves`. */
async function ageRun(userId: string, waves: number) {
    await db.update(hackerzState)
        .set({ runStartedAt: new Date(Date.now() - (waves + 1) * HACKERZ_WAVE_MS) })
        .where(eq(hackerzState.userId, userId))
}

describe.skipIf(SKIP)('a forged Hackerz save, through the endpoints', () => {
    it('pays a bare account no more than a bare account could earn, and unlocks nothing it could not reach', async () => {
        const userId = await bareAccount()
        const started = await startRun({ userId, body: { difficultyId: 'breach' } })
        await ageRun(userId, HACKERZ_MAX_WAVE)

        // The review's repro: a wave-30 save banking 1e15 coins.
        const forged: HackerzRunSave = { ...(started.save as HackerzRunSave), wave: HACKERZ_MAX_WAVE, coins: 1e15, kills: 9_999 }
        await putRun({ userId, body: { revision: 0, save: forged } })
        const result = await finishRun({ userId, body: { reason: 'victory' } })

        const ceiling = hackerzMaxPayout(HACKERZ_MAX_WAVE, hackerzDifficulty('breach'), 1)
        expect(result.awarded as number).toBeLessThan(ceiling / 5)
        expect(result.awarded as number).toBeLessThan(100_000)
        expect(result.victory).toBe(false)

        const [row] = await db.select().from(hackerzState).where(eq(hackerzState.userId, userId))
        expect(row!.bestWave).toBeLessThan(hackerzDifficulty('zeroday').requiredBestWave)
        expect(row!.victories).toBe(0)
        expect(row!.runStartedAt).toBeNull()

        const [account] = await db.select({ balance: user.balance }).from(user).where(eq(user.id, userId))
        expect(Number(account!.balance)).toBe(result.awarded)
        expect(await db.query.hackerzRuns.findFirst({ where: eq(hackerzRuns.userId, userId) })).toBeUndefined()
    })

    it('pays an honest run what it banked', async () => {
        const userId = await bareAccount()
        const started = await startRun({ userId, body: { difficultyId: 'breach' } })
        await ageRun(userId, 3)
        // What the balance model banks over three waves at its usual aim.
        const model = hackerzSimulateRun(hackerzFreshBuild(), 'breach', { autoUpgrade: true })
        const banked = model.waves.slice(0, 3).reduce((sum, wave) => sum + wave.coins, 0)
        const save: HackerzRunSave = { ...(started.save as HackerzRunSave), wave: 3, coins: banked, kills: 60 }
        await putRun({ userId, body: { revision: 0, save } })
        const result = await finishRun({ userId, body: { reason: 'retire' } })
        expect(result.awarded).toBe(banked)
        expect(result.wave).toBe(3)
    })

    it('refuses a save claiming more waves than the run has had time for', async () => {
        const userId = await bareAccount()
        const started = await startRun({ userId, body: { difficultyId: 'breach' } })
        const forged: HackerzRunSave = { ...(started.save as HackerzRunSave), wave: 20, coins: 1e9 }
        await expect(putRun({ userId, body: { revision: 0, save: forged } })).rejects.toMatchObject({ statusCode: 400 })
    })
})
