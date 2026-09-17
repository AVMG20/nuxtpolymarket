import { describe, expect, it } from 'vitest'
import { BAC_BET_KEYS, BAC_PAYOUTS, emptyBets, resolveBets } from '#shared/utils/baccarat/payouts'
import type { BacOutcome } from '#shared/utils/baccarat/payouts'

const playerWin: BacOutcome = { winner: 'player', playerPair: false, bankerPair: false }
const bankerWin: BacOutcome = { winner: 'banker', playerPair: false, bankerPair: false }
const tie: BacOutcome = { winner: 'tie', playerPair: false, bankerPair: false }

describe('emptyBets / BAC_BET_KEYS', () => {
    it('starts every spot at zero', () => {
        expect(emptyBets()).toEqual({ player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 })
    })

    it('lists exactly the five bet spots', () => {
        expect(BAC_BET_KEYS.sort()).toEqual(['banker', 'bankerPair', 'player', 'playerPair', 'tie'])
    })
})

describe('resolveBets — Player', () => {
    it('pays even money on a Player win', () => {
        const result = resolveBets({ ...emptyBets(), player: 100 }, playerWin)
        expect(result).toEqual({ staked: 100, payout: 200 })
    })

    it('pushes on a tie -- stake back, nothing more', () => {
        const result = resolveBets({ ...emptyBets(), player: 100 }, tie)
        expect(result).toEqual({ staked: 100, payout: 100 })
    })

    it('loses on a Banker win', () => {
        const result = resolveBets({ ...emptyBets(), player: 100 }, bankerWin)
        expect(result).toEqual({ staked: 100, payout: 0 })
    })
})

describe('resolveBets — Banker', () => {
    it('pays 0.95 to 1 on a Banker win, the 5% commission', () => {
        const result = resolveBets({ ...emptyBets(), banker: 100 }, bankerWin)
        expect(result).toEqual({ staked: 100, payout: 195 })
    })

    it('pushes on a tie', () => {
        const result = resolveBets({ ...emptyBets(), banker: 100 }, tie)
        expect(result).toEqual({ staked: 100, payout: 100 })
    })

    it('loses on a Player win', () => {
        const result = resolveBets({ ...emptyBets(), banker: 100 }, playerWin)
        expect(result).toEqual({ staked: 100, payout: 0 })
    })
})

describe('resolveBets — Tie', () => {
    it('pays 8 to 1 on a tie', () => {
        const result = resolveBets({ ...emptyBets(), tie: 50 }, tie)
        expect(result).toEqual({ staked: 50, payout: 450 })
    })

    it('loses -- no push -- on either side winning outright', () => {
        expect(resolveBets({ ...emptyBets(), tie: 50 }, playerWin)).toEqual({ staked: 50, payout: 0 })
        expect(resolveBets({ ...emptyBets(), tie: 50 }, bankerWin)).toEqual({ staked: 50, payout: 0 })
    })
})

describe('resolveBets — pairs', () => {
    it('pays 11 to 1 on Player Pair when it hit, independent of the hand result', () => {
        const outcome: BacOutcome = { winner: 'banker', playerPair: true, bankerPair: false }
        const result = resolveBets({ ...emptyBets(), playerPair: 20 }, outcome)
        expect(result).toEqual({ staked: 20, payout: 240 })
    })

    it('pays 11 to 1 on Banker Pair when it hit', () => {
        const outcome: BacOutcome = { winner: 'player', playerPair: false, bankerPair: true }
        const result = resolveBets({ ...emptyBets(), bankerPair: 20 }, outcome)
        expect(result).toEqual({ staked: 20, payout: 240 })
    })

    it('loses when the pair did not hit', () => {
        const result = resolveBets({ ...emptyBets(), playerPair: 20, bankerPair: 20 }, playerWin)
        expect(result).toEqual({ staked: 40, payout: 0 })
    })
})

describe('resolveBets — combined', () => {
    it('resolves every spot independently in the same round', () => {
        const bets = { player: 100, banker: 50, tie: 10, playerPair: 20, bankerPair: 20 }
        const outcome: BacOutcome = { winner: 'player', playerPair: true, bankerPair: false }

        const result = resolveBets(bets, outcome)

        // player wins (100 -> 200), banker loses (50 -> 0), tie loses (10 -> 0),
        // playerPair hits (20 -> 240), bankerPair misses (20 -> 0)
        expect(result).toEqual({ staked: 200, payout: 440 })
    })

    it('is zero-in zero-out for an empty betting round', () => {
        expect(resolveBets(emptyBets(), playerWin)).toEqual({ staked: 0, payout: 0 })
    })
})

describe('BAC_PAYOUTS', () => {
    it('keeps Banker below Player and Player at even money', () => {
        expect(BAC_PAYOUTS.banker).toBeLessThan(BAC_PAYOUTS.player)
        expect(BAC_PAYOUTS.player).toBe(1)
    })
})
