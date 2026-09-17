import { and, desc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgPack, tcgSet } from '#server/database/schema'
import { requirePokemonAdmin } from '#server/utils/auth'
import { serializePack } from '#server/utils/tcg/engine'

export default defineEventHandler(async (event) => {
    const userId = await requirePokemonAdmin(event)
    const { setId } = getQuery(event)
    if (typeof setId !== 'string' || setId.length === 0) {
        throw createError({ statusCode: 400, statusMessage: 'setId is required' })
    }

    const [set] = await db.select().from(tcgSet).where(eq(tcgSet.id, setId))
    if (!set) throw createError({ statusCode: 404, statusMessage: 'Set not found' })

    const packs = await db.select().from(tcgPack)
        .where(and(eq(tcgPack.setId, setId), eq(tcgPack.ownerId, userId)))
        .orderBy(desc(tcgPack.createdAt), desc(tcgPack.packIndex))

    return {
        packs: packs.map(pack => serializePack(pack, true)),
        progress: {
            packsSold: set.packsSold,
            targetPackCount: set.targetPackCount,
            basePacksSold: set.basePacksSold,
            godPacksSold: set.godPacksSold,
            restockCount: set.restockPool.length
        }
    }
})
