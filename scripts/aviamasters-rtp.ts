// scripts/aviamasters-rtp.ts
//
// RTP check for Aviamasters. Plays both modes through the production play
// function (crypto RNG, the same code path /api/games/play-game runs) and
// fails when either mode's RTP leaves AVIA_RTP_BAND.
//
//   bun run balance:aviamasters                 # 10M rounds per mode
//   bun run balance:aviamasters 50000000        # 50M rounds per mode
//   bun run balance:aviamasters 10000000 safe   # one mode only
//   bun run balance:aviamasters --tune          # re-solve the tuned weights
//
// --tune solves the rocket weight (normal) and the multiplier weight (safe) for
// AVIA_TARGET_RTP by bisection on a seeded RNG (common random numbers, so every
// probe sees the same draws), then prints the values to paste into
// shared/utils/gamelogic/aviamasters.ts. Always re-run the plain check after.

import {
    AVIA_MAX_WIN,
    AVIA_NORMAL,
    AVIA_RTP_BAND,
    AVIA_SAFE,
    AVIA_TARGET_RTP,
    playAviaRound,
    playAviamasters,
    type AviaMode,
    type AviaModeConfig,
    type AviaRng
} from '../shared/utils/gamelogic/aviamasters'

const pct = (n: number) => (100 * n).toFixed(3) + '%'

function mulberry32(seed: number): AviaRng {
    let a = seed
    return () => {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const EDGES = [0, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000]

function check(mode: AviaMode, rounds: number): boolean {
    let cost = 0
    let payout = 0
    let payout2 = 0
    let hits = 0
    let maxWins = 0
    let events = 0
    const landings: Record<string, number> = {}
    const boosters: Record<string, number> = {}
    const buckets = new Array<number>(EDGES.length).fill(0)
    const started = performance.now()

    for (let i = 0; i < rounds; i++) {
        const r = playAviamasters(1, { mode })
        cost += r.cost
        payout += r.payout
        payout2 += r.payout * r.payout
        if (r.payout > 0) hits++
        if (r.outcome.landing === 'max') maxWins++
        landings[r.outcome.landing] = (landings[r.outcome.landing] ?? 0) + 1
        events += r.outcome.events.length
        for (const e of r.outcome.events) if (e.kind === 'booster') boosters[e.booster] = (boosters[e.booster] ?? 0) + 1
        if (r.payout > 0) {
            const m = r.payout / r.cost
            let b = 0
            while (b < EDGES.length - 1 && m >= EDGES[b + 1]!) b++
            buckets[b]!++
        }
    }

    const stake = cost / rounds
    const mean = payout / rounds
    const sd = Math.sqrt(payout2 / rounds - mean * mean)
    const rtp = mean / stake
    const ci = (1.96 * sd) / Math.sqrt(rounds) / stake
    const ok = rtp >= AVIA_RTP_BAND.min && rtp <= AVIA_RTP_BAND.max

    console.log(`\n=== ${mode.toUpperCase()} — ${rounds.toLocaleString()} rounds (${((performance.now() - started) / 1000).toFixed(1)}s)`)
    console.log(`RTP            ${pct(rtp)}  ± ${pct(ci)} (95% CI)   band ${pct(AVIA_RTP_BAND.min)} – ${pct(AVIA_RTP_BAND.max)}  ${ok ? 'PASS' : 'FAIL'}`)
    console.log(`Hit rate       ${pct(hits / rounds)}  (1 in ${(rounds / hits).toFixed(2)})`)
    console.log(`Volatility SD  ${(sd / stake).toFixed(2)} × stake`)
    console.log(`Max wins x${AVIA_MAX_WIN} 1 in ${maxWins ? Math.round(rounds / maxWins).toLocaleString() : '∞'}`)
    console.log(`Events/round   ${(events / rounds).toFixed(2)}`)
    console.log('Landings       ' + Object.entries(landings).map(([k, v]) => `${k} ${pct(v / rounds)}`).join(' · '))
    console.log('Boosters/round ' + Object.entries(boosters).map(([k, v]) => `${k} ${(v / rounds).toFixed(4)}`).join(' · '))
    console.log('Win / stake (share of all rounds):')
    for (let i = 0; i < EDGES.length; i++) {
        if (!buckets[i]) continue
        const lo = EDGES[i]!
        const hi = EDGES[i + 1]
        console.log(`  ${hi ? `[${lo}, ${hi})` : `≥ ${lo}`}`.padEnd(16) + pct(buckets[i]! / rounds))
    }
    return ok
}

function seededRtp(cfg: AviaModeConfig, mode: AviaMode, rounds: number, seed: number) {
    const rng = mulberry32(seed)
    let win = 0
    let cost = 0
    for (let i = 0; i < rounds; i++) {
        const r = playAviaRound(rng, mode, cfg)
        win += r.win
        cost += r.cost
    }
    return win / cost
}

function solve(lo: number, hi: number, f: (x: number) => number, increasing: boolean) {
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2
        if ((f(mid) < AVIA_TARGET_RTP) === increasing) lo = mid
        else hi = mid
    }
    return (lo + hi) / 2
}

function tune(rounds: number) {
    console.log(`Tuning for RTP ${pct(AVIA_TARGET_RTP)} with ${rounds.toLocaleString()} seeded rounds per probe…`)
    // More rockets → lower RTP; more multipliers → higher RTP.
    const rocket = +solve(20, 200, x => seededRtp({ ...AVIA_NORMAL, rocket: x }, 'normal', rounds, 1), false).toFixed(3)
    console.log(`normal  rocket: ${rocket}   (check seed: ${pct(seededRtp({ ...AVIA_NORMAL, rocket }, 'normal', rounds, 7))})`)
    const mul = +solve(1, 40, x => seededRtp({ ...AVIA_SAFE, mul: x }, 'safe', rounds, 1), true).toFixed(3)
    console.log(`safe    mul:    ${mul}   (check seed: ${pct(seededRtp({ ...AVIA_SAFE, mul }, 'safe', rounds, 7))})`)
}

const args = process.argv.slice(2)
const positional = args.filter(a => !a.startsWith('--'))

if (args.includes('--tune')) {
    tune(Number(positional[0] ?? 3_000_000))
} else {
    const rounds = Number(positional[0] ?? 10_000_000)
    if (!Number.isFinite(rounds) || rounds <= 0) throw new Error(`Invalid rounds "${positional[0]}"`)
    const only = positional[1] as AviaMode | undefined
    if (only && only !== 'normal' && only !== 'safe') throw new Error(`Unknown mode "${only}"`)
    const modes: AviaMode[] = only ? [only] : ['normal', 'safe']
    const results = modes.map(m => check(m, rounds))
    if (results.includes(false)) {
        console.error(`\nRTP outside ${pct(AVIA_RTP_BAND.min)} – ${pct(AVIA_RTP_BAND.max)}`)
        process.exit(1)
    }
}
