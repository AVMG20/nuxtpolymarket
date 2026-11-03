/**
 * RtRoom with a fake clock and timers, an in-memory store and fake peers that decode every
 * frame and replay the stamped stream into their own RtWorld, the way the client lockstep does: at
 * tick T compare the server hash for T, apply every command stamped T in arrival order, then step.
 */
import { randomBytes } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RtAccess } from '#server/utils/rail-tycoon/registry'
import { RtRoom, type RtRoomDeps, type RtRoomPeer } from '#server/utils/rail-tycoon/room'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { applyCommand, decodeCommand, RT_SERVER_COMPANY, RtCommandKind, type RtCommand } from '#shared/utils/rail-tycoon/commands'
import {
    RT_CHECKPOINT_MS,
    RT_HASH_EVERY,
    RT_INPUT_DELAY,
    RT_JOIN_LOAD_TIMEOUT_MS,
    RT_JOIN_PAUSE_WINDOW_MS,
    RT_LIVE_JOIN_TIMEOUT_MS,
    RT_MAX_SAVE_BYTES,
    RT_PART_FRAGMENT_BYTES,
    RT_ROOM_CMD_BURST
} from '#shared/utils/rail-tycoon/limits'
import { decodeServerMsg, type RtServerMsg, type RtStampedCommand } from '#shared/utils/rail-tycoon/protocol'
import { decodeWorldOrThrow, decodeWorldPartsOrThrow, encodeWorld, encodeWorldParts, rtPartHash } from '#shared/utils/rail-tycoon/save'
import { RtTileKind } from '#shared/utils/rail-tycoon/map'
import { RtWorld } from '#shared/utils/rail-tycoon/world'
import { generateWorld } from '#shared/utils/rail-tycoon/worldgen'

const TICK = RT_CATALOG.time.tickMs
const WORLD_ID = 'w-room-spec'
const INVITE = '0123456789ABCDEF'
const OWNER = 'u-owner'
const SECOND = 'u-second'
const STRANGER = 'u-stranger'

const PLAYER = (companyId: number): RtAccess => ({ role: 'player', status: 'open', companyId })
const SPECTATOR: RtAccess = { role: 'spectator', status: 'open', companyId: null }

let BASE: Uint8Array
let RESET_BASE: Uint8Array
let BUILD_TILE = -1

beforeAll(() => {
    const world = RtWorld.create(generateWorld(7, { side: 64 }), { side: 64, maxCompanies: 4, sharing: false })
    world.addCompany('Owner')
    world.addCompany('Second')
    BASE = encodeWorld(world)
    for (let tile = 0; tile < 64 * 64 && BUILD_TILE < 0; tile++) {
        if (applyCommand(world, 1, { kind: RtCommandKind.buildRail, tile, piece: 0 }, false).ok) BUILD_TILE = tile
    }
    // a company that built, went bankrupt and was reset: same id, fresh start
    const reset = decodeWorldOrThrow(BASE)
    expect(applyCommand(reset, 1, { kind: RtCommandKind.buildRail, tile: BUILD_TILE, piece: 0 }, true).ok).toBe(true)
    expect(reset.resetCompany(1)).toBe(true)
    RESET_BASE = encodeWorld(reset)
})

/* ---- fakes ---- */

class FakeStore {
    save: Uint8Array
    revision = 0
    tick: number
    status: 'open' | 'closed' = 'open'
    members = new Map<string, number>([[OWNER, 0], [SECOND, 1]])
    writes: { tick: number, revision: number, companies: number, member?: { userId: string, companyId: number } }[] = []
    gate: Promise<void> | null = null
    failMember = false
    closeCalls = 0

    constructor(raw: Uint8Array) {
        this.save = gzipSync(raw)
        this.tick = decodeWorldOrThrow(raw).tick
    }

    world(): RtWorld {
        return decodeWorldOrThrow(gunzipSync(this.save))
    }
}

function deferred() {
    let release!: () => void
    const promise = new Promise<void>((resolve) => {
        release = resolve
    })
    return { promise, release }
}

function makeDeps(store: FakeStore) {
    const budget = { left: Infinity }
    const log = vi.fn<RtRoomDeps['log']>()
    const onUnload = vi.fn<RtRoomDeps['onUnload']>()
    const onIdle = vi.fn<NonNullable<RtRoomDeps['onIdle']>>()
    const deps: RtRoomDeps = {
        async rtLoadWorld(id) {
            if (id !== WORLD_ID) return null
            return { id, ownerId: OWNER, status: store.status, revision: store.revision, lastActiveAt: new Date(0), world: store.world(), inviteCode: INVITE }
        },
        async rtSaveCheckpoint(_id, parts, tick, expectedRevision, _now, options = {}) {
            if (store.gate) await store.gate
            if (expectedRevision !== store.revision) throw Object.assign(new Error('World was saved by another writer'), { statusCode: 409 })
            if (options.member && store.failMember) throw new Error('member insert failed')
            // the room's pre-write check compressed the parts already; the store must not do it again
            if (!options.stored || options.stored.chunks.length !== parts.length - 1) throw new Error('checkpoint without its compressed parts')
            const world = decodeWorldPartsOrThrow(parts)
            store.save = gzipSync(encodeWorld(world))
            store.revision++
            store.tick = tick
            if (options.member) store.members.set(options.member.userId, options.member.companyId)
            store.writes.push({ tick, revision: store.revision, companies: world.companyList().length, member: options.member })
            return store.revision
        },
        async rtCloseWorld() {
            store.status = 'closed'
            store.closeCalls++
            return {}
        },
        async rtGetAccess(userId) {
            const companyId = store.members.get(userId)
            return companyId === undefined ? { role: 'none', status: null, companyId: null } : PLAYER(companyId)
        },
        now: () => Date.now(),
        setInterval: (callback, ms) => setInterval(callback, ms),
        clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
        setTimeout: (callback, ms) => setTimeout(callback, ms),
        clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
        log,
        onUnload,
        onIdle,
        stepBudget: { remainingMs: () => budget.left, spend: () => {} }
    }
    return { deps, budget, log, onUnload, onIdle }
}

/**
 * A peer that records every frame and, like the client lockstep, puts each snapshot together from its
 * head, part frames and end (the parts the room left out from the ones it offered), then replays the
 * stamped stream into its own world.
 */
class FakePeer implements RtRoomPeer {
    frames: RtServerMsg[] = []
    world: RtWorld | null = null
    queue: RtStampedCommand[] = []
    hashes = new Map<number, number>()
    hashChecks = 0
    mismatches: number[] = []
    stale: number[] = []
    allowance = 0
    /** Snapshots that would not assemble: a part missing, or one that does not match its hash. */
    badSnapshots: string[] = []
    /** The parts the last offer() held, by hash. */
    held = new Map<string, Uint8Array>()
    private incoming: { parts: readonly string[], fragments: Map<number, Uint8Array[]> } | null = null

    constructor(readonly replay = true) {}

    send(frame: Uint8Array): void {
        const msg = decodeServerMsg(frame)
        if (!msg) throw new Error('room sent a frame that does not decode')
        this.frames.push(msg)
        if (this.replay) this.handle(msg)
    }

    of<T extends RtServerMsg['type']>(type: T): Extract<RtServerMsg, { type: T }>[] {
        return this.frames.filter(msg => msg.type === type) as Extract<RtServerMsg, { type: T }>[]
    }

    errors(): string[] {
        return this.of('error').map(msg => msg.code)
    }

    /** The hashes of this peer's own world, as a resync offers them, holding its parts. */
    offer(): string[] {
        const parts = encodeWorldParts(this.world!)
        this.held = new Map(parts.map(part => [rtPartHash(part), part]))
        return parts.map(rtPartHash)
    }

    private assemble(end: Extract<RtServerMsg, { type: 'snapshotEnd' }>): void {
        const { parts, fragments } = this.incoming!
        this.incoming = null
        const bytes: Uint8Array[] = []
        for (const [index, hash] of parts.entries()) {
            const sent = fragments.get(index)
            const part = sent ? new Uint8Array(gunzipSync(Buffer.concat(sent))) : this.held.get(hash)
            if (!part || rtPartHash(part) !== hash) {
                this.badSnapshots.push(`part ${index} at tick ${end.tick}`)
                return
            }
            bytes.push(part)
        }
        this.world = decodeWorldPartsOrThrow(bytes)
        this.queue = [...end.pending]
        this.hashes.clear()
        this.allowance = end.tick
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
            case 'snapshotEnd':
                this.assemble(msg)
                break
            case 'command':
                this.queue.push({ tick: msg.tick, company: msg.company, command: msg.command })
                break
            case 'hash':
                this.hashes.set(msg.tick, msg.hash)
                break
            case 'allowance':
                this.allowance = msg.tick
                this.advance()
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

    private advance(): void {
        const world = this.world
        if (!world) return
        while (world.tick < this.allowance) {
            this.check()
            const due = this.queue.filter(stamped => stamped.tick <= world.tick)
            this.queue = this.queue.filter(stamped => stamped.tick > world.tick)
            for (const stamped of due) {
                if (stamped.tick < world.tick) this.stale.push(stamped.tick)
                const command = decodeCommand(stamped.command, world.map.side)!
                applyCommand(world, stamped.company ?? RT_SERVER_COMPANY, command, true)
            }
            world.step()
        }
        this.check()
    }
}

/** Lets real async work (gzip on the thread pool, store promises) finish while the fake clock stands still. */
async function until(condition: () => boolean, label = 'condition'): Promise<void> {
    const started = performance.now()
    while (!condition()) {
        if (performance.now() - started > 5000) throw new Error(`timed out waiting for ${label}`)
        await new Promise(resolve => setImmediate(resolve))
    }
}

async function settle(ms = 40): Promise<void> {
    const started = performance.now()
    while (performance.now() - started < ms) await new Promise(resolve => setImmediate(resolve))
}

async function openRoom(raw: Uint8Array = BASE) {
    const store = new FakeStore(raw)
    const ctx = makeDeps(store)
    const room = await RtRoom.open(WORLD_ID, ctx.deps)
    if (!room) throw new Error('room did not open')
    return { room, store, ...ctx }
}

function attach(room: RtRoom, userId: string, access: RtAccess, options: { loaded?: boolean, replay?: boolean, peer?: FakePeer, have?: string[] } = {}): FakePeer {
    const peer = options.peer ?? new FakePeer(options.replay ?? true)
    expect(room.attach(peer, userId, access, options.have)).toBe(true)
    if (options.loaded ?? true) room.loaded(peer)
    return peer
}

const rename = (name: string): RtCommand => ({ kind: RtCommandKind.renameCompany, name })
const borrow = (steps = 1): RtCommand => ({ kind: RtCommandKind.changeLoan, steps })

function expectInSync(room: RtRoom, ...peers: FakePeer[]): void {
    for (const peer of peers) {
        expect(peer.world!.tick).toBe(room.world.tick)
        expect(peer.world!.hash()).toBe(room.world.hash())
        expect(peer.mismatches).toEqual([])
        expect(peer.stale).toEqual([])
        expect(peer.badSnapshots).toEqual([])
    }
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'))
})

afterEach(() => {
    vi.useRealTimers()
})

/* ---- Open ---- */

describe('RtRoom.open', () => {
    it('loads the world as saved and never simulates the time it was away', async () => {
        const { room } = await openRoom()
        const tick = room.world.tick
        expect(room.world.hash()).toBe(decodeWorldOrThrow(BASE).hash())
        expect(room.isRunning).toBe(false)
        vi.advanceTimersByTime(3_600_000)
        expect(room.world.tick).toBe(tick)

        attach(room, OWNER, PLAYER(0))
        expect(room.isRunning).toBe(true)
        vi.advanceTimersByTime(TICK * 10)
        expect(room.world.tick).toBe(tick + 10)
    })

    it('is null for a world that is missing or does not load', async () => {
        const store = new FakeStore(BASE)
        expect(await RtRoom.open('w-missing', makeDeps(store).deps)).toBeNull()
    })
})

/* ---- Attach, loaded, resync ---- */

describe('RtRoom.attach', () => {
    it('a spectator alone never starts ticking', async () => {
        const { room } = await openRoom()
        const tick = room.world.tick
        const peer = attach(room, STRANGER, SPECTATOR)
        vi.advanceTimersByTime(10_000)
        expect(room.world.tick).toBe(tick)
        expect(peer.of('paused').map(msg => msg.reason)).toEqual(['noPlayers'])
        expect(peer.of('opened')[0]).toMatchObject({ role: 'spectator', company: null, owner: false, inviteCode: null })
    })

    it('sends the invite code to the owner and players only', async () => {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        const second = attach(room, SECOND, PLAYER(1))
        const watcher = attach(room, STRANGER, SPECTATOR)
        expect(owner.of('opened')[0]).toMatchObject({ role: 'player', owner: true, company: 0, inviteCode: INVITE })
        expect(second.of('opened')[0]).toMatchObject({ role: 'player', owner: false, company: 1, inviteCode: INVITE })
        expect(watcher.of('opened')[0]!.inviteCode).toBeNull()
    })

    it('a peer attached while three commands are queued reaches the room hash after they execute', async () => {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        vi.advanceTimersByTime(TICK * 5)
        expect(room.submit(owner, 1, rename('Alpha Rail'))).toBe(true)
        expect(room.submit(owner, 2, borrow())).toBe(true)
        expect(room.submit(owner, 3, borrow())).toBe(true)

        const late = attach(room, STRANGER, SPECTATOR)
        const end = late.of('snapshotEnd')[0]!
        expect(end.tick).toBe(late.of('opened')[0]!.tick)
        expect(end.pending).toHaveLength(3)
        expect(end.pending.every(stamped => stamped.tick === end.tick + RT_INPUT_DELAY)).toBe(true)

        vi.advanceTimersByTime(TICK * RT_HASH_EVERY * 2)
        expect(room.world.company(0)!.name).toBe('Alpha Rail')
        expectInSync(room, owner, late)
        expect(late.hashChecks).toBeGreaterThan(0)
    })

    it('a loading player pauses the room until loaded; the slow joiner is resynced at the timeout', async () => {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        vi.advanceTimersByTime(TICK * 3)
        const second = attach(room, SECOND, PLAYER(1), { loaded: false })
        const tick = room.world.tick
        expect(room.isRunning).toBe(false)
        expect(owner.of('paused').at(-1)!.reason).toBe('joining')
        vi.advanceTimersByTime(RT_JOIN_LOAD_TIMEOUT_MS - 1)
        expect(room.world.tick).toBe(tick)
        expect(second.of('resync')).toHaveLength(0)

        vi.advanceTimersByTime(1)
        expect(second.of('resync')).toHaveLength(1)
        expect(room.isRunning).toBe(true)
        expect(owner.of('resumed').length).toBeGreaterThan(0)
        vi.advanceTimersByTime(TICK * 4)
        expect(room.world.tick).toBe(tick + 4)
        expectInSync(room, owner, second)
    })

    it('loaded ends the pause at once', async () => {
        const { room } = await openRoom()
        attach(room, OWNER, PLAYER(0))
        const second = attach(room, SECOND, PLAYER(1), { loaded: false })
        expect(room.isRunning).toBe(false)
        room.loaded(second)
        expect(room.isRunning).toBe(true)
    })

    it('a spectator loads without pausing, and one user pauses at most once per window', async () => {
        const { room } = await openRoom()
        attach(room, OWNER, PLAYER(0))
        attach(room, STRANGER, SPECTATOR, { loaded: false })
        expect(room.isRunning).toBe(true)

        const first = attach(room, SECOND, PLAYER(1), { loaded: false })
        expect(room.isRunning).toBe(false)
        vi.advanceTimersByTime(RT_JOIN_LOAD_TIMEOUT_MS)
        expect(room.isRunning).toBe(true)
        room.detach(first)
        attach(room, SECOND, PLAYER(1), { loaded: false })
        expect(room.isRunning).toBe(true)

        vi.advanceTimersByTime(RT_JOIN_PAUSE_WINDOW_MS)
        const again = attach(room, SECOND, PLAYER(1), { loaded: false })
        expect(room.isRunning).toBe(false)
        room.loaded(again)
        expect(room.isRunning).toBe(true)
    })

    it('join pauses take at most a tenth of the wall time', async () => {
        const { room } = await openRoom()
        attach(room, OWNER, PLAYER(0))
        // four joiners that never load spend 54 s of the 60 s budget
        for (let i = 0; i < 4; i++) {
            attach(room, `u-slow-${i}`, PLAYER(1), { loaded: false })
            expect(room.isRunning).toBe(false)
            vi.advanceTimersByTime(RT_JOIN_LOAD_TIMEOUT_MS)
            expect(room.isRunning).toBe(true)
        }
        const fifth = attach(room, 'u-slow-4', PLAYER(1), { loaded: false })
        expect(room.isRunning).toBe(false)
        vi.advanceTimersByTime(6000 - 1)
        expect(room.isRunning).toBe(false)
        vi.advanceTimersByTime(1)
        expect(room.isRunning).toBe(true)
        expect(fifth.of('resync')).toHaveLength(1)

        attach(room, 'u-slow-5', PLAYER(1), { loaded: false })
        expect(room.isRunning).toBe(true)
    })

    it('commands stamped around an attach or a resync reach the peer after its snapshot, in order', async () => {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        const second = attach(room, SECOND, PLAYER(1))
        vi.advanceTimersByTime(TICK * 2)
        room.submit(second, 1, rename('Before'))
        const late = attach(room, STRANGER, SPECTATOR)
        room.submit(second, 2, rename('Same Tick'))
        vi.advanceTimersByTime(TICK)
        room.submit(second, 3, rename('Next Tick'))

        const kinds = late.frames.map(msg => msg.type)
        expect(kinds[0]).toBe('opened')
        // the head, every part (the peer offered none), then the end before any command
        const parts = late.of('opened')[0]!.parts.length
        expect(kinds.slice(1, 1 + parts)).toEqual(Array(parts).fill('part'))
        expect(kinds[1 + parts]).toBe('snapshotEnd')
        expect(late.of('snapshotEnd')[0]!.pending).toHaveLength(1)
        const commands = late.of('command').map(msg => decodeCommand(msg.command)) as { name: string }[]
        expect(commands.map(command => command.name)).toEqual(['Same Tick', 'Next Tick'])

        room.submit(second, 4, borrow())
        expect(room.resync(late)).toBe(true)
        room.submit(second, 5, borrow())
        const end = late.of('snapshotEnd')[1]!
        expect(end.pending.length).toBeGreaterThan(0)
        expect(late.frames.indexOf(end)).toBeLessThan(late.frames.length - 1)

        vi.advanceTimersByTime(TICK * RT_HASH_EVERY * 2)
        expect(room.world.company(1)!.name).toBe('Next Tick')
        expectInSync(room, owner, second, late)
    })

    it('a client built from a fresh paused room keeps the server hash once a player attaches', async () => {
        const { room } = await openRoom()
        const watcher = attach(room, STRANGER, SPECTATOR)
        const owner = attach(room, OWNER, PLAYER(0))
        room.submit(owner, 1, borrow())
        vi.advanceTimersByTime(TICK * RT_HASH_EVERY * 2)
        expectInSync(room, watcher, owner)
        expect(watcher.hashChecks).toBeGreaterThan(0)
    })

    it('sends only the parts that differ from the ones offered, and the peer rebuilds the room\'s world from both', async () => {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        const total = owner.of('opened')[0]!.parts.length
        expect(owner.of('part')).toHaveLength(total)
        vi.advanceTimersByTime(TICK * 40)
        room.submit(owner, 1, { kind: RtCommandKind.buildRail, tile: BUILD_TILE, piece: 0 })
        vi.advanceTimersByTime(TICK * 10)

        // a resync offering the peer's own world: only what moved since comes back
        const have = owner.offer()
        const before = owner.of('part').length
        expect(room.resync(owner, have)).toBe(true)
        const sent = owner.of('part').slice(before)
        const changed = owner.of('resync')[0]!.parts.filter((hash, index) => hash !== have[index]).length
        expect(sent.map(msg => msg.index)).toEqual([...new Set(sent.map(msg => msg.index))])
        expect(sent).toHaveLength(changed)
        expect(changed).toBeLessThan(total)
        vi.advanceTimersByTime(TICK * RT_HASH_EVERY * 2)
        expectInSync(room, owner)

        // a reopen offering hashes the room still has sends none of those parts again
        const watcher = new FakePeer()
        watcher.world = decodeWorldPartsOrThrow(encodeWorldParts(room.world))
        attach(room, STRANGER, SPECTATOR, { peer: watcher, have: watcher.offer() })
        expect(watcher.of('part').length).toBeLessThanOrEqual(1)
        vi.advanceTimersByTime(TICK * RT_HASH_EVERY)
        expectInSync(room, owner, watcher)
    })

    it('offered hashes the room does not have, or garbage, only cost the full parts', async () => {
        const { room } = await openRoom()
        const peer = attach(room, STRANGER, SPECTATOR, { have: ['0000000000000000', 'ffffffffffffffff'] })
        expect(peer.of('part')).toHaveLength(peer.of('opened')[0]!.parts.length)
        expect(peer.badSnapshots).toEqual([])
        expect(peer.world!.hash()).toBe(room.world.hash())
    })

    it('splits a part larger than a fragment over several frames, in order', async () => {
        const { room, deps } = await openRoom()
        const filler = new Uint8Array(randomBytes(RT_PART_FRAGMENT_BYTES + RT_PART_FRAGMENT_BYTES / 2))
        deps.encodeWorldParts = world => [filler, ...encodeWorldParts(world).slice(1)]
        const peer = attach(room, STRANGER, SPECTATOR, { replay: false })
        const first = peer.of('part').filter(msg => msg.index === 0)
        expect(first.map(msg => msg.last)).toEqual([false, true])
        expect(first[0]!.bytes.length).toBe(RT_PART_FRAGMENT_BYTES)
        expect(new Uint8Array(gunzipSync(Buffer.concat(first.map(msg => msg.bytes))))).toEqual(filler)
        expect(peer.of('part').filter(msg => msg.index > 0).every(msg => msg.last)).toBe(true)
    })

    it('refuses a peer without access', async () => {
        const { room } = await openRoom()
        const peer = new FakePeer()
        expect(room.attach(peer, STRANGER, { role: 'none', status: null, companyId: null })).toBe(false)
        expect(peer.errors()).toEqual(['noAccess'])
        expect(room.peerCount).toBe(0)
    })
})

/* ---- Detach ---- */

describe('RtRoom.detach', () => {
    it('the last player leaving runs the command stamped ahead, pauses, and writes one leave checkpoint', async () => {
        const { room, store, onIdle } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        const watcher = attach(room, STRANGER, SPECTATOR)
        vi.advanceTimersByTime(TICK * 4)
        room.submit(owner, 1, rename('Last Words'))
        const stampedFor = owner.of('command')[0]!.tick
        vi.advanceTimersByTime(TICK)
        expect(stampedFor - room.world.tick).toBe(2)

        room.detach(owner)
        expect(room.isRunning).toBe(true)
        vi.advanceTimersByTime(1000)
        expect(room.isRunning).toBe(false)
        expect(room.world.tick).toBe(stampedFor + 1)
        expect(room.world.company(0)!.name).toBe('Last Words')
        expect(watcher.of('paused').at(-1)!.reason).toBe('noPlayers')

        await until(() => store.writes.length === 1, 'leave checkpoint')
        expect(store.tick).toBe(room.world.tick)
        expect(store.world().hash()).toBe(room.world.hash())
        await until(() => onIdle.mock.calls.length === 1, 'onIdle')

        const tick = room.world.tick
        vi.advanceTimersByTime(60_000)
        expect(room.world.tick).toBe(tick)
        expect(store.writes).toHaveLength(1)
        expectInSync(room, watcher)
    })

    it('a reattach after a long absence finds the tick unchanged', async () => {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        vi.advanceTimersByTime(TICK * 10)
        room.detach(owner)
        const tick = room.world.tick
        vi.advanceTimersByTime(24 * 3_600_000)
        expect(room.world.tick).toBe(tick)
        const back = attach(room, OWNER, PLAYER(0), { loaded: false })
        expect(back.of('opened')[0]!.tick).toBe(tick)
        room.loaded(back)
        vi.advanceTimersByTime(TICK)
        expect(room.world.tick).toBe(tick + 1)
    })

    it('a lone player reopening the world from the same socket writes no checkpoint', async () => {
        const { room, store } = await openRoom()
        const peer = new FakePeer(false)
        for (let k = 0; k < 30; k++) {
            expect(room.attach(peer, OWNER, PLAYER(0))).toBe(true)
            room.loaded(peer)
            vi.advanceTimersByTime(TICK * 3)
        }
        await settle()
        expect(store.writes).toEqual([])
        expect(room.isRunning).toBe(true)
        expect(room.playerCount).toBe(1)
    })

    it('a detach while a periodic write is in flight stores the leave-time state with no 409 and no unload', async () => {
        const { room, store, onUnload } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0), { replay: false })
        const gate = deferred()
        store.gate = gate.promise
        vi.advanceTimersByTime(RT_CHECKPOINT_MS + 100)
        vi.advanceTimersByTime(TICK * 3)
        room.detach(owner)
        expect(room.isRunning).toBe(false)
        const leaveTick = room.world.tick
        gate.release()
        await until(() => store.writes.length === 2, 'periodic then leave write')
        expect(store.writes[0]!.tick).toBeLessThan(leaveTick)
        expect(store.writes[1]!.tick).toBe(leaveTick)
        expect(store.world().hash()).toBe(room.world.hash())
        expect(onUnload).not.toHaveBeenCalled()
        expect(room.revision).toBe(2)
    })

    it('a foreign 409 on the leave checkpoint unloads the room without overwriting', async () => {
        const { room, store, onUnload } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        const watcher = attach(room, STRANGER, SPECTATOR)
        vi.advanceTimersByTime(TICK * 5)
        store.revision = 7
        const before = store.save
        room.detach(owner)
        await until(() => onUnload.mock.calls.length === 1, 'unload')
        expect(onUnload.mock.calls[0]![1]).toBe('conflict')
        expect(watcher.of('roomUnloaded').map(msg => msg.reason)).toEqual(['conflict'])
        expect(store.save).toBe(before)
        expect(room.isUnloaded).toBe(true)
    })
})

/* ---- Submit ---- */

describe('RtRoom.submit', () => {
    async function race(first: 'owner' | 'second') {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        const second = attach(room, SECOND, PLAYER(1))
        vi.advanceTimersByTime(TICK)
        const order = first === 'owner' ? [owner, second] : [second, owner]
        for (const peer of order) expect(room.submit(peer, 9, rename('Contested'))).toBe(true)
        const broadcast = owner.of('command')
        expect(broadcast.map(msg => msg.company)).toEqual(first === 'owner' ? [0, 1] : [1, 0])
        expect(second.of('command').map(msg => msg.company)).toEqual(broadcast.map(msg => msg.company))
        vi.advanceTimersByTime(TICK * 10)
        expectInSync(room, owner, second)
        return room
    }

    it('refuses a depot search busy once the step budget is spent, while other commands still go through', async () => {
        const { room, budget } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        vi.advanceTimersByTime(TICK)
        budget.left = 0
        expect(room.submit(owner, 1, { kind: RtCommandKind.sendToDepot, vehicle: 0 })).toBe(false)
        expect(owner.errors()).toEqual(['busy'])
        expect(room.submit(owner, 2, rename('Still here'))).toBe(true)
    })

    it('applies two players\' commands in stamp then arrival order', async () => {
        const ownerFirst = await race('owner')
        expect(ownerFirst.world.company(0)!.name).toBe('Contested')
        expect(ownerFirst.world.company(1)!.name).toBe('Second')
        const secondFirst = await race('second')
        expect(secondFirst.world.company(1)!.name).toBe('Contested')
        expect(secondFirst.world.company(0)!.name).toBe('Owner')
    })

    it('a command acts for the sender\'s own company only', async () => {
        const { room } = await openRoom()
        attach(room, OWNER, PLAYER(0))
        const second = attach(room, SECOND, PLAYER(1))
        const loans = [room.world.company(0)!.loan, room.world.company(1)!.loan]
        room.submit(second, 1, borrow())
        expect(second.of('command')[0]!.company).toBe(1)
        vi.advanceTimersByTime(TICK * 5)
        expect(room.world.company(0)!.loan).toBe(loans[0])
        expect(room.world.company(1)!.loan).toBeGreaterThan(loans[1]!)
    })

    it('refuses a spectator, and nothing is stamped', async () => {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        const watcher = attach(room, STRANGER, SPECTATOR)
        expect(room.submit(watcher, 1, borrow())).toBe(false)
        expect(watcher.errors()).toEqual(['notPlayer'])
        expect(owner.of('command')).toHaveLength(0)
    })

    it('answers a failed pre-check to the sender only', async () => {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        const second = attach(room, SECOND, PLAYER(1))
        expect(room.submit(second, 42, rename('Owner'))).toBe(false)
        expect(second.of('result')).toEqual([{ type: 'result', seq: 42, error: expect.any(Number) }])
        expect(owner.of('result')).toHaveLength(0)
        expect(owner.of('command')).toHaveLength(0)
    })

    it('re-checks the command against the world\'s map side and never takes foundCompany from a client', async () => {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        // valid on a 256 map, past the edge of this 64 one
        const offMap: RtCommand = { kind: RtCommandKind.buildRail, tile: 64 * 64 + 5, piece: 0 }
        expect(room.submit(owner, 1, offMap)).toBe(false)
        expect(room.submit(owner, 2, { kind: RtCommandKind.foundCompany, name: 'Sneaky', colour: 3 })).toBe(false)
        expect(owner.errors()).toEqual(['badRequest', 'badRequest'])
        expect(owner.of('command')).toHaveLength(0)
    })

    it('limits each player to the command rate', async () => {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        for (let i = 0; i < RT_ROOM_CMD_BURST; i++) expect(room.submit(owner, i % 256, rename(`Name ${i}`))).toBe(true)
        expect(room.submit(owner, 0, rename('One Too Many'))).toBe(false)
        expect(owner.errors()).toEqual(['rateLimited'])
        // a reconnect does not refill the bucket
        room.detach(owner)
        const again = attach(room, OWNER, PLAYER(0))
        expect(room.submit(again, 0, rename('Reconnected'))).toBe(false)
        vi.advanceTimersByTime(1000)
        expect(room.submit(again, 0, rename('After A Second'))).toBe(true)
    })

    it('a company reset by bankruptcy keeps its id and builds again', async () => {
        const { room } = await openRoom(RESET_BASE)
        const second = attach(room, SECOND, PLAYER(1))
        const build: RtCommand = { kind: RtCommandKind.buildRail, tile: BUILD_TILE, piece: 0 }
        expect(room.submit(second, 1, build)).toBe(true)
        vi.advanceTimersByTime(TICK * 5)
        expect(room.world.map.kind[BUILD_TILE]).toBe(RtTileKind.rail)
        expect(room.world.map.owner[BUILD_TILE]).toBe(1)
        expectInSync(room, second)
    })
})

/* ---- The tick ---- */

describe('RtRoom.tickOnce', () => {
    it('runs 37 steps a second and a late timer catches up at most 4 per callback', async () => {
        const { room } = await openRoom()
        attach(room, OWNER, PLAYER(0), { replay: false })
        const start = room.world.tick
        vi.advanceTimersByTime(1000)
        expect(room.world.tick - start).toBe(37)

        const before = room.world.tick
        vi.setSystemTime(Date.now() + 200)
        room.tickOnce()
        expect(room.world.tick - before).toBe(4)
        room.tickOnce()
        expect(room.world.tick - before).toBe(4 + 3)
        vi.setSystemTime(Date.now() + 10_000)
        room.tickOnce()
        expect(room.world.tick - before).toBe(4 + 3 + 4)
    })

    it('never steps past the hub\'s step budget', async () => {
        const { room, budget } = await openRoom()
        attach(room, OWNER, PLAYER(0), { replay: false })
        budget.left = 0
        const tick = room.world.tick
        vi.advanceTimersByTime(1000)
        expect(room.world.tick).toBe(tick)
        budget.left = Infinity
        vi.advanceTimersByTime(TICK)
        expect(room.world.tick).toBeGreaterThan(tick)
    })

    it('broadcasts an allowance after steps and the hash every RT_HASH_EVERY ticks', async () => {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        vi.advanceTimersByTime(TICK * RT_HASH_EVERY * 3)
        expect(owner.of('allowance').at(-1)!.tick).toBe(room.world.tick)
        const hashes = owner.of('hash')
        expect(hashes.length).toBeGreaterThanOrEqual(2)
        expect(hashes.every(msg => msg.tick % RT_HASH_EVERY === 0)).toBe(true)
        expect(owner.hashChecks).toBe(hashes.length)
        expectInSync(room, owner)
    })

    it('twin rooms fed the same stream stay hash-equal', async () => {
        const a = await openRoom()
        const b = await openRoom()
        const peers = [a, b].map(({ room }) => [attach(room, OWNER, PLAYER(0)), attach(room, SECOND, PLAYER(1))] as const)
        for (let round = 0; round < 6; round++) {
            for (const [index, { room }] of [a, b].entries()) {
                room.submit(peers[index]![0], round, rename(`Owner ${round}`))
                room.submit(peers[index]![1], round, borrow(round % 2 === 0 ? 1 : -1))
            }
            vi.advanceTimersByTime(TICK * 30)
            expect(a.room.world.tick).toBe(b.room.world.tick)
            expect(a.room.world.hash()).toBe(b.room.world.hash())
        }
        expectInSync(a.room, ...peers[0]!)
        expectInSync(b.room, ...peers[1]!)
    })

    it('writes a checkpoint every RT_CHECKPOINT_MS', async () => {
        const { room, store } = await openRoom()
        attach(room, OWNER, PLAYER(0), { replay: false })
        vi.advanceTimersByTime(RT_CHECKPOINT_MS - 100)
        await settle()
        expect(store.writes).toHaveLength(0)
        vi.advanceTimersByTime(200)
        await until(() => store.writes.length === 1, 'first periodic write')
        vi.advanceTimersByTime(RT_CHECKPOINT_MS)
        await until(() => store.writes.length === 2, 'second periodic write')
        expect(room.revision).toBe(2)
    })

    it('a throwing step unloads the room and leaves the stored save unchanged', async () => {
        const { room, store, onUnload } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        const watcher = attach(room, STRANGER, SPECTATOR)
        vi.advanceTimersByTime(TICK * 3)
        const before = store.save
        room.world.step = () => {
            throw new Error('boom')
        }
        vi.advanceTimersByTime(TICK * 3)
        expect(onUnload).toHaveBeenCalledWith(room, 'error')
        for (const peer of [owner, watcher]) expect(peer.of('roomUnloaded').map(msg => msg.reason)).toEqual(['error'])
        await settle()
        expect(store.save).toBe(before)
        expect(store.writes).toHaveLength(0)
        expect(room.submit(owner, 1, borrow())).toBe(false)
    })

    it('refuses to write bytes that do not decode to the live world, keeps the save and unloads', async () => {
        const { room, store, deps, log, onUnload } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        const watcher = attach(room, STRANGER, SPECTATOR)
        vi.advanceTimersByTime(TICK * 5)
        const before = store.save
        deps.encodeWorldParts = (world) => {
            const parts = encodeWorldParts(world)
            const chunk = parts[3]!
            chunk[chunk.length - 3]! ^= 0x5a
            return parts
        }
        room.detach(owner)
        await until(() => onUnload.mock.calls.length === 1, 'refused write')
        expect(onUnload.mock.calls[0]![1]).toBe('error')
        expect(watcher.of('roomUnloaded').map(msg => msg.reason)).toEqual(['error'])
        expect(store.save).toBe(before)
        expect(store.writes).toHaveLength(0)
        const refusals = log.mock.calls.filter(([, message]) => message.includes('refused'))
        expect(refusals).toHaveLength(1)
        expect(refusals[0]![1]).toContain(WORLD_ID)
        expect(refusals[0]![1]).toContain(`tick ${room.world.tick}`)
    })

    it('refuses to write a save over RT_MAX_SAVE_BYTES compressed', async () => {
        const { room, store, deps, log, onUnload } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0), { replay: false })
        const watcher = attach(room, STRANGER, SPECTATOR, { replay: false })
        vi.advanceTimersByTime(TICK * 2)
        const before = store.save
        // two parts of noise, each under the cap alone, over it together
        const half = RT_MAX_SAVE_BYTES / 2 + 4096
        deps.encodeWorldParts = world => [...encodeWorldParts(world).slice(0, -2), new Uint8Array(randomBytes(half)), new Uint8Array(randomBytes(half))]
        room.detach(owner)
        await until(() => onUnload.mock.calls.length === 1, 'refused oversized write')
        expect(watcher.of('roomUnloaded').map(msg => msg.reason)).toEqual(['error'])
        expect(store.save).toBe(before)
        expect(log.mock.calls.some(([, message]) => message.includes('compressed save'))).toBe(true)
    })
})

/* ---- Stop ---- */

describe('RtRoom.stop', () => {
    it('only the owner stops; then commands are refused, the tick stands still and spectators still get the snapshot', async () => {
        const { room, store } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        const second = attach(room, SECOND, PLAYER(1))
        vi.advanceTimersByTime(TICK * 5)
        room.submit(second, 1, borrow())

        expect(await room.stop(SECOND)).toEqual({ ok: false, code: 'notOwner' })
        expect(room.isRunning).toBe(true)

        const stopped = room.stop(OWNER)
        expect(room.submit(second, 2, borrow())).toBe(false)
        expect(await stopped).toEqual({ ok: true })
        expect(store.closeCalls).toBe(1)
        expect(store.writes).toHaveLength(1)
        expect(store.tick).toBe(room.world.tick)
        expect(room.worldStatus).toBe('closed')
        for (const peer of [owner, second]) {
            expect(peer.of('worldClosed')).toHaveLength(1)
            expect(peer.of('paused').at(-1)!.reason).toBe('closed')
        }

        const tick = room.world.tick
        vi.advanceTimersByTime(10_000)
        expect(room.world.tick).toBe(tick)
        expect(room.submit(owner, 3, borrow())).toBe(false)
        expect(owner.errors()).toContain('worldClosed')
        expect(await room.join(STRANGER, 'Late')).toEqual({ ok: false, code: 'worldClosed' })

        const watcher = attach(room, OWNER, PLAYER(0))
        expect(watcher.of('opened')[0]).toMatchObject({ role: 'spectator', company: null, tick })
        expect(watcher.world!.hash()).toBe(room.world.hash())
    })
})

/* ---- Live join ---- */

describe('RtRoom.join', () => {
    it('an existing member gets their company back and nothing is stamped', async () => {
        const { room, store } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        expect(await room.join(SECOND, 'Second')).toEqual({ ok: true, companyId: 1, existing: true })
        expect(owner.of('command')).toHaveLength(0)
        expect(store.writes).toHaveLength(0)
    })

    it('a live join into a running room keeps two replaying peers in sync and records the member', async () => {
        const { room, store } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        const watcher = attach(room, STRANGER, SPECTATOR)
        vi.advanceTimersByTime(TICK * 7)
        const joining = room.join('u-new', 'New Rail')
        let settled = false
        void joining.then(() => {
            settled = true
        })
        await until(() => owner.of('command').length === 1, 'foundCompany broadcast')
        const found = owner.of('command')[0]!
        expect(found.company).toBeNull()
        expect(found.tick).toBe(room.world.tick + RT_INPUT_DELAY)
        await settle()
        expect(settled).toBe(false)

        vi.advanceTimersByTime(TICK * RT_INPUT_DELAY + TICK)
        const outcome = await joining
        expect(outcome).toEqual({ ok: true, companyId: 2, existing: false })
        expect(room.world.company(2)!.name).toBe('New Rail')
        expect(store.members.get('u-new')).toBe(2)
        expect(store.world().company(2)!.name).toBe('New Rail')

        const joiner = attach(room, 'u-new', PLAYER(2))
        room.submit(joiner, 1, borrow())
        vi.advanceTimersByTime(TICK * RT_HASH_EVERY * 2)
        expectInSync(room, owner, watcher, joiner)
    })

    it('a live join into a paused room with only a spectator keeps the spectator in sync', async () => {
        const { room, store } = await openRoom()
        const watcher = attach(room, STRANGER, SPECTATOR)
        const tick = room.world.tick
        const outcome = await room.join('u-new', 'Quiet Join')
        expect(outcome).toEqual({ ok: true, companyId: 2, existing: false })
        expect(watcher.of('command')[0]).toMatchObject({ tick, company: null })
        expect(room.world.tick).toBe(tick)
        expect(store.writes[0]!.member).toEqual({ userId: 'u-new', companyId: 2 })

        const joiner = attach(room, 'u-new', PLAYER(2))
        const fresh = attach(room, 'u-other-watcher', SPECTATOR)
        expect(fresh.world!.company(2)!.name).toBe('Quiet Join')
        vi.advanceTimersByTime(TICK * RT_HASH_EVERY * 2)
        expectInSync(room, watcher, joiner, fresh)
    })

    it('a paused-room join applies the commands already queued for that tick first, as every peer will', async () => {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        vi.advanceTimersByTime(TICK * 2)
        room.submit(owner, 1, rename('Queued First'))
        vi.advanceTimersByTime(TICK)
        // a loading player starts a pause that drains only what was queued before it
        const second = attach(room, SECOND, PLAYER(1), { loaded: false })
        room.submit(owner, 2, borrow())
        const later = owner.of('command')[1]!.tick
        vi.advanceTimersByTime(TICK * 10)
        expect(room.isRunning).toBe(false)
        expect(room.world.tick).toBe(later)

        const outcome = await room.join('u-new', 'Behind The Queue')
        expect(outcome).toMatchObject({ ok: true, companyId: 2 })
        const found = owner.of('command').at(-1)!
        expect(found).toMatchObject({ tick: later, company: null })
        expect(room.world.tick).toBe(later)

        expect(room.world.company(0)!.loan).toBe(owner.world!.company(0)!.loan + RT_CATALOG.economy.loanStep)
        room.loaded(second)
        vi.advanceTimersByTime(TICK * RT_HASH_EVERY * 2)
        expectInSync(room, owner, second)
    })

    it('with the owner loading, a friend joins and opens at the same tick and gets their own company', async () => {
        const { room } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0), { loaded: false })
        const tick = room.world.tick
        expect(owner.world!.company(2)).toBeUndefined()

        const outcome = await room.join('u-friend', 'Friend Lines')
        expect(outcome).toMatchObject({ ok: true, companyId: 2 })
        const friend = attach(room, 'u-friend', PLAYER(2), { loaded: false })
        const opened = friend.of('opened')[0]!
        expect(opened.tick).toBe(tick)
        // the cached bytes from the owner's open were not reused: they lack the friend's company
        expect(friend.world!.company(2)!.name).toBe('Friend Lines')
        expect(friend.world!.hash()).toBe(room.world.hash())

        // a command queued between two opens at one tick reaches both openers
        const second = attach(room, SECOND, PLAYER(1), { loaded: false })
        room.submit(second, 1, rename('Between Opens'))
        const third = attach(room, 'u-watch', SPECTATOR)
        expect(third.of('snapshotEnd')[0]!.pending).toHaveLength(1)
        expect(friend.of('command')).toHaveLength(1)
        expect(third.of('opened')[0]!.parts).toEqual(opened.parts)
        expect(third.of('part')).toEqual(friend.of('part'))

        for (const peer of [owner, friend, second]) room.loaded(peer)
        vi.advanceTimersByTime(TICK * RT_HASH_EVERY * 2)
        expect(room.world.company(1)!.name).toBe('Between Opens')
        expectInSync(room, owner, friend, second, third)
    })

    it('a failing member insert unloads the room and the stored save holds no new company', async () => {
        const { room, store, onUnload } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        vi.advanceTimersByTime(TICK * 3)
        store.failMember = true
        const before = store.save
        const joining = room.join('u-new', 'Doomed')
        await until(() => owner.of('command').length === 1, 'foundCompany stamped')
        vi.advanceTimersByTime(TICK * (RT_INPUT_DELAY + 2))
        expect(await joining).toEqual({ ok: false, code: 'busy' })
        expect(onUnload.mock.calls[0]![1]).toBe('joinFailed')
        expect(owner.of('roomUnloaded').map(msg => msg.reason)).toEqual(['joinFailed'])
        expect(store.save).toBe(before)
        expect(store.world().company(2)).toBeUndefined()
        expect(store.members.has('u-new')).toBe(false)
    })

    it('a periodic checkpoint never writes the new company before its member row', async () => {
        const { room, store } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0), { replay: false })
        // the first periodic checkpoint falls due in the callback that executes foundCompany
        const dueCallback = Math.ceil(RT_CHECKPOINT_MS / TICK)
        vi.advanceTimersByTime(TICK * (dueCallback - 1 - RT_INPUT_DELAY))
        const joining = room.join('u-new', 'Held')
        await until(() => owner.of('command').length === 1, 'foundCompany stamped')
        expect(owner.of('command')[0]!.tick).toBe(dueCallback - 1)
        vi.advanceTimersByTime(TICK * (RT_INPUT_DELAY + 1))
        expect(await joining).toMatchObject({ ok: true, companyId: 2 })
        await settle()
        for (const write of store.writes) if (write.member === undefined) expect(write.companies).toBe(2)
        expect(store.writes.at(-1)!.member).toEqual({ userId: 'u-new', companyId: 2 })
        expect(store.world().company(2)!.name).toBe('Held')
    })

    it('a join while a player is loading completes, and one that cannot finish fails at RT_LIVE_JOIN_TIMEOUT_MS', async () => {
        const { room, store, onUnload } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0))
        const second = attach(room, SECOND, PLAYER(1), { loaded: false })
        expect(room.isRunning).toBe(false)
        expect(await room.join('u-new', 'While Loading')).toMatchObject({ ok: true, companyId: 2 })
        room.loaded(second)
        vi.advanceTimersByTime(TICK * RT_HASH_EVERY)
        expectInSync(room, owner, second)

        store.gate = new Promise(() => {})
        const commands = owner.of('command').length
        const stuck = room.join('u-late', 'Never Saved')
        await until(() => owner.of('command').length === commands + 1, 'foundCompany stamped')
        vi.advanceTimersByTime(TICK * (RT_INPUT_DELAY + 1))
        await settle()
        expect(onUnload).not.toHaveBeenCalled()
        vi.advanceTimersByTime(RT_LIVE_JOIN_TIMEOUT_MS)
        expect(await stuck).toEqual({ ok: false, code: 'busy' })
        expect(onUnload.mock.calls[0]![1]).toBe('joinFailed')
        expect(owner.of('roomUnloaded').map(msg => msg.reason)).toEqual(['joinFailed'])
    })

    it('refuses a full world', async () => {
        const { room } = await openRoom()
        expect(await room.join('u-a', 'A')).toMatchObject({ ok: true, companyId: 2 })
        expect(await room.join('u-b', 'B')).toMatchObject({ ok: true, companyId: 3 })
        expect(await room.join('u-c', 'C')).toEqual({ ok: false, code: 'worldFull' })
    })
})

/* ---- unload ---- */

describe('RtRoom.unload', () => {
    it('checkpoints unsaved play before an idle unload', async () => {
        const { room, store } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0), { replay: false })
        const watcher = attach(room, STRANGER, SPECTATOR, { replay: false })
        vi.advanceTimersByTime(TICK * 20)
        await room.unload()
        expect(store.writes).toHaveLength(1)
        expect(store.tick).toBe(room.world.tick)
        expect(watcher.of('roomUnloaded').map(msg => msg.reason)).toEqual(['idle'])
        expect(room.isUnloaded).toBe(true)
        expect(room.submit(owner, 1, borrow())).toBe(false)
    })

    it('refuses an attach while its checkpoint is written, and leaves no tick running after it unloaded', async () => {
        const { room, store } = await openRoom()
        const owner = attach(room, OWNER, PLAYER(0), { replay: false })
        vi.advanceTimersByTime(TICK * 20)
        room.detach(owner)
        await until(() => store.writes.length === 1, 'leave write')
        vi.advanceTimersByTime(TICK * 5)
        const gate = deferred()
        store.gate = gate.promise
        // unsaved state, so unload writes a checkpoint and waits on the gate
        room.world.tick++
        const unloading = room.unload()
        const late = new FakePeer(false)
        expect(room.attach(late, OWNER, PLAYER(0))).toBe(false)
        expect(late.errors()).toEqual(['busy'])
        gate.release()
        await unloading
        expect(room.isUnloaded).toBe(true)
        expect(room.isRunning).toBe(false)
        const tick = room.world.tick
        vi.advanceTimersByTime(TICK * 50)
        expect(room.world.tick).toBe(tick)
        expect(store.tick).toBe(tick)
    })
})
