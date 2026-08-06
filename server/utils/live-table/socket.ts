import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { user } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import type { LiveTable } from '#server/utils/live-table/table'
import type { LtClientMessage } from '#shared/utils/live-table/types'

function errorMessage(error: unknown): string {
    const e = error as { statusMessage?: string, message?: string }
    return e?.statusMessage || e?.message || 'Something went wrong'
}

/**
 * The socket half of a table, which is identical for every game: auth, peer
 * registration, watcher announcements, and dispatch of the four generic
 * messages. Anything game-specific arrives as `action` and goes straight to the
 * table's own handler.
 *
 * Auth is enforced in `open` rather than `upgrade`: throwing out of the upgrade
 * hook escapes crossws as an unhandled rejection, and closing the peer with 4401
 * before it is ever registered rejects the same connections without the noise.
 */
export function defineTableSocket<TSeat, TShared, TAction>(
    table: LiveTable<TSeat, TShared, TAction>
) {
    const { bus } = table

    // Only the last tab closing counts as leaving the table.
    function departed(peer: Parameters<typeof bus.remove>[0]) {
        const info = bus.info(peer)
        bus.remove(peer)
        if (!info || bus.isUserConnected(info.userId)) return
        bus.broadcast({ t: 'event', kind: 'watch', name: info.name, joined: false })
        void table.run(() => table.setConnected(info.userId, false))
    }

    return defineWebSocketHandler({
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

            // Announced before this peer is registered, so the arrival is news
            // to everyone already here and not to the person arriving.
            if (!bus.isUserConnected(session.user.id)) {
                bus.broadcast({ t: 'event', kind: 'watch', name: row.name, joined: true })
            }
            bus.add(peer, { userId: session.user.id, name: row.name, emblem: row.emblem })
            bus.sendTo(peer, {
                t: 'you',
                userId: session.user.id,
                seat: table.seatIndexOf(session.user.id),
                balance: Number(row.balance)
            })
            // Reconnecting clears the disconnect grace timer, and the publish
            // this queues delivers the joining client its first snapshot.
            await table.run(() => table.setConnected(session.user.id, true))
        },

        async message(peer, raw) {
            const info = bus.info(peer)
            if (!info) return

            let data: LtClientMessage<TAction>
            try {
                data = JSON.parse(raw.text())
            } catch {
                return
            }

            try {
                await table.run(() => {
                    switch (data.t) {
                        case 'sit':
                            return table.sit(info.userId, info.name, info.emblem, Number(data.seat))
                        case 'leave':
                            return table.leave(info.userId)
                        case 'voteStart':
                            return table.voteStart(info.userId)
                        case 'chat':
                            return table.chat(info.userId, info.name, String(data.text ?? ''))
                        case 'action':
                            return table.action(info.userId, data.action)
                    }
                })
            } catch (error) {
                bus.sendTo(peer, { t: 'error', message: errorMessage(error) })
            }
        },

        close(peer) {
            departed(peer)
        },

        error(peer) {
            departed(peer)
        }
    })
}
