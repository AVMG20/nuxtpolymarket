import { requireUserId } from '#server/utils/auth'
import { createDisplay } from '#server/utils/tcg/display'
import { isDisplayKind } from '#shared/utils/tcg/display'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const kind = typeof body?.kind === 'string' ? body.kind : ''
    const name = typeof body?.name === 'string' ? body.name : ''
    if (!isDisplayKind(kind)) {
        throw createError({ statusCode: 400, statusMessage: 'kind must be binder or shelf' })
    }
    return await createDisplay(userId, kind, name)
})
