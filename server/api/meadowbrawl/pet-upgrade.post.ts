import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { meadowbrawlState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { debit } from '#server/utils/balance'
import { getLockedMeadowbrawlState, meadowbrawlPetLevel } from '#server/utils/meadowbrawl'
import { meadowbrawlPetById, meadowbrawlPetCost, meadowbrawlPetEffects } from '#shared/utils/gamelogic/meadowbrawl-meta'

/** Adopts a pet (level 0 → 1) or raises it one level. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const def = meadowbrawlPetById(body?.petId)
    if (!def) throw createError({ statusCode: 400, statusMessage: 'Invalid pet' })

    return db.transaction(async (tx) => {
        const state = await getLockedMeadowbrawlState(tx, userId)
        if (state.runStartedAt) throw createError({ statusCode: 400, statusMessage: 'Pets are locked during a run' })

        const level = meadowbrawlPetLevel(state, def.id)
        const cost = meadowbrawlPetCost(def, level)
        if (cost === null) throw createError({ statusCode: 400, statusMessage: `${def.name} is already at max level` })

        await debit(userId, cost.toFixed(4), 'meadowbrawl:pet', tx)
        const petLevels = { ...state.petLevels, [def.id]: level + 1 }
        // Adopting the first pet also fields it, so the player isn't left
        // with a companion sitting idle in the lobby.
        const activePet = state.activePet ?? def.id
        await tx.update(meadowbrawlState)
            .set({ petLevels, activePet })
            .where(eq(meadowbrawlState.userId, userId))

        return { petId: def.id, level: level + 1, cost, activePet, effects: meadowbrawlPetEffects(def.id, level + 1) }
    })
})
