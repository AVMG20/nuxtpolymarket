import { describe, it, expect } from 'vitest'
import {
    AVIA_MAX_LEVEL,
    AVIA_MAX_WIN,
    AVIA_RTP_BAND,
    AVIA_SAFE_LANDING_COST,
    playAviaRound,
    playAviamasters,
    playAviamastersWith,
    type AviaMode,
    type AviaRoundOutcome
} from '../../shared/utils/gamelogic/aviamasters'
import { GAMES_REGISTRY } from '../../shared/utils/games-registry'

function mulberry32(seed: number) {
    let a = seed
    return () => {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6

/** Replays the event list and checks it tells the same story as the outcome. */
function checkOutcome(o: AviaRoundOutcome) {
    let counter = 1
    for (const e of o.events) {
        expect(e.level).toBeGreaterThanOrEqual(0)
        expect(e.level).toBeLessThanOrEqual(AVIA_MAX_LEVEL)
        if (e.kind === 'add') counter = round6(counter + e.value)
        else if (e.kind === 'mul') counter = round6(counter * e.value)
        else if (e.kind === 'rocket' && !e.blocked) counter = round6(counter / 2)
        expect(e.counter).toBeCloseTo(Math.min(counter, AVIA_MAX_WIN), 6)
    }
    const last = o.events[o.events.length - 1]
    if (o.landing === 'crash') {
        expect(last?.kind === 'rocket' && last.fall === 'crash').toBe(true)
        expect(o.win).toBe(0)
    } else if (o.landing === 'max') {
        expect(o.win).toBe(AVIA_MAX_WIN)
    } else if (o.landing === 'water') {
        expect(o.win).toBe(0)
    } else {
        expect(o.win).toBeCloseTo(counter, 6)
    }
    expect(o.win).toBeLessThanOrEqual(AVIA_MAX_WIN)
    // Only one Life Buoy per flight.
    expect(o.events.filter(e => e.kind === 'booster' && e.booster === 'buoy').length).toBeLessThanOrEqual(1)
}

describe('playAviaRound', () => {
    it('keeps every normal flight internally consistent', () => {
        const rng = mulberry32(1)
        for (let i = 0; i < 3_000; i++) {
            const o = playAviaRound(rng, 'normal')
            expect(o.cost).toBe(1)
            checkOutcome(o)
        }
    })

    it('never puts a Safe Landing flight in the sea', () => {
        const rng = mulberry32(2)
        for (let i = 0; i < 3_000; i++) {
            const o = playAviaRound(rng, 'safe')
            expect(o.cost).toBe(AVIA_SAFE_LANDING_COST)
            expect(['island', 'max']).toContain(o.landing)
            expect(o.events.some(e => e.kind === 'booster' && e.booster === 'buoy')).toBe(false)
            checkOutcome(o)
        }
    })

    it.each<AviaMode>(['normal', 'safe'])('lands %s mode RTP inside the band', (mode) => {
        const rng = mulberry32(mode === 'safe' ? 11 : 10)
        const rounds = mode === 'safe' ? 400_000 : 1_000_000
        let win = 0
        let cost = 0
        for (let i = 0; i < rounds; i++) {
            const o = playAviaRound(rng, mode)
            win += o.win
            cost += o.cost
        }
        const rtp = win / cost
        expect(rtp).toBeGreaterThanOrEqual(AVIA_RTP_BAND.min)
        expect(rtp).toBeLessThanOrEqual(AVIA_RTP_BAND.max)
    }, 60_000)
})

describe('playAviamasters', () => {
    it('stakes the bet and pays the counter in coins', () => {
        const rng = mulberry32(3)
        for (let i = 0; i < 2_000; i++) {
            const r = playAviamastersWith(250, undefined, rng)
            expect(r.mode).toBe('normal')
            expect(r.cost).toBe(250)
            expect(r.payout).toBeCloseTo(r.outcome.win * 250, 3)
            expect(r.payout).toBeLessThanOrEqual(r.maxWin)
            expect(r.won).toBe(r.payout > r.cost)
        }
    })

    it('charges Safe Landing at its multiple of the bet', () => {
        const r = playAviamastersWith(10, { mode: 'safe' }, mulberry32(4))
        expect(r.mode).toBe('safe')
        expect(r.cost).toBe(10 * AVIA_SAFE_LANDING_COST)
        expect(r.payout).toBeGreaterThan(0)
    })

    it('treats an unknown mode as a normal round', () => {
        expect(playAviamastersWith(10, { mode: 'free' }, mulberry32(5)).cost).toBe(10)
    })

    it('rejects a bet that is not a positive number', () => {
        for (const bet of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => playAviamasters(bet)).toThrow()
        }
    })

    it('is registered for /api/games/play-game', () => {
        expect(GAMES_REGISTRY.aviamasters?.play).toBe(playAviamasters)
    })
})
