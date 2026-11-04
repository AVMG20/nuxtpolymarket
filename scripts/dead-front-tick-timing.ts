// Headless server-tick timing: a four-bot squad (god mode, all doors open)
// fights a long match at a high round on the real map while every tick does
// what the match loop does (step, snapshot, serialise, per-player frames).
// Prints p50/p99/max per stage and the snapshot size, so tick jitter and
// periodic heavy work show up as numbers.
//
//   bun --tsconfig-override scripts/tsconfig.shapezz-playtest.json scripts/dead-front-tick-timing.ts [minutes] [round]
//
// What to look for: max step well under the 50 ms tick, no stage whose max is
// orders of magnitude above its p99 (a periodic spike), and a stable snapshot size.
import { createError } from 'h3'
import { DF_PLAYER } from '#shared/utils/dead-front/constants'
import { dfZombieHitTest } from '#shared/utils/dead-front/enemies'
import { DF_MAP } from '#shared/utils/dead-front/map'
import { dfLineOfSight } from '#shared/utils/dead-front/physics'
import { dfPackZombie } from '#shared/utils/dead-front/protocol'
import type { DfWeaponId } from '#shared/utils/dead-front/types'
import { DfMatchSim } from '#server/utils/dead-front/sim'

Object.assign(globalThis, { createError })

const minutes = Number(process.argv[2] ?? 10)
const startRound = Number(process.argv[3] ?? 12)
const PLAYERS = 4
const DT = 0.05

let sim: DfMatchSim | null = null
sim = new DfMatchSim(Array.from({ length: PLAYERS }, (_, i) => ({ userId: `bot${i}`, name: `Bot ${i}`, startWeapon: 'm1911' as DfWeaponId, attachments: {}, perkMods: {} })), {
    now: () => sim?.time ?? 0,
    startDelay: 1
})
const s = sim
const lead = s.players[0]!
s.dev(lead.pid, { k: 'points', amount: 1e6 })
for (let pass = 0; pass < DF_MAP.doors.length; pass++) {
    for (const d of DF_MAP.doors) {
        if (s.doors.has(d.id) || !d.zones.some(z => s.activeZones.has(z))) continue
        s.dev(lead.pid, { k: 'tp', pos: d.pos })
        s.use(lead.pid, d.id)
    }
}
for (const p of s.players) s.dev(p.pid, { k: 'god', on: true })
for (let t = 0; t < 40 && s.phase !== 'active'; t++) s.step(DT)
s.dev(lead.pid, { k: 'round', round: startRound })

// Bots walk a loop of nav nodes (so player nodes and distance fields change like a real match).
const inside = DF_MAP.nav.nodes.filter(n => !n.outside)
const routes = s.players.map((_, i) => inside.filter((_, k) => k % (PLAYERS * 7) === i * 7).map(n => n.pos))
const seqs = s.players.map(() => 0)
const legT = s.players.map(() => 0)
const legI = s.players.map((_, i) => i)

const stages = { step: [] as number[], snap: [] as number[], json: [] as number[], frames: [] as number[], tick: [] as number[] }
const bytes: number[] = []
const alive: number[] = []
const ticks = Math.round(minutes * 60 / DT)
const spikes: string[] = []
let lastRound = s.round
const t0 = performance.now()
for (let tick = 0; tick < ticks && !s.over; tick++) {
    // input + shooting (not timed: that's message handling, not the tick)
    for (const p of s.players) {
        if (p.life !== 'alive') {
            if (p.life === 'down') s.revive(p.pid, null)
            continue
        }
        const route = routes[p.pid]!
        const from = route[legI[p.pid]! % route.length]!
        const to = route[(legI[p.pid]! + 1) % route.length]!
        const legLen = Math.max(0.1, Math.hypot(to.x - from.x, to.z - from.z))
        legT[p.pid]! += DT * 4 / legLen
        if (legT[p.pid]! >= 1) {
            legT[p.pid] = 0
            legI[p.pid]!++
            s.dev(p.pid, { k: 'tp', pos: to })
        }
        const k = legT[p.pid]!
        s.input(p.pid, { seq: ++seqs[p.pid]!, pos: { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k }, yaw: 0, pitch: 0, flags: 0 })
        const w = p.weapons[p.slot]
        if (!w) continue
        if (w.mag === 0) {
            w.reserve = Math.max(w.reserve, w.stats.magSize * 4)
            s.reload(p.pid)
            continue
        }
        if (tick % 3 !== p.pid % 3) continue
        const eye = { x: p.pos.x, y: p.pos.y + DF_PLAYER.eyeHeight, z: p.pos.z }
        for (const z of s.zombies) {
            const aim = { x: z.pos.x, y: z.pos.y + z.def.height * 0.6, z: z.pos.z }
            const d = Math.hypot(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z)
            if (d > 25 || !dfLineOfSight(s.world, eye, aim)) continue
            const dir = { x: (aim.x - eye.x) / d, y: (aim.y - eye.y) / d, z: (aim.z - eye.z) / d }
            const hit = dfZombieHitTest({ type: z.type, pos: z.pos, yaw: z.yaw, anim: z.anim }, eye, dir, 60)
            s.fire(p.pid, { origin: eye, dirs: [dir], hits: hit ? [{ z: z.id, zone: hit.zone, dist: hit.dist }] : [] })
            break
        }
    }
    const a = performance.now()
    s.step(DT)
    const b = performance.now()
    const snap = s.snapshot()
    const c = performance.now()
    // as the match loop sends it (match.ts broadcastSnapshot)
    const shared = JSON.stringify({ ...snap, zombies: snap.zombies.map(dfPackZombie) })
    const d = performance.now()
    const head = `{"t":"snap","s":${shared.slice(0, -1)},"clk":${s.time},"ack":`
    let total = 0
    for (const p of s.players) total += `${head}${s.ack(p.pid)},"mine":${JSON.stringify(s.arsenal.mine(p.pid))}}}`.length
    const e = performance.now()
    stages.step.push(b - a)
    stages.snap.push(c - b)
    stages.json.push(d - c)
    stages.frames.push(e - d)
    stages.tick.push(e - a)
    bytes.push(total / PLAYERS)
    alive.push(s.zombies.length)
    if (e - a > 8 && spikes.length < 30) spikes.push(`t=${s.time.toFixed(2)} round=${s.round} ${(e - a).toFixed(1)}ms (step ${(b - a).toFixed(1)}, json ${(d - c).toFixed(1)}) zombies=${s.zombies.length}${s.round !== lastRound ? ' [round change]' : ''}`)
    lastRound = s.round
}
const wall = performance.now() - t0

function pct(arr: number[], q: number): number {
    const sorted = [...arr].sort((x, y) => x - y)
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
}
const n = stages.tick.length
console.log(`${n} ticks (${(n * DT / 60).toFixed(1)} sim min) in ${(wall / 1000).toFixed(1)} s; reached round ${s.round}; zombies alive avg ${(alive.reduce((x, y) => x + y, 0) / n).toFixed(1)}`)
console.log('stage    p50     p99     p99.9   max   (ms)')
for (const [name, arr] of Object.entries(stages)) {
    console.log(`${name.padEnd(7)} ${pct(arr, 0.5).toFixed(3).padStart(6)}  ${pct(arr, 0.99).toFixed(3).padStart(6)}  ${pct(arr, 0.999).toFixed(3).padStart(6)}  ${Math.max(...arr).toFixed(2).padStart(6)}`)
}
console.log(`frame bytes per player: p50 ${Math.round(pct(bytes, 0.5))}  p99 ${Math.round(pct(bytes, 0.99))}  max ${Math.round(Math.max(...bytes))}  (${Math.round(pct(bytes, 0.5) * 20 / 1024)} KiB/s at 20 Hz)`)
if (spikes.length) console.log(`ticks over 8 ms:\n  ${spikes.join('\n  ')}`)
