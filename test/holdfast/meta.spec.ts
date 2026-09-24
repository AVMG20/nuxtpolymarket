import { describe, expect, it } from 'vitest'
import {
    HOLDFAST_DIFFICULTIES,
    HOLDFAST_MAX_SPEED,
    HOLDFAST_STAT_MAX,
    HOLDFAST_WIN_MS,
    holdfastIsDifficulty,
    holdfastMaxPlausibleSurvival,
    holdfastPlausibleSurvival,
    holdfastSanitizeStats
} from '../../shared/utils/holdfast/meta'

describe('holdfastIsDifficulty', () => {
    it('accepts every difficulty', () => {
        for (const d of HOLDFAST_DIFFICULTIES) expect(holdfastIsDifficulty(d)).toBe(true)
    })

    it('rejects anything else', () => {
        for (const v of ['', 'EASY', 'nightmare', null, undefined, 1, {}, ['easy']]) {
            expect(holdfastIsDifficulty(v), String(v)).toBe(false)
        }
    })
})

describe('holdfastPlausibleSurvival', () => {
    it('allows up to max speed plus slack', () => {
        expect(holdfastPlausibleSurvival(0, 0)).toBe(true)
        expect(holdfastPlausibleSurvival(5000, 0)).toBe(true)
        expect(holdfastPlausibleSurvival(5001, 0)).toBe(false)
        expect(holdfastPlausibleSurvival(60_000 * HOLDFAST_MAX_SPEED + 5000, 60_000)).toBe(true)
        expect(holdfastPlausibleSurvival(60_000 * HOLDFAST_MAX_SPEED + 5001, 60_000)).toBe(false)
    })

    it('never allows more than the win clock', () => {
        expect(holdfastPlausibleSurvival(HOLDFAST_WIN_MS, HOLDFAST_WIN_MS)).toBe(true)
        expect(holdfastPlausibleSurvival(HOLDFAST_WIN_MS + 1, HOLDFAST_WIN_MS * 10)).toBe(false)
    })

    it('rejects negative and non-finite values', () => {
        expect(holdfastPlausibleSurvival(-1, 60_000)).toBe(false)
        expect(holdfastPlausibleSurvival(Number.NaN, 60_000)).toBe(false)
        expect(holdfastPlausibleSurvival(1000, Number.POSITIVE_INFINITY)).toBe(false)
    })

    it('agrees with the max plausible survival', () => {
        for (const elapsed of [0, 1000, 60_000, 400_000, HOLDFAST_WIN_MS, HOLDFAST_WIN_MS * 3]) {
            const max = holdfastMaxPlausibleSurvival(elapsed)
            expect(holdfastPlausibleSurvival(max, elapsed), String(elapsed)).toBe(true)
            if (max < HOLDFAST_WIN_MS) expect(holdfastPlausibleSurvival(max + 1, elapsed), String(elapsed)).toBe(false)
        }
        expect(holdfastMaxPlausibleSurvival(-50_000)).toBe(5000)
        expect(holdfastMaxPlausibleSurvival(Number.NaN)).toBe(5000)
        expect(holdfastMaxPlausibleSurvival(HOLDFAST_WIN_MS)).toBe(HOLDFAST_WIN_MS)
    })
})

describe('holdfastSanitizeStats', () => {
    it('keeps valid integers', () => {
        expect(holdfastSanitizeStats({ kills: 12, packsDeployed: 3, buildingsBuilt: 7, wave: 9 }))
            .toEqual({ kills: 12, packsDeployed: 3, buildingsBuilt: 7, wave: 9 })
    })

    it('floors, clamps and zeroes junk', () => {
        expect(holdfastSanitizeStats({ kills: 12.9, packsDeployed: -4, buildingsBuilt: 1e12, wave: Number.NaN }))
            .toEqual({ kills: 12, packsDeployed: 0, buildingsBuilt: HOLDFAST_STAT_MAX, wave: 0 })
        expect(holdfastSanitizeStats({ kills: '50', packsDeployed: true, buildingsBuilt: null, wave: Number.POSITIVE_INFINITY }))
            .toEqual({ kills: 0, packsDeployed: 0, buildingsBuilt: 0, wave: 0 })
    })

    it('handles non-objects and drops extra keys', () => {
        const zero = { kills: 0, packsDeployed: 0, buildingsBuilt: 0, wave: 0 }
        for (const v of [null, undefined, 5, 'x', []]) expect(holdfastSanitizeStats(v)).toEqual(zero)
        expect(holdfastSanitizeStats({ kills: 1, coins: 999 })).toEqual({ ...zero, kills: 1 })
    })
})
