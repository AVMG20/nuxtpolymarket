import { auth } from '#server/utils/auth'
import { useRtHub, type RtHubSocket } from '#server/utils/rail-tycoon/hub'
import { RT_BACKLOG_CLOSE_BYTES, RT_MAX_PEERS, RT_SOCKET_HIGH_WATER_BYTES } from '#shared/utils/rail-tycoon/limits'
import { RtCloseCode } from '#shared/utils/rail-tycoon/protocol'

// Rail Tycoon socket: one binary connection per tab, routed by RtHub. Authenticated in `open`
// (crossws exposes the upgrade request headers there); frames that arrive while the session lookup
// is in flight wait for it, in arrival order. Nothing here throws into crossws: a failed lookup
// closes the socket instead of becoming an unhandled rejection.

interface RtPeerLike {
    id: string
    request?: { headers?: unknown }
    send: (data: unknown) => unknown
    close: (code?: number, reason?: string) => void
}

interface RtRawSocket {
    bufferedAmount?: unknown
    getBufferedAmount?: () => unknown
}

/** Only Bun's send reports a dropped frame (0); crossws's Node adapter returns nothing useful. */
const RT_IS_BUN = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'

const pending = new Map<string, Promise<RtHubSocket | null>>()

/** Bytes queued for the peer and not yet written to the network. */
function rtBacklog(peer: RtPeerLike): number {
    try {
        // crossws's raw socket: `websocket` is a Proxy that Bun's native methods reject
        const raw = (peer as { _internal?: { ws?: RtRawSocket } })._internal?.ws
        const ws = raw ?? (peer as { websocket?: RtRawSocket }).websocket
        // Bun's ServerWebSocket has getBufferedAmount(), Node's ws has bufferedAmount
        const n = typeof ws?.getBufferedAmount === 'function' ? ws.getBufferedAmount() : ws?.bufferedAmount
        return typeof n === 'number' ? n : 0
    } catch {
        return 0
    }
}

/** How often frames waiting behind a full socket buffer retry, while any wait. */
const RT_FLUSH_MS = 10

/**
 * The hub's view of a peer. Frames go out in call order; while the socket holds
 * RT_SOCKET_HIGH_WATER_BYTES unsent they wait here instead, so a snapshot's many part frames never
 * push Bun past its 16 MiB backpressure limit, where it drops frames. Lockstep cannot survive a
 * dropped frame, so a peer whose backlog (waiting frames included) passes RT_BACKLOG_CLOSE_BYTES, or
 * whose frame was dropped anyway, is closed as tooSlow (it reconnects and reopens) rather than left
 * missing a frame.
 */
function rtSocketFor(peer: RtPeerLike): RtHubSocket {
    let closed = false
    const waiting: Uint8Array[] = []
    let waitingBytes = 0
    let timer: ReturnType<typeof setInterval> | null = null

    function shut(code: number, reason: string) {
        closed = true
        waiting.length = 0
        waitingBytes = 0
        if (timer !== null) clearInterval(timer)
        timer = null
        try {
            peer.close(code, reason)
        } catch {
            // already gone
        }
    }

    function tooSlow() {
        shut(RtCloseCode.tooSlow, 'Connection too slow')
    }

    function push(frame: Uint8Array): boolean {
        let sent: unknown
        try {
            sent = peer.send(frame)
        } catch {
            tooSlow()
            return false
        }
        if (RT_IS_BUN && sent === 0) {
            tooSlow()
            return false
        }
        return true
    }

    function flush() {
        while (!closed && waiting.length > 0 && rtBacklog(peer) < RT_SOCKET_HIGH_WATER_BYTES) {
            const frame = waiting.shift()!
            waitingBytes -= frame.length
            if (!push(frame)) return
        }
        if (waiting.length === 0 && timer !== null) {
            clearInterval(timer)
            timer = null
        }
    }

    return {
        send(frame) {
            if (closed) return
            if (waiting.length === 0 && rtBacklog(peer) < RT_SOCKET_HIGH_WATER_BYTES) {
                push(frame)
                return
            }
            waiting.push(frame)
            waitingBytes += frame.length
            if (waitingBytes + rtBacklog(peer) > RT_BACKLOG_CLOSE_BYTES) return tooSlow()
            timer ??= setInterval(flush, RT_FLUSH_MS)
        },
        close(code, reason) {
            shut(code ?? RtCloseCode.normal, reason ?? '')
        }
    }
}

function rtHostOf(url: string | null | undefined): string | null {
    if (!url) return null
    try {
        return new URL(url).host.toLowerCase()
    } catch {
        return null
    }
}

/**
 * A browser always sends Origin on the upgrade: one from another site is a page trying to ride the
 * player's session cookie, so it is refused. It must match the site's auth URL (production) or the
 * host the request was made to (dev on another port). No Origin is a non-browser client, which still
 * needs the session cookie.
 */
function rtOriginAllowed(headers: Headers): boolean {
    const origin = headers.get('origin')
    if (origin === null) return true
    const host = rtHostOf(origin)
    if (!host) return false
    const allowed = [
        rtHostOf(process.env.BETTER_AUTH_URL),
        headers.get('host')?.toLowerCase(),
        headers.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase()
    ]
    return allowed.includes(host)
}

async function rtAuthenticate(peer: RtPeerLike): Promise<RtHubSocket | null> {
    try {
        const hub = useRtHub()
        if (hub.peerCount >= RT_MAX_PEERS) {
            peer.close(RtCloseCode.serverFull, 'Server full')
            return null
        }
        const headers = new Headers(peer.request?.headers as HeadersInit | undefined)
        if (!rtOriginAllowed(headers)) {
            peer.close(RtCloseCode.forbidden, 'Forbidden')
            return null
        }
        const session = await auth.api.getSession({ headers })
        if (!session?.user?.id) {
            peer.close(RtCloseCode.unauthorized, 'Unauthorized')
            return null
        }
        const socket = rtSocketFor(peer)
        return hub.connect(socket, { id: session.user.id, name: session.user.name ?? '' }) ? socket : null
    } catch (error) {
        console.error('[rail-tycoon] socket auth failed', error)
        try {
            peer.close(RtCloseCode.serverError, 'Server error')
        } catch {
            // already gone
        }
        return null
    }
}

export default defineWebSocketHandler({
    open(peer) {
        pending.set(peer.id, rtAuthenticate(peer))
    },
    async message(peer, message) {
        const ready = pending.get(peer.id)
        const socket = ready ? await ready : null
        if (!socket) return
        // text frames are refused: an empty frame is answered badRequest by the hub, within its rate limit
        let bytes: Uint8Array
        try {
            bytes = typeof message.rawData === 'string' ? new Uint8Array(0) : message.uint8Array()
        } catch {
            bytes = new Uint8Array(0)
        }
        useRtHub().message(socket, bytes)
    },
    async close(peer) {
        const ready = pending.get(peer.id)
        pending.delete(peer.id)
        const socket = ready ? await ready : null
        if (socket) useRtHub().disconnect(socket)
    },
    error(peer, error) {
        console.error('[rail-tycoon] socket error', peer.id, error)
    }
})
