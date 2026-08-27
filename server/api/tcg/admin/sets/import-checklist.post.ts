import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet } from '#server/database/schema'
import { requirePokemonAdmin } from '#server/utils/auth'
import { lockSetForUpdate } from '#server/utils/tcg/engine'
import { fetchPlaatjesChecklist, applyChecklist } from '#server/utils/tcg/import'

export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const body = await readBody(event)
    const setId = typeof body?.setId === 'string' ? body.setId : ''
    const plaatjesSetCode = typeof body?.plaatjesSetCode === 'string' ? body.plaatjesSetCode.trim() : ''
    if (!setId) throw createError({ statusCode: 400, statusMessage: 'setId is required' })
    if (!plaatjesSetCode) throw createError({ statusCode: 400, statusMessage: 'plaatjesSetCode is required' })

    // Friendly fast-fail before hitting the sidecar; the authoritative check
    // happens under the set row lock inside the transaction below.
    const [set] = await db.select().from(tcgSet).where(eq(tcgSet.id, setId))
    if (!set) throw createError({ statusCode: 404, statusMessage: 'Set not found' })
    if (set.status !== 'draft') throw createError({ statusCode: 400, statusMessage: 'Set is committed' })

    const config = useRuntimeConfig(event)
    const { cardRows, printingRows } = await fetchPlaatjesChecklist(plaatjesSetCode, config.pokemonApiBase, setId)

    await db.transaction(async (tx) => {
        // The set row lock serializes this against commitSet and every other
        // draft mutation — the status check below cannot go stale.
        const locked = await lockSetForUpdate(tx, setId)
        if (locked.status !== 'draft') throw createError({ statusCode: 400, statusMessage: 'Set is committed' })
        await tx.update(tcgSet).set({ plaatjesSetCode }).where(eq(tcgSet.id, setId))

        // Cards cascade to printings.
        await applyChecklist(tx, setId, cardRows, printingRows)
    })

    return { cards: cardRows.length, printings: printingRows.length }
})
