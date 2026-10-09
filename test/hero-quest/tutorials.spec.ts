import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
    HQ_FEATURES,
    TUTORIAL_IDS,
    checkpointReached,
    featureUnlocked,
    nextTutorial,
    unlockedFeatures,
    type UnlockProgress
} from '#shared/utils/hero-quest/tutorials'
import { TUTORIAL_PAGES } from '#shared/utils/hero-quest/content/tutorials'
import { BOSS_STAGE, WORLD_COUNT } from '#shared/utils/hero-quest/constants'
import { HQ_MENU_SCENES } from '../../app/utils/hero-quest-scenes'
import { guidePageFits } from '../../app/utils/hero-quest-art/guide'
import { db } from '#server/database'
import { hqState } from '#server/database/schema'
import { ensureHqState } from '#server/utils/hero-quest'
import { markTutorialSeen, requireFeature, resetTutorials } from '#server/utils/hero-quest-tutorials'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const at = (world: number, stage: number, prestige = 0, runCleared = false): UnlockProgress => ({ prestige, world, stage, runCleared })
const FRESH = at(1, 1)

describe('hero-quest feature unlocks', () => {
    it('gates only menu scenes, and every one but Settings', () => {
        for (const f of HQ_FEATURES) expect(HQ_MENU_SCENES).toContain(f)
        expect(HQ_MENU_SCENES.filter(s => !HQ_FEATURES.includes(s as never))).toEqual(['settings'])
    })

    it('opens nothing on a fresh run, and everything for a veteran', () => {
        expect(unlockedFeatures(FRESH)).toEqual([])
        expect(unlockedFeatures(at(3, 4, 2))).toEqual(HQ_FEATURES)
    })

    it('opens the Gacha and Collections once the World 1 boss is beaten, not at its gate', () => {
        expect(featureUnlocked('gacha', at(1, BOSS_STAGE))).toBe(false)
        expect(featureUnlocked('gacha', at(1, BOSS_STAGE + 1))).toBe(true)
        expect(featureUnlocked('collections', at(1, BOSS_STAGE + 1))).toBe(true)
    })

    it('follows the schedule through the Worlds, the run\'s clear and the first prestige', () => {
        expect(unlockedFeatures(at(2, 1))).toEqual(['gacha', 'collections', 'milestones', 'calendar'])
        expect(unlockedFeatures(at(3, 1))).toEqual(['gacha', 'collections', 'milestones', 'calendar', 'loadouts', 'speed'])
        expect(featureUnlocked('raids', at(4, 10))).toBe(false)
        expect(featureUnlocked('raids', at(5, 1))).toBe(true)
        expect(featureUnlocked('prestige', at(WORLD_COUNT, 10))).toBe(false)
        expect(featureUnlocked('prestige', at(WORLD_COUNT, 10, 0, true))).toBe(true)
        expect(featureUnlocked('classes', at(WORLD_COUNT, 10, 0, true))).toBe(false)
        expect(featureUnlocked('classes', at(1, 1, 1))).toBe(true)
    })

    it('never closes again after a prestige resets the run', () => {
        // a prestige lands back on World 1 Stage 1; every checkpoint below it stays reached
        for (const f of HQ_FEATURES) expect(featureUnlocked(f, at(1, 1, 1)), f).toBe(true)
        expect(checkpointReached({ kind: 'worlds', count: WORLD_COUNT }, at(1, 1, 1))).toBe(true)
    })
})

describe('hero-quest tutorials', () => {
    it('has lines for every tutorial, each page fitting the guide\'s panel whole', () => {
        for (const id of TUTORIAL_IDS) {
            const pages = TUTORIAL_PAGES[id]
            expect(pages.length, id).toBeGreaterThan(0)
            for (const page of pages) expect(guidePageFits(page), `${id}: ${page}`).toBe(true)
        }
    })

    it('opens with the intro, then explains the open scene, then announces the oldest unlock', () => {
        expect(nextTutorial([], [], 'battle')).toBe('intro')
        const open = unlockedFeatures(at(2, 1))
        expect(nextTutorial(open, ['intro'], 'battle')).toBe('gacha:unlock')
        expect(nextTutorial(open, ['intro'], 'calendar')).toBe('calendar:visit')
        expect(nextTutorial(open, ['intro', 'gacha:unlock'], 'battle')).toBe('collections:unlock')
    })

    it('doesn\'t announce a scene already explained, nor explain one not open', () => {
        const open = unlockedFeatures(at(2, 1))
        expect(nextTutorial(open, ['intro', 'gacha:visit'], 'battle')).toBe('collections:unlock')
        expect(nextTutorial(open, ['intro'], 'raids')).toBe('gacha:unlock')
        const all = ['intro', ...open.flatMap(f => [`${f}:unlock`, `${f}:visit`])]
        expect(nextTutorial(open, all, 'battle')).toBeNull()
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
        await expect(requireFeature(USER_ID, 'gacha')).rejects.toMatchObject({ statusCode: 403, statusMessage: 'That opens once you beat the World 1 boss' })
        await db.update(hqState).set({ stage: BOSS_STAGE + 1 }).where(eq(hqState.userId, USER_ID))
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
