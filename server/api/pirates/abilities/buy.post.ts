import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { PIRATE_ABILITIES } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const abilityId = String(body?.abilityId ?? '')
    const ability = PIRATE_ABILITIES.find(entry => entry.id === abilityId)
    if (!ability || ability.cost <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid ability purchase' })

    const state = await db.query.pirateState.findFirst({ where: eq(pirateState.userId, userId) })
    if (!state) throw createError({ statusCode: 404, statusMessage: 'Pirate state not initialized' })
    if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot change abilities mid-voyage' })
    if ((state.ownedAbilityIds ?? []).includes(ability.id)) throw createError({ statusCode: 400, statusMessage: 'Ability already owned' })

    await debit(userId, ability.cost.toFixed(4), 'pirates')
    await db.update(pirateState)
        .set({
            ownedAbilityIds: Array.from(new Set(['bomb', ...(state.ownedAbilityIds ?? []), ability.id])),
            equippedAbilityId: ability.id
        })
        .where(eq(pirateState.userId, userId))

    return { abilityId: ability.id, equipped: true }
})
