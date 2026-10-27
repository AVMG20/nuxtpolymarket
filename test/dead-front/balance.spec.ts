import { describe, expect, it } from 'vitest'
import { DF_COSTS, DF_PLAYER } from '#shared/utils/dead-front/constants'
import { dfZombieHitTest } from '#shared/utils/dead-front/enemies'
import { DF_MAP } from '#shared/utils/dead-front/map'
import { DF_PERKS } from '#shared/utils/dead-front/perks'
import { dfLineOfSight } from '#shared/utils/dead-front/physics'
import { DF_WEAPONS, DF_WEAPON_IDS, dfBoxPool, dfBoxWeight, dfWeaponStats } from '#shared/utils/dead-front/weapons'
import type { DfWeaponId } from '#shared/utils/dead-front/types'
import { dfBoxRoll } from '#server/utils/dead-front/rules'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import { stubRandomFloat } from '../setup/stub-random'

// Headless balance run: bot squads hold the square on the real map for ten
// rounds, shooting what they can see with a human-ish hit rate, buying the
// square's wall gun once they can. Prints points earned per player per round
// next to what things cost, so pacing changes can be judged from numbers.
// Run with `bunx vitest run test/dead-front/balance --silent=false` to see the table.

interface RoundLine {
    round: number
    zombies: number
    seconds: number
    pointsPerPlayer: number
    banked: number
    kills: number
    hitsTaken: number
}

/** Deterministic noise for the bots' aim and the sim's rolls, so runs are comparable. */
function lcg(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0
        return s / 4294967296
    }
}

function playRounds(players: number, rounds: number, accuracy: number, seed = 7): RoundLine[] {
    let sim: DfMatchSim | null = null
    sim = new DfMatchSim(Array.from({ length: players }, (_, i) => ({ userId: `bot${i}`, name: `Bot ${i}`, startWeapon: 'm1911' as DfWeaponId, attachments: {}, perkMods: {} })), {
        now: () => sim?.time ?? 0,
        startDelay: 1
    })
    const s = sim
    const rand = lcg(seed)
    // we measure pace and income, not survival: count the hits a zombie lands but don't apply them
    let hitsTaken = 0
    ;(s as unknown as { hurtPlayer: (...a: unknown[]) => void }).hurtPlayer = () => {
        hitsTaken++
    }
    const posts = s.players.map((p, i) => ({ ...DF_MAP.playerSpawns[i % DF_MAP.playerSpawns.length]! }))
    const wall = DF_MAP.wallBuys.find(w => w.zone === DF_MAP.startZone && w.weapon !== 'kar98k') ?? DF_MAP.wallBuys[0]
    const lines: RoundLine[] = []
    let round = 0
    let roundStart = 0
    let earned = 0
    let killsAt = 0
    let killCount = 0
    const nextShot = new Map<number, number>()
    for (let tick = 0; tick < 20 * 60 * 40 && !s.over; tick++) {
        for (const p of s.players) {
            if (p.life !== 'alive') continue
            p.pos = { ...posts[p.pid]! }
            const w = p.weapons[p.slot]
            if (!w) continue
            // buy the wall gun once it's affordable with some change left
            if (wall && w.id === 'm1911' && p.points >= (DF_WEAPONS[wall.weapon].wallCost ?? 1e9) + 300) {
                p.pos = { x: wall.pos.x + wall.normal.x * 1.2, y: DF_MAP.playerSpawns[0]!.y, z: wall.pos.z + wall.normal.z * 1.2 }
                s.use(p.pid, wall.id)
                p.pos = { ...posts[p.pid]! }
            }
            if (w.mag === 0) {
                if (w.reserve === 0) w.reserve = w.stats.magSize * 4 // max-ammo stand-in
                s.reload(p.pid)
                continue
            }
            if ((nextShot.get(p.pid) ?? 0) > s.time) continue
            const eye = { x: p.pos.x, y: p.pos.y + DF_PLAYER.eyeHeight, z: p.pos.z }
            let best: { id: number, dir: { x: number, y: number, z: number }, d: number, z: (typeof s.zombies)[number] } | null = null
            for (const z of s.zombies) {
                if (!z.inside) continue
                const aim = { x: z.pos.x, y: z.pos.y + z.def.height * 0.6, z: z.pos.z }
                const d = Math.hypot(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z)
                if (d > 22 || (best && d >= best.d) || !dfLineOfSight(s.world, eye, aim)) continue
                best = { id: z.id, dir: { x: (aim.x - eye.x) / d, y: (aim.y - eye.y) / d, z: (aim.z - eye.z) / d }, d, z }
            }
            if (!best) continue
            nextShot.set(p.pid, s.time + 60 / (w.stats.rpm * p.effects.fireRateMult) * (w.stats.fireMode === 'auto' ? 1 : 1.6))
            const head = rand() < 0.22
            const z = best.z
            let dir = best.dir
            if (head) {
                const h = { x: z.pos.x, y: z.pos.y + z.def.headY, z: z.pos.z }
                const d = Math.hypot(h.x - eye.x, h.y - eye.y, h.z - eye.z)
                dir = { x: (h.x - eye.x) / d, y: (h.y - eye.y) / d, z: (h.z - eye.z) / d }
            }
            const hit = rand() < accuracy ? dfZombieHitTest({ type: z.type, pos: z.pos, yaw: z.yaw, anim: z.anim }, eye, dir, 60) : null
            const pellets = Math.max(1, w.stats.pellets)
            s.fire(p.pid, { origin: eye, dirs: Array.from({ length: pellets }, () => dir), hits: hit ? Array.from({ length: Math.max(1, Math.round(pellets * 0.6)) }, () => ({ z: z.id, zone: hit.zone, dist: hit.dist })) : [] })
        }
        s.step(0.05)
        for (const e of s.snapshot().events) {
            if (e.k === 'points' && e.amount > 0) earned += e.amount
            if (e.k === 'kill') killCount++
            if (e.k === 'round') {
                if (round > 0) {
                    const kills = killCount
                    lines.push({
                        round,
                        zombies: kills - killsAt,
                        seconds: Math.round(s.time - roundStart),
                        pointsPerPlayer: Math.round(earned / s.players.length),
                        banked: Math.round(s.players.reduce((a, p) => a + p.points, 0) / s.players.length),
                        kills: kills - killsAt,
                        hitsTaken
                    })
                    killsAt = kills
                }
                round = e.round
                roundStart = s.time
                earned = 0
                hitsTaken = 0
            }
        }
        if (round > rounds) break
    }
    return lines
}

describe('balance (headless bots)', () => {
    it('earns enough to open the map and buy perks by mid-game, solo and in co-op', () => {
        const costs = {
            door: Math.min(...DF_MAP.doors.map(d => d.cost)),
            box: DF_COSTS.box,
            perk: Math.min(...Object.values(DF_PERKS).map(p => p.cost)),
            pap: DF_COSTS.pap[0]
        }
        const table: string[] = []
        const results: Record<number, RoundLine[]> = {}
        for (const players of [1, 2, 4]) {
            // pin the sim's own rolls (spawns, gaits, the box) too, or round lengths vary run to run
            const spy = stubRandomFloat(lcg(1234))
            let lines: RoundLine[]
            try {
                lines = playRounds(players, 10, 0.65)
            } finally {
                spy.mockRestore()
            }
            results[players] = lines
            table.push(`--- ${players} player(s): costs door ${costs.door} box ${costs.box} perk ${costs.perk} PaP ${costs.pap}`)
            table.push('round  kills  secs  earned/p  banked/p  hits taken')
            let cumulative = 0
            for (const l of lines) {
                cumulative += l.pointsPerPlayer
                table.push(`${String(l.round).padStart(5)}  ${String(l.kills).padStart(5)}  ${String(l.seconds).padStart(4)}  ${String(l.pointsPerPlayer).padStart(8)}  ${String(l.banked).padStart(8)}  ${String(l.hitsTaken).padStart(10)}   (total ${cumulative})`)
            }
        }
        console.log(`[balance]\n${table.join('\n')}`)
        for (const players of [1, 2, 4]) {
            const lines = results[players]!
            expect(lines.length).toBeGreaterThanOrEqual(9)
            const total = (n: number) => lines.slice(0, n).reduce((a, l) => a + l.pointsPerPlayer, 0)
            // round 1 alone opens a door; by round 5 a perk and the box; by round 10 Pack-a-Punch is within reach
            expect(total(1) + 500).toBeGreaterThanOrEqual(costs.door)
            expect(total(5)).toBeGreaterThanOrEqual(costs.perk + costs.box)
            expect(total(10)).toBeGreaterThanOrEqual(costs.pap)
            // rounds stay short early and grow later (a gas round's smaller pack can be short, so take the longest late round)
            expect(lines[0]!.seconds).toBeLessThan(60)
            expect(Math.max(...lines.slice(6, 9).map(l => l.seconds))).toBeGreaterThan(lines[0]!.seconds)
        }
    }, 120_000)
})

describe('weapon niches and the box', () => {
    const stat = (id: DfWeaponId) => dfWeaponStats(id, 0)
    const dps = (id: DfWeaponId) => stat(id).damage * stat(id).pellets * stat(id).rpm / 60
    const bullets = (id: DfWeaponId, hp: number) => Math.ceil(hp / (stat(id).damage * stat(id).pellets))

    it('gives every gun a job', () => {
        const hitscan = DF_WEAPON_IDS.filter(id => stat(id).shot === 'hitscan')
        // the Kar98k hits hardest per shot and goes through a line
        expect(hitscan.every(id => id === 'kar98k' || stat(id).damage * stat(id).headMult < stat('kar98k').damage * stat('kar98k').headMult)).toBe(true)
        expect(stat('kar98k').penetration).toBeGreaterThanOrEqual(2)
        // the trench gun owns point-blank among repeaters: the biggest single trigger pull
        // (the coach gun hits harder still, but only twice before it breaks open)
        expect(hitscan.every(id => id === 'm1897' || id === 'sawnoff' || bullets(id, 330) > bullets('m1897', 330))).toBe(true)
        expect(stat('sawnoff').magSize).toBeLessThan(stat('m1897').magSize)
        // the Thompson out-damages the cheaper MP18, which is steadier
        expect(dps('thompson')).toBeGreaterThan(dps('mp18'))
        expect(stat('mp18').recoil).toBeLessThan(stat('thompson').recoil)
        // the Lewis carries the most damage per magazine, the BAR reaches furthest of the autos
        const magDamage = (id: DfWeaponId) => stat(id).magSize * stat(id).damage * stat(id).pellets
        expect(hitscan.every(id => id === 'lewis' || magDamage(id) < magDamage('lewis'))).toBe(true)
        // the PPSh has the biggest drum and the fastest cycle, but lighter rounds and no more sustained damage than the Thompson
        expect(hitscan.every(id => id === 'ppsh' || (stat(id).magSize < stat('ppsh').magSize && stat(id).rpm < stat('ppsh').rpm))).toBe(true)
        expect(stat('ppsh').damage).toBeLessThan(stat('thompson').damage)
        expect(dps('ppsh')).toBeLessThanOrEqual(dps('thompson'))
        expect(dps('ppsh')).toBeGreaterThan(dps('mp18'))
        expect(stat('bar').range).toBeGreaterThan(stat('thompson').range)
        // the X-Ray splashes; the pistols kill a round-1 zombie with one headshot
        expect(stat('xray').splashRadius).toBeGreaterThan(0)
        expect(stat('m1911').damage * stat('m1911').headMult).toBeGreaterThanOrEqual(150)
        // a round-1 zombie takes a handful of SMG rounds, not a magazine
        expect(bullets('mp18', 150)).toBeLessThanOrEqual(3)
    })

    it('keeps the X-Ray rare but real, and never rolls the wonder weapon', () => {
        const pool = dfBoxPool()
        expect(pool).not.toContain('wunder')
        for (const id of pool) expect(dfBoxWeight(id)).toBeGreaterThan(0)
        let xray = 0
        const n = 20000
        for (let i = 0; i < n; i++) if (dfBoxRoll(pool, (i + 0.5) / n) === 'xray') xray++
        expect(xray / n).toBeGreaterThan(0.04)
        expect(xray / n).toBeLessThan(0.09)
        expect(dfBoxRoll(['c96'], 0.99)).toBe('c96')
    })
})
