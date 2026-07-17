import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { PIRATE_ABILITIES } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const abilityId = String(body?.abilityId ?? '')
    const ability = PIRATE_ABILITIES.find(entry => entry.id === abilityId)
    if (!ability) throw createError({ statusCode: 400, statusMessage: 'Invalid ability' })

    const state = await db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
    if (!state) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
    if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot change abilities mid-voyage' })
    if (!['bomb', ...(state.ownedAbilityIds ?? [])].includes(ability.id)) {
        throw createError({ statusCode: 400, statusMessage: 'Purchase this ability first' })
    }

    await db.update(pirateState)
        .set({ equippedAbilityId: ability.id })
        .where(eq(pirateState.userId, userId))

    return { abilityId: ability.id }
})
