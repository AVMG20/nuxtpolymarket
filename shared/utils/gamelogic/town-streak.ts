// Polytown Mayor streak: a 30-day login track.
//
// Each new UTC day the mayor opens Polytown unlocks the next step. Steps are
// claimed by hand, any time later. Miss a day and the track breaks: it stops
// advancing until the mayor resets it. Step 30 finishes it the same way.
// Resetting pays out every step still unclaimed and starts again at day 1.
//
// Coins and goods scale with the town, so the track is worth opening for a
// new village and for a city alike. Gems are fixed and kept scarce: a whole
// run is worth about 56 of them, chests included.
//
// Four days hand out an hour-long boost instead of goods, and chests can hold
// extras on top of their coins and goods: boosts, a free rush, a borrowed
// crew, a market day, or a lucky charge that upgrades the next chest.

import { randomFloat } from '../random'
import {
    TOWN_BOOST_MS,
    TOWN_MARKET_DAY_MS,
    TOWN_TEMP_BUILDER_MS,
    townBoostLabel,
    type TownBoostBag,
    type TownBoostKind
} from './town-boosts'
import {
    deriveTown,
    effectiveLevel,
    getTownBuilding,
    isBuilt,
    townFloorIncomePerDay,
    townFloorPrice,
    townTickRecipe,
    TOWN_TICK_MS,
    type TownResourceBag,
    type TownResourceId,
    type TownSimBuilding
} from './town'

export const TOWN_STREAK_DAYS = 30
const DAY_MS = 24 * 60 * 60_000

/** Days that get a bigger tile on the track. */
export const TOWN_STREAK_MILESTONES: readonly number[] = [7, 14, 21, 30]

// ─── Days ────────────────────────────────────────────────────────────────────

/** The UTC calendar day of `ms`, as 'YYYY-MM-DD'. */
export function townStreakDayKey(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10)
}

/** The day before a 'YYYY-MM-DD' key. */
export function townStreakYesterday(day: string): string {
    return townStreakDayKey(Date.parse(`${day}T00:00:00Z`) - DAY_MS)
}

/** When the next UTC day starts, in epoch ms. */
export function townStreakNextDayAt(ms: number): number {
    return (Math.floor(ms / DAY_MS) + 1) * DAY_MS
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type TownStreakStatus = 'active' | 'broken' | 'finished'

export interface TownStreakRow {
    step: number
    lastDay: string | null
}

/**
 * Active while the mayor has not missed a day. Broken once the last unlock is
 * older than yesterday. Finished at step 30. Neither broken nor finished ever
 * changes on its own: only a reset starts a new run.
 */
export function townStreakStatus(row: TownStreakRow | null | undefined, today: string): TownStreakStatus {
    if (!row) return 'active'
    if (row.step >= TOWN_STREAK_DAYS) return 'finished'
    if (!row.lastDay) return 'active'
    if (row.lastDay === today || row.lastDay === townStreakYesterday(today)) return 'active'
    return 'broken'
}

/** Whether opening the town today unlocks the next step. */
export function townStreakDue(row: TownStreakRow | null | undefined, today: string): boolean {
    if (!row) return true
    if (row.step >= TOWN_STREAK_DAYS) return false
    if (!row.lastDay) return true
    return row.lastDay === townStreakYesterday(today)
}

/** Whether the mayor may reset the track now. */
export function townStreakCanReset(row: TownStreakRow | null | undefined, today: string): boolean {
    if (!row) return false
    return townStreakStatus(row, today) !== 'active'
}

// ─── Claimed bitmask ─────────────────────────────────────────────────────────

/** Bit for a step in the claimed mask: step 1 is bit 0. */
export function townStreakBit(step: number): number {
    return 1 << (step - 1)
}

export function townStreakIsClaimed(claimed: number, step: number): boolean {
    return (claimed & townStreakBit(step)) !== 0
}

/** Steps set in the claimed mask, ascending. */
export function townStreakClaimedSteps(claimed: number): number[] {
    const out: number[] = []
    for (let s = 1; s <= TOWN_STREAK_DAYS; s++) if (townStreakIsClaimed(claimed, s)) out.push(s)
    return out
}

/** Unlocked steps not yet paid, ascending. */
export function townStreakClaimable(step: number, claimed: number): number[] {
    const out: number[] = []
    for (let s = 1; s <= Math.min(step, TOWN_STREAK_DAYS); s++) if (!townStreakIsClaimed(claimed, s)) out.push(s)
    return out
}

export function isValidTownStreakStep(step: unknown): step is number {
    return typeof step === 'number' && Number.isInteger(step) && step >= 1 && step <= TOWN_STREAK_DAYS
}

// ─── Track ───────────────────────────────────────────────────────────────────

export type TownStreakChest = 'wooden' | 'silver' | 'golden'
export type TownStreakKind = 'coins' | 'resources' | 'gems' | 'chest' | 'boost'

export type TownStreakStepDef
    = | { step: number, kind: 'coins', /** Share of a day's floor income. */ share: number }
      | { step: number, kind: 'resources', /** Hours of the town's output of one good. */ hours: number }
      | { step: number, kind: 'gems', gems: number }
      | { step: number, kind: 'chest', chest: TownStreakChest }
      | { step: number, kind: 'boost', boost: TownBoostKind }

/**
 * What a chest can hold on top of its coins and goods.
 *
 * - build / production: an hour of Builder's rush or Production surge
 * - instant: the longest running job (not a monument stage) finishes at once
 * - builder: a borrowed build crew for a day
 * - market: an hour of market day at the town hall
 * - lucky: the next chest opened is one tier better
 */
export type TownStreakExtraKind = 'build' | 'production' | 'instant' | 'builder' | 'market' | 'lucky'

export const TOWN_STREAK_EXTRA_KINDS: readonly TownStreakExtraKind[] = ['build', 'production', 'instant', 'builder', 'market', 'lucky']

export interface TownStreakExtra {
    kind: TownStreakExtraKind
    /** How long it lasts (build, production, builder, market). */
    ms?: number
    /** Instant: the building whose job was finished, its type and level, and the time it saved. Filled in when it is applied. */
    buildingId?: string
    type?: string
    level?: number
    savedMs?: number
    /** Market: coins of extra the town hall may pay out under this market day. Filled in when it is applied. */
    bonusCoins?: number
}

export interface TownStreakExtraTable {
    /** Independent rolls per chest. */
    slots: number
    /** Chance each slot holds an extra. */
    chance: number
    /** At least one extra, even when every slot misses. */
    guaranteed: boolean
    /** Relative odds of each extra, per slot that hits. */
    weights: Record<TownStreakExtraKind, number>
}

export interface TownStreakChestDef {
    id: TownStreakChest
    name: string
    /** Coins as a share of a day's floor income, rolled uniformly. */
    share: [number, number]
    /** Hours of output per good, rolled per good. */
    hours: [number, number]
    /** How many goods the chest holds when it holds goods. */
    goods: number
    /** Odds of coins only, goods only, or both. */
    mix: { coins: number, resources: number, both: number }
    gemChance: number
    gems: [number, number]
    extras: TownStreakExtraTable
}

export const TOWN_STREAK_CHESTS: Record<TownStreakChest, TownStreakChestDef> = {
    wooden: {
        id: 'wooden',
        name: 'Wooden chest',
        share: [0.3, 0.6],
        hours: [3, 6],
        goods: 1,
        mix: { coins: 0.35, resources: 0.35, both: 0.3 },
        gemChance: 1,
        gems: [1, 4],
        extras: {
            slots: 1,
            chance: 0.25,
            guaranteed: false,
            weights: { build: 30, production: 30, market: 15, builder: 10, instant: 10, lucky: 5 }
        }
    },
    silver: {
        id: 'silver',
        name: 'Silver chest',
        share: [0.6, 1.1],
        hours: [5, 9],
        goods: 2,
        mix: { coins: 0.2, resources: 0.2, both: 0.6 },
        gemChance: 1,
        gems: [3, 7],
        extras: {
            slots: 2,
            chance: 0.4,
            guaranteed: false,
            weights: { build: 25, production: 25, market: 15, builder: 15, instant: 12, lucky: 8 }
        }
    },
    golden: {
        id: 'golden',
        name: 'Golden chest',
        share: [1.2, 2.2],
        hours: [8, 14],
        goods: 3,
        mix: { coins: 0, resources: 0, both: 1 },
        gemChance: 1,
        gems: [10, 15],
        extras: {
            slots: 3,
            chance: 0.6,
            guaranteed: true,
            weights: { build: 18, production: 18, market: 16, builder: 18, instant: 18, lucky: 12 }
        }
    }
}

/** A lucky charge opens a chest one tier up; a golden one stays golden and pays half as much again. */
export const TOWN_STREAK_LUCKY_GOLDEN_MULTIPLIER = 1.5

export function townStreakLuckyChest(chest: TownStreakChest): { chest: TownStreakChest, multiplier: number } {
    if (chest === 'wooden') return { chest: 'silver', multiplier: 1 }
    if (chest === 'silver') return { chest: 'golden', multiplier: 1 }
    return { chest: 'golden', multiplier: TOWN_STREAK_LUCKY_GOLDEN_MULTIPLIER }
}

/** How long each timed extra lasts. */
export function townStreakExtraMs(kind: TownStreakExtraKind): number | undefined {
    switch (kind) {
        case 'build':
        case 'production': return TOWN_BOOST_MS
        case 'builder': return TOWN_TEMP_BUILDER_MS
        case 'market': return TOWN_MARKET_DAY_MS
        default: return undefined
    }
}

/** Chance a chest holds at least one extra. */
export function townStreakExtraChance(chest: TownStreakChest): number {
    const t = TOWN_STREAK_CHESTS[chest].extras
    return t.guaranteed ? 1 : 1 - Math.pow(1 - t.chance, t.slots)
}

/**
 * The 30 days. Coin shares climb from a tenth of a day's income to two
 * fifths; goods from two hours of output to seven. Chests land on the
 * milestone days and the golden one closes the run. Days 9 and 23 bring a
 * Builder's rush, days 12 and 26 a Production surge.
 */
export const TOWN_STREAK_TRACK: readonly TownStreakStepDef[] = [
    { step: 1, kind: 'coins', share: 0.1 },
    { step: 2, kind: 'resources', hours: 2 },
    { step: 3, kind: 'coins', share: 0.12 },
    { step: 4, kind: 'gems', gems: 2 },
    { step: 5, kind: 'resources', hours: 3 },
    { step: 6, kind: 'coins', share: 0.15 },
    { step: 7, kind: 'chest', chest: 'wooden' },
    { step: 8, kind: 'coins', share: 0.15 },
    { step: 9, kind: 'boost', boost: 'build' },
    { step: 10, kind: 'gems', gems: 3 },
    { step: 11, kind: 'coins', share: 0.18 },
    { step: 12, kind: 'boost', boost: 'production' },
    { step: 13, kind: 'coins', share: 0.2 },
    { step: 14, kind: 'chest', chest: 'silver' },
    { step: 15, kind: 'gems', gems: 4 },
    { step: 16, kind: 'coins', share: 0.22 },
    { step: 17, kind: 'resources', hours: 6 },
    { step: 18, kind: 'gems', gems: 5 },
    { step: 19, kind: 'resources', hours: 7 },
    { step: 20, kind: 'coins', share: 0.25 },
    { step: 21, kind: 'chest', chest: 'silver' },
    { step: 22, kind: 'coins', share: 0.28 },
    { step: 23, kind: 'boost', boost: 'build' },
    { step: 24, kind: 'coins', share: 0.3 },
    { step: 25, kind: 'gems', gems: 7 },
    { step: 26, kind: 'boost', boost: 'production' },
    { step: 27, kind: 'coins', share: 0.35 },
    { step: 28, kind: 'gems', gems: 10 },
    { step: 29, kind: 'coins', share: 0.4 },
    { step: 30, kind: 'chest', chest: 'golden' }
]

export function getTownStreakStep(step: number): TownStreakStepDef | undefined {
    return TOWN_STREAK_TRACK[step - 1]
}

export function townStreakLabel(def: TownStreakStepDef): string {
    switch (def.kind) {
        case 'coins': return 'Coin purse'
        case 'resources': return 'Supplies'
        case 'gems': return def.gems === 1 ? '1 gem' : `${def.gems} gems`
        case 'chest': return TOWN_STREAK_CHESTS[def.chest].name
        case 'boost': return townBoostLabel(def.boost)
    }
}

/** Gems a whole run pays on average, chests included. */
export function townStreakExpectedGems(): number {
    let total = 0
    for (const def of TOWN_STREAK_TRACK) {
        if (def.kind === 'gems') total += def.gems
        if (def.kind === 'chest') {
            const chest = TOWN_STREAK_CHESTS[def.chest]
            total += chest.gemChance * (chest.gems[0] + chest.gems[1]) / 2
        }
    }
    return total
}

/** The most gems a single run can pay. */
export function townStreakMaxGems(): number {
    let total = 0
    for (const def of TOWN_STREAK_TRACK) {
        if (def.kind === 'gems') total += def.gems
        if (def.kind === 'chest') total += TOWN_STREAK_CHESTS[def.chest].gems[1]
    }
    return total
}

// ─── Scaling ─────────────────────────────────────────────────────────────────

/**
 * The floor every coin reward is priced from. A fresh town with one farm earns
 * about 43k a day, so this keeps the first week worth claiming.
 */
export const TOWN_STREAK_MIN_INCOME_PER_DAY = 60_000

/** Goods a reward is worth at least, in coins per hour of "output". */
const MIN_VALUE_PER_HOUR = TOWN_STREAK_MIN_INCOME_PER_DAY / 24

/** What a town with nothing running is handed. */
const FALLBACK_GOODS: readonly TownResourceId[] = ['wheat', 'wood', 'stone']

/** Jewels convert into gems, so the track never hands them out. */
const EXCLUDED_GOODS: ReadonlySet<TownResourceId> = new Set(['jewels'])

export interface TownStreakScale {
    /** A day's floor income, never below TOWN_STREAK_MIN_INCOME_PER_DAY. */
    incomePerDay: number
    /** Gross output per hour of each good the town makes. */
    outputPerHour: TownResourceBag
}

/** Gross output per hour, per good, at current staffing and mood. */
export function townStreakOutputPerHour(buildings: TownSimBuilding[], happiness: number, now: number): TownResourceBag {
    const derived = deriveTown(buildings, happiness, now)
    const ticksPerHour = (60 * 60_000) / TOWN_TICK_MS * derived.speedMultiplier
    const out: TownResourceBag = {}
    for (const b of buildings) {
        if (!isBuilt(b, now)) continue
        const def = getTownBuilding(b.type)
        if (!def || def.kind !== 'industry') continue
        const recipe = townTickRecipe(def, effectiveLevel(b, now), derived.throughput.get(b.id) ?? 0)
        if (!recipe) continue
        for (const [id, qty] of Object.entries(recipe.outputs) as [TownResourceId, number][]) {
            out[id] = (out[id] ?? 0) + qty * ticksPerHour
        }
    }
    return out
}

export function townStreakScale(buildings: TownSimBuilding[], happiness: number, now: number): TownStreakScale {
    return {
        incomePerDay: Math.max(TOWN_STREAK_MIN_INCOME_PER_DAY, townFloorIncomePerDay(buildings, happiness, now)),
        outputPerHour: townStreakOutputPerHour(buildings, happiness, now)
    }
}

/** Goods a supplies reward can be drawn from: what the town makes, or the basics. */
export function townStreakGoods(scale: TownStreakScale): TownResourceId[] {
    const made = (Object.entries(scale.outputPerHour) as [TownResourceId, number][])
        .filter(([id, rate]) => rate > 0 && !EXCLUDED_GOODS.has(id))
        .map(([id]) => id)
    return made.length ? made : [...FALLBACK_GOODS]
}

export function townStreakCoins(scale: TownStreakScale, share: number): number {
    return Math.max(1, Math.round(scale.incomePerDay * share))
}

/** `hours` of the town's output of one good, with a floor so a slow good is still worth it. */
export function townStreakGoodAmount(scale: TownStreakScale, good: TownResourceId, hours: number): number {
    const rate = scale.outputPerHour[good] ?? 0
    const floor = Math.floor(hours * MIN_VALUE_PER_HOUR / townFloorPrice(good))
    return Math.max(1, Math.round(rate * hours), floor)
}

// ─── Rolling ─────────────────────────────────────────────────────────────────

export type TownStreakRng = () => number

function between(rng: TownStreakRng, min: number, max: number): number {
    return min + rng() * (max - min)
}

function intBetween(rng: TownStreakRng, min: number, max: number): number {
    return min + Math.floor(rng() * (max - min + 1))
}

function pick<T>(rng: TownStreakRng, items: readonly T[]): T {
    return items[Math.floor(rng() * items.length)]!
}

export interface TownStreakReward {
    step: number
    coins: number
    gems: number
    resources: TownResourceBag
    /** The tier the chest opened as (after a lucky upgrade). */
    chest?: TownStreakChest
    /** Set when a lucky charge upgraded this chest: the tier it was before. */
    upgradedFrom?: TownStreakChest
    /** Boost time this reward starts, in ms: a boost day's, plus any boost extras in a chest. */
    boosts?: TownBoostBag
    /** A chest's extras, one per slot that hit. Build and production extras are also summed into `boosts`. */
    extras?: TownStreakExtra[]
}

export interface TownStreakChestOptions {
    /** Lucky golden chests pay their coins, goods and gems this many times over. */
    multiplier?: number
    /** Running jobs (not monument stages) an instant finish could complete; it is never rolled past this. */
    instantJobs?: number
}

function pickExtra(rng: TownStreakRng, weights: Record<TownStreakExtraKind, number>, instantLeft: number): TownStreakExtraKind {
    const kinds = TOWN_STREAK_EXTRA_KINDS.filter(k => weights[k] > 0 && (k !== 'instant' || instantLeft > 0))
    const total = kinds.reduce((sum, k) => sum + weights[k], 0)
    let roll = rng() * total
    for (const k of kinds) {
        roll -= weights[k]
        if (roll < 0) return k
    }
    return kinds[kinds.length - 1]!
}

/**
 * Roll a chest's extras: each slot hits on its own, a golden chest always
 * holds one, and an instant finish is only picked while a job is left for it.
 */
export function rollTownStreakExtras(chest: TownStreakChest, rng: TownStreakRng = randomFloat, instantJobs = 0): TownStreakExtra[] {
    const table = TOWN_STREAK_CHESTS[chest].extras
    let hits = 0
    for (let i = 0; i < table.slots; i++) if (rng() < table.chance) hits++
    if (hits === 0 && table.guaranteed) hits = 1
    const extras: TownStreakExtra[] = []
    let instantLeft = instantJobs
    for (let i = 0; i < hits; i++) {
        const kind = pickExtra(rng, table.weights, instantLeft)
        if (kind === 'instant') instantLeft--
        const ms = townStreakExtraMs(kind)
        extras.push(ms === undefined ? { kind } : { kind, ms })
    }
    return extras
}

/** Build and production time in a list of extras. */
export function townStreakExtraBoosts(extras: readonly TownStreakExtra[]): TownBoostBag | undefined {
    const bag: TownBoostBag = {}
    for (const e of extras) {
        if (e.kind === 'build' || e.kind === 'production') bag[e.kind] = (bag[e.kind] ?? 0) + (e.ms ?? 0)
    }
    return Object.keys(bag).length ? bag : undefined
}

function addGood(bag: TownResourceBag, id: TownResourceId, qty: number) {
    bag[id] = (bag[id] ?? 0) + qty
}

export function rollTownStreakChest(chest: TownStreakChest, scale: TownStreakScale, rng: TownStreakRng = randomFloat, options: TownStreakChestOptions = {}): Omit<TownStreakReward, 'step'> {
    const def = TOWN_STREAK_CHESTS[chest]
    const m = options.multiplier ?? 1
    const total = def.mix.coins + def.mix.resources + def.mix.both
    const roll = rng() * total
    const mix = roll < def.mix.coins ? 'coins' : roll < def.mix.coins + def.mix.resources ? 'resources' : 'both'

    const coins = mix === 'resources' ? 0 : townStreakCoins(scale, between(rng, def.share[0], def.share[1]))
    const resources: TownResourceBag = {}
    if (mix !== 'coins') {
        const goods = townStreakGoods(scale)
        for (let i = 0; i < def.goods; i++) {
            const good = pick(rng, goods)
            addGood(resources, good, townStreakGoodAmount(scale, good, intBetween(rng, def.hours[0], def.hours[1])))
        }
    }
    const gems = rng() < def.gemChance ? intBetween(rng, def.gems[0], def.gems[1]) : 0
    // Rolled last, so the coins, goods and gems draw the same numbers they always did.
    const extras = rollTownStreakExtras(chest, rng, options.instantJobs ?? 0)
    if (m !== 1) {
        for (const id of Object.keys(resources) as TownResourceId[]) resources[id] = Math.round(resources[id]! * m)
    }
    const reward: Omit<TownStreakReward, 'step'> = {
        coins: Math.round(coins * m),
        gems: Math.round(gems * m),
        resources,
        chest,
        extras
    }
    const boosts = townStreakExtraBoosts(extras)
    if (boosts) reward.boosts = boosts
    return reward
}

/** What claiming `def` pays this town. Chests roll here, at claim time. */
export function rollTownStreakReward(def: TownStreakStepDef, scale: TownStreakScale, rng: TownStreakRng = randomFloat, options: TownStreakChestOptions = {}): TownStreakReward {
    switch (def.kind) {
        case 'coins':
            return { step: def.step, coins: townStreakCoins(scale, def.share), gems: 0, resources: {} }
        case 'gems':
            return { step: def.step, coins: 0, gems: def.gems, resources: {} }
        case 'resources': {
            const good = pick(rng, townStreakGoods(scale))
            return { step: def.step, coins: 0, gems: 0, resources: { [good]: townStreakGoodAmount(scale, good, def.hours) } }
        }
        case 'chest':
            return { step: def.step, ...rollTownStreakChest(def.chest, scale, rng, options) }
        case 'boost':
            return { step: def.step, coins: 0, gems: 0, resources: {}, boosts: { [def.boost]: TOWN_BOOST_MS } }
    }
}

// ─── Locking ─────────────────────────────────────────────────────────────────
// A step's worth is fixed the day it unlocks: the town's scale is stored with
// it, and every step but a chest is rolled outright. Claiming later pays what
// was locked, so building up the town (or propping up its income for a day)
// and then claiming a backlog of steps pays no more than claiming on time.

export interface TownStreakLock {
    scale: TownStreakScale
    /** The exact payout, fixed at unlock. Absent for a chest, which rolls on opening from `scale`. */
    reward?: Omit<TownStreakReward, 'step'>
}

/** What a step is worth, locked in on the day it unlocks. */
export function lockTownStreakStep(def: TownStreakStepDef, scale: TownStreakScale, rng: TownStreakRng = randomFloat): TownStreakLock {
    if (def.kind === 'chest') return { scale }
    const { step: _step, ...reward } = rollTownStreakReward(def, scale, rng)
    return { scale, reward }
}

export interface TownStreakClaimOptions {
    /** A lucky charge was spent on this chest. */
    lucky?: boolean
    /** Running jobs an instant finish could complete. */
    instantJobs?: number
}

/**
 * What claiming a step pays: its locked reward, or a chest rolled from its
 * locked scale. A step unlocked before locking existed falls back to `scale`.
 * A lucky chest opens a tier up, with that tier's contents and extras.
 */
export function claimTownStreakReward(
    def: TownStreakStepDef,
    lock: TownStreakLock | undefined,
    scale: TownStreakScale,
    rng: TownStreakRng = randomFloat,
    options: TownStreakClaimOptions = {}
): TownStreakReward {
    if (lock?.reward) return { step: def.step, ...lock.reward }
    const from = lock?.scale ?? scale
    if (def.kind === 'chest') {
        const lucky = options.lucky ? townStreakLuckyChest(def.chest) : null
        const reward = rollTownStreakChest(lucky?.chest ?? def.chest, from, rng, { multiplier: lucky?.multiplier, instantJobs: options.instantJobs })
        return lucky ? { step: def.step, ...reward, upgradedFrom: def.chest } : { step: def.step, ...reward }
    }
    return rollTownStreakReward(def, from, rng)
}

/** Whether claiming `def` with this lock opens a chest (and so can spend a lucky charge). */
export function townStreakOpensChest(def: TownStreakStepDef, lock: TownStreakLock | undefined): boolean {
    return def.kind === 'chest' && !lock?.reward
}

/** Sum of several rewards: what a reset paid in one go. Boost time adds up; extras are listed in order. */
export function sumTownStreakRewards(rewards: readonly TownStreakReward[]): { coins: number, gems: number, resources: TownResourceBag, boosts: TownBoostBag, extras: TownStreakExtra[] } {
    const resources: TownResourceBag = {}
    const boosts: TownBoostBag = {}
    const extras: TownStreakExtra[] = []
    let coins = 0
    let gems = 0
    for (const r of rewards) {
        coins += r.coins
        gems += r.gems
        for (const [id, qty] of Object.entries(r.resources) as [TownResourceId, number][]) addGood(resources, id, qty)
        for (const [kind, ms] of Object.entries(r.boosts ?? {}) as [TownBoostKind, number][]) boosts[kind] = (boosts[kind] ?? 0) + ms
        if (r.extras) extras.push(...r.extras)
    }
    return { coins, gems, resources, boosts, extras }
}

// ─── Preview ─────────────────────────────────────────────────────────────────

export interface TownStreakPreview {
    step: number
    kind: TownStreakKind
    label: string
    milestone: boolean
    chest: TownStreakChest | null
    /** Coin range; equal ends for a fixed amount. Null when the step pays no coins. */
    coins: [number, number] | null
    /** Chance coins are in it (1 unless it is a chest). */
    coinChance: number
    gems: [number, number] | null
    gemChance: number
    /** Goods it can hold, each with the range one draw of it pays. */
    resources: Record<string, [number, number]> | null
    resourceChance: number
    /** Hours of output per good drawn. */
    hours: [number, number] | null
    /** How many goods are drawn. */
    picks: number
    /** Amounts were locked in when the step unlocked; otherwise they follow the town as it is now. */
    fixed: boolean
    /** A boost day: which boost, and how long it runs. */
    boost: TownBoostKind | null
    boostMs: number | null
    /** A chest: how many extra slots it rolls, and the chance it holds at least one extra. */
    extraSlots: number
    extraChance: number
}

export function townStreakPreview(def: TownStreakStepDef, current: TownStreakScale, lock?: TownStreakLock): TownStreakPreview {
    const scale = lock?.scale ?? current
    const base = {
        step: def.step,
        kind: def.kind,
        label: townStreakLabel(def),
        milestone: TOWN_STREAK_MILESTONES.includes(def.step),
        chest: null,
        coins: null,
        coinChance: 0,
        gems: null,
        gemChance: 0,
        resources: null,
        resourceChance: 0,
        hours: null,
        picks: 0,
        fixed: !!lock,
        boost: def.kind === 'boost' ? def.boost : null,
        boostMs: def.kind === 'boost' ? TOWN_BOOST_MS : null,
        extraSlots: 0,
        extraChance: 0
    }
    if (lock?.reward) {
        const r = lock.reward
        const goods = Object.entries(r.resources) as [TownResourceId, number][]
        return {
            ...base,
            coins: r.coins ? [r.coins, r.coins] : null,
            coinChance: r.coins ? 1 : 0,
            gems: r.gems ? [r.gems, r.gems] : null,
            gemChance: r.gems ? 1 : 0,
            resources: goods.length ? Object.fromEntries(goods.map(([id, q]) => [id, [q, q] as [number, number]])) : null,
            resourceChance: goods.length ? 1 : 0,
            hours: def.kind === 'resources' ? [def.hours, def.hours] : null,
            picks: goods.length
        }
    }
    const goodsRange = (hours: [number, number]) => Object.fromEntries(townStreakGoods(scale).map(g => [
        g,
        [townStreakGoodAmount(scale, g, hours[0]), townStreakGoodAmount(scale, g, hours[1])] as [number, number]
    ]))
    switch (def.kind) {
        case 'coins': {
            const coins = townStreakCoins(scale, def.share)
            return { ...base, coins: [coins, coins], coinChance: 1 }
        }
        case 'gems':
            return { ...base, gems: [def.gems, def.gems], gemChance: 1 }
        case 'boost':
            return base
        case 'resources':
            return { ...base, resources: goodsRange([def.hours, def.hours]), resourceChance: 1, hours: [def.hours, def.hours] as [number, number], picks: 1 }
        case 'chest': {
            const c = TOWN_STREAK_CHESTS[def.chest]
            const total = c.mix.coins + c.mix.resources + c.mix.both
            return {
                ...base,
                chest: def.chest,
                coins: [townStreakCoins(scale, c.share[0]), townStreakCoins(scale, c.share[1])],
                coinChance: (c.mix.coins + c.mix.both) / total,
                gems: [c.gems[0], c.gems[1]],
                gemChance: c.gemChance,
                resources: goodsRange(c.hours),
                resourceChance: (c.mix.resources + c.mix.both) / total,
                hours: c.hours,
                picks: c.goods,
                extraSlots: c.extras.slots,
                extraChance: townStreakExtraChance(def.chest)
            }
        }
    }
}
