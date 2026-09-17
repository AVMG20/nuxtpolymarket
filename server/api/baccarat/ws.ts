import { defineTableSocket } from '#server/utils/live-table/socket'
import { baccaratTable } from '#server/utils/live-table/baccarat'

export default defineTableSocket(baccaratTable)
