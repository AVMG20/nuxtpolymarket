import { isNotNull } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet } from '#server/database/schema'
import { requirePokemonAdmin } from '#server/utils/auth'
import { refreshSetRaw } from '#server/utils/tcg/import'

/**
 * Re-pull sidecar card data for one imported set (or every set when no
 * setId is given) — used after the sidecar's own data improves, like the
 * TCGdex combat enrichment for legacy sets, and to repair printings whose
 * render refs were mapped wrong at import time.
 */
export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)
    const body = await readBody(event)
    const apiBase = useRuntimeConfig().pokemonApiBase
    if (typeof body?.setId === 'string' && body.setId) {
        return await refreshSetRaw(body.setId, apiBase)
    }
    const sets = await db.select({ id: tcgSet.id, name: tcgSet.name })
        .from(tcgSet).where(isNotNull(tcgSet.plaatjesSetCode))
    const results: Record<string, { updated: number, missing: number, printings: number }> = {}
    for (const set of sets) {
        try {
            results[set.name] = await refreshSetRaw(set.id, apiBase)
        } catch {
            results[set.name] = { updated: 0, missing: -1, printings: 0 }
        }
    }
    return results
})
