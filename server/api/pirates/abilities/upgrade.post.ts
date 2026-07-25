import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pirateState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { getLockedPirateState } from '#server/utils/pirates'
import { PIRATE_ABILITIES, PIRATE_ABILITY_MAX_LEVEL, pirateAbilityUpgradeCost, pirateClampAbilityLevel } from '#shared/utils/gamelogic/pirates'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const body = await readBody(event)
    const abilityId = String(body?.abilityId ?? '')
    const ability = PIRATE_ABILITIES.find(entry => entry.id === abilityId)
    if (!ability) throw createError({ statusCode: 400, statusMessage: 'Invalid ability' })

    return db.transaction(async (tx) => {
        // Lock the row: the level lives in a jsonb map, so there is no single
        // column to compare-and-swap on. Without the lock two concurrent
        // upgrades would both read the same level, both pay, and both write
        // level + 1 — buying one level for twice the price.
        const s = await getLockedPirateState(tx, userId)
        if (s.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Cannot upgrade abilities mid-voyage' })
        if (!['bomb', ...(s.ownedAbilityIds ?? [])].includes(ability.id)) {
            throw createError({ statusCode: 400, statusMessage: 'Purchase this ability first' })
        }

        const levels = s.abilityLevels ?? {}
        const level = pirateClampAbilityLevel(levels[ability.id] ?? 1)
        if (level >= PIRATE_ABILITY_MAX_LEVEL) throw createError({ statusCode: 400, statusMessage: 'Already at max level' })

        const cost = pirateAbilityUpgradeCost(level)!

        await debit(userId, cost.toFixed(4), 'pirates', tx)
        await tx.update(pirateState)
            .set({ abilityLevels: { ...levels, [ability.id]: level + 1 } })
            .where(eq(pirateState.userId, userId))

        return { abilityId: ability.id, newLevel: level + 1 }
    })
})
