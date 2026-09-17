import type { Peer } from 'crossws'
import type { LbServerMessage } from '#shared/utils/live-blackjack/types'

interface LbPeerInfo {
    userId: string
    name: string
    emblem: string | null
    prestige: number
}

const peers = new Map<Peer, LbPeerInfo>()

export function addPeer(peer: Peer, info: LbPeerInfo) {
    peers.set(peer, info)
}

export function removePeer(peer: Peer) {
    peers.delete(peer)
}

export function getPeerInfo(peer: Peer): LbPeerInfo | undefined {
    return peers.get(peer)
}

export function peerCount(): number {
    return peers.size
}

/** True while the user still has at least one socket open on the table. */
export function isUserConnected(userId: string): boolean {
    for (const info of peers.values()) {
        if (info.userId === userId) return true
    }
    return false
}

function send(peer: Peer, payload: string) {
    try {
        peer.send(payload)
    } catch {
        peers.delete(peer)
    }
}

export function broadcast(message: LbServerMessage) {
    const payload = JSON.stringify(message)
    for (const peer of peers.keys()) send(peer, payload)
}

export function sendTo(peer: Peer, message: LbServerMessage) {
    send(peer, JSON.stringify(message))
}

/** Every socket a user has open — they may have the table in two tabs. */
export function sendToUser(userId: string, message: LbServerMessage) {
    const payload = JSON.stringify(message)
    for (const [peer, info] of peers.entries()) {
        if (info.userId === userId) send(peer, payload)
    }
}
