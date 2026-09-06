import { registerTownPeer, unregisterTownPeer } from '#server/utils/town-live'

// Market invalidation channel: emits { type: 'market', resource } after any
// book mutation so open market panels refetch. Read-only, no auth needed.
export default defineWebSocketHandler({
    open(peer) {
        registerTownPeer(peer)
    },
    close(peer) {
        unregisterTownPeer(peer)
    },
    error(peer) {
        unregisterTownPeer(peer)
    }
})
