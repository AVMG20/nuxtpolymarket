import { auth } from '#server/utils/auth'
import { registerTownPeer, unregisterTownPeer } from '#server/utils/town-live'

// Market invalidation channel: emits { type: 'market', resource } after any
// book mutation so open market panels refetch. No order data travels over the
// socket itself.
//
// It still requires a session, the way the chat socket does. The payload is
// worthless, but an endpoint anyone can open is an endpoint anyone can open
// two thousand of, and the only cost of asking for a cookie is a lookup.
export default defineWebSocketHandler({
    async upgrade(request) {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session?.user?.id) {
            throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
        }
    },
    open(peer) {
        if (!registerTownPeer(peer)) peer.close(4429, 'Too many watchers')
    },
    close(peer) {
        unregisterTownPeer(peer)
    },
    error(peer) {
        unregisterTownPeer(peer)
    }
})
