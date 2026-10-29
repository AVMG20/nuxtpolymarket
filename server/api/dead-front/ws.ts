import { auth } from '#server/utils/auth'
import { applyDfMatchResult, getDfProfile } from '#server/utils/dead-front-profile'
import { useDfHub } from '#server/utils/dead-front/hub'
import type { DfSocket } from '#server/utils/dead-front/hub'

// Dead Front socket: lobby + match on one connection per tab. Authenticated in
// `open` (crossws exposes the upgrade request headers there); messages that
// arrive while the session lookup is in flight wait for it.

const hub = useDfHub(() => ({ loadProfile: getDfProfile, applyResult: applyDfMatchResult }))
const pending = new Map<string, Promise<boolean>>()

interface PeerLike {
    id: string
    request?: { headers?: unknown }
    websocket?: SocketLike
    send: (data: unknown) => unknown
    close: (code?: number, reason?: string) => void
}

interface SocketLike {
    bufferedAmount?: unknown
    getBufferedAmount?: () => unknown
}

/** Bytes queued for a peer that stopped reading (a sleeping phone) before it is dropped: ~2 min of snapshots. */
const MAX_BACKLOG = 8 * 1024 * 1024
/** Only Bun's `send` reports a dropped frame (0); crossws's Node adapter always returns 0. */
const IS_BUN = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'

function backlog(peer: PeerLike): number {
    try {
        // crossws's raw socket: `websocket` is a Proxy that Bun's native methods reject
        const raw = (peer as { _internal?: { ws?: SocketLike } })._internal?.ws
        const ws = raw ?? peer.websocket
        // Bun's ServerWebSocket has getBufferedAmount(), Node's ws has bufferedAmount
        const n = typeof ws?.getBufferedAmount === 'function' ? ws.getBufferedAmount() : ws?.bufferedAmount
        return typeof n === 'number' ? n : 0
    } catch {
        return 0
    }
}

function socketOf(peer: PeerLike): DfSocket {
    let closed = false
    return {
        id: peer.id,
        send: (frame) => {
            if (closed) return
            const sent = peer.send(frame)
            // Bun returns 0 for a frame it dropped (and Node keeps queueing for a peer that stopped
            // reading). A client missing frames silently loses their events, so cut it: it reconnects
            // and resyncs inside the match's grace period.
            if ((IS_BUN && sent === 0) || backlog(peer) > MAX_BACKLOG) {
                closed = true
                peer.close(4408, 'Connection too slow')
            }
        },
        close: (code, reason) => peer.close(code, reason)
    }
}

async function authenticate(peer: PeerLike): Promise<boolean> {
    try {
        if (hub.peerCount >= 200) {
            peer.close(4503, 'Server full')
            return false
        }
        const headers = new Headers(peer.request?.headers as HeadersInit | undefined)
        const session = await auth.api.getSession({ headers })
        if (!session?.user?.id) {
            peer.close(4401, 'Unauthorized')
            return false
        }
        hub.open(socketOf(peer), { id: session.user.id, name: session.user.name })
        return true
    } catch (e) {
        console.error('[dead-front] socket auth failed', e)
        peer.close(1011, 'Server error')
        return false
    }
}

export default defineWebSocketHandler({
    open(peer) {
        pending.set(peer.id, authenticate(peer))
    },
    async message(peer, message) {
        const ready = pending.get(peer.id)
        if (!ready || !(await ready)) return
        hub.message(peer.id, message.text())
    },
    async close(peer) {
        const ready = pending.get(peer.id)
        pending.delete(peer.id)
        if (ready) await ready
        hub.close(peer.id)
    },
    error(peer, error) {
        console.error('[dead-front] socket error', peer.id, error)
    }
})
