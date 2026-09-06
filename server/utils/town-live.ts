import type { Peer } from 'crossws'

// Connected Polytown watchers. The socket is a pure invalidation channel: after
// a market mutation the server tells every peer which resource book changed
// and clients refetch — no order data travels over the socket itself.
const peers = new Set<Peer>()

export function registerTownPeer(peer: Peer) {
    peers.add(peer)
}

export function unregisterTownPeer(peer: Peer) {
    peers.delete(peer)
}

export function broadcastTownMarket(resource: string) {
    const payload = JSON.stringify({ type: 'market', resource, at: Date.now() })
    for (const peer of peers) {
        try {
            peer.send(payload)
        } catch {
            peers.delete(peer)
        }
    }
}
