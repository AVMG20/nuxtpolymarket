/*
 * The wave director: owns every spawn of a RIFTBORN run.
 *
 * - Busy from the first second: an opening ring of fodder already on screen,
 *   constant fodder streams the starter weapon mows down, a first swarm at
 *   0:25 and elites from 0:45.
 * - A density curve that climbs to a ~550 population cap by 12:00, with each
 *   body kept flimsy (hpCurve) so the horde dies in the thousands.
 * - New enemy types unlock over time; a rotating "theme" boosts a family of
 *   them for a minute or so, so stretches of the run feel different.
 * - Announced events every 30-45 s (encirclements, ambush rings, meteor
 *   showers, golden hordes, elite parades, phalanx lines ...).
 * - Rift Champions (chest-dropping mini-bosses) between the bosses.
 * - The five bosses at RIFTBORN_BOSS_TIMES, warned a few seconds early, with
 *   HP scaled by a running estimate of the player's damage output.
 */
import { RIFTBORN_BOSS_TIMES } from '#shared/utils/gamelogic/riftborn'
import { BOSS_DEFS, BOSS_ORDER, resetBossState } from './bosses'
import { chance, hpCurve, later, offscreenRadius, pick, rand, resetMotionProbe, resetTimeline, tickBuffs, tickTimeline } from './content-ai'
import type { Director, Enemy, GameApi } from './types'

const TAU = Math.PI * 2
const POP_CAP = 550
/** Events and streams may overshoot the cap a little, never more */
const HARD_CAP = 600

interface Entry {
    id: string
    from: number
    weight: number
    group: [number, number]
    /** Early fodder thins out as the run goes on */
    fodder?: boolean
}

const ROSTER: Entry[] = [
    { id: 'ghoul', from: 0, weight: 10, group: [3, 6], fodder: true },
    { id: 'bat', from: 0, weight: 8, group: [4, 8], fodder: true },
    { id: 'mite', from: 18, weight: 4, group: [5, 9], fodder: true },
    { id: 'slime', from: 35, weight: 3.5, group: [2, 3] },
    { id: 'beetle', from: 50, weight: 3, group: [6, 10], fodder: true },
    { id: 'crystal', from: 70, weight: 3, group: [3, 5] },
    { id: 'archer', from: 75, weight: 2.5, group: [1, 3] },
    { id: 'charger', from: 95, weight: 2.5, group: [1, 3] },
    { id: 'herald', from: 115, weight: 1, group: [1, 1] },
    { id: 'bomber', from: 130, weight: 2.5, group: [1, 3] },
    { id: 'spider', from: 150, weight: 3.5, group: [3, 6] },
    { id: 'stalker', from: 170, weight: 2, group: [1, 2] },
    { id: 'ghost', from: 200, weight: 2.5, group: [2, 3] },
    { id: 'imp', from: 230, weight: 2.5, group: [2, 3] },
    { id: 'mimic', from: 240, weight: 0.08, group: [1, 1] },
    { id: 'hoplite', from: 250, weight: 2, group: [2, 4] },
    { id: 'cultist', from: 260, weight: 1.2, group: [1, 1] },
    { id: 'lurker', from: 285, weight: 1.4, group: [1, 1] },
    { id: 'wisp', from: 300, weight: 2, group: [1, 2] },
    { id: 'drone', from: 330, weight: 2.5, group: [2, 3] },
    { id: 'shieldbearer', from: 390, weight: 2, group: [2, 3] },
    { id: 'worm', from: 420, weight: 1.5, group: [1, 2] },
    { id: 'gazer', from: 460, weight: 1.5, group: [1, 1] },
    { id: 'brute', from: 500, weight: 1.2, group: [1, 1] },
    { id: 'skull', from: 540, weight: 5, group: [4, 8], fodder: true },
    { id: 'knight', from: 600, weight: 2, group: [1, 2] },
    { id: 'golem', from: 660, weight: 1.2, group: [1, 1] }
]

const THEMES: { name: string, ids: string[] }[] = [
    { name: 'undead', ids: ['ghoul', 'archer', 'skull', 'knight', 'ghost', 'herald'] },
    { name: 'beasts', ids: ['bat', 'charger', 'spider', 'worm', 'lurker'] },
    { name: 'arcane', ids: ['cultist', 'wisp', 'gazer', 'ghost', 'mite', 'crystal'] },
    { name: 'inferno', ids: ['imp', 'bomber', 'skull', 'beetle'] },
    { name: 'earth', ids: ['slime', 'worm', 'brute', 'golem', 'shieldbearer', 'lurker'] },
    { name: 'legion', ids: ['hoplite', 'shieldbearer', 'knight', 'archer'] },
    { name: 'void', ids: ['stalker', 'drone', 'mite', 'crystal'] }
]

const ELITE_POOL = ['ghoul', 'slime', 'charger', 'archer', 'crystal', 'herald', 'stalker', 'ghost', 'imp', 'hoplite', 'cultist', 'drone', 'shieldbearer', 'lurker', 'worm', 'gazer', 'brute', 'knight', 'golem', 'wisp']

/** Rift Champion mini-bosses: each drops an elite chest */
const CHAMPION_TIMES = [90, 270, 450, 630, 810]
/** Seconds of measured damage output a champion soaks */
const CHAMPION_SOAK = [6, 7, 8, 9, 9]

/**
 * Seconds of the player's measured damage output (summed over the whole
 * horde, so area weapons count fully) each boss should soak
 */
const BOSS_SOAK = [9, 11, 13, 15, 22]

// ─── Geometry ────────────────────────────────────────────────────────────

/** Point just outside the view rectangle in direction `angle` (negative margin = inside) */
function edgePoint(g: GameApi, angle: number, margin = 70): { x: number, y: number } {
    const hw = g.view.width / 2 + margin
    const hh = g.view.height / 2 + margin
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const t = Math.min(Math.abs(c) > 1e-6 ? hw / Math.abs(c) : Infinity, Math.abs(s) > 1e-6 ? hh / Math.abs(s) : Infinity)
    return { x: g.player.x + c * t, y: g.player.y + s * t }
}

/** Mostly random, but biased toward where the player is heading */
function spawnAngle(g: GameApi): number {
    const sp = Math.hypot(g.player.vx, g.player.vy)
    if (sp > 30 && chance(0.45)) return Math.atan2(g.player.vy, g.player.vx) + rand(-0.9, 0.9)
    return rand(0, TAU)
}

// ─── Director ────────────────────────────────────────────────────────────

export function createDirector(): Director {
    resetTimeline()
    resetBossState()
    resetMotionProbe()

    let budget = 0
    let streamTimer = 2.5
    let eliteTimer = 0.5
    let eventTimer = 40
    let themeTimer = 150
    let theme: string[] = []
    let lastEvents: string[] = []
    let bossIndex = 0
    let champIndex = 0
    let warned = -1
    let bosses: Enemy[] = []
    let bossMusic = false
    let finalSpawned = false
    let finalDead = false
    let opened = false
    let firstSwarm = false

    // damage-output estimate for boss scaling
    let lastDealt = -1
    let favor: readonly string[] = []
    let sampleT = 0
    let dmgAcc = 0
    let dps = 0
    let peakDps = 0

    /** Bodies per second the trash spawner aims for */
    function rate(t: number): number {
        return 3.4 + (t / 60) * 1.25 + (t / 300) ** 2 * 2.6
    }

    function cap(t: number): number {
        return Math.min(POP_CAP, 40 + t * 0.65 + (t / 60) ** 2 * 1.2)
    }

    function bossAlive(): boolean {
        return bosses.some(b => !b.dead)
    }

    function spawnOne(g: GameApi, id: string, x: number, y: number, opts: { elite?: boolean, hpMul?: number } = {}): Enemy | null {
        if (g.enemyCount >= HARD_CAP && !BOSS_DEFS[id] && id !== 'champion') return null
        try {
            return g.spawn(id, x, y, { hpMul: opts.hpMul ?? hpCurve(g.time), elite: opts.elite })
        } catch {
            return null
        }
    }

    function spawnGroup(g: GameApi, id: string, n: number, angle = spawnAngle(g)): void {
        const p = edgePoint(g, angle, rand(40, 100))
        const spread = 30 + n * 5
        for (let i = 0; i < n; i++) spawnOne(g, id, p.x + rand(-spread, spread), p.y + rand(-spread, spread))
    }

    function weightOf(entry: Entry, t: number): number {
        if (t < entry.from) return 0
        let w = entry.weight * Math.min(1, (t - entry.from) / 40 + 0.25)
        if (entry.fodder) w *= Math.max(0.35, 1 - t / 900)
        if (theme.includes(entry.id)) w *= 3
        if (favor.includes(entry.id)) w *= 2.5
        return w
    }

    function pickEntry(t: number): Entry {
        const weights = ROSTER.map(e => weightOf(e, t))
        const total = weights.reduce((s, w) => s + w, 0)
        let roll = rand(0, total)
        for (let i = 0; i < ROSTER.length; i++) {
            roll -= weights[i]!
            if (roll <= 0) return ROSTER[i]!
        }
        return ROSTER[0]!
    }

    function unlocked(t: number, ids: string[]): string[] {
        const out = ids.filter(id => {
            const entry = ROSTER.find(r => r.id === id)
            return !entry || entry.from <= t
        })
        return out.length ? out : ['ghoul']
    }

    function fodderFor(t: number): string[] {
        if (t < 18) return ['ghoul', 'bat']
        if (t < 50) return ['ghoul', 'bat', 'mite']
        if (t < 300) return ['ghoul', 'bat', 'mite', 'beetle']
        if (t < 540) return ['bat', 'mite', 'beetle', 'crystalShard', 'spider']
        return ['skull', 'mite', 'beetle', 'bat', 'spider']
    }

    // ─── Scripted beats ──────────────────────────────────────────────────

    /** A loose ring of fodder already on screen when the run starts */
    function opening(g: GameApi): void {
        const n = 22
        const off = rand(0, TAU)
        for (let i = 0; i < n; i++) {
            const a = off + (i / n) * TAU + rand(-0.12, 0.12)
            const p = edgePoint(g, a, rand(-90, -30))
            spawnOne(g, i % 3 === 0 ? 'bat' : 'ghoul', p.x, p.y)
        }
        // and a second ring just behind it
        for (let i = 0; i < 14; i++) {
            const p = edgePoint(g, off + (i / 14) * TAU + 0.2, rand(30, 90))
            spawnOne(g, 'ghoul', p.x, p.y)
        }
    }

    /** A conga line of fodder crossing the screen: the mow-down stream */
    function stream(g: GameApi, t: number): void {
        const id = pick(fodderFor(t))
        const n = Math.round(rand(6, 10) * (1 + t / 400))
        const a = spawnAngle(g)
        const base = edgePoint(g, a, 60)
        const side = { x: -Math.sin(a), y: Math.cos(a) }
        const out = { x: Math.cos(a), y: Math.sin(a) }
        for (let i = 0; i < n; i++) {
            const lane = (i % 3 - 1) * 26
            spawnOne(g, id, base.x + side.x * lane + out.x * i * 22, base.y + side.y * lane + out.y * i * 22)
        }
    }

    // ─── Surprise events ─────────────────────────────────────────────────

    interface Event {
        id: string
        from: number
        weight: number
        run(g: GameApi, t: number): void
    }

    function ringOf(g: GameApi, t: number, n: number, ids: string[], r: number): void {
        const off = rand(0, TAU)
        for (let i = 0; i < n; i++) {
            const a = off + (i / n) * TAU
            spawnOne(g, ids[i % ids.length]!, g.player.x + Math.cos(a) * r, g.player.y + Math.sin(a) * r)
        }
    }

    function swarm(g: GameApi, t: number): void {
        const n = Math.min(80, Math.round(32 + t / 10))
        const ids = unlocked(t, t > 300 ? ['bat', 'mite', 'beetle'] : ['bat', 'ghoul', 'bat'])
        g.announce('SWARM', 0x9b3dff)
        g.sfx.play('telegraph', { pitch: 0.7, volume: 0.5 })
        ringOf(g, t, n, ids, Math.min(760, offscreenRadius(g, 20)))
    }

    const EVENTS: Event[] = [
        {
            id: 'encircle', from: 45, weight: 3,
            run(g, t) {
                const n = Math.min(90, Math.round(26 + t / 10))
                const ids = unlocked(t, t > 420 ? ['shieldbearer', 'hoplite', 'ghoul'] : t > 200 ? ['ghoul', 'ghoul', 'archer'] : ['ghoul'])
                g.announce('SURROUNDED', 0xff5a5a)
                ringOf(g, t, n, ids, Math.min(760, offscreenRadius(g, 30)))
            }
        },
        {
            id: 'bats', from: 40, weight: 3,
            run(g, t) {
                const n = Math.min(110, Math.round(40 + t / 9))
                const a = spawnAngle(g)
                g.announce('THE SKY DARKENS', 0x9b3dff)
                for (let i = 0; i < n; i++) {
                    const p = edgePoint(g, a + rand(-0.5, 0.5), rand(40, 240))
                    spawnOne(g, 'bat', p.x, p.y)
                }
            }
        },
        {
            id: 'ambush', from: 60, weight: 2.5,
            run(g, t) {
                // rift circles open on screen, then the horde pours out of them
                const n = Math.min(10, 5 + Math.floor(t / 120))
                const per = Math.min(8, 3 + Math.floor(t / 150))
                const ids = unlocked(t, t > 400 ? ['stalker', 'skull', 'imp'] : t > 170 ? ['stalker', 'ghoul', 'spider'] : ['ghoul', 'bat'])
                const r = Math.min(g.view.width, g.view.height) * 0.42
                const off = rand(0, TAU)
                g.announce('AMBUSH', 0xc77dff)
                g.sfx.play('telegraph', { pitch: 0.5, volume: 0.6 })
                for (let i = 0; i < n; i++) {
                    const a = off + (i / n) * TAU
                    const x = g.player.x + Math.cos(a) * r
                    const y = g.player.y + Math.sin(a) * r
                    g.telegraphCircle({ x, y, radius: 40, delay: 1, damage: 0, color: 0xc77dff })
                    later(1, gg => {
                        gg.particles(x, y, { count: 18, color: 0xc77dff, speed: 220, life: 0.45, size: 5 })
                        for (let k = 0; k < per; k++) spawnOne(gg, pick(ids), x + rand(-24, 24), y + rand(-24, 24))
                    })
                }
            }
        },
        {
            id: 'beetles', from: 70, weight: 2.5,
            run(g, t) {
                const n = Math.min(70, Math.round(26 + t / 12))
                const a = spawnAngle(g)
                g.announce('CINDER SWARM', 0xff7a1a)
                for (let i = 0; i < n; i++) {
                    const p = edgePoint(g, a + rand(-0.6, 0.6), rand(40, 260))
                    spawnOne(g, 'beetle', p.x, p.y)
                }
            }
        },
        {
            id: 'golden', from: 100, weight: 1.6,
            run(g, t) {
                // treasure goblins that run: catch them for a pile of XP
                const n = Math.min(16, 9 + Math.floor(t / 120))
                const r = Math.min(g.view.width, g.view.height) * 0.33
                const off = rand(0, TAU)
                g.announce('GOLDEN HORDE', 0xf5c451)
                g.sfx.play('chestReward', { volume: 0.6 })
                for (let i = 0; i < n; i++) {
                    const a = off + (i / n) * TAU
                    spawnOne(g, 'goblin', g.player.x + Math.cos(a) * r, g.player.y + Math.sin(a) * r)
                }
                const k = spawnOne(g, 'goblin', g.player.x + Math.cos(off) * r * 1.4, g.player.y + Math.sin(off) * r * 1.4, { elite: true })
                if (k) k.ai.life = 22
            }
        },
        {
            id: 'meteors', from: 110, weight: 2,
            run(g, t) {
                const n = Math.min(40, Math.round(16 + t / 25))
                const dur = 6
                g.announce('METEOR SHOWER', 0xff6a2b)
                g.sfx.play('bossWarning', { volume: 0.4, pitch: 1.4 })
                for (let i = 0; i < n; i++) {
                    const at = (i / n) * dur
                    later(at, gg => {
                        // half aimed at the player's path, half scattered
                        const lead = chance(0.5)
                        const x = gg.player.x + (lead ? gg.player.vx * 1.1 : 0) + rand(-1, 1) * gg.view.width * (lead ? 0.1 : 0.42)
                        const y = gg.player.y + (lead ? gg.player.vy * 1.1 : 0) + rand(-1, 1) * gg.view.height * (lead ? 0.1 : 0.42)
                        const r = rand(55, 95)
                        gg.telegraphCircle({ x, y, radius: r, delay: 1.2, damage: 18 + gg.time * 0.04, color: 0xff6a2b })
                        later(1.2, g3 => {
                            g3.particles(x, y, { count: 26, color: 0xff6a2b, speed: r * 4, life: 0.5, size: 6 })
                            g3.particles(x, y, { count: 10, color: 0xffe066, speed: r * 2.5, life: 0.4, size: 4 })
                            g3.particles(x, y, { count: 8, color: 0x3a2a2a, speed: r * 1.6, life: 0.9, size: 7 })
                            if (Math.hypot(g3.player.x - x, g3.player.y - y) < g3.view.width * 0.6) {
                                g3.shake(0.12)
                                g3.sfx.play('explosion', { volume: 0.45, pitch: rand(0.8, 1.2) })
                            }
                        })
                    })
                }
            }
        },
        {
            id: 'stampede', from: 110, weight: 2.5,
            run(g, t) {
                const n = Math.min(28, Math.round(10 + t / 45))
                const a = rand(0, TAU)
                const dirX = -Math.cos(a)
                const dirY = -Math.sin(a)
                const base = edgePoint(g, a, 120)
                const span = Math.max(g.view.width, g.view.height) * 0.9
                g.announce('STAMPEDE', 0xff7a3a)
                g.sfx.play('telegraph', { pitch: 0.6, volume: 0.6 })
                for (let i = 0; i < n; i++) {
                    const off = (i / Math.max(1, n - 1) - 0.5) * span
                    const e = spawnOne(g, 'charger', base.x - dirY * off + rand(-30, 30), base.y + dirX * off + rand(-30, 30))
                    if (e) {
                        e.ai.st = 'stampede'
                        e.ai.dx = dirX
                        e.ai.dy = dirY
                        e.ai.t = 7
                    }
                }
            }
        },
        {
            id: 'storm', from: 130, weight: 2.5,
            run(g, t) {
                const streams = t > 500 ? 6 : t > 300 ? 5 : 3
                const per = Math.min(24, Math.round(10 + t / 50))
                g.announce('RIFT STORM', 0xff3fa4)
                for (let s = 0; s < streams; s++) {
                    const a = rand(0, TAU)
                    for (let i = 0; i < per; i++) {
                        const p = edgePoint(g, a, 60 + i * 26)
                        const e = spawnOne(g, 'mite', p.x + rand(-14, 14), p.y + rand(-14, 14))
                        if (e) {
                            e.ai.stream = true
                            e.ai.h = a + Math.PI + rand(-0.08, 0.08)
                        }
                    }
                }
            }
        },
        {
            id: 'prism', from: 140, weight: 2,
            run(g, t) {
                const n = Math.min(40, Math.round(14 + t / 25))
                g.announce('PRISM TIDE', 0xff5ad8)
                for (let i = 0; i < n; i++) {
                    const p = edgePoint(g, (i / n) * TAU + rand(-0.1, 0.1), rand(40, 140))
                    spawnOne(g, 'crystal', p.x, p.y)
                }
            }
        },
        {
            id: 'slimes', from: 150, weight: 1.5,
            run(g, t) {
                const n = Math.min(44, Math.round(14 + t / 28))
                g.announce('SLIME TIDE', 0x2fd6b0)
                for (let i = 0; i < n; i++) {
                    const p = edgePoint(g, (i / n) * TAU + rand(-0.1, 0.1), rand(40, 120))
                    spawnOne(g, 'slime', p.x, p.y)
                }
            }
        },
        {
            id: 'bombers', from: 160, weight: 1.5,
            run(g, t) {
                const n = Math.min(32, Math.round(10 + t / 38))
                const a = rand(0, TAU)
                g.announce('POWDER KEGS', 0xff7a1a)
                for (let i = 0; i < n; i++) {
                    const side = i % 2 === 0 ? a : a + Math.PI
                    const p = edgePoint(g, side + rand(-0.4, 0.4), rand(40, 160))
                    spawnOne(g, 'bomber', p.x, p.y)
                }
            }
        },
        {
            id: 'parade', from: 200, weight: 1.8,
            run(g, t) {
                // a column of elites with an escort, marching in from one side
                const n = Math.min(7, 3 + Math.floor(t / 180))
                const pool = unlocked(t, ELITE_POOL.filter(id => id !== 'ghoul' && id !== 'slime'))
                const a = spawnAngle(g)
                g.announce('ELITE PARADE', 0xffd24a)
                g.sfx.play('spawnElite')
                for (let i = 0; i < n; i++) {
                    const p = edgePoint(g, a + (i - (n - 1) / 2) * 0.22, 80)
                    spawnOne(g, pick(pool), p.x, p.y, { elite: true })
                    for (let k = 0; k < 4; k++) spawnOne(g, pick(fodderFor(t)), p.x + rand(-50, 50), p.y + rand(-50, 50))
                }
            }
        },
        {
            id: 'ghosts', from: 220, weight: 1.8,
            run(g, t) {
                const n = Math.min(44, Math.round(16 + t / 28))
                g.announce('THE VEIL THINS', 0x7affff)
                for (let i = 0; i < n; i++) {
                    const p = edgePoint(g, rand(0, TAU), rand(40, 160))
                    spawnOne(g, 'ghost', p.x, p.y)
                }
            }
        },
        {
            id: 'treasure', from: 240, weight: 1,
            run(g, t) {
                const n = t > 600 ? 4 : 3
                const off = rand(0, TAU)
                g.announce('TREASURE?', 0xf5c451)
                g.sfx.play('chestDrop')
                const r = Math.min(g.view.width, g.view.height) * 0.38
                for (let i = 0; i < n; i++) {
                    const a = off + (i / n) * TAU
                    spawnOne(g, 'mimic', g.player.x + Math.cos(a) * r, g.player.y + Math.sin(a) * r)
                }
            }
        },
        {
            id: 'phalanx', from: 260, weight: 2,
            run(g, t) {
                // two ranks of hoplites marching across the screen
                const n = Math.min(16, Math.round(8 + t / 80))
                const a = rand(0, TAU)
                const base = edgePoint(g, a, 70)
                const span = Math.min(g.view.width, g.view.height) * 1.1
                const sx = -Math.sin(a)
                const sy = Math.cos(a)
                const hx = -Math.cos(a)
                const hy = -Math.sin(a)
                g.announce('PHALANX', 0xffb060)
                g.sfx.play('telegraph', { pitch: 0.45, volume: 0.6 })
                for (let rank = 0; rank < 2; rank++) {
                    for (let i = 0; i < n; i++) {
                        const off = (i / Math.max(1, n - 1) - 0.5) * span
                        const x = base.x + sx * off - hx * rank * 46
                        const y = base.y + sy * off - hy * rank * 46
                        const e = spawnOne(g, rank === 0 || t < 400 ? 'hoplite' : 'shieldbearer', x, y)
                        if (e && e.def.id === 'hoplite') {
                            e.ai.st = 'march'
                            e.ai.hx = hx
                            e.ai.hy = hy
                            e.ai.m = 7
                        }
                    }
                }
            }
        },
        {
            id: 'ritual', from: 300, weight: 1.3,
            run(g, t) {
                g.announce('THE RITUAL', 0xff3fa4)
                const n = t > 600 ? 6 : 4
                for (let i = 0; i < n; i++) {
                    const p = edgePoint(g, (i / n) * TAU + Math.PI / 4, 40)
                    spawnOne(g, 'cultist', p.x, p.y)
                }
            }
        },
        {
            id: 'procession', from: 320, weight: 1.5,
            run(g, t) {
                // banner carriers with an undead escort: kill the heralds first
                const n = t > 600 ? 4 : 3
                g.announce('GRAVE PROCESSION', 0x7dff9a)
                for (let i = 0; i < n; i++) {
                    const a = spawnAngle(g) + (i - 1) * 0.8
                    const p = edgePoint(g, a, 70)
                    spawnOne(g, 'herald', p.x, p.y, { elite: i === 0 && t > 480 })
                    for (let k = 0; k < 10; k++) spawnOne(g, t > 540 ? pick(['skull', 'knight', 'ghoul']) : pick(['ghoul', 'archer', 'ghoul']), p.x + rand(-70, 70), p.y + rand(-70, 70))
                }
            }
        },
        {
            id: 'brood', from: 380, weight: 1.8,
            run(g, t) {
                const n = Math.min(64, Math.round(24 + t / 22))
                const a = spawnAngle(g)
                g.announce('THE BROOD', 0x7dff6a)
                for (let i = 0; i < n; i++) {
                    const p = edgePoint(g, a + rand(-0.8, 0.8), rand(40, 200))
                    spawnOne(g, 'spider', p.x, p.y)
                }
            }
        },
        {
            id: 'quake', from: 400, weight: 1.4,
            run(g, t) {
                const n = Math.min(8, 3 + Math.floor((t - 380) / 100))
                g.announce('TREMORS', 0xe0a050)
                g.shake(0.3)
                g.sfx.play('quake', { volume: 0.6 })
                for (let i = 0; i < n; i++) {
                    const p = edgePoint(g, (i / n) * TAU, rand(-60, 40))
                    spawnOne(g, i % 3 === 2 ? 'worm' : 'lurker', p.x, p.y)
                }
            }
        },
        {
            id: 'wall', from: 420, weight: 1.3,
            run(g, t) {
                const n = Math.min(26, Math.round(10 + t / 55))
                const a = rand(0, TAU)
                const base = edgePoint(g, a, 60)
                const span = Math.max(g.view.width, g.view.height)
                const dx = -Math.sin(a)
                const dy = Math.cos(a)
                g.announce('IRON WALL', 0x9fb4d0)
                for (let i = 0; i < n; i++) {
                    const off = (i / Math.max(1, n - 1) - 0.5) * span
                    spawnOne(g, i % 4 === 0 ? 'knight' : 'shieldbearer', base.x + dx * off, base.y + dy * off)
                }
            }
        },
        {
            id: 'giants', from: 520, weight: 1.3,
            run(g, t) {
                const n = Math.min(9, 3 + Math.floor((t - 500) / 110))
                g.announce('GIANTS', 0x7ff0ff)
                g.shake(0.4)
                for (let i = 0; i < n; i++) {
                    const p = edgePoint(g, rand(0, TAU), 80)
                    spawnOne(g, i % 2 === 0 ? 'brute' : 'golem', p.x, p.y)
                }
            }
        },
        {
            id: 'cinders', from: 560, weight: 2,
            run(g, t) {
                const n = Math.min(100, Math.round(36 + (t - 560) / 7))
                g.announce('CINDER STORM', 0xff6a2b)
                for (let i = 0; i < n; i++) {
                    const p = edgePoint(g, rand(0, TAU), rand(40, 240))
                    spawnOne(g, i % 5 === 0 ? 'imp' : i % 3 === 0 ? 'beetle' : 'skull', p.x, p.y)
                }
            }
        },
        {
            id: 'void', from: 600, weight: 1.5,
            run(g, t) {
                const n = Math.min(26, Math.round(12 + (t - 600) / 20))
                g.announce('VOID INCURSION', 0xc77dff)
                for (let i = 0; i < n; i++) {
                    const p = edgePoint(g, rand(0, TAU), rand(30, 160))
                    spawnOne(g, i % 4 === 0 ? 'drone' : 'stalker', p.x, p.y)
                }
            }
        }
    ]

    function runEvent(g: GameApi, t: number): void {
        const pool = EVENTS.filter(e => e.from <= t && !lastEvents.includes(e.id))
        if (!pool.length) return
        const total = pool.reduce((s, e) => s + e.weight, 0)
        let roll = rand(0, total)
        let ev = pool[pool.length - 1]!
        for (const e of pool) {
            roll -= e.weight
            if (roll <= 0) {
                ev = e
                break
            }
        }
        lastEvents = [ev.id, ...lastEvents].slice(0, 4)
        ev.run(g, t)
    }

    // ─── Damage-output estimate ──────────────────────────────────────────

    function sampleDamage(g: GameApi, dt: number): void {
        sampleT += dt
        if (sampleT < 0.25) return
        // Real hits only: enemies removed by scripts (wyrm segments, despawns) don't count
        const dealt = g.damageDealt ?? 0
        if (lastDealt >= 0) dmgAcc += Math.max(0, dealt - lastDealt)
        lastDealt = dealt
        const now = dmgAcc / sampleT
        dmgAcc = 0
        sampleT = 0
        dps += (now - dps) * 0.03
        peakDps = Math.max(peakDps * 0.999, dps)
    }

    // ─── Bosses & champions ──────────────────────────────────────────────

    function spawnBoss(g: GameApi, index: number): boolean {
        const id = BOSS_ORDER[index]!
        const def = BOSS_DEFS[id]!
        const soak = BOSS_SOAK[index] ?? 60
        const hpMul = Math.max(0.6, Math.min(4, (peakDps * soak) / def.hp))
        const a = spawnAngle(g)
        const r = Math.min(g.view.width, g.view.height) / 2 + 40
        const x = g.player.x + Math.cos(a) * r
        const y = g.player.y + Math.sin(a) * r
        const boss = spawnOne(g, id, x, y, { hpMul })
        if (!boss) return false
        bosses.push(boss)
        if (def.final) finalSpawned = true
        if (!bossMusic) {
            bossMusic = true
            g.sfx.music('boss')
        }
        return true
    }

    function spawnChampion(g: GameApi, index: number): void {
        const base = 950 * 2
        const soak = CHAMPION_SOAK[index] ?? 9
        const hpMul = Math.max(hpCurve(g.time) * 1.2, Math.min(4, (peakDps * soak) / base))
        const p = edgePoint(g, spawnAngle(g), 60)
        const e = spawnOne(g, 'champion', p.x, p.y, { elite: true, hpMul })
        if (!e) return
        g.announce('A CHAMPION COMES', 0xff3fa4)
        g.sfx.play('bossWarning', { volume: 0.5, pitch: 1.25 })
        g.shake(0.25)
        for (let k = 0; k < 8; k++) spawnOne(g, pick(fodderFor(g.time)), p.x + rand(-80, 80), p.y + rand(-80, 80))
    }

    function bossName(index: number): string {
        return (BOSS_DEFS[BOSS_ORDER[index]!]?.name ?? 'boss').toUpperCase()
    }

    return {
        update(g, dt) {
            if (dt <= 0) return
            const t = g.time
            tickTimeline(g, dt)
            tickBuffs(g, dt)
            sampleDamage(g, dt)
            favor = g.biome?.favor ?? []

            if (!opened) {
                opened = true
                opening(g)
            }

            // boss schedule
            if (bossIndex < RIFTBORN_BOSS_TIMES.length) {
                const at = RIFTBORN_BOSS_TIMES[bossIndex]!
                if (warned < bossIndex && t >= at - 6) {
                    warned = bossIndex
                    const final = bossIndex === RIFTBORN_BOSS_TIMES.length - 1
                    g.announce(final ? 'THE RIFT TEARS' : `${bossName(bossIndex)} APPROACHES`, final ? 0xff3fa4 : 0xff4a4a)
                    g.sfx.play('bossWarning')
                    g.shake(0.2)
                }
                // Never while the player is between biomes; the boss waits for the arrival
                if (t >= at && !g.calm && spawnBoss(g, bossIndex)) bossIndex++
            }

            const live = bossAlive()
            if (bosses.length && !live) {
                if (bosses.some(b => b.def.final)) finalDead = true
                bosses = []
                if (bossMusic && !finalDead) {
                    bossMusic = false
                    g.sfx.music('run')
                }
            }
            if (finalDead || g.calm) return

            // champions (pushed back while a boss is up)
            const champAt = CHAMPION_TIMES[champIndex]
            if (champAt !== undefined && t >= champAt) {
                if (!live) spawnChampion(g, champIndex)
                if (!live || t > champAt + 40) champIndex++
            }

            // themes
            themeTimer -= dt
            if (themeTimer <= 0) {
                themeTimer = rand(55, 85)
                const options = THEMES.filter(th => unlocked(t, th.ids).length >= 2)
                theme = options.length && chance(0.75) ? pick(options).ids : []
            }

            // trash
            const pressure = live ? (finalSpawned ? 0.65 : 0.4) : 1
            const limit = cap(t) * (live ? (finalSpawned ? 0.8 : 0.6) : 1)
            budget += rate(t) * pressure * dt
            budget = Math.min(budget, 60)
            let guard = 0
            while (budget >= 1 && g.enemyCount < limit && guard++ < 14) {
                const entry = pickEntry(t)
                const n = Math.max(1, Math.round(rand(entry.group[0], entry.group[1]) * (1 + t / 900)))
                spawnGroup(g, entry.id, n)
                budget -= n
            }
            if (g.enemyCount >= limit) budget = Math.min(budget, 6)

            // fodder streams: a line of easy kills every few seconds
            streamTimer -= dt * (live ? 0.5 : 1)
            if (streamTimer <= 0) {
                streamTimer = Math.max(2.2, 5 - t / 120) * rand(0.8, 1.2)
                if (g.enemyCount < Math.min(POP_CAP, limit + 30)) stream(g, t)
            }

            // the first swarm, so the opening minute has a beat
            if (!firstSwarm && t >= 25) {
                firstSwarm = true
                swarm(g, t)
            }

            // elites
            if (t >= 45) {
                eliteTimer -= dt * (live ? 0.5 : 1)
                if (eliteTimer <= 0) {
                    eliteTimer = Math.max(8, 34 - t / 26) * rand(0.8, 1.2)
                    const pool = unlocked(t, ELITE_POOL)
                    if (g.enemyCount < POP_CAP) {
                        const p = edgePoint(g, spawnAngle(g), 80)
                        if (spawnOne(g, pick(pool), p.x, p.y, { elite: true })) g.sfx.play('spawnElite', { volume: 0.7 })
                    }
                }
            }

            // events: never right before a boss or champion, and only during
            // the final fight among the boss fights
            eventTimer -= dt
            const nextBoss = RIFTBORN_BOSS_TIMES[bossIndex]
            const nextChamp = CHAMPION_TIMES[champIndex]
            const bossSoon = (nextBoss !== undefined && nextBoss - t < 15) || (nextChamp !== undefined && nextChamp - t < 6 && nextChamp - t > 0)
            if (eventTimer <= 0) {
                if ((live && !finalSpawned) || bossSoon) {
                    eventTimer = 5
                } else {
                    eventTimer = finalSpawned ? rand(24, 32) : rand(30, 42)
                    if (g.enemyCount < POP_CAP - 30) runEvent(g, t)
                }
            }
        }
    }
}
