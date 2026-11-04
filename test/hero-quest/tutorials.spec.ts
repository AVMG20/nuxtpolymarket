import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
    HQ_FEATURES,
    FALLEN_MARK,
    checkpointReached,
    isTutorialRecord,
    featureUnlocked,
    unlockedFeatures,
    type UnlockProgress
} from '#shared/utils/hero-quest/tutorials'
import { BOSS_STAGE, WORLD_COUNT } from '#shared/utils/hero-quest/constants'
import { db } from '#server/database'
import { hqState } from '#server/database/schema'
import { ensureHqState } from '#server/utils/hero-quest'
import { fallenWrite, markTutorialSeen, requireFeature, resetTutorials } from '#server/utils/hero-quest-tutorials'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const at = (world: number, stage: number, prestige = 0, runCleared = false, bossLost = false, partyFallen = false): UnlockProgress => ({ prestige, world, stage, runCleared, bossLost, partyFallen })
const FRESH = at(1, 1)
const START = ['calendar', 'shop', 'speed']

describe('hero-quest feature unlocks', () => {
    it('opens the Calendar, the Shop and Battle Speed on a fresh run, and everything for a veteran', () => {
        expect(unlockedFeatures(FRESH)).toEqual(START)
        expect(unlockedFeatures(at(3, 4, 2))).toEqual(HQ_FEATURES)
    })

    it('opens the Gacha and Collections on the party\'s first fall, wherever it lands', () => {
        expect(featureUnlocked('gacha', at(1, 2))).toBe(false)
        expect(unlockedFeatures(at(1, 2, 0, false, false, true))).toEqual([...START, 'gacha', 'collections'])
        // the server writes the fall; the client can't post it to open the Gacha early
        expect(isTutorialRecord(FALLEN_MARK)).toBe(false)
    })

    it('never closes again after a prestige resets the run', () => {
        // a prestige lands back on World 1 Stage 1; every checkpoint below it stays reached
        for (const f of HQ_FEATURES) expect(featureUnlocked(f, at(1, 1, 1)), f).toBe(true)
        expect(checkpointReached({ kind: 'worlds', count: WORLD_COUNT }, at(1, 1, 1))).toBe(true)
    })
})

const USER_ID = 'test-hero-quest-tutorials-user'

describe.skipIf(SKIP)('hero-quest feature gates on the server', () => {
    const cleanup = async () => {
        await db.delete(hqState).where(eq(hqState.userId, USER_ID))
        await cleanupUser(USER_ID)
    }
    beforeEach(async () => {
        await cleanup()
        await seedUser(USER_ID, { balance: '0' })
        await ensureHqState(USER_ID)
    })
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    it('refuses a feature before its checkpoint, saying what opens it, and lets it through after', async () => {
        await expect(requireFeature(USER_ID, 'shop')).resolves.toBeUndefined()
        await expect(requireFeature(USER_ID, 'gacha')).rejects.toMatchObject({ statusCode: 403, statusMessage: 'That opens once you lose a fight' })
        // the party's first fall opens it anywhere in the run
        await db.update(hqState).set(fallenWrite()).where(eq(hqState.userId, USER_ID))
        await expect(requireFeature(USER_ID, 'gacha')).resolves.toBeUndefined()
        // a reset shows the tutorials again but keeps the fall, so nothing closes
        await resetTutorials(USER_ID)
        expect((await db.select().from(hqState).where(eq(hqState.userId, USER_ID)))[0]!.tutorialsSeen).toEqual([FALLEN_MARK])
        await expect(requireFeature(USER_ID, 'gacha')).resolves.toBeUndefined()
        await db.update(hqState).set({ tutorialsSeen: [] }).where(eq(hqState.userId, USER_ID))
        // at the gate and not yet fought: still closed; lost to: open
        await db.update(hqState).set({ stage: BOSS_STAGE, atBossGate: true }).where(eq(hqState.userId, USER_ID))
        await expect(requireFeature(USER_ID, 'gacha')).rejects.toMatchObject({ statusCode: 403 })
        await db.update(hqState).set({ bossLost: true }).where(eq(hqState.userId, USER_ID))
        await expect(requireFeature(USER_ID, 'gacha')).resolves.toBeUndefined()
        await db.update(hqState).set({ stage: BOSS_STAGE + 1, atBossGate: false, bossLost: false }).where(eq(hqState.userId, USER_ID))
        await expect(requireFeature(USER_ID, 'gacha')).resolves.toBeUndefined()
        await expect(requireFeature(USER_ID, 'raids')).rejects.toMatchObject({ statusCode: 403 })
    })

    it('records a tutorial once, and a reset clears them without closing anything', async () => {
        await db.update(hqState).set({ prestige: 1 }).where(eq(hqState.userId, USER_ID))
        await Promise.all([markTutorialSeen(USER_ID, 'intro'), markTutorialSeen(USER_ID, 'intro'), markTutorialSeen(USER_ID, 'gacha:unlock')])
        const seen = (await db.select().from(hqState).where(eq(hqState.userId, USER_ID)))[0]!.tutorialsSeen
        expect([...seen].sort()).toEqual(['gacha:unlock', 'intro'])

        await resetTutorials(USER_ID)
        expect((await db.select().from(hqState).where(eq(hqState.userId, USER_ID)))[0]!.tutorialsSeen).toEqual([])
        await expect(requireFeature(USER_ID, 'classes')).resolves.toBeUndefined()
    })
})
