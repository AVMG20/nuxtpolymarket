/**
 * Arena rules (`arena.md`): seasons, the daily attempts and their Gem ladder, asymmetric Elo,
 * Medals, the matchmaking band, the Arena Shop's catalogue and the season rewards.
 *
 * Pure, like everything in `shared/`: no clock and no randomness of its own. A caller hands in the
 * time and, for the candidate draw, the random source; the server applies every result under the
 * `hq_state` row locks (`server/utils/hero-quest-arena.ts`), and the client reads the same functions
 * to show prices and countdowns.
 */

import {
    ARENA_CANDIDATE_COUNT,
    ARENA_ELO_SCALE,
    ARENA_EXTRA_ATTEMPT_BASE_GEMS,
    ARENA_EXTRA_ATTEMPT_GROWTH,
    ARENA_FREE_ATTEMPTS_PER_DAY,
    ARENA_MATCH_BAND_PCT,
    ARENA_RATING_FLOOR,
    ARENA_RATING_START,
    ARENA_SEASON_DAYS,
    ARENA_SEASON_EPOCH_MS,
    ARENA_SEASON_REWARDS,
    ARENA_SHOP_GEM_PRICE,
    ARENA_SHOP_GOLD_MINUTES,
    ARENA_SHOP_GOLD_PRICE,
    ARENA_SHOP_KEY_PRICE,
    ARENA_SHOP_SEAL_PRICE,
    K_ATTACK,
    K_DEFEND,
    MEDAL_BASE_LOSS,
    MEDAL_BASE_WIN,
    MEDAL_UPSET_BONUS
} from './constants'
import { D, type DecimalSource } from './numbers'
import { RAIDS, type RaidId } from './content/raids'
import type { GachaSystem } from './gacha'
import type { FormationRow } from './types'

const DAY_MS = 86_400_000
const SEASON_MS = ARENA_SEASON_DAYS * DAY_MS

/**
 * The stored defence (§1): the same five components a Loadout captures (`loadouts.md` §1), Gear
 * included, kept apart from the live loadout so attack and defence diverge by design. IDs only;
 * star and level are read from the defender's collection when they are attacked.
 */
export interface ArenaDefenseLoadout {
    partyChampionIds: string[]
    formation: Record<string, FormationRow>
    equippedSkillIds: string[]
    equippedArtifactIds: string[]
    equippedGear: Record<string, string>
}

// ── Seasons ────────────────────────────────────────────────────────────────────────

/**
 * The season running at `now`: 1 from `ARENA_SEASON_EPOCH_MS`, one more every `ARENA_SEASON_DAYS`.
 * Every player shares it, so a season ends for everyone at once, settled by whichever read comes
 * first after it (`tech-architecture.md` §4a: no cron).
 */
export function arenaSeasonAt(now: number): number {
    return Math.max(1, Math.floor((now - ARENA_SEASON_EPOCH_MS) / SEASON_MS) + 1)
}

export function arenaSeasonStartsAt(season: number): number {
    return ARENA_SEASON_EPOCH_MS + (Math.max(1, season) - 1) * SEASON_MS
}

export function arenaSeasonEndsAt(season: number): number {
    return arenaSeasonStartsAt(season) + SEASON_MS
}

/** A player's Arena standing as stored: the season it belongs to, and that season's Rating and matches. */
export interface ArenaStanding {
    season: number
    rating: number
    matches: number
}

/**
 * A standing carried into `season`: unchanged within its own season, back to the start (§7) once a
 * later one has begun. Never backwards: a standing already in a later season than the caller's
 * clock says (another request rolled it a moment after this one read the time) stays where it is.
 */
export function rollStanding(stored: ArenaStanding, season: number): ArenaStanding {
    if (stored.season >= season) return stored
    return { season, rating: ARENA_RATING_START, matches: 0 }
}

/** The Rating a player fights at in `season`: their own within it, the starting Rating otherwise. */
export function ratingIn(stored: ArenaStanding, season: number): number {
    return rollStanding(stored, season).rating
}

/** What a final rank pays (§7), in Medals: the first row it is within. */
export function seasonRewardFor(rank: number): number {
    const row = ARENA_SEASON_REWARDS.find(r => rank <= r.maxRank)
    return row?.medals ?? 0
}

/**
 * Final ranks for a season's standings, highest Rating first. Ties share a rank and the next rank
 * skips past them (1, 2, 2, 4): no player is ranked below anyone they matched.
 */
export function rankStandings<T extends { rating: number }>(rows: readonly T[]): (T & { rank: number })[] {
    const sorted = [...rows].sort((a, b) => b.rating - a.rating)
    let rank = 0
    return sorted.map((row, i) => {
        if (i === 0 || row.rating !== sorted[i - 1]!.rating) rank = i + 1
        return { ...row, rank }
    })
}

// ── Attempts ───────────────────────────────────────────────────────────────────────

/** Today's attacks as stored: the UTC day they count for, attacks made, extra attacks bought. */
export interface ArenaAttempts {
    date: string | null
    used: number
    purchased: number
}

/**
 * Today's counters: as stored on the same UTC day, back to none on a new one (§3: free attacks do
 * not bank, and the extra-attack ladder starts over). `today` is a `ladderDateKey`.
 */
export function attemptsOn(stored: ArenaAttempts, today: string): ArenaAttempts {
    if (stored.date === today) return stored
    return { date: today, used: 0, purchased: 0 }
}

/** Attacks left today: the free ones and those bought, less those made. */
export function attemptsLeft(today: ArenaAttempts): number {
    return Math.max(0, ARENA_FREE_ATTEMPTS_PER_DAY + today.purchased - today.used)
}

/** The price of the next extra attack, after `purchasedToday` bought today: 10, 20, 40, … Gems (§3). */
export function extraAttemptPrice(purchasedToday: number): number {
    return Math.round(ARENA_EXTRA_ATTEMPT_BASE_GEMS * ARENA_EXTRA_ATTEMPT_GROWTH ** Math.max(0, Math.floor(purchasedToday)))
}

// ── Rating ─────────────────────────────────────────────────────────────────────────

/** `expectedAttacker` (§4): the attacker's chance of winning, by the Elo curve. */
export function expectedScore(attackerRating: number, defenderRating: number): number {
    return 1 / (1 + 10 ** ((defenderRating - attackerRating) / ARENA_ELO_SCALE))
}

export interface RatingChange {
    before: number
    after: number
    /** `after − before`: what the floor left of the delta. */
    change: number
}

function moved(before: number, delta: number): RatingChange {
    const after = Math.max(ARENA_RATING_FLOOR, before + Math.round(delta))
    return { before, after, change: after - before }
}

/**
 * One match's Rating update (§4), asymmetric:
 *
 *     attacker' = attacker + K_ATTACK × (actual − expectedAttacker)
 *     defender' = defender + K_DEFEND × ((1 − actual) − expectedDefender)
 *
 * Each delta is rounded to a whole point and the result floored at `ARENA_RATING_FLOOR`.
 */
export function eloUpdate(attackerRating: number, defenderRating: number, attackerWon: boolean): {
    expectedAttacker: number
    attacker: RatingChange
    defender: RatingChange
} {
    const expectedAttacker = expectedScore(attackerRating, defenderRating)
    const actual = attackerWon ? 1 : 0
    return {
        expectedAttacker,
        attacker: moved(attackerRating, K_ATTACK * (actual - expectedAttacker)),
        defender: moved(defenderRating, K_DEFEND * ((1 - actual) - (1 - expectedAttacker)))
    }
}

/**
 * What an attack pays the attacker (§5). A win scales with how unlikely it was; a loss pays the
 * flat floor. `expectedAttacker` null is a Training Dummy, which pays the base win flat (§2a).
 */
export function medalsFor(won: boolean, expectedAttacker: number | null): number {
    if (!won) return MEDAL_BASE_LOSS
    if (expectedAttacker === null) return MEDAL_BASE_WIN
    return Math.round(MEDAL_BASE_WIN * (1 + MEDAL_UPSET_BONUS * (1 - expectedAttacker)))
}

// ── Matchmaking ────────────────────────────────────────────────────────────────────

/**
 * A GPN on the log10 scale the band is searched on: Decimal GPNs outgrow a double deep into the
 * curve, but their logarithm never does, and a ±% band is a fixed width in log space. Null for no
 * power at all, which no band holds.
 */
export function gpnLog10(gpn: DecimalSource): number | null {
    const value = D(gpn)
    if (!value.gt(0)) return null
    const log = value.log10().toNumber()
    return Number.isFinite(log) ? log : null
}

/**
 * The band around the attacker's live GPN a defender's Defense GPN must fall in (§2), as log10
 * bounds: `[gpn × (1 − pct), gpn × (1 + pct)]`.
 */
export function matchBand(attackerGpn: DecimalSource, pct = ARENA_MATCH_BAND_PCT): { lo: number, hi: number } | null {
    const log = gpnLog10(attackerGpn)
    if (log === null) return null
    const below = Math.max(1e-9, 1 - pct)
    return { lo: log + Math.log10(below), hi: log + Math.log10(1 + pct) }
}

export function inMatchBand(attackerGpn: DecimalSource, defenderGpn: DecimalSource, pct = ARENA_MATCH_BAND_PCT): boolean {
    const band = matchBand(attackerGpn, pct)
    const log = gpnLog10(defenderGpn)
    return band !== null && log !== null && log >= band.lo && log <= band.hi
}

/**
 * The opponent list (§2, §2a): up to `ARENA_CANDIDATE_COUNT` distinct players drawn at random from
 * the in-band pool, and a Training Dummy (`null`) for every slot the pool can't fill. The band is
 * never widened to fill one.
 *
 * `pick(n)` returns a uniform index in `[0, n)`; the server passes `#shared/utils/random`, so the
 * draw is a CSPRNG one while this stays pure and testable.
 */
export function drawCandidates(pool: readonly string[], pick: (n: number) => number, count = ARENA_CANDIDATE_COUNT): (string | null)[] {
    const left = [...new Set(pool)]
    const drawn: (string | null)[] = []
    while (drawn.length < count && left.length > 0) {
        const at = Math.min(left.length - 1, Math.max(0, Math.floor(pick(left.length))))
        drawn.push(left.splice(at, 1)[0]!)
    }
    while (drawn.length < count) drawn.push(null)
    return drawn
}

// ── The Arena Shop ─────────────────────────────────────────────────────────────────

export type ArenaShopItem =
    | { id: string, kind: 'seals', system: GachaSystem, price: number }
    | { id: string, kind: 'keys', raid: RaidId, price: number }
    | { id: string, kind: 'gold', minutes: number, price: number }
    | { id: string, kind: 'gems', price: number }

const SEAL_SYSTEMS: readonly GachaSystem[] = ['champion', 'skill', 'artifact', 'gear']

/**
 * Everything the shop sells, one unit each (§6): all four Seals, all five raids' Keys, Gold as
 * minutes of income, and Gems at the deliberately bad rate. IDs are stable; a purchase names one.
 */
export const ARENA_SHOP: readonly ArenaShopItem[] = [
    ...SEAL_SYSTEMS.map(system => ({ id: `seals_${system}`, kind: 'seals' as const, system, price: ARENA_SHOP_SEAL_PRICE })),
    ...RAIDS.map(raid => ({ id: `keys_${raid.id}`, kind: 'keys' as const, raid: raid.id, price: ARENA_SHOP_KEY_PRICE })),
    { id: 'gold', kind: 'gold', minutes: ARENA_SHOP_GOLD_MINUTES, price: ARENA_SHOP_GOLD_PRICE },
    { id: 'gems', kind: 'gems', price: ARENA_SHOP_GEM_PRICE }
]

export function arenaShopItem(id: unknown): ArenaShopItem | null {
    return ARENA_SHOP.find(item => item.id === id) ?? null
}

/** A Training Dummy slot's sentinel on the wire, where a real candidate's user ID would be. */
export const ARENA_DUMMY_ID = 'training_dummy'
