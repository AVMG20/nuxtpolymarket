/**
 * Rail Tycoon server load: generated 256 worlds where every company runs passenger shuttles (a depot,
 * two stations, one train per line, towns and industries around them), then
 *
 *   1. the cost of a step, the hash and the checkpoint encode as worlds fill with trains, and
 *   2. what a live server feels: several worlds stepped on the room's own schedule (27 ms timers,
 *      debt capped at 250 ms, at most 4 steps per callback, the hub's 10 ms per 27 ms step budget)
 *      in the same process as an HTTP server, while a separate process requests it at a steady rate.
 *      The rest of the site shares that event loop in production, so the request latency and the
 *      event-loop delay here are what other pages would see.
 *
 * Shuttles have no junctions, so route search is nearly free here; pathfinder-bench.ts is the
 * worst case for that.
 *
 *   bun scripts/rail-tycoon/stress.ts [seconds-per-scenario=20]
 *   bun scripts/rail-tycoon/stress.ts --probe    (checks the shuttles run)
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { RT_CATALOG } from '../../shared/utils/rail-tycoon/catalog'
import { applyCommand, RtCommandKind as K, type RtCommand } from '../../shared/utils/rail-tycoon/commands'
import { RT_CHECKPOINT_MS, RT_HASH_EVERY, RT_STEP_BUDGET_MS } from '../../shared/utils/rail-tycoon/limits'
import { RtDir } from '../../shared/utils/rail-tycoon/map'
import { encodeWorld } from '../../shared/utils/rail-tycoon/save'
import { RtAxis } from '../../shared/utils/rail-tycoon/stations-build'
import { RtTrack } from '../../shared/utils/rail-tycoon/track'
import { RtOrderKind, RtVehicleKind, RtVehicleState } from '../../shared/utils/rail-tycoon/types'
import { RtWorld, rtNewCompany, rtStartDate } from '../../shared/utils/rail-tycoon/world'
import { generateWorld } from '../../shared/utils/rail-tycoon/worldgen'

const TICK_MS = RT_CATALOG.time.tickMs
const MODELS = RT_CATALOG.vehicles.models
const LINE_TILES = 36
const gzipAsync = promisify(gzip)

/* ------------------------------------------------------------------------------------------
 * The client process: steady requests, latency out as JSON
 * ---------------------------------------------------------------------------------------- */

if (process.argv[2] === '--client') {
    const [url, ms, rate] = [process.argv[3]!, Number(process.argv[4]), Number(process.argv[5])]
    const latencies: number[] = []
    let failed = 0
    const started = performance.now()
    const inflight: Promise<void>[] = []
    let k = 0
    while (performance.now() - started < ms) {
        const due = started + (k++ * 1000) / rate
        const wait = due - performance.now()
        if (wait > 0) await sleep(wait)
        const sent = performance.now()
        inflight.push(fetch(url).then(r => r.text()).then(() => {
            latencies.push(performance.now() - sent)
        }, () => {
            failed++
        }))
    }
    await Promise.all(inflight)
    console.log(JSON.stringify({ latencies, failed }))
    process.exit(0)
}

/* ------------------------------------------------------------------------------------------
 * Worlds
 * ---------------------------------------------------------------------------------------- */

/** A small deterministic generator for picking line sites (setup only, never a game outcome). */
function sites(seed: number) {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) >>> 0
        let t = s
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * A 256 world with `companies` companies of `perCompany` shuttles each: depot, station (3 long),
 * 36-tile line, station, one express with three coaches running between the two stations.
 */
function buildWorld(seed: number, companies: number, perCompany: number): { world: RtWorld, trains: number } {
    const layout = generateWorld(seed, { side: 256, towns: 28, industryDensity: 2 })
    const world = new RtWorld({
        settings: { side: 256, maxCompanies: 8, sharing: false },
        map: layout.map,
        rngState: seed,
        tick: 0,
        date: rtStartDate(),
        pathfinderCursor: 0,
        companies: Array.from({ length: companies }, (_, c) => rtNewCompany(c, `Company ${c}`, c, 0)),
        towns: layout.towns,
        industries: layout.industries,
        stations: [],
        vehicles: []
    })
    const map = world.map
    const next = sites(seed)
    let trains = 0
    for (let c = 0; c < companies; c++) {
        world.company(c)!.money = 1e12
        let built = 0
        for (let attempt = 0; attempt < 20000 && built < perCompany; attempt++) {
            const x = 2 + Math.floor(next() * (256 - LINE_TILES - 4))
            const y = 2 + Math.floor(next() * 252)
            const at = (dx: number) => map.idx(x + dx, y)
            const plan: RtCommand[] = [
                { kind: K.buildRailStation, tile: at(1), axis: RtAxis.x, tracks: 1, length: 3 },
                { kind: K.buildRailStation, tile: at(LINE_TILES - 3), axis: RtAxis.x, tracks: 1, length: 3 },
                { kind: K.buildDepot, tile: at(0), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw },
                // tile by tile: a line drag builds as far as it can and still succeeds
                ...Array.from({ length: LINE_TILES - 7 }, (_, k): RtCommand => ({ kind: K.buildRail, tile: at(4 + k), piece: RtTrack.x }))
            ]
            // every command touches its own tiles, so each dry run stands for the real build
            if (!plan.every(command => applyCommand(world, c, command, false).ok)) continue
            const ids = plan.map(command => applyCommand(world, c, command, true)).map(result => (result.ok ? result.id : undefined))
            const [a, b] = [ids[0]!, ids[1]!]
            const bought = applyCommand(world, c, {
                kind: K.buyVehicle, depot: at(0), model: MODELS.expressEngine.index,
                wagons: [MODELS.passengerCoach.index, MODELS.passengerCoach.index, MODELS.passengerCoach.index]
            }, true)
            if (!bought.ok || bought.id === undefined) continue
            const orders = [a, b].map(target => ({ kind: RtOrderKind.gotoStation, target, flags: 0 }))
            applyCommand(world, c, { kind: K.setOrders, vehicle: bought.id, orders }, true)
            applyCommand(world, c, { kind: K.startStop, vehicle: bought.id, stopped: false }, true)
            built++
            trains++
        }
    }
    return { world, trains }
}

/** Trains that are not stopped, crashed or in a depot: the ones actually running around. */
function running(world: RtWorld): number {
    let n = 0
    for (const v of world.vehicleList()) if (v.state === RtVehicleState.driving || v.state === RtVehicleState.loading) n++
    return n
}

const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
    const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
    return { mean, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) ?? 0 }
}
const f = (n: number) => n.toFixed(2)
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(0)} MB`

/* ------------------------------------------------------------------------------------------
 * 1. Step cost by train count
 * ---------------------------------------------------------------------------------------- */

async function stepCost(): Promise<void> {
    console.log('\n## 1. One world, stepped flat out (no timers)\n')
    console.log('| companies | trains | running | step mean | p95 | max | hash | encode | gzip | save |')
    console.log('|---|---|---|---|---|---|---|---|---|---|')
    for (const [companies, perCompany] of [[2, 10], [4, 25], [8, 25]] as const) {
        const { world, trains } = buildWorld(11 + companies * perCompany, companies, perCompany)
        // warm up past the first departures, then measure a minute of game time
        for (let k = 0; k < 400; k++) world.step()
        const times: number[] = []
        for (let k = 0; k < 2200; k++) {
            const t = performance.now()
            world.step()
            times.push(performance.now() - t)
        }
        let t = performance.now()
        world.hash()
        const hashMs = performance.now() - t
        t = performance.now()
        const bytes = encodeWorld(world)
        const encodeMs = performance.now() - t
        t = performance.now()
        const packed = await gzipAsync(bytes)
        const gzipMs = performance.now() - t
        const s = stats(times)
        console.log(`| ${companies} | ${trains} | ${running(world)} | ${f(s.mean)} ms | ${f(s.p95)} | ${f(s.max)} | ${f(hashMs)} ms | ${f(encodeMs)} ms | ${f(gzipMs)} ms | ${(packed.length / 1024).toFixed(0)} KB |`)
    }
}

/* ------------------------------------------------------------------------------------------
 * 2. Live rooms beside an HTTP server
 * ---------------------------------------------------------------------------------------- */

interface Room {
    world: RtWorld
    debt: number
    lastNow: number
    share: { window: number, spent: number }
    steps: number
    stepMs: number
    nextCheckpoint: number
}

async function scenario(label: string, worlds: { world: RtWorld }[], seconds: number): Promise<void> {
    // the hub's budget: 10 ms per 27 ms window for the process, split evenly among rooms
    let budgetWindow = -1
    let budgetSpent = 0
    const perRoom = () => RT_STEP_BUDGET_MS / Math.max(1, rooms.length)
    const roll = (share: Room['share']) => {
        const window = Math.floor(Date.now() / TICK_MS)
        if (window !== budgetWindow) {
            budgetSpent = Math.max(0, budgetSpent - RT_STEP_BUDGET_MS * (budgetWindow < 0 ? 1 : window - budgetWindow))
            budgetWindow = window
        }
        if (window !== share.window) {
            share.spent = Math.max(0, share.spent - perRoom() * (share.window < 0 ? 1 : window - share.window))
            share.window = window
        }
    }
    const start = Date.now()
    const rooms: Room[] = worlds.map(({ world }, i) => ({
        world, debt: 0, lastNow: start, share: { window: -1, spent: 0 }, steps: 0, stepMs: 0,
        // rooms checkpoint every RT_CHECKPOINT_MS, staggered by when they opened
        nextCheckpoint: start + ((i + 1) * RT_CHECKPOINT_MS) / Math.max(1, worlds.length) / 4
    }))
    let checkpoints = 0
    let checkpointEncodeMs = 0
    const tickOnce = (room: Room) => {
        const now = Date.now()
        room.debt = Math.min(room.debt + Math.max(0, now - room.lastNow), 250)
        room.lastNow = now
        let steps = 0
        while (room.debt >= TICK_MS && steps < 4) {
            roll(room.share)
            if (Math.min(RT_STEP_BUDGET_MS - budgetSpent, perRoom() - room.share.spent) <= 0) break
            const t = performance.now()
            room.world.step()
            if (room.world.tick % RT_HASH_EVERY === 0) room.world.hash()
            const ms = performance.now() - t
            roll(room.share)
            budgetSpent += ms
            room.share.spent += ms
            room.stepMs += ms
            room.steps++
            room.debt -= TICK_MS
            steps++
        }
        if (now >= room.nextCheckpoint) {
            room.nextCheckpoint = now + RT_CHECKPOINT_MS
            const t = performance.now()
            const bytes = encodeWorld(room.world)
            checkpointEncodeMs = Math.max(checkpointEncodeMs, performance.now() - t)
            checkpoints++
            void gzipAsync(bytes)
        }
    }

    // an endpoint with a typical page API's own work: build and serialise a few hundred rows
    const server = createServer((_req, res) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, name: `row ${i}`, value: i * 1.5 }))))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    // event-loop delay: how late a 10 ms timer fires
    const lags: number[] = []
    let expected = performance.now() + 10
    const lagTimer = setInterval(() => {
        const now = performance.now()
        lags.push(Math.max(0, now - expected))
        expected = now + 10
    }, 10)
    const timers = rooms.map(room => setInterval(() => tickOnce(room), TICK_MS))
    const cpuBefore = process.cpuUsage()
    const wallBefore = performance.now()

    const client = spawn(process.execPath, [process.argv[1]!, '--client', `http://127.0.0.1:${port}/`, String(seconds * 1000), '50'], { stdio: ['ignore', 'pipe', 'inherit'] })
    let text = ''
    client.stdout.on('data', (chunk: Buffer) => {
        text += chunk.toString()
    })
    await new Promise(resolve => client.on('close', resolve))
    const out = JSON.parse(text) as { latencies: number[], failed: number }

    const wall = performance.now() - wallBefore
    const cpu = process.cpuUsage(cpuBefore)
    for (const timer of timers) clearInterval(timer)
    clearInterval(lagTimer)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))

    const lat = stats(out.latencies)
    const lag = stats(lags)
    const steps = rooms.reduce((a, r) => a + r.steps, 0)
    const stepMs = rooms.reduce((a, r) => a + r.stepMs, 0)
    const gameSeconds = (steps / Math.max(1, rooms.length)) * TICK_MS / 1000
    const trains = rooms.reduce((a, r) => a + r.world.vehicleList().length, 0)
    console.log(`| ${label} | ${rooms.length} | ${trains} | ${(100 * (cpu.user + cpu.system) / 1000 / wall).toFixed(0)}% | ${(100 * stepMs / wall).toFixed(0)}% | ${(gameSeconds / (wall / 1000)).toFixed(2)}x | ${f(lat.p50)} / ${f(lat.p95)} / ${f(lat.p99)} / ${f(lat.max)} ms | ${f(lag.p95)} / ${f(lag.max)} ms | ${checkpoints} (${f(checkpointEncodeMs)} ms) | ${out.failed} |`)
}

async function liveRooms(seconds: number): Promise<void> {
    console.log(`\n## 2. Live rooms beside an HTTP server, ${seconds} s each, 50 requests/s from another process\n`)
    console.log('Game speed 1.00x is real time; below it the step budget is slowing the worlds down.\n')
    console.log('| scenario | worlds | trains | process CPU | stepping | game speed | request p50 / p95 / p99 / max | loop delay p95 / max | checkpoints (encode) | failed |')
    console.log('|---|---|---|---|---|---|---|---|---|---|')
    await scenario('no game', [], seconds)
    const busy = (n: number, companies: number, perCompany: number) =>
        Array.from({ length: n }, (_, i) => buildWorld(101 + i, companies, perCompany))
    for (const [label, worlds] of [
        ['1 world, 4 players', () => busy(1, 4, 25)],
        ['4 worlds, 8 players', () => busy(4, 8, 25)],
        ['20 worlds (max), 8 players', () => busy(20, 8, 25)]
    ] as const) {
        const built = worlds()
        for (const { world } of built) for (let k = 0; k < 400; k++) world.step()
        await scenario(label, built, seconds)
    }
}

if (process.argv[2] === '--probe') {
    // proof the shuttles work: trains keep running between their stations, none lost or crashed
    const { world, trains } = buildWorld(5, 2, 10)
    const money = world.companyList().map(c => c.money)
    const states = () => {
        const count = [0, 0, 0, 0, 0, 0]
        for (const v of world.vehicleList()) count[v.state]!++
        return `driving ${count[0]}, loading ${count[1]}, in depot ${count[2]}, crashed ${count[3]}`
    }
    console.log(`${trains} trains built`)
    for (let k = 1; k <= 6; k++) {
        for (let t = 0; t < 1000; t++) world.step()
        console.log(`tick ${world.tick}: ${states()}`)
    }
    console.log(`money change: ${world.companyList().map((c, i) => Math.round(c.money - money[i]!)).join(', ')}`)
    console.log(`lost trains: ${world.vehicleList().filter(v => v.lost).length}`)
    process.exit(0)
}

const seconds = Number(process.argv[2] ?? 20)
console.log(`Rail Tycoon stress, ${process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`}, tick ${TICK_MS} ms, budget ${RT_STEP_BUDGET_MS} ms per tick`)
await stepCost()
await liveRooms(seconds)
console.log(`\nresident memory at the end: ${mb(process.memoryUsage().rss)}`)
