/**
 * Raid rules (`raid-system.md`): what a clear pays, how Keys come in, and the Training Grounds
 * dummy's round and ladder. Pure; the server applies all of it under the raid row's lock.
 *
 * A Key is spent exactly when a reward is paid (§3). The dummy can't be beaten, so every run of it
 * pays, from level 1, and spends its Key on entry.
 */

import {
    PRESTIGE_INDEX_STEPS,
    RAID_DUMMY_PACKS,
    RAID_DUMMY_SECONDS,
    RAID_DUMMY_STAGES_PER_LEVEL,
    RAID_DIG_ADD_HP_MULT,
    RAID_DIG_ADD_SECONDS,
    RAID_DIG_BURROWS,
    RAID_DIG_HP_MULT,
    RAID_DIG_PWR_MULT,
    RAID_DIG_STAGES_PER_LEVEL,
    RAID_ENRAGE_SECONDS,
    RAID_FORGE_BOSS_STEPS,
    RAID_FORGE_HANDOFF_SECONDS,
    RAID_FORGE_HP_MULT,
    RAID_FORGE_KILL_SECONDS,
    RAID_FORGE_PWR_MULT,
    RAID_FORGE_STAGES_PER_LEVEL,
    RAID_RAMPAGE_CAP_SECONDS,
    RAID_RAMPAGE_DMG_MULT,
    RAID_RAMPAGE_POWER_MULT,
    RAID_RAMPAGE_STAGES_PER_LEVEL,
    RAID_KNIGHT_HP_MULT,
    RAID_KNIGHT_PWR_MULT,
    RAID_KNIGHT_STAGES_PER_LEVEL,
    RAID_KEY_BANK_DAYS,
    RAID_KEYS_PER_DAY,
    RAID_REWARD_BASE,
    RAID_REWARD_GROWTH,
    RAID_REWARD_SHAPE,
    RAID_REWARD_STEP_LEVELS,
    STAGES_PER_WORLD
} from './constants'
import { D, ZERO, type Decimal } from './numbers'
import { bossMinionStats, enemyPackAt, enemyStatsAt, packHp } from './settle'
import { runFight, type FightEvent, type FightResult } from './fight'
import type { EnemyPack, EnemyStats, HeroSnapshot, RunPosition } from './types'
import type { RaidId } from './content/raids'

const DAY_MS = 86_400_000

// ── Rewards ────────────────────────────────────────────────────────────────────────

/** What a clear at `level` pays, in the raid's own currency, on the shape `RAID_REWARD_SHAPE` picks. */
export function raidReward(raid: RaidId, level: number, shape: 'exponential' | 'stepped' = RAID_REWARD_SHAPE): number {
    const l = Math.max(1, Math.floor(level))
    const base = RAID_REWARD_BASE[raid] ?? 0
    if (shape === 'stepped') return base + Math.floor((l - 1) / RAID_REWARD_STEP_LEVELS)
    return Math.round(base * (RAID_REWARD_GROWTH[raid] ?? 1) ** (l - 1))
}

// ── Keys ───────────────────────────────────────────────────────────────────────────

/** How many Keys a raid can bank. */
export const RAID_KEY_CAP = RAID_KEYS_PER_DAY * RAID_KEY_BANK_DAYS

/**
 * The daily Key grant, applied lazily (§3): a day's Keys for every whole day since the last grant,
 * up to the bank. The grant clock advances by the days granted, keeping its time of day, so a read
 * never loses the part-day toward the next grant; at the cap it simply moves on.
 *
 * The cap stops the grant, nothing else: Keys from elsewhere (a reward, an event) can stand above it,
 * and the grant then adds nothing rather than taking them back down to it.
 */
export function grantKeys(balance: number, lastGrantAt: number, now: number): { balance: number, lastGrantAt: number } {
    const days = Math.max(0, Math.floor((now - lastGrantAt) / DAY_MS))
    if (days === 0) return { balance, lastGrantAt }
    const held = Math.max(0, balance)
    return {
        balance: held >= RAID_KEY_CAP ? held : Math.min(RAID_KEY_CAP, held + days * RAID_KEYS_PER_DAY),
        lastGrantAt: lastGrantAt + days * DAY_MS
    }
}

/** When the next day's Keys arrive. */
export function nextKeyGrantAt(lastGrantAt: number): number {
    return lastGrantAt + DAY_MS
}

// ── The Training Grounds dummy ─────────────────────────────────────────────────────

/** Effectively endless: no party at any depth gets it down within a round. */
const DUMMY_HP = D('1e1000000')

/** The dummy as a pack: one body that can't fall, has no DEF to get through and never swings. */
export function dummyPack(): EnemyPack {
    return { members: [{ hp: DUMMY_HP, pwr: ZERO, def: ZERO }] }
}

/** The run position at curve index `n`: the world-and-stage the dummy's level `n` stands for. */
function positionAt(n: number): RunPosition {
    const prestige = Math.floor(n / PRESTIGE_INDEX_STEPS)
    const within = n - prestige * PRESTIGE_INDEX_STEPS
    return { prestige, world: Math.floor(within / STAGES_PER_WORLD) + 1, stage: (within % STAGES_PER_WORLD) + 1, killsInStage: 0 }
}

/**
 * The damage it takes to bring the dummy to `level` within one round: `RAID_DUMMY_PACKS` wave
 * packs of the stage the level stands for. Level 1 takes none: every run reaches it.
 */
export function dummyThreshold(level: number): Decimal {
    if (level <= 1) return ZERO
    return packHp(enemyPackAt(positionAt((level - 1) * RAID_DUMMY_STAGES_PER_LEVEL))).mul(RAID_DUMMY_PACKS)
}

/**
 * The level a round's damage reaches. The thresholds grow by one fixed factor a level (the enemy
 * HP curve over a world), so it is a logarithm, nudged a step either way against float rounding.
 */
export function dummyLevelFor(damage: Decimal): number {
    const second = dummyThreshold(2)
    if (damage.lt(second)) return 1
    const growth = dummyThreshold(3).div(second)
    let level = 2 + Math.floor(damage.div(second).log10().div(growth.log10()).toNumber())
    while (level > 1 && damage.lt(dummyThreshold(level))) level--
    while (damage.gte(dummyThreshold(level + 1))) level++
    return level
}

export interface DummyRound {
    fight: FightResult
    /** All the damage the party landed, a Decimal. */
    damage: Decimal
    /** The level it reached, at least 1. */
    level: number
}

/**
 * The damage a fight log shows landing on the enemy side: every hit and every tick of a damage
 * over time. Summed from the events, never read off the dummy's HP: next to an HP that size a
 * round's damage is below the last digit a Decimal keeps, so the difference would read as zero.
 * The replay sums the same events for its running tally, up to the moment it has played.
 */
export function damageDealt(events: readonly FightEvent[], upTo = Infinity): Decimal {
    let total = ZERO
    for (const event of events) {
        if (event.at > upTo) break
        if (landsOnEnemy(event)) total = total.add(D(event.damage!))
    }
    return total
}

/** Whether an event is damage landing on the enemy side: a hit, or a tick of a damage over time. */
export function landsOnEnemy(event: FightEvent): boolean {
    if (!event.damage) return false
    return event.kind === 'status_tick' ? event.onEnemy === true : (event.kind === 'attack' || event.kind === 'skill') && event.enemyIndex !== undefined
}

/** One Training Grounds round, seeded: the party against the dummy for `RAID_DUMMY_SECONDS`. */
export function runDummyRound(hero: HeroSnapshot, position: RunPosition, seed: number): DummyRound {
    const fight = runFight({ hero, position, seed, encounter: { pack: dummyPack(), seconds: RAID_DUMMY_SECONDS, passive: true } })
    const damage = damageDealt(fight.events)
    return { fight, damage, level: dummyLevelFor(damage) }
}

// ── The Gilded Knight ──────────────────────────────────────────────────────────────

/**
 * The Gilded Knight at a level: world L's super boss, on its own, scaled. Its stage stands at the
 * end of world L on the curve, so a level is a world of growth, the same pace as the dummy's.
 */
export function knightStats(level: number): EnemyStats {
    const l = Math.max(1, Math.floor(level))
    const boss = enemyStatsAt(positionAt((l - 1) * RAID_KNIGHT_STAGES_PER_LEVEL + RAID_KNIGHT_STAGES_PER_LEVEL - 1))
    return { hp: boss.hp.mul(RAID_KNIGHT_HP_MULT), pwr: boss.pwr.mul(RAID_KNIGHT_PWR_MULT), def: boss.def }
}

/** The level a solo-boss raid fights next: one past the best cleared (§2's "progress"; farming is quick-clear). */
export function nextRaidLevel(best: number): number {
    return Math.max(0, Math.floor(best)) + 1
}

/** One Gilded Knight fight, seeded: the party against the Knight at `level` on the enrage clock. */
export function runKnightFight(hero: HeroSnapshot, position: RunPosition, seed: number, level: number): FightResult {
    return runFight({ hero, position, seed, encounter: { pack: { members: [knightStats(level)] }, seconds: RAID_ENRAGE_SECONDS } })
}

// ── The Dig Site ───────────────────────────────────────────────────────────────────

/** The Deepcoil at a level, and the adds its burrows send up: world L's super boss and its ordinary mobs. */
export function digSiteStats(level: number): { boss: EnemyStats, add: EnemyStats } {
    const l = Math.max(1, Math.floor(level))
    const pos = positionAt((l - 1) * RAID_DIG_STAGES_PER_LEVEL + RAID_DIG_STAGES_PER_LEVEL - 1)
    const boss = enemyStatsAt(pos)
    const add = bossMinionStats(pos)
    return {
        boss: { hp: boss.hp.mul(RAID_DIG_HP_MULT), pwr: boss.pwr.mul(RAID_DIG_PWR_MULT), def: boss.def },
        add: { ...add, hp: add.hp.mul(RAID_DIG_ADD_HP_MULT) }
    }
}

/** One Dig Site fight, seeded: the Deepcoil at `level`, its adds coming up on their timer, on the enrage clock. */
export function runDigSiteFight(hero: HeroSnapshot, position: RunPosition, seed: number, level: number): FightResult {
    const { boss, add } = digSiteStats(level)
    return runFight({
        hero,
        position,
        seed,
        encounter: {
            pack: { members: [boss] },
            seconds: RAID_ENRAGE_SECONDS,
            reinforcements: { every: RAID_DIG_ADD_SECONDS, members: Array.from({ length: RAID_DIG_BURROWS }, () => add) }
        }
    })
}

// ── God's Forge ────────────────────────────────────────────────────────────────────

/** The Forge's three bosses at a level, in the order they walk out: each a step up from the last. */
export function forgeStats(level: number): EnemyStats[] {
    const l = Math.max(1, Math.floor(level))
    const base = enemyStatsAt(positionAt((l - 1) * RAID_FORGE_STAGES_PER_LEVEL + RAID_FORGE_STAGES_PER_LEVEL - 1))
    return RAID_FORGE_BOSS_STEPS.map(step => ({
        hp: base.hp.mul(RAID_FORGE_HP_MULT * step),
        pwr: base.pwr.mul(RAID_FORGE_PWR_MULT * step),
        def: base.def
    }))
}

/** One God's Forge run, seeded: the three bosses back to back on one clock that each kill extends. */
export function runForgeFight(hero: HeroSnapshot, position: RunPosition, seed: number, level: number): FightResult {
    return runFight({
        hero,
        position,
        seed,
        encounter: {
            pack: { members: forgeStats(level) },
            seconds: RAID_ENRAGE_SECONDS,
            gauntlet: { handoff: RAID_FORGE_HANDOFF_SECONDS, bonusSeconds: RAID_FORGE_KILL_SECONDS }
        }
    })
}

// ── Shardcaller Beast ──────────────────────────────────────────────────────────────

function rampageBoss(level: number): EnemyStats {
    const l = Math.max(1, Math.floor(level))
    return enemyStatsAt(positionAt((l - 1) * RAID_RAMPAGE_STAGES_PER_LEVEL + RAID_RAMPAGE_STAGES_PER_LEVEL - 1))
}

/** The damage that takes the Beast from `level` to the next (incremental: it starts over each level). */
export function rampageThreshold(level: number): Decimal {
    return rampageBoss(level).hp.mul(RAID_RAMPAGE_DMG_MULT)
}

/** The Beast's PWR and DEF at a level; its HP is the gauge, `rampageThreshold`. */
export function rampageStats(level: number): EnemyStats {
    const boss = rampageBoss(level)
    return { hp: rampageThreshold(level), pwr: boss.pwr.mul(RAID_RAMPAGE_POWER_MULT), def: boss.def }
}

/** One Shardcaller Beast run, seeded: from level 1 until the party falls. */
export function runRampageFight(hero: HeroSnapshot, position: RunPosition, seed: number): FightResult {
    return runFight({
        hero,
        position,
        seed,
        encounter: {
            pack: { members: [rampageStats(1)] },
            seconds: RAID_RAMPAGE_CAP_SECONDS,
            rampage: { thresholdAt: rampageThreshold, statsAt: rampageStats }
        }
    })
}

/** The level a rampage run reached: its last level-up, or 1. */
export function rampageLevelReached(fight: FightResult): number {
    let level = 1
    for (const event of fight.events) if (event.kind === 'enemy_level' && event.level !== undefined) level = event.level
    return level
}
