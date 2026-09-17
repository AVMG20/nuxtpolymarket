import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { addPeer, broadcast, getPeerInfo, isUserConnected, removePeer, sendTo } from '#server/utils/live-blackjack/bus'
import { liveBlackjackTable } from '#server/utils/live-blackjack/table'
import type { LbClientMessage } from '#shared/utils/live-blackjack/types'

const ACTIONS = new Set(['hit', 'stand', 'double', 'split', 'surrender'])

function errorMessage(error: unknown): string {
    const e = error as { statusMessage?: string, message?: string }
    return e?.statusMessage || e?.message || 'Something went wrong'
}

// Only the last tab closing counts as leaving the table.
function departed(peer: Parameters<typeof removePeer>[0]) {
    const info = getPeerInfo(peer)
    removePeer(peer)
    if (!info || isUserConnected(info.userId)) return
    broadcast({ t: 'event', kind: 'watch', name: info.name, joined: false })
    void liveBlackjackTable.run(() => liveBlackjackTable.setConnected(info.userId, false))
}

// Auth is enforced in `open` rather than `upgrade`: throwing out of the upgrade
// hook escapes crossws as an unhandled rejection, and closing the peer with 4401
// before it is ever registered rejects the same connections without the noise.
export default defineWebSocketHandler({
    async open(peer) {
        const headers = new Headers(peer.request?.headers as HeadersInit | undefined)
        const session = await auth.api.getSession({ headers })
        if (!session?.user?.id) {
            peer.close(4401, 'Unauthorized')
            return
        }

        const [row] = await db
            .select({ name: user.name, emblem: user.emblem, prestige: user.prestige, balance: user.balance })
            .from(user)
            .where(eq(user.id, session.user.id))
            .limit(1)
        if (!row) {
            peer.close(4401, 'Unauthorized')
            return
        }

        // Announced to the room before this peer is registered, so the arrival
        // is news to everyone already here and not to the person arriving.
        if (!isUserConnected(session.user.id)) {
            broadcast({ t: 'event', kind: 'watch', name: row.name, joined: true })
        }
        addPeer(peer, { userId: session.user.id, name: row.name, emblem: row.emblem, prestige: row.prestige })
        sendTo(peer, {
            t: 'you',
            userId: session.user.id,
            seat: liveBlackjackTable.seatIndexOf(session.user.id),
            balance: Number(row.balance)
        })
        // Reconnecting clears the seat's disconnect grace timer, and the publish
        // this queues is what delivers the joining client its first snapshot.
        await liveBlackjackTable.run(() => liveBlackjackTable.setConnected(session.user.id, true))
    },

    async message(peer, raw) {
        const info = getPeerInfo(peer)
        if (!info) return

        let data: LbClientMessage
        try {
            data = JSON.parse(raw.text())
        } catch {
            return
        }

        try {
            await liveBlackjackTable.run(() => {
                switch (data.t) {
                    case 'sit':
                        return liveBlackjackTable.sit(info.userId, info.name, info.emblem, info.prestige, data.seat)
                    case 'leave':
                        return liveBlackjackTable.leave(info.userId)
                    case 'bet':
                        return liveBlackjackTable.placeBet(info.userId, Number(data.amount), data.spot)
                    case 'undoBet':
                        return liveBlackjackTable.undoBet(info.userId)
                    case 'clearBet':
                        return liveBlackjackTable.clearBet(info.userId)
                    case 'repeatBet':
                        return liveBlackjackTable.repeatBet(info.userId)
                    case 'voteStart':
                        return liveBlackjackTable.voteStart(info.userId)
                    case 'insurance':
                        return liveBlackjackTable.takeInsurance(info.userId, !!data.take)
                    case 'chat':
                        return liveBlackjackTable.chat(info.userId, info.name, String(data.text ?? ''))
                    case 'action':
                        if (!ACTIONS.has(data.action)) return
                        return liveBlackjackTable.act(info.userId, data.action)
                }
            })
        } catch (error) {
            sendTo(peer, { t: 'error', message: errorMessage(error) })
        }
    },

    close(peer) {
        departed(peer)
    },

    error(peer) {
        departed(peer)
    }
})
