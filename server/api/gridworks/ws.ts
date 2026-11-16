import type { Peer } from 'crossws'
import { auth } from '#server/utils/auth'
import { registerGridworksPeer, unregisterGridworksPeer } from '#server/utils/gridworks'

// Sockets that closed while their session was still being looked up. Without
// this the close hook runs first, finds nothing to remove, and `open` then
// registers a dead peer that nothing ever evicts.
const closed = new WeakSet<Peer>()

// Plot invalidation channel: emits { type: 'plot', userId, layout } after any
// plot changes so open world views refetch it. Auth in `open`, as in town/ws.ts.
export default defineWebSocketHandler({
    async open(peer) {
        const headers = new Headers(peer.request?.headers as HeadersInit | undefined)
        const session = await auth.api.getSession({ headers })
        if (closed.has(peer)) return
        if (!session?.user?.id) {
            peer.close(4401, 'Unauthorized')
            return
        }
        if (!registerGridworksPeer(peer, session.user.id)) peer.close(4429, 'Too many watchers')
    },
    close(peer) {
        closed.add(peer)
        unregisterGridworksPeer(peer)
    },
    error(peer) {
        closed.add(peer)
        unregisterGridworksPeer(peer)
    }
})
