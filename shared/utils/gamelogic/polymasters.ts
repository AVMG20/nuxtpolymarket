// shared/utils/gamelogic/polymasters.ts
//
// "PolyMasters": a crash-style game. A biplane takes off from an aircraft
// carrier, flies through adders, multipliers, rockets and boosters, and either
// lands on the island (paying its Counter Balance) or splashes into the sea.
//
// A round is fully decided here, on the server, before the plane takes off:
// the event list and the landing are drawn in one go and the client only plays
// that script back. Speed modes and animation timing can never change a result,
// and there is no mid-flight decision for a player to exploit.
//
// ── Rules ────────────────────────────────────────────────────────────────────
//   - The Counter Balance starts equal to the bet (1 bet unit).
//   - Adders +1 / +2 / +5 / +10 add that many bets; multipliers ×2..×5 multiply
//     the counter.
//   - Altitude runs over levels 0..PM_MAX_LEVEL. Adders and multipliers lift
//     the plane one level; every unblocked rocket halves the counter and drops
//     it PM_HIT_DROP levels. A hit at the lowest level sends the plane into
//     the sea (round lost), unless a Life Buoy bounces it back (normal mode) or
//     Safe Landing skims it off the water.
//   - The final landing is easier from higher up.
//   - Boosters: Nitro (rockets bounce off), Laser Gun (shoots rockets down),
//     Magnet (fewer rockets, pulls the plane toward the island), Life Buoy
//     (bounces the plane back after it touches water, once per flight).
//   - Max win PM_MAX_WIN × bet: the round ends at once when the counter
//     reaches it.
//   - Safe Landing costs PM_SAFE_LANDING_COST × bet and always lands.
//
// ── Fairness ─────────────────────────────────────────────────────────────────
//   Both modes are tuned to PM_TARGET_RTP and must stay inside
//   PM_RTP_BAND. `bun run balance:polymasters` measures both modes with the
//   production play function and fails when either leaves the band;
//   `--tune` re-solves the rocket (normal) and multiplier (safe) weights.

import { randomFloat } from '../random'

export const PM_MAX_WIN = 1000
export const PM_SAFE_LANDING_COST = 50
export const PM_TARGET_RTP = 0.9775
/** RTP both modes must measure inside, checked by scripts/polymasters-rtp.ts. */
export const PM_RTP_BAND = { min: 0.97, max: 0.985 } as const

/** Altitude levels (0 = skimming the waves). */
export const PM_MAX_LEVEL = 7
/** Levels lost per rocket hit. */
export const PM_HIT_DROP = 2
/** Extra landing chance per altitude level at the end of the flight. */
export const PM_LAND_PER_LEVEL = 0.05

export type PmBooster = 'nitro' | 'laser' | 'magnet' | 'buoy'
export type PmMode = 'normal' | 'safe'

/** What happened to a plane hit at the lowest level. */
export type PmFall = null | 'crash' | 'rescue' | 'skim'

/** `counter` is in bet units; `level` is the altitude after the event. */
export type PmFlightEvent =
    | { kind: 'add', value: number, counter: number, level: number }
    | { kind: 'mul', value: number, counter: number, level: number }
    | { kind: 'rocket', counter: number, blocked: null | 'nitro' | 'laser', level: number, fall: PmFall }
    | { kind: 'booster', booster: PmBooster, counter: number, level: number }

export type PmLanding = 'island' | 'water' | 'buoy' | 'max' | 'crash'

export interface PmRoundOutcome {
    mode: PmMode
    events: PmFlightEvent[]
    landing: PmLanding
    /** Counter when the plane comes down (bet units). */
    counter: number
    /** Payout in bet units (0 in the sea). */
    win: number
    /** Stake in bet units (1, or PM_SAFE_LANDING_COST with Safe Landing). */
    cost: number
    /** Altitude at the end of the flight (absent after a crash or max win). */
    level?: number
    /** Altitude right after take-off. */
    startLevel: number
}

export interface PolyMastersResult {
    bet: number
    cost: number
    mode: PmMode
    outcome: PmRoundOutcome
    payout: number
    won: boolean
    maxWin: number
    [key: string]: unknown
}

export type PmRng = () => number

type Weighted<T> = [T, number][]

export interface PmModeConfig {
    /** Events always generated before the landing roll. */
    minEvents: number
    /** Probability of another event after minEvents (geometric tail). */
    continueChance: number
    maxEvents: number
    add: number
    mul: number
    rocket: number
    booster: number
    addValues: Weighted<number>
    mulValues: Weighted<number>
    boosters: Weighted<PmBooster>
    /** Chance the final descent reaches the island from level 0 (+PM_LAND_PER_LEVEL per level). */
    landChance: number
    /** Extra landing chance after carrying a Magnet. */
    magnetLandBonus: number
    alwaysLand: boolean
    startLevel: number
}

// `rocket` (normal) and `mul` (safe) are solved by `bun run balance:polymasters
// --tune` for PM_TARGET_RTP; landChance is set for a ~40% hit rate. Everything
// else is design.
export const PM_NORMAL: PmModeConfig = {
    minEvents: 3,
    continueChance: 0.6,
    maxEvents: 40,
    add: 46,
    mul: 3,
    rocket: 63.418,
    booster: 6,
    addValues: [[1, 82], [2, 14], [5, 3], [10, 1]],
    mulValues: [[2, 88], [3, 9], [4, 2], [5, 1]],
    boosters: [['nitro', 30], ['laser', 30], ['magnet', 25], ['buoy', 15]],
    landChance: 0.268,
    magnetLandBonus: 0.15,
    alwaysLand: false,
    startLevel: 5
}

export const PM_SAFE: PmModeConfig = {
    minEvents: 10,
    continueChance: 0.88,
    maxEvents: 60,
    add: 42,
    mul: 7.739,
    rocket: 26,
    booster: 9,
    addValues: [[1, 36], [2, 30], [5, 22], [10, 12]],
    mulValues: [[2, 50], [3, 26], [4, 15], [5, 9]],
    boosters: [['nitro', 30], ['laser', 30], ['magnet', 40], ['buoy', 0]],
    landChance: 1,
    magnetLandBonus: 0,
    alwaysLand: true,
    startLevel: 4
}

const MAGNET_EVENTS = 3
const NITRO_EVENTS = 3
const LASER_EVENTS = 4
/** While a Magnet is active, rockets are this much rarer. */
const MAGNET_ROCKET_FACTOR = 0.25

const round6 = (v: number) => Math.round(v * 1e6) / 1e6
const round4 = (v: number) => Math.round(v * 1e4) / 1e4

function pick<T>(rng: PmRng, table: Weighted<T>): T {
    let total = 0
    for (const [, w] of table) total += w
    let r = rng() * total
    for (const [v, w] of table) {
        r -= w
        if (r < 0) return v
    }
    return table[table.length - 1]![0]
}

/** Plays one flight in bet units. Exported for the RTP script and tests. */
export function playPmRound(rng: PmRng, mode: PmMode, cfg: PmModeConfig = mode === 'safe' ? PM_SAFE : PM_NORMAL): PmRoundOutcome {
    const events: PmFlightEvent[] = []
    let counter = 1
    let magnet = 0
    let nitro = 0
    let laser = 0
    let hadMagnet = false
    let buoy = false
    let buoyOffered = false
    let level = cfg.startLevel
    const cost = mode === 'safe' ? PM_SAFE_LANDING_COST : 1

    for (let i = 0; i < cfg.maxEvents; i++) {
        if (i >= cfg.minEvents && rng() >= cfg.continueChance) break

        const rocketW = magnet > 0 ? cfg.rocket * MAGNET_ROCKET_FACTOR : cfg.rocket
        const kind = pick<'add' | 'mul' | 'rocket' | 'booster'>(rng, [
            ['add', cfg.add],
            ['mul', cfg.mul],
            ['rocket', rocketW],
            ['booster', cfg.booster]
        ])

        const shielded = nitro > 0 ? 'nitro' : laser > 0 ? 'laser' : null
        if (magnet > 0) magnet--
        if (nitro > 0) nitro--
        if (laser > 0) laser--

        if (kind === 'add') {
            const v = pick(rng, cfg.addValues)
            counter = round6(counter + v)
            level = Math.min(PM_MAX_LEVEL, level + 1)
            events.push({ kind: 'add', value: v, counter: Math.min(counter, PM_MAX_WIN), level })
        } else if (kind === 'mul') {
            const v = pick(rng, cfg.mulValues)
            counter = round6(counter * v)
            level = Math.min(PM_MAX_LEVEL, level + 1)
            events.push({ kind: 'mul', value: v, counter: Math.min(counter, PM_MAX_WIN), level })
        } else if (kind === 'rocket') {
            if (shielded) {
                events.push({ kind: 'rocket', counter, blocked: shielded, level, fall: null })
            } else {
                counter = round6(counter / 2)
                if (level > 0) {
                    level = Math.max(0, level - PM_HIT_DROP)
                    events.push({ kind: 'rocket', counter, blocked: null, level, fall: null })
                } else if (mode === 'safe') {
                    // Safe Landing never touches the sea: the plane skims off the water and climbs back
                    level = 1
                    events.push({ kind: 'rocket', counter, blocked: null, level, fall: 'skim' })
                } else if (buoy) {
                    buoy = false
                    level = 2
                    events.push({ kind: 'rocket', counter, blocked: null, level, fall: 'rescue' })
                } else {
                    events.push({ kind: 'rocket', counter, blocked: null, level: 0, fall: 'crash' })
                    return { mode, events, landing: 'crash', counter, win: 0, cost, startLevel: cfg.startLevel }
                }
            }
        } else {
            // Only one Life Buoy per flight: once offered, it is not offered again.
            const table = buoyOffered ? cfg.boosters.filter(([b]) => b !== 'buoy') : cfg.boosters
            const b = pick(rng, table)
            if (b === 'magnet') {
                magnet = MAGNET_EVENTS
                hadMagnet = true
            }
            if (b === 'nitro') nitro = NITRO_EVENTS
            if (b === 'laser') laser = LASER_EVENTS
            if (b === 'buoy') buoy = buoyOffered = true
            events.push({ kind: 'booster', booster: b, counter, level })
        }

        if (counter >= PM_MAX_WIN) {
            return { mode, events, landing: 'max', counter: PM_MAX_WIN, win: PM_MAX_WIN, cost, startLevel: cfg.startLevel }
        }
    }

    let landing: PmLanding
    if (cfg.alwaysLand) {
        landing = 'island'
    } else {
        const chance = Math.min(0.97, cfg.landChance + level * PM_LAND_PER_LEVEL + (hadMagnet ? cfg.magnetLandBonus : 0))
        landing = rng() < chance ? 'island' : buoy ? 'buoy' : 'water'
    }
    const win = landing === 'water' ? 0 : counter
    return { mode, events, landing, counter, win, cost, level, startLevel: cfg.startLevel }
}

export function playPolyMastersWith(bet: number, options: Record<string, unknown> | undefined, rng: PmRng): PolyMastersResult {
    if (!Number.isFinite(bet) || bet <= 0) {
        throw createError({ statusCode: 400, message: 'Invalid bet amount' })
    }
    const mode: PmMode = options?.mode === 'safe' ? 'safe' : 'normal'
    const outcome = playPmRound(rng, mode)
    const cost = round4(bet * outcome.cost)
    const payout = round4(outcome.win * bet)
    return {
        bet,
        cost,
        mode,
        outcome,
        payout,
        won: payout > cost,
        maxWin: bet * PM_MAX_WIN
    }
}

export function playPolyMasters(bet: number, options?: Record<string, unknown>): PolyMastersResult {
    return playPolyMastersWith(bet, options, randomFloat)
}
