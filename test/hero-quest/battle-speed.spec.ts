import { describe, expect, it } from 'vitest'
import {
    battleSpeedAt,
    battleSpeedPrice,
    battleSpeedRemainingSeconds,
    dilatedSeconds,
    extendBattleSpeed,
    heldBattleSpeedExpiry,
    speedBoostFor
} from '#shared/utils/hero-quest/battle-speed'
import { BATTLE_SPEED_DURATIONS_MINUTES, BATTLE_SPEED_TIERS, MAX_BATTLE_SPEED } from '#shared/utils/hero-quest/constants'

const NOW = Date.UTC(2026, 9, 4, 12)
const MINUTE = 60_000

describe('battle speed', () => {
    describe('pricing', () => {
        it('matches the table in idle-mechanics.md §3, cell for cell', () => {
            const table: Record<number, number[]> = {
                2: [250, 475, 905, 1715],
                3: [375, 715, 1355, 2570],
                5: [625, 1190, 2255, 4285]
            }
            for (const speed of BATTLE_SPEED_TIERS) {
                expect(BATTLE_SPEED_DURATIONS_MINUTES.map(m => battleSpeedPrice(speed, m))).toEqual(table[speed])
            }
        })

        it('prices every block in whole Gems, which is all debitGems takes', () => {
            for (const speed of BATTLE_SPEED_TIERS) {
                for (const minutes of BATTLE_SPEED_DURATIONS_MINUTES) expect(Number.isInteger(battleSpeedPrice(speed, minutes))).toBe(true)
            }
        })

        it('tops out at the fastest tier', () => {
            expect(MAX_BATTLE_SPEED).toBe(5)
        })
    })

    describe('the running block', () => {
        const running = { multiplier: 3, expiresAt: new Date(NOW + 10 * MINUTE) }

        it('runs at its multiplier until it expires, then at 1x', () => {
            expect(battleSpeedAt(running, NOW)).toBe(3)
            expect(battleSpeedAt(running, NOW + 10 * MINUTE)).toBe(1)
            expect(battleSpeedAt({ multiplier: null, expiresAt: null }, NOW)).toBe(1)
            expect(battleSpeedRemainingSeconds(running, NOW)).toBe(600)
            expect(battleSpeedRemainingSeconds(running, NOW + 20 * MINUTE)).toBe(0)
        })

        it('covers a window from its start up to the expiry', () => {
            expect(speedBoostFor(running, NOW)).toEqual({ multiplier: 3, overlapSeconds: 600 })
            expect(speedBoostFor(running, NOW + 10 * MINUTE)).toBeUndefined()
        })

        it('dilates only the covered part of a window', () => {
            expect(dilatedSeconds(900, 3, 600)).toBe(600 * 3 + 300)
            expect(dilatedSeconds(300, 3, 600)).toBe(900)
            expect(dilatedSeconds(300, 3, 0)).toBe(300)
        })

        it('waits out a held span: pushed out by all of it, or untouched with no block running', () => {
            expect(heldBattleSpeedExpiry(running, NOW, NOW + 4 * MINUTE)).toEqual(new Date(NOW + 14 * MINUTE))
            // a block that ends inside the span still gets the whole span back
            expect(heldBattleSpeedExpiry(running, NOW + 8 * MINUTE, NOW + 12 * MINUTE)).toEqual(new Date(NOW + 14 * MINUTE))
            expect(heldBattleSpeedExpiry(running, NOW + 10 * MINUTE, NOW + 12 * MINUTE)).toBeNull()
            expect(heldBattleSpeedExpiry({ multiplier: null, expiresAt: null }, NOW, NOW + MINUTE)).toBeNull()
            expect(heldBattleSpeedExpiry(running, NOW, NOW)).toBeNull()
        })
    })

    describe('buying', () => {
        it('starts a block from now when none runs', () => {
            const next = extendBattleSpeed({ multiplier: null, expiresAt: null }, 2, 30, NOW)
            expect(next).toEqual({ multiplier: 2, expiresAt: new Date(NOW + 30 * MINUTE) })
        })

        it('starts fresh once the last block has run out', () => {
            const next = extendBattleSpeed({ multiplier: 5, expiresAt: new Date(NOW - MINUTE) }, 2, 60, NOW)
            expect(next).toEqual({ multiplier: 2, expiresAt: new Date(NOW + 60 * MINUTE) })
        })

        it('extends a running block of the same speed from its end, so no paid time is lost', () => {
            const next = extendBattleSpeed({ multiplier: 3, expiresAt: new Date(NOW + 10 * MINUTE) }, 3, 30, NOW)
            expect(next).toEqual({ multiplier: 3, expiresAt: new Date(NOW + 40 * MINUTE) })
        })

        it('refuses a different speed while a block runs', () => {
            expect(extendBattleSpeed({ multiplier: 3, expiresAt: new Date(NOW + 10 * MINUTE) }, 5, 30, NOW)).toEqual({ conflict: 3 })
        })
    })
})
