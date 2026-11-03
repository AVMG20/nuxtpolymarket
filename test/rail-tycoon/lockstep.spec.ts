import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { RT_CARGO_IDS, RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { RtCommandKind, applyCommand, decodeCommand, encodeCommand, type RtCommand } from '#shared/utils/rail-tycoon/commands'
import { RT_PART_FRAGMENT_BYTES, RT_RESYNC_BEHIND_TICKS } from '#shared/utils/rail-tycoon/limits'
import { RtDir, RtMap, RtTileKind } from '#shared/utils/rail-tycoon/map'
import { RT_PROTOCOL_VERSION, encodeServerMsg, type RtClientMsg, type RtServerMsg, type RtStampedCommand } from '#shared/utils/rail-tycoon/protocol'
import { encodeWorldParts, rtChunkOfTile, rtPartHash } from '#shared/utils/rail-tycoon/save'
import { RtAxis } from '#shared/utils/rail-tycoon/stations-build'
import { RtTrack, rtTrackdirOf } from '#shared/utils/rail-tycoon/track'
import { RT_OWNER_NONE, RtOrderKind, RtVehicleKind } from '#shared/utils/rail-tycoon/types'
import { RtWorld, rtNewCompany, rtStartDate } from '#shared/utils/rail-tycoon/world'
import { RtLockstep, rtGunzip, type RtSnapshot } from '../../app/utils/rail-tycoon/lockstep'
import { RtNet, type RtSocket } from '../../app/utils/rail-tycoon/net'

/* ------------------------------------------------------------------------------------------
 * A minimal room: commands stamped T are applied before stepping from T, and the hash for T is
 * taken at T before them.
 * ---------------------------------------------------------------------------------------- */

function flatWorld(): RtWorld {
    const w = new RtWorld({
        settings: { side: 64, maxCompanies: 8, sharing: false }, map: new RtMap(64), rngState: 21, tick: 0, date: rtStartDate(),
        pathfinderCursor: 0, companies: [rtNewCompany(0, 'Player', 0, 0)], towns: [], industries: [], stations: [], vehicles: []
    })
    w.company(0)!.money = 1e9
    return w
}

/** A depot, two stations, a line and a train with orders: the stations get ids 0 and 1, the train 0. */
function shuttle(w: RtWorld, y: number): RtCommand[] {
    const at = (x: number) => w.map.idx(x, y)
    const M = RT_CATALOG.vehicles.models
    return [
        { kind: RtCommandKind.buildDepot, tile: at(4), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw },
        { kind: RtCommandKind.buildRailStation, tile: at(5), axis: RtAxis.x, tracks: 1, length: 3 },
        { kind: RtCommandKind.buildRailStation, tile: at(21), axis: RtAxis.x, tracks: 1, length: 3 },
        { kind: RtCommandKind.buildRailLine, tile: at(8), endTile: at(20), trackdir: rtTrackdirOf(RtTrack.x, true) },
        { kind: RtCommandKind.buyVehicle, depot: at(4), model: M.expressEngine.index, wagons: [M.passengerCoach.index] },
        { kind: RtCommandKind.setOrders, vehicle: 0, orders: [
            { kind: RtOrderKind.gotoStation, target: 0, flags: 0 },
            { kind: RtOrderKind.gotoStation, target: 1, flags: 0 }
        ] },
        { kind: RtCommandKind.startStop, vehicle: 0, stopped: false }
    ]
}

class Room {
    readonly world = flatWorld()
    readonly stamped = new Map<number, RtStampedCommand[]>()
    readonly hashes = new Map<number, number>()

    stamp(tick: number, company: number, command: RtCommand): RtStampedCommand {
        const s = { tick, company, command: encodeCommand(command) }
        let list = this.stamped.get(tick)
        if (!list) this.stamped.set(tick, list = [])
        list.push(s)
        return s
    }

    /** Steps to `tick`, recording the hash at every 100th tick boundary. */
    runTo(tick: number): void {
        const { world } = this
        while (world.tick < tick) {
            if (world.tick % 100 === 0) this.hashes.set(world.tick, world.hash())
            for (const s of this.stamped.get(world.tick) ?? []) {
                const r = applyCommand(world, s.company!, decodeOk(s), true)
                if (!r.ok) throw new Error(`stamped command refused at ${world.tick}`)
            }
            world.step()
        }
    }

    /** The snapshot as RtNet assembles it: the room sends only the parts whose hash differs from `have`. */
    snapshot(have: readonly string[] = [], withPending = true): RtSnapshot {
        const tick = this.world.tick
        const pending = withPending ? [...this.stamped.values()].flat().filter(s => s.tick >= tick).sort((a, b) => a.tick - b.tick) : []
        const parts = encodeWorldParts(this.world)
        const hashes = parts.map(rtPartHash)
        const zipped = new Map<number, Uint8Array>()
        hashes.forEach((hash, k) => {
            if (have[k] !== hash) zipped.set(k, new Uint8Array(gzipSync(parts[k]!)))
        })
        return {
            head: { type: 'opened', worldId: 'w1', role: 'player', owner: true, company: 0, inviteCode: 'ABCDEFGHJKMNPQRS', tick, serverNow: 0, parts: hashes },
            zipped,
            pending,
            broken: false
        }
    }

    /** The frames the room sends for that snapshot, each part split into `fragment`-byte fragments. */
    frames(have: readonly string[] = [], fragment = RT_PART_FRAGMENT_BYTES, withPending = true): RtServerMsg[] {
        const snapshot = this.snapshot(have, withPending)
        const out: RtServerMsg[] = [snapshot.head]
        for (const [index, bytes] of snapshot.zipped) {
            for (let at = 0; at < bytes.length; at += fragment) {
                out.push({ type: 'part', index, last: at + fragment >= bytes.length, bytes: bytes.subarray(at, at + fragment) })
            }
        }
        out.push({ type: 'snapshotEnd', tick: snapshot.head.tick, pending: snapshot.pending })
        return out
    }
}

function hashesOf(world: RtWorld): string[] {
    return encodeWorldParts(world).map(rtPartHash)
}

function decodeOk(s: RtStampedCommand): RtCommand {
    // the room only stamps what it encoded itself
    return decodeCommand(s.command, 64)!
}

async function client(room: Room) {
    const sent: RtClientMsg[] = []
    const lock = await RtLockstep.create(room.snapshot(), msg => sent.push(msg))
    if (!lock) throw new Error('lockstep refused the snapshot')
    const resyncs: string[] = []
    lock.on('resync', reason => resyncs.push(reason))
    return { lock, sent, resyncs }
}

/** Runs the client to `tick` as a live room would: the allowance moves on ahead of it, frames follow. */
function catchUp(lock: RtLockstep, tick: number): void {
    for (let guard = 0; guard < 100000 && lock.world.tick < tick && !lock.resyncing; guard++) {
        lock.receive({ type: 'allowance', tick: Math.min(tick, lock.world.tick + 100) })
        lock.frame()
    }
}

describe('RtLockstep', () => {
    it('a client built from an opened message with pending commands stays hash-equal for 2000 ticks', async () => {
        const room = new Room()
        const script = shuttle(room.world, 10)
        // two commands already applied before the snapshot, the rest pending in it or arriving live
        script.slice(0, 2).forEach((c, k) => room.stamp(2 + k, 0, c))
        room.runTo(10)
        const pendingLater = script.slice(2, 5).map((c, k) => room.stamp(10 + 3 * k, 0, c))
        const { lock, sent, resyncs } = await client(room)
        expect(sent).toEqual([{ type: 'loaded', worldId: 'w1' }])
        expect(lock.world.hash()).toBe(room.world.hash())
        expect(pendingLater.length).toBe(3)
        const live = script.slice(5).map((c, k) => room.stamp(40 + k, 0, c))
        for (const s of live) lock.receive({ type: 'command', ...s })
        room.runTo(2010)
        for (const [tick, hash] of room.hashes) if (tick >= 10) lock.receive({ type: 'hash', tick, hash })
        catchUp(lock, 2010)
        expect(resyncs).toEqual([])
        expect(lock.world.tick).toBe(2010)
        expect(lock.world.hash()).toBe(room.world.hash())
        expect(lock.world.vehicleList().length).toBe(1)
    })

    it('never applies a command before its tick', async () => {
        const room = new Room()
        const depot = { kind: RtCommandKind.buildDepot, tile: room.world.map.idx(30, 30), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw } as const
        const s = room.stamp(50, 0, depot)
        const { lock } = await client(room)
        lock.receive({ type: 'command', ...s })
        catchUp(lock, 50)
        expect(lock.world.map.kind[depot.tile]).not.toBe(RtTileKind.depot)
        catchUp(lock, 51)
        expect(lock.world.map.kind[depot.tile]).toBe(RtTileKind.depot)
    })

    it('holds a hash for a future tick until the world reaches it; a forged one then asks for a resync', async () => {
        const room = new Room()
        const { lock, sent, resyncs } = await client(room)
        room.runTo(300)
        lock.receive({ type: 'hash', tick: 100, hash: room.hashes.get(100)! })
        lock.receive({ type: 'hash', tick: 200, hash: (room.hashes.get(200)! + 1) >>> 0 })
        catchUp(lock, 199)
        expect(resyncs).toEqual([])
        catchUp(lock, 300)
        expect(resyncs).toEqual(['hash'])
        expect(lock.world.tick).toBe(200)
        // the hash at 100 matched, so the resync offers this world's parts and holds them
        const have = hashesOf(lock.world)
        expect(sent.at(-1)).toEqual({ type: 'resync', worldId: 'w1', have })
        expect([...lock.heldParts.keys()].sort()).toEqual([...new Set(have)].sort())
        // stepping stops until a new snapshot replaces it
        expect(lock.frame()).toBe(0)
    })

    it('far behind the allowance it asks for a resync instead of replaying, offering nothing before a hash matched', async () => {
        const room = new Room()
        const { lock, sent, resyncs } = await client(room)
        lock.receive({ type: 'allowance', tick: RT_RESYNC_BEHIND_TICKS + 1 })
        expect(lock.frame()).toBe(0)
        expect(resyncs).toEqual(['behind'])
        expect(sent.at(-1)).toEqual({ type: 'resync', worldId: 'w1', have: [] })
        expect(lock.heldParts.size).toBe(0)
    })

    it('rebuilds from the parts it offered: the room sends only the ones that changed', async () => {
        const room = new Room()
        const script = shuttle(room.world, 10)
        script.forEach((c, k) => room.stamp(1 + k, 0, c))
        const { lock } = await client(room)
        room.runTo(400)
        for (const [tick, hash] of room.hashes) lock.receive({ type: 'hash', tick, hash })
        catchUp(lock, 150)
        const have = lock.offerParts()
        expect(have.length).toBe(1 + 16)
        // the room moved on 250 ticks: the train and the economy moved, the map did not
        const snapshot = room.snapshot(have)
        expect(snapshot.zipped.size).toBeGreaterThan(0)
        expect(snapshot.zipped.size).toBeLessThan(have.length)
        expect(snapshot.zipped.has(0)).toBe(true)
        const sent: RtClientMsg[] = []
        const rebuilt = await RtLockstep.create(snapshot, msg => sent.push(msg), { previous: lock, local: lock.heldParts })
        expect(rebuilt).not.toBeNull()
        expect(rebuilt!.world.hash()).toBe(room.world.hash())
        expect(sent).toEqual([{ type: 'loaded', worldId: 'w1' }])
    })

    it('a left-out part it does not hold, or a part that does not match its hash, asks for a full resync', async () => {
        const room = new Room()
        shuttle(room.world, 10).forEach((c, k) => room.stamp(1 + k, 0, c))
        room.runTo(20)
        const full = room.snapshot()
        const sent: RtClientMsg[] = []
        // the room left part 3 out, but nothing holds it
        const missing = new Map(full.zipped)
        missing.delete(3)
        expect(await RtLockstep.create({ ...full, zipped: missing }, msg => sent.push(msg))).toBeNull()
        // part 3 swapped for part 4's bytes: it inflates, but not to its hash
        const swapped = new Map(full.zipped)
        swapped.set(3, full.zipped.get(4)!)
        expect(await RtLockstep.create({ ...full, zipped: swapped }, msg => sent.push(msg))).toBeNull()
        // an older copy of the right chunk: it decodes, but lacks a tree planted since
        const w = room.world
        let tile = w.map.idx(40, 40)
        while (w.map.kind[tile] !== RtTileKind.clear) tile++
        const before = room.snapshot()
        w.map.setTile(tile, RtTileKind.tree, RT_OWNER_NONE, 0)
        const after = room.snapshot()
        const chunk = 1 + rtChunkOfTile(64, tile)
        expect(after.head.parts[chunk]).not.toBe(before.head.parts[chunk])
        const stale = new Map(after.zipped).set(chunk, before.zipped.get(chunk)!)
        expect(await RtLockstep.create({ ...after, zipped: stale }, msg => sent.push(msg))).toBeNull()
        expect((await RtLockstep.create(after, () => {}))!.world.map.kind[tile]).toBe(RtTileKind.tree)
        // a held part filed under the wrong hash: chunk 4 where chunk 3 belongs does not decode
        const lied = new Map([[full.head.parts[3]!, encodeWorldParts(room.world)[4]!]])
        expect(await RtLockstep.create({ ...full, zipped: missing }, msg => sent.push(msg), { local: lied })).toBeNull()
        // and a snapshot RtNet found broken is never built at all
        expect(await RtLockstep.create({ ...full, broken: true }, msg => sent.push(msg))).toBeNull()
        expect(sent).toEqual(Array(5).fill({ type: 'resync', worldId: 'w1', have: [] }))
        expect(await RtLockstep.create(full, () => {})).not.toBeNull()
    })

    it('a command stamped for a tick already passed asks for a resync', async () => {
        const room = new Room()
        const { lock, resyncs } = await client(room)
        catchUp(lock, 20)
        lock.receive({ type: 'command', tick: 5, company: 0, command: encodeCommand({ kind: RtCommandKind.demolish, tile: 0 }) })
        expect(resyncs).toEqual(['late'])
    })

    it('a snapshot taken while the room was paused steps as soon as allowances arrive', async () => {
        const room = new Room()
        room.runTo(30)
        const { lock } = await client(room)
        const paused: string[] = []
        lock.on('paused', reason => paused.push(reason))
        lock.receive({ type: 'paused', reason: 'noPlayers' })
        expect(lock.frame()).toBe(0)
        expect(paused).toEqual(['noPlayers'])
        lock.receive({ type: 'resumed' })
        lock.receive({ type: 'allowance', tick: 35 })
        expect(lock.frame()).toBe(5)
        expect(lock.paused).toBe(false)
    })

    it('a closed world turns the player into a spectator and a command is refused locally', async () => {
        const room = new Room()
        const { lock } = await client(room)
        const demolish = { kind: RtCommandKind.demolish, tile: 0 } as const
        expect(lock.commandMessage(demolish, 1)).toEqual({ type: 'command', seq: 1, command: demolish })
        const roles: string[] = []
        lock.on('role', role => roles.push(role))
        lock.receive({ type: 'worldClosed' })
        expect(roles).toEqual(['spectator'])
        expect(lock.commandMessage(demolish, 2)).toBeNull()
    })

    it('a snapshot that does not inflate, or inflates past the cap, is refused with a resync request', async () => {
        const room = new Room()
        const snapshot = room.snapshot()
        const entity = snapshot.zipped.get(0)!
        expect(await rtGunzip(entity, 10)).toBeNull()
        expect((await rtGunzip(entity))!.length).toBe(encodeWorldParts(room.world)[0]!.length)
        const sent: RtClientMsg[] = []
        const garbage = new Map(snapshot.zipped).set(0, new Uint8Array([1, 2, 3]))
        expect(await RtLockstep.create({ ...snapshot, zipped: garbage }, msg => sent.push(msg))).toBeNull()
        expect(sent).toEqual([{ type: 'resync', worldId: 'w1', have: [] }])
    })

    it('reports payments and vehicle list changes', async () => {
        const room = new Room()
        const w = room.world
        // houses by both stations, so passengers come and go
        for (const cx of [6, 22]) {
            w.towns.push({
                id: w.towns.length, name: `Town ${w.towns.length}`, centre: w.map.idx(cx, 13), houseCount: 6, population: 300, growthCounter: 0,
                growthRate: 0, growing: false, activeStations: 0, receivedThisMonth: RT_CARGO_IDS.map(() => 0), receivedLastMonth: RT_CARGO_IDS.map(() => 0)
            })
            for (let dx = -2; dx <= 3; dx++) w.map.setTile(w.map.idx(cx + dx, 13), RtTileKind.house, RT_OWNER_NONE, 2)
        }
        shuttle(w, 10).forEach((c, k) => room.stamp(1 + k, 0, c))
        const { lock } = await client(room)
        let vehicles = 0
        let paid = 0
        lock.on('vehicles', () => vehicles++)
        lock.on('payment', p => (paid += p.amount))
        catchUp(lock, RT_CATALOG.time.dayTicks * 60)
        expect(vehicles).toBe(1)
        // the first round trip runs empty; a 16-tile shuttle first earns around day 40
        expect(paid).toBeGreaterThan(0)
    })
})

/* ------------------------------------------------------------------------------------------
 * RtNet with a fake socket and clock
 * ---------------------------------------------------------------------------------------- */

class FakeSocket implements RtSocket {
    binaryType = ''
    readyState = 0
    sent: Uint8Array[] = []
    onopen: ((event: unknown) => void) | null = null
    onmessage: ((event: { data: unknown }) => void) | null = null
    onclose: ((event: { code: number }) => void) | null = null
    onerror: ((event: unknown) => void) | null = null
    send(data: Uint8Array) {
        this.sent.push(data)
    }

    close() {
        this.readyState = 3
    }

    open() {
        this.readyState = 1
        this.onopen?.({})
    }

    deliver(msg: RtServerMsg) {
        this.onmessage?.({ data: encodeServerMsg(msg).slice().buffer })
    }

    drop(code: number) {
        this.readyState = 3
        this.onclose?.({ code })
    }
}

function fakeNet() {
    const sockets: FakeSocket[] = []
    const timers: { fn: () => void, ms: number }[] = []
    const net = new RtNet({
        url: 'ws://test/api/rail-tycoon/ws',
        buildId: 'build-1',
        socket: () => {
            const s = new FakeSocket()
            sockets.push(s)
            return s
        },
        now: () => 1000,
        setTimeout: (fn, ms) => timers.push({ fn, ms }),
        clearTimeout: () => {},
        setInterval: () => 0,
        clearInterval: () => {}
    })
    return { net, sockets, timers }
}

describe('RtNet', () => {
    it('stops as outdated on a hello from another build, and on 4401 and 4409 for good', () => {
        const { net, sockets } = fakeNet()
        const stops: string[] = []
        net.on('stopped', reason => stops.push(reason))
        net.connect()
        sockets[0]!.open()
        sockets[0]!.deliver({ type: 'hello', version: RT_PROTOCOL_VERSION, buildId: 'build-1' })
        expect(net.stopped).toBeNull()
        sockets[0]!.deliver({ type: 'hello', version: RT_PROTOCOL_VERSION, buildId: 'build-2' })
        expect(stops).toEqual(['outdated'])
        net.connect()
        expect(sockets.length).toBe(1)
        for (const [code, reason] of [[4401, 'unauthorized'], [4409, 'replaced']] as const) {
            const other = fakeNet()
            other.net.connect()
            other.sockets[0]!.open()
            other.sockets[0]!.drop(code)
            expect(other.net.stopped).toBe(reason)
            expect(other.timers).toEqual([])
        }
    })

    it('reconnects with backoff capped at 3 s, also after a 4408 backlog close, and says reconnected', () => {
        const { net, sockets, timers } = fakeNet()
        let reconnected = 0
        net.on('reconnected', () => reconnected++)
        net.connect()
        sockets[0]!.open()
        sockets[0]!.drop(4408)
        for (let k = 0; k < 6; k++) {
            timers.at(-1)!.fn()
            sockets.at(-1)!.drop(1006)
        }
        expect(timers.map(t => t.ms)).toEqual([250, 500, 1000, 2000, 3000, 3000, 3000])
        timers.at(-1)!.fn()
        sockets.at(-1)!.open()
        expect(reconnected).toBe(1)
    })

    it('holds world messages while a lockstep is built and hands them over in order', async () => {
        const room = new Room()
        const s = room.stamp(20, 0, { kind: RtCommandKind.buildDepot, tile: room.world.map.idx(30, 30), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
        room.runTo(10)
        const { net, sockets } = fakeNet()
        net.connect()
        sockets[0]!.open()
        // a holder object: a let assigned inside the listener would narrow to null at the await
        const build: { promise: Promise<RtLockstep | null> | null } = { promise: null }
        const direct: RtServerMsg[] = []
        net.on('snapshot', (snapshot) => {
            build.promise = RtLockstep.create(snapshot, m => net.send(m))
        })
        net.on('message', msg => direct.push(msg))
        // small fragments, so each part is joined from several frames
        for (const msg of room.frames([], 40, false)) sockets[0]!.deliver(msg)
        expect(build.promise).not.toBeNull()
        // these arrive while the snapshot is still inflating
        sockets[0]!.deliver({ type: 'command', ...s })
        sockets[0]!.deliver({ type: 'allowance', tick: 300 })
        room.runTo(300)
        sockets[0]!.deliver({ type: 'hash', tick: 200, hash: room.hashes.get(200)! })
        expect(direct).toEqual([])
        const lock = (await build.promise)!
        net.release(msg => lock.receive(msg))
        const resyncs: string[] = []
        lock.on('resync', r => resyncs.push(r))
        for (let k = 0; k < 100 && lock.world.tick < 300; k++) lock.frame()
        expect(resyncs).toEqual([])
        expect(lock.world.tick).toBe(300)
        expect(lock.world.hash()).toBe(room.world.hash())
        // after release, world messages flow straight through again
        sockets[0]!.deliver({ type: 'allowance', tick: 400 })
        expect(direct).toEqual([{ type: 'allowance', tick: 400 }])
    })

    it('joins each part from its fragments, and drops snapshot frames that come without a head', () => {
        const room = new Room()
        shuttle(room.world, 10).forEach((c, k) => room.stamp(1 + k, 0, c))
        room.runTo(20)
        const { net, sockets } = fakeNet()
        net.connect()
        sockets[0]!.open()
        const snapshots: RtSnapshot[] = []
        net.on('snapshot', snapshot => snapshots.push(snapshot))
        const frames = room.frames([], 16)
        const expected = room.snapshot()
        expect(frames.length).toBeGreaterThan(2 * expected.head.parts.length)
        for (const msg of frames) sockets[0]!.deliver(msg)
        expect(snapshots).toHaveLength(1)
        expect(snapshots[0]!.broken).toBe(false)
        expect(snapshots[0]!.head).toEqual(expected.head)
        expect(snapshots[0]!.pending).toEqual(expected.pending)
        expect([...snapshots[0]!.zipped]).toEqual([...expected.zipped])
        // a part or an end after the snapshot finished belongs to nothing
        sockets[0]!.deliver(frames[1]!)
        sockets[0]!.deliver(frames.at(-1)!)
        expect(snapshots).toHaveLength(1)
    })

    it('breaks a snapshot whose parts interleave, repeat, run past the head or stop short, or whose end is for another tick', () => {
        const room = new Room()
        room.runTo(20)
        const [head, ...rest] = room.frames([], 1 << 20)
        const end = rest.at(-1) as Extract<RtServerMsg, { type: 'snapshotEnd' }>
        const part = (index: number, last: boolean): RtServerMsg => ({ type: 'part', index, last, bytes: new Uint8Array([index + 1]) })
        const run = (frames: RtServerMsg[]) => {
            const { net, sockets } = fakeNet()
            net.connect()
            sockets[0]!.open()
            const broken: boolean[] = []
            net.on('snapshot', snapshot => broken.push(snapshot.broken))
            for (const msg of frames) sockets[0]!.deliver(msg)
            return broken
        }
        expect(run([head!, part(0, false), part(0, true), part(1, true), end])).toEqual([false])
        expect(run([head!, part(0, false), part(1, true), part(0, true), end])).toEqual([true])
        expect(run([head!, part(0, true), part(0, true), end])).toEqual([true])
        expect(run([head!, part(17, true), end])).toEqual([true])
        expect(run([head!, part(0, false), end])).toEqual([true])
        expect(run([head!, part(0, true), { ...end, tick: end.tick + 1 }])).toEqual([true])
        // a new head starts over: the first snapshot is never emitted
        expect(run([head!, part(0, false), head!, part(1, true), end])).toEqual([false])
    })
})
