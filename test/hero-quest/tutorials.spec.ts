import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
    featureMenuScene,
    HQ_FEATURES,
    TUTORIAL_IDS,
    checkpointReached,
    featureUnlocked,
    bossLossMark,
    nextTutorial,
    revealedFeatures,
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

const at = (world: number, stage: number, prestige = 0, runCleared = false, bossLost = false): UnlockProgress => ({ prestige, world, stage, runCleared, bossLost })
const FRESH = at(1, 1)

describe('hero-quest feature unlocks', () => {
    it('gates every menu scene but Settings, and Battle Speed behind the Shop\'s button', () => {
        for (const f of HQ_FEATURES) expect(HQ_MENU_SCENES, f).toContain(featureMenuScene(f))
        expect(HQ_MENU_SCENES.filter(s => !HQ_FEATURES.includes(s as never))).toEqual(['settings'])
        expect(featureMenuScene('speed')).toBe('shop')
        expect(featureMenuScene('milestones')).toBe('calendar')
        expect(HQ_MENU_SCENES).not.toContain('speed')
        expect(HQ_MENU_SCENES).not.toContain('milestones')
    })

    it('opens nothing on a fresh run, and everything for a veteran', () => {
        expect(unlockedFeatures(FRESH)).toEqual([])
        expect(unlockedFeatures(at(3, 4, 2))).toEqual(HQ_FEATURES)
    })

    it('opens the Gacha and Collections once the World 1 boss is fought, beaten or lost to', () => {
        expect(featureUnlocked('gacha', at(1, BOSS_STAGE))).toBe(false)
        expect(featureUnlocked('gacha', at(1, BOSS_STAGE, 0, false, true))).toBe(true)
        expect(featureUnlocked('collections', at(1, BOSS_STAGE, 0, false, true))).toBe(true)
        expect(featureUnlocked('gacha', at(1, BOSS_STAGE + 1))).toBe(true)
        expect(featureUnlocked('collections', at(1, BOSS_STAGE + 1))).toBe(true)
    })

    it('follows the schedule through the Worlds, the run\'s clear and the first prestige', () => {
        expect(unlockedFeatures(at(2, 1))).toEqual(['gacha', 'collections', 'shop', 'calendar', 'milestones'])
        expect(unlockedFeatures(at(3, 1))).toEqual(['gacha', 'collections', 'shop', 'calendar', 'milestones', 'loadouts', 'speed'])
        expect(featureUnlocked('raids', at(4, 10))).toBe(false)
        expect(featureUnlocked('raids', at(5, 1))).toBe(true)
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

    it('opens with the intro, then walks the open features one at a time, in the order they opened', () => {
        expect(nextTutorial([], [], 'battle')).toBe('intro')
        const open = unlockedFeatures(at(2, 1))
        expect(nextTutorial(open, ['intro'], 'battle')).toBe('gacha:unlock')
        expect(nextTutorial(open, ['intro', 'gacha:unlock'], 'gacha')).toBe('gacha:visit')
        // the next waits until the player leaves the Gacha, then comes up on the battle
        expect(nextTutorial(open, ['intro', 'gacha:unlock', 'gacha:visit'], 'gacha')).toBeNull()
        expect(nextTutorial(open, ['intro', 'gacha:unlock', 'gacha:visit'], 'battle')).toBe('collections:unlock')
        expect(nextTutorial(open, ['intro', 'gacha:unlock', 'gacha:visit', 'collections:unlock'], 'collections')).toBe('collections:visit')
    })

    it('opens the Shop on the World 1 boss\'s win, not on a loss to it', () => {
        expect(unlockedFeatures(at(1, BOSS_STAGE, 0, false, true))).toEqual(['gacha', 'collections'])
        expect(unlockedFeatures(at(1, BOSS_STAGE + 1))).toEqual(['gacha', 'collections', 'shop'])
    })

    it('shows a feature that opened with another only once its own tutorial is up', () => {
        const open = unlockedFeatures(at(1, BOSS_STAGE, 0, false, true))
        expect(open).toEqual(['gacha', 'collections'])
        // during the intro neither shows; the Gacha comes out with its announcement
        expect(revealedFeatures(open, [], 'battle')).toEqual([])
        expect(revealedFeatures(open, ['intro'], 'battle')).toEqual(['gacha'])
        expect(revealedFeatures(open, ['intro', 'gacha:unlock'], 'gacha')).toEqual(['gacha'])
        // explained, the Gacha stays; Collections waits in it, and comes out on the battle
        const gachaDone = ['intro', 'gacha:unlock', 'gacha:visit']
        expect(revealedFeatures(open, gachaDone, 'gacha')).toEqual(['gacha'])
        expect(revealedFeatures(open, gachaDone, 'battle')).toEqual(['gacha', 'collections'])
        expect(revealedFeatures(open, [...gachaDone, 'collections:visit'], 'gacha')).toEqual(['gacha', 'collections'])
    })

    it('brings the Shop out last when the one fight opens it with the Gacha and Collections', () => {
        const open = unlockedFeatures(at(1, BOSS_STAGE + 1))
        const both = ['intro', 'gacha:unlock', 'gacha:visit', 'collections:unlock', 'collections:visit']
        expect(revealedFeatures(open, ['intro'], 'battle')).toEqual(['gacha'])
        expect(revealedFeatures(open, both.slice(0, 3), 'battle')).toEqual(['gacha', 'collections'])
        expect(nextTutorial(open, both, 'battle')).toBe('shop:unlock')
        expect(revealedFeatures(open, both, 'battle')).toEqual(['gacha', 'collections', 'shop'])
    })

    it('reminds once, on the battle after the second boss lost, once the Gacha and Collections are explained', () => {
        const open = unlockedFeatures(at(1, BOSS_STAGE, 0, false, true))
        const taught = ['intro', 'gacha:unlock', 'gacha:visit', 'collections:unlock', 'collections:visit']
        expect(bossLossMark(taught)).toBe('boss_lost_1')
        expect(bossLossMark([...taught, 'boss_lost_1'])).toBe('boss_lost_2')
        expect(bossLossMark([...taught, 'boss_lost_1', 'boss_lost_2'])).toBeNull()
        // one loss: nothing; two: the reminder, on the battle only; read: never again
        expect(nextTutorial(open, [...taught, 'boss_lost_1'], 'battle')).toBeNull()
        expect(nextTutorial(open, [...taught, 'boss_lost_1', 'boss_lost_2'], 'battle')).toBe('loss_reminder')
        expect(nextTutorial(open, [...taught, 'boss_lost_1', 'boss_lost_2'], 'gacha')).toBeNull()
        expect(nextTutorial(open, [...taught, 'boss_lost_1', 'boss_lost_2', 'loss_reminder'], 'battle')).toBeNull()
        // the scenes it names not explained yet: their own tutorials come first, and it waits
        expect(nextTutorial(open, ['intro', 'boss_lost_1', 'boss_lost_2'], 'battle')).toBe('gacha:unlock')
    })

    it('hides only the group being introduced, so a reset never hides the rest', () => {
        const open = unlockedFeatures(at(3, 1))
        expect(revealedFeatures(open, ['intro'], 'battle')).toEqual(['gacha', 'calendar', 'milestones', 'loadouts', 'speed'])
    })

    it('keeps pointing at a feature until its scene is explained, so the next can\'t jump the queue', () => {
        const open = unlockedFeatures(at(2, 1))
        // announced, but the player never got there (a reload, a second tab): it is pointed at again
        expect(nextTutorial(open, ['intro', 'gacha:unlock'], 'battle')).toBe('gacha:unlock')
        // standing in a later scene doesn't explain it ahead of the Gacha, nor announce over it
        expect(nextTutorial(open, ['intro'], 'collections')).toBeNull()
        expect(nextTutorial(open, ['intro'], 'settings')).toBeNull()
        const all = ['intro', ...open.map(f => `${f}:visit`)]
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
        await expect(requireFeature(USER_ID, 'gacha')).rejects.toMatchObject({ statusCode: 403, statusMessage: 'That opens once you fight the World 1 boss' })
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
