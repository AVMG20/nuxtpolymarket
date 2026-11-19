// Headless Dead Front network bench: a bot squad (god mode, all doors open,
// Pack-a-Punched guns firing at their real fire rate with every pellet
// claimed) fights from a start round on the real map, while each tick does
// what the match loop does (message handling, step, snapshot, serialise,
// per-player frames). Reports, per round: event-loop time per tick (mean,
// p95, max against the 50 ms budget), the sim stages that cost it, frame
// bytes per client (and per second), and what the frame is made of.
//
//   bun --tsconfig-override scripts/tsconfig.shapezz-playtest.json scripts/dead-front-net-bench.ts [players] [startRound] [rounds] [maxMinutes] [fireShare]
//
// What to look for: tick time well under 50 ms (the loop also has to answer
// pings between ticks), and frames small and steady: a client whose link or
// tab can't drain the stream builds a queue the server sends ahead of every
// pong, which is what the HUD's ping reads.
import { createError } from 'h3'
import { DF_PLAYER, DF_TICK_HZ } from '#shared/utils/dead-front/constants'
import { dfZombieHitTest } from '#shared/utils/dead-front/enemies'
import { DF_MAP } from '#shared/utils/dead-front/map'
import { dfLineOfSight } from '#shared/utils/dead-front/physics'
import { dfPackZombie } from '#shared/utils/dead-front/protocol'
import type { DfShotHit } from '#shared/utils/dead-front/protocol'
import type { DfWeaponId, Vec3 } from '#shared/utils/dead-front/types'
import { DF_WEAPONS } from '#shared/utils/dead-front/weapons'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import { DfSpecials } from '#server/utils/dead-front/specials'
import { DfArsenal } from '#server/utils/dead-front/salvage'
import { DfNav } from '#server/utils/dead-front/nav'

Object.assign(globalThis, { createError })

const PLAYERS = Number(process.argv[2] ?? 4)
const START_ROUND = Number(process.argv[3] ?? 10)
const ROUNDS = Number(process.argv[4] ?? 8)
const MAX_MINUTES = Number(process.argv[5] ?? 20)
/** Share of trigger pulls the bots take (lower: zombies pile up like they do around real players). */
const FIRE_SHARE = Number(process.argv[6] ?? 0.3)
const DT = 1 / DF_TICK_HZ
const BUDGET_MS = 1000 / DF_TICK_HZ

// ---------------------------------------------------------------- stage timers

const stageMs = new Map<string, number>()
let depth = 0
function timeMethod(proto: object, name: string, label = name): void {
    const o = proto as Record<string, unknown>
    const fn = o[name]
    if (typeof fn !== 'function') return
    o[name] = function (this: unknown, ...args: unknown[]) {
        // only the outermost timed call counts, so nested stages don't double up
        if (depth > 0) return (fn as (...a: unknown[]) => unknown).apply(this, args)
        depth++
        const t = performance.now()
        try {
            return (fn as (...a: unknown[]) => unknown).apply(this, args)
        } finally {
            depth--
            stageMs.set(label, (stageMs.get(label) ?? 0) + performance.now() - t)
        }
    }
}
for (const m of ['stepRound', 'stepPlayers', 'stepBox', 'stepPap', 'stepZombies', 'stepBurns', 'rushLastZombies', 'stepProjectiles', 'stepPowerups', 'stepEgg']) timeMethod(DfMatchSim.prototype, m)
timeMethod(DfSpecials.prototype, 'step', 'specials.step')
timeMethod(DfArsenal.prototype, 'step', 'arsenal.step')
// nested inside stepZombies: count separately (they run while depth is 0 only when called elsewhere)
const navMs = { field: 0, fieldCalls: 0, fieldBuilds: 0, fieldMax: 0 }
const stageMax = new Map<string, number>()
{
    const proto = DfNav.prototype as unknown as Record<string, (...a: unknown[]) => unknown>
    const field = proto.field!
    proto.field = function (this: { fields: Map<number, unknown> }, ...args: unknown[]) {
        const had = this.fields.has(args[0] as number)
        const t = performance.now()
        try {
            return field.apply(this, args)
        } finally {
            const took = performance.now() - t
            navMs.field += took
            if (took > navMs.fieldMax) navMs.fieldMax = took
            navMs.fieldCalls++
            if (!had) navMs.fieldBuilds++
        }
    }
}

// ---------------------------------------------------------------- the match

type AnySim = DfMatchSim & Record<string, unknown>
let sim: DfMatchSim | null = null
sim = new DfMatchSim(Array.from({ length: PLAYERS }, (_, i) => ({ userId: `bot${i}`, name: `Bot ${i}`, startWeapon: 'm1911' as DfWeaponId, attachments: {}, perkMods: {} })), {
    now: () => sim?.time ?? 0,
    startDelay: 1
})
const s = sim as AnySim
const lead = s.players[0]!
s.dev(lead.pid, { k: 'points', amount: 1e7 })
for (let pass = 0; pass < DF_MAP.doors.length; pass++) {
    for (const d of DF_MAP.doors) {
        if (s.doors.has(d.id) || !d.zones.some(z => s.activeZones.has(z))) continue
        s.dev(lead.pid, { k: 'tp', pos: d.pos })
        s.use(lead.pid, d.id)
    }
}
s.dev(lead.pid, { k: 'egg', step: 'fuses' }) // turns the power on
for (const p of s.players) {
    s.dev(p.pid, { k: 'god', on: true })
    s.dev(p.pid, { k: 'arsenal', what: 'salvage' })
}

// Pack-a-Punched loadouts: shotgun blast + dragon's breath, chain lightning SMGs, burst rifles
const LOADOUTS: [DfWeaponId, number][][] = [
    [['m1897', 3], ['ppsh', 2]],
    [['mp18', 3], ['sawnoff', 3]],
    [['thompson', 2], ['kar98k', 3]],
    [['ppsh', 3], ['m1897', 2]],
    [['win1895', 3], ['mp18', 1]]
]
const makeWeapon = (s.makeWeapon as (p: unknown, id: DfWeaponId, pap: number, rarity?: number) => unknown).bind(s)
s.players.forEach((p, i) => {
    p.weapons = LOADOUTS[i % LOADOUTS.length]!.map(([id, pap]) => makeWeapon(p, id, pap, 3)) as typeof p.weapons
    p.slot = 0
})
for (let t = 0; t < 40 && s.phase !== 'active'; t++) s.step(DT)
s.dev(lead.pid, { k: 'round', round: START_ROUND })
s.snapshot() // drain setup events

// bots walk loops of nav nodes, so player nodes and distance fields change like a real match
const inside = DF_MAP.nav.nodes.filter(n => !n.outside)
const routes = s.players.map((_, i) => inside.filter((_, k) => k % (PLAYERS * 7) === i * 7).map(n => n.pos))
const seqs = s.players.map(() => 0)
const legT = s.players.map(() => 0)
const legI = s.players.map((_, i) => i)
const nextShot = s.players.map(() => 0)
const fireAcc = s.players.map(() => 0)

/** One trigger pull at the closest visible zombie, every pellet claimed like the client does. */
function shoot(p: (typeof s.players)[number]): boolean {
    const w = p.weapons[p.slot]
    if (!w) return false
    const eye = { x: p.pos.x, y: p.pos.y + DF_PLAYER.eyeHeight, z: p.pos.z }
    let best: { z: (typeof s.zombies)[number], d: number, aim: Vec3 } | null = null
    for (const z of s.zombies) {
        const aim = { x: z.pos.x, y: z.pos.y + z.def.height * 0.6, z: z.pos.z }
        const d = Math.hypot(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z)
        if (d > 30 || (best && d >= best.d)) continue
        if (!dfLineOfSight(s.world, eye, aim)) continue
        best = { z, d, aim }
    }
    if (!best) return false
    const { z, d, aim } = best
    const dir = { x: (aim.x - eye.x) / d, y: (aim.y - eye.y) / d, z: (aim.z - eye.z) / d }
    const pellets = Math.max(1, w.stats.pellets)
    const dirs: Vec3[] = []
    const hits: DfShotHit[] = []
    for (let k = 0; k < pellets; k++) {
        dirs.push(dir)
        const hit = dfZombieHitTest({ type: z.type, pos: z.pos, yaw: z.yaw, anim: z.anim }, eye, dir, 60)
        if (hit) hits.push({ z: z.id, zone: hit.zone, dist: hit.dist })
    }
    w.mag = Math.max(w.mag, 1)
    s.fire(p.pid, { origin: eye, dirs, hits, mag: w.mag - 1, weapon: w.id })
    return true
}

// ---------------------------------------------------------------- per round stats

interface RoundStats {
    round: number
    ticks: number
    tickMs: number[]
    msgMs: number
    stepMs: number
    snapMs: number
    stages: Map<string, number>
    bytes: number[]
    parts: Record<string, number>
    events: Map<string, number>
    alive: number
    fires: number
    boss: boolean
}
const rounds: RoundStats[] = []
let cur: RoundStats | null = null
function roundStats(): RoundStats {
    if (!cur || cur.round !== s.round) {
        cur = { round: s.round, ticks: 0, tickMs: [], msgMs: 0, stepMs: 0, snapMs: 0, stages: new Map(), bytes: [], parts: { zombies: 0, events: 0, world: 0, players: 0, mine: 0, other: 0 }, events: new Map(), alive: 0, fires: 0, boss: false }
        rounds.push(cur)
    }
    return cur
}

const ticks = Math.round(MAX_MINUTES * 60 / DT)
const lastRound = START_ROUND + ROUNDS - 1
const t0 = performance.now()
let gcLike = 0
for (let tick = 0; tick < ticks && !s.over && s.round <= lastRound; tick++) {
    const rs = roundStats()
    // ---- client messages (20 Hz input, shots at the gun's fire rate)
    const m0 = performance.now()
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
        s.input(p.pid, { seq: ++seqs[p.pid]!, pos: { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k }, yaw: 0, pitch: 0, flags: 0, rtt: 60 })
        const w = p.weapons[p.slot]
        if (!w) continue
        // swap guns every few seconds so both loadout slots fire
        if (tick % 160 === p.pid * 13) s.swap(p.pid, p.slot === 0 ? 1 : 0)
        const interval = 60 / Math.max(1, DF_WEAPONS[w.id] ? w.stats.rpm : 600)
        while (nextShot[p.pid]! <= s.time) {
            nextShot[p.pid] = Math.max(nextShot[p.pid]! + interval, s.time - interval)
            w.reserve = Math.max(w.reserve, w.stats.magSize * 4)
            fireAcc[p.pid]! += FIRE_SHARE
            if (fireAcc[p.pid]! < 1) continue
            fireAcc[p.pid]! -= 1
            if (shoot(p)) rs.fires++
            else break
        }
    }
    const m1 = performance.now()
    // ---- the tick
    stageMs.clear()
    s.step(DT)
    const m2 = performance.now()
    for (const [k, v] of stageMs) {
        rs.stages.set(k, (rs.stages.get(k) ?? 0) + v)
        if (v > (stageMax.get(k) ?? 0)) stageMax.set(k, v)
    }
    // ---- as match.ts broadcastSnapshot sends it
    const snap = s.snapshot()
    const wire = { ...snap, zombies: snap.zombies.map(dfPackZombie) }
    const shared = JSON.stringify(wire)
    const head = `{"t":"snap","s":${shared.slice(0, -1)},"clk":${Math.round(s.time * 1000) / 1000},"ack":`
    let total = 0
    let mineLen = 0
    for (const p of s.players) {
        const mine = JSON.stringify(s.arsenal.mine(p.pid))
        mineLen += mine.length
        total += `${head}${s.ack(p.pid)},"mine":${mine}}}`.length
    }
    const m3 = performance.now()
    // ---- what the frame is made of (not timed)
    const zl = JSON.stringify(wire.zombies).length
    const el = JSON.stringify(snap.events).length
    const wl = JSON.stringify(snap.world).length
    const pl = JSON.stringify(snap.players).length
    rs.parts.zombies! += zl
    rs.parts.events! += el
    rs.parts.world! += wl
    rs.parts.players! += pl
    rs.parts.mine! += mineLen / PLAYERS
    rs.parts.other! += total / PLAYERS - zl - el - wl - pl - mineLen / PLAYERS
    for (const ev of snap.events) rs.events.set(ev.k, (rs.events.get(ev.k) ?? 0) + 1)
    if (snap.world.warlord) rs.boss = true
    rs.ticks++
    rs.msgMs += m1 - m0
    rs.stepMs += m2 - m1
    rs.snapMs += m3 - m2
    rs.tickMs.push(m3 - m0)
    rs.bytes.push(total / PLAYERS)
    rs.alive += s.zombies.length
    if (m3 - m0 > BUDGET_MS) gcLike++
    if (process.env.DUMP && tick === Number(process.env.DUMP)) console.log(`${head}${s.ack(0)},"mine":${JSON.stringify(s.arsenal.mine(0))}}}`)
}
const wall = performance.now() - t0

// ---------------------------------------------------------------- report

function pct(arr: number[], q: number): number {
    const sorted = [...arr].sort((x, y) => x - y)
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
}
const f1 = (n: number) => n.toFixed(1)
const f2 = (n: number) => n.toFixed(2)
console.log(`${PLAYERS} players, rounds ${START_ROUND}..${s.round}${s.over ? ' (squad fell)' : ''}, ${(wall / 1000).toFixed(1)} s wall, ${gcLike} ticks over the ${BUDGET_MS} ms budget`)
console.log('round  sim-s  alive  fires/s   tick mean  p95    max    | msgs  step  snap (ms/tick) | frame B mean  p95    max   KiB/s/client | zombies events world players mine (B/frame)')
const all: number[] = []
const allBytes: number[] = []
for (const r of rounds) {
    if (!r.ticks) continue
    all.push(...r.tickMs)
    allBytes.push(...r.bytes)
    const mean = r.tickMs.reduce((a, b) => a + b, 0) / r.ticks
    const bmean = r.bytes.reduce((a, b) => a + b, 0) / r.ticks
    const part = (k: string) => String(Math.round(r.parts[k]! / r.ticks)).padStart(6)
    console.log(`${String(r.round).padStart(3)}${r.boss ? 'W' : ' '}  ${f1(r.ticks * DT).padStart(6)} ${f1(r.alive / r.ticks).padStart(5)}  ${f1(r.fires / (r.ticks * DT)).padStart(6)}   ${f2(mean).padStart(8)} ${f2(pct(r.tickMs, 0.95)).padStart(6)} ${f2(Math.max(...r.tickMs)).padStart(6)}  | ${f2(r.msgMs / r.ticks)}  ${f2(r.stepMs / r.ticks)}  ${f2(r.snapMs / r.ticks)}           | ${String(Math.round(bmean)).padStart(9)} ${String(Math.round(pct(r.bytes, 0.95))).padStart(6)} ${String(Math.round(Math.max(...r.bytes))).padStart(6)}   ${f1(bmean * DF_TICK_HZ / 1024).padStart(6)}       | ${part('zombies')} ${part('events')} ${part('world')} ${part('players')} ${part('mine')}`)
}
console.log(`\nall ticks: mean ${f2(all.reduce((a, b) => a + b, 0) / all.length)} ms, p95 ${f2(pct(all, 0.95))}, p99 ${f2(pct(all, 0.99))}, max ${f2(Math.max(...all))}; frames mean ${Math.round(allBytes.reduce((a, b) => a + b, 0) / allBytes.length)} B, p99 ${Math.round(pct(allBytes, 0.99))} B`)
const stageTotals = new Map<string, number>()
let totalTicks = 0
for (const r of rounds) {
    totalTicks += r.ticks
    for (const [k, v] of r.stages) stageTotals.set(k, (stageTotals.get(k) ?? 0) + v)
}
console.log('step stages (ms/tick): ' + [...stageTotals].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / totalTicks).toFixed(3)}`).join(', '))
console.log('step stages, worst tick (ms): ' + [...stageMax].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '))
console.log(`nav.field: ${navMs.fieldCalls} calls, ${navMs.fieldBuilds} builds, ${(navMs.field / totalTicks).toFixed(3)} ms/tick, worst ${navMs.fieldMax.toFixed(2)} ms`)
const evTotals = new Map<string, number>()
for (const r of rounds) for (const [k, v] of r.events) evTotals.set(k, (evTotals.get(k) ?? 0) + v)
console.log('events/s: ' + [...evTotals].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / (totalTicks * DT)).toFixed(1)}`).join(', '))
