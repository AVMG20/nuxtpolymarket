import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { addPeer, getPeerInfo, isUserConnected, removePeer, sendTo } from '#server/utils/live-blackjack/bus'
import { liveBlackjackTable } from '#server/utils/live-blackjack/table'
import type { LbClientMessage } from '#shared/utils/live-blackjack/types'

const ACTIONS = new Set(['hit', 'stand', 'double', 'split', 'surrender'])

function errorMessage(error: unknown): string {
    const e = error as { statusMessage?: string, message?: string }
    return e?.statusMessage || e?.message || 'Something went wrong'
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
            .select({ name: user.name, emblem: user.emblem, balance: user.balance })
            .from(user)
            .where(eq(user.id, session.user.id))
            .limit(1)
        if (!row) {
            peer.close(4401, 'Unauthorized')
            return
        }

        addPeer(peer, { userId: session.user.id, name: row.name, emblem: row.emblem })
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
                        return liveBlackjackTable.sit(info.userId, info.name, info.emblem, data.seat)
                    case 'leave':
                        return liveBlackjackTable.leave(info.userId)
                    case 'bet':
                        return liveBlackjackTable.placeBet(info.userId, Number(data.amount))
                    case 'undoBet':
                        return liveBlackjackTable.undoBet(info.userId)
                    case 'clearBet':
                        return liveBlackjackTable.clearBet(info.userId)
                    case 'repeatBet':
                        return liveBlackjackTable.repeatBet(info.userId)
                    case 'away':
                        return liveBlackjackTable.setAway(info.userId, !!data.away)
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
        const info = getPeerInfo(peer)
        removePeer(peer)
        // Only the last tab closing counts as leaving the table.
        if (info && !isUserConnected(info.userId)) {
            void liveBlackjackTable.run(() => liveBlackjackTable.setConnected(info.userId, false))
        }
    },

    error(peer) {
        const info = getPeerInfo(peer)
        removePeer(peer)
        if (info && !isUserConnected(info.userId)) {
            void liveBlackjackTable.run(() => liveBlackjackTable.setConnected(info.userId, false))
        }
    }
})
