/**
 * hostileClientSpec: nothing is cheatable through socket requests (Michael,
 * 2026-10-29). A real RtHub and real RtRooms with fake sockets, an in-memory registry and store, and
 * fake timers. A hostile peer sends hand-built frames; an honest peer replays the server's stamped
 * stream the way the client lockstep does and checks every hash the room sends; a control world that
 * never saw the hostile frames is replayed beside it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { RtHub, type RtHubDeps, type RtHubSocket } from '#server/utils/rail-tycoon/hub'
import type { RtAccess } from '#server/utils/rail-tycoon/registry'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import {
    applyCommand,
    decodeCommand,
    encodeCommand,
    RT_SERVER_COMPANY,
    RtCommandKind,
    type RtCommand
} from '#shared/utils/rail-tycoon/commands'
import {
    RT_CREATE_COOLDOWN_MS,
    RT_HASH_EVERY,
    RT_INVITE_CODE_ALPHABET,
    RT_INVITE_FAILS_PER_MINUTE,
    RT_JOIN_PAUSE_WINDOW_MS,
    RT_MAX_LIVE_ROOMS,
    RT_MAX_PENDING_CREATES,
    RT_OPEN_COOLDOWN_MS,
    RT_SOCKET_MSG_BURST
} from '#shared/utils/rail-tycoon/limits'
import { RtDir } from '#shared/utils/rail-tycoon/map'
import {
    decodeClientMsg,
    decodeServerMsg,
    encodeClientMsg,
    type RtClientMsg,
    type RtErrorCode,
    type RtServerMsg,
    type RtStampedCommand
} from '#shared/utils/rail-tycoon/protocol'
import { decodeWorldOrThrow, decodeWorldPartsOrThrow, encodeWorld, encodeWorldParts, rtPartHash, type RtWorldParts } from '#shared/utils/rail-tycoon/save'
import { RtSignalType } from '#shared/utils/rail-tycoon/signals'
import { RtAxis, RtRoadStopShape } from '#shared/utils/rail-tycoon/stations-build'
import { RT_ROAD_X, RT_ROAD_Y, RtTrack, rtCrossingRoadOwner, rtIsCrossing, rtPieceBetween, rtTrackdirOf } from '#shared/utils/rail-tycoon/track'
import { RtOrderKind, RtVehicleKind, RtVehicleState, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import { RtWorld, rtNewCompany } from '#shared/utils/rail-tycoon/world'

const TICK = RT_CATALOG.time.tickMs
const DAY_TICKS = RT_CATALOG.time.dayTicks
const K = RtCommandKind
const ENGINE = RT_CATALOG.vehicles.models.expressEngine.index
const EAST = rtTrackdirOf(RtTrack.x, true)
const SIDE = 64
const HONEST = 0
const HOSTILE = 1

const at = (x: number, y: number) => y * SIDE + x

/* ---- worlds ---- */

function must(world: RtWorld, company: number, command: RtCommand) {
    const result = applyCommand(world, company, command, true)
    if (!result.ok) throw new Error(`setup command ${command.kind} refused (${result.error})`)
    return result
}

/** A blank map with the honest company (0) and the hostile one (1). */
function blankWorld(sharing: boolean, money = 1_000_000): RtWorld {
    const world = RtWorld.empty({ side: SIDE, maxCompanies: 8, sharing }, {
        rngState: 7,
        companies: [rtNewCompany(HONEST, 'Honest', 0, 0), rtNewCompany(HOSTILE, 'Hostile', 1, 0)]
    })
    for (const company of world.companyList()) company.money = money
    return world
}

/** A train bought in a new own depot at (x, y) facing `facing`, started. */
function train(world: RtWorld, owner: number, x: number, y: number, facing: number, start = true): RtVehicle {
    must(world, owner, { kind: K.buildDepot, tile: at(x, y), vehicleKind: RtVehicleKind.rail, facing })
    const vehicle = world.vehicle(must(world, owner, { kind: K.buyVehicle, depot: at(x, y), model: ENGINE, wagons: [] }).id!)!
    if (start) must(world, owner, { kind: K.startStop, vehicle: vehicle.id, stopped: false })
    return vehicle
}

interface Scene {
    raw: Uint8Array
    honestTrain: number
    honestStation: number
    hostileTrain: number
}

/**
 * The honest company: a main line on row 10 with a depot and a running train, and a station on row
 * 20. The hostile company: its own line on row 40 with a train left in its depot, and `hostileMoney`.
 */
function scene(options: { sharing?: boolean, hostileMoney?: number, honestTrainRuns?: boolean } = {}): Scene {
    const world = blankWorld(options.sharing ?? false)
    must(world, HONEST, { kind: K.buildRailLine, tile: at(6, 10), endTile: at(40, 10), trackdir: EAST })
    const honestTrain = options.honestTrainRuns === false ? null : train(world, HONEST, 5, 10, RtDir.sw)
    const station = must(world, HONEST, { kind: K.buildRailStation, tile: at(20, 20), axis: RtAxis.x, tracks: 1, length: 3 })
    must(world, HOSTILE, { kind: K.buildRailLine, tile: at(6, 40), endTile: at(30, 40), trackdir: EAST })
    const hostileTrain = train(world, HOSTILE, 5, 40, RtDir.sw, false)
    if (options.hostileMoney !== undefined) world.company(HOSTILE)!.money = options.hostileMoney
    return { raw: encodeWorld(world), honestTrain: honestTrain?.id ?? -1, honestStation: station.id!, hostileTrain: hostileTrain.id }
}

/* ---- fakes ---- */

function httpError(statusCode: number, statusMessage: string): Error {
    return Object.assign(new Error(statusMessage), { statusCode, statusMessage })
}

interface FakeWorld {
    id: string
    ownerId: string
    status: 'open' | 'closed'
    inviteCode: string
    members: Map<string, number>
    save: Uint8Array
    revision: number
}

class FakeRegistry {
    worlds = new Map<string, FakeWorld>()
    generated = 0
    generating = 0
    maxGenerating = 0
    lookups = 0
    openCap = 5
    /** Resolves a pending generation; null when creates finish at once. */
    gate: Promise<void> | null = null
    private seq = 0

    add(ownerId: string, save: Uint8Array, members: [string, number][] = [[ownerId, HONEST]], status: 'open' | 'closed' = 'open'): FakeWorld {
        this.seq++
        const world: FakeWorld = {
            id: `hw${String(this.seq).padStart(4, '0')}`,
            ownerId,
            status,
            inviteCode: `H${String(this.seq).padStart(15, '0')}`,
            members: new Map(members),
            save,
            revision: 0
        }
        this.worlds.set(world.id, world)
        return world
    }

    byInvite(code: string): FakeWorld | undefined {
        for (const world of this.worlds.values()) if (world.inviteCode === code) return world
        return undefined
    }

    deps(base: Uint8Array): Omit<RtHubDeps, 'buildId' | 'now' | 'setInterval' | 'clearInterval' | 'setTimeout' | 'clearTimeout' | 'log'> {
        return {
            rtListWorldsForUser: async () => [],
            rtCreateWorld: async (userId) => {
                const open = [...this.worlds.values()].filter(world => world.ownerId === userId && world.status === 'open').length
                if (open >= this.openCap) throw httpError(409, 'You already have open worlds; stop one first')
                this.generating++
                this.maxGenerating = Math.max(this.maxGenerating, this.generating)
                try {
                    if (this.gate) await this.gate
                    this.generated++
                    const world = this.add(userId, base)
                    return { worldId: world.id, inviteCode: world.inviteCode }
                } finally {
                    this.generating--
                }
            },
            rtJoinWorld: async (userId, userName, inviteCode) => {
                const world = this.byInvite(inviteCode)
                if (!world) throw httpError(404, 'No world has that invite code')
                const member = world.members.get(userId)
                if (member !== undefined) return { worldId: world.id, companyId: member, joined: false }
                if (world.status !== 'open') throw httpError(409, 'World is closed')
                const loaded = decodeWorldOrThrow(world.save)
                const companyId = loaded.addCompany(userName)
                if (companyId === null) throw httpError(409, 'World is full')
                world.save = encodeWorld(loaded)
                world.revision++
                world.members.set(userId, companyId)
                return { worldId: world.id, companyId, joined: true }
            },
            rtGetAccess: async (userId, worldId, inviteCode): Promise<RtAccess> => {
                const world = this.worlds.get(worldId)
                if (!world) return { role: 'none', status: null, companyId: null }
                const member = world.members.get(userId)
                if (member !== undefined && world.status === 'open') return { role: 'player', status: 'open', companyId: member }
                if (member !== undefined || world.ownerId === userId || inviteCode === world.inviteCode) return { role: 'spectator', status: world.status, companyId: null }
                return { role: 'none', status: null, companyId: null }
            },
            rtCloseWorld: async (userId, worldId) => {
                const world = this.worlds.get(worldId)
                if (!world) throw httpError(404, 'World not found')
                if (world.ownerId !== userId) throw httpError(403, 'Only the owner can do that')
                if (world.status !== 'open') throw httpError(409, 'World is already closed')
                world.status = 'closed'
                return {}
            },
            rtDeleteWorld: async (userId, worldId) => {
                const world = this.worlds.get(worldId)
                if (!world) throw httpError(404, 'World not found')
                if (world.ownerId !== userId) throw httpError(403, 'Only the owner can do that')
                this.worlds.delete(worldId)
                return {}
            },
            rtFindWorldByInvite: async (inviteCode) => {
                this.lookups++
                return this.byInvite(inviteCode)?.id ?? null
            },
            rtLoadWorld: async (id) => {
                const world = this.worlds.get(id)
                if (!world) return null
                return {
                    id,
                    ownerId: world.ownerId,
                    status: world.status,
                    revision: world.revision,
                    lastActiveAt: new Date(0),
                    inviteCode: world.inviteCode,
                    world: decodeWorldOrThrow(world.save)
                }
            },
            rtSaveCheckpoint: async (id, parts, _tick, expectedRevision, _now, options = {}) => {
                const world = this.worlds.get(id)
                if (!world) throw httpError(404, 'World not found')
                if (world.revision !== expectedRevision) throw httpError(409, 'World was saved by another writer')
                world.save = encodeWorld(decodeWorldPartsOrThrow(parts))
                world.revision++
                if (options.member) world.members.set(options.member.userId, options.member.companyId)
                return world.revision
            }
        }
    }
}

/** A socket that records every frame and, like the client lockstep, replays the stamped stream into its own world. */
class ReplaySocket implements RtHubSocket {
    frames: RtServerMsg[] = []
    closed: { code: number, reason: string } | null = null
    world: RtWorld | null = null
    queue: RtStampedCommand[] = []
    hashes = new Map<number, number>()
    hashChecks = 0
    mismatches: number[] = []
    private incoming: { parts: readonly string[], fragments: Map<number, Uint8Array[]> } | null = null

    constructor(readonly replay = false) {}

    /** Fake-clock times the room paused and resumed. */
    marks: { type: 'paused' | 'resumed', at: number }[] = []

    send(frame: Uint8Array): void {
        const msg = decodeServerMsg(frame)
        if (!msg) throw new Error('hub sent a frame that does not decode')
        this.frames.push(msg)
        if (msg.type === 'paused' || msg.type === 'resumed') this.marks.push({ type: msg.type, at: Date.now() })
        if (this.replay) this.handle(msg)
    }

    /** Milliseconds of [from, to) the room spent paused, from the paused and resumed frames. */
    pausedMs(from: number, to: number): number {
        let total = 0
        let since: number | null = null
        for (const mark of this.marks) {
            if (mark.type === 'paused' && since === null) since = mark.at
            if (mark.type === 'resumed' && since !== null) {
                total += Math.max(0, Math.min(mark.at, to) - Math.max(since, from))
                since = null
            }
        }
        if (since !== null) total += Math.max(0, to - Math.max(since, from))
        return total
    }

    close(code: number, reason: string): void {
        this.closed = { code, reason }
    }

    of<T extends RtServerMsg['type']>(type: T): Extract<RtServerMsg, { type: T }>[] {
        return this.frames.filter(msg => msg.type === type) as Extract<RtServerMsg, { type: T }>[]
    }

    errors(): RtErrorCode[] {
        return this.of('error').map(msg => msg.code)
    }

    private handle(msg: RtServerMsg): void {
        switch (msg.type) {
            case 'opened':
            case 'resync':
                this.incoming = { parts: msg.parts, fragments: new Map() }
                break
            case 'part': {
                const list = this.incoming!.fragments.get(msg.index) ?? []
                list.push(msg.bytes.slice())
                this.incoming!.fragments.set(msg.index, list)
                break
            }
            case 'snapshotEnd': {
                // these sockets offer no parts, so every part arrives and must match its hash
                const { parts, fragments } = this.incoming!
                this.incoming = null
                const bytes = parts.map((hash, index) => {
                    const part = gunzip(Buffer.concat(fragments.get(index)!))
                    if (rtPartHash(part) !== hash) throw new Error(`part ${index} does not match its hash`)
                    return part
                })
                this.world = decodeWorldPartsOrThrow(bytes)
                this.queue = [...msg.pending]
                this.hashes.clear()
                break
            }
            case 'command':
                this.queue.push({ tick: msg.tick, company: msg.company, command: msg.command })
                break
            case 'hash':
                this.hashes.set(msg.tick, msg.hash)
                break
            case 'allowance':
                this.advance(msg.tick)
                break
        }
    }

    private check(): void {
        const world = this.world!
        const expected = this.hashes.get(world.tick)
        if (expected === undefined) return
        this.hashes.delete(world.tick)
        this.hashChecks++
        if (expected !== world.hash()) this.mismatches.push(world.tick)
    }

    private advance(allowance: number): void {
        const world = this.world
        if (!world) return
        while (world.tick < allowance) {
            this.check()
            const due = this.queue.filter(stamped => stamped.tick <= world.tick)
            this.queue = this.queue.filter(stamped => stamped.tick > world.tick)
            for (const stamped of due) applyCommand(world, stamped.company ?? RT_SERVER_COMPANY, decodeCommand(stamped.command, world.map.side)!, true)
            world.step()
        }
        this.check()
    }
}

let gunzip: (bytes: Uint8Array) => Uint8Array

beforeAll(async () => {
    const zlib = await import('node:zlib')
    gunzip = bytes => zlib.gunzipSync(bytes)
})

/** A world replayed from `raw` with only the stamped commands `keep` lets through, stepped to `tick`. */
function control(raw: Uint8Array, stamped: RtStampedCommand[], tick: number, keep: (company: number | null) => boolean): RtWorld {
    const world = decodeWorldOrThrow(raw)
    const queue = stamped.filter(entry => keep(entry.company))
    while (world.tick < tick) {
        for (const entry of queue) {
            if (entry.tick === world.tick) applyCommand(world, entry.company ?? RT_SERVER_COMPANY, decodeCommand(entry.command, SIDE)!, true)
        }
        world.step()
    }
    return world
}

interface Client {
    userId: string
    socket: ReplaySocket
    send(msg: RtClientMsg): void
    raw(bytes: Uint8Array): void
}

const hubs: RtHub[] = []

function setup(base: Uint8Array, options: { encodeWorldParts?: (world: RtWorld) => RtWorldParts, perfNow?: () => number } = {}) {
    const registry = new FakeRegistry()
    const log = vi.fn<RtHubDeps['log']>()
    const hub = new RtHub({
        ...registry.deps(base),
        buildId: 'hostile-spec',
        now: () => Date.now(),
        setInterval: (callback, ms) => setInterval(callback, ms),
        clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
        setTimeout: (callback, ms) => setTimeout(callback, ms),
        clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
        log,
        ...(options.encodeWorldParts ? { encodeWorldParts: options.encodeWorldParts } : {}),
        ...(options.perfNow ? { perfNow: options.perfNow } : {})
    })
    hubs.push(hub)
    const connect = (userId: string, replay = false): Client => {
        const socket = new ReplaySocket(replay)
        expect(hub.connect(socket, { id: userId, name: userId })).toBe(true)
        return {
            userId,
            socket,
            send: msg => hub.message(socket, encodeClientMsg(msg)),
            raw: bytes => hub.message(socket, bytes)
        }
    }
    const stepErrors = () => log.mock.calls.filter(([, message]) => message.includes('threw'))
    return { hub, registry, log, connect, stepErrors }
}

async function until(condition: () => boolean, label = 'condition'): Promise<void> {
    const started = performance.now()
    while (!condition()) {
        if (performance.now() - started > 10000) throw new Error(`timed out waiting for ${label}`)
        await new Promise(resolve => setImmediate(resolve))
    }
}

/** Steps fake time a tick at a time, letting real async work run, until the condition holds. */
async function advanceUntil(condition: () => boolean, label: string, maxTicks = 2000): Promise<void> {
    for (let t = 0; t < maxTicks && !condition(); t++) {
        vi.advanceTimersByTime(TICK)
        await new Promise(resolve => setImmediate(resolve))
    }
    await until(condition, label)
}

async function settle(ms = 20): Promise<void> {
    const started = performance.now()
    while (performance.now() - started < ms) await new Promise(resolve => setImmediate(resolve))
}

async function open(client: Client, worldId: string, inviteCode: string | null = null): Promise<RtServerMsg> {
    const before = client.socket.frames.length
    client.send({ type: 'open', worldId, inviteCode, have: [] })
    await until(() => client.socket.frames.slice(before).some(msg => msg.type === 'opened' || msg.type === 'error'), `open of ${worldId}`)
    return client.socket.frames.slice(before).find(msg => msg.type === 'opened' || msg.type === 'error')!
}

async function openLoaded(client: Client, worldId: string, inviteCode: string | null = null): Promise<void> {
    const answer = await open(client, worldId, inviteCode)
    expect(answer.type).toBe('opened')
    client.send({ type: 'loaded', worldId })
}

/** A command frame carrying bytes the protocol's encoder would refuse to write. */
function commandFrame(seq: number, command: Uint8Array): Uint8Array {
    return new Uint8Array([0x06, seq, ...command])
}

function commandBytes(command: RtCommand): Uint8Array {
    return encodeCommand(command)
}

/** A command kind followed by little-endian u32 fields and u8 fields, built by hand past every encoder check. */
function rawCommand(kind: number, u32s: number[], u8s: number[] = []): Uint8Array {
    const bytes = new Uint8Array(1 + u32s.length * 4 + u8s.length)
    const view = new DataView(bytes.buffer)
    bytes[0] = kind
    u32s.forEach((value, i) => view.setUint32(1 + i * 4, value >>> 0, true))
    u8s.forEach((value, i) => {
        bytes[1 + u32s.length * 4 + i] = value
    })
    return bytes
}

/** A deterministic stream for building hostile input (never for outcomes). */
function prng(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'))
})

afterEach(() => {
    for (const hub of hubs.splice(0)) hub.dispose()
    vi.useRealTimers()
})

/* ---- hand-built frames ---- */

describe('hostileClientSpec: hand-built frames gain nothing', () => {
    it('every refused frame leaves the honest hash equal to a control world that never saw it', async () => {
        // no cash: every build is unaffordable, even a drag's first tile (a drag builds what it can pay for)
        const s = scene({ hostileMoney: 0 })
        const { hub, registry, connect, stepErrors } = setup(s.raw)
        const world = registry.add('honest', s.raw, [['honest', HONEST], ['hostile', HOSTILE]])
        const other = registry.add('stranger', s.raw, [['stranger', HONEST]])
        const honest = connect('honest', true)
        const hostile = connect('hostile')
        await openLoaded(honest, world.id)
        await openLoaded(hostile, world.id)
        const room = hub.room(world.id)!
        vi.advanceTimersByTime(TICK * 10)

        const honestRail = at(20, 10)
        const frames: Uint8Array[] = []
        let unencodable = 0
        const cmd = (command: RtCommand) => {
            try {
                frames.push(encodeClientMsg({ type: 'command', seq: frames.length & 255, command }))
            } catch {
                // the client's own encoder refuses it: send the raw command bytes, or count it when those refuse too
                try {
                    frames.push(commandFrame(frames.length & 255, commandBytes(command)))
                } catch {
                    unencodable++
                }
            }
        }
        // every command kind against the honest company's track, vehicles and station
        cmd({ kind: K.removeRail, tile: honestRail, piece: RtTrack.x })
        cmd({ kind: K.buildRail, tile: honestRail, piece: RtTrack.y })
        cmd({ kind: K.buildRailLine, tile: at(15, 10), endTile: at(25, 10), trackdir: EAST })
        // a road along the honest rail (a crossing across it is legal, and is not sent here)
        cmd({ kind: K.buildRoad, tile: honestRail, bits: RT_ROAD_X })
        cmd({ kind: K.removeRoad, tile: honestRail, bits: RT_ROAD_Y })
        cmd({ kind: K.buildRoadLine, tile: at(15, 10), endTile: at(25, 10) })
        cmd({ kind: K.buildRailStation, tile: at(18, 10), axis: RtAxis.x, tracks: 1, length: 3 })
        cmd({ kind: K.buildRoadStop, tile: honestRail, stop: 0 })
        // road stop shapes: a bay or a drive-through stop on the honest rail, and bytes past every encoder check
        cmd({ kind: K.buildRoadStop, tile: honestRail, stop: 1, shape: RtRoadStopShape.bayNe })
        cmd({ kind: K.buildRoadStop, tile: honestRail, stop: 2, shape: RtRoadStopShape.driveX })
        for (const [i, packed] of [1 | (7 << 2), 2 | (31 << 2), 0 | (3 << 2), 3 | (1 << 2), 0xff, 1 | (1 << 5)].entries()) {
            frames.push(commandFrame(20 + i, rawCommand(K.buildRoadStop, [at(30, 30)], [packed])))
        }
        cmd({ kind: K.buildDepot, tile: honestRail, vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
        cmd({ kind: K.placeSignal, tile: honestRail, piece: RtTrack.x, signalType: RtSignalType.block })
        cmd({ kind: K.demolish, tile: honestRail })
        cmd({ kind: K.demolish, tile: at(5, 10) })
        cmd({ kind: K.demolishArea, tile: at(10, 10), endTile: at(20, 11) })
        cmd({ kind: K.buyVehicle, depot: at(5, 10), model: ENGINE, wagons: [] })
        cmd({ kind: K.sellVehicle, vehicle: s.honestTrain })
        cmd({ kind: K.setOrders, vehicle: s.honestTrain, orders: [] })
        cmd({ kind: K.startStop, vehicle: s.honestTrain, stopped: true })
        cmd({ kind: K.sendToDepot, vehicle: s.honestTrain })
        cmd({ kind: K.reverseTrain, vehicle: s.honestTrain })
        cmd({ kind: K.buildSiding, tile: at(40, 10) })
        cmd({ kind: K.removeSiding, tile: at(40, 10) })
        // orders to a foreign station with sharing off
        cmd({ kind: K.setOrders, vehicle: s.hostileTrain, orders: [{ kind: RtOrderKind.gotoStation, target: s.honestStation, flags: 0 }] })
        cmd({ kind: K.setOrders, vehicle: s.hostileTrain, orders: [{ kind: RtOrderKind.gotoDepot, target: at(5, 10), flags: 0 }] })
        // unaffordable builds and a loan above the maximum
        cmd({ kind: K.buyVehicle, depot: at(5, 40), model: ENGINE, wagons: [] })
        cmd({ kind: K.buildRailLine, tile: at(0, 50), endTile: at(63, 50), trackdir: EAST })
        cmd({ kind: K.changeLoan, steps: 100 })
        cmd({ kind: K.changeLoan, steps: -1 })
        // tiles outside the map, lines and areas past the caps
        frames.push(commandFrame(1, rawCommand(K.buildRail, [SIDE * SIDE + 3], [0])))
        frames.push(commandFrame(2, rawCommand(K.demolish, [0xffffffff])))
        frames.push(commandFrame(3, rawCommand(K.buildSiding, [SIDE * SIDE])))
        frames.push(commandFrame(4, rawCommand(K.buildRailLine, [at(0, 30), SIDE * SIDE + 100], [EAST])))
        frames.push(commandFrame(5, rawCommand(K.demolishArea, [at(0, 0), at(63, 63)])))
        frames.push(commandFrame(6, rawCommand(K.buildRailStation, [at(40, 50)], [0, 64, 255])))
        frames.push(commandFrame(7, rawCommand(K.buyVehicle, [at(5, 40)], [ENGINE, 200])))
        cmd({ kind: K.demolishArea, tile: at(0, 0), endTile: at(63, 63) })
        cmd({ kind: K.buildRailStation, tile: at(40, 50), axis: RtAxis.x, tracks: 8, length: 16 })
        // foundCompany inside a command, and forged company or tick fields
        frames.push(commandFrame(5, commandBytes({ kind: K.foundCompany, name: 'Forged', colour: 3 })))
        frames.push(new Uint8Array([...encodeClientMsg({ type: 'command', seq: 6, command: { kind: K.renameCompany, name: 'X' } }), HONEST]))
        frames.push(new Uint8Array([0x85, 0, 0, 0, 0, HONEST, ...commandBytes({ kind: K.renameCompany, name: 'Forged' })]))
        frames.push(new Uint8Array([0x06, 7, HONEST, ...commandBytes({ kind: K.changeLoan, steps: 1 })]))
        // stop and delete of a world it does not own, and of a stranger's world
        frames.push(encodeClientMsg({ type: 'stop', worldId: world.id }))
        frames.push(encodeClientMsg({ type: 'delete', worldId: world.id }))
        frames.push(encodeClientMsg({ type: 'stop', worldId: other.id }))
        frames.push(encodeClientMsg({ type: 'delete', worldId: other.id }))
        // oversized, truncated and random frames
        frames.push(new Uint8Array(4097).fill(6))
        frames.push(new Uint8Array(65536))
        const rand = prng(1)
        const wellFormed = [...frames]
        for (const frame of wellFormed) {
            if (frame.length < 3) continue
            const cut = frame.subarray(0, 1 + Math.floor(rand() * (frame.length - 1)))
            // a cut that still decodes is a different, well-formed frame: those belong to the random commands below
            if (decodeClientMsg(cut) === null) frames.push(cut)
        }
        let randoms = 0
        while (randoms < 400) {
            const bytes = new Uint8Array(Math.floor(rand() * 64))
            for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(rand() * 256)
            // only frames that do not decode: the decodable ones are the random commands below
            if (decodeClientMsg(bytes) !== null) continue
            frames.push(bytes)
            randoms++
        }

        // paced under the rate limits, with the honest player playing between them
        for (let i = 0; i < frames.length; i++) {
            hostile.raw(frames[i]!)
            if (i % 50 === 0) honest.send({ type: 'command', seq: i & 255, command: { kind: K.renameCompany, name: `Honest ${i}` } })
            if (i % 100 === 0) honest.send({ type: 'command', seq: i & 255, command: { kind: K.changeLoan, steps: i % 200 === 0 ? 1 : -1 } })
            vi.advanceTimersByTime(60)
            await settle(1)
        }
        // then a flood above the rate limits
        const flood = encodeClientMsg({ type: 'command', seq: 9, command: { kind: K.sellVehicle, vehicle: s.honestTrain } })
        for (let i = 0; i < 1000; i++) hostile.raw(flood)
        await settle()
        vi.advanceTimersByTime(TICK * RT_HASH_EVERY * 3)
        await settle()

        expect(unencodable).toBeLessThanOrEqual(2)
        expect(hostile.socket.errors()).toContain('rateLimited')
        expect(hostile.socket.errors()).toContain('badRequest')
        expect(hostile.socket.errors()).toContain('notOwner')
        expect(hostile.socket.of('result').length).toBeGreaterThan(20)
        // nothing the hostile peer sent was stamped
        const stamped = honest.socket.of('command').map(msg => ({ tick: msg.tick, company: msg.company, command: msg.command }))
        expect(stamped.filter(entry => entry.company !== HONEST).map(entry => decodeCommand(entry.command, SIDE))).toEqual([])
        expect(honest.socket.mismatches).toEqual([])
        expect(honest.socket.hashChecks).toBeGreaterThan(5)
        expect(honest.socket.world!.hash()).toBe(room.world.hash())

        const clean = control(s.raw, stamped, room.world.tick, company => company === HONEST)
        expect(room.world.hash()).toBe(clean.hash())
        for (const id of [HONEST, HOSTILE]) expect(room.world.company(id)!.money).toBe(clean.company(id)!.money)
        expect(room.world.company(HONEST)!.name).toBe(clean.company(HONEST)!.name)

        expect(stepErrors()).toEqual([])
        expect(room.isUnloaded).toBe(false)
        expect(honest.socket.closed).toBeNull()
        expect(hostile.socket.closed).toBeNull()
        expect(honest.socket.of('roomUnloaded')).toEqual([])
        expect(registry.worlds.get(world.id)!.status).toBe('open')
        expect(registry.worlds.has(other.id)).toBe(true)

        // the honest player keeps playing
        honest.send({ type: 'command', seq: 1, command: { kind: K.renameCompany, name: 'Still Honest' } })
        vi.advanceTimersByTime(TICK * 10)
        expect(room.world.company(HONEST)!.name).toBe('Still Honest')
    }, 60000)

    it('commands as a spectator, into a closed world and into a world the user is not a member of are refused', async () => {
        const s = scene()
        const { hub, registry, connect } = setup(s.raw)
        const world = registry.add('honest', s.raw, [['honest', HONEST], ['hostile', HOSTILE]])
        const closed = registry.add('honest', s.raw, [['honest', HONEST], ['hostile', HOSTILE]], 'closed')
        const foreign = registry.add('stranger', s.raw, [['stranger', HONEST]])
        const honest = connect('honest', true)
        await openLoaded(honest, world.id)
        const room = hub.room(world.id)!
        const watcher = connect('watcher')
        await openLoaded(watcher, world.id, world.inviteCode)
        vi.advanceTimersByTime(TICK * 5)
        const rename: RtClientMsg = { type: 'command', seq: 1, command: { kind: K.renameCompany, name: 'Taken Over' } }

        watcher.send(rename)
        expect(watcher.socket.errors()).toEqual(['notPlayer'])

        const hostile = connect('hostile')
        await openLoaded(hostile, closed.id)
        expect(hostile.socket.of('opened')[0]).toMatchObject({ role: 'spectator', company: null })
        hostile.send(rename)
        hostile.send({ type: 'join', inviteCode: closed.inviteCode })
        await until(() => hostile.socket.errors().length === 2)
        expect(hostile.socket.errors()).toEqual(['worldClosed', 'worldClosed'])

        vi.advanceTimersByTime(RT_OPEN_COOLDOWN_MS)
        expect(await open(hostile, foreign.id)).toEqual({ type: 'error', code: 'noAccess' })
        // the failed open left the socket where it was: a closed world, so the command is still refused
        hostile.send(rename)
        vi.advanceTimersByTime(RT_OPEN_COOLDOWN_MS)
        expect(await open(hostile, foreign.id, world.inviteCode)).toEqual({ type: 'error', code: 'noAccess' })
        expect(hub.room(foreign.id)).toBeUndefined()

        vi.advanceTimersByTime(TICK * 10)
        expect(honest.socket.of('command')).toEqual([])
        expect(room.world.company(HONEST)!.name).toBe('Honest')
        expect(hostile.socket.errors().filter(code => code !== 'worldClosed' && code !== 'noAccess')).toEqual([])

        // a player's command acts for its own company only: renaming changes only its own name
        const player = connect('hostile')
        vi.advanceTimersByTime(RT_OPEN_COOLDOWN_MS)
        await openLoaded(player, world.id)
        vi.advanceTimersByTime(TICK * 5)
        player.send(rename)
        vi.advanceTimersByTime(TICK * 10)
        expect(room.world.company(HOSTILE)!.name).toBe('Taken Over')
        expect(room.world.company(HONEST)!.name).toBe('Honest')
        expect(honest.socket.of('command').every(msg => msg.company === HOSTILE)).toBe(true)
        expect(honest.socket.mismatches).toEqual([])
    })

    it('10000 random well-formed commands change no other company and never break the room', async () => {
        const s = scene({ honestTrainRuns: false })
        const { hub, registry, connect, stepErrors } = setup(s.raw)
        const world = registry.add('honest', s.raw, [['honest', HONEST], ['hostile', HOSTILE]])
        const honest = connect('honest', true)
        const hostile = connect('hostile')
        await openLoaded(honest, world.id)
        await openLoaded(hostile, world.id)
        const room = hub.room(world.id)!
        const live = room.world
        const startMoney = live.company(HOSTILE)!.money
        const rand = prng(20261030)
        const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
        const tile = () => (rand() < 0.03 ? int(SIDE * SIDE, SIDE * SIDE * 4) : int(0, SIDE * SIDE - 1))
        const vehicle = () => {
            const list = live.vehicleList()
            return list.length > 0 && rand() < 0.8 ? list[int(0, list.length - 1)]!.id : int(0, 40)
        }
        const near = (from: number) => Math.min(SIDE * SIDE - 1, Math.max(0, from + (rand() < 0.5 ? int(-8, 8) : int(-8, 8) * SIDE)))
        const randomCommand = (): RtCommand => {
            const t = tile()
            switch (int(0, 21)) {
                case 0: return { kind: K.buildRail, tile: t, piece: int(0, 6) }
                case 1: return { kind: K.buildRailLine, tile: t, endTile: near(t), trackdir: int(0, 15) }
                case 2: return { kind: K.removeRail, tile: t, piece: int(0, 6) }
                case 3: return { kind: K.buildRoad, tile: t, bits: int(0, 16) }
                case 4: return { kind: K.buildRoadLine, tile: t, endTile: near(t) }
                case 5: return { kind: K.removeRoad, tile: t, bits: int(0, 16) }
                case 6: return { kind: K.buildRailStation, tile: t, axis: int(0, 2), tracks: int(0, 9), length: int(0, 17) }
                case 7: return rand() < 0.5
                    ? { kind: K.buildRoadStop, tile: t, stop: int(0, 3) }
                    : { kind: K.buildRoadStop, tile: t, stop: int(0, 3), shape: int(0, 8) }
                case 8: return { kind: K.buildDepot, tile: t, vehicleKind: int(0, 2), facing: int(0, 4) }
                case 9: return { kind: K.placeSignal, tile: t, piece: int(0, 6), signalType: int(0, 4) }
                case 10: return { kind: K.demolish, tile: t }
                case 11: return { kind: K.demolishArea, tile: t, endTile: near(t) }
                case 12: return { kind: K.buyVehicle, depot: rand() < 0.5 ? at(5, 40) : t, model: int(0, 13), wagons: Array.from({ length: int(0, 3) }, () => int(0, 13)) }
                case 13: return { kind: K.sellVehicle, vehicle: vehicle() }
                case 14: return {
                    kind: K.setOrders,
                    vehicle: vehicle(),
                    orders: Array.from({ length: int(0, 3) }, () => ({ kind: int(0, 2) as RtOrderKind, target: rand() < 0.5 ? int(0, 4) : t, flags: int(0, 8) }))
                }
                case 15: return { kind: K.startStop, vehicle: vehicle(), stopped: rand() < 0.5 }
                case 16: return { kind: K.sendToDepot, vehicle: vehicle() }
                case 17: return { kind: K.reverseTrain, vehicle: vehicle() }
                case 18: return { kind: K.changeLoan, steps: int(-40, 40) }
                case 19: return { kind: K.renameCompany, name: rand() < 0.1 ? '' : `H${int(0, 1e6)}` }
                case 20: return { kind: K.buildSiding, tile: t }
                default: return { kind: K.removeSiding, tile: t }
            }
        }

        let sent = 0
        let skipped = 0
        for (let i = 0; sent < 10000; i++) {
            let frame: Uint8Array
            try {
                frame = encodeClientMsg({ type: 'command', seq: i & 255, command: randomCommand() })
            } catch {
                skipped++
                continue
            }
            hostile.raw(frame)
            sent++
            if (sent % 1000 === 0) honest.send({ type: 'command', seq: 1, command: { kind: K.changeLoan, steps: sent % 2000 === 0 ? -1 : 1 } })
            vi.advanceTimersByTime(50)
            if (sent % 250 === 0) await settle(1)
        }
        vi.advanceTimersByTime(TICK * RT_HASH_EVERY * 2)
        await settle()

        const hostileStamped = honest.socket.of('command').filter(msg => msg.company !== HONEST)
        expect(hostileStamped.length).toBeGreaterThan(100)
        expect(hostileStamped.every(msg => msg.company === HOSTILE)).toBe(true)
        expect(skipped).toBeLessThan(sent)
        expect(honest.socket.mismatches).toEqual([])
        expect(honest.socket.hashChecks).toBeGreaterThan(100)
        expect(honest.socket.world!.hash()).toBe(live.hash())
        expect(stepErrors()).toEqual([])
        expect(room.isUnloaded).toBe(false)

        // the honest company is exactly what its own commands made it, hostile or not
        const stamped = honest.socket.of('command').map(msg => ({ tick: msg.tick, company: msg.company, command: msg.command }))
        const clean = control(s.raw, stamped, live.tick, company => company === HONEST)
        const mine = live.company(HONEST)!
        expect(mine.money).toBe(clean.company(HONEST)!.money)
        expect(mine.loan).toBe(clean.company(HONEST)!.loan)
        // the honest company's tiles: same owner, kind and rail pieces. The one legal change is a level
        // crossing the hostile company may lay across anyone's unsignalled straight: the rail
        // and the tile stay the honest company's, only the road part is the hostile one's.
        let crossings = 0
        for (let t = 0; t < SIDE * SIDE; t++) {
            if (clean.map.owner[t] !== HONEST) continue
            expect(live.map.owner[t]).toBe(HONEST)
            expect(live.map.kind[t]).toBe(clean.map.kind[t])
            const [now, was] = [live.map.payload[t]!, clean.map.payload[t]!]
            if (now === was) continue
            expect(now & 0x3f).toBe(was & 0x3f)
            expect(rtIsCrossing(now) && !rtIsCrossing(was)).toBe(true)
            expect(rtCrossingRoadOwner(now)).toBe(HOSTILE)
            crossings++
        }
        console.info(`[hostile random] ${sent} commands sent, ${skipped} unencodable, ${hostileStamped.length} accepted, ${crossings} level crossings laid across honest track`)
        // money cannot be minted: at most the start plus the whole loan
        expect(live.company(HOSTILE)!.money).toBeLessThanOrEqual(startMoney + RT_CATALOG.economy.maxLoan)

        honest.send({ type: 'command', seq: 2, command: { kind: K.renameCompany, name: 'Unbothered' } })
        vi.advanceTimersByTime(TICK * 10)
        expect(mine.name).toBe('Unbothered')
    }, 240000)
})

/* ---- Join pauses ---- */

describe('hostileClientSpec: reopen loops', () => {
    it('a spectator that never sends loaded and reopens every 2 s never pauses the room', async () => {
        const s = scene()
        const { hub, registry, connect } = setup(s.raw)
        const world = registry.add('honest', s.raw)
        const honest = connect('honest', true)
        await openLoaded(honest, world.id)
        const room = hub.room(world.id)!
        vi.advanceTimersByTime(TICK * 5)
        const tick = room.world.tick
        const pausedBefore = honest.socket.of('paused').length
        for (let i = 0; i < 30; i++) {
            const spy = connect('spy')
            expect((await open(spy, world.id, world.inviteCode)).type).toBe('opened')
            vi.advanceTimersByTime(RT_OPEN_COOLDOWN_MS)
        }
        expect(honest.socket.of('paused').slice(pausedBefore)).toEqual([])
        expect(room.world.tick - tick).toBeGreaterThanOrEqual(Math.floor(30 * RT_OPEN_COOLDOWN_MS / TICK) - 2)
        expect(honest.socket.mismatches).toEqual([])
    })

    it('a player doing the same pauses the room at most once per RT_JOIN_PAUSE_WINDOW_MS', async () => {
        const s = scene()
        const { hub, registry, connect } = setup(s.raw)
        const world = registry.add('honest', s.raw, [['honest', HONEST], ['hostile', HOSTILE]])
        const honest = connect('honest', true)
        await openLoaded(honest, world.id)
        vi.advanceTimersByTime(TICK * 5)
        const pausedBefore = honest.socket.of('paused').length
        const span = 3 * 60000
        for (let t = 0; t < span; t += RT_OPEN_COOLDOWN_MS) {
            const hostile = connect('hostile')
            expect((await open(hostile, world.id)).type).toBe('opened')
            vi.advanceTimersByTime(RT_OPEN_COOLDOWN_MS)
        }
        const joinPauses = honest.socket.of('paused').slice(pausedBefore).filter(msg => msg.reason === 'joining')
        expect(joinPauses.length).toBeGreaterThan(0)
        expect(joinPauses.length).toBeLessThanOrEqual(Math.floor(span / RT_JOIN_PAUSE_WINDOW_MS) + 1)
        expect(honest.socket.mismatches).toEqual([])
        expect(hub.room(world.id)!.isRunning).toBe(true)
    })

    it('20 opens at one tick encode and compress the snapshot once', async () => {
        const s = scene()
        const encode = vi.fn(encodeWorldParts)
        const { hub, registry, connect } = setup(s.raw, { encodeWorldParts: encode })
        const world = registry.add('honest', s.raw)
        const honest = connect('honest')
        await openLoaded(honest, world.id)
        vi.advanceTimersByTime(TICK * 7)
        const tick = hub.room(world.id)!.world.tick
        const watchers = Array.from({ length: 20 }, (_, i) => connect(`watcher${i}`))
        const before = encode.mock.calls.length
        for (const watcher of watchers) watcher.send({ type: 'open', worldId: world.id, inviteCode: world.inviteCode, have: [] })
        await until(() => watchers.every(watcher => watcher.socket.of('snapshotEnd').length === 1), 'twenty opens')
        expect(hub.room(world.id)!.world.tick).toBe(tick)
        expect(encode.mock.calls.length - before).toBe(1)
        // every watcher got the same compressed parts: compressed once, sent twenty times
        const sent = watchers.map(watcher => watcher.socket.of('part'))
        for (const parts of sent) expect(parts).toEqual(sent[0])
    })

    it('three hostile players joining in a staggered loop without loaded leave the room ticking 90 % of ten minutes', async () => {
        const s = scene()
        const { hub, registry, connect } = setup(s.raw)
        const world = registry.add('honest', s.raw)
        const honest = connect('honest', true)
        await openLoaded(honest, world.id)
        const room = hub.room(world.id)!
        const hostiles = ['h1', 'h2', 'h3']
        for (const id of hostiles) {
            const client = connect(id)
            client.send({ type: 'join', inviteCode: world.inviteCode })
            await advanceUntil(() => client.socket.of('joined').length === 1 || client.socket.errors().length > 0, `join of ${id}`)
            expect(client.socket.of('joined')).toHaveLength(1)
            vi.advanceTimersByTime(TICK * 10)
        }
        const startTick = room.world.tick
        const from = Date.now()
        const span = 10 * 60000
        const step = 2000
        for (let t = 0, k = 0; t < span; t += step, k++) {
            const client = connect(hostiles[k % hostiles.length]!)
            const answer = await open(client, world.id)
            expect(answer.type === 'opened' || (answer.type === 'error' && answer.code === 'tooSoon')).toBe(true)
            vi.advanceTimersByTime(step)
        }
        // ticking wall time: the room is paused only between its paused and resumed frames
        const paused = honest.socket.pausedMs(from, Date.now())
        expect(paused).toBeGreaterThan(0)
        expect((span - paused) / span).toBeGreaterThanOrEqual(0.9)
        // and the ticks bear it out, short only of the part-tick each resume starts on
        const ticked = (room.world.tick - startTick) * TICK
        expect(ticked / span).toBeGreaterThanOrEqual(0.899)
        console.info(`[hostile joins] paused ${paused} ms of ${span}, ${room.world.tick - startTick} ticks`)
        expect(honest.socket.mismatches).toEqual([])
        expect(honest.socket.hashChecks).toBeGreaterThan(100)
    }, 120000)
})

/* ---- Create floods ---- */

describe('hostileClientSpec: create floods', () => {
    it('200 create frames in a second make one world; the rest are tooSoon, busy or dropped, and an honest room keeps ticking', async () => {
        const s = scene()
        const { hub, registry, connect } = setup(s.raw)
        const world = registry.add('honest', s.raw)
        const honest = connect('honest', true)
        await openLoaded(honest, world.id)
        const room = hub.room(world.id)!
        const tick = room.world.tick
        const hostile = connect('hostile')
        const create = encodeClientMsg({ type: 'create', name: 'Spam', side: 64, maxCompanies: 2, sharing: false, isPublic: false })
        for (let i = 0; i < 200; i++) {
            hostile.raw(create)
            vi.advanceTimersByTime(5)
        }
        await until(() => hostile.socket.of('joined').length === 1, 'the one create')
        await settle()
        expect(registry.generated).toBe(1)
        expect(hostile.socket.of('joined')).toHaveLength(1)
        const errors = hostile.socket.errors()
        expect(errors.every(code => code === 'tooSoon' || code === 'busy')).toBe(true)
        // the socket bucket dropped the frames beyond it unanswered
        expect(errors.length + 1).toBeGreaterThanOrEqual(RT_SOCKET_MSG_BURST)
        expect(errors.length + 1).toBeLessThanOrEqual(200)
        expect(room.world.tick - tick).toBeGreaterThanOrEqual(Math.floor(1000 / TICK) - 1)
        expect(honest.socket.mismatches).toEqual([])

        // at the cap: no world at all, and no generation
        registry.openCap = 1
        vi.advanceTimersByTime(RT_CREATE_COOLDOWN_MS)
        const before = hostile.socket.errors().length
        for (let i = 0; i < 200; i++) {
            hostile.raw(create)
            vi.advanceTimersByTime(5)
        }
        await until(() => hostile.socket.errors().slice(before).includes('atCap'), 'atCap')
        await settle()
        expect(registry.generated).toBe(1)
        expect(hostile.socket.errors().slice(before).filter(code => code === 'atCap')).toHaveLength(1)
    })

    it('parallel creates from many users run one generation at a time and refuse past RT_MAX_PENDING_CREATES', async () => {
        const s = scene()
        const { registry, connect } = setup(s.raw)
        let open!: () => void
        registry.gate = new Promise<void>((resolve) => {
            open = resolve
        })
        const clients = Array.from({ length: RT_MAX_PENDING_CREATES + 4 }, (_, i) => connect(`maker${i}`))
        for (const client of clients) client.send({ type: 'create', name: 'Parallel', side: 64, maxCompanies: 2, sharing: false, isPublic: false })
        await settle()
        expect(registry.maxGenerating).toBe(1)
        const busy = clients.filter(client => client.socket.errors().includes('busy')).length
        expect(busy).toBe(4)
        open()
        await until(() => clients.filter(client => client.socket.of('joined').length === 1).length === RT_MAX_PENDING_CREATES, 'queued creates')
        expect(registry.generated).toBe(RT_MAX_PENDING_CREATES)
        expect(registry.maxGenerating).toBe(1)
    })
})

/* ---- Invite lookup limits and the live-room cap ---- */

describe('hostileClientSpec: invites and room slots', () => {
    it('100 join frames with random invite codes do at most 10 lookups a minute and never join', async () => {
        const s = scene()
        const { registry, connect } = setup(s.raw)
        registry.add('honest', s.raw)
        const hostile = connect('hostile')
        const rand = prng(109)
        const code = () => Array.from({ length: 16 }, () => RT_INVITE_CODE_ALPHABET[Math.floor(rand() * RT_INVITE_CODE_ALPHABET.length)]).join('')
        for (let i = 0; i < 100; i++) hostile.send({ type: 'join', inviteCode: code() })
        await until(() => hostile.socket.errors().length === 100, 'answers')
        expect(registry.lookups).toBeLessThanOrEqual(RT_INVITE_FAILS_PER_MINUTE)
        expect(hostile.socket.of('joined')).toEqual([])
        expect(hostile.socket.errors().filter(c => c === 'badInvite')).toHaveLength(registry.lookups)
        expect(hostile.socket.errors().filter(c => c === 'tooSoon')).toHaveLength(100 - registry.lookups)

        // a reconnect does not reset it; a minute later another ten are looked up
        const again = connect('hostile')
        again.send({ type: 'join', inviteCode: code() })
        await until(() => again.socket.errors().length === 1)
        expect(again.socket.errors()).toEqual(['tooSoon'])
        vi.advanceTimersByTime(60000)
        for (let i = 0; i < 30; i++) again.send({ type: 'join', inviteCode: code() })
        await until(() => again.socket.errors().length === 31, 'second minute')
        expect(registry.lookups).toBeLessThanOrEqual(2 * RT_INVITE_FAILS_PER_MINUTE)
        expect(again.socket.of('joined')).toEqual([])
    })

    it('a user who creates, stops and reopens worlds every 2 s holds at most one live room, and an honest player can still open at the cap', async () => {
        const s = scene()
        const { hub, registry, connect } = setup(s.raw)
        registry.openCap = 3
        const others: Client[] = []
        for (let i = 0; i < RT_MAX_LIVE_ROOMS - 2; i++) {
            const world = registry.add(`other${i}`, s.raw, [[`other${i}`, HONEST]])
            const client = connect(`other${i}`)
            await openLoaded(client, world.id)
            others.push(client)
        }
        const hostile = connect('hostile')
        const mine = () => [...registry.worlds.values()].filter(world => world.ownerId === 'hostile')
        for (let t = 0; t < 120000; t += RT_OPEN_COOLDOWN_MS) {
            hostile.send({ type: 'create', name: 'Churn', side: 64, maxCompanies: 2, sharing: false, isPublic: false })
            await settle(2)
            const worlds = mine()
            const newest = worlds.at(-1)
            if (newest && newest.status === 'open' && worlds.filter(world => world.status === 'open').length >= registry.openCap) {
                hostile.send({ type: 'stop', worldId: newest.id })
            }
            const pick = worlds[Math.floor(t / RT_OPEN_COOLDOWN_MS) % Math.max(1, worlds.length)]
            if (pick) await open(hostile, pick.id)
            const held = mine().filter(world => (hub.room(world.id)?.peerCount ?? 0) > 0)
            expect(held.length).toBeLessThanOrEqual(1)
            expect(hub.liveRoomCount).toBeLessThanOrEqual(RT_MAX_LIVE_ROOMS)
            vi.advanceTimersByTime(RT_OPEN_COOLDOWN_MS)
        }
        expect(mine().length).toBeGreaterThan(1)

        const late = registry.add('late', s.raw, [['late', HONEST]])
        const lateClient = connect('late')
        const answer = await open(lateClient, late.id)
        expect(answer.type).toBe('opened')
        expect(hub.liveRoomCount).toBeLessThanOrEqual(RT_MAX_LIVE_ROOMS)
        for (const client of others) expect(client.socket.of('roomUnloaded')).toEqual([])
    }, 60000)
})

/* ---- Pathfinder budget under a hostile maze ---- */

describe('hostileClientSpec: a junction maze and many lost trains', () => {
    it('no room step exceeds pathNodesPerTick pathfinder nodes, and an honest room keeps stepping', async () => {
        const world = blankWorld(false, 100_000_000)
        // a grid of own track with full junctions at every crossing
        for (let y = 6; y <= 58; y += 4) must(world, HOSTILE, { kind: K.buildRailLine, tile: at(4, y), endTile: at(60, y), trackdir: EAST })
        for (let x = 6; x <= 58; x += 4) {
            for (let y = 4; y <= 60; y++) applyCommand(world, HOSTILE, { kind: K.buildRail, tile: at(x, y), piece: RtTrack.y }, true)
        }
        for (let y = 6; y <= 58; y += 4) {
            for (let x = 6; x <= 58; x += 4) {
                // the four curves: every turn is possible at every crossing
                for (const piece of [2, 3, 4, 5]) {
                    applyCommand(world, HOSTILE, { kind: K.buildRail, tile: at(x, y), piece }, true)
                }
            }
        }
        const station = must(world, HOSTILE, { kind: K.buildRailStation, tile: at(30, 62), axis: RtAxis.x, tracks: 1, length: 3 }).id!
        const trains: number[] = []
        for (let y = 6; y <= 58 && trains.length < 100; y += 4) {
            must(world, HOSTILE, { kind: K.buildDepot, tile: at(3, y), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
            for (let k = 0; k < 8 && trains.length < 100; k++) {
                trains.push(must(world, HOSTILE, { kind: K.buyVehicle, depot: at(3, y), model: ENGINE, wagons: [] }).id!)
            }
        }
        const raw = encodeWorld(world)
        let perf = 0
        const { hub, registry, connect, stepErrors } = setup(raw, { perfNow: () => perf })
        const maze = registry.add('hostile', raw, [['hostile', HOSTILE]])
        const calm = registry.add('honest', scene().raw)
        const honest = connect('honest', true)
        await openLoaded(honest, calm.id)
        const hostile = connect('hostile')
        await openLoaded(hostile, maze.id)
        const room = hub.room(maze.id)!
        const calmRoom = hub.room(calm.id)!

        let maxNodes = 0
        let over = 0
        const step = room.world.step.bind(room.world)
        room.world.step = () => {
            const started = performance.now()
            step()
            perf += performance.now() - started
            const used = room.world.pathNodesPerTick - room.world.pathNodesLeft
            maxNodes = Math.max(maxNodes, used)
            if (room.world.pathNodesLeft < 0) over++
        }
        // orders to a station the maze cannot reach, then every train started, all through the socket
        let seq = 0
        for (const id of trains) {
            hostile.send({ type: 'command', seq: seq++ & 255, command: { kind: K.setOrders, vehicle: id, orders: [{ kind: RtOrderKind.gotoStation, target: station, flags: 0 }] } })
            hostile.send({ type: 'command', seq: seq++ & 255, command: { kind: K.startStop, vehicle: id, stopped: false } })
            vi.advanceTimersByTime(110)
        }
        // cut the maze into islands while they search
        for (let x = 8; x <= 56; x += 8) {
            hostile.send({ type: 'command', seq: seq++ & 255, command: { kind: K.removeRail, tile: at(x, 30), piece: RtTrack.x } })
            vi.advanceTimersByTime(60)
        }
        const calmTick = calmRoom.world.tick
        const started = performance.now()
        const mazeTick = room.world.tick
        vi.advanceTimersByTime(TICK * 1000)
        await settle()
        // wall time is only logged: the budget, not the clock, is what this asserts
        console.info(`[hostile maze] ${room.world.tick - mazeTick} maze steps, max ${maxNodes} pathfinder nodes in one step, ${(performance.now() - started).toFixed(0)} ms wall`)

        expect(room.world.vehicleList().some(v => v.state !== RtVehicleState.inDepot)).toBe(true)
        expect(maxNodes).toBeGreaterThan(1000)
        expect(maxNodes).toBeLessThanOrEqual(RT_CATALOG.pathfinder.pathNodesPerTick)
        expect(over).toBe(0)
        expect(stepErrors()).toEqual([])
        expect(calmRoom.world.tick - calmTick).toBeGreaterThan(100)
        expect(honest.socket.mismatches).toEqual([])
    }, 120000)
})

/* ---- Stop orders and sharing ---- */

describe('hostileClientSpec: stop orders and shared track', () => {
    it('with sharing on, a hostile train on the victim\'s track cannot be stopped there and keeps running after its orders are cleared', async () => {
        const world = blankWorld(true)
        must(world, HONEST, { kind: K.buildRailLine, tile: at(6, 10), endTile: at(40, 10), trackdir: EAST })
        must(world, HOSTILE, { kind: K.buildDepot, tile: at(41, 10), vehicleKind: RtVehicleKind.rail, facing: RtDir.ne })
        must(world, HOSTILE, { kind: K.buildDepot, tile: at(5, 10), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
        const intruder = must(world, HOSTILE, { kind: K.buyVehicle, depot: at(41, 10), model: ENGINE, wagons: [] }).id!
        must(world, HOSTILE, { kind: K.setOrders, vehicle: intruder, orders: [{ kind: RtOrderKind.gotoDepot, target: at(5, 10), flags: 0 }] })
        must(world, HOSTILE, { kind: K.startStop, vehicle: intruder, stopped: false })
        const raw = encodeWorld(world)
        const { hub, registry, connect } = setup(raw)
        const shared = registry.add('honest', raw, [['honest', HONEST], ['hostile', HOSTILE]])
        const honest = connect('honest', true)
        const hostile = connect('hostile')
        await openLoaded(honest, shared.id)
        await openLoaded(hostile, shared.id)
        const room = hub.room(shared.id)!
        const train = room.world.vehicle(intruder)!
        for (let t = 0; t < 4000 && !(train.state === RtVehicleState.driving && room.world.map.owner[train.tiles[0]!] === HONEST && train.tiles.every(tile => room.world.map.owner[tile] === HONEST)); t++) {
            vi.advanceTimersByTime(TICK)
        }
        expect(train.tiles.every(tile => room.world.map.owner[tile] === HONEST)).toBe(true)

        const costsBefore = room.world.company(HOSTILE)!.financeThisYear.sharingCosts
        hostile.send({ type: 'command', seq: 1, command: { kind: K.setOrders, vehicle: intruder, orders: [] } })
        vi.advanceTimersByTime(TICK * 5)
        hostile.send({ type: 'command', seq: 2, command: { kind: K.startStop, vehicle: intruder, stopped: true } })
        vi.advanceTimersByTime(TICK * 5)
        expect(hostile.socket.of('result').map(msg => msg.seq)).toEqual([2])
        expect(train.stopped).toBe(false)

        // over the next day it never stands still on the victim's track for the whole day
        let still = 0
        let longest = 0
        let last = train.tiles[0]
        for (let t = 0; t < DAY_TICKS * 3; t++) {
            vi.advanceTimersByTime(TICK)
            const onVictim = train.tiles.some(tile => room.world.map.owner[tile] === HONEST)
            still = onVictim && train.tiles[0] === last && train.speed === 0 ? still + 1 : 0
            longest = Math.max(longest, still)
            last = train.tiles[0]
        }
        expect(longest).toBeLessThan(DAY_TICKS)
        expect(room.world.company(HOSTILE)!.financeThisYear.sharingCosts).toBeLessThanOrEqual(costsBefore)
        expect(honest.socket.mismatches).toEqual([])
    }, 60000)

    it('buildSiding is refused on foreign track, off a dead end, past a signal and off the map; stopping a foreign train is refused', async () => {
        const world = blankWorld(false)
        must(world, HONEST, { kind: K.buildRailLine, tile: at(6, 10), endTile: at(40, 10), trackdir: EAST })
        must(world, HONEST, { kind: K.buildRail, tile: at(14, 10), piece: rtPieceBetween(0, 1) })
        for (let y = 11; y <= 16; y++) must(world, HONEST, { kind: K.buildRail, tile: at(14, y), piece: RtTrack.y })
        must(world, HOSTILE, { kind: K.buildRailLine, tile: at(6, 30), endTile: at(40, 30), trackdir: EAST })
        // two dead-end branches off the hostile main line; the one at x 14 has a signal in its run
        for (const x of [14, 24]) {
            must(world, HOSTILE, { kind: K.buildRail, tile: at(x, 30), piece: rtPieceBetween(0, 1) })
            for (let y = 31; y <= 36; y++) must(world, HOSTILE, { kind: K.buildRail, tile: at(x, y), piece: RtTrack.y })
        }
        must(world, HOSTILE, { kind: K.placeSignal, tile: at(14, 33), piece: RtTrack.y, signalType: RtSignalType.block })
        const victim = train(world, HONEST, 5, 10, RtDir.sw)
        const raw = encodeWorld(world)
        const { hub, registry, connect } = setup(raw)
        const shared = registry.add('honest', raw, [['honest', HONEST], ['hostile', HOSTILE]])
        const honest = connect('honest', true)
        const hostile = connect('hostile')
        await openLoaded(honest, shared.id)
        await openLoaded(hostile, shared.id)
        const room = hub.room(shared.id)!
        vi.advanceTimersByTime(TICK * 5)
        const refusals: [number, RtCommand][] = [
            // the honest company's dead end, a hostile tile that is no dead end, a run with a signal
            [10, { kind: K.buildSiding, tile: at(14, 16) }],
            [11, { kind: K.buildSiding, tile: at(20, 30) }],
            [12, { kind: K.buildSiding, tile: at(14, 36) }],
            [13, { kind: K.startStop, vehicle: victim.id, stopped: true }],
            [14, { kind: K.sendToDepot, vehicle: victim.id }]
        ]
        for (const [seq, command] of refusals) {
            hostile.send({ type: 'command', seq, command })
            vi.advanceTimersByTime(60)
        }
        hostile.raw(commandFrame(15, rawCommand(K.buildSiding, [SIDE * SIDE + 1])))
        // the same branch without the signal is a spot: the refusals above are the rules, not the layout
        hostile.send({ type: 'command', seq: 16, command: { kind: K.buildSiding, tile: at(24, 36) } })
        vi.advanceTimersByTime(TICK * 10)
        expect(hostile.socket.of('result').map(msg => msg.seq)).toEqual([10, 11, 12, 13, 14])
        expect(hostile.socket.errors()).toEqual(['badRequest'])
        expect(honest.socket.of('command').map(msg => msg.company)).toEqual([HOSTILE])
        expect(room.world.vehicle(victim.id)!.stopped).toBe(false)
        expect(honest.socket.mismatches).toEqual([])
    })

    it('a stop order on a line with no free place keeps the train travelling and paying; stop and start spam cannot pin it', async () => {
        const world = blankWorld(false)
        must(world, HOSTILE, { kind: K.buildRailLine, tile: at(6, 30), endTile: at(60, 30), trackdir: EAST })
        const own = train(world, HOSTILE, 5, 30, RtDir.sw)
        for (let t = 0; t < 2000 && !(own.state === RtVehicleState.driving && world.map.tileX(own.tiles.at(-1)!) >= 8); t++) world.step()
        // the depot was the only place to park: with it gone there is no free place at all
        must(world, HOSTILE, { kind: K.demolish, tile: at(5, 30) })
        const raw = encodeWorld(world)
        const { hub, registry, connect } = setup(raw)
        const shared = registry.add('hostile', raw, [['hostile', HOSTILE]])
        const hostile = connect('hostile', true)
        await openLoaded(hostile, shared.id)
        const room = hub.room(shared.id)!
        const vehicle = room.world.vehicle(own.id)!
        for (let t = 0; t < 2000 && !(vehicle.state === RtVehicleState.driving && room.world.map.tileX(vehicle.tiles[0]!) >= 20); t++) vi.advanceTimersByTime(TICK)
        expect(vehicle.state).toBe(RtVehicleState.driving)

        // a stop order with nowhere to park: the train keeps travelling and keeps paying its running cost
        const running = room.world.company(HOSTILE)!.financeThisYear.runningCosts
        hostile.send({ type: 'command', seq: 200, command: { kind: K.startStop, vehicle: own.id, stopped: true } })
        const visited = new Set<number>()
        for (let t = 0; t < DAY_TICKS * 2; t++) {
            vi.advanceTimersByTime(TICK)
            visited.add(vehicle.tiles[0]!)
        }
        expect(hostile.socket.of('result')).toEqual([])
        expect(vehicle.stopped).toBe(true)
        expect(visited.size).toBeGreaterThan(3)
        expect(room.world.company(HOSTILE)!.financeThisYear.runningCosts).toBeLessThan(running)
        hostile.send({ type: 'command', seq: 201, command: { kind: K.startStop, vehicle: own.id, stopped: false } })
        vi.advanceTimersByTime(TICK * 5)

        // stop and start as fast as the socket and the room allow, for two days
        const fromX = room.world.map.tileX(vehicle.tiles[0]!)
        let seq = 0
        let moved = 0
        let lastTile = vehicle.tiles[0]
        for (let t = 0; t < DAY_TICKS * 2; t++) {
            hostile.send({ type: 'command', seq: seq++ & 255, command: { kind: K.startStop, vehicle: own.id, stopped: !vehicle.stopped } })
            vi.advanceTimersByTime(TICK)
            if (vehicle.tiles[0] !== lastTile) moved++
            lastTile = vehicle.tiles[0]
        }
        expect(moved).toBeGreaterThan(0)
        expect(hostile.socket.errors()).toContain('rateLimited')
        // a start order always resumes driving
        if (vehicle.stopped) hostile.send({ type: 'command', seq: seq++ & 255, command: { kind: K.startStop, vehicle: own.id, stopped: false } })
        vi.advanceTimersByTime(TICK * DAY_TICKS)
        expect(vehicle.stopped).toBe(false)
        expect(vehicle.speed).toBeGreaterThan(0)
        expect(room.world.map.tileX(vehicle.tiles[0]!)).not.toBe(fromX)
        expect(hostile.socket.mismatches).toEqual([])
    }, 60000)
})
