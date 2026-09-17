/**
 * Prints the Pirate Raid balance grid. `bun scripts/pirates-balance.ts`
 *
 * A voyage is a fixed six minutes and the money is heavily back-loaded:
 * `pirateRunPayoutProgress` puts only 4% of a voyage's headroom in the first
 * minute and 69% by the fifth, and the completion bonus is a further ~90% of an
 * average haul that only a ship that survives the whole thing ever sees. So the
 * question this script answers is not "how much does difficulty N pay" but "how
 * far into difficulty N does this much investment actually get".
 *
 * The combat model is a two-sided attrition one: accuracy-weighted broadside
 * DPS against the fleet's scaled hull, and the fleet's accuracy-weighted return
 * fire against the ship's. It ignores positioning, kiting and power-ups, which
 * is why a real captain does better than these rows — the point is the shape of
 * the curve across investment, not a prediction of any single voyage.
 */

import {
    INVESTMENT_TIERS, coins, compact, heading, pad, padRight, printTargets, rule, verdict
} from './lib/balance-report'
import {
    PIRATE_ABILITIES, PIRATE_ABILITY_MAX_LEVEL, PIRATE_CANNON_TIERS, PIRATE_ENEMY_TIERS,
    PIRATE_MAX_CANNON_SLOTS, PIRATE_MAX_DIFFICULTY, PIRATE_RUN_DURATION_MS, PIRATE_SHIP_STAT_IDS,
    pirateAbilityUpgradeCost, pirateAverageRunPayoutEstimate, pirateCannonDps, pirateCannonTier,
    pirateCompletionBonus, pirateDefenseRating, pirateDifficultyMultiplier, pirateEnemyReloadMultiplier,
    pirateHitChance, pirateMaxHp, pirateMaxConcurrentEnemies, pirateMaxPayoutForRun,
    pirateRegenRate, pirateRewardMultiplier, pirateSlotUnlockCost, pirateStatMaxLevel,
    pirateStatUpgradeCost, piratePowerLevel, PIRATE_REGEN_CYCLE_MS,
    type PirateShipStatId
} from '../shared/utils/gamelogic/pirates'

const STEP_MS = 1_000
const DIFFICULTIES = [0, 100, 200, 350, 500, 700, 1000] as const

/**
 * Share of the fleet's theoretical return fire the ship actually eats. A captain
 * kites, breaks line of sight and picks off snipers first; this is the residue
 * that gets through.
 */
const INCOMING_UPTIME = 0.34
/** Share of theoretical broadside DPS that lands on something worth killing. */
const BROADSIDE_UPTIME = 0.62

type Levels = Record<PirateShipStatId, number>

interface Build {
    levels: Levels
    cannons: string[]
    slots: number
    spent: number
}

function starterLevels(): Levels {
    return Object.fromEntries(PIRATE_SHIP_STAT_IDS.map(id => [id, 1])) as Levels
}

// ─── Armoury cost ───────────────────────────────────────────────────────────

/** Every stat level, every gun port, eight top-tier cannons and every ability maxed. */
function treeCost() {
    let total = 0
    for (const id of PIRATE_SHIP_STAT_IDS) {
        for (let level = 1; level < pirateStatMaxLevel(id); level++) total += pirateStatUpgradeCost(id, level) ?? 0
    }
    for (let slots = 1; slots < PIRATE_MAX_CANNON_SLOTS; slots++) total += pirateSlotUnlockCost(slots) ?? 0
    const best = PIRATE_CANNON_TIERS[PIRATE_CANNON_TIERS.length - 1]!
    total += best.cost * PIRATE_MAX_CANNON_SLOTS
    for (const ability of PIRATE_ABILITIES) {
        total += ability.cost
        for (let level = 1; level < PIRATE_ABILITY_MAX_LEVEL; level++) total += pirateAbilityUpgradeCost(level) ?? 0
    }
    return total
}

/**
 * Cheapest-first spend across stat levels, gun ports and cannon tiers. Cannons
 * are upgraded one port at a time, which is what a captain actually does — a
 * second Culverin beats a first Long Gun until the ports run out.
 */
function buildForShare(share: number): Build {
    const budget = treeCost() * share
    const levels = starterLevels()
    let slots = 1
    const cannons = ['swivel']
    let spent = 0
    for (;;) {
        let best: { buy: () => void, cost: number } | null = null
        const offer = (cost: number | null, buy: () => void) => {
            if (cost === null || cost <= 0) return
            if (!best || cost < best.cost) best = { cost, buy }
        }
        for (const id of PIRATE_SHIP_STAT_IDS) offer(pirateStatUpgradeCost(id, levels[id]), () => { levels[id]++ })
        if (slots < PIRATE_MAX_CANNON_SLOTS) {
            offer(pirateSlotUnlockCost(slots), () => { slots++; cannons.push('swivel') })
        }
        for (let index = 0; index < cannons.length; index++) {
            const current = pirateCannonTier(cannons[index]!)
            const next = PIRATE_CANNON_TIERS.find(tier => tier.cost > current.cost)
            if (next) offer(next.cost - current.cost, () => { cannons[index] = next.id })
        }
        if (!best || spent + best.cost > budget) break
        best.buy()
        spent += best.cost
    }
    return { levels, cannons, slots, spent }
}

// ─── Voyage model ───────────────────────────────────────────────────────────

/** Average hull and firepower of the fleet actually on the water at `elapsedMs`. */
function fleetProfile(elapsedMs: number) {
    const pool = PIRATE_ENEMY_TIERS.filter(tier => !tier.boss && tier.weight > 0 && elapsedMs >= tier.unlockAtMs)
    const weight = pool.reduce((sum, tier) => sum + tier.weight, 0)
    const mean = (pick: (tier: typeof pool[number]) => number) =>
        pool.reduce((sum, tier) => sum + (tier.weight / weight) * pick(tier), 0)
    return {
        hp: mean(tier => tier.hp),
        defense: mean(tier => tier.defense),
        attack: mean(tier => tier.attackRating),
        damage: mean(tier => tier.maxDamage),
        reloadMs: mean(tier => tier.reloadMs),
        coin: mean(tier => (tier.coinMin + tier.coinMax) / 2)
    }
}

interface VoyageResult { survivedMs: number, completed: boolean, collected: number, banked: number }

function simulateVoyage(build: Build, difficulty: number): VoyageResult {
    const maxHp = pirateMaxHp(build.levels.hull)
    const defense = pirateDefenseRating(build.levels.defense)
    const regenPerSecond = pirateRegenRate(build.levels.regen) / (PIRATE_REGEN_CYCLE_MS / 1000)
    let hp = maxHp
    let elapsedMs = 0
    let collected = 0
    while (elapsedMs < PIRATE_RUN_DURATION_MS && hp > 0) {
        const seconds = STEP_MS / 1000
        const scale = pirateDifficultyMultiplier(elapsedMs, difficulty)
        const fleet = fleetProfile(elapsedMs)
        const enemyDefense = fleet.defense * scale.statMult
        const enemyHp = fleet.hp * scale.hpMult

        const broadside = build.cannons.reduce(
            (sum, id) => sum + pirateCannonDps(pirateCannonTier(id), enemyDefense),
            0
        ) * BROADSIDE_UPTIME
        const kills = Math.min(
            pirateMaxConcurrentEnemies(elapsedMs, difficulty),
            (broadside / enemyHp) * seconds
        )
        collected += kills * fleet.coin * pirateRewardMultiplier(elapsedMs, difficulty)

        const alive = pirateMaxConcurrentEnemies(elapsedMs, difficulty)
        const shotsPerSecond = alive / ((fleet.reloadMs * pirateEnemyReloadMultiplier(elapsedMs, difficulty)) / 1000)
        const incoming = shotsPerSecond
            * pirateHitChance(fleet.attack * scale.statMult, defense)
            * ((fleet.damage * scale.dmgMult + 1) / 2)
            * INCOMING_UPTIME
        hp = Math.min(maxHp, hp + regenPerSecond * seconds - incoming * seconds)
        elapsedMs += STEP_MS
    }
    const completed = hp > 0
    const banked = Math.min(Math.round(collected), pirateMaxPayoutForRun(elapsedMs, difficulty))
        + (completed ? pirateCompletionBonus(difficulty) : 0)
    return { survivedMs: elapsedMs, completed, collected: Math.round(collected), banked }
}

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`

// ─── Report ─────────────────────────────────────────────────────────────────

printTargets('Pirate Raid')

heading('Voyage payout by investment and selected difficulty')
console.log(
    padRight('investment', 12) + pad('spent', 12) + pad('power', 8) + pad('difficulty', 12)
    + pad('survives', 10) + pad('result', 9) + pad('collected', 13) + pad('bonus', 13) + pad('banked', 13) + pad('verdict', 11)
)
rule(113)
for (const tier of INVESTMENT_TIERS) {
    const build = buildForShare(tier.share)
    const power = piratePowerLevel({ levels: build.levels, cannonTierIds: build.cannons, cannonSlots: build.slots })
    const rows = DIFFICULTIES.map(difficulty => ({ difficulty, result: simulateVoyage(build, difficulty) }))
    const best = rows.reduce((top, row) => (row.result.banked > top.result.banked ? row : top))
    for (const row of rows) {
        const first = row === rows[0]
        console.log(
            padRight(first ? tier.label : '', 12)
            + pad(first ? compact(build.spent) : '', 12)
            + pad(first ? power : '', 8)
            + pad(row.difficulty, 12)
            + pad(clock(row.result.survivedMs), 10)
            + pad(row.result.completed ? 'CLEAR' : 'sunk', 9)
            + pad(coins(row.result.collected), 13)
            + pad(row.result.completed ? coins(pirateCompletionBonus(row.difficulty)) : '—', 13)
            + pad(coins(row.result.banked), 13)
            + pad(row === best ? verdict(row.result.banked, tier) : '', 11)
        )
    }
}

heading('Headroom and completion bonus by difficulty')
console.log(`${padRight('difficulty', 12)}${pad('avg haul', 14)}${pad('run ceiling', 14)}${pad('completion', 14)}${pad('clean clear', 16)}`)
rule(70)
for (const difficulty of DIFFICULTIES) {
    const estimate = pirateAverageRunPayoutEstimate(difficulty)
    console.log(
        padRight(String(difficulty), 12)
        + pad(coins(estimate), 14)
        + pad(coins(pirateMaxPayoutForRun(PIRATE_RUN_DURATION_MS, difficulty)), 14)
        + pad(coins(pirateCompletionBonus(difficulty)), 14)
        + pad(coins(estimate + pirateCompletionBonus(difficulty)), 16)
    )
}

heading('Armoury cost')
{
    let stats = 0
    for (const id of PIRATE_SHIP_STAT_IDS) {
        let total = 0
        for (let level = 1; level < pirateStatMaxLevel(id); level++) total += pirateStatUpgradeCost(id, level) ?? 0
        stats += total
        console.log(`${padRight(id, 22)}${pad(pirateStatMaxLevel(id), 8)} lv${pad(coins(total), 20)}`)
    }
    let slots = 0
    for (let count = 1; count < PIRATE_MAX_CANNON_SLOTS; count++) slots += pirateSlotUnlockCost(count) ?? 0
    const best = PIRATE_CANNON_TIERS[PIRATE_CANNON_TIERS.length - 1]!
    let abilities = 0
    for (const ability of PIRATE_ABILITIES) {
        abilities += ability.cost
        for (let level = 1; level < PIRATE_ABILITY_MAX_LEVEL; level++) abilities += pirateAbilityUpgradeCost(level) ?? 0
    }
    console.log(`${padRight('gun ports', 22)}${pad(PIRATE_MAX_CANNON_SLOTS, 8)} lv${pad(coins(slots), 20)}`)
    console.log(`${padRight(`${best.name} ×8`, 22)}${pad('', 8)}  ${pad(coins(best.cost * PIRATE_MAX_CANNON_SLOTS), 20)}`)
    console.log(`${padRight('abilities', 22)}${pad(PIRATE_ABILITIES.length, 8)}    ${pad(coins(abilities), 20)}`)
    console.log(`${padRight('', 22)}${pad('tree', 8)}  ${pad(coins(treeCost()), 20)}`)
    console.log(`\nstat total ${coins(stats)} · max difficulty ${PIRATE_MAX_DIFFICULTY}`)
}

{
    const build = buildForShare(1)
    const best = DIFFICULTIES
        .map(difficulty => simulateVoyage(build, difficulty).banked)
        .reduce((top, value) => Math.max(top, value), 0)
    console.log(`maxed voyages to buy the whole armoury: ~${Math.ceil(treeCost() / Math.max(1, best))}\n`)
}
