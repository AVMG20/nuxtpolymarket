import { auth } from '#server/utils/auth'
import { registerTownPeer, unregisterTownPeer } from '#server/utils/town-live'

// Market invalidation channel: emits { type: 'market', resource } after any
// book mutation so open market panels refetch. No order data travels over the
// socket itself.
//
// It still asks for a session. The payload is worthless, but an endpoint anyone
// can open is an endpoint anyone can open two thousand of.
//
// Auth is enforced in `open`, not `upgrade`, for the reason spelled out in
// server/utils/live-table/socket.ts: throwing out of the upgrade hook escapes
// crossws as an unhandled rejection, while closing the peer here rejects the
// same connections quietly.
export default defineWebSocketHandler({
    async open(peer) {
        const headers = new Headers(peer.request?.headers as HeadersInit | undefined)
        const session = await auth.api.getSession({ headers })
        if (!session?.user?.id) {
            peer.close(4401, 'Unauthorized')
            return
        }
        if (!registerTownPeer(peer)) peer.close(4429, 'Too many watchers')
    },
    close(peer) {
        unregisterTownPeer(peer)
    },
    error(peer) {
        unregisterTownPeer(peer)
    }
})
