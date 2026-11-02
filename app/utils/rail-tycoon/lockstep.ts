// Rail Tycoon — the client's copy of the world.
//
// Built from an opened (or resync) message: the gzip snapshot is inflated under RT_GUNZIP_MAX_BYTES,
// decoded, and the commands the room had already stamped are queued. After that the
// client steps on its own, never ahead of the room's frame allowance, running several ticks per
// animation frame to catch up as the original's joining clients do.
//
// The tick boundary, the same as the room's: at tick T the server's hash for T is compared
// first, then every command stamped T is applied in stamp order, then the world steps to T + 1. A
// hash that differs, a command stamped for a tick already passed, or falling more than
// RT_RESYNC_BEHIND_TICKS behind the allowance asks the room for a fresh snapshot instead.
//
// Events feed the renderer and the windows: dirty tiles, payments (where and how much), vehicle list
// changes, pause and resume, role changes and resync requests.

import { decodeCommand, applyCommand, type RtCommand } from '#shared/utils/rail-tycoon/commands'
import { RT_CLIENT_STEPS_PER_FRAME, RT_GUNZIP_MAX_BYTES, RT_RESYNC_BEHIND_TICKS } from '#shared/utils/rail-tycoon/limits'
import type { RtClientMsg, RtPauseReason, RtRole, RtServerMsg, RtSnapshotBody } from '#shared/utils/rail-tycoon/protocol'
import { decodeWorld } from '#shared/utils/rail-tycoon/save'
import { RT_OWNER_NONE } from '#shared/utils/rail-tycoon/types'
import type { RtWorld } from '#shared/utils/rail-tycoon/world'

/** A delivery paid this tick, for the floating money text. */
export interface RtPayment {
    tile: number
    amount: number
    company: number
}

/** Why the lockstep asked for a fresh snapshot. */
export type RtResyncReason = 'hash' | 'behind' | 'late' | 'snapshot'

export interface RtLockstepEvents {
    dirty: number[]
    payment: RtPayment
    /** A vehicle was bought, sold or removed. */
    vehicles: undefined
    paused: RtPauseReason
    resumed: undefined
    /** The receiver's role changed (a closed world makes everyone a spectator). */
    role: RtRole
    resync: RtResyncReason
}

/** The world parts of an opened or resync message. */
export type RtSnapshotMsg = Extract<RtServerMsg, { type: 'opened' } | { type: 'resync' }>

interface Queued {
    company: number
    command: RtCommand
}

/** Inflates gzip bytes, refusing output past `limit`. Null when it is too big or not gzip. */
export async function rtGunzip(bytes: Uint8Array, limit = RT_GUNZIP_MAX_BYTES): Promise<Uint8Array | null> {
    try {
        const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
        const reader = stream.getReader()
        const chunks: Uint8Array[] = []
        let total = 0
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > limit) {
                await reader.cancel()
                return null
            }
            chunks.push(value)
        }
        const out = new Uint8Array(total)
        let at = 0
        for (const chunk of chunks) {
            out.set(chunk, at)
            at += chunk.byteLength
        }
        return out
    } catch {
        return null
    }
}

type Listener<K extends keyof RtLockstepEvents> = (value: RtLockstepEvents[K]) => void

export class RtLockstep {
    /** The tick the room lets this client step up to. */
    allowance: number
    paused = false
    /** Set once a resync was asked for; the lockstep stops stepping until it is replaced. */
    resyncing: RtResyncReason | null = null

    private readonly queue = new Map<number, Queued[]>()
    private readonly hashes = new Map<number, number>()
    private readonly profits = new Map<number, number>()
    private vehicleCount: number
    private readonly listeners = new Map<keyof RtLockstepEvents, Set<(value: never) => void>>()

    private constructor(
        readonly worldId: string,
        readonly world: RtWorld,
        public role: RtRole,
        readonly company: number | null,
        readonly owner: boolean,
        readonly inviteCode: string | null,
        private readonly send: (msg: RtClientMsg) => void
    ) {
        this.allowance = world.tick
        this.vehicleCount = world.vehicleList().length
        for (const vehicle of world.vehicleList()) this.profits.set(vehicle.id, vehicle.profitThisYear)
    }

    /**
     * Builds the lockstep from an opened message (or a resync answer, keeping the previous role),
     * queues its pending commands and sends loaded. A snapshot that will not inflate or decode asks
     * for a resync and resolves to null.
     */
    static async create(msg: RtSnapshotMsg, send: (msg: RtClientMsg) => void, previous?: RtLockstep): Promise<RtLockstep | null> {
        const bytes = await rtGunzip(msg.snapshot)
        const world = bytes ? decodeWorld(bytes) : null
        if (!world || world.tick !== msg.tick) {
            send({ type: 'resync', worldId: msg.worldId })
            return null
        }
        const opened = msg.type === 'opened' ? msg : null
        const lockstep = new RtLockstep(
            msg.worldId,
            world,
            opened?.role ?? previous?.role ?? 'spectator',
            opened ? opened.company : previous?.company ?? null,
            opened?.owner ?? previous?.owner ?? false,
            opened ? opened.inviteCode : previous?.inviteCode ?? null,
            send
        )
        // a pending command already behind the snapshot: it asked for a resync, wait for that answer
        if (!lockstep.queuePending(msg)) return null
        send({ type: 'loaded', worldId: msg.worldId })
        return lockstep
    }

    on<K extends keyof RtLockstepEvents>(event: K, listener: Listener<K>): () => void {
        let set = this.listeners.get(event)
        if (!set) this.listeners.set(event, set = new Set())
        set.add(listener as (value: never) => void)
        return () => set.delete(listener as (value: never) => void)
    }

    private emit<K extends keyof RtLockstepEvents>(event: K, value: RtLockstepEvents[K]): void {
        for (const listener of this.listeners.get(event) ?? []) (listener as Listener<K>)(value)
    }

    /** Whether a command from this client could be accepted: a player of an open world, in step. */
    get canCommand(): boolean {
        return this.role === 'player' && this.company !== null && this.resyncing === null
    }

    private queuePending(body: RtSnapshotBody): boolean {
        for (const stamped of body.pending) {
            if (!this.enqueue(stamped.tick, stamped.company, stamped.command)) return false
        }
        return true
    }

    /** Queues a stamped command; one for a tick the world has already passed means the client drifted. */
    private enqueue(tick: number, company: number | null, bytes: Uint8Array): boolean {
        const command = decodeCommand(bytes, this.world.map.side)
        if (!command || tick < this.world.tick) {
            this.requestResync('late')
            return false
        }
        let list = this.queue.get(tick)
        if (!list) this.queue.set(tick, list = [])
        list.push({ company: company ?? RT_OWNER_NONE, command })
        return true
    }

    /** Takes one world message from the room (RtNet hands them over in arrival order). */
    receive(msg: RtServerMsg): void {
        switch (msg.type) {
            case 'command':
                this.enqueue(msg.tick, msg.company, msg.command)
                break
            case 'allowance':
                this.allowance = Math.max(this.allowance, msg.tick)
                break
            case 'hash':
                if (msg.tick < this.world.tick) break
                if (msg.tick === this.world.tick) this.checkHash(msg.tick, msg.hash)
                else this.hashes.set(msg.tick, msg.hash)
                break
            case 'paused':
                this.paused = true
                this.emit('paused', msg.reason)
                break
            case 'resumed':
                this.paused = false
                this.emit('resumed', undefined)
                break
            case 'worldClosed':
                if (this.role !== 'spectator') {
                    this.role = 'spectator'
                    this.emit('role', 'spectator')
                }
                break
            default:
                break
        }
    }

    private checkHash(tick: number, hash: number): boolean {
        this.hashes.delete(tick)
        if (this.world.hash() === hash) return true
        this.requestResync('hash')
        return false
    }

    /** Asks the room for a fresh snapshot, once; stepping stops until a new lockstep replaces this one. */
    requestResync(reason: RtResyncReason): void {
        if (this.resyncing) return
        this.resyncing = reason
        this.send({ type: 'resync', worldId: this.worldId })
        this.emit('resync', reason)
    }

    /**
     * One animation frame: steps toward the allowance, at most RT_CLIENT_STEPS_PER_FRAME ticks.
     * Too far behind, it asks for a resync rather than replaying. Returns the ticks stepped.
     */
    frame(maxSteps = RT_CLIENT_STEPS_PER_FRAME): number {
        if (this.resyncing) return 0
        if (this.allowance - this.world.tick > RT_RESYNC_BEHIND_TICKS) {
            this.requestResync('behind')
            return 0
        }
        let steps = 0
        while (steps < maxSteps && this.world.tick < this.allowance && !this.resyncing) {
            this.stepOnce()
            steps++
        }
        if (steps > 0) {
            const dirty = this.world.drainDirtyTiles()
            if (dirty.length > 0) this.emit('dirty', dirty)
        }
        return steps
    }

    /** One tick boundary: the hash for this tick, this tick's commands, then the step. */
    private stepOnce(): void {
        const world = this.world
        const tick = world.tick
        const hash = this.hashes.get(tick)
        if (hash !== undefined && !this.checkHash(tick, hash)) return
        const commands = this.queue.get(tick)
        if (commands) {
            this.queue.delete(tick)
            for (const { company, command } of commands) applyCommand(world, company, command, true)
        }
        world.step()
        this.notice()
    }

    /** Payments and vehicle list changes since the last tick, from the vehicles' profits. */
    private notice(): void {
        const vehicles = this.world.vehicleList()
        for (const vehicle of vehicles) {
            const before = this.profits.get(vehicle.id)
            // a rise in this year's profit is a delivery paid; the new-year roll and running costs only lower it
            if (before !== undefined && vehicle.profitThisYear > before) {
                this.emit('payment', { tile: vehicle.tiles[0] ?? -1, amount: vehicle.profitThisYear - before, company: vehicle.owner })
            }
            this.profits.set(vehicle.id, vehicle.profitThisYear)
        }
        if (vehicles.length !== this.vehicleCount || this.profits.size !== vehicles.length) {
            this.vehicleCount = vehicles.length
            const alive = new Set(vehicles.map(vehicle => vehicle.id))
            for (const id of [...this.profits.keys()]) if (!alive.has(id)) this.profits.delete(id)
            this.emit('vehicles', undefined)
        }
    }

    /** The command message for a player's command, or null when this client may not send one now. */
    commandMessage(command: RtCommand, seq: number): RtClientMsg | null {
        if (!this.canCommand) return null
        return { type: 'command', seq: seq & 0xff, command }
    }
}
