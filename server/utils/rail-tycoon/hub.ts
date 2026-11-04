/**
 * Rail Tycoon hub: ties authenticated sockets, the world registry and live rooms together.
 *
 * One socket per user (a newer one closes the older as replaced), a token bucket per connection, and
 * every frame decoded by decodeClientMsg, the anti-cheat boundary. Every lifecycle step of one world
 * (open, join, stop, delete, unload) runs in that world's promise chain, so they never interleave and
 * the live-or-offline decision is taken inside it; a step that needs two chains takes them in
 * ascending world id order and every wait is bounded by RT_CHAIN_TIMEOUT_MS. Destructive
 * acts ask the registry first, so a non-owner never disconnects anyone.
 *
 * Every export carries the rt prefix, because Nitro auto-imports server/utils recursively.
 */
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { railTycoonWorlds } from '#server/database/schema'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import {
    isRtInviteCode,
    RT_BROKEN_UNLOADS,
    RT_BROKEN_WINDOW_MS,
    RT_CHAIN_TIMEOUT_MS,
    RT_CREATE_COOLDOWN_MS,
    RT_INVITE_FAILS_PER_MINUTE,
    RT_MAX_LIVE_ROOMS,
    RT_MAX_PEERS,
    RT_MAX_PENDING_CREATES,
    RT_OPEN_COOLDOWN_MS,
    RT_RESYNC_COOLDOWN_MS,
    RT_ROOM_IDLE_MS,
    RT_SOCKET_MSG_BURST,
    RT_SOCKET_MSG_RATE,
    RT_STEP_BUDGET_MS
} from '#shared/utils/rail-tycoon/limits'
import {
    decodeClientMsg,
    encodeServerMsg,
    RT_PROTOCOL_BOUNDS,
    RT_PROTOCOL_VERSION,
    RtCloseCode,
    type RtClientMsg,
    type RtErrorCode,
    type RtServerMsg,
    type RtUnloadReason,
    type RtWorldSummary
} from '#shared/utils/rail-tycoon/protocol'
import {
    rtCloseWorld,
    rtCreateWorld,
    rtDeleteWorld,
    rtGetAccess,
    rtJoinWorld,
    rtListWorldsForUser,
    type RtAccess,
    type RtCreatedWorld,
    type RtCreateOptions,
    type RtJoinedWorld,
    type RtWorldListing
} from './registry'
import { rtDescribeError, rtFullBucket, rtTakeToken, type RtTokenBucket } from './limiter'
import { RtRoom, type RtRoomDeps, type RtRoomPeer, type RtStepBudget } from './room'
import { rtLoadWorld, rtSaveCheckpoint } from './store'

const TICK_MS = RT_CATALOG.time.tickMs
/** Invite lookups that failed are counted over this window. */
const RT_INVITE_FAIL_WINDOW_MS = 60000
/** How often idle rooms and stale per-user state are swept. */
const RT_SWEEP_MS = 30000
/** Per-user cooldown state is kept this long after the user was last seen. */
const RT_USER_STATE_TTL_MS = 600000

const TIMED_OUT = Symbol('rt-chain-timeout')
type RtTimedOut = typeof TIMED_OUT

/** One authenticated socket as the hub sees it; the ws route adds the backlog close (tooSlow). */
export interface RtHubSocket {
    send(frame: Uint8Array): void
    close(code: number, reason: string): void
}

export interface RtHubUser {
    id: string
    name: string
}

/** What the room deps need from outside; the hub adds the access, close, unload, idle and budget hooks. */
export type RtHubRoomDeps = Omit<RtRoomDeps, 'onUnload' | 'onIdle' | 'stepBudget' | 'rtGetAccess' | 'rtCloseWorld'>

/** Everything the hub touches outside itself, injected so tests drive it with fakes. */
export interface RtHubDeps extends RtHubRoomDeps {
    /** The deploy's build id for hello. */
    buildId: string
    rtListWorldsForUser(userId: string): Promise<RtWorldListing[]>
    rtCreateWorld(userId: string, userName: string, name: string, options: RtCreateOptions): Promise<RtCreatedWorld>
    rtJoinWorld(userId: string, userName: string, inviteCode: string): Promise<RtJoinedWorld>
    rtGetAccess(userId: string, worldId: string, inviteCode?: string): Promise<RtAccess>
    rtCloseWorld(userId: string, worldId: string): Promise<unknown>
    rtDeleteWorld(userId: string, worldId: string): Promise<unknown>
    /** The world an invite code opens, or null: a join resolves the code before taking a chain. */
    rtFindWorldByInvite(inviteCode: string): Promise<string | null>
    /** RtRoom.open by default; a test swaps in a room that stalls. */
    openRoom?(id: string, deps: RtRoomDeps): Promise<RtRoom | null>
}

interface RtConn {
    socket: RtHubSocket
    user: RtHubUser
    bucket: RtTokenBucket
    closed: boolean
    /** The one room this socket is attached to, and the peer it is attached as. */
    room: RtRoom | null
    peer: RtRoomPeer | null
    /** Bumped by every open, so an older open that finishes late does not attach. */
    openSeq: number
    listing: boolean
    /** A stop or delete is in flight: one owner write per socket at a time, so a socket cannot queue database writes. */
    ownerBusy: boolean
}

/** Cooldowns keyed by user, so a reconnect does not reset them. */
interface RtUserState {
    openAt: number
    resyncAt: number
    createAt: number
    inviteFails: number[]
    lookups: number
    seenAt: number
}

/** A room's slice of the process step budget, with any overrun carried into the next window. */
interface RtBudgetShare {
    spent: number
    window: number
}

function statusOf(error: unknown): number | undefined {
    const code = (error as { statusCode?: unknown } | null)?.statusCode
    return typeof code === 'number' ? code : undefined
}

function messageOf(error: unknown): string {
    const message = error as { statusMessage?: unknown, message?: unknown } | null
    const text = message?.statusMessage ?? message?.message
    return typeof text === 'string' ? text : ''
}


const noop = () => {}

/**
 * The hub. connect hands it an authenticated socket, message a binary frame, disconnect the close.
 * Rooms are opened on demand, at most RT_MAX_LIVE_ROOMS at once, and share RT_STEP_BUDGET_MS of
 * stepping per 27 ms tick.
 */
export class RtHub {
    private readonly deps: RtHubDeps
    private readonly conns = new Map<RtHubSocket, RtConn>()
    private readonly byUser = new Map<string, RtConn>()
    private readonly users = new Map<string, RtUserState>()
    private readonly rooms = new Map<string, RtRoom>()
    private readonly chains = new Map<string, Promise<void>>()
    /** Rooms being opened right now, counted against the live-room cap. */
    private opening = 0
    /** Error unloads per world within RT_BROKEN_WINDOW_MS, and the worlds refused until restart. */
    private readonly errorUnloads = new Map<string, number[]>()
    private readonly broken = new Set<string>()
    /** Deleted worlds whose room may still try a checkpoint; refused so the room unloads without writing. */
    private readonly deleted = new Set<string>()
    private pendingCreates = 0
    private createTail: Promise<unknown> = Promise.resolve()
    private budgetWindow = -1
    private budgetSpent = 0
    private sweepHandle: unknown = null

    constructor(deps: RtHubDeps) {
        this.deps = deps
    }

    get peerCount(): number {
        return this.conns.size
    }

    get liveRoomCount(): number {
        return this.rooms.size
    }

    /** The live room of a world, if any (diagnostics and tests). */
    room(worldId: string): RtRoom | undefined {
        return this.liveRoom(worldId)
    }

    /* ---- sockets ---- */

    /**
     * Takes an authenticated socket and greets it with hello. A user's older socket is closed with
     * replaced and detached; above RT_MAX_PEERS the new one is closed as serverFull. False when refused.
     */
    connect(socket: RtHubSocket, user: RtHubUser): boolean {
        const previous = this.byUser.get(user.id)
        if (this.conns.size - (previous ? 1 : 0) >= RT_MAX_PEERS) {
            this.closeSocket(socket, RtCloseCode.serverFull, 'Server full')
            return false
        }
        if (previous) {
            this.drop(previous)
            this.closeSocket(previous.socket, RtCloseCode.replaced, 'Opened in another tab')
        }
        const conn: RtConn = {
            socket,
            user: { id: user.id, name: user.name },
            bucket: rtFullBucket(RT_SOCKET_MSG_BURST, this.deps.now()),
            closed: false,
            room: null,
            peer: null,
            openSeq: 0,
            listing: false,
            ownerBusy: false
        }
        this.conns.set(socket, conn)
        this.byUser.set(user.id, conn)
        this.userState(user.id)
        this.ensureSweep()
        this.send(conn, { type: 'hello', version: RT_PROTOCOL_VERSION, buildId: this.deps.buildId })
        return true
    }

    /** The socket closed: detach it from its room. */
    disconnect(socket: RtHubSocket): void {
        const conn = this.conns.get(socket)
        if (conn) this.drop(conn)
    }

    /** One binary frame from a socket. Never throws; a refused frame is answered with an error code. */
    message(socket: RtHubSocket, bytes: Uint8Array): void {
        const conn = this.conns.get(socket)
        if (!conn || conn.closed) return
        // a flood beyond the bucket is dropped unanswered, so it costs no sends
        if (!this.takeToken(conn)) return
        let msg: RtClientMsg | null
        try {
            msg = decodeClientMsg(bytes)
        } catch {
            msg = null
        }
        if (!msg) {
            this.refuse(conn, 'badRequest')
            return
        }
        this.userState(conn.user.id).seenAt = this.deps.now()
        this.route(conn, msg).catch((error) => {
            this.deps.log('error', `[rail-tycoon] hub ${msg.type} failed (${rtDescribeError(error)})`)
            this.refuse(conn, 'busy')
        })
    }

    /** Stops the sweep timer (tests and shutdown); live rooms are left as they are. */
    dispose(): void {
        if (this.sweepHandle !== null) this.deps.clearInterval(this.sweepHandle)
        this.sweepHandle = null
    }

    private drop(conn: RtConn): void {
        if (conn.closed) return
        conn.closed = true
        this.conns.delete(conn.socket)
        if (this.byUser.get(conn.user.id) === conn) this.byUser.delete(conn.user.id)
        this.leaveRoom(conn)
    }

    private closeSocket(socket: RtHubSocket, code: number, reason: string): void {
        try {
            socket.close(code, reason)
        } catch {
            // already gone
        }
    }

    private takeToken(conn: RtConn): boolean {
        return rtTakeToken(conn.bucket, this.deps.now(), RT_SOCKET_MSG_RATE, RT_SOCKET_MSG_BURST)
    }

    private userState(userId: string): RtUserState {
        let state = this.users.get(userId)
        if (!state) {
            state = { openAt: -Infinity, resyncAt: -Infinity, createAt: -Infinity, inviteFails: [], lookups: 0, seenAt: this.deps.now() }
            this.users.set(userId, state)
        }
        return state
    }

    /* ---- routing ---- */

    private async route(conn: RtConn, msg: RtClientMsg): Promise<void> {
        switch (msg.type) {
            case 'list':
                return this.list(conn)
            case 'create':
                return this.create(conn, msg)
            case 'join':
                return this.join(conn, msg.inviteCode)
            case 'open':
                return this.open(conn, msg.worldId, msg.inviteCode, msg.have)
            case 'loaded':
                if (conn.room && conn.peer && conn.room.id === msg.worldId) conn.room.loaded(conn.peer)
                return
            case 'command':
                if (!conn.room || !conn.peer) return this.refuse(conn, 'noAccess')
                conn.room.submit(conn.peer, msg.seq, msg.command)
                return
            case 'stop':
                return this.ownerWrite(conn, () => this.stop(conn, msg.worldId))
            case 'delete':
                return this.ownerWrite(conn, () => this.remove(conn, msg.worldId))
            case 'resync':
                return this.resync(conn, msg.worldId, msg.have)
            case 'ping':
                return this.send(conn, { type: 'pong', echo: msg.value })
            default: {
                const unknown: never = msg
                this.deps.log('warn', `[rail-tycoon] hub got unhandled message ${String(unknown)}`)
            }
        }
    }

    private async ownerWrite(conn: RtConn, action: () => Promise<void>): Promise<void> {
        if (conn.ownerBusy) return this.refuse(conn, 'busy')
        conn.ownerBusy = true
        try {
            await action()
        } finally {
            conn.ownerBusy = false
        }
    }

    /** The chooser's list. One list per socket at a time, so a socket cannot queue database reads. */
    private async list(conn: RtConn): Promise<void> {
        if (conn.listing) return this.refuse(conn, 'busy')
        conn.listing = true
        try {
            const rows = await this.deps.rtListWorldsForUser(conn.user.id)
            const worlds = rows.slice(0, RT_PROTOCOL_BOUNDS.worldList).map(rtWorldSummary)
            this.send(conn, { type: 'worldList', worlds })
        } finally {
            conn.listing = false
        }
    }

    /**
     * One create per user per RT_CREATE_COOLDOWN_MS (tooSoon), at most RT_MAX_PENDING_CREATES
     * queued (busy), and one generation at a time per process. A refused create generates nothing.
     */
    private async create(conn: RtConn, msg: Extract<RtClientMsg, { type: 'create' }>): Promise<void> {
        const state = this.userState(conn.user.id)
        const now = this.deps.now()
        if (now - state.createAt < RT_CREATE_COOLDOWN_MS) return this.refuse(conn, 'tooSoon')
        if (this.pendingCreates >= RT_MAX_PENDING_CREATES) return this.refuse(conn, 'busy')
        state.createAt = now
        this.pendingCreates++
        const job = () => this.deps.rtCreateWorld(conn.user.id, conn.user.name, msg.name, { side: msg.side, maxCompanies: msg.maxCompanies, sharing: msg.sharing, isPublic: msg.isPublic })
        const run = this.createTail.then(job, job)
        this.createTail = run.catch(noop)
        try {
            const created = await run
            this.send(conn, { type: 'joined', worldId: created.worldId })
        } catch (error) {
            this.refuse(conn, rtCreateError(error))
        } finally {
            this.pendingCreates--
        }
    }

    /**
     * Resolves the invite to a world first, then inside that world's chain joins the live room or
     * the stored row. Failed lookups are capped per user per minute, counting the ones in
     * flight, so a burst cannot run more than RT_INVITE_FAILS_PER_MINUTE lookups.
     */
    private async join(conn: RtConn, inviteCode: string): Promise<void> {
        const state = this.userState(conn.user.id)
        const now = this.deps.now()
        state.inviteFails = state.inviteFails.filter(at => now - at < RT_INVITE_FAIL_WINDOW_MS)
        if (state.inviteFails.length + state.lookups >= RT_INVITE_FAILS_PER_MINUTE) return this.refuse(conn, 'tooSoon')

        let worldId: string | null
        state.lookups++
        try {
            worldId = await this.deps.rtFindWorldByInvite(inviteCode)
        } finally {
            state.lookups--
        }
        if (worldId === null) {
            state.inviteFails.push(this.deps.now())
            return this.refuse(conn, 'badInvite')
        }

        const user = conn.user
        const outcome = await this.serial([worldId], async (): Promise<{ ok: true, worldId: string } | { ok: false, code: RtErrorCode }> => {
            const room = this.liveRoom(worldId)
            if (room) {
                const joined = await room.join(user.id, user.name)
                return joined.ok ? { ok: true, worldId } : joined
            }
            try {
                const joined = await this.deps.rtJoinWorld(user.id, user.name, inviteCode)
                return { ok: true, worldId: joined.worldId }
            } catch (error) {
                if (statusOf(error) === 404) state.inviteFails.push(this.deps.now())
                return { ok: false, code: rtJoinError(error) }
            }
        })
        if (outcome === TIMED_OUT) return this.refuse(conn, 'busy')
        if (!outcome.ok) return this.refuse(conn, outcome.code)
        // sent also when the user was a member already: the chooser opens the world either way
        this.send(conn, { type: 'joined', worldId: outcome.worldId })
    }

    /**
     * Opens a world for this socket: cooldown per user, broken worlds refused,
     * access from the registry, the socket's previous room left first and a peerless idle room
     * evicted at the live-room cap, all under the chains of every world involved.
     */
    private async open(conn: RtConn, worldId: string, inviteCode: string | null, have: readonly string[]): Promise<void> {
        const state = this.userState(conn.user.id)
        const now = this.deps.now()
        if (now - state.openAt < RT_OPEN_COOLDOWN_MS) return this.refuse(conn, 'tooSoon')
        state.openAt = now
        if (this.broken.has(worldId)) return this.refuse(conn, 'worldBroken')

        const seq = ++conn.openSeq
        const previous = conn.room && conn.room.id !== worldId ? conn.room.id : null
        const evictee = this.liveRoom(worldId) ? null : this.evictionCandidate(worldId, conn)
        const ids = [worldId]
        if (previous) ids.push(previous)
        if (evictee) ids.push(evictee.id)

        const outcome = await this.serial(ids, () => this.openInChain(conn, seq, worldId, inviteCode, have, evictee, ids))
        if (outcome === TIMED_OUT && !conn.closed && conn.openSeq === seq) this.refuse(conn, 'busy')
    }

    private async openInChain(
        conn: RtConn, seq: number, worldId: string, inviteCode: string | null, have: readonly string[], evictee: RtRoom | null, held: string[]
    ): Promise<void> {
        const current = () => !conn.closed && conn.openSeq === seq
        const access = await this.deps.rtGetAccess(conn.user.id, worldId, inviteCode ?? undefined)
        if (!current()) return
        if (access.role === 'none') return this.refuse(conn, 'noAccess')
        if (this.broken.has(worldId)) return this.refuse(conn, 'worldBroken')

        // one room per socket: leave the previous world (its leave checkpoint) before taking another
        if (conn.room && conn.room.id !== worldId) this.leaveRoom(conn)

        let room = this.liveRoom(worldId)
        if (!room) {
            if (this.rooms.size + this.opening >= RT_MAX_LIVE_ROOMS) {
                const victim = evictee && held.includes(evictee.id) && this.rooms.get(evictee.id) === evictee && evictee.peerCount === 0 ? evictee : null
                if (!victim) return this.refuse(conn, 'busy')
                await victim.unload()
                if (this.rooms.get(victim.id) === victim) {
                    if (!victim.isUnloaded) return this.refuse(conn, 'busy')
                    this.rooms.delete(victim.id)
                }
                if (!current()) return
                if (this.rooms.size + this.opening >= RT_MAX_LIVE_ROOMS) return this.refuse(conn, 'busy')
            }
            this.opening++
            let opened: RtRoom | null
            try {
                opened = await (this.deps.openRoom ?? RtRoom.open)(worldId, this.roomDeps())
            } finally {
                this.opening--
            }
            // the row is there (access said so), so a room that does not open is a save that does not load
            if (!opened) return this.refuse(conn, 'worldBroken')
            this.rooms.set(worldId, opened)
            this.ensureSweep()
            room = opened
            // a peerless room is left for the idle sweep
            if (!current()) return
        }

        const peer = conn.room === room && conn.peer ? conn.peer : this.peerFor(conn, room)
        conn.room = room
        conn.peer = peer
        if (!room.attach(peer, conn.user.id, access, have)) {
            conn.room = null
            conn.peer = null
        }
    }

    /**
     * At the live-room cap, the room to unload for an open of a world that is not live: the peerless
     * room idle longest, else the socket's own previous room when this socket is its only peer.
     */
    private evictionCandidate(exceptId: string, conn: RtConn): RtRoom | null {
        if (this.rooms.size + this.opening < RT_MAX_LIVE_ROOMS) return null
        let best: RtRoom | null = null
        for (const room of this.rooms.values()) {
            if (room.id === exceptId || room.isUnloaded || room.peerCount > 0 || room.idleSince === null) continue
            if (!best || room.idleSince < best.idleSince!) best = room
        }
        if (best) return best
        const own = conn.room
        return own && own.id !== exceptId && !own.isUnloaded && own.peerCount === 1 ? own : null
    }

    /** The owner's stop: a live room stops itself (checkpoint, close, read-only); otherwise the row closes. */
    private async stop(conn: RtConn, worldId: string): Promise<void> {
        const user = conn.user
        const outcome = await this.serial([worldId], async (): Promise<RtErrorCode | null> => {
            const room = this.liveRoom(worldId)
            if (room) {
                if (room.ownerId !== user.id) return this.ownerRefusal(user.id, worldId)
                const stopped = await room.stop(user.id)
                return stopped.ok ? null : stopped.code
            }
            try {
                await this.deps.rtCloseWorld(user.id, worldId)
                return null
            } catch (error) {
                return this.ownerWriteError(user.id, worldId, error)
            }
        })
        if (outcome === TIMED_OUT) return this.refuse(conn, 'busy')
        if (outcome !== null) return this.refuse(conn, outcome)
        // the chooser sees the closed world; peers of a live room got worldClosed from it
        await this.list(conn)
    }

    /**
     * Delete: the registry deletes the row first, as the owner only; only then is a live room
     * unloaded, its peers told worldDeleted before they are detached, and nothing more is written.
     */
    private async remove(conn: RtConn, worldId: string): Promise<void> {
        const user = conn.user
        const outcome = await this.serial([worldId], async (): Promise<RtErrorCode | null> => {
            try {
                await this.deps.rtDeleteWorld(user.id, worldId)
            } catch (error) {
                return this.ownerWriteError(user.id, worldId, error)
            }
            this.deleted.add(worldId)
            this.errorUnloads.delete(worldId)
            this.broken.delete(worldId)
            const room = this.rooms.get(worldId)
            let told = false
            for (const other of this.conns.values()) {
                if (!room || other.room !== room) continue
                this.send(other, { type: 'worldDeleted', worldId })
                if (other === conn) told = true
                // detached from the hub first, so nothing the room sends while unloading reaches them
                other.room = null
                other.peer = null
            }
            if (!told) this.send(conn, { type: 'worldDeleted', worldId })
            if (room) {
                this.rooms.delete(worldId)
                try {
                    await room.unload()
                } catch (error) {
                    this.deps.log('warn', `[rail-tycoon] deleted world ${JSON.stringify(worldId)} unload failed (${rtDescribeError(error)})`)
                }
            }
            this.deleted.delete(worldId)
            return null
        })
        if (outcome === TIMED_OUT) return this.refuse(conn, 'busy')
        if (outcome !== null) return this.refuse(conn, outcome)
    }

    /**
     * A fresh snapshot built by the room at its tick boundary, once per RT_RESYNC_COOLDOWN_MS per user,
     * with only the parts the client's own hashes (`have`) do not match.
     */
    private resync(conn: RtConn, worldId: string, have: readonly string[]): void {
        if (!conn.room || !conn.peer || conn.room.id !== worldId) return this.refuse(conn, 'noAccess')
        const state = this.userState(conn.user.id)
        const now = this.deps.now()
        if (now - state.resyncAt < RT_RESYNC_COOLDOWN_MS) return this.refuse(conn, 'tooSoon')
        state.resyncAt = now
        conn.room.resync(conn.peer, have)
    }

    /* ---- error codes ---- */

    /** notOwner for someone who may see the world, noAccess for a stranger, so a stranger learns nothing. */
    private async ownerRefusal(userId: string, worldId: string): Promise<RtErrorCode> {
        try {
            const access = await this.deps.rtGetAccess(userId, worldId)
            return access.role === 'none' ? 'noAccess' : 'notOwner'
        } catch {
            return 'noAccess'
        }
    }

    private async ownerWriteError(userId: string, worldId: string, error: unknown): Promise<RtErrorCode> {
        const status = statusOf(error)
        if (status === 403) return this.ownerRefusal(userId, worldId)
        if (status === 404) return 'noAccess'
        if (status === 409) return /closed/i.test(messageOf(error)) ? 'worldClosed' : 'noAccess'
        this.deps.log('error', `[rail-tycoon] world ${JSON.stringify(worldId)} owner write failed (${rtDescribeError(error)})`)
        return 'busy'
    }

    /* ---- rooms ---- */

    private liveRoom(worldId: string): RtRoom | undefined {
        const room = this.rooms.get(worldId)
        if (room?.isUnloaded) {
            this.forget(room)
            return undefined
        }
        return room
    }

    private forget(room: RtRoom): void {
        if (this.rooms.get(room.id) === room) this.rooms.delete(room.id)
        for (const conn of this.conns.values()) {
            if (conn.room !== room) continue
            conn.room = null
            conn.peer = null
        }
    }

    private leaveRoom(conn: RtConn): void {
        const room = conn.room
        const peer = conn.peer
        conn.room = null
        conn.peer = null
        if (room && peer) room.detach(peer)
    }

    /** A peer bound to one socket and one room: frames from a room the socket has left are dropped. */
    private peerFor(conn: RtConn, room: RtRoom): RtRoomPeer {
        return {
            send: (frame) => {
                if (conn.closed || conn.room !== room) return
                conn.socket.send(frame)
            }
        }
    }

    private roomDeps(): RtRoomDeps {
        const d = this.deps
        const share: RtBudgetShare = { spent: 0, window: -1 }
        return {
            rtLoadWorld: id => d.rtLoadWorld(id),
            rtSaveCheckpoint: (id, parts, tick, expectedRevision, now, options) => {
                // a deleted world's room unloads through its conflict path, writing nothing
                if (this.deleted.has(id)) return Promise.reject(Object.assign(new Error('World was deleted'), { statusCode: 409 }))
                return d.rtSaveCheckpoint(id, parts, tick, expectedRevision, now, options)
            },
            rtCloseWorld: (userId, worldId) => d.rtCloseWorld(userId, worldId),
            rtGetAccess: (userId, worldId) => d.rtGetAccess(userId, worldId),
            now: () => d.now(),
            ...(d.perfNow ? { perfNow: () => d.perfNow!() } : {}),
            setInterval: (callback, ms) => d.setInterval(callback, ms),
            clearInterval: handle => d.clearInterval(handle),
            setTimeout: (callback, ms) => d.setTimeout(callback, ms),
            clearTimeout: handle => d.clearTimeout(handle),
            log: (level, message) => d.log(level, message),
            ...(d.encodeWorldParts ? { encodeWorldParts: world => d.encodeWorldParts!(world) } : {}),
            onUnload: (room, reason) => this.roomUnloaded(room, reason),
            onIdle: () => this.ensureSweep(),
            stepBudget: this.budgetFor(share)
        }
    }

    /** A world whose room fails with an exception RT_BROKEN_UNLOADS times in the window is refused until restart. */
    private roomUnloaded(room: RtRoom, reason: RtUnloadReason): void {
        this.forget(room)
        if (reason !== 'error' || this.deleted.has(room.id)) return
        const now = this.deps.now()
        const recent = (this.errorUnloads.get(room.id) ?? []).filter(at => now - at < RT_BROKEN_WINDOW_MS)
        recent.push(now)
        this.errorUnloads.set(room.id, recent)
        if (recent.length >= RT_BROKEN_UNLOADS && !this.broken.has(room.id)) {
            this.broken.add(room.id)
            this.deps.log('error', `[rail-tycoon] world ${JSON.stringify(room.id)} is broken: ${recent.length} error unloads, last at tick ${room.world.tick}; refused until restart`)
        }
    }

    /**
     * RT_STEP_BUDGET_MS per 27 ms window for the whole process, split evenly among running
     * rooms. A step that runs over is charged to the next window, so the long-run sum stays within it.
     */
    private budgetFor(share: RtBudgetShare): RtStepBudget {
        const roll = () => {
            const window = Math.floor(this.deps.now() / TICK_MS)
            if (window !== this.budgetWindow) {
                const elapsed = this.budgetWindow < 0 ? 1 : window - this.budgetWindow
                this.budgetSpent = Math.max(0, this.budgetSpent - RT_STEP_BUDGET_MS * elapsed)
                this.budgetWindow = window
            }
            if (window !== share.window) {
                const elapsed = share.window < 0 ? 1 : window - share.window
                share.spent = Math.max(0, share.spent - this.perRoomBudget() * elapsed)
                share.window = window
            }
        }
        return {
            remainingMs: () => {
                roll()
                return Math.min(RT_STEP_BUDGET_MS - this.budgetSpent, this.perRoomBudget() - share.spent)
            },
            spend: (ms) => {
                roll()
                const cost = Math.max(0, ms)
                this.budgetSpent += cost
                share.spent += cost
            }
        }
    }

    private perRoomBudget(): number {
        let running = 0
        for (const room of this.rooms.values()) if (room.isRunning) running++
        return RT_STEP_BUDGET_MS / Math.max(1, running)
    }

    /* ---- sweep: idle rooms and stale user state ---- */

    private ensureSweep(): void {
        if (this.sweepHandle === null) this.sweepHandle = this.deps.setInterval(() => this.sweep(), RT_SWEEP_MS)
    }

    private sweep(): void {
        const now = this.deps.now()
        for (const room of [...this.rooms.values()]) {
            if (room.isUnloaded) {
                this.forget(room)
                continue
            }
            if (room.peerCount > 0 || room.idleSince === null || now - room.idleSince < RT_ROOM_IDLE_MS) continue
            this.serial([room.id], async () => {
                if (this.rooms.get(room.id) !== room || room.peerCount > 0) return
                await room.unload()
                if (room.isUnloaded) this.forget(room)
            }).catch(error => this.deps.log('warn', `[rail-tycoon] idle unload of ${JSON.stringify(room.id)} failed (${rtDescribeError(error)})`))
        }
        for (const [userId, state] of this.users) {
            if (!this.byUser.has(userId) && state.lookups === 0 && now - state.seenAt > RT_USER_STATE_TTL_MS) this.users.delete(userId)
        }
        for (const [worldId, times] of this.errorUnloads) {
            if (times.every(at => now - at >= RT_BROKEN_WINDOW_MS)) this.errorUnloads.delete(worldId)
        }
        if (this.rooms.size === 0 && this.conns.size === 0 && this.users.size === 0) this.dispose()
    }

    /* ---- per-world chains ---- */

    /**
     * Runs job holding the chain of every world in ids, taken in ascending id order. Each wait and the
     * job are bounded by RT_CHAIN_TIMEOUT_MS; past it the chain is released and TIMED_OUT returned.
     */
    private serial<T>(ids: string[], job: () => Promise<T>): Promise<T | RtTimedOut> {
        const sorted = [...new Set(ids)].sort()
        const run = (index: number): Promise<T | RtTimedOut> => {
            if (index === sorted.length) return job()
            return this.serialOne(sorted[index]!, () => run(index + 1))
        }
        return run(0)
    }

    private async serialOne<T>(worldId: string, job: () => Promise<T | RtTimedOut>): Promise<T | RtTimedOut> {
        const previous = this.chains.get(worldId) ?? Promise.resolve()
        let release!: () => void
        const mine = new Promise<void>((resolve) => {
            release = resolve
        })
        const tail = previous.then(() => mine)
        this.chains.set(worldId, tail)
        tail.then(() => {
            if (this.chains.get(worldId) === tail) this.chains.delete(worldId)
        }, noop)
        try {
            if (await this.within(previous, RT_CHAIN_TIMEOUT_MS) === TIMED_OUT) return TIMED_OUT
            const work = job()
            work.catch(noop)
            return await this.within(work, RT_CHAIN_TIMEOUT_MS)
        } finally {
            release()
        }
    }

    private within<T>(promise: Promise<T>, ms: number): Promise<T | RtTimedOut> {
        let handle: unknown = null
        const timer = new Promise<RtTimedOut>((resolve) => {
            handle = this.deps.setTimeout(() => resolve(TIMED_OUT), ms)
        })
        return Promise.race([promise, timer]).finally(() => this.deps.clearTimeout(handle))
    }

    /* ---- frames ---- */

    private refuse(conn: RtConn, code: RtErrorCode): void {
        this.send(conn, { type: 'error', code })
    }

    private send(conn: RtConn, msg: RtServerMsg): void {
        if (conn.closed) return
        let frame: Uint8Array
        try {
            frame = encodeServerMsg(msg)
        } catch (error) {
            this.deps.log('error', `[rail-tycoon] hub ${msg.type} frame cannot be encoded (${rtDescribeError(error)})`)
            return
        }
        try {
            conn.socket.send(frame)
        } catch (error) {
            this.deps.log('warn', `[rail-tycoon] hub send failed (${rtDescribeError(error)})`)
        }
    }
}

/** A registry listing as the wire carries it. */
function rtWorldSummary(row: RtWorldListing): RtWorldSummary {
    const companies = RT_PROTOCOL_BOUNDS.companies
    return {
        id: row.id,
        name: row.name,
        status: row.status,
        isOwner: row.isOwner,
        memberCount: Math.min(companies, Math.max(0, row.memberCount)),
        maxCompanies: row.maxCompanies,
        myCompanyId: row.myCompanyId,
        lastActiveAt: Math.max(0, Math.floor(row.lastActiveAt.getTime())),
        inviteCode: row.inviteCode,
        isPublic: row.isPublic
    }
}

/** rtCreateWorld's refusals as protocol codes: 400 bad input, 409 an owner cap. */
function rtCreateError(error: unknown): RtErrorCode {
    const status = statusOf(error)
    if (status === 400) return 'badRequest'
    if (status === 409) return 'atCap'
    return 'busy'
}

/** rtJoinWorld's refusals as protocol codes. */
function rtJoinError(error: unknown): RtErrorCode {
    const status = statusOf(error)
    if (status === 400) return 'badRequest'
    if (status === 404) return 'badInvite'
    if (status === 409) return /closed/i.test(messageOf(error)) ? 'worldClosed' : 'worldFull'
    if (status === 500) return 'worldBroken'
    return 'busy'
}

/** The world behind an invite code, or null; an index lookup that reads nothing else. */
export async function rtFindWorldByInvite(inviteCode: string): Promise<string | null> {
    if (!isRtInviteCode(inviteCode)) return null
    const [row] = await db.select({ id: railTycoonWorlds.id })
        .from(railTycoonWorlds)
        .where(eq(railTycoonWorlds.inviteCode, inviteCode))
    return row?.id ?? null
}

let rtHub: RtHub | null = null

/** The process's hub, wired to the real registry, store and timers. */
export function useRtHub(): RtHub {
    if (!rtHub) {
        rtHub = new RtHub({
            buildId: useRuntimeConfig().app.buildId,
            rtListWorldsForUser,
            rtCreateWorld,
            rtJoinWorld,
            rtGetAccess,
            rtCloseWorld: (userId, worldId) => rtCloseWorld(userId, worldId),
            rtDeleteWorld: (userId, worldId) => rtDeleteWorld(userId, worldId),
            rtFindWorldByInvite,
            rtLoadWorld: id => rtLoadWorld(id),
            rtSaveCheckpoint: (id, bytes, tick, expectedRevision, now, options) => rtSaveCheckpoint(id, bytes, tick, expectedRevision, now, options ?? {}),
            now: () => Date.now(),
            perfNow: () => performance.now(),
            setInterval: (callback, ms) => setInterval(callback, ms),
            clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
            setTimeout: (callback, ms) => setTimeout(callback, ms),
            clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
            log: (level, message) => console[level](message)
        })
    }
    return rtHub
}
