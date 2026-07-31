import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ skipIntro?: boolean }>(event)

    if (typeof body.skipIntro !== 'boolean') {
        throw createError({ statusCode: 400, statusMessage: 'Invalid Pathwarden preference' })
    }

    await db.insert(pathwardenState).values({ userId }).onConflictDoNothing()
    const [state] = await db.update(pathwardenState)
        .set({ skipIntro: body.skipIntro })
        .where(eq(pathwardenState.userId, userId))
        .returning({ skipIntro: pathwardenState.skipIntro })

    if (!state) throw createError({ statusCode: 404, statusMessage: 'Pathwarden state not found' })
    return state
})
