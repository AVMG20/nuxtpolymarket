import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { setDefense, type DefenseSource } from '#server/utils/hero-quest-arena'

/**
 * Save the Arena defence (`arena.md` §1): free and unlimited, and never touches the live loadout.
 * `source` is `live` (copy what is equipped now), `loadout` with a `slotIndex` (copy a saved
 * Loadout), or `custom` with the five components named outright, as `loadout/set` takes them.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<Record<string, unknown>>(event)
    const source = body?.source
    let request: DefenseSource
    if (source === 'live') request = { source: 'live' }
    else if (source === 'loadout') request = { source: 'loadout', slotIndex: Number(body?.slotIndex) }
    else if (source === 'custom') {
        request = {
            source: 'custom',
            championIds: body?.championIds,
            formation: body?.formation,
            skillIds: body?.skillIds,
            artifactIds: body?.artifactIds,
            gear: body?.gear
        }
    } else throw createError({ statusCode: 400, statusMessage: 'Say where the defence comes from' })
    return db.transaction(tx => setDefense(tx, userId, request))
})
