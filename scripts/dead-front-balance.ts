// Headless balance run: bot squads hold the square on the real map for ten
// rounds, shooting what they can see with a human-ish hit rate, buying the
// square's wall gun once they can. Prints points earned per player per round
// next to what things cost, so pacing changes can be judged from numbers.
//
//   bun --tsconfig-override scripts/tsconfig.shapezz-playtest.json scripts/dead-front-balance.ts
//
// What to look for: round 1 alone opens a door, by round 5 a perk and the box,
// by round 10 Pack-a-Punch is within reach; rounds stay short early and grow later.
import { createError } from 'h3'
import { DF_COSTS, DF_PLAYER } from '#shared/utils/dead-front/constants'
import { dfZombieHitTest } from '#shared/utils/dead-front/enemies'
import { DF_MAP } from '#shared/utils/dead-front/map'
import { DF_PERKS } from '#shared/utils/dead-front/perks'
import { dfLineOfSight } from '#shared/utils/dead-front/physics'
import { TWO_POW_26, TWO_POW_53 } from '#shared/utils/random'
import { DF_WEAPONS } from '#shared/utils/dead-front/weapons'
import type { DfWeaponId } from '#shared/utils/dead-front/types'
import { DfMatchSim } from '#server/utils/dead-front/sim'

Object.assign(globalThis, { createError })

/** Pins randomFloat() to `next` by feeding the entropy underneath it (see test/setup/stub-random.ts). */
function stubRandomFloat(next: () => number) {
    const original = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    globalThis.crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
        const buf = array as unknown as Uint32Array
        const target = Math.max(0, Math.min(TWO_POW_53 - 1, Math.floor(next() * TWO_POW_53)))
        buf[0] = (Math.floor(target / TWO_POW_26) << 5) >>> 0
        buf[1] = ((target % TWO_POW_26) << 6) >>> 0
        return array
    }) as typeof globalThis.crypto.getRandomValues
    return { mockRestore: () => { globalThis.crypto.getRandomValues = original } }
}

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

const costs = {
    door: Math.min(...DF_MAP.doors.map(d => d.cost)),
    box: DF_COSTS.box,
    perk: Math.min(...Object.values(DF_PERKS).map(p => p.cost)),
    pap: DF_COSTS.pap[0]
}
const table: string[] = []
for (const players of [1, 2, 4]) {
    // pin the sim's own rolls (spawns, gaits, the box) too, or round lengths vary run to run
    const spy = stubRandomFloat(lcg(1234))
    let lines: RoundLine[]
    try {
        lines = playRounds(players, 10, 0.65)
    } finally {
        spy.mockRestore()
    }
    table.push(`--- ${players} player(s): costs door ${costs.door} box ${costs.box} perk ${costs.perk} PaP ${costs.pap}`)
    table.push('round  kills  secs  earned/p  banked/p  hits taken')
    let cumulative = 0
    for (const l of lines) {
        cumulative += l.pointsPerPlayer
        table.push(`${String(l.round).padStart(5)}  ${String(l.kills).padStart(5)}  ${String(l.seconds).padStart(4)}  ${String(l.pointsPerPlayer).padStart(8)}  ${String(l.banked).padStart(8)}  ${String(l.hitsTaken).padStart(10)}   (total ${cumulative})`)
    }
}
console.log(table.join('\n'))
