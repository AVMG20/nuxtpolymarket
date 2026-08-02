/**
 * Prints the FIREWALL balance table. `bun scripts/firewall-balance.ts`
 *
 * Two questions, both of which the numbers in `firewall.ts` are fitted to:
 *
 * 1. How deep does each build get on each difficulty? A maxed account on Zero
 *    Day should end in the low-to-mid twenties — deep enough that the run is the
 *    reward, short of a clear so the last rung still has somewhere to go.
 * 2. What does a run pay? A first Breach run should be a few Mainframe levels
 *    away from the first purchase; an endgame Zero Day run should make the
 *    hundred-million tier of the tree move.
 */

import {
    FIREWALL_DIFFICULTIES, FIREWALL_MAINFRAME, FIREWALL_MAX_WAVE,
    firewallLoadout, firewallMainframeCost, firewallMainframeEffects, firewallMaxPayout
} from '../shared/utils/gamelogic/firewall'
import {
    firewallFreshBuild, firewallGearedBuild, firewallMaxBuild, firewallSimulateRun,
    firewallWeaponDps, firewallTurretDps
} from '../shared/utils/gamelogic/firewall-sim'

const pad = (value: string | number, width: number) => String(value).padStart(width)

console.log('\n═══ Run depth and payout ═══\n')
console.log(`${'difficulty'.padEnd(11)}${pad('build', 8)}${pad('ended', 7)}${pad('result', 9)}${pad('coins', 16)}${pad('end dps', 10)}`)
console.log('─'.repeat(61))

for (const difficulty of FIREWALL_DIFFICULTIES) {
    for (const [label, build, auto] of [
        ['fresh', firewallFreshBuild(), true],
        ['geared', firewallGearedBuild(), true],
        ['maxed', firewallMaxBuild(), false]
    ] as const) {
        const result = firewallSimulateRun(build, difficulty.id, { autoUpgrade: auto })
        const last = result.waves[result.waves.length - 1]
        console.log(
            difficulty.name.padEnd(11)
            + pad(label, 8)
            + pad(result.endedWave, 7)
            + pad(result.victory ? 'CLEAR' : 'breach', 9)
            + pad(result.coins.toLocaleString('en-US'), 16)
            + pad(Math.round(last?.dps ?? 0).toLocaleString('en-US'), 10)
        )
    }
}

console.log('\n═══ Maxed build on Zero Day, wave by wave ═══\n')
console.log(`${'wave'.padEnd(6)}${pad('hostiles', 10)}${pad('survivors', 11)}${pad('wall', 14)}${pad('coins', 14)}`)
console.log('─'.repeat(55))
const zeroDay = firewallSimulateRun(firewallMaxBuild(), 'zeroday')
for (const wave of zeroDay.waves) {
    console.log(
        String(wave.wave).padEnd(6)
        + pad(wave.hostiles, 10)
        + pad(wave.survivors, 11)
        + pad(`${Math.round(wave.wallHp)}/${wave.wallMaxHp}`, 14)
        + pad(wave.coins.toLocaleString('en-US'), 14)
    )
}

console.log('\n═══ Endgame loadout ═══\n')
const maxBuild = firewallMaxBuild()
const maxLoadout = firewallLoadout(
    { levels: maxBuild.levels, owned: [maxBuild.weapon], active: maxBuild.weapon, turrets: maxBuild.turrets },
    maxBuild.mainframe,
    'zeroday'
)
console.log(`weapon dps      ${Math.round(firewallWeaponDps(maxLoadout)).toLocaleString('en-US')}`)
console.log(`turret dps      ${Math.round(firewallTurretDps(maxLoadout)).toLocaleString('en-US')}  (${maxLoadout.turrets.length} mounts)`)
console.log(`trap dps        ${maxLoadout.spikeDps}`)
console.log(`wall hp         ${maxLoadout.wallMaxHp.toLocaleString('en-US')}`)
console.log(`shield          ${maxLoadout.shieldMax} @ ${maxLoadout.shieldRegenPerSec}/s`)
console.log(`coin multiplier ×${maxLoadout.coinMultiplier.toFixed(2)}`)

console.log('\n═══ Mainframe cost ═══\n')
let treeTotal = 0
for (const def of FIREWALL_MAINFRAME) {
    let total = 0
    for (let level = 0; level < def.max; level++) total += firewallMainframeCost(def, level) ?? 0
    treeTotal += total
    const last = firewallMainframeCost(def, def.max - 1) ?? 0
    console.log(
        `${def.name.padEnd(20)}${pad(def.max, 3)} lv  last ${pad(last.toLocaleString('en-US'), 15)}  total ${pad(total.toLocaleString('en-US'), 15)}`
    )
}
console.log(`${''.padEnd(20)}${''.padEnd(5)}     ${''.padEnd(21)}  tree  ${pad(treeTotal.toLocaleString('en-US'), 15)}`)

console.log('\n═══ Payout ceiling headroom ═══\n')
console.log(`${'difficulty'.padEnd(11)}${pad('honest', 16)}${pad('ceiling', 18)}${pad('headroom', 11)}`)
console.log('─'.repeat(56))
for (const difficulty of FIREWALL_DIFFICULTIES) {
    const run = firewallSimulateRun(firewallMaxBuild(), difficulty.id)
    const ceiling = firewallMaxPayout(run.endedWave, difficulty, firewallMainframeEffects(maxBuild.mainframe).coins)
    console.log(
        difficulty.name.padEnd(11)
        + pad(run.coins.toLocaleString('en-US'), 16)
        + pad(ceiling.toLocaleString('en-US'), 18)
        + pad(`${(ceiling / Math.max(1, run.coins)).toFixed(2)}x`, 11)
    )
}

const runsToMax = treeTotal / Math.max(1, firewallSimulateRun(firewallMaxBuild(), 'zeroday').coins)
console.log(`\nendgame Zero Day runs to buy the whole tree: ~${Math.ceil(runsToMax)}`)
console.log(`starting credits at max Uplink Grant: ${firewallMainframeEffects(maxBuild.mainframe).startingCredits}`)
console.log(`wave cap: ${FIREWALL_MAX_WAVE}\n`)
