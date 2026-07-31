import { describe, expect, it } from 'vitest'
import {
    settlePathwardenRun,
    type LockedPathwardenState,
    type PathwardenRunReport
} from '#server/utils/pathwarden'
import {
    PATHWARDEN_MIN_SECONDS_PER_WAVE,
    pathwardenMaxScore,
    pathwardenMaxWaveForElapsedMs
} from '#shared/utils/gamelogic/pathwarden'

const STARTED = new Date('2026-01-01T00:00:00.000Z')
const at = (seconds: number) => STARTED.getTime() + seconds * 1000

function state(overrides: Partial<LockedPathwardenState> = {}): LockedPathwardenState {
    return {
        id: 'state-1',
        userId: 'user-1',
        bulwarkLevel: 0,
        artificerLevel: 0,
        lensLevel: 0,
        reservoirLevel: 0,
        bannerLevel: 0,
        bountyLevel: 0,
        arcanistLevel: 0,
        surgeCharges: 0,
        skipIntro: false,
        keyboardPan: false,
        claimedCheckpointWaves: [],
        ambientStoryIds: [],
        ambientRewardClaimed: false,
        freeBoostCredits: 0,
        ownedDefenseIds: ['bolt', 'mortar', 'frost'],
        ownedSkinIds: ['warden-stone'],
        equippedSkinId: 'warden-stone',
        runsPlayed: 3,
        totalCoinsEarned: '0',
        bestWave: 0,
        bestScore: 0,
        bestRealm: 0,
        bestFlawless: 0,
        highestCompletedRealm: 0,
        runStartedAt: STARTED,
        runRealmSnapshot: 1,
        runPowerSnapshot: 10,
        runSurgedSnapshot: false,
        lastRunFinishedAt: null,
        lastAmbientStoryAt: null,
        ...overrides
    } as LockedPathwardenState
}

function report(overrides: Partial<PathwardenRunReport> = {}): PathwardenRunReport {
    return { reason: 'victory', wave: 12, aether: 0, score: 0, flawless: 0, ...overrides }
}

describe('settlePathwardenRun', () => {
    it('caps a scripted 36-second victory to the elapsed time and pays nothing', () => {
        const result = settlePathwardenRun(
            state({ runRealmSnapshot: 5, highestCompletedRealm: 4 }),
            report({ reason: 'victory', wave: 12, aether: 999_999, score: 999_999_999 }),
            at(36)
        )
        expect(result.effectiveWave).toBe(4)
        expect(result.settled).toBe(false)
        expect(result.coins).toBe(0)
        // No realm unlock — a victory must actually reach the final wave in time.
        expect(result.completedRealm).toBe(4)
        expect(result.maxUnlockedRealm).toBe(5)
    })

    it('pays every checkpoint and unlocks the realm for a genuine full-time victory', () => {
        const result = settlePathwardenRun(
            state({ runRealmSnapshot: 3, highestCompletedRealm: 2 }),
            report({ reason: 'victory', wave: 12, aether: 0 }),
            at(200)
        )
        expect(result.effectiveWave).toBe(12)
        expect(result.settled).toBe(true)
        // Checkpoints 4/8/12 at realm 3: (75k+150k+300k) x 2.
        expect(result.coins).toBe(1_050_000)
        expect(result.completedRealm).toBe(3)
        expect(result.maxUnlockedRealm).toBe(4)
        expect(result.claimedCheckpointWaves).toEqual([4, 8, 12])
    })

    it('does not unlock the realm when the save never reached the final wave', () => {
        const result = settlePathwardenRun(
            state({ runRealmSnapshot: 2, highestCompletedRealm: 1 }),
            report({ reason: 'victory', wave: 8 }),
            at(300)
        )
        expect(result.effectiveWave).toBe(8)
        expect(result.settled).toBe(false)
        expect(result.coins).toBe(0)
        expect(result.completedRealm).toBe(1)
    })

    it('cashes out only the checkpoints the wall-clock allows', () => {
        const result = settlePathwardenRun(
            state({ runRealmSnapshot: 1 }),
            report({ reason: 'cashout', wave: 12 }),
            at(70)
        )
        expect(result.effectiveWave).toBe(8)
        expect(result.coins).toBe(225_000) // checkpoints 4 + 8 at realm 1
        expect(result.claimedCheckpointWaves).toEqual([4, 8])
    })

    it('never pays a checkpoint twice', () => {
        const result = settlePathwardenRun(
            state({ runRealmSnapshot: 1, claimedCheckpointWaves: [4] }),
            report({ reason: 'cashout', wave: 12 }),
            at(200)
        )
        expect(result.coins).toBe(450_000) // 8 + 12 only, at realm 1
        expect(result.claimedCheckpointWaves).toEqual([4, 8, 12])
    })

    it('clamps reported aether to the plausible cap', () => {
        const result = settlePathwardenRun(
            state({ runRealmSnapshot: 1 }),
            report({ reason: 'cashout', wave: 12, aether: 10_000_000 }),
            at(200)
        )
        expect(result.aetherCounted).toBe(result.aetherCap)
        expect(result.aetherCounted).toBeLessThan(10_000_000)
        expect(result.aetherBonus).toBe(result.aetherCounted * 600)
    })

    it('caps the leaderboard score by the waves actually reached', () => {
        const result = settlePathwardenRun(
            state({ runRealmSnapshot: 5 }),
            report({ reason: 'victory', wave: 12, score: 999_999_999 }),
            at(48) // only 6 waves of elapsed time
        )
        expect(result.effectiveWave).toBe(6)
        expect(result.score).toBe(pathwardenMaxScore(6, 5))
        expect(result.score).toBeLessThan(pathwardenMaxScore(12, 5))
    })

    it('defeat pays nothing but still records the waves reached', () => {
        const result = settlePathwardenRun(
            state({ runRealmSnapshot: 1, bestWave: 3 }),
            report({ reason: 'defeat', wave: 12, score: 40_000_000 }),
            at(200)
        )
        expect(result.settled).toBe(false)
        expect(result.coins).toBe(0)
        expect(result.completedRealm).toBe(0)
        expect(result.bestWave).toBe(12)
    })
})

describe('pathwarden wall-clock caps', () => {
    it('allows one wave per PATHWARDEN_MIN_SECONDS_PER_WAVE of elapsed time', () => {
        expect(pathwardenMaxWaveForElapsedMs(0)).toBe(0)
        expect(pathwardenMaxWaveForElapsedMs(PATHWARDEN_MIN_SECONDS_PER_WAVE * 1000 - 1)).toBe(0)
        expect(pathwardenMaxWaveForElapsedMs(PATHWARDEN_MIN_SECONDS_PER_WAVE * 1000)).toBe(1)
        expect(pathwardenMaxWaveForElapsedMs(96_000)).toBe(12)
        // A full victory cannot be honoured before the floor for 12 waves.
        expect(pathwardenMaxWaveForElapsedMs(36_000)).toBeLessThan(12)
    })

    it('scales the score ceiling from zero at wave 0 to the full cap at wave 12', () => {
        expect(pathwardenMaxScore(0, 5)).toBe(0)
        expect(pathwardenMaxScore(12, 5)).toBe(250_000_000)
        expect(pathwardenMaxScore(6, 5)).toBeLessThan(pathwardenMaxScore(12, 5))
    })
})
