import { requireUserId } from '#server/utils/auth'
import { createLot } from '#server/utils/tcg/lots'
import type { LotPick } from '#server/utils/tcg/lots'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const setId = typeof body?.setId === 'string' ? body.setId : ''
    if (!setId) throw createError({ statusCode: 400, statusMessage: 'setId is required' })
    const picks: LotPick[] = Array.isArray(body?.picks)
        ? body.picks
            .filter((pick: unknown): pick is { printingId: string, count: number } =>
                typeof pick === 'object' && pick !== null
                && typeof (pick as { printingId?: unknown }).printingId === 'string')
            .map((pick: { printingId: string, count: number }) => ({
                printingId: pick.printingId,
                count: Number(pick.count)
            }))
        : []
    const note = typeof body?.note === 'string' && body.note ? body.note : null
    return await createLot(userId, setId, picks, Number(body?.price), note)
})
