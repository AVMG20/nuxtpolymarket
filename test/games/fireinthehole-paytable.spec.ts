import { describe, expect, it } from 'vitest'
import { playFireInTheHole } from '#shared/utils/gamelogic/fireinthehole'
import type { FirePaySymbol } from '#shared/utils/gamelogic/fireinthehole'
import { FITH_SYMBOL_PAY, fithChainMultiplier } from '../../app/utils/fireinthehole-paytable'

// The paytable panel shows mirrored copies of the server's private pay
// constants. Replay real spins and recompute every cascade's pay from the
// mirror: if the game math changes, this fails and the panel must follow.
describe('fire in the hole paytable mirror', () => {
    it('recomputes every cascade step pay from the shown paytable', () => {
        const bet = 1000
        let checked = 0

        for (let i = 0; i < 400 && checked < 200; i++) {
            const result = playFireInTheHole(bet)

            result.steps.forEach((step, chain) => {
                const perBet = step.winCells.reduce((sum, cell) => {
                    const symbol = step.grid[cell.col]![cell.row]!
                    return sum + (FITH_SYMBOL_PAY[symbol as FirePaySymbol] ?? 0)
                }, 0)

                expect(Number((perBet * fithChainMultiplier(chain) * bet).toFixed(2))).toBe(step.stepPay)
                checked++
            })
        }

        expect(checked).toBeGreaterThan(50)
    })
})
