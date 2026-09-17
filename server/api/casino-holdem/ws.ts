import { casinoHoldemTable } from '#server/utils/live-table/casino-holdem'
import { defineTableSocket } from '#server/utils/live-table/socket'

export default defineTableSocket(casinoHoldemTable)
