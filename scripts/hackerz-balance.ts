/**
 * Prints the HACKERZ balance grid. `bun scripts/hackerz-balance.ts`
 *
 * Two questions, both of which the numbers in `hackerz.ts` are fitted to:
 *
 * 1. How deep does each level of investment get on each difficulty? A maxed
 *    account on Zero Day should end in the low-to-mid twenties — deep enough
 *    that the run is the reward, short of a clear so the last rung still has
 *    somewhere to go.
 * 2. What does a run pay? The answer has to land inside the site-wide band for
 *    the tier that bought it (see `lib/balance-report.ts`). HACKERZ's specific
 *    failure mode is the low difficulties: Probe softens bodies rather than
 *    thinning them, so a bare account survives deep into it, and deep is what
 *    the coin curve pays for.
 *
 * The run model itself lives in `hackerz-sim.ts`; everything here is the grid
 * and the shop arithmetic around it.
 */

import {
    INVESTMENT_TIERS, coins, compact, heading, pad, padRight, printTargets, rule, verdict
} from './lib/balance-report'
import {
    HACKERZ_DIFFICULTIES, HACKERZ_MAINFRAME, HACKERZ_MAINFRAME_IDS, HACKERZ_MAX_WAVE,
    HACKERZ_UPGRADES, HACKERZ_WEAPONS,
    hackerzEmptyLevels, hackerzEmptyMainframe, hackerzLoadout, hackerzMainframeCost,
    hackerzMainframeEffects, hackerzMaxPayout, hackerzSlots, hackerzWeaponUnlockWave,
    type HackerzMainframeId, type HackerzMainframeLevels, type HackerzTurretId
} from '../shared/utils/gamelogic/hackerz'
import {
    hackerzMaxBuild, hackerzSimulateRun, hackerzTurretDps, hackerzWeaponDps,
    type HackerzSimBuild
} from '../shared/utils/gamelogic/hackerz-sim'

/** Total coin cost of every Mainframe level — the whole permanent sink. */
function treeCost() {
    let total = 0
    for (const def of HACKERZ_MAINFRAME) {
        for (let level = 0; level < def.max; level++) total += hackerzMainframeCost(def, level) ?? 0
    }
    return total
}

/**
 * Buys Mainframe levels cheapest-first until `share` of the tree is spent, then
 * picks the best gun the resulting Arsenal Licence opens from wave one and
 * fills every starting mount the Rampart Charter grants.
 *
 * In-run upgrades are left empty because they are bought with credits, not
 * coins — the simulator's `autoUpgrade` spends those during the run, which is
 * exactly what a player does.
 */
function buildForShare(share: number): { build: HackerzSimBuild, spent: number } {
    const budget = treeCost() * share
    const mainframe = hackerzEmptyMainframe()
    let spent = 0
    for (;;) {
        let best: { id: HackerzMainframeId, cost: number } | null = null
        for (const def of HACKERZ_MAINFRAME) {
            const cost = hackerzMainframeCost(def, mainframe[def.id])
            if (cost === null) continue
            if (!best || cost < best.cost) best = { id: def.id, cost }
        }
        if (!best || spent + best.cost > budget) break
        mainframe[best.id]++
        spent += best.cost
    }
    return { build: buildFor(mainframe), spent }
}

function buildFor(mainframe: HackerzMainframeLevels): HackerzSimBuild {
    const weapon = [...HACKERZ_WEAPONS]
        .filter(def => hackerzWeaponUnlockWave(def, mainframe.arsenal) <= 1)
        .sort((a, b) => b.cost - a.cost)[0] ?? HACKERZ_WEAPONS[0]!
    return {
        levels: hackerzEmptyLevels(),
        mainframe,
        weapon: weapon.id,
        turrets: Array.from({ length: hackerzSlots(0, mainframe.charter) }, () => null as HackerzTurretId | null)
    }
}

// ─── Report ─────────────────────────────────────────────────────────────────

printTargets('HACKERZ')

heading('Run depth and payout by investment and difficulty')
console.log(
    padRight('investment', 12) + pad('spent', 12) + padRight('  difficulty', 14)
    + pad('ended', 8) + pad('result', 9) + pad('coins', 16) + pad('end dps', 10) + pad('verdict', 11)
)
rule(92)
for (const tier of INVESTMENT_TIERS) {
    const { build, spent } = buildForShare(tier.share)
    const rows = HACKERZ_DIFFICULTIES.map(difficulty => ({
        difficulty,
        result: hackerzSimulateRun(build, difficulty.id, { autoUpgrade: true })
    }))
    const best = rows.reduce((top, row) => (row.result.coins > top.result.coins ? row : top))
    for (const row of rows) {
        const first = row === rows[0]
        const last = row.result.waves[row.result.waves.length - 1]
        console.log(
            padRight(first ? tier.label : '', 12)
            + pad(first ? compact(spent) : '', 12)
            + padRight(`  ${row.difficulty.name}`, 14)
            + pad(row.result.endedWave, 8)
            + pad(row.result.victory ? 'CLEAR' : 'breach', 9)
            + pad(coins(row.result.coins), 16)
            + pad(coins(last?.dps ?? 0), 10)
            + pad(row === best ? verdict(row.result.coins, tier) : '', 11)
        )
    }
}

heading('Maxed build on Zero Day, wave by wave')
console.log(`${padRight('wave', 6)}${pad('hostiles', 10)}${pad('survivors', 11)}${pad('wall', 14)}${pad('coins', 14)}`)
rule(55)
for (const wave of hackerzSimulateRun(hackerzMaxBuild(), 'zeroday').waves) {
    console.log(
        padRight(wave.wave, 6)
        + pad(wave.hostiles, 10)
        + pad(wave.survivors, 11)
        + pad(`${Math.round(wave.wallHp)}/${wave.wallMaxHp}`, 14)
        + pad(coins(wave.coins), 14)
    )
}

heading('Endgame loadout')
{
    const maxBuild = hackerzMaxBuild()
    const loadout = hackerzLoadout(
        { levels: maxBuild.levels, owned: [maxBuild.weapon], active: maxBuild.weapon, turrets: maxBuild.turrets },
        maxBuild.mainframe,
        'zeroday'
    )
    console.log(`weapon dps      ${coins(hackerzWeaponDps(loadout))}`)
    console.log(`turret dps      ${coins(hackerzTurretDps(loadout))}  (${loadout.turrets.length} mounts)`)
    console.log(`trap dps        ${loadout.spikeDps}`)
    console.log(`wall hp         ${coins(loadout.wallMaxHp)}`)
    console.log(`shield          ${loadout.shieldMax} @ ${loadout.shieldRegenPerSec}/s`)
    console.log(`coin multiplier ×${loadout.coinMultiplier.toFixed(2)}`)
}

heading('Mainframe cost')
console.log(`${padRight('upgrade', 22)}${pad('levels', 8)}${pad('first', 14)}${pad('last', 16)}${pad('total', 18)}`)
rule(78)
for (const def of HACKERZ_MAINFRAME) {
    let total = 0
    for (let level = 0; level < def.max; level++) total += hackerzMainframeCost(def, level) ?? 0
    console.log(
        padRight(def.name, 22)
        + pad(def.max, 8)
        + pad(coins(hackerzMainframeCost(def, 0) ?? 0), 14)
        + pad(coins(hackerzMainframeCost(def, def.max - 1) ?? 0), 16)
        + pad(coins(total), 18)
    )
}
console.log(`${padRight('', 22)}${pad('', 8)}${pad('', 14)}${pad('tree', 16)}${pad(coins(treeCost()), 18)}`)

heading('Payout ceiling headroom')
console.log(`${padRight('difficulty', 12)}${pad('honest', 16)}${pad('ceiling', 18)}${pad('headroom', 11)}`)
rule(57)
{
    const maxBuild = hackerzMaxBuild()
    for (const difficulty of HACKERZ_DIFFICULTIES) {
        const run = hackerzSimulateRun(maxBuild, difficulty.id)
        const ceiling = hackerzMaxPayout(run.endedWave, difficulty, hackerzMainframeEffects(maxBuild.mainframe).coins)
        console.log(
            padRight(difficulty.name, 12)
            + pad(coins(run.coins), 16)
            + pad(coins(ceiling), 18)
            + pad(`${(ceiling / Math.max(1, run.coins)).toFixed(2)}x`, 11)
        )
    }
    const best = HACKERZ_DIFFICULTIES
        .map(difficulty => hackerzSimulateRun(buildForShare(1).build, difficulty.id, { autoUpgrade: true }).coins)
        .reduce((top, value) => Math.max(top, value), 0)
    console.log(`\nmaxed runs to buy the whole tree: ~${Math.ceil(treeCost() / Math.max(1, best))}`)
    console.log(`starting credits at max Uplink Grant: ${hackerzMainframeEffects(maxBuild.mainframe).startingCredits}`)
    console.log(`in-run upgrades: ${HACKERZ_UPGRADES.length} · mainframe tracks: ${HACKERZ_MAINFRAME_IDS.length} · wave cap: ${HACKERZ_MAX_WAVE}\n`)
}
