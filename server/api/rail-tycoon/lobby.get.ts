import { auth } from '#server/utils/auth'
import { rtListPublicWorlds } from '#server/utils/rail-tycoon/registry'
import type { RtLobbyWorld } from '#shared/utils/rail-tycoon/protocol'

/** The public lobby: open public worlds the player has not joined yet, with their invite codes. */
export default defineEventHandler(async (event): Promise<{ worlds: RtLobbyWorld[] }> => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const rows = await rtListPublicWorlds(session.user.id)
    return {
        worlds: rows.map(row => ({ ...row, lastActiveAt: row.lastActiveAt.getTime() }))
    }
})
