// Rail Tycoon — the socket to the game server.
//
// One binary WebSocket to /api/rail-tycoon/ws. Frames are decoded with decodeServerMsg (a frame it
// refuses is dropped) and handed to listeners; client messages go out through encodeClientMsg. It
// pings every 2 s for the latency readout and reconnects with backoff capped at 3 s, also after the
// server closed it for a send backlog (4408), and emits reconnected so the view opens its
// world again. Close codes 4401 (not signed in) and 4409 (replaced by a newer tab) stop it for good,
// as does a hello from another protocol version or build: a tab running the previous deploy's
// simulation can never stay in lockstep.
//
// While a lockstep is being built from an opened or resync message (an async gunzip), the world's
// later messages are held in arrival order and handed over by release(), so none is lost.

import { decodeServerMsg, encodeClientMsg, RT_PROTOCOL_VERSION, type RtClientMsg, type RtServerMsg } from '#shared/utils/rail-tycoon/protocol'

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
    message: RtServerMsg
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
        this.socket?.close(1000)
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
        // a snapshot starts a lockstep build: hold what follows until release
        if (msg.type === 'opened' || msg.type === 'resync') {
            this.holding = true
            this.held = []
        }
        this.emit('message', msg)
    }

    private onClose(socket: RtSocket, code: number): void {
        if (this.socket !== socket) return
        this.socket = null
        this.stopTimers()
        this.discardHeld()
        if (this.closing || this.stopped) return
        if (code === 4401) return this.stop('unauthorized')
        if (code === 4409) return this.stop('replaced')
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
        socket?.close(1000)
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
