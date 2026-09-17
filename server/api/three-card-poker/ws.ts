import { defineTableSocket } from '#server/utils/live-table/socket'
import { threeCardPokerTable } from '#server/utils/live-table/three-card-poker'

export default defineTableSocket(threeCardPokerTable)
