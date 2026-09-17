import { describe, expect, it } from 'vitest'
import {
    settleCallOfXenoRun,
    type CallOfXenoSettlementState
} from '#server/utils/call-of-xeno'
import { callOfXenoDifficulty, callOfXenoMaxGrossForElapsedMs } from '#shared/utils/gamelogic/call-of-xeno-meta'
import {
    CALL_OF_XENO_SAVE_VERSION,
    CALL_OF_XENO_SAVE_EARLY_POINTS_FLOOR,
    callOfXenoSavePointsCeiling,
    callOfXenoValidateSave,
    type CallOfXenoRunSave
} from '#shared/utils/gamelogic/call-of-xeno-save'

function state(overrides: Partial<CallOfXenoSettlementState> = {}): CallOfXenoSettlementState {
    return {
        runDifficultySnapshot: 'recruit',
        runPayoutMultSnapshot: '1.0000',
        runsPlayed: 3,
        totalEarned: '1200.0000',
        bestEarned: 500,
        bestRoundRecruit: 11,
        bestRoundVeteran: 0,
        bestRoundSurvivor: 0,
        bestRoundNightmare: 0,
        ...overrides
    }
}

function save(overrides: Partial<CallOfXenoRunSave> = {}): CallOfXenoRunSave {
    return {
        version: CALL_OF_XENO_SAVE_VERSION,
        round: 5,
        score: 4200,
        grossEarned: 9000,
        hp: 180,
        hpMax: 250,
        perks: ['juggernog'],
        quickReviveBuys: 0,
        weapons: [{ base: 'm1911', tier: 0, mag: 8, reserve: 80 }],
        activeSlot: 0,
        equipment: ['sentry', 'blackhole'],
        powered: true,
        doors: ['door-barracks-mess'],
        x: 8,
        z: 4,
        y: 0,
        yaw: 1.2,
        runTime: 620,
        stats: {
            kills: 120,
            headshots: 40,
            spins: 2,
            barrels: 3,
            boards: 15
        },
        ...overrides
    }
}

describe('settleCallOfXenoRun', () => {
    it('pays the reported gross and advances the records', () => {
        const result = settleCallOfXenoRun(state(), { round: 8, grossPoints: 8_000 }, 30 * 60_000)
        expect(result.round).toBe(8)
        expect(result.awarded).toBe(Math.floor(8_000 * 0.04))
        expect(result.runsPlayed).toBe(4)
        expect(result.bestRounds.bestRoundRecruit).toBe(11)
    })

    it('credits the round the run says it died on', () => {
        // Scoreboard data is the client's word: a fast run settles at the
        // depth it reached even when no clock-based model believes it.
        // (A pacing clamp once froze a real round-20 death at round 10.)
        const result = settleCallOfXenoRun(state(), { round: 20, grossPoints: 30_000 }, 12 * 60_000)
        expect(result.round).toBe(20)
        expect(result.bestRounds.bestRoundRecruit).toBe(20)
    })

    it('still clamps the credited round at the game\'s hard depth cap', () => {
        const result = settleCallOfXenoRun(state(), { round: 150, grossPoints: 10_000 }, 60 * 60_000)
        expect(result.round).toBe(100)
    })

    it('still caps a forged gross at the honesty ceiling', () => {
        const result = settleCallOfXenoRun(state(), { round: 5, grossPoints: 1e12 }, 5 * 60_000)
        expect(result.capped).toBe(true)
        expect(result.counted).toBeLessThan(1e12)
    })
})

describe('callOfXenoValidateSave', () => {
    it('accepts a save the game actually produced', () => {
        expect(callOfXenoValidateSave(save())).toBe(true)
        expect(callOfXenoValidateSave(save({
            perks: ['juggernog', 'speedcola', 'doubletap', 'quickrevive'],
            quickReviveBuys: 3,
            weapons: [
                { base: 'ak74', tier: 3, mag: 30, reserve: 270 },
                { base: 'm1911', tier: 0, mag: 0, reserve: 0 }
            ],
            activeSlot: 1
        }))).toBe(true)
    })

    it('rejects anything that is not the current save shape', () => {
        expect(callOfXenoValidateSave(null)).toBe(false)
        expect(callOfXenoValidateSave({})).toBe(false)
        expect(callOfXenoValidateSave(save({ version: CALL_OF_XENO_SAVE_VERSION + 1 }))).toBe(false)
        expect(callOfXenoValidateSave(save({ round: 1 }))).toBe(false)
        expect(callOfXenoValidateSave(save({ round: 101 }))).toBe(false)
        expect(callOfXenoValidateSave(save({ round: 4.5 }))).toBe(false)
        expect(callOfXenoValidateSave(save({ score: Number.POSITIVE_INFINITY }))).toBe(false)
        expect(callOfXenoValidateSave(save({ grossEarned: -1 }))).toBe(false)
    })

    it('rejects health outside what the perks and armour can build', () => {
        expect(callOfXenoValidateSave(save({ hp: 0 }))).toBe(false)
        expect(callOfXenoValidateSave(save({ hp: 300, hpMax: 250 }))).toBe(false)
        expect(callOfXenoValidateSave(save({ hpMax: 50 }))).toBe(false)
        expect(callOfXenoValidateSave(save({ hpMax: 999 }))).toBe(false)
    })

    it('rejects perks that do not exist or repeat', () => {
        expect(callOfXenoValidateSave(save({ perks: ['rootbeer' as never] }))).toBe(false)
        expect(callOfXenoValidateSave(save({ perks: ['juggernog', 'juggernog'] }))).toBe(false)
        expect(callOfXenoValidateSave(save({ quickReviveBuys: 4 }))).toBe(false)
    })

    it('rejects weapons that do not exist or carry impossible ammo', () => {
        expect(callOfXenoValidateSave(save({
            weapons: [{ base: 'raygun' as never, tier: 0, mag: 1, reserve: 1 }]
        }))).toBe(false)
        expect(callOfXenoValidateSave(save({
            weapons: [{ base: 'm1911', tier: 4, mag: 8, reserve: 80 }]
        }))).toBe(false)
        // The tier's Pack-a-Punched magazine is the magazine cap.
        expect(callOfXenoValidateSave(save({
            weapons: [{ base: 'm1911', tier: 3, mag: 999, reserve: 80 }]
        }))).toBe(false)
        expect(callOfXenoValidateSave(save({
            weapons: [{ base: 'm1911', tier: 0, mag: 8, reserve: 99_999 }]
        }))).toBe(false)
        expect(callOfXenoValidateSave(save({ activeSlot: 5 }))).toBe(false)
        expect(callOfXenoValidateSave(save({ weapons: [] }))).toBe(false)
    })

    it('rejects doors the map does not have', () => {
        expect(callOfXenoValidateSave(save({ doors: ['door-vault'] }))).toBe(false)
        expect(callOfXenoValidateSave(save({ doors: ['door-barracks-mess', 'door-barracks-mess'] }))).toBe(false)
    })

    it('round-trips carried equipment and rejects stock the bench cannot sell', () => {
        expect(callOfXenoValidateSave(save({ equipment: ['sentry', 'drone', 'blackhole'] }))).toBe(true)
        // Absent means pre-workbench save, not a broken one.
        expect(callOfXenoValidateSave(save({ equipment: undefined }))).toBe(true)
        expect(callOfXenoValidateSave(save({ equipment: ['tesla-coil' as never] }))).toBe(false)
        expect(callOfXenoValidateSave(save({ equipment: ['sentry', 'drone', 'blackhole', 'sentry'] }))).toBe(false)
    })

    it('rejects positions off the map and non-finite facing', () => {
        expect(callOfXenoValidateSave(save({ x: 500 }))).toBe(false)
        expect(callOfXenoValidateSave(save({ y: Number.NaN }))).toBe(false)
        expect(callOfXenoValidateSave(save({ yaw: Number.POSITIVE_INFINITY }))).toBe(false)
        expect(callOfXenoValidateSave(save({ runTime: -1 }))).toBe(false)
    })

    it('rejects stats that are not counts', () => {
        const stats = { ...save().stats, kills: 1.5 }
        expect(callOfXenoValidateSave(save({ stats }))).toBe(false)
        const negative = { ...save().stats, boards: -3 }
        expect(callOfXenoValidateSave(save({ stats: negative }))).toBe(false)
    })
})

describe('callOfXenoSavePointsCeiling', () => {
    it('floors early boundary saves above the payout grace window', () => {
        // The payout ceiling is zero before its 2-minute grace; a round-1
        // boundary save (~60s in) must not be clamped to nothing.
        const recruit = callOfXenoDifficulty('recruit')
        expect(callOfXenoSavePointsCeiling(0, recruit)).toBe(CALL_OF_XENO_SAVE_EARLY_POINTS_FLOOR)
        expect(callOfXenoSavePointsCeiling(60_000, recruit)).toBe(CALL_OF_XENO_SAVE_EARLY_POINTS_FLOOR)
    })

    it('hands over to the wall-clock ceiling once the ramp passes the floor', () => {
        const recruit = callOfXenoDifficulty('recruit')
        const at = callOfXenoSavePointsCeiling(30 * 60_000, recruit)
        expect(at).toBe(callOfXenoMaxGrossForElapsedMs(30 * 60_000, recruit))
        expect(at).toBeGreaterThan(CALL_OF_XENO_SAVE_EARLY_POINTS_FLOOR)
    })
})
