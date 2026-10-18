import { auth } from '#server/utils/auth'
import { withLockedDfProfile } from '#server/utils/dead-front-profile'
import { dfValidateLoadout } from '#server/utils/dead-front-profile-rules'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const body = await readBody<{ startWeapon?: unknown, attachments?: unknown }>(event)
    return withLockedDfProfile(session.user.id, (view) => {
        const loadout = dfValidateLoadout(view, body?.startWeapon, body?.attachments ?? {})
        if (!loadout) throw createError({ statusCode: 400, statusMessage: 'That weapon is not available as a start weapon' })
        const next = { ...view, loadout }
        return { next, out: next }
    })
})
