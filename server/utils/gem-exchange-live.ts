import type { Peer } from 'crossws'

// Connected gem-exchange watchers. The socket is a pure invalidation channel:
// after any book mutation the server pings every peer and clients refetch the
// state endpoint — no order data ever travels over the socket itself.
const peers = new Set<Peer>()

export function registerGemExchangePeer(peer: Peer) {
    peers.add(peer)
}

export function unregisterGemExchangePeer(peer: Peer) {
    peers.delete(peer)
}

export function broadcastGemExchangeUpdate() {
    const payload = JSON.stringify({ type: 'update', at: Date.now() })
    for (const peer of peers) {
        try {
            peer.send(payload)
        } catch {
            peers.delete(peer)
        }
    }
}
