import { auth } from '#server/utils/auth'
import { useRtHub, type RtHubSocket } from '#server/utils/rail-tycoon/hub'
import { RT_BACKLOG_CLOSE_BYTES, RT_MAX_PEERS } from '#shared/utils/rail-tycoon/limits'

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

/**
 * The hub's view of a peer. Lockstep cannot survive a dropped frame, so a peer whose backlog passes
 * RT_BACKLOG_CLOSE_BYTES, or whose frame Bun dropped, is closed with 4408 (it reconnects and reopens)
 * rather than left missing a frame.
 */
function rtSocketFor(peer: RtPeerLike): RtHubSocket {
    let closed = false
    return {
        send(frame) {
            if (closed) return
            let sent: unknown
            try {
                sent = peer.send(frame)
            } catch {
                sent = 0
            }
            if ((RT_IS_BUN && sent === 0) || rtBacklog(peer) > RT_BACKLOG_CLOSE_BYTES) {
                closed = true
                peer.close(4408, 'Connection too slow')
            }
        },
        close(code, reason) {
            closed = true
            peer.close(code, reason)
        }
    }
}

async function rtAuthenticate(peer: RtPeerLike): Promise<RtHubSocket | null> {
    try {
        const hub = useRtHub()
        if (hub.peerCount >= RT_MAX_PEERS) {
            peer.close(4503, 'Server full')
            return null
        }
        const headers = new Headers(peer.request?.headers as HeadersInit | undefined)
        const session = await auth.api.getSession({ headers })
        if (!session?.user?.id) {
            peer.close(4401, 'Unauthorized')
            return null
        }
        const socket = rtSocketFor(peer)
        return hub.connect(socket, { id: session.user.id, name: session.user.name ?? '' }) ? socket : null
    } catch (error) {
        console.error('[rail-tycoon] socket auth failed', error)
        try {
            peer.close(1011, 'Server error')
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
