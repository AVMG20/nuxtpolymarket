import { liveBlackjackTable } from '#server/utils/live-blackjack/table'

/** Read-only snapshot for spectators and health checks; play goes over the socket. */
export default defineEventHandler(() => liveBlackjackTable.snapshot())
