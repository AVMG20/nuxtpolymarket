import { getSessionUserId } from '#server/utils/auth'
import { caravanResponse, withCaravan } from '#server/utils/caravan'
import { debit } from '#server/utils/balance'
import { RESEARCH_BY_ID, researchSeconds } from '#shared/utils/caravan/config'
import { bonusesFor, researchAvailable } from '#shared/utils/caravan/progression'
import { hasResources, spendResources } from '#shared/utils/caravan/state'

/**
 * Begin a research project. One at a time, and it takes real time -- a tier's
 * board is meant to be worked through over days, not bought out in a minute the
 * moment you can afford it.
 */
export default defineEventHandler(async (event) => {
    const userId = await getSessionUserId(event)
    if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

    const body = await readBody<{ id?: string }>(event)
    const id = String(body?.id ?? '')

    const { ctx } = await withCaravan(userId, async ({ state }, tx) => {
        const def = RESEARCH_BY_ID[id]
        if (!def) throw createError({ statusCode: 404, statusMessage: 'No such research' })
        if (state.researchJob) throw createError({ statusCode: 400, statusMessage: 'Something is already being researched' })

        const gate = researchAvailable(state, id)
        if (!gate.ok) throw createError({ statusCode: 400, statusMessage: gate.reason ?? 'Unavailable' })
        if (!hasResources(state, def.resources)) throw createError({ statusCode: 400, statusMessage: 'Not enough materials' })

        await debit(userId, def.coins.toFixed(4), 'game:caravan', tx)
        spendResources(state, def.resources)

        const bonuses = bonusesFor(state)
        const now = Date.now()
        const seconds = researchSeconds(def.tier) / (1 + bonuses.researchSpeed / 100)
        state.researchJob = { id, startedAt: now, doneAt: now + seconds * 1000 }
    })

    return caravanResponse(ctx)
})
