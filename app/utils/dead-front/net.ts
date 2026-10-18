import type { DfClientMsg, DfServerMsg } from '#shared/utils/dead-front/protocol'

// The one socket a Dead Front tab holds (lobby + match). The public API
// (connect / send / on / close / status / rtt) is a contract with the page.
// Reconnects with exponential backoff when the socket drops unexpectedly and
// measures the round-trip time with ping / pong.

type Handler<T extends DfServerMsg['t']> = (msg: Extract<DfServerMsg, { t: T }>) => void

export type DfNetStatus = 'connecting' | 'open' | 'closed'

const PING_MS = 2000
const MAX_BACKOFF_MS = 8000

export class DfNet {
    /** 'connecting' | 'open' | 'closed' */
    status: DfNetStatus = 'closed'
    /** Smoothed round-trip time in ms. */
    rtt = 0
    /** Reconnect attempts since the last successful open. */
    attempts = 0
    private ws: WebSocket | null = null
    private handlers = new Map<string, Set<(msg: DfServerMsg) => void>>()
    private statusHandlers = new Set<(s: DfNetStatus) => void>()
    private wanted = false
    private retryTimer: ReturnType<typeof setTimeout> | null = null
    private pingTimer: ReturnType<typeof setInterval> | null = null

    connect(): void {
        this.wanted = true
        this.open()
    }

    private setStatus(s: DfNetStatus): void {
        if (this.status === s) return
        this.status = s
        for (const h of this.statusHandlers) h(s)
    }

    private open(): void {
        if (this.retryTimer) {
            clearTimeout(this.retryTimer)
            this.retryTimer = null
        }
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
        this.setStatus('connecting')
        let ws: WebSocket
        try {
            ws = new WebSocket(`${proto}//${location.host}/api/dead-front/ws`)
        } catch {
            this.scheduleRetry()
            return
        }
        this.ws = ws
        ws.onopen = () => {
            if (this.ws !== ws) return
            this.attempts = 0
            this.setStatus('open')
            this.startPing()
        }
        ws.onclose = (e) => {
            if (this.ws !== ws) return
            this.ws = null
            this.stopPing()
            // Replaced by another tab (4409) or signed out (4401): retrying would
            // just kick the other tab back, so wait for an explicit reconnect.
            if (e.code === 4409 || e.code === 4401) this.wanted = false
            this.setStatus('closed')
            if (this.wanted) this.scheduleRetry()
        }
        ws.onerror = () => {
            // onclose follows and handles the retry
        }
        ws.onmessage = (e) => {
            let msg: DfServerMsg
            try {
                msg = JSON.parse(String(e.data)) as DfServerMsg
            } catch {
                return
            }
            if (msg.t === 'pong') this.onPong(msg.at)
            const set = this.handlers.get(msg.t)
            if (!set) return
            for (const h of set) {
                try {
                    h(msg)
                } catch (err) {
                    console.error('[dead-front] handler failed', err)
                }
            }
        }
    }

    private scheduleRetry(): void {
        if (this.retryTimer || !this.wanted) return
        const delay = Math.min(MAX_BACKOFF_MS, 400 * Math.pow(2, this.attempts)) + Math.random() * 250
        this.attempts++
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null
            if (this.wanted) this.open()
        }, delay)
    }

    private startPing(): void {
        this.stopPing()
        const ping = () => this.send({ t: 'ping', at: performance.now() })
        ping()
        this.pingTimer = setInterval(ping, PING_MS)
    }

    private stopPing(): void {
        if (this.pingTimer) clearInterval(this.pingTimer)
        this.pingTimer = null
    }

    private onPong(at: number): void {
        const sample = performance.now() - at
        if (!(sample >= 0) || sample > 10000) return
        this.rtt = this.rtt === 0 ? sample : this.rtt * 0.8 + sample * 0.2
    }

    send(msg: DfClientMsg): void {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
    }

    /** Subscribe; returns an unsubscribe function. */
    on<T extends DfServerMsg['t']>(type: T, handler: Handler<T>): () => void {
        let set = this.handlers.get(type)
        if (!set) this.handlers.set(type, set = new Set())
        const h = handler as (msg: DfServerMsg) => void
        set.add(h)
        return () => set.delete(h)
    }

    /** Subscribe to status changes; returns an unsubscribe function. */
    onStatus(handler: (s: DfNetStatus) => void): () => void {
        this.statusHandlers.add(handler)
        return () => this.statusHandlers.delete(handler)
    }

    close(): void {
        this.wanted = false
        if (this.retryTimer) clearTimeout(this.retryTimer)
        this.retryTimer = null
        this.stopPing()
        const ws = this.ws
        this.ws = null
        ws?.close()
        this.setStatus('closed')
    }
}
