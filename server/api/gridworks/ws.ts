import { auth } from '#server/utils/auth'
import { registerGridworksPeer, unregisterGridworksPeer } from '#server/utils/gridworks'

// Plot invalidation channel: emits { type: 'plot', userId, layout } after any
// plot changes so open world views refetch it. Auth in `open`, as in town/ws.ts.
export default defineWebSocketHandler({
    async open(peer) {
        const headers = new Headers(peer.request?.headers as HeadersInit | undefined)
        const session = await auth.api.getSession({ headers })
        if (!session?.user?.id) {
            peer.close(4401, 'Unauthorized')
            return
        }
        if (!registerGridworksPeer(peer)) peer.close(4429, 'Too many watchers')
    },
    close(peer) {
        unregisterGridworksPeer(peer)
    },
    error(peer) {
        unregisterGridworksPeer(peer)
    }
})
