import { auth } from '#server/utils/auth'
import { withLockedDfProfile } from '#server/utils/dead-front-profile'
import { dfValidateLoadout } from '#server/utils/dead-front-profile-rules'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    // Attachments per weapon only: everyone starts with the M1911 (a sent `startWeapon` is ignored).
    const body = await readBody<{ attachments?: unknown }>(event)
    return withLockedDfProfile(session.user.id, (view) => {
        const loadout = dfValidateLoadout(view, body?.attachments ?? {})
        const next = { ...view, loadout }
        return { next, out: next }
    })
})
