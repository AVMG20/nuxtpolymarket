import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ skipIntro?: boolean, keyboardPan?: boolean }>(event)

    const preferences = {
        ...(typeof body.skipIntro === 'boolean' && { skipIntro: body.skipIntro }),
        ...(typeof body.keyboardPan === 'boolean' && { keyboardPan: body.keyboardPan })
    }

    if (!Object.keys(preferences).length) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid Pathwarden preference' })
    }

    await db.insert(pathwardenState).values({ userId }).onConflictDoNothing()
    const [state] = await db.update(pathwardenState)
        .set(preferences)
        .where(eq(pathwardenState.userId, userId))
        .returning({ skipIntro: pathwardenState.skipIntro, keyboardPan: pathwardenState.keyboardPan })

    if (!state) throw createError({ statusCode: 404, statusMessage: 'Pathwarden state not found' })
    return state
})
