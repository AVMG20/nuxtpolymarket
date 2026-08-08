import { requireUserId } from '#server/utils/auth'
import { displayCandidates } from '#server/utils/tcg/display'
import { isDisplayKind } from '#shared/utils/tcg/display'

/** The caller's placeable copies for the picker — raw for binders, slabs for shelves. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const kind = getQuery(event).kind
    if (typeof kind !== 'string' || !isDisplayKind(kind)) {
        throw createError({ statusCode: 400, statusMessage: 'kind must be binder or shelf' })
    }
    return await displayCandidates(userId, kind)
})
