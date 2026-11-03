// Rail Tycoon live room: one world in memory, stepped every 27 ms only while a player is attached.
// A deploy drops every socket and the room is rebuilt from its last checkpoint, so at most
// RT_CHECKPOINT_MS (2 minutes) of play is lost.
import { promisify } from 'node:util'
import { gzip, gzipSync } from 'node:zlib'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import {
    applyCommand,
    decodeCommand,
    encodeCommand,
    RT_SERVER_COMPANY,
    RtCommandKind,
    type RtCommand,
    type RtCommandResult
} from '#shared/utils/rail-tycoon/commands'
import {
    RT_CHECKPOINT_MS,
    RT_GUNZIP_MAX_BYTES,
    RT_HASH_EVERY,
    RT_INPUT_DELAY,
    RT_JOIN_LOAD_TIMEOUT_MS,
    RT_JOIN_PAUSE_BUDGET_WINDOW_MS,
    RT_JOIN_PAUSE_SHARE_PERCENT,
    RT_JOIN_PAUSE_WINDOW_MS,
    RT_LIVE_JOIN_TIMEOUT_MS,
    RT_MAX_SAVE_BYTES,
    RT_PART_FRAGMENT_BYTES,
    RT_ROOM_CMD_BURST,
    RT_ROOM_CMD_RATE
} from '#shared/utils/rail-tycoon/limits'
import {
    encodeServerMsg,
    RT_PROTOCOL_BOUNDS,
    type RtErrorCode,
    type RtPauseReason,
    type RtRole,
    type RtServerMsg,
    type RtSnapshotHead,
    type RtStampedCommand,
    type RtUnloadReason
} from '#shared/utils/rail-tycoon/protocol'
import { decodeWorldPartsOrThrow, encodeWorldParts, rtPartHash, type RtWorldParts } from '#shared/utils/rail-tycoon/save'
import { RT_NONE } from '#shared/utils/rail-tycoon/types'
import type { RtWorld } from '#shared/utils/rail-tycoon/world'
import type { RtAccess, RtWorldStatus } from './registry'
import type { RtLoadedWorld } from './store'

const rtGzip = promisify(gzip)

const TICK_MS = RT_CATALOG.time.tickMs
/** Wall-clock debt a late timer may carry, and the most steps one callback runs. */
const MAX_DEBT_MS = 250
const MAX_STEPS_PER_CALLBACK = 4

/** One socket attached to the room. send must queue frames in call order. */
export interface RtRoomPeer {
    send(frame: Uint8Array): void
}

/** What open needs from storage: the loaded world plus the invite code an owner or player is shown. */
export type RtRoomLoad = RtLoadedWorld & { inviteCode: string }

/** The process step-time budget the hub shares among live rooms. */
export interface RtStepBudget {
    /** Milliseconds this room may still spend stepping in the current hub tick. */
    remainingMs(): number
    spend(ms: number): void
}

/** Everything the room touches outside itself, injected so tests drive it with fakes. */
export interface RtRoomDeps {
    rtLoadWorld(id: string): Promise<RtRoomLoad | null>
    rtSaveCheckpoint(
        id: string,
        parts: RtWorldParts,
        tick: number,
        expectedRevision: number,
        now: Date,
        options?: { member?: { userId: string, companyId: number } }
    ): Promise<number>
    rtCloseWorld(userId: string, worldId: string): Promise<unknown>
    /** Membership lookup for join: a player answer means the user already has a company here. */
    rtGetAccess(userId: string, worldId: string): Promise<RtAccess>
    /** Wall clock in ms. */
    now(): number
    /** High-resolution clock for measuring step time; performance.now by default. */
    perfNow?(): number
    setInterval(callback: () => void, ms: number): unknown
    clearInterval(handle: unknown): void
    setTimeout(callback: () => void, ms: number): unknown
    clearTimeout(handle: unknown): void
    log(level: 'error' | 'warn' | 'info', message: string): void
    /** The room stopped for good on a failure; the hub drops it and the next open reloads the stored row. */
    onUnload(room: RtRoom, reason: RtUnloadReason): void
    /** The last player left and the leave checkpoint is written; the hub unloads after RT_ROOM_IDLE_MS without peers. */
    onIdle?(room: RtRoom): void
    stepBudget: RtStepBudget
    /** encodeWorldParts by default; a test swaps it to prove the writer's checks. */
    encodeWorldParts?(world: RtWorld): RtWorldParts
}

export type RtRoomRefusal = { ok: false, code: RtErrorCode }
export type RtJoinOutcome = { ok: true, companyId: number, existing: boolean } | RtRoomRefusal
export type RtStopOutcome = { ok: true } | RtRoomRefusal

interface RtPeerState {
    userId: string
    role: RtRole
    company: number | null
    /** This peer's load holds the room's join pause. */
    pausing: boolean
    loadTimer: unknown
}

interface RtQueued {
    stamped: RtStampedCommand
    /** The canonical decode of stamped.command, applied at stamped.tick. */
    command: RtCommand
    onApplied?: (result: RtCommandResult) => void
    onDropped?: (error: Error) => void
}

type RtCheckpointReason = 'periodic' | 'leave' | 'stop' | 'join' | 'unload'

interface RtCheckpointJob {
    parts: RtWorldParts
    tick: number
    hash: number
    mutation: number
    member?: { userId: string, companyId: number }
    waiters: { resolve: (revision: number) => void, reject: (error: unknown) => void }[]
}

/** The world's parts at one tick boundary, with each part's gzip made when first sent. */
interface RtSnapshotCache {
    tick: number
    mutation: number
    parts: RtWorldParts
    hashes: string[]
    /** gzip by part hash; a part unchanged since the last snapshot keeps its compression. */
    zipped: Map<string, Uint8Array>
}

const noop = () => {}

function statusCodeOf(error: unknown): number | undefined {
    const code = (error as { statusCode?: unknown } | null)?.statusCode
    return typeof code === 'number' ? code : undefined
}

function describe(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : 'non-error thrown'
}

/**
 * A live world. The hub owns sockets, access and per-world serialization; the room owns
 * the authoritative world, the stamped command queue, pausing, and the single checkpoint writer.
 * Tick boundary convention: processing tick T applies every command stamped T in stamp
 * order, then steps to T + 1; the hash for T + 1 is taken right after that step.
 */
export class RtRoom {
    readonly id: string
    readonly ownerId: string
    private readonly deps: RtRoomDeps
    private readonly inviteCode: string
    private readonly room: RtWorld
    private status: RtWorldStatus
    private revisionNow: number

    private readonly peers = new Map<RtRoomPeer, RtPeerState>()
    private queue: RtQueued[] = []
    private readonly buckets = new Map<string, { tokens: number, at: number }>()

    private running = false
    private intervalHandle: unknown = null
    private lastNow = 0
    private debt = 0
    /** While pausing, the room keeps stepping until every command queued up to this tick has executed. */
    private drainTarget: number | null = null
    private stopped = false
    private failed = false
    private disposed = false
    /** unload is writing its checkpoint: attach refuses until it finished or failed. */
    private unloading = false
    private joining = false
    private leaveCheckpointDue = false
    private idleSinceMs: number | null

    /** Bumped by every world change outside a step: the snapshot cache key. */
    private mutation = 0
    private snapshotCache: RtSnapshotCache | null = null

    private joinPausePeer: RtPeerState | null = null
    private readonly joinPauses: { start: number, end: number | null }[] = []
    private readonly userPausedAt = new Map<string, number>()

    private pendingJobs: RtCheckpointJob[] = []
    private writing = false
    /** Set from a join's foundCompany until its member checkpoint is queued: no save may hold the company without its member row. */
    private holdWrites = false
    private lastCheckpointAt: number
    private savedTick: number
    private savedMutation = 0
    private idleWaiters: (() => void)[] = []

    private constructor(load: RtRoomLoad, deps: RtRoomDeps) {
        this.id = load.id
        this.ownerId = load.ownerId
        this.inviteCode = load.inviteCode
        this.status = load.status
        this.revisionNow = load.revision
        this.room = load.world
        this.deps = deps
        this.lastCheckpointAt = deps.now()
        this.savedTick = load.world.tick
        this.idleSinceMs = deps.now()
    }

    /**
     * The world exactly as saved, paused with no peers. Time it was away is never simulated:
     * it ticks only once a player attaches. Null when the row is missing or does not load.
     */
    static async open(id: string, deps: RtRoomDeps): Promise<RtRoom | null> {
        const load = await deps.rtLoadWorld(id)
        if (!load) return null
        return new RtRoom(load, deps)
    }

    get world(): RtWorld {
        return this.room
    }

    get revision(): number {
        return this.revisionNow
    }

    get worldStatus(): RtWorldStatus {
        return this.stopped ? 'closed' : this.status
    }

    get isRunning(): boolean {
        return this.running
    }

    /** True once the room failed or was unloaded; the hub must drop it. */
    get isUnloaded(): boolean {
        return this.failed || this.disposed
    }

    get peerCount(): number {
        return this.peers.size
    }

    get playerCount(): number {
        let players = 0
        for (const state of this.peers.values()) if (state.role === 'player') players++
        return players
    }

    /** When the last peer left (wall ms), or null while any peer is attached. */
    get idleSince(): number | null {
        return this.idleSinceMs
    }

    /* ---- Attach, loaded, resync ---- */

    /**
     * Adds a peer with the role rtGetAccess gave it, sending opened (the snapshot head at this tick
     * boundary), the parts whose hash differs from `have` (what the client holds from an earlier
     * visit) and snapshotEnd with every queued stamped command, before anything else. A player's load
     * pauses the room within the join-pause limits. Returns false, after sending the peer an error,
     * when the room cannot take it.
     */
    attach(peer: RtRoomPeer, userId: string, access: RtAccess, have: readonly string[] = []): boolean {
        if (this.isUnloaded || this.unloading) return this.refusePeer(peer, 'busy')
        if (access.role === 'none') return this.refusePeer(peer, 'noAccess')
        const previous = this.peers.get(peer)
        if (previous) {
            // a reopen from the same socket: the player never left, so no leave checkpoint is written
            this.peers.delete(peer)
            if (previous.pausing) this.endJoinPause(previous, false)
        }

        let role: RtRole = 'spectator'
        let company: number | null = null
        if (access.role === 'player' && this.worldStatus === 'open') {
            if (this.room.company(access.companyId)) {
                role = 'player'
                company = access.companyId
            } else {
                this.deps.log('warn', `[rail-tycoon] world ${JSON.stringify(this.id)} has no company ${access.companyId} for a member; attached as spectator`)
            }
        }
        const owner = userId === this.ownerId
        let frames: Uint8Array[]
        try {
            frames = this.snapshotFrames(head => ({
                type: 'opened',
                worldId: this.id,
                role,
                owner,
                company,
                inviteCode: role === 'player' || owner ? this.inviteCode : null,
                ...head
            }), have)
        } catch (error) {
            this.deps.log('error', `[rail-tycoon] world ${JSON.stringify(this.id)} snapshot at tick ${this.room.tick} cannot be sent (${describe(error)})`)
            return this.refusePeer(peer, 'worldBroken')
        }

        const state: RtPeerState = { userId, role, company, pausing: false, loadTimer: null }
        this.peers.set(peer, state)
        this.idleSinceMs = null
        for (const frame of frames) this.sendTo(peer, frame)
        if (role === 'player') this.startJoinPause(state)
        const wasRunning = this.running
        this.update()
        // a pause that began just now was broadcast to this peer already
        if (!this.running && !wasRunning) this.sendTo(peer, encodeServerMsg({ type: 'paused', reason: this.pauseReason() }))
        return true
    }

    /** The client decoded its snapshot: a join pause it held ends. */
    loaded(peer: RtRoomPeer): void {
        const state = this.peers.get(peer)
        if (state?.pausing) this.endJoinPause(state, false)
    }

    /**
     * A fresh snapshot with every queued command, built at this tick boundary: only the parts whose
     * hash differs from `have`, the hashes of the client's own world. The hub applies the cooldown.
     */
    resync(peer: RtRoomPeer, have: readonly string[] = []): boolean {
        if (this.isUnloaded || !this.peers.has(peer)) return false
        this.sendResync(peer, have)
        return true
    }

    /* ---- Detach ---- */

    /** Removes a peer. The last player leaving pauses after the queued commands ran, then checkpoints. */
    detach(peer: RtRoomPeer): void {
        const state = this.peers.get(peer)
        if (!state) return
        this.peers.delete(peer)
        if (this.peers.size === 0) this.idleSinceMs = this.deps.now()
        if (state.pausing) this.endJoinPause(state, false)
        if (this.isUnloaded) return
        if (state.role === 'player' && this.playerCount === 0 && this.worldStatus === 'open') {
            this.leaveCheckpointDue = true
            this.requestDrain()
        }
        this.update()
        if (this.leaveCheckpointDue && !this.running) this.leaveCheckpoint()
    }

    /* ---- Submit ---- */

    /**
     * A player's command: intent only. The company is the peer's membership and the tick is the
     * room's; the server's apply decides cost and every rule (Michael, 2026-10-29). A refusal changes
     * nothing and is answered to the sender only; an accepted command is stamped for
     * world.tick + RT_INPUT_DELAY and broadcast to every peer, the sender included.
     */
    submit(peer: RtRoomPeer, seq: number, command: RtCommand): boolean {
        const state = this.peers.get(peer)
        if (!state) return this.refusePeer(peer, 'noAccess')
        if (this.isUnloaded || this.worldStatus !== 'open') return this.refusePeer(peer, 'worldClosed')
        if (state.role !== 'player' || state.company === null) return this.refusePeer(peer, 'notPlayer')
        if (!this.takeToken(state.userId)) return this.refusePeer(peer, 'rateLimited')
        if (!Number.isInteger(seq) || seq < 0 || seq > 255) return this.refusePeer(peer, 'badRequest')
        const canonical = this.canonical(command)
        if (!canonical) return this.refusePeer(peer, 'badRequest')
        if (this.queue.length >= RT_PROTOCOL_BOUNDS.pending) return this.refusePeer(peer, 'busy')

        // the dry run is charged to the step budget; a depot search costs a pathfinder run, so it waits for budget
        if (canonical.command.kind === RtCommandKind.sendToDepot && this.deps.stepBudget.remainingMs() <= 0) return this.refusePeer(peer, 'busy')
        const perfNow = this.deps.perfNow ?? (() => performance.now())
        const started = perfNow()
        const check = applyCommand(this.room, state.company, canonical.command, false)
        this.deps.stepBudget.spend(perfNow() - started)
        if (!check.ok) {
            this.sendTo(peer, encodeServerMsg({ type: 'result', seq, error: check.error }))
            return false
        }
        const stamped: RtStampedCommand = { tick: this.room.tick + RT_INPUT_DELAY, company: state.company, command: canonical.bytes }
        this.enqueue({ stamped, command: canonical.command })
        this.broadcast({ type: 'command', ...stamped })
        return true
    }

    /* ---- The tick ---- */

    /**
     * One timer callback: wall-clock debt (capped at 0.25 s) buys at most 4 steps and never more than
     * the hub's step budget; each step applies its tick's commands first. A frame allowance follows the
     * steps, a hash every RT_HASH_EVERY ticks, a checkpoint every RT_CHECKPOINT_MS. A throwing step
     * unloads the room without writing the mutated world.
     */
    tickOnce(): void {
        if (!this.running || this.isUnloaded) return
        this.update()
        if (!this.running) return
        const now = this.deps.now()
        this.debt = Math.min(this.debt + Math.max(0, now - this.lastNow), MAX_DEBT_MS)
        this.lastNow = now
        const perfNow = this.deps.perfNow ?? (() => performance.now())

        let steps = 0
        while (this.debt >= TICK_MS && steps < MAX_STEPS_PER_CALLBACK) {
            if (!this.wantRun() && (this.drainTarget === null || this.room.tick > this.drainTarget)) break
            if (this.deps.stepBudget.remainingMs() <= 0) break
            const started = perfNow()
            try {
                this.processTick()
            } catch (error) {
                this.deps.log('error', `[rail-tycoon] world ${JSON.stringify(this.id)} step at tick ${this.room.tick} threw (${describe(error)})`)
                this.fail('error')
                return
            }
            this.deps.stepBudget.spend(perfNow() - started)
            this.debt -= TICK_MS
            steps++
        }
        if (steps > 0) this.broadcast({ type: 'allowance', tick: this.room.tick })
        this.update()
        if (this.running && now - this.lastCheckpointAt >= RT_CHECKPOINT_MS) this.checkpoint('periodic').catch(noop)
    }

    /**
     * The room's single checkpoint writer. Encodes synchronously at this tick boundary and
     * queues the write; one write is in flight at a time, a request made meanwhile waits and then
     * writes the latest bytes with the revision that write returned, and a periodic request is dropped
     * while any write is in flight. Resolves with the new revision.
     */
    checkpoint(reason: RtCheckpointReason, member?: { userId: string, companyId: number }): Promise<number> {
        if (this.isUnloaded) return Promise.reject(new Error(`world ${this.id} room is unloaded`))
        this.lastCheckpointAt = this.deps.now()
        if (reason === 'periodic' && (this.writing || this.pendingJobs.length > 0 || this.holdWrites)) return Promise.resolve(this.revisionNow)

        let parts: RtWorldParts
        try {
            parts = this.encode()
        } catch (error) {
            this.deps.log('error', `[rail-tycoon] world ${JSON.stringify(this.id)} does not encode at tick ${this.room.tick} (${describe(error)})`)
            this.fail('error')
            return Promise.reject(error)
        }
        const job: RtCheckpointJob = { parts, tick: this.room.tick, hash: this.room.hash(), mutation: this.mutation, member, waiters: [] }
        const done = new Promise<number>((resolve, reject) => job.waiters.push({ resolve, reject }))
        const last = this.pendingJobs.at(-1)
        if (last && !(last.member && member)) {
            // the newer parts hold everything the older ones did, a join's company included
            last.parts = job.parts
            last.tick = job.tick
            last.hash = job.hash
            last.mutation = job.mutation
            last.member = last.member ?? member
            last.waiters.push(...job.waiters)
        } else {
            this.pendingJobs.push(job)
        }
        if (member) this.holdWrites = false
        this.pump()
        return done
    }

    /* ---- Stop ---- */

    /** The owner's stop: checkpoint, close the row, and leave every peer watching a read-only world. */
    async stop(userId: string): Promise<RtStopOutcome> {
        if (this.isUnloaded) return { ok: false, code: 'busy' }
        if (userId !== this.ownerId) return { ok: false, code: 'notOwner' }
        if (this.worldStatus !== 'open') return { ok: false, code: 'worldClosed' }
        if (this.joining) return { ok: false, code: 'busy' }

        const wasRunning = this.running
        this.stopped = true
        this.stopTicking(false)
        // stamped commands past the last allowance never execute anywhere: no peer may step beyond it
        for (const entry of this.queue) entry.onDropped?.(new Error('world stopped'))
        this.queue = []
        this.mutation++
        for (const state of this.peers.values()) if (state.pausing) this.endJoinPause(state, false)
        if (wasRunning) this.broadcast({ type: 'paused', reason: 'closed' })

        try {
            await this.checkpoint('stop')
            await this.deps.rtCloseWorld(userId, this.id)
        } catch (error) {
            if (!this.isUnloaded) {
                this.deps.log('error', `[rail-tycoon] world ${JSON.stringify(this.id)} stop failed at tick ${this.room.tick} (${describe(error)})`)
                this.fail('error')
            }
            return { ok: false, code: 'busy' }
        }
        this.status = 'closed'
        for (const state of this.peers.values()) {
            state.role = 'spectator'
            state.company = null
        }
        this.broadcast({ type: 'worldClosed' })
        return { ok: true }
    }

    /* ---- Live join ---- */

    /**
     * A user joins this live world (the hub resolved the invite and serializes per world). An existing
     * member gets their company back with nothing stamped. Otherwise foundCompany is stamped (at
     * world.tick + RT_INPUT_DELAY while running, at world.tick and applied at once while paused),
     * then the save and the member row commit together before the join is acknowledged. A failure or
     * timeout after stamping unloads the room without writing.
     */
    async join(userId: string, userName: string): Promise<RtJoinOutcome> {
        if (this.isUnloaded || this.joining) return { ok: false, code: 'busy' }
        if (this.worldStatus !== 'open') return { ok: false, code: 'worldClosed' }
        this.joining = true
        try {
            const access = await this.deps.rtGetAccess(userId, this.id)
            if (access.role === 'player') return { ok: true, companyId: access.companyId, existing: true }
            if (this.isUnloaded) return { ok: false, code: 'busy' }
            if (this.worldStatus !== 'open') return { ok: false, code: 'worldClosed' }
            if (this.room.freeCompanyId() === RT_NONE) return { ok: false, code: 'worldFull' }
            return await this.foundCompany(userId, userName)
        } finally {
            this.joining = false
        }
    }

    /* ---- unload ---- */

    /**
     * The hub unloads an idle room (or evicts one): any unsaved change is checkpointed first,
     * then remaining peers are told the room is gone. A failed checkpoint takes the failure path.
     */
    async unload(): Promise<void> {
        if (this.isUnloaded || this.unloading) return
        // attach refuses from here on, so no peer's play lands after the state being written
        this.unloading = true
        this.stopTicking(false)
        const dirty = this.room.tick !== this.savedTick || this.mutation !== this.savedMutation
        if (dirty && !this.holdWrites) {
            try {
                await this.checkpoint('unload')
            } catch {
                this.unloading = false
                return
            }
        }
        await this.writerIdle()
        this.unloading = false
        if (this.isUnloaded) return
        this.stopTicking(false)
        this.disposed = true
        this.clearLoadTimers()
        const frame = encodeServerMsg({ type: 'roomUnloaded', reason: 'idle' })
        for (const peer of this.peers.keys()) this.sendTo(peer, frame)
        this.peers.clear()
    }

    /* ---- internals: running and pausing ---- */

    private wantRun(): boolean {
        return !this.isUnloaded && this.worldStatus === 'open' && this.playerCount > 0 && this.joinPausePeer === null
    }

    private pauseReason(): RtPauseReason {
        if (this.worldStatus !== 'open') return 'closed'
        return this.playerCount === 0 ? 'noPlayers' : 'joining'
    }

    /** Starts or stops ticking to match the room's state; a pause waits for the queued commands. */
    private update(): void {
        if (this.isUnloaded || this.stopped) return
        if (this.wantRun()) {
            this.drainTarget = null
            if (!this.running) this.startTicking()
            return
        }
        if (!this.running) return
        if (this.drainTarget === null) this.drainTarget = this.lastQueuedTick()
        if (this.drainTarget === null || this.room.tick > this.drainTarget) this.stopTicking(true)
    }

    /** Keeps the room stepping until everything queued now has executed, starting it when paused. */
    private requestDrain(): void {
        const last = this.lastQueuedTick()
        if (last === null) return
        this.drainTarget = Math.max(this.drainTarget ?? last, last)
        if (!this.running) this.startTicking()
    }

    private lastQueuedTick(): number | null {
        return this.queue.length > 0 ? this.queue[this.queue.length - 1]!.stamped.tick : null
    }

    private startTicking(): void {
        this.running = true
        this.lastNow = this.deps.now()
        this.debt = 0
        this.intervalHandle = this.deps.setInterval(() => this.tickOnce(), TICK_MS)
        this.broadcast({ type: 'resumed' })
    }

    private stopTicking(announce: boolean): void {
        if (!this.running) return
        this.running = false
        this.drainTarget = null
        this.deps.clearInterval(this.intervalHandle)
        this.intervalHandle = null
        if (!announce) return
        this.broadcast({ type: 'paused', reason: this.pauseReason() })
        if (this.leaveCheckpointDue) this.leaveCheckpoint()
    }

    /** The leave-time state, written once the last player's queued commands ran; then the hub hears the room is idle. */
    private leaveCheckpoint(): void {
        this.leaveCheckpointDue = false
        if (this.playerCount > 0 || this.isUnloaded) return
        this.checkpoint('leave').then(() => {
            if (!this.isUnloaded && this.playerCount === 0) this.deps.onIdle?.(this)
        }, noop)
    }

    /** Applies every command stamped for this tick, in stamp order, then steps. */
    private processTick(): void {
        this.applyDue(this.room.tick)
        this.room.step()
        if (this.room.tick % RT_HASH_EVERY === 0) this.broadcast({ type: 'hash', tick: this.room.tick, hash: this.room.hash() })
    }

    /** Applies and removes every queued command stamped for `tick` or earlier, in queue order. */
    private applyDue(tick: number): void {
        while (this.queue.length > 0 && this.queue[0]!.stamped.tick <= tick) {
            const entry = this.queue.shift()!
            // computed first: an optional call would skip its argument when there is no callback
            const result = applyCommand(this.room, entry.stamped.company ?? RT_SERVER_COMPANY, entry.command, true)
            if (entry.onApplied) entry.onApplied(result)
        }
    }

    /* ---- internals: join pause ---- */

    private joinPauseLeftMs(now: number): number {
        const from = now - RT_JOIN_PAUSE_BUDGET_WINDOW_MS
        let used = 0
        for (let i = this.joinPauses.length - 1; i >= 0; i--) {
            const pause = this.joinPauses[i]!
            const end = pause.end ?? now
            if (end <= from) {
                this.joinPauses.splice(i, 1)
                continue
            }
            used += end - Math.max(pause.start, from)
        }
        return RT_JOIN_PAUSE_BUDGET_WINDOW_MS * RT_JOIN_PAUSE_SHARE_PERCENT / 100 - used
    }

    /** A loading player pauses the room: one pause at a time, once per user per window, within the world's budget. */
    private startJoinPause(state: RtPeerState): void {
        if (this.joinPausePeer !== null || this.worldStatus !== 'open') return
        const now = this.deps.now()
        const last = this.userPausedAt.get(state.userId)
        if (last !== undefined && now - last < RT_JOIN_PAUSE_WINDOW_MS) return
        const left = this.joinPauseLeftMs(now)
        if (left <= 0) return
        this.userPausedAt.set(state.userId, now)
        this.joinPauses.push({ start: now, end: null })
        this.joinPausePeer = state
        state.pausing = true
        state.loadTimer = this.deps.setTimeout(() => this.loadTimedOut(state), Math.min(RT_JOIN_LOAD_TIMEOUT_MS, left))
    }

    private endJoinPause(state: RtPeerState, timedOut: boolean): void {
        if (!state.pausing) return
        state.pausing = false
        this.deps.clearTimeout(state.loadTimer)
        state.loadTimer = null
        const open = this.joinPauses.at(-1)
        if (open && open.end === null) open.end = this.deps.now()
        if (this.joinPausePeer === state) this.joinPausePeer = null
        if (timedOut) {
            for (const [peer, other] of this.peers) if (other === state) this.sendResync(peer, [])
        }
        this.update()
    }

    /** The slow joiner gets a fresh snapshot instead of holding everyone. */
    private loadTimedOut(state: RtPeerState): void {
        if (state.pausing && !this.isUnloaded) this.endJoinPause(state, true)
    }

    private clearLoadTimers(): void {
        for (const state of this.peers.values()) {
            if (state.loadTimer !== null) this.deps.clearTimeout(state.loadTimer)
            state.loadTimer = null
            state.pausing = false
        }
        this.joinPausePeer = null
    }

    /* ---- internals: join ---- */

    private async foundCompany(userId: string, userName: string): Promise<RtJoinOutcome> {
        const colour = this.room.firstUnusedColour()
        let bytes: Uint8Array
        try {
            bytes = encodeCommand({ kind: RtCommandKind.foundCompany, name: userName, colour })
        } catch {
            // a name the codec cannot carry: the world gives the company its default name
            bytes = encodeCommand({ kind: RtCommandKind.foundCompany, name: '', colour })
        }
        const command = decodeCommand(bytes, this.room.map.side)
        if (!command || !applyCommand(this.room, RT_SERVER_COMPANY, command, false).ok) return { ok: false, code: 'worldFull' }

        let timer: unknown = null
        const deadline = new Promise<'timeout'>((resolve) => {
            timer = this.deps.setTimeout(() => resolve('timeout'), RT_LIVE_JOIN_TIMEOUT_MS)
        })
        const work = this.stampJoin(userId, command, bytes)
        work.catch(noop)
        try {
            const outcome = await Promise.race([work, deadline])
            if (outcome === 'timeout') throw new Error(`live join timed out after ${RT_LIVE_JOIN_TIMEOUT_MS} ms`)
            return { ok: true, companyId: outcome, existing: false }
        } catch (error) {
            this.deps.log('error', `[rail-tycoon] world ${JSON.stringify(this.id)} live join failed at tick ${this.room.tick} (${describe(error)})`)
            this.fail('joinFailed')
            return { ok: false, code: 'busy' }
        } finally {
            this.deps.clearTimeout(timer)
        }
    }

    /** Stamps and executes foundCompany, then writes the save with its member row; resolves with the new company id. */
    private async stampJoin(userId: string, command: RtCommand, bytes: Uint8Array): Promise<number> {
        const result = this.running ? await this.stampRunningJoin(command, bytes) : this.applyPausedJoin(command, bytes)
        if (!result.ok || result.id === undefined) throw new Error(`foundCompany was refused (${result.ok ? 'no id' : result.error})`)
        await this.checkpoint('join', { userId, companyId: result.id })
        return result.id
    }

    private stampRunningJoin(command: RtCommand, bytes: Uint8Array): Promise<RtCommandResult> {
        return new Promise((resolve, reject) => {
            const stamped: RtStampedCommand = { tick: this.room.tick + RT_INPUT_DELAY, company: null, command: bytes }
            this.enqueue({
                stamped,
                command,
                onApplied: (result) => {
                    if (result.ok) this.holdWrites = true
                    resolve(result)
                },
                onDropped: reject
            })
            this.broadcast({ type: 'command', ...stamped })
            if (this.drainTarget !== null) this.drainTarget = Math.max(this.drainTarget, stamped.tick)
        })
    }

    /**
     * A paused room: no peer was allowed past world.tick, so foundCompany is stamped for
     * world.tick behind the commands already queued for it, and all of them are applied now, in queue
     * order, exactly as every peer will apply them before its next step.
     */
    private applyPausedJoin(command: RtCommand, bytes: Uint8Array): RtCommandResult {
        const tick = this.room.tick
        this.broadcast({ type: 'command', tick, company: null, command: bytes })
        this.applyDue(tick)
        const result = applyCommand(this.room, RT_SERVER_COMPANY, command, true)
        this.mutation++
        if (result.ok) this.holdWrites = true
        return result
    }

    /* ---- internals: commands ---- */

    /** The command re-encoded and re-decoded against this world's map side, as decodeCommand would; foundCompany is never a client's. */
    private canonical(command: RtCommand): { bytes: Uint8Array, command: RtCommand } | null {
        let bytes: Uint8Array
        try {
            bytes = encodeCommand(command)
        } catch {
            return null
        }
        const decoded = decodeCommand(bytes, this.room.map.side)
        if (!decoded || decoded.kind === RtCommandKind.foundCompany) return null
        return { bytes, command: decoded }
    }

    /** Keeps the queue ascending by tick, arrival order within a tick. */
    private enqueue(entry: RtQueued): void {
        let at = this.queue.length
        while (at > 0 && this.queue[at - 1]!.stamped.tick > entry.stamped.tick) at--
        this.queue.splice(at, 0, entry)
    }

    /** Per user, so a reconnect does not refill it. */
    private takeToken(userId: string): boolean {
        const now = this.deps.now()
        const bucket = this.buckets.get(userId) ?? { tokens: RT_ROOM_CMD_BURST, at: now }
        bucket.tokens = Math.min(RT_ROOM_CMD_BURST, bucket.tokens + Math.max(0, now - bucket.at) * RT_ROOM_CMD_RATE / 1000)
        bucket.at = now
        this.buckets.set(userId, bucket)
        if (bucket.tokens < 1) return false
        bucket.tokens -= 1
        return true
    }

    /* ---- internals: snapshots and frames ---- */

    private encode(): RtWorldParts {
        return (this.deps.encodeWorldParts ?? encodeWorldParts)(this.room)
    }

    /** The world's parts at this boundary, reused while neither the tick nor the mutation counter moved. */
    private snapshot(): RtSnapshotCache {
        const cache = this.snapshotCache
        if (cache && cache.tick === this.room.tick && cache.mutation === this.mutation) return cache
        const parts = this.encode()
        const hashes = parts.map(rtPartHash)
        // carry over the compression of every part that did not change
        const zipped = new Map<string, Uint8Array>()
        if (cache) for (const hash of hashes) {
            const kept = cache.zipped.get(hash)
            if (kept) zipped.set(hash, kept)
        }
        const next: RtSnapshotCache = { tick: this.room.tick, mutation: this.mutation, parts, hashes, zipped }
        this.snapshotCache = next
        return next
    }

    /**
     * A snapshot as frames, all encoded before any is sent: the head (opened or resync, built by
     * `head`), each part the client lacks as gzip fragments in ascending index, then snapshotEnd with
     * every queued command, all stamped at or after this tick. Throws RangeError when a frame cannot
     * be encoded, or the parts together exceed the save cap.
     */
    private snapshotFrames(head: (snapshot: RtSnapshotHead) => RtServerMsg, have: readonly string[]): Uint8Array[] {
        const snapshot = this.snapshot()
        const frames = [encodeServerMsg(head({
            tick: this.room.tick,
            serverNow: Math.max(0, Math.floor(this.deps.now())),
            parts: snapshot.hashes
        }))]
        let total = 0
        for (let index = 0; index < snapshot.parts.length; index++) {
            const hash = snapshot.hashes[index]!
            if (have[index] === hash) continue
            let zipped = snapshot.zipped.get(hash)
            if (!zipped) {
                zipped = gzipSync(snapshot.parts[index]!)
                snapshot.zipped.set(hash, zipped)
            }
            total += zipped.length
            if (total > RT_MAX_SAVE_BYTES) throw new RangeError(`snapshot parts exceed ${RT_MAX_SAVE_BYTES} bytes compressed`)
            for (let at = 0; at < zipped.length; at += RT_PART_FRAGMENT_BYTES) {
                const end = Math.min(zipped.length, at + RT_PART_FRAGMENT_BYTES)
                frames.push(encodeServerMsg({ type: 'part', index, last: end === zipped.length, bytes: zipped.subarray(at, end) }))
            }
        }
        frames.push(encodeServerMsg({ type: 'snapshotEnd', tick: this.room.tick, pending: this.queue.map(entry => entry.stamped) }))
        return frames
    }

    private sendResync(peer: RtRoomPeer, have: readonly string[]): void {
        let frames: Uint8Array[]
        try {
            frames = this.snapshotFrames(head => ({ type: 'resync', worldId: this.id, ...head }), have)
        } catch (error) {
            this.deps.log('error', `[rail-tycoon] world ${JSON.stringify(this.id)} resync at tick ${this.room.tick} cannot be sent (${describe(error)})`)
            return
        }
        for (const frame of frames) this.sendTo(peer, frame)
    }

    private refusePeer(peer: RtRoomPeer, code: RtErrorCode): false {
        this.sendTo(peer, encodeServerMsg({ type: 'error', code }))
        return false
    }

    private sendTo(peer: RtRoomPeer, frame: Uint8Array): void {
        try {
            peer.send(frame)
        } catch (error) {
            this.deps.log('warn', `[rail-tycoon] world ${JSON.stringify(this.id)} send failed (${describe(error)})`)
        }
    }

    private broadcast(msg: RtServerMsg): void {
        if (this.peers.size === 0) return
        const frame = encodeServerMsg(msg)
        for (const peer of this.peers.keys()) this.sendTo(peer, frame)
    }

    /* ---- internals: the writer ---- */

    private pump(): void {
        if (this.writing || this.holdWrites || this.isUnloaded) return
        const job = this.pendingJobs.shift()
        if (!job) {
            for (const resolve of this.idleWaiters.splice(0)) resolve()
            return
        }
        this.writing = true
        this.write(job).catch(noop).finally(() => {
            this.writing = false
            this.pump()
        })
    }

    private writerIdle(): Promise<void> {
        if (!this.writing && this.pendingJobs.length === 0) return Promise.resolve()
        return new Promise(resolve => this.idleWaiters.push(resolve))
    }

    private async write(job: RtCheckpointJob): Promise<void> {
        const refused = await this.refuseReason(job)
        if (refused !== null) {
            this.deps.log('error', `[rail-tycoon] world ${JSON.stringify(this.id)} checkpoint at tick ${job.tick} refused, stored save kept (${refused})`)
            for (const waiter of job.waiters) waiter.reject(new Error(`checkpoint refused: ${refused}`))
            this.fail('error')
            return
        }
        if (this.isUnloaded) {
            for (const waiter of job.waiters) waiter.reject(new Error(`world ${this.id} room is unloaded`))
            return
        }
        try {
            const revision = await this.deps.rtSaveCheckpoint(
                this.id, job.parts, job.tick, this.revisionNow, new Date(this.deps.now()), job.member ? { member: job.member } : {}
            )
            this.revisionNow = revision
            this.savedTick = job.tick
            this.savedMutation = job.mutation
            for (const waiter of job.waiters) waiter.resolve(revision)
        } catch (error) {
            for (const waiter of job.waiters) waiter.reject(error)
            if (statusCodeOf(error) === 409) {
                this.deps.log('error', `[rail-tycoon] world ${JSON.stringify(this.id)} was saved by another writer; unloading at tick ${this.room.tick}`)
                this.fail('conflict')
            } else {
                this.deps.log('error', `[rail-tycoon] world ${JSON.stringify(this.id)} checkpoint at tick ${job.tick} failed (${describe(error)})`)
            }
        }
    }

    /**
     * Parts that would not load again are never written over the only save. Checks the sizes
     * rtLoadWorld enforces (compressed and decoded, all parts together), then that the parts decode to
     * the hash the live world had when they were encoded. Null when the parts are safe to write.
     */
    private async refuseReason(job: RtCheckpointJob): Promise<string | null> {
        const decoded = job.parts.reduce((sum, part) => sum + part.length, 0)
        if (decoded > RT_GUNZIP_MAX_BYTES) return `decoded save is ${decoded} bytes, over the ${RT_GUNZIP_MAX_BYTES} cap`
        try {
            const compressed = (await Promise.all(job.parts.map(part => rtGzip(part)))).reduce((sum, part) => sum + part.length, 0)
            if (compressed > RT_MAX_SAVE_BYTES) return `compressed save is ${compressed} bytes, over the ${RT_MAX_SAVE_BYTES} cap`
        } catch (error) {
            return `gzip: ${describe(error)}`
        }
        try {
            const hash = decodeWorldPartsOrThrow(job.parts).hash()
            if (hash !== job.hash) return `decoded hash ${hash} differs from the live hash ${job.hash}`
        } catch (error) {
            return `does not decode: ${describe(error)}`
        }
        return null
    }

    /* ---- internals: failure ---- */

    /** Stops for good without writing the in-memory world, tells every peer, and asks the hub to unload. */
    private fail(reason: RtUnloadReason): void {
        if (this.isUnloaded) return
        this.failed = true
        this.stopTicking(false)
        this.clearLoadTimers()
        const dropped = new Error(`world ${this.id} room unloaded (${reason})`)
        for (const entry of this.queue) entry.onDropped?.(dropped)
        this.queue = []
        for (const job of this.pendingJobs) for (const waiter of job.waiters) waiter.reject(dropped)
        this.pendingJobs = []
        this.holdWrites = false
        for (const resolve of this.idleWaiters.splice(0)) resolve()
        const frame = encodeServerMsg({ type: 'roomUnloaded', reason })
        for (const peer of this.peers.keys()) this.sendTo(peer, frame)
        this.peers.clear()
        this.deps.onUnload(this, reason)
    }
}
