import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { DEFAULT_RUN_CONFIG, MeadowbrawlGame, type Enemy } from '../../app/utils/meadowbrawl/engine'
import { WEAPONS } from '../../app/utils/meadowbrawl/weapons'
import { UPGRADE_BY_ID } from '../../app/utils/meadowbrawl/upgrades'
import type { Element, Offer, WeaponId } from '../../app/utils/meadowbrawl/types'

/**
 * Difficulty probe. A mortal bot with decent (not superhuman) habits plays
 * runs to the death with a few boon strategies, and the wave it dies on
 * is the difficulty curve. Off by default — it takes minutes:
 *
 *   MB_SIM=1 MB_RUNS=8 MB_WEAPONS=sword,scythe bunx vitest run test/meadowbrawl/balance.spec.ts
 *
 * Intended band: 10–15 should fall to a competent run, 20–25 to a strong
 * build, 30 only to a great one. The assertions are loose sanity bounds;
 * the printed table is the actual output.
 */

type Strategy = 'random' | 'greedy' | 'fire' | 'ice' | 'shock'

const STAT_PRIORITY = ['might', 'vigor', 'haste', 'oversized', 'lifesteal', 'thickhide', 'doubledodge', 'crit', 'flow', 'quickspecial']

function pickOffer(offers: Offer[], strategy: Strategy, hpFrac: number): number {
    if (strategy === 'random') return Math.floor(Math.random() * offers.length)
    const mending = offers.findIndex(o => o.upgrade.id === 'mending')
    if (mending >= 0 && hpFrac < 0.35) return mending
    const score = (o: Offer): number => {
        const u = o.upgrade
        let s = { common: 1, rare: 2, epic: 3, legendary: 5, weapon: 0 }[u.rarity]
        if (u.kind === 'pact') s -= 1.5
        if (u.id === 'mending') s -= 2
        if (u.id === 'fortune' || u.id === 'magpie') s -= 0.5
        const idx = STAT_PRIORITY.indexOf(u.id)
        if (idx >= 0) s += (STAT_PRIORITY.length - idx) * 0.15
        if (strategy !== 'greedy') {
            if (u.element === strategy) s += 3
            else if (u.element) s -= 2
        }
        return s
    }
    let best = 0
    for (let i = 1; i < offers.length; i++) if (score(offers[i]!) > score(offers[best]!)) best = i
    return best
}

interface RunResult {
    wave: number
    won: boolean
    kills: number
    seconds: number
    boons: string[]
}

function playRun(weapon: WeaponId, strategy: Strategy): RunResult {
    const g = new MeadowbrawlGame()
    g.startRun(weapon, DEFAULT_RUN_CONFIG)
    const dt = 1 / 60
    let simulated = 0
    let guard = 0
    const reach = WEAPONS[weapon].swings[0]!.shape
    const meleeReach = reach.kind === 'arc' ? reach.reach : reach.kind === 'thrust' ? reach.reach : 60
    let dodgeCd = 0

    while (g.phase !== 'victory' && g.phase !== 'dead' && guard++ < 60 * 60 * 60) {
        const p = g.player
        if (g.phase === 'upgrade') {
            g.chooseOffer(pickOffer(g.offers, strategy, p.hp / p.maxHp))
            continue
        }
        dodgeCd = Math.max(0, dodgeCd - dt)
        let best: Enemy | null = null
        let bd = Infinity
        let threat: Enemy | null = null
        let crowd = 0
        for (const e of g.enemies) {
            if (!e.alive) continue
            const d = Math.hypot(e.x - p.x, e.y - p.y)
            if (d < 90) crowd++
            // Elites are worth going for first only when nothing else is close.
            const score = d * (e.def.elite ? 1.15 : 1)
            if (score < bd) {
                bd = score
                best = e
            }
            if (e.state === 'windup' && e.attack && d < (e.attack.kind === 'charge' ? 330 : e.attack.kind === 'slam' ? 170 : 130) && e.stateT / e.attack.windup > 0.55) threat = e
        }
        for (const pr of g.projectiles) {
            if (pr.owner !== 'enemy') continue
            const d = Math.hypot(pr.x - p.x, pr.y - p.y)
            const closing = (pr.vx * (p.x - pr.x) + pr.vy * (p.y - pr.y)) > 0
            if (d < 110 && closing && !threat) threat = { x: pr.x, y: pr.y } as Enemy
        }
        if (best) {
            const d = Math.hypot(best.x - p.x, best.y - p.y)
            g.input.aimX = best.x
            g.input.aimY = best.y
            const dx = best.x - p.x
            const dy = best.y - p.y
            const l = d || 1
            // Close in, but hang back a step when badly hurt and surrounded.
            const hurt = p.hp / p.maxHp < 0.3 && crowd >= 3
            const wantDist = hurt ? 140 : meleeReach * 0.7
            g.input.moveX = d > wantDist ? dx / l : hurt ? -dx / l : 0
            g.input.moveY = d > wantDist ? dy / l : hurt ? -dy / l : 0
            if (d < meleeReach + best.r && !hurt) g.input.attackPressed = true
            if (d < 170 && p.specialCd <= 0) g.input.specialPressed = true
            if (p.abilityCd.q <= 0 && (crowd >= 2 || d < 120)) g.input.qPressed = true
            else if (p.abilityCd.e <= 0 && (crowd >= 2 || d < 200)) g.input.ePressed = true
            if (threat && p.dodgeCharges > 0 && !p.dodge && dodgeCd <= 0) {
                // Roll sideways relative to the threat: away is where the charge goes.
                const tx = threat.x - p.x
                const ty = threat.y - p.y
                const tl = Math.hypot(tx, ty) || 1
                const side = Math.random() < 0.5 ? 1 : -1
                g.input.moveX = -ty / tl * side - tx / tl * 0.4
                g.input.moveY = tx / tl * side - ty / tl * 0.4
                g.input.spacePressed = true
                g.input.spaceDown = true
                g.update(dt)
                simulated += dt
                g.input.spaceReleased = true
                g.input.spaceDown = false
                dodgeCd = 0.5
            }
        } else {
            g.input.moveX = 0
            g.input.moveY = 0
        }
        g.update(dt)
        simulated += dt
    }
    return {
        wave: g.wave,
        won: g.phase === 'victory',
        kills: g.stats.kills,
        seconds: Math.round(simulated),
        boons: [...g.player.upgrades.entries()].map(([id, n]) => `${UPGRADE_BY_ID[id]?.name ?? id}${n > 1 ? `×${n}` : ''}`)
    }
}

function pct(list: number[], p: number): number {
    const sorted = [...list].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
}

const enabled = process.env.MB_SIM === '1'

describe.skipIf(!enabled)('difficulty probe', () => {
    const all: WeaponId[] = ['sword', 'greataxe', 'spear', 'daggers', 'warhammer', 'scythe']
    const weapons = (process.env.MB_WEAPONS?.split(',').filter((w): w is WeaponId => all.includes(w as WeaponId)) ?? [])
    const picked = weapons.length ? weapons : [...all].sort(() => Math.random() - 0.5).slice(0, 3)
    const runs = Number(process.env.MB_RUNS ?? 6)
    const strategies: Strategy[] = (process.env.MB_STRATEGIES?.split(',') as Strategy[] | undefined) ?? ['random', 'greedy', 'fire', 'ice', 'shock']

    it('reports how deep a mortal bot gets', () => {
        const lines: string[] = []
        const allWaves: number[] = []
        for (const weapon of picked) {
            for (const strategy of strategies) {
                const results: RunResult[] = []
                for (let i = 0; i < runs; i++) results.push(playRun(weapon, strategy))
                const waves = results.map(r => r.wave)
                allWaves.push(...waves)
                const reach = (n: number) => Math.round(waves.filter(w => w >= n).length / waves.length * 100)
                lines.push(`${weapon.padEnd(10)} ${strategy.padEnd(7)} median ${String(pct(waves, 0.5)).padStart(2)}  p25 ${String(pct(waves, 0.25)).padStart(2)}  p75 ${String(pct(waves, 0.75)).padStart(2)}  ≥10 ${reach(10)}%  ≥15 ${reach(15)}%  ≥20 ${reach(20)}%  ≥25 ${reach(25)}%  won ${Math.round(results.filter(r => r.won).length / results.length * 100)}%`)
                const bestRun = results.reduce((a, b) => (b.wave > a.wave ? b : a))
                lines.push(`           best: wave ${bestRun.wave} in ${bestRun.seconds}s with ${bestRun.boons.join(', ')}`)
            }
        }
        const report = `\n${lines.join('\n')}\n`
        console.log(report)
        if (process.env.MB_OUT) writeFileSync(process.env.MB_OUT, report)
        expect(allWaves.length).toBeGreaterThan(0)
        for (const w of allWaves) expect(w).toBeGreaterThanOrEqual(1)
    }, 20 * 60 * 1000)
})

// Element type is referenced so the strategy union stays in step with the schools.
export type { Element }
