/**
 * Prints the SHAPEZZ balance grid. `bun scripts/shapezz-balance.ts`
 *
 * SHAPEZZ pays nothing for showing up: every coin comes off a killed shape, and
 * the run ends when the arena outgrows the player's damage. That coupling is
 * what the other three run-games are measured against, so this script exists
 * mostly to state the reference numbers in the same shape as theirs.
 *
 * The survival model is a throughput one and is deliberately simple: a run
 * lasts as long as the build can kill shapes at least as fast as they spawn.
 * Once spawn rate outruns kill rate the arena fills, the player is cornered and
 * the run is over inside a checkpoint. That is not how a human dies in every
 * run, but it is what decides the *ceiling* of a build, which is the thing the
 * economy is priced against.
 */

import {
    INVESTMENT_TIERS, coins, compact, heading, pad, padRight, printTargets, rule, verdict
} from './lib/balance-report'
import {
    SHAPEZZ_CHECKPOINT_MS, SHAPEZZ_COMBAT_LIMITS, SHAPEZZ_DIFFICULTIES, SHAPEZZ_MAX_KILL_HEAL_LEVEL,
    SHAPEZZ_MAX_PERMANENT_LEVEL, SHAPEZZ_PERMANENT_UPGRADES, SHAPEZZ_PERMANENT_UPGRADE_IDS,
    SHAPEZZ_WEAPONS, shapezzCheckpointPressure, shapezzEnemyCoinValue, shapezzEnemyHealthMultiplier,
    shapezzDifficulty, shapezzIntensity, shapezzMaxPayoutForRun, shapezzPermanentUpgradeCost, shapezzPlayerStats,
    shapezzWeapon, shapezzWeaponPointBlankDps,
    type ShapezzDifficultyId, type ShapezzPermanentUpgradeId, type ShapezzWeapon
} from '../shared/utils/gamelogic/shapezz'

const STEP_MS = 1_000
const RUN_CAP_MS = 20 * 60_000

/** Enemy mix from `ShapezzEngine.spawnEnemy`, weighted by its roll thresholds. */
const ENEMY_MIX = [
    { share: 0.44, hp: 38, damage: 13, reward: 15 },
    { share: 0.26, hp: 52, damage: 10, reward: 22 },
    { share: 0.18, hp: 62, damage: 18, reward: 30 },
    { share: 0.12, hp: 155, damage: 22, reward: 50 }
] as const

/**
 * Share of a shape's contact damage that actually lands. The player is mobile
 * and most of the arena is empty, so the great majority of what the crowd
 * theoretically deals never connects — but the fraction that does is what makes
 * a crowd lethal once kill throughput falls behind spawn rate.
 */
const CONTACT_RATE = 0.06
/** Seconds between contact ticks on a shape that is on top of the player. */
const CONTACT_INTERVAL = 1.1
/**
 * Effective damage gained per accepted checkpoint mutation. The arena's health
 * ramp is 1.28x per mutation, and the pool is stacked with multiplicative picks
 * (orbitals, ceiling batteries, extra projectiles, chains) — so a player taking
 * offence keeps slightly ahead of it, and the run ends on the damage they are
 * taking rather than on the damage they are dealing.
 */
const MUTATION_DAMAGE_GAIN = 1.3

/**
 * What fraction of theoretical point-blank DPS actually lands. SHAPEZZ is a
 * twin-stick game with travel time and a moving player, so this is lower than
 * the FIREWALL equivalent — the gun is not always pointed at something.
 */
const PLAYER_UPTIME = 0.6

type Levels = Record<ShapezzPermanentUpgradeId, number>

function emptyLevels(): Levels {
    return Object.fromEntries(SHAPEZZ_PERMANENT_UPGRADE_IDS.map(id => [id, 0])) as Levels
}

// ─── Permanent tree ─────────────────────────────────────────────────────────

/** Every permanent level plus the single most expensive weapon — the full coin sink. */
function treeCost() {
    let total = 0
    for (const id of SHAPEZZ_PERMANENT_UPGRADE_IDS) {
        for (let level = 0; level < SHAPEZZ_PERMANENT_UPGRADES[id].maxLevel; level++) {
            total += shapezzPermanentUpgradeCost(id, level) ?? 0
        }
    }
    return total + Math.max(...SHAPEZZ_WEAPONS.map(weapon => weapon.cost))
}

/** Cheapest-first spend of a coin budget across levels and weapon rarities. */
function buildForShare(share: number): { levels: Levels, weapon: ShapezzWeapon, spent: number } {
    const budget = treeCost() * share
    const levels = emptyLevels()
    // The weapon is bought outright rather than upgraded through, so it competes
    // with levels for the same budget at its own full price.
    const weapons = [...SHAPEZZ_WEAPONS].sort((a, b) => a.cost - b.cost)
    let weapon = shapezzWeapon('blaster', 'common')
    let spent = 0
    for (;;) {
        let best: { buy: () => void, cost: number } | null = null
        for (const id of SHAPEZZ_PERMANENT_UPGRADE_IDS) {
            const cost = shapezzPermanentUpgradeCost(id, levels[id])
            if (cost === null) continue
            if (!best || cost < best.cost) best = { cost, buy: () => { levels[id]++ } }
        }
        const nextWeapon = weapons.find(candidate => candidate.cost > weapon.cost)
        if (nextWeapon) {
            const cost = nextWeapon.cost - weapon.cost
            if (!best || cost < best.cost) best = { cost, buy: () => { weapon = nextWeapon } }
        }
        if (!best || spent + best.cost > budget) break
        best.buy()
        spent += best.cost
    }
    return { levels, weapon, spent }
}

// ─── Run model ──────────────────────────────────────────────────────────────

function playerDps(levels: Levels, weapon: ShapezzWeapon) {
    const stats = shapezzPlayerStats(levels)
    return stats.damage * shapezzWeaponPointBlankDps(weapon, stats.fireRate) * PLAYER_UPTIME
}

/** Spawns per second, mirroring the engine's burst count over its cooldown. */
function spawnRate(elapsedMs: number, difficultyId: ShapezzDifficultyId) {
    const pressure = shapezzCheckpointPressure(Math.floor(elapsedMs / SHAPEZZ_CHECKPOINT_MS))
    const intensity = shapezzIntensity(elapsedMs, difficultyId) * pressure.population
    const burst = Math.min(4, 1 + Math.floor(intensity / 2.4))
    return burst / Math.max(0.11, Math.min(0.72, 0.72 / intensity))
}

function averageEnemyHp(elapsedMs: number, difficultyId: ShapezzDifficultyId) {
    const health = shapezzEnemyHealthMultiplier(elapsedMs, difficultyId)
        * shapezzCheckpointPressure(Math.floor(elapsedMs / SHAPEZZ_CHECKPOINT_MS)).health
    return ENEMY_MIX.reduce((sum, tier) => sum + tier.share * tier.hp, 0) * health
}

function averageEnemyDamage(elapsedMs: number, difficultyId: ShapezzDifficultyId) {
    const pressure = shapezzCheckpointPressure(Math.floor(elapsedMs / SHAPEZZ_CHECKPOINT_MS))
    const minutes = elapsedMs / 60_000
    return ENEMY_MIX.reduce((sum, tier) => sum + tier.share * tier.damage, 0)
        * shapezzDifficulty(difficultyId).enemyDamage
        * (1 + minutes * 0.1)
        * pressure.damage
}

function averageEnemyCoin(elapsedMs: number, difficultyId: ShapezzDifficultyId) {
    return ENEMY_MIX.reduce(
        (sum, tier) => sum + tier.share * shapezzEnemyCoinValue(tier.reward, elapsedMs, difficultyId),
        0
    )
}

interface RunResult { elapsedMs: number, coins: number, banked: number, checkpoints: number }

/**
 * Tracks the crowd and the health bar together. Kill throughput that falls
 * behind spawn rate does not end a run on its own — it grows the crowd, the
 * crowd raises incoming damage, and the run ends when the health bar does.
 */
function simulateRun(levels: Levels, weapon: ShapezzWeapon, difficultyId: ShapezzDifficultyId): RunResult {
    const dps = playerDps(levels, weapon)
    const stats = shapezzPlayerStats(levels)
    let hp = stats.maxHp
    let alive = 0
    let elapsedMs = 0
    let collected = 0
    while (elapsedMs < RUN_CAP_MS && hp > 0) {
        const seconds = STEP_MS / 1000
        alive = Math.min(SHAPEZZ_COMBAT_LIMITS.enemies, alive + spawnRate(elapsedMs, difficultyId) * seconds)
        const mutations = Math.floor(elapsedMs / SHAPEZZ_CHECKPOINT_MS)
        const effectiveDps = dps * Math.pow(MUTATION_DAMAGE_GAIN, mutations)
        const kills = Math.min(alive, (effectiveDps / averageEnemyHp(elapsedMs, difficultyId)) * seconds)
        alive -= kills
        collected += kills * averageEnemyCoin(elapsedMs, difficultyId)
        hp = Math.min(
            stats.maxHp,
            hp
            + kills * stats.healthPerKill
            - alive * averageEnemyDamage(elapsedMs, difficultyId) * CONTACT_RATE * (seconds / CONTACT_INTERVAL)
        )
        elapsedMs += STEP_MS
    }
    return {
        elapsedMs,
        coins: Math.round(collected),
        banked: Math.min(Math.round(collected), shapezzMaxPayoutForRun(elapsedMs, difficultyId)),
        checkpoints: Math.floor(elapsedMs / SHAPEZZ_CHECKPOINT_MS)
    }
}

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`

// ─── Report ─────────────────────────────────────────────────────────────────

printTargets('SHAPEZZ')

heading('Run payout by investment and difficulty')
console.log(
    padRight('investment', 12) + pad('spent', 12) + padRight('  difficulty', 16)
    + pad('survives', 10) + pad('mutations', 11) + pad('collected', 14) + pad('cap', 14) + pad('banked', 14) + pad('verdict', 11)
)
rule(114)
for (const tier of INVESTMENT_TIERS) {
    const { levels, weapon, spent } = buildForShare(tier.share)
    // The band is the payout on the *best* difficulty this tier can hold, so
    // only the deepest-banking row of each tier carries a verdict.
    const rows = SHAPEZZ_DIFFICULTIES.map(difficulty => ({
        difficulty,
        result: simulateRun(levels, weapon, difficulty.id)
    }))
    const best = rows.reduce((top, row) => (row.result.banked > top.result.banked ? row : top))
    for (const row of rows) {
        console.log(
            padRight(row === rows[0] ? tier.label : '', 12)
            + pad(row === rows[0] ? compact(spent) : '', 12)
            + padRight(`  ${row.difficulty.name}`, 16)
            + pad(clock(row.result.elapsedMs), 10)
            + pad(row.result.checkpoints, 11)
            + pad(coins(row.result.coins), 14)
            + pad(coins(shapezzMaxPayoutForRun(row.result.elapsedMs, row.difficulty.id)), 14)
            + pad(coins(row.result.banked), 14)
            + pad(row === best ? verdict(row.result.banked, tier) : '', 11)
        )
    }
}

heading('Anti-cheat ceiling by run length')
console.log(padRight('difficulty', 16) + [1, 2, 3, 4, 6, 8, 10].map(m => pad(`${m}m`, 13)).join(''))
rule(107)
for (const difficulty of SHAPEZZ_DIFFICULTIES) {
    console.log(
        padRight(difficulty.name, 16)
        + [1, 2, 3, 4, 6, 8, 10].map(m => pad(coins(shapezzMaxPayoutForRun(m * 60_000, difficulty.id)), 13)).join('')
    )
}

heading('Permanent tree')
console.log(`${padRight('upgrade', 22)}${pad('levels', 8)}${pad('first', 12)}${pad('last', 16)}${pad('total', 18)}`)
rule(76)
for (const id of SHAPEZZ_PERMANENT_UPGRADE_IDS) {
    const max = SHAPEZZ_PERMANENT_UPGRADES[id].maxLevel
    let total = 0
    for (let level = 0; level < max; level++) total += shapezzPermanentUpgradeCost(id, level) ?? 0
    console.log(
        padRight(SHAPEZZ_PERMANENT_UPGRADES[id].name, 22)
        + pad(max, 8)
        + pad(coins(shapezzPermanentUpgradeCost(id, 0) ?? 0), 12)
        + pad(coins(shapezzPermanentUpgradeCost(id, max - 1) ?? 0), 16)
        + pad(coins(total), 18)
    )
}
console.log(
    padRight('best weapon', 22) + pad(1, 8) + pad('', 12)
    + pad(coins(Math.max(...SHAPEZZ_WEAPONS.map(w => w.cost))), 16)
    + pad(coins(Math.max(...SHAPEZZ_WEAPONS.map(w => w.cost))), 18)
)
console.log(`${padRight('', 22)}${pad('', 8)}${pad('', 12)}${pad('tree', 16)}${pad(coins(treeCost()), 18)}`)

{
    const { levels, weapon } = buildForShare(1)
    const best = SHAPEZZ_DIFFICULTIES
        .map(difficulty => simulateRun(levels, weapon, difficulty.id).banked)
        .reduce((top, value) => Math.max(top, value), 0)
    console.log(`\nmaxed runs to buy the whole tree: ~${Math.ceil(treeCost() / Math.max(1, best))}`)
    console.log(`max level: ${SHAPEZZ_MAX_PERMANENT_LEVEL} (Blood Battery ${SHAPEZZ_MAX_KILL_HEAL_LEVEL})\n`)
}
