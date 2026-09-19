import type { Peer } from 'crossws'
import { auth } from '#server/utils/auth'
import { askJev } from '#server/utils/jev'
import { canUsePirateAutopilot } from '#server/utils/pirates-autopilot'
import {
    parsePirateAutopilotSnapshot,
    PIRATE_AUTOPILOT_MIN_INTERVAL_MS,
    PIRATE_AUTOPILOT_QUESTIONS,
    pirateAutopilotAdvice,
    pirateAutopilotState
} from '#shared/utils/gamelogic/pirates-autopilot'

// Pirate Raid auto-play. The client sends { seq, snap } a few times a second
// and gets back { seq, advice } from Jev, or { seq, advice: null } when Jev is
// unavailable so the pilot falls back to its own judgment. The OpenRouter key
// never leaves the server.
//
// Each user gets one socket (a new one closes the old) and one question in
// flight at a time, no faster than PIRATE_AUTOPILOT_MIN_INTERVAL_MS. Ticks that
// arrive while busy are answered with `skipped` so the client can resend.
//
// Auth is enforced in `open`, not `upgrade`; see server/utils/live-table/socket.ts.

interface PilotPeer {
    userId: string
    busy: boolean
    lastAt: number
}

const peers = new Map<string, PilotPeer>()
const byUser = new Map<string, Peer>()

function drop(peer: Peer) {
    const info = peers.get(peer.id)
    peers.delete(peer.id)
    if (info && byUser.get(info.userId) === peer) byUser.delete(info.userId)
}

export default defineWebSocketHandler({
    async open(peer) {
        const headers = new Headers(peer.request?.headers as HeadersInit | undefined)
        const session = await auth.api.getSession({ headers })
        if (!session?.user?.id) {
            peer.close(4401, 'Unauthorized')
            return
        }
        if (!canUsePirateAutopilot(session.user.email)) {
            peer.close(4403, 'Forbidden')
            return
        }
        const previous = byUser.get(session.user.id)
        if (previous) {
            drop(previous)
            previous.close(4409, 'Opened elsewhere')
        }
        peers.set(peer.id, { userId: session.user.id, busy: false, lastAt: 0 })
        byUser.set(session.user.id, peer)
    },

    async message(peer, raw) {
        const info = peers.get(peer.id)
        if (!info) return

        let data: { seq?: unknown, snap?: unknown }
        try {
            data = JSON.parse(raw.text())
        } catch {
            return
        }
        const seq = typeof data.seq === 'number' && Number.isSafeInteger(data.seq) ? data.seq : 0
        const snap = parsePirateAutopilotSnapshot(data.snap)
        if (!snap) {
            peer.send(JSON.stringify({ seq, error: 'Invalid snapshot' }))
            return
        }

        const now = Date.now()
        if (info.busy || now - info.lastAt < PIRATE_AUTOPILOT_MIN_INTERVAL_MS) {
            peer.send(JSON.stringify({ seq, skipped: true }))
            return
        }
        info.busy = true
        info.lastAt = now
        try {
            const answers = await askJev(pirateAutopilotState(snap), PIRATE_AUTOPILOT_QUESTIONS)
            if (peers.get(peer.id) !== info) return
            peer.send(JSON.stringify({ seq, advice: answers ? pirateAutopilotAdvice(answers) : null }))
        } finally {
            info.busy = false
        }
    },

    close(peer) {
        drop(peer)
    },

    error(peer) {
        drop(peer)
    }
})
