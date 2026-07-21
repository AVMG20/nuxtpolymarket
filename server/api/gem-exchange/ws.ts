import { registerGemExchangePeer, unregisterGemExchangePeer } from '#server/utils/gem-exchange-live'

// Public read-only ticker: the exchange state is visible to signed-out
// visitors too, so the socket needs no auth — it only ever emits "refetch".
export default defineWebSocketHandler({
    open(peer) {
        registerGemExchangePeer(peer)
    },
    close(peer) {
        unregisterGemExchangePeer(peer)
    },
    error(peer) {
        unregisterGemExchangePeer(peer)
    }
})
