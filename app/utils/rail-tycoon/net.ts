// Rail Tycoon — the socket to the game server.
//
// One binary WebSocket to /api/rail-tycoon/ws. Frames are decoded with decodeServerMsg (a frame it
// refuses is dropped) and handed to listeners; client messages go out through encodeClientMsg. It
// pings every 2 s for the latency readout and reconnects with backoff capped at 3 s, also after the
// server closed it for a send backlog (RtCloseCode.tooSlow), and emits reconnected so the view opens
// its world again. Closes as unauthorized (not signed in), forbidden (opened from another site) and
// replaced (by a newer tab) stop it for good,
// as does a hello from another protocol version or build: a tab running the previous deploy's
// simulation can never stay in lockstep.
//
// A snapshot arrives as an opened or resync head, part frames and snapshotEnd; RtNet puts them
// together and emits one snapshot. From the head until the lockstep built from it is in place (an
// async gunzip), the world's later messages are held in arrival order and handed over by release(),
// so none is lost.

import { RT_MAX_SAVE_BYTES } from '#shared/utils/rail-tycoon/limits'
import { decodeServerMsg, encodeClientMsg, RT_PROTOCOL_VERSION, RtCloseCode, type RtClientMsg, type RtServerMsg } from '#shared/utils/rail-tycoon/protocol'
import type { RtSnapshot, RtSnapshotMsg } from './lockstep'

/** Why the socket stopped for good; the UI shows it. */
export type RtNetStopReason = 'unauthorized' | 'replaced' | 'outdated'

export const RT_NET_PING_MS = 2000
export const RT_NET_BACKOFF_MIN_MS = 250
export const RT_NET_BACKOFF_MAX_MS = 3000

/** The parts of a WebSocket RtNet uses, so tests can hand it a fake. */
export interface RtSocket {
    binaryType: string
    readonly readyState: number
    send(data: Uint8Array): void
    close(code?: number, reason?: string): void
    onopen: ((event: unknown) => void) | null
    onmessage: ((event: { data: unknown }) => void) | null
    onclose: ((event: { code: number }) => void) | null
    onerror: ((event: unknown) => void) | null
}

export interface RtNetOptions {
    url?: string
    /** This deploy's build id; useRuntimeConfig().app.buildId by default. */
    buildId?: string
    socket?: (url: string) => RtSocket
    now?: () => number
    setTimeout?: (fn: () => void, ms: number) => unknown
    clearTimeout?: (handle: unknown) => void
    setInterval?: (fn: () => void, ms: number) => unknown
    clearInterval?: (handle: unknown) => void
}

export interface RtNetEvents {
    /** Every message but the snapshot frames and pong. */
    message: RtServerMsg
    snapshot: RtSnapshot
    open: undefined
    /** Open again after a drop: the view re-opens its world. */
    reconnected: undefined
    stopped: RtNetStopReason
    latency: number
}

/** Messages that belong to the open world's lockstep and wait while it is being built. */
const WORLD_MESSAGES = new Set<RtServerMsg['type']>(['command', 'allowance', 'hash', 'paused', 'resumed', 'worldClosed'])

const OPEN = 1

type Listener<K extends keyof RtNetEvents> = (value: RtNetEvents[K]) => void

/** A snapshot whose end has not arrived yet. */
interface RtAssembly {
    head: RtSnapshotMsg
    zipped: Map<number, Uint8Array>
    /** Fragments of the part being received, which must be finished before another starts. */
    open: { index: number, fragments: Uint8Array[] } | null
    bytes: number
    broken: boolean
}

export class RtNet {
    stopped: RtNetStopReason | null = null
    /** Round trip of the last ping in ms, or null before the first pong. */
    latency: number | null = null

    private socket: RtSocket | null = null
    private everOpened = false
    private attempt = 0
    private retryTimer: unknown = null
    private pingTimer: unknown = null
    private closing = false
    private holding = false
    private held: RtServerMsg[] = []
    private assembly: RtAssembly | null = null
    private readonly listeners = new Map<keyof RtNetEvents, Set<(value: never) => void>>()
    private readonly o: Required<Omit<RtNetOptions, 'buildId' | 'url'>> & { buildId: string, url: string }

    constructor(options: RtNetOptions = {}) {
        this.o = {
            url: options.url ?? defaultUrl(),
            buildId: options.buildId ?? useRuntimeConfig().app.buildId,
            socket: options.socket ?? ((url: string) => new WebSocket(url) as unknown as RtSocket),
            now: options.now ?? (() => Date.now()),
            setTimeout: options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)),
            clearTimeout: options.clearTimeout ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>)),
            setInterval: options.setInterval ?? ((fn, ms) => setInterval(fn, ms)),
            clearInterval: options.clearInterval ?? (handle => clearInterval(handle as ReturnType<typeof setInterval>))
        }
    }

    on<K extends keyof RtNetEvents>(event: K, listener: Listener<K>): () => void {
        let set = this.listeners.get(event)
        if (!set) this.listeners.set(event, set = new Set())
        set.add(listener as (value: never) => void)
        return () => set.delete(listener as (value: never) => void)
    }

    private emit<K extends keyof RtNetEvents>(event: K, value: RtNetEvents[K]): void {
        for (const listener of this.listeners.get(event) ?? []) (listener as Listener<K>)(value)
    }

    get connected(): boolean {
        return this.socket !== null && this.socket.readyState === OPEN
    }

    connect(): void {
        if (this.stopped || this.closing || this.socket) return
        const socket = this.o.socket(this.o.url)
        socket.binaryType = 'arraybuffer'
        this.socket = socket
        socket.onopen = () => {
            this.attempt = 0
            this.startPing()
            this.emit('open', undefined)
            if (this.everOpened) this.emit('reconnected', undefined)
            this.everOpened = true
        }
        socket.onmessage = event => this.onFrame(event.data)
        socket.onerror = () => {}
        socket.onclose = event => this.onClose(socket, event.code)
    }

    /** Closes for good (leaving the page). */
    close(): void {
        this.closing = true
        this.stopTimers()
        this.socket?.close(RtCloseCode.normal)
        this.socket = null
    }

    /** Sends a message; false when the socket is not open (the caller may retry after reconnecting). */
    send(msg: RtClientMsg): boolean {
        if (!this.connected) return false
        this.socket!.send(encodeClientMsg(msg))
        return true
    }

    /** Hands the held world messages to `deliver` in arrival order and stops holding. */
    release(deliver: (msg: RtServerMsg) => void): void {
        const held = this.held
        this.held = []
        this.holding = false
        for (const msg of held) deliver(msg)
    }

    /** Drops held world messages, for a world that was left before its lockstep was built. */
    discardHeld(): void {
        this.held = []
        this.holding = false
    }

    private onFrame(data: unknown): void {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null
        if (!bytes) return
        const msg = decodeServerMsg(bytes)
        if (!msg) return
        if (msg.type === 'hello') {
            if (msg.version !== RT_PROTOCOL_VERSION || msg.buildId !== this.o.buildId) {
                this.stop('outdated')
                return
            }
        } else if (msg.type === 'pong') {
            this.latency = ((this.o.now() >>> 0) - msg.echo) >>> 0
            this.emit('latency', this.latency)
            return
        } else if (this.holding && WORLD_MESSAGES.has(msg.type)) {
            this.held.push(msg)
            return
        }
        switch (msg.type) {
            case 'opened':
            case 'resync':
                // a snapshot starts a lockstep build: hold what follows until release
                this.holding = true
                this.held = []
                this.assembly = { head: msg, zipped: new Map(), open: null, bytes: 0, broken: false }
                return
            case 'part':
                if (this.assembly) this.addPart(this.assembly, msg)
                return
            case 'snapshotEnd': {
                const assembly = this.assembly
                if (!assembly) return
                this.assembly = null
                this.emit('snapshot', {
                    head: assembly.head,
                    zipped: assembly.zipped,
                    pending: msg.pending,
                    broken: assembly.broken || assembly.open !== null || msg.tick !== assembly.head.tick
                })
                return
            }
            default:
                this.emit('message', msg)
        }
    }

    /** Adds one fragment; a part the head has no hash for, sent twice or interleaved, or past the cap breaks the snapshot. */
    private addPart(assembly: RtAssembly, msg: Extract<RtServerMsg, { type: 'part' }>): void {
        if (assembly.broken) return
        assembly.bytes += msg.bytes.length
        const open = assembly.open ?? { index: msg.index, fragments: [] }
        if (open.index !== msg.index || msg.index >= assembly.head.parts.length || assembly.zipped.has(msg.index)
            || assembly.bytes > RT_MAX_SAVE_BYTES) {
            assembly.broken = true
            assembly.zipped.clear()
            assembly.open = null
            return
        }
        open.fragments.push(msg.bytes)
        assembly.open = open
        if (!msg.last) return
        assembly.open = null
        const whole = new Uint8Array(open.fragments.reduce((sum, fragment) => sum + fragment.length, 0))
        let at = 0
        for (const fragment of open.fragments) {
            whole.set(fragment, at)
            at += fragment.length
        }
        assembly.zipped.set(msg.index, whole)
    }

    private onClose(socket: RtSocket, code: number): void {
        if (this.socket !== socket) return
        this.socket = null
        this.stopTimers()
        this.discardHeld()
        this.assembly = null
        if (this.closing || this.stopped) return
        if (code === RtCloseCode.unauthorized || code === RtCloseCode.forbidden) return this.stop('unauthorized')
        if (code === RtCloseCode.replaced) return this.stop('replaced')
        const delay = Math.min(RT_NET_BACKOFF_MAX_MS, RT_NET_BACKOFF_MIN_MS * 2 ** this.attempt)
        this.attempt++
        this.retryTimer = this.o.setTimeout(() => {
            this.retryTimer = null
            this.connect()
        }, delay)
    }

    private stop(reason: RtNetStopReason): void {
        if (this.stopped) return
        this.stopped = reason
        this.stopTimers()
        const socket = this.socket
        this.socket = null
        socket?.close(RtCloseCode.normal)
        this.emit('stopped', reason)
    }

    private startPing(): void {
        if (this.pingTimer !== null) this.o.clearInterval(this.pingTimer)
        this.pingTimer = this.o.setInterval(() => this.send({ type: 'ping', value: this.o.now() >>> 0 }), RT_NET_PING_MS)
    }

    private stopTimers(): void {
        if (this.pingTimer !== null) this.o.clearInterval(this.pingTimer)
        if (this.retryTimer !== null) this.o.clearTimeout(this.retryTimer)
        this.pingTimer = null
        this.retryTimer = null
    }
}

function defaultUrl(): string {
    const secure = location.protocol === 'https:'
    return `${secure ? 'wss' : 'ws'}://${location.host}/api/rail-tycoon/ws`
}
