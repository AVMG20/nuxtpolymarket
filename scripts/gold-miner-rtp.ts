// Gold Miner return-to-player by skill and cash-out strategy.
//
// Levels roll a hidden vein, so how deep a run gets is part skill, part luck.
// This plays runs with a bot on the real claw rules: the swing has to line up
// with the target, the claw takes the first thing on its line (so rocks in the
// way cost time), heavy loads reel slowly, TNT clears its neighbours and bags
// roll their real contents. Skill is the bot's aim noise and how well it picks
// targets. It reports what each "cash out after clearing level k" strategy
// returns per coin staked.
//
// The gate: the sharpest bot (a hair better than any human) may edge past 1.0
// on its single best strategy, but by no more than 10%, and casual play must sit well
// below it. Re-run after touching goals, veins, item values, reel speeds or
// GM_CASH_PER_STAKE.

import {
    GM_CASH_PER_STAKE,
    GM_CLAW_R,
    GM_EMPTY_REEL,
    GM_H,
    GM_ITEMS,
    GM_LEVEL_MS,
    GM_NO_PERKS,
    GM_PIVOT,
    GM_ROPE_MIN,
    GM_SHOOT_SPEED,
    GM_SWING_MAX,
    GM_SWING_PERIOD_MS,
    GM_W,
    gmBagOutcome,
    gmGenerateLevel,
    gmGoal,
    gmHash,
    gmItemValue,
    gmLevelSeed,
    gmMoleX,
    gmReelSpeed,
    gmRng,
    gmTntBlast,
    type GmItem,
    type GmLevel
} from '../shared/utils/gamelogic/gold-miner'

const RUNS = Number(process.env.RUNS ?? 1500)
const MAX_LEVEL = 12

interface Skill {
    name: string
    /** Aim error, radians (1σ). */
    aim: number
    /** Extra reaction delay per shot, seconds. */
    react: number
    /** Picks uniformly among this many best-looking targets. 1 = always the best. */
    choice: number
}

const SKILLS: Skill[] = [
    { name: 'casual', aim: 0.07, react: 0.45, choice: 5 },
    { name: 'good', aim: 0.035, react: 0.25, choice: 3 },
    { name: 'sharp', aim: 0.015, react: 0.1, choice: 1 }
]

const OMEGA = (Math.PI * 2) / (GM_SWING_PERIOD_MS / 1000)

/** Distance along the rope at which a ray at `angle` first touches `item`, or null. */
function rayHit(angle: number, x: number, y: number, r: number): number | null {
    const dx = Math.sin(angle)
    const dy = Math.cos(angle)
    const ox = x - GM_PIVOT.x
    const oy = y - GM_PIVOT.y
    const along = ox * dx + oy * dy
    const perp2 = ox * ox + oy * oy - along * along
    const rr = (r + GM_CLAW_R) ** 2
    if (perp2 > rr || along <= 0) return null
    return Math.max(GM_ROPE_MIN, along - Math.sqrt(rr - perp2))
}

/** How far the rope can go at this angle before leaving the screen. */
function rayExit(angle: number): number {
    const dx = Math.sin(angle)
    const dy = Math.cos(angle)
    const tx = dx > 0 ? (GM_W + 20 - GM_PIVOT.x) / dx : dx < 0 ? (-20 - GM_PIVOT.x) / dx : Infinity
    const ty = (GM_H + 10 - GM_PIVOT.y) / dy
    return Math.min(tx, ty)
}

function posAt(item: GmItem, ms: number) {
    return item.mole ? { x: gmMoleX(item.mole, ms).x, y: item.y } : { x: item.x, y: item.y }
}

function firstHit(items: GmItem[], angle: number, ms: number) {
    let best: { item: GmItem, dist: number } | null = null
    for (const item of items) {
        const p = posAt(item, ms)
        const d = rayHit(angle, p.x, p.y, GM_ITEMS[item.kind].r)
        if (d !== null && (!best || d < best.dist)) best = { item, dist: d }
    }
    return best
}

function playLevel(level: GmLevel, secret: number, skill: Skill, rng: () => number): number {
    let items = [...level.items]
    const gone = new Set<number>()
    let t = 0
    let phase = rng() * Math.PI * 2
    let cash = 0
    let strong = false
    const end = GM_LEVEL_MS / 1000
    const value = (item: GmItem) => item.kind === 'bag' ? 150 : item.kind === 'tnt' ? 0 : gmItemValue(item.kind, GM_NO_PERKS)

    while (t < end && items.length) {
        // Score every target by what the claw would actually bring back on its line.
        const options = items.map((item) => {
            const p = posAt(item, t * 1000)
            const angle = Math.atan2(p.x - GM_PIVOT.x, p.y - GM_PIVOT.y)
            const hit = firstHit(items, angle, t * 1000)
            if (!hit || Math.abs(angle) > GM_SWING_MAX) return null
            const len = hit.dist - GM_ROPE_MIN
            const secs = len / GM_SHOOT_SPEED + len / gmReelSpeed(hit.item.kind, strong) + 1
            return { angle, score: value(hit.item) / secs }
        }).filter((o): o is { angle: number, score: number } => !!o && o.score > 0)
        if (!options.length) break
        options.sort((a, b) => b.score - a.score)
        const pick = options[Math.floor(rng() * Math.min(skill.choice, options.length))]!

        // Wait for the swing to line up, then fire with some aim error.
        const want = Math.max(-GM_SWING_MAX, Math.min(GM_SWING_MAX, pick.angle))
        let wait = 0
        const target = Math.asin(want / GM_SWING_MAX)
        for (let k = 0; k < 2; k++) {
            for (const base of [target, Math.PI - target]) {
                let dphase = base - (phase % (Math.PI * 2))
                while (dphase < 0) dphase += Math.PI * 2
                if (k === 0 && (wait === 0 || dphase / OMEGA < wait)) wait = dphase / OMEGA
            }
        }
        t += wait + skill.react * rng() * 2
        phase += (wait + 0) * OMEGA
        if (t >= end) break
        const noise = (rng() + rng() + rng() - 1.5) * 2 * skill.aim
        const angle = want + noise
        const hit = firstHit(items, angle, t * 1000)
        if (!hit) {
            const len = Math.min(rayExit(angle), 2000) - GM_ROPE_MIN
            t += len / GM_SHOOT_SPEED + len / GM_EMPTY_REEL
            continue
        }
        const len = hit.dist - GM_ROPE_MIN
        t += len / GM_SHOOT_SPEED + len / gmReelSpeed(hit.item.kind, strong)
        if (t > end) break
        gone.add(hit.item.id)
        if (hit.item.kind === 'tnt') {
            for (const id of gmTntBlast(level, hit.item.id, gone)) gone.add(id)
            cash += GM_ITEMS.tnt.value
        } else if (hit.item.kind === 'bag') {
            const out = gmBagOutcome(secret, level.level, hit.item.id, false)
            if (out.kind === 'cash') cash += out.amount
            else if (out.kind === 'strength') strong = true
        } else {
            cash += gmItemValue(hit.item.kind, GM_NO_PERKS)
        }
        items = items.filter(i => !gone.has(i.id))
    }
    return cash
}

function simulate(skill: Skill) {
    const reach = new Array<number>(MAX_LEVEL + 1).fill(0)
    const cashAt = new Array<number>(MAX_LEVEL + 1).fill(0)
    for (let run = 0; run < RUNS; run++) {
        const secret = gmHash(run, 0x5eed) & 0x7fffffff
        const rng = gmRng(gmHash(run, 0xb07))
        let cash = 0
        for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
            const earned = playLevel(gmGenerateLevel(gmLevelSeed(secret, lvl), lvl), secret, skill, rng)
            if (earned < gmGoal(lvl)) break
            cash += earned
            reach[lvl]!++
            cashAt[lvl]! += cash
        }
    }
    return { reach, cashAt }
}

let warnings = 0
for (const skill of SKILLS) {
    const { reach, cashAt } = simulate(skill)
    console.log(`\n${skill.name} (aim ±${skill.aim} rad, top-${skill.choice} targets)`)
    console.log('  cash out after   clear %   avg cash   return / stake')
    let best = 0
    for (let k = 1; k <= MAX_LEVEL; k++) {
        if (!reach[k]) break
        const rtp = cashAt[k]! / GM_CASH_PER_STAKE / RUNS
        best = Math.max(best, rtp)
        console.log(`  level ${String(k).padEnd(10)} ${(reach[k]! / RUNS * 100).toFixed(1).padStart(6)}%   ${Math.round(cashAt[k]! / reach[k]!).toString().padStart(8)}   ${rtp.toFixed(3).padStart(8)}`)
    }
    console.log(`  best fixed strategy returns ${best.toFixed(3)}`)
    if (skill.name === 'sharp' && best > 1.1) {
        warnings++
        console.log('  ⚠ a sharp player beats the house by more than 10%')
    }
    if (skill.name === 'casual' && best > 0.8) {
        warnings++
        console.log('  ⚠ casual play returns too much')
    }
}
if (warnings) process.exitCode = 1
