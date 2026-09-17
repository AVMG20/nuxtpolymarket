/**
 * Prints the Pathwarden balance grid. `bun scripts/pathwarden-balance.ts`
 *
 * Pathwarden pays two ways and only one of them is earned:
 *
 * 1. **Checkpoint rewards** are a flat coin grant for reaching waves 4, 8 and
 *    12. They are guaranteed — no upgrade, no defense and no skill enters the
 *    number. Whatever this column says is the *floor* income of a brand-new
 *    account that can finish a realm-1 march.
 * 2. **Aether cashout** converts whatever Aether the Warden did not spend on
 *    defenses into coins at a per-checkpoint rate.
 *
 * The second one is a real decision (spend on towers and survive, or hoard and
 * cash out) and it is fine that it scales. The first one is the number to watch:
 * a guaranteed grant that already clears the target band means the whole boost
 * tree is decoration.
 *
 * The Aether model below is an approximation of the engine, not the engine. It
 * mirrors `waveEnemyCount`, the spawn profile mix, the per-kill bounty and the
 * end-of-wave grant exactly; what it approximates is how much of that Aether a
 * player leaves unspent, which is a play-style, so three styles are printed.
 */

import {
    INVESTMENT_TIERS, coins, compact, heading, pad, padRight, printTargets, rule, verdict
} from './lib/balance-report'
import {
    PATHWARDEN_BOOSTS, PATHWARDEN_BOOST_IDS, PATHWARDEN_CHECKPOINT_WAVES, PATHWARDEN_MAX_WAVE,
    pathwardenAetherCashoutBonus, pathwardenBoostCost, pathwardenBoostEffects, pathwardenCashoutCoins,
    pathwardenCheckpointRate,
    pathwardenCheckpointReward, pathwardenMaxAetherAtCheckpoint,
    type PathwardenBoostId, type PathwardenBoostLevels
} from '../shared/utils/gamelogic/pathwarden'

const REALMS = [1, 2, 3, 4, 5] as const
/** Typical number of mist exits a generated map opens onto the keep. */
const EXITS = 3

// ─── Permanent boost tree ───────────────────────────────────────────────────

function emptyLevels(): PathwardenBoostLevels {
    return Object.fromEntries(PATHWARDEN_BOOST_IDS.map(id => [id, 0])) as PathwardenBoostLevels
}

/** Total coin cost of every coin-bought boost level. Gem boosts are a separate currency and excluded. */
function coinTreeCost() {
    let total = 0
    for (const id of PATHWARDEN_BOOST_IDS) {
        if (PATHWARDEN_BOOSTS[id].currency !== 'coins') continue
        for (let level = 0; level < PATHWARDEN_BOOSTS[id].maxLevel; level++) {
            total += pathwardenBoostCost(id, level) ?? 0
        }
    }
    return total
}

/**
 * Buys boost levels cheapest-first until `share` of the coin tree is spent.
 * Cheapest-first is what a real player does and it is also the harshest test:
 * it is the fastest any given number of coins can turn into power.
 */
function buildForShare(share: number): { levels: PathwardenBoostLevels, spent: number } {
    const budget = coinTreeCost() * share
    const levels = emptyLevels()
    let spent = 0
    for (;;) {
        let best: { id: PathwardenBoostId, cost: number } | null = null
        for (const id of PATHWARDEN_BOOST_IDS) {
            if (PATHWARDEN_BOOSTS[id].currency !== 'coins') continue
            const cost = pathwardenBoostCost(id, levels[id])
            if (cost === null) continue
            if (!best || cost < best.cost) best = { id, cost }
        }
        if (!best || spent + best.cost > budget) break
        levels[best.id]++
        spent += best.cost
    }
    return { levels, spent }
}

// ─── Aether flow, mirrored from the engine ──────────────────────────────────

/** `PathwardenEngine.waveEnemyCount` — the count is the same for every realm-1 map of this exit count. */
function waveEnemyCount(wave: number, realm: number) {
    const mistVolume = (EXITS - 1) * (2 + Math.ceil(wave / 3))
    const realmVolume = (realm - 1) * (2 + wave)
    return 7 + wave * 3 + mistVolume + realmVolume
}

/** `spawnEnemy` picks a type by spawn ordinal; this is the exact same ladder. */
function spawnProfileReward(wave: number, ordinal: number, isLast: boolean) {
    if (wave % 4 === 0 && isLast) return 9
    if (wave >= 5 && ordinal % 7 === 0) return 2.4
    if (wave >= 3 && ordinal % 5 === 0) return 2.1
    if (wave >= 2 && ordinal % 3 === 0) return 1.2
    return 1
}

/** Aether a wave pays if every enemy dies: kill bounties plus the end-of-wave grant. */
function waveAether(wave: number, realm: number, bountyMultiplier: number) {
    const count = waveEnemyCount(wave, realm)
    const realmBounty = 1 + (realm - 1) * 0.12
    let total = 0
    for (let ordinal = 0; ordinal < count; ordinal++) {
        const profile = spawnProfileReward(wave, ordinal, ordinal === count - 1)
        const reward = Math.round((2.5 + wave * 0.5) * profile * realmBounty)
        total += Math.floor(reward * bountyMultiplier)
    }
    return total + 30 + wave * 5
}

/** Total Aether a full 12-wave march generates, including the starting purse. */
function marchAether(realm: number, levels: PathwardenBoostLevels) {
    const effects = pathwardenBoostEffects(levels)
    let total = effects.startingAether
    for (let wave = 1; wave <= PATHWARDEN_MAX_WAVE; wave++) {
        total += waveAether(wave, realm, effects.bountyMultiplier)
    }
    return total
}

// ─── Reach, mirrored coarsely from the engine ───────────────────────────────

/** Average `spawnEnemy` health profile across the spawn ladder for a wave. */
function averageProfileHp(wave: number) {
    const count = waveEnemyCount(wave, 1)
    let total = 0
    for (let ordinal = 0; ordinal < count; ordinal++) {
        if (wave % 4 === 0 && ordinal === count - 1) total += 8.5
        else if (wave >= 5 && ordinal % 7 === 0) total += 1.5
        else if (wave >= 3 && ordinal % 5 === 0) total += 2.5
        else if (wave >= 2 && ordinal % 3 === 0) total += 0.7
        else total += 1
    }
    return total / count
}

/** Total enemy health a wave puts on the road. */
function waveHealth(wave: number, realm: number) {
    return waveEnemyCount(wave, realm)
        * averageProfileHp(wave)
        * (95 + wave * 28)
        * (1 + (realm - 1) * 0.38)
}

/**
 * Seconds a wave stays killable: its spawn cadence plus the walk down the road.
 * `updateCombat` spaces spawns by `0.76 - wave * 0.028` scaled by realm and exit
 * pressure; the constant tail is the approach every enemy still has to make.
 */
function waveWindowSeconds(wave: number, realm: number) {
    const interval = Math.max(0.16, (0.76 - wave * 0.028) * (1 - (realm - 1) * 0.07) / (1 + (EXITS - 1) * 0.08))
    return waveEnemyCount(wave, realm) * interval + 24
}

/**
 * Damage per second bought per point of Aether. Derived from the starter
 * ballista (25 damage on a 0.58s cycle for 71 Aether), discounted for the 28%
 * price escalation the engine applies to each repeat purchase of a type and for
 * the share of a defense's uptime spent with nothing in range.
 */
const DPS_PER_AETHER = 0.34

/** Deepest wave a build holds on a realm, given how much Aether it commits to defenses. */
function reachedWave(realm: number, levels: PathwardenBoostLevels, spendShare: number) {
    const effects = pathwardenBoostEffects(levels)
    let lives = effects.startingLives
    let banked = effects.startingAether
    let committed = 0
    for (let wave = 1; wave <= PATHWARDEN_MAX_WAVE; wave++) {
        committed += banked * spendShare
        banked -= banked * spendShare
        const dps = committed * DPS_PER_AETHER * effects.damageMultiplier
        const dealt = dps * waveWindowSeconds(wave, realm)
        const health = waveHealth(wave, realm)
        if (dealt < health) {
            // Everything the defenses could not kill walks into the keep.
            lives -= Math.ceil(waveEnemyCount(wave, realm) * (1 - dealt / health))
            if (lives <= 0) return wave - 1
        }
        banked += waveAether(wave, realm, effects.bountyMultiplier)
    }
    return PATHWARDEN_MAX_WAVE
}

/**
 * How much of the march's Aether a play-style leaves unspent at the wave-12
 * cashout. A Warden who buys nothing cannot hold wave 12, so `hoard` is not a
 * strategy on its own — it is the upper edge of what the cashout can pay.
 */
const PLAY_STYLES = [
    { id: 'invest', label: 'spends on towers', unspent: 0.12 },
    { id: 'balanced', label: 'holds a reserve', unspent: 0.3 },
    { id: 'hoard', label: 'minimum defenses', unspent: 0.55 }
] as const

// ─── Report ─────────────────────────────────────────────────────────────────

printTargets('Pathwarden')

heading('Guaranteed checkpoint grants — no upgrade, no skill, no Aether')
console.log(`${padRight('realm', 8)}${pad('wave 4', 12)}${pad('wave 8', 12)}${pad('wave 12', 12)}${pad('full march', 14)}${pad('verdict', 10)}`)
rule(68)
for (const realm of REALMS) {
    const perCheckpoint = PATHWARDEN_CHECKPOINT_WAVES.map(wave => pathwardenCheckpointReward(wave, realm))
    const full = perCheckpoint.reduce((sum, value) => sum + value, 0)
    // The unupgraded account is the `none` tier by definition, so that is the
    // band a guaranteed grant has to fit inside on the realm it can reach.
    console.log(
        padRight(`realm ${realm}`, 8)
        + pad(coins(perCheckpoint[0]!), 12)
        + pad(coins(perCheckpoint[1]!), 12)
        + pad(coins(perCheckpoint[2]!), 12)
        + pad(coins(full), 14)
        + pad(realm === 1 ? verdict(full, INVESTMENT_TIERS[0]!) : '', 10)
    )
}

heading('Aether cashout rate (coins per unspent Aether)')
console.log(`${padRight('realm', 8)}${pad('wave 4', 10)}${pad('wave 8', 10)}${pad('wave 12', 10)}`)
rule(38)
for (const realm of REALMS) {
    console.log(
        padRight(`realm ${realm}`, 8)
        + PATHWARDEN_CHECKPOINT_WAVES.map(wave => pad(pathwardenCheckpointRate(wave, realm), 10)).join('')
    )
}

heading('March payout by investment and realm')
console.log(
    padRight('investment', 12) + pad('spent', 12) + padRight('  realm', 9)
    + pad('reaches', 9) + pad('aether', 9) + pad('kept', 8) + pad('grant', 10) + pad('cashout', 12) + pad('total', 12) + pad('verdict', 11)
)
rule(104)
for (const tier of INVESTMENT_TIERS) {
    const { levels, spent } = buildForShare(tier.share)
    const style = PLAY_STYLES[1]!
    // Realms unlock strictly in order, so a tier's income is the deepest realm
    // it can still finish. Realms past that are printed too, unreachable, to
    // show where the ladder stops rather than only that it does.
    const rows = REALMS.map((realm) => {
        const wave = reachedWave(realm, levels, 1 - style.unspent)
        const cleared = wave >= PATHWARDEN_MAX_WAVE
        const total = marchAether(realm, levels)
        const kept = Math.min(
            Math.round(total * style.unspent),
            pathwardenMaxAetherAtCheckpoint(wave, levels, false, realm)
        )
        const grant = PATHWARDEN_CHECKPOINT_WAVES
            .filter(checkpoint => checkpoint <= wave)
            .reduce((sum, checkpoint) => sum + pathwardenCheckpointReward(checkpoint, realm), 0)
        return { realm, wave, cleared, total, kept, grant, payout: grant + pathwardenAetherCashoutBonus(kept, wave, realm) }
    })
    // Unlocking realm N+1 needs realm N cleared, so a build's actual income is
    // the deepest realm it can finish — the first one it cannot is where the
    // ladder stops, and marching it pays nothing until the next boost lands.
    const deepest = [...rows].reverse().find(row => row.cleared)
    for (const row of rows) {
        const first = row === rows[0]
        console.log(
            padRight(first ? tier.label : '', 12)
            + pad(first ? compact(spent) : '', 12)
            + padRight(`  realm ${row.realm}`, 9)
            + pad(`wave ${row.wave}`, 9)
            + pad(coins(row.total), 9)
            + pad(coins(row.kept), 8)
            + pad(coins(row.grant), 10)
            + pad(coins(row.payout - row.grant), 12)
            + pad(coins(row.payout), 12)
            + pad(row === deepest ? verdict(row.payout, tier) : '', 11)
        )
    }
}

heading('Play-style spread — maxed boosts, realm 5, wave 12')
console.log(`${padRight('style', 20)}${pad('unspent', 10)}${pad('aether', 10)}${pad('capped at', 12)}${pad('payout', 16)}`)
rule(68)
{
    const { levels } = buildForShare(1)
    const total = marchAether(5, levels)
    const cap = pathwardenMaxAetherAtCheckpoint(PATHWARDEN_MAX_WAVE, levels, false, 5)
    for (const style of PLAY_STYLES) {
        const kept = Math.min(Math.round(total * style.unspent), cap)
        console.log(
            padRight(style.label, 20)
            + pad(`${Math.round(style.unspent * 100)}%`, 10)
            + pad(coins(Math.round(total * style.unspent)), 10)
            + pad(coins(cap), 12)
            + pad(coins(pathwardenCashoutCoins(kept, PATHWARDEN_MAX_WAVE, 5)), 16)
        )
    }
}

heading('Coin boost tree')
console.log(`${padRight('boost', 26)}${pad('levels', 8)}${pad('first', 14)}${pad('last', 16)}${pad('total', 18)}`)
rule(82)
for (const id of PATHWARDEN_BOOST_IDS) {
    const boost = PATHWARDEN_BOOSTS[id]
    if (boost.currency !== 'coins') continue
    let total = 0
    for (let level = 0; level < boost.maxLevel; level++) total += pathwardenBoostCost(id, level) ?? 0
    console.log(
        padRight(boost.name, 26)
        + pad(boost.maxLevel, 8)
        + pad(coins(pathwardenBoostCost(id, 0) ?? 0), 14)
        + pad(coins(pathwardenBoostCost(id, boost.maxLevel - 1) ?? 0), 16)
        + pad(coins(total), 18)
    )
}
console.log(`${padRight('', 26)}${pad('', 8)}${pad('', 14)}${pad('tree', 16)}${pad(coins(coinTreeCost()), 18)}`)

{
    const { levels } = buildForShare(1)
    const total = marchAether(5, levels)
    const kept = Math.min(Math.round(total * PLAY_STYLES[1]!.unspent), pathwardenMaxAetherAtCheckpoint(PATHWARDEN_MAX_WAVE, levels, false, 5))
    const best = pathwardenCashoutCoins(kept, PATHWARDEN_MAX_WAVE, 5)
    console.log(`\nrealm-5 marches to buy the whole coin tree: ~${Math.ceil(coinTreeCost() / Math.max(1, best))}`)
    console.log(`realm-1 marches on a bare account to buy the first boost: ~${Math.ceil(
        (pathwardenBoostCost('bulwark', 0) ?? 0)
        / Math.max(1, pathwardenCashoutCoins(0, PATHWARDEN_MAX_WAVE, 1))
    )}\n`)
}
