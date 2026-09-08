import { requireUserId } from '#server/utils/auth'
import { buyPlotFromPlayer } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    // The price the buyer was looking at when they clicked. Optional so an
    // older client still works, but the panel always sends it.
    const expected = body?.expectedPrice
    return buyPlotFromPlayer(
        userId,
        String(body?.plotId ?? ''),
        typeof expected === 'number' ? expected : undefined
    )
})
