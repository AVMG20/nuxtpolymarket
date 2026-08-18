import { describe, expect, it } from 'vitest'
import {
    settleCallOfXenoRun,
    type CallOfXenoSettlementState
} from '#server/utils/call-of-xeno'
import { callOfXenoDifficulty, callOfXenoMaxGrossForElapsedMs } from '#shared/utils/gamelogic/call-of-xeno-meta'
import {
    CALL_OF_XENO_SAVE_VERSION,
    CALL_OF_XENO_SAVE_EARLY_POINTS_FLOOR,
    callOfXenoMaxRoundForElapsedMs,
    callOfXenoMinElapsedMsForRound,
    callOfXenoSavePointsCeiling,
    callOfXenoValidateSave,
    type CallOfXenoRunSave
} from '#shared/utils/gamelogic/call-of-xeno-save'

function state(overrides: Partial<CallOfXenoSettlementState> = {}): CallOfXenoSettlementState {
    return {
        runDifficultySnapshot: 'recruit',
        runPayoutMultSnapshot: '1.0000',
        runSave: null,
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
            bestStreak: 9,
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

    it('never settles deeper than the round in flight at the last checkpoint', () => {
        // A client claiming to have died on round 99 with the server holding
        // a round-15 checkpoint (round 15 was in flight) settles as 15.
        const result = settleCallOfXenoRun(
            state({ runSave: { round: 15 } }),
            { round: 99, grossPoints: 50_000 },
            24 * 60 * 60_000
        )
        expect(result.round).toBe(15)
        expect(result.bestRounds.bestRoundRecruit).toBe(15)
    })

    it('settles the in-flight round the checkpoint names', () => {
        // Died mid-round 15 with the last boundary save saying round 15 is
        // next — that is exactly what a resume would have restarted into.
        const result = settleCallOfXenoRun(
            state({ runSave: { round: 15 } }),
            { round: 15, grossPoints: 5_000 },
            60 * 60_000
        )
        expect(result.round).toBe(15)
    })

    it('never settles deeper than the wall clock can justify', () => {
        // No checkpoint at all: the spawn pacing floor is the only opinion.
        const result = settleCallOfXenoRun(state(), { round: 50, grossPoints: 10_000 }, 60_000)
        expect(result.round).toBe(callOfXenoMaxRoundForElapsedMs(60_000, callOfXenoDifficulty('recruit')))
        expect(result.round).toBeLessThan(20)
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

describe('round pacing floor', () => {
    it('grows with depth and scales with the difficulty spawn count', () => {
        const recruit = callOfXenoDifficulty('recruit')
        const nightmare = callOfXenoDifficulty('nightmare')
        expect(callOfXenoMinElapsedMsForRound(2, recruit)).toBeGreaterThan(0)
        expect(callOfXenoMinElapsedMsForRound(20, recruit))
            .toBeGreaterThan(callOfXenoMinElapsedMsForRound(10, recruit))
        expect(callOfXenoMinElapsedMsForRound(20, nightmare))
            .toBeGreaterThanOrEqual(callOfXenoMinElapsedMsForRound(20, recruit))
    })

    it('keeps maxRoundForElapsedMs the inverse of the floor', () => {
        const recruit = callOfXenoDifficulty('recruit')
        const floorFor30 = callOfXenoMinElapsedMsForRound(30, recruit)
        expect(callOfXenoMaxRoundForElapsedMs(floorFor30 - 1, recruit)).toBe(29)
        expect(callOfXenoMaxRoundForElapsedMs(floorFor30, recruit)).toBe(30)
        expect(callOfXenoMaxRoundForElapsedMs(0, recruit)).toBe(1)
        expect(callOfXenoMaxRoundForElapsedMs(-5000, recruit)).toBe(1)
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
