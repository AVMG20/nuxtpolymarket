import { auth } from '#server/utils/auth'
import { withLockedDfProfile } from '#server/utils/dead-front-profile'
import { isDfPerkId } from '#server/utils/dead-front-profile-rules'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const body = await readBody<{ perk?: unknown }>(event)
    const perk = body?.perk === null ? null : isDfPerkId(body?.perk) ? body.perk : undefined
    if (perk === undefined) throw createError({ statusCode: 400, statusMessage: 'Unknown perk' })
    return withLockedDfProfile(session.user.id, (view) => {
        const next = { ...view, researchPerk: perk }
        return { next, out: next }
    })
})
