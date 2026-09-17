import { defineTableSocket } from '#server/utils/live-table/socket'
import { rouletteTable } from '#server/utils/live-table/roulette'

export default defineTableSocket(rouletteTable)
