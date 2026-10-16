import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hackerzState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { HACKERZ_CODEX_IDS } from '#shared/utils/gamelogic/hackerz'

/** Most entries one call may open: the whole Database is well under this. */
const MAX_IDS = 64

/**
 * Opens Database entries: what the player just bought, or just met on the
 * board. Purely what the Database shows — nothing here touches value — so
 * the client's word is enough, as long as every id is a real entry. The merge
 * is one statement, so parallel calls never lose each other's entries.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ ids?: unknown }>(event)
    const ids = Array.isArray(body?.ids)
        ? [...new Set(body.ids.filter((id): id is string => typeof id === 'string' && HACKERZ_CODEX_IDS.has(id)))]
        : []
    if (!ids.length || ids.length > MAX_IDS) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid Database entries' })
    }

    const incoming = sql`ARRAY[${sql.join(ids.map(id => sql`${id}`), sql`, `)}]::text[]`
    const [updated] = await db.update(hackerzState)
        .set({ codex: sql`ARRAY(SELECT DISTINCT unnest(${hackerzState.codex} || ${incoming}))` })
        .where(eq(hackerzState.userId, userId))
        .returning({ codex: hackerzState.codex })
    if (!updated) throw createError({ statusCode: 404, statusMessage: 'No Hackerz profile yet' })
    return updated
})
