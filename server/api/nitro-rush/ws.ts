import { auth } from '#server/utils/auth'
import { NR_LIVE_MAX_FRAME, useNrLiveHub } from '#server/utils/nitro-rush-live'
import type { NrLiveSocket } from '#server/utils/nitro-rush-live'

// Nitro Rush live ghosts: players on the same course see each other's cars.
// Protocol and limits live in server/utils/nitro-rush-live.ts.
//
// Auth is enforced in `open`, not `upgrade` (see server/utils/live-table/socket.ts:
// throwing out of the upgrade hook escapes crossws as an unhandled rejection).
// Messages that arrive while the session lookup is in flight wait for it.

const hub = useNrLiveHub()
const pending = new Map<string, Promise<boolean>>()

interface PeerLike {
    id: string
    request?: { headers?: unknown }
    send: (data: unknown) => unknown
    close: (code?: number, reason?: string) => void
}

function socketOf(peer: PeerLike): NrLiveSocket {
    return {
        id: peer.id,
        send: frame => void peer.send(frame),
        close: (code, reason) => peer.close(code, reason)
    }
}

async function authenticate(peer: PeerLike): Promise<boolean> {
    try {
        const headers = new Headers(peer.request?.headers as HeadersInit | undefined)
        const session = await auth.api.getSession({ headers })
        if (!session?.user?.id) {
            peer.close(4401, 'Unauthorized')
            return false
        }
        return hub.open(socketOf(peer), { id: session.user.id, name: session.user.name })
    } catch (e) {
        console.error('[nitro-rush] socket auth failed', e)
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
        // Oversized frames are dropped before they're decoded.
        const raw = message.rawData as { length?: number, byteLength?: number } | string
        const size = typeof raw === 'string' ? raw.length : (raw?.byteLength ?? raw?.length ?? 0)
        if (size > NR_LIVE_MAX_FRAME) return
        hub.message(peer.id, message.text())
    },
    async close(peer) {
        const ready = pending.get(peer.id)
        pending.delete(peer.id)
        if (ready) await ready
        hub.close(peer.id)
    },
    error(peer, error) {
        console.error('[nitro-rush] socket error', peer.id, error)
    }
})
