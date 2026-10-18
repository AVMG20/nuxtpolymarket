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
    send: (data: unknown) => unknown
    close: (code?: number, reason?: string) => void
}

function socketOf(peer: PeerLike): DfSocket {
    return {
        id: peer.id,
        send: frame => void peer.send(frame),
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
