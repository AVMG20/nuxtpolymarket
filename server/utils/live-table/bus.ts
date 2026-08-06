import type { Peer } from 'crossws'
import type { LtServerMessage } from '#shared/utils/live-table/types'

export interface LtPeerInfo {
    userId: string
    name: string
    emblem: string | null
}

/**
 * One process serves every table, so peers are kept per room rather than in a
 * single global set — a broadcast from the roulette table must not reach the
 * baccarat one.
 */
export class LtBus {
    private peers = new Map<Peer, LtPeerInfo>()

    add(peer: Peer, info: LtPeerInfo) {
        this.peers.set(peer, info)
    }

    remove(peer: Peer) {
        this.peers.delete(peer)
    }

    info(peer: Peer): LtPeerInfo | undefined {
        return this.peers.get(peer)
    }

    get count(): number {
        return this.peers.size
    }

    /** True while the user still has at least one socket open on this table. */
    isUserConnected(userId: string): boolean {
        for (const info of this.peers.values()) {
            if (info.userId === userId) return true
        }
        return false
    }

    private write(peer: Peer, payload: string) {
        try {
            peer.send(payload)
        } catch {
            this.peers.delete(peer)
        }
    }

    broadcast(message: LtServerMessage) {
        const payload = JSON.stringify(message)
        for (const peer of this.peers.keys()) this.write(peer, payload)
    }

    sendTo(peer: Peer, message: LtServerMessage) {
        this.write(peer, JSON.stringify(message))
    }

    /** Every socket a user has open — they may have the table in two tabs. */
    sendToUser(userId: string, message: LtServerMessage) {
        const payload = JSON.stringify(message)
        for (const [peer, info] of this.peers.entries()) {
            if (info.userId === userId) this.write(peer, payload)
        }
    }
}
