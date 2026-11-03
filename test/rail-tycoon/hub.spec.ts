/**
 * RtHub with an in-memory registry and store, fake sockets that decode every frame,
 * fake timers, and real RtRooms: socket replacement, the flood bucket, ownership before any
 * destructive act, per-world chains, the live-room cap, the shared step budget, cooldowns and the
 * broken-world refusal.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { RtHub, type RtHubDeps, type RtHubSocket } from '#server/utils/rail-tycoon/hub'
import type { RtAccess } from '#server/utils/rail-tycoon/registry'
import { RtRoom, type RtRoomDeps } from '#server/utils/rail-tycoon/room'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { RtCommandKind } from '#shared/utils/rail-tycoon/commands'
import {
    RT_BROKEN_UNLOADS,
    RT_CHAIN_TIMEOUT_MS,
    RT_CREATE_COOLDOWN_MS,
    RT_MAX_LIVE_ROOMS,
    RT_OPEN_COOLDOWN_MS,
    RT_SOCKET_MSG_BURST,
    RT_SOCKET_MSG_RATE,
    RT_STEP_BUDGET_MS
} from '#shared/utils/rail-tycoon/limits'
import { decodeServerMsg, encodeClientMsg, type RtClientMsg, type RtErrorCode, type RtServerMsg } from '#shared/utils/rail-tycoon/protocol'
import { decodeWorldOrThrow, decodeWorldPartsOrThrow, encodeWorld } from '#shared/utils/rail-tycoon/save'
import { RtWorld } from '#shared/utils/rail-tycoon/world'
import { generateWorld } from '#shared/utils/rail-tycoon/worldgen'

const TICK = RT_CATALOG.time.tickMs

let BASE: Uint8Array

beforeAll(() => {
    const world = RtWorld.create(generateWorld(11, { side: 64 }), { side: 64, maxCompanies: 4, sharing: false })
    world.addCompany('Owner')
    BASE = encodeWorld(world)
})

/* ---- fakes ---- */

function httpError(statusCode: number, statusMessage: string): Error {
    return Object.assign(new Error(statusMessage), { statusCode, statusMessage })
}

interface FakeWorld {
    id: string
    name: string
    ownerId: string
    status: 'open' | 'closed'
    inviteCode: string
    members: Map<string, number>
    save: Uint8Array
    revision: number
    lastActiveAt: Date
}

/** The registry and store, in memory, with the real ones' rules and status codes. */
class FakeRegistry {
    worlds = new Map<string, FakeWorld>()
    generated = 0
    lookups = 0
    saves = new Map<string, number>()
    loads = 0
    private seq = 0

    add(ownerId: string, options: { status?: 'open' | 'closed' } = {}): FakeWorld {
        this.seq++
        const world: FakeWorld = {
            id: `w${String(this.seq).padStart(3, '0')}`,
            name: `World ${this.seq}`,
            ownerId,
            status: options.status ?? 'open',
            inviteCode: String(this.seq).padStart(16, '0'),
            members: new Map([[ownerId, 0]]),
            save: BASE,
            revision: 0,
            lastActiveAt: new Date(0)
        }
        this.worlds.set(world.id, world)
        return world
    }

    byInvite(code: string): FakeWorld | undefined {
        for (const world of this.worlds.values()) if (world.inviteCode === code) return world
        return undefined
    }

    stored(id: string): RtWorld {
        return decodeWorldOrThrow(this.worlds.get(id)!.save)
    }

    deps(): Omit<RtHubDeps, 'buildId' | 'now' | 'setInterval' | 'clearInterval' | 'setTimeout' | 'clearTimeout' | 'log'> {
        return {
            rtListWorldsForUser: async (userId) => {
                return [...this.worlds.values()]
                    .filter(world => world.ownerId === userId || world.members.has(userId))
                    .map(world => ({
                        id: world.id,
                        name: world.name,
                        status: world.status,
                        ownerId: world.ownerId,
                        isOwner: world.ownerId === userId,
                        memberCount: world.members.size,
                        maxCompanies: 4,
                        myCompanyId: world.members.get(userId) ?? null,
                        lastActiveAt: world.lastActiveAt,
                        inviteCode: world.inviteCode,
                        isPublic: false
                    }))
            },
            rtCreateWorld: async (userId, userName, name) => {
                const open = [...this.worlds.values()].filter(world => world.ownerId === userId && world.status === 'open').length
                if (open >= 5) throw httpError(409, 'You already have 5 open worlds; stop one first')
                this.generated++
                const world = this.add(userId)
                world.name = name
                return { worldId: world.id, inviteCode: world.inviteCode }
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
                this.loads++
                const world = this.worlds.get(id)
                if (!world) return null
                return {
                    id,
                    ownerId: world.ownerId,
                    status: world.status,
                    revision: world.revision,
                    lastActiveAt: world.lastActiveAt,
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
                this.saves.set(id, (this.saves.get(id) ?? 0) + 1)
                if (options.member) world.members.set(options.member.userId, options.member.companyId)
                return world.revision
            }
        }
    }
}

class FakeSocket implements RtHubSocket {
    frames: RtServerMsg[] = []
    closed: { code: number, reason: string } | null = null

    send(frame: Uint8Array): void {
        const msg = decodeServerMsg(frame)
        if (!msg) throw new Error('hub sent a frame that does not decode')
        this.frames.push(msg)
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
}

interface Client {
    userId: string
    socket: FakeSocket
    send(msg: RtClientMsg): void
    raw(bytes: Uint8Array): void
}

function setup(options: { openRoom?: RtHubDeps['openRoom'], perfNow?: () => number } = {}) {
    const registry = new FakeRegistry()
    const log = vi.fn<RtHubDeps['log']>()
    const deps: RtHubDeps = {
        ...registry.deps(),
        buildId: 'test-build',
        now: () => Date.now(),
        setInterval: (callback, ms) => setInterval(callback, ms),
        clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
        setTimeout: (callback, ms) => setTimeout(callback, ms),
        clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
        log,
        ...(options.openRoom ? { openRoom: options.openRoom } : {}),
        ...(options.perfNow ? { perfNow: options.perfNow } : {})
    }
    const hub = new RtHub(deps)
    hubs.push(hub)
    const connect = (userId: string): Client => {
        const socket = new FakeSocket()
        expect(hub.connect(socket, { id: userId, name: userId })).toBe(true)
        return {
            userId,
            socket,
            send: msg => hub.message(socket, encodeClientMsg(msg)),
            raw: bytes => hub.message(socket, bytes)
        }
    }
    return { hub, registry, log, connect }
}

const hubs: RtHub[] = []

/** Lets real async work finish while the fake clock stands still. */
async function until(condition: () => boolean, label = 'condition'): Promise<void> {
    const started = performance.now()
    while (!condition()) {
        if (performance.now() - started > 5000) throw new Error(`timed out waiting for ${label}`)
        await new Promise(resolve => setImmediate(resolve))
    }
}

async function settle(ms = 30): Promise<void> {
    const started = performance.now()
    while (performance.now() - started < ms) await new Promise(resolve => setImmediate(resolve))
}

/** Sends open and waits for its answer: opened, or an error code. */
async function open(client: Client, worldId: string, inviteCode: string | null = null): Promise<RtServerMsg> {
    const before = client.socket.frames.length
    client.send({ type: 'open', worldId, inviteCode, have: [] })
    await until(() => client.socket.frames.slice(before).some(msg => msg.type === 'opened' || msg.type === 'error'), `open of ${worldId}`)
    return client.socket.frames.slice(before).find(msg => msg.type === 'opened' || msg.type === 'error')!
}

async function openLoaded(client: Client, worldId: string): Promise<void> {
    const answer = await open(client, worldId)
    expect(answer.type).toBe('opened')
    client.send({ type: 'loaded', worldId })
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'))
})

afterEach(() => {
    for (const hub of hubs.splice(0)) hub.dispose()
    vi.useRealTimers()
})

/* ---- sockets ---- */

describe('rail tycoon hub: sockets', () => {
    it('greets with the protocol version and build id; a second socket of the same user closes the first with 4409', async () => {
        const { hub, registry, connect } = setup()
        const world = registry.add('alice')
        const first = connect('alice')
        expect(first.socket.of('hello')[0]).toMatchObject({ version: 1, buildId: 'test-build' })
        await openLoaded(first, world.id)
        const room = hub.room(world.id)!
        expect(room.peerCount).toBe(1)

        const second = connect('alice')
        expect(first.socket.closed).toEqual({ code: 4409, reason: 'Opened in another tab' })
        expect(second.socket.closed).toBeNull()
        expect(hub.peerCount).toBe(1)
        expect(room.peerCount).toBe(0)
        // the replaced socket is ignored
        const frames = first.socket.frames.length
        first.send({ type: 'ping', value: 1 })
        expect(first.socket.frames.length).toBe(frames)
    })

    it('drops a flood beyond the per-connection bucket', () => {
        const { connect } = setup()
        const client = connect('alice')
        for (let i = 0; i < RT_SOCKET_MSG_BURST * 2; i++) client.send({ type: 'ping', value: i })
        expect(client.socket.of('pong')).toHaveLength(RT_SOCKET_MSG_BURST)
        vi.advanceTimersByTime(1000)
        for (let i = 0; i < RT_SOCKET_MSG_BURST; i++) client.send({ type: 'ping', value: i })
        expect(client.socket.of('pong')).toHaveLength(RT_SOCKET_MSG_BURST + RT_SOCKET_MSG_RATE)
        expect(client.socket.closed).toBeNull()
    })

    it('answers malformed frames badRequest without closing the socket or the room', async () => {
        const { hub, registry, connect } = setup()
        const world = registry.add('alice')
        const alice = connect('alice')
        await openLoaded(alice, world.id)
        const room = hub.room(world.id)!
        vi.advanceTimersByTime(TICK * 10)
        const garbage = [
            new Uint8Array(0),
            new Uint8Array([0x00]),
            new Uint8Array([0x80, 1, 0]),
            new Uint8Array([0x06]),
            encodeClientMsg({ type: 'ping', value: 5 }).subarray(0, 3),
            new Uint8Array([...encodeClientMsg({ type: 'list' }), 0]),
            new Uint8Array(5000).fill(4)
        ]
        for (const bytes of garbage) alice.raw(bytes)
        expect(alice.socket.errors()).toEqual(garbage.map(() => 'badRequest'))
        expect(alice.socket.closed).toBeNull()
        expect(room.isRunning).toBe(true)

        alice.send({ type: 'command', seq: 1, command: { kind: RtCommandKind.renameCompany, name: 'Still Here' } })
        vi.advanceTimersByTime(TICK * 10)
        expect(room.world.company(0)!.name).toBe('Still Here')
    })
})

/* ---- ownership and chains ---- */

describe('rail tycoon hub: ownership and per-world chains', () => {
    it('a non-owner delete leaves the live room and its peers untouched', async () => {
        const { hub, registry, connect } = setup()
        const world = registry.add('alice')
        world.members.set('bob', 1)
        const loaded = decodeWorldOrThrow(world.save)
        loaded.addCompany('bob')
        world.save = encodeWorld(loaded)
        const alice = connect('alice')
        const bob = connect('bob')
        const mallory = connect('mallory')
        await openLoaded(alice, world.id)
        const room = hub.room(world.id)!

        bob.send({ type: 'delete', worldId: world.id })
        mallory.send({ type: 'delete', worldId: world.id })
        // one owner write per socket at a time
        mallory.send({ type: 'stop', worldId: world.id })
        await until(() => bob.socket.errors().length === 1 && mallory.socket.errors().length === 2)
        mallory.send({ type: 'stop', worldId: world.id })
        await until(() => mallory.socket.errors().length === 3)
        expect(bob.socket.errors()).toEqual(['notOwner'])
        expect(mallory.socket.errors()).toEqual(['busy', 'noAccess', 'noAccess'])
        expect(registry.worlds.has(world.id)).toBe(true)
        expect(hub.room(world.id)).toBe(room)
        expect(room.peerCount).toBe(1)
        expect(room.worldStatus).toBe('open')
        expect(alice.socket.of('worldDeleted')).toHaveLength(0)
        expect(alice.socket.of('roomUnloaded')).toHaveLength(0)
        vi.advanceTimersByTime(TICK * 5)
        expect(room.isRunning).toBe(true)
    })

    it('the owner delete tells every peer worldDeleted and leaves no room', async () => {
        const { hub, registry, connect } = setup()
        const world = registry.add('alice')
        const alice = connect('alice')
        const watcher = connect('watcher')
        await openLoaded(alice, world.id)
        expect((await open(watcher, world.id, world.inviteCode)).type).toBe('opened')
        vi.advanceTimersByTime(TICK * 5)
        const room = hub.room(world.id)!

        alice.send({ type: 'delete', worldId: world.id })
        await until(() => alice.socket.of('worldDeleted').length === 1 && hub.room(world.id) === undefined)
        // the room unloaded without writing, so nothing restarts it
        await until(() => room.isUnloaded, 'unload')
        vi.advanceTimersByTime(30000)
        expect(room.isRunning).toBe(false)
        expect(registry.saves.get(world.id) ?? 0).toBe(0)
        expect(watcher.socket.of('worldDeleted')).toEqual([{ type: 'worldDeleted', worldId: world.id }])
        // nothing the room said while unloading reached the peers after worldDeleted
        expect(alice.socket.frames.at(-1)!.type).toBe('worldDeleted')
        expect(watcher.socket.frames.at(-1)!.type).toBe('worldDeleted')
        expect(registry.worlds.has(world.id)).toBe(false)
        expect(hub.liveRoomCount).toBe(0)
    })

    it('delete racing open resolves in chain order without a stray room', async () => {
        const { hub, registry, connect } = setup()
        const first = registry.add('alice')
        const alice = connect('alice')
        // open then delete: the room opens, then the delete removes it
        alice.send({ type: 'open', worldId: first.id, inviteCode: null, have: [] })
        alice.send({ type: 'delete', worldId: first.id })
        await until(() => alice.socket.of('worldDeleted').length === 1)
        await settle()
        expect(alice.socket.of('opened')).toHaveLength(1)
        expect(hub.liveRoomCount).toBe(0)

        // delete then open (by a member): the open finds nothing and opens nothing
        const second = registry.add('alice')
        second.members.set('bob', 1)
        const bob = connect('bob')
        alice.send({ type: 'delete', worldId: second.id })
        bob.send({ type: 'open', worldId: second.id, inviteCode: null, have: [] })
        await until(() => bob.socket.errors().length === 1)
        expect(bob.socket.errors()).toEqual(['noAccess'])
        expect(hub.liveRoomCount).toBe(0)
        expect(registry.loads).toBe(1)
    })

    it('join racing open resolves in chain order: the joiner has a company in the one live room', async () => {
        for (const order of ['openFirst', 'joinFirst'] as const) {
            const { hub, registry, connect } = setup()
            const world = registry.add('alice')
            const alice = connect('alice')
            const bob = connect('bob')
            if (order === 'openFirst') {
                alice.send({ type: 'open', worldId: world.id, inviteCode: null, have: [] })
                bob.send({ type: 'join', inviteCode: world.inviteCode })
            } else {
                bob.send({ type: 'join', inviteCode: world.inviteCode })
                await until(() => registry.lookups === 1)
                alice.send({ type: 'open', worldId: world.id, inviteCode: null, have: [] })
            }
            await until(() => bob.socket.of('joined').length === 1 && alice.socket.of('opened').length === 1, order)
            await settle()
            expect(hub.liveRoomCount).toBe(1)
            const room = hub.room(world.id)!
            const company = world.members.get('bob')
            expect(company).toBe(1)
            expect(room.world.company(company!)).toBeDefined()
            expect(bob.socket.of('joined')[0]!.worldId).toBe(world.id)
            expect((await open(bob, world.id)).type).toBe('opened')
            expect(bob.socket.of('opened')[0]).toMatchObject({ role: 'player', company: 1 })
        }
    })

    it('stop with no live room closes the row and refreshes the list', async () => {
        const { hub, registry, connect } = setup()
        const world = registry.add('alice')
        const alice = connect('alice')
        alice.send({ type: 'stop', worldId: world.id })
        await until(() => alice.socket.of('worldList').length === 1)
        expect(world.status).toBe('closed')
        expect(hub.liveRoomCount).toBe(0)
        expect(alice.socket.of('worldList')[0]!.worlds[0]).toMatchObject({ id: world.id, status: 'closed' })
        alice.send({ type: 'stop', worldId: world.id })
        await until(() => alice.socket.errors().length === 1)
        expect(alice.socket.errors()).toEqual(['worldClosed'])
    })

    it('a live join that never acknowledges is refused at the timeout, and a following stop proceeds', async () => {
        const openRoom = async (id: string, deps: RtRoomDeps) => {
            const room = await RtRoom.open(id, deps)
            if (room) room.join = () => new Promise(() => {})
            return room
        }
        const { hub, registry, connect } = setup({ openRoom })
        const world = registry.add('alice')
        const alice = connect('alice')
        const bob = connect('bob')
        await openLoaded(alice, world.id)
        bob.send({ type: 'join', inviteCode: world.inviteCode })
        await until(() => registry.lookups === 1)
        await settle()
        alice.send({ type: 'stop', worldId: world.id })
        await settle()
        expect(bob.socket.errors()).toEqual([])
        expect(world.status).toBe('open')

        // the join and the stop queued behind it are both answered within the bound; nothing hangs
        vi.advanceTimersByTime(RT_CHAIN_TIMEOUT_MS)
        await until(() => bob.socket.errors().length === 1 && alice.socket.errors().length === 1, 'refusals')
        expect(bob.socket.errors()).toEqual(['busy'])
        expect(alice.socket.errors()).toEqual(['busy'])
        expect(world.status).toBe('open')

        // the chain is free again: a following stop proceeds
        alice.send({ type: 'stop', worldId: world.id })
        await until(() => alice.socket.of('worldClosed').length === 1, 'stop')
        expect(world.status).toBe('closed')
        expect(hub.room(world.id)!.worldStatus).toBe('closed')
    })

    it('two users opening each other\'s previous worlds at once both complete', async () => {
        const { hub, registry, connect } = setup()
        const x = registry.add('alice')
        const y = registry.add('bob')
        const alice = connect('alice')
        const bob = connect('bob')
        await openLoaded(alice, x.id)
        await openLoaded(bob, y.id)
        vi.advanceTimersByTime(RT_OPEN_COOLDOWN_MS)

        alice.send({ type: 'open', worldId: y.id, inviteCode: y.inviteCode, have: [] })
        bob.send({ type: 'open', worldId: x.id, inviteCode: x.inviteCode, have: [] })
        await until(() => alice.socket.of('opened').length === 2 && bob.socket.of('opened').length === 2, 'both opens')
        expect(alice.socket.of('opened')[1]).toMatchObject({ worldId: y.id, role: 'spectator' })
        expect(bob.socket.of('opened')[1]).toMatchObject({ worldId: x.id, role: 'spectator' })
        expect(hub.room(x.id)!.peerCount).toBe(1)
        expect(hub.room(y.id)!.peerCount).toBe(1)
        expect(alice.socket.errors()).toEqual([])
        expect(bob.socket.errors()).toEqual([])
    })
})

/* ---- caps and budget ---- */

describe('rail tycoon hub: caps and the step budget', () => {
    it('opening a second world detaches the socket from the first', async () => {
        const { hub, registry, connect } = setup()
        const first = registry.add('alice')
        const second = registry.add('alice')
        const alice = connect('alice')
        await openLoaded(alice, first.id)
        vi.advanceTimersByTime(RT_OPEN_COOLDOWN_MS)
        await openLoaded(alice, second.id)
        expect(hub.room(first.id)!.peerCount).toBe(0)
        expect(hub.room(second.id)!.peerCount).toBe(1)
        // the first room's leave checkpoint ran
        await until(() => (registry.saves.get(first.id) ?? 0) >= 1, 'leave checkpoint')
    })

    it('at the live-room cap an idle room is checkpointed and evicted; with every room peopled the open is busy', async () => {
        const { hub, registry, connect } = setup()
        const owners: Client[] = []
        const worlds: FakeWorld[] = []
        for (let i = 0; i < RT_MAX_LIVE_ROOMS; i++) {
            const world = registry.add(`owner${i}`)
            worlds.push(world)
            const client = connect(`owner${i}`)
            owners.push(client)
            await openLoaded(client, world.id)
        }
        expect(hub.liveRoomCount).toBe(RT_MAX_LIVE_ROOMS)
        vi.advanceTimersByTime(TICK * 20)

        // every room peopled: a new world is refused
        const extra = registry.add('late')
        const late = connect('late')
        expect(await open(late, extra.id)).toEqual({ type: 'error', code: 'busy' })
        expect(registry.loads).toBe(RT_MAX_LIVE_ROOMS)

        // one room goes peerless: it is checkpointed and makes way
        const idle = hub.room(worlds[0]!.id)!
        hub.disconnect(owners[0]!.socket)
        await until(() => (registry.saves.get(worlds[0]!.id) ?? 0) >= 1, 'leave checkpoint')
        const idleTick = idle.world.tick
        const idleHash = idle.world.hash()
        vi.advanceTimersByTime(RT_OPEN_COOLDOWN_MS)
        expect((await open(late, extra.id)).type).toBe('opened')
        expect(idle.isUnloaded).toBe(true)
        expect(hub.room(worlds[0]!.id)).toBeUndefined()
        expect(hub.liveRoomCount).toBe(RT_MAX_LIVE_ROOMS)
        const stored = registry.stored(worlds[0]!.id)
        expect(stored.tick).toBe(idleTick)
        expect(stored.hash()).toBe(idleHash)
    })

    it('shares the step budget so the sum of room steps per tick stays within it', async () => {
        const COST = 4
        let perf = 0
        const { hub, registry, connect } = setup({ perfNow: () => perf })
        const rooms: RtRoom[] = []
        for (let i = 0; i < 5; i++) {
            const world = registry.add(`owner${i}`)
            await openLoaded(connect(`owner${i}`), world.id)
            const room = hub.room(world.id)!
            const step = room.world.step.bind(room.world)
            room.world.step = () => {
                perf += COST
                step()
            }
            rooms.push(room)
        }
        expect(rooms.every(room => room.isRunning)).toBe(true)
        const start = rooms.map(room => room.world.tick)
        const windows = 100
        vi.advanceTimersByTime(TICK * windows)
        const steps = rooms.map((room, i) => room.world.tick - start[i]!)
        const total = steps.reduce((sum, n) => sum + n, 0)
        expect(total).toBeLessThanOrEqual(Math.ceil((windows + 1) * RT_STEP_BUDGET_MS / COST) + rooms.length)
        // without the budget every room would step every window
        expect(total).toBeLessThan(windows * rooms.length * 0.6)
        // shared evenly: no room starves
        for (const n of steps) expect(n).toBeGreaterThan(windows * RT_STEP_BUDGET_MS / COST / rooms.length * 0.6)
    })

    it('a room whose step always throws is refused worldBroken after RT_BROKEN_UNLOADS unloads and not reopened', async () => {
        let opens = 0
        const openRoom = async (id: string, deps: RtRoomDeps) => {
            opens++
            const room = await RtRoom.open(id, deps)
            if (room) {
                room.world.step = () => {
                    throw new Error('boom')
                }
            }
            return room
        }
        const { hub, registry, log, connect } = setup({ openRoom })
        const world = registry.add('alice')
        const alice = connect('alice')
        for (let i = 0; i < RT_BROKEN_UNLOADS; i++) {
            await openLoaded(alice, world.id)
            vi.advanceTimersByTime(TICK * 2)
            expect(alice.socket.of('roomUnloaded').map(msg => msg.reason)).toHaveLength(i + 1)
            expect(hub.room(world.id)).toBeUndefined()
            vi.advanceTimersByTime(RT_OPEN_COOLDOWN_MS)
        }
        expect(await open(alice, world.id)).toEqual({ type: 'error', code: 'worldBroken' })
        vi.advanceTimersByTime(RT_OPEN_COOLDOWN_MS)
        expect(await open(alice, world.id)).toEqual({ type: 'error', code: 'worldBroken' })
        expect(opens).toBe(RT_BROKEN_UNLOADS)
        expect(log.mock.calls.filter(([, message]) => message.includes('is broken'))).toHaveLength(1)
    })
})

/* ---- cooldowns ---- */

describe('rail tycoon hub: cooldowns', () => {
    it('two resync requests 1 s apart produce one snapshot and one tooSoon', async () => {
        const { registry, connect } = setup()
        const world = registry.add('alice')
        const alice = connect('alice')
        await openLoaded(alice, world.id)
        const opened = alice.socket.of('opened')[0]!
        expect(alice.socket.of('part').length).toBeGreaterThanOrEqual(opened.parts.length)
        expect(alice.socket.of('snapshotEnd')).toHaveLength(1)
        const partsBefore = alice.socket.of('part').length
        // the room has not stepped: every part the client offers is current, so none is sent again
        alice.send({ type: 'resync', worldId: world.id, have: opened.parts })
        vi.advanceTimersByTime(1000)
        alice.send({ type: 'resync', worldId: world.id, have: [] })
        expect(alice.socket.of('resync')).toHaveLength(1)
        expect(alice.socket.of('resync')[0]!.parts).toEqual(opened.parts)
        expect(alice.socket.of('part')).toHaveLength(partsBefore)
        expect(alice.socket.of('snapshotEnd')).toHaveLength(2)
        expect(alice.socket.errors()).toEqual(['tooSoon'])
    })

    it('the open cooldown is per user and survives a reconnect', async () => {
        const { registry, connect } = setup()
        const world = registry.add('alice')
        const first = connect('alice')
        await openLoaded(first, world.id)
        const second = connect('alice')
        expect(await open(second, world.id)).toEqual({ type: 'error', code: 'tooSoon' })
        vi.advanceTimersByTime(RT_OPEN_COOLDOWN_MS)
        expect((await open(second, world.id)).type).toBe('opened')
    })

    it('a second create within the cooldown is tooSoon; a create at the open-world cap is refused before generation', async () => {
        const { registry, connect } = setup()
        const alice = connect('alice')
        const create: RtClientMsg = { type: 'create', name: 'Alpha', side: 64, maxCompanies: 4, sharing: true, isPublic: false }
        alice.send(create)
        alice.send(create)
        await until(() => alice.socket.of('joined').length === 1 && alice.socket.errors().length === 1)
        expect(alice.socket.errors()).toEqual(['tooSoon'])
        expect(registry.generated).toBe(1)

        const bob = connect('bob')
        for (let i = 0; i < 5; i++) registry.add('bob')
        bob.send(create)
        await until(() => bob.socket.errors().length === 1)
        expect(bob.socket.errors()).toEqual(['atCap'])
        expect(registry.generated).toBe(1)
        vi.advanceTimersByTime(RT_CREATE_COOLDOWN_MS)
        bob.send(create)
        await until(() => bob.socket.errors().length === 2)
        expect(bob.socket.errors()).toEqual(['atCap', 'atCap'])
        expect(registry.generated).toBe(1)
    })
})
