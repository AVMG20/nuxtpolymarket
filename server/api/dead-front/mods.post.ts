import { auth } from '#server/utils/auth'
import { withLockedDfProfile } from '#server/utils/dead-front-profile'
import { dfValidateMods, isDfPerkId } from '#server/utils/dead-front-profile-rules'
import { DF_MAX_PERK_MODS } from '#shared/utils/dead-front/perks'
import { dfPerkLevel } from '#shared/utils/dead-front/progression'

export default defineEventHandler(async (event) => {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    const body = await readBody<{ perk?: unknown, mods?: unknown }>(event)
    const perk = body?.perk
    const mods = body?.mods
    if (!isDfPerkId(perk)) throw createError({ statusCode: 400, statusMessage: 'Unknown perk' })
    if (!Array.isArray(mods) || mods.length > DF_MAX_PERK_MODS) throw createError({ statusCode: 400, statusMessage: `Pick at most ${DF_MAX_PERK_MODS} modifiers` })
    return withLockedDfProfile(session.user.id, (view) => {
        const clean = dfValidateMods(perk, mods, dfPerkLevel(view.perkXp[perk] ?? 0))
        if (clean.length !== mods.length) throw createError({ statusCode: 400, statusMessage: 'That modifier is still locked' })
        const perkMods = { ...view.perkMods }
        if (clean.length) perkMods[perk] = clean
        else delete perkMods[perk]
        const next = { ...view, perkMods }
        return { next, out: next }
    })
})
