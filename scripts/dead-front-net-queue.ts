// Dead Front snapshot stream over a slow link, on a virtual clock: the real
// match loop (DfMatch: tick, snapshot, frames, pacing) feeds each client
// through a modelled connection (bandwidth, one-way latency, kernel buffers
// the server can't see), and each client reads on a render loop at a given
// frame time, pings once a second like DfNet and reports the snapshot tick it
// has read on its 20 Hz input. Prints the ping the HUD would show and how far
// behind the world the client renders, per scenario, with snapshot pacing
// (clients send `st`) and without (the old stream: every frame queued).
//
//   bun --tsconfig-override scripts/tsconfig.shapezz-playtest.json scripts/dead-front-net-queue.ts [players] [round] [seconds]
import { createError } from 'h3'

Object.assign(globalThis, { createError })

// ---------------------------------------------------------------- virtual clock

let clock = 1_000_000
type Timer = { at: number, fn: () => void, id: number, every?: number }
let timers: Timer[] = []
let timerSeq = 0
const realPerf = performance.now.bind(performance)
Date.now = () => Math.floor(clock)
performance.now = () => clock
Object.assign(globalThis, {
    setTimeout: (fn: () => void, ms = 0) => {
        const t = { at: clock + Math.max(0, ms), fn, id: ++timerSeq }
        timers.push(t)
        return t.id
    },
    clearTimeout: (id: number) => {
        timers = timers.filter(t => t.id !== id)
    },
    setInterval: (fn: () => void, ms = 0) => {
        const t = { at: clock + ms, fn, id: ++timerSeq, every: Math.max(1, ms) }
        timers.push(t)
        return t.id
    },
    clearInterval: (id: number) => {
        timers = timers.filter(t => t.id !== id)
    }
})
function runUntil(end: number): void {
    for (;;) {
        let next: Timer | null = null
        for (const t of timers) if (!next || t.at < next.at) next = t
        if (!next || next.at > end) break
        clock = Math.max(clock, next.at)
        if (next.every) next.at += next.every
        else timers = timers.filter(t => t !== next)
        next.fn()
    }
    clock = end
}

const { DfMatch } = await import('#server/utils/dead-front/match')
const { DF_MAP } = await import('#shared/utils/dead-front/map')
type DfWeaponId = import('#shared/utils/dead-front/types').DfWeaponId

const PLAYERS = Number(process.argv[2] ?? 5)
const ROUND = Number(process.argv[3] ?? 20)
const SECONDS = Number(process.argv[4] ?? 60)

// ---------------------------------------------------------------- one client and its link

interface Scenario {
    name: string
    /** Link bandwidth toward the client (bytes/s), as a function of seconds into the run. */
    bandwidth: (t: number) => number
    /** One-way latency (ms). */
    latency: number
    /** The client's frame time (ms): messages are read once per frame. */
    frameMs: number
}

/** What the kernel and the path buffer before the server's own socket backlog grows (invisible to it). */
const KERNEL_BUFFER = 256 * 1024

class Link {
    /** Bytes waiting to cross, with their payload. */
    private queue: { bytes: number, left: number, payload: string }[] = []
    private inFlight: { at: number, payload: string }[] = []
    constructor(private readonly sc: Scenario, private readonly t0: number) {}
    send(payload: string): void {
        this.queue.push({ bytes: payload.length, left: payload.length, payload })
    }
    /** Bytes queued beyond the kernel buffer: what Bun's / ws's bufferedAmount would report. */
    backlog(): number {
        let n = 0
        for (const q of this.queue) n += q.left
        return Math.max(0, n - KERNEL_BUFFER)
    }
    /** Moves `dtMs` worth of bandwidth; returns the payloads that reached the client by now. */
    pump(dtMs: number): string[] {
        let budget = this.sc.bandwidth((clock - this.t0) / 1000) * dtMs / 1000
        while (budget > 0 && this.queue.length) {
            const q = this.queue[0]!
            const take = Math.min(budget, q.left)
            q.left -= take
            budget -= take
            if (q.left <= 0) {
                this.queue.shift()
                this.inFlight.push({ at: clock + this.sc.latency, payload: q.payload })
            }
        }
        const out: string[] = []
        while (this.inFlight.length && this.inFlight[0]!.at <= clock) out.push(this.inFlight.shift()!.payload)
        return out
    }
}

interface Result {
    pings: { t: number, rtt: number }[]
    behind: { t: number, ms: number }[]
    frames: number
    bytes: number
    events: number
    /** Events the match emitted (every frame of the run), to check none were lost on the way. */
    emitted: number
}

async function run(sc: Scenario, paced: boolean): Promise<Result> {
    timers = []
    clock = 1_000_000
    const t0 = clock
    const links = new Map<string, Link>()
    const toServer: { at: number, userId: string, msg: Record<string, unknown> }[] = []
    const members = Array.from({ length: PLAYERS }, (_, i) => ({ userId: `u${i}`, name: `Player ${i}` }))
    const profile = {
        unlockedWeapons: ['m1911'], weaponXp: {}, loadout: { startWeapon: 'm1911', attachments: {} }, researchPerk: null,
        perkXp: {}, perkMods: {}, gamesPlayed: 0, bestRound: 0, totalKills: 0, eggsCompleted: 0
    }
    // player 0 is the measured client; the others read everything at once on a fast line
    const res: Result = { pings: [], behind: [], frames: 0, bytes: 0, events: 0, emitted: 0 }
    const match = await DfMatch.create(members, {
        send: (userId, frame) => {
            const link = links.get(userId)
            if (link) link.send(frame)
        },
        backlog: paced ? userId => links.get(userId)?.backlog() ?? 0 : undefined,
        cut: () => {},
        onPlayerGone: () => {},
        onFinished: () => {},
        loadProfile: async () => structuredClone(profile) as never,
        applyResult: async () => ({ perk: null, perkXpGained: 0, perkLevelBefore: 0, perkLevelAfter: 0, weaponXpGained: {}, weaponLevelsUp: {}, newWeapons: [] })
    })
    const fast: Scenario = { name: 'fast', bandwidth: () => 10e6, latency: 20, frameMs: 16 }
    members.forEach((m, i) => links.set(m.userId, new Link(i === 0 ? sc : fast, t0)))
    const sim = match.sim
    const snapshot = sim.snapshot.bind(sim)
    sim.snapshot = () => {
        const out = snapshot()
        res.emitted += out.events.length
        return out
    }
    const lead = sim.players[0]!
    sim.dev(lead.pid, { k: 'points', amount: 1e7 })
    for (let pass = 0; pass < DF_MAP.doors.length; pass++) {
        for (const d of DF_MAP.doors) {
            if (sim.doors.has(d.id) || !d.zones.some(z => sim.activeZones.has(z))) continue
            sim.dev(lead.pid, { k: 'tp', pos: d.pos })
            sim.use(lead.pid, d.id)
        }
    }
    for (const p of sim.players) {
        sim.dev(p.pid, { k: 'god', on: true })
        const w = (sim as unknown as { makeWeapon: (p: unknown, id: DfWeaponId, pap: number) => unknown }).makeWeapon(p, 'ppsh', 2)
        p.weapons = [w] as typeof p.weapons
    }
    sim.dev(lead.pid, { k: 'round', round: ROUND })

    // clients: read on their frame, ping at 1 Hz, report input at 20 Hz
    const seq = members.map(() => 0)
    const snapTick = members.map(() => 0)
    const lastClk = members.map(() => 0)
    const clkAt = members.map(() => 0)
    const pos = sim.players.map(p => ({ ...p.pos }))
    const upLatency = (i: number) => (i === 0 ? sc.latency : fast.latency)
    const ROUTE = 2
    for (let i = 0; i < PLAYERS; i++) {
        const frameMs = i === 0 ? sc.frameMs : fast.frameMs
        let inAcc = 0
        setInterval(() => {
            const link = links.get(members[i]!.userId)!
            for (const payload of link.pump(frameMs)) {
                const msg = JSON.parse(payload) as { t: string, at?: number, s?: { tick: number, clk?: number, time: number, events: unknown[] } }
                if (msg.t === 'pong' && i === 0) res.pings.push({ t: (clock - t0) / 1000, rtt: clock - msg.at! })
                if (msg.t === 'snap' && msg.s) {
                    snapTick[i] = msg.s.tick
                    lastClk[i] = msg.s.clk ?? msg.s.time
                    clkAt[i] = clock
                    if (i === 0) {
                        res.frames++
                        res.bytes += payload.length
                        res.events += msg.s.events.length
                    }
                }
            }
            inAcc += frameMs
            if (inAcc >= 50) {
                inAcc = Math.min(inAcc - 50, 25)
                const p = pos[i]!
                const msg: Record<string, unknown> = { t: 'in', seq: ++seq[i]!, pos: { x: p.x + Math.sin(clock / 700 + i) * ROUTE, y: p.y, z: p.z }, yaw: 0, pitch: 0, flags: 0, rtt: 80 }
                if (paced) msg.st = snapTick[i]
                toServer.push({ at: clock + upLatency(i), userId: members[i]!.userId, msg })
            }
        }, frameMs)
        setInterval(() => toServer.push({ at: clock + upLatency(i), userId: members[i]!.userId, msg: { t: 'ping', at: clock } }), 1000)
    }
    // the server: hands client messages to the match (pongs go straight back), the bots shoot
    let shotT = 0
    setInterval(() => {
        while (toServer.length && toServer[0]!.at <= clock) {
            const { userId, msg } = toServer.shift()!
            if (msg.t === 'ping') links.get(userId)!.send(JSON.stringify({ t: 'pong', at: msg.at }))
            else match.handle(userId, msg as never)
        }
        toServer.sort((a, b) => a.at - b.at)
        if (++shotT % 4) return
        for (const p of sim.players) {
            const z = sim.zombies.find(q => Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z) < 20)
            if (!z) continue
            const eye = { x: p.pos.x, y: p.pos.y + 1.6, z: p.pos.z }
            const aim = { x: z.pos.x, y: z.pos.y + 1, z: z.pos.z }
            const d = Math.hypot(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z)
            match.handle(p.setup.userId, { t: 'fire', origin: eye, dirs: [{ x: (aim.x - eye.x) / d, y: (aim.y - eye.y) / d, z: (aim.z - eye.z) / d }], hits: [{ z: z.id, zone: 'body', dist: d }] })
        }
    }, 5)
    // how far behind the server's stream clock the client's newest snapshot is, once a second
    setInterval(() => {
        const serverClk = sim.time
        res.behind.push({ t: (clock - t0) / 1000, ms: Math.max(0, (serverClk - lastClk[0]!) * 1000) })
    }, 1000)
    runUntil(t0 + SECONDS * 1000)
    await match.finish()
    timers = []
    return res
}

// ---------------------------------------------------------------- scenarios

const scenarios: Scenario[] = [
    { name: 'good line (1 MB/s, 40 ms, 60 fps)', bandwidth: () => 1_000_000, latency: 40, frameMs: 16 },
    { name: 'line a bit under the stream rate (90 KB/s, 40 ms)', bandwidth: () => 90_000, latency: 40, frameMs: 16 },
    { name: 'wifi blip: 4 s at 10 KB/s from 20 s, 140 KB/s otherwise', bandwidth: t => (t >= 20 && t < 24 ? 10_000 : 140_000), latency: 40, frameMs: 16 },
    { name: 'busy tab (8 fps), good line', bandwidth: () => 1_000_000, latency: 40, frameMs: 125 }
]

function smooth(pings: { rtt: number }[]): number[] {
    // DfNet's dfSmoothRtt: median of five, eased
    const out: number[] = []
    const samples: number[] = []
    let prev = 0
    for (const p of pings) {
        if (!(p.rtt >= 0) || p.rtt > 10000) {
            out.push(prev)
            continue
        }
        samples.push(p.rtt)
        if (samples.length > 5) samples.shift()
        const sorted = [...samples].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]!
        prev = prev === 0 ? median : prev * 0.7 + median * 0.3
        out.push(prev)
    }
    return out
}

const wall0 = realPerf()
console.log(`${PLAYERS} players, round ${ROUND}, ${SECONDS} s per run; the measured client is player 0`)
for (const sc of scenarios) {
    console.log(`\n${sc.name}`)
    for (const paced of [false, true]) {
        const r = await run(sc, paced)
        const hud = smooth(r.pings)
        const at = (sec: number) => Math.round(hud[Math.min(hud.length - 1, Math.max(0, sec - 1))] ?? 0)
        const maxBehind = Math.max(0, ...r.behind.map(b => b.ms))
        const endBehind = r.behind[r.behind.length - 1]?.ms ?? 0
        const marks = [10, 20, 25, 30, 35, 45, SECONDS].filter((x, i, a) => x <= SECONDS && a.indexOf(x) === i)
        console.log(`  ${paced ? 'paced  ' : 'unpaced'}  HUD ping ${marks.map(m => `@${m}s ${at(m)}`).join('  ')} ms | world behind max ${Math.round(maxBehind)} end ${Math.round(endBehind)} ms | ${(r.frames / SECONDS).toFixed(1)} frames/s, ${(r.bytes / SECONDS / 1024).toFixed(0)} KiB/s, ${r.events}/${r.emitted} events`)
    }
}
console.log(`\n(${((realPerf() - wall0) / 1000).toFixed(1)} s wall)`)
