import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'

const MAX_NAME_LENGTH = 24

/** Rename a worker. Names are cosmetic, so this only has to be safe, not clever. */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ workerId?: string, name?: string }>(event)
    const workerId = String(body?.workerId ?? '')
    // Strip control characters and collapse whitespace, so a name cannot break
    // the roster layout or smuggle newlines into the save blob.
    const name = String(body?.name ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_NAME_LENGTH)

    if (!name) throw createError({ statusCode: 400, statusMessage: 'Give them a name' })

    const { ctx } = await withCaravan(userId, ({ state }) => {
        const worker = state.workers.find(w => w.id === workerId)
        if (!worker) throw createError({ statusCode: 404, statusMessage: 'No such worker' })
        worker.name = name
    })

    return caravanResponse(ctx)
})
