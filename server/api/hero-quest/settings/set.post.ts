import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hqState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { hqSettingsOf, isHqSettingKey } from '#shared/utils/hero-quest/settings'

/**
 * Change one setting. The new value is merged into the stored ones in the UPDATE itself, so two
 * settings changed at once never overwrite each other. Settings carry no value, so there is
 * nothing for a burst to win.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ key?: string, value?: unknown }>(event)
    const key = body?.key
    if (!isHqSettingKey(key) || typeof body?.value !== 'boolean') {
        throw createError({ statusCode: 400, statusMessage: 'Unknown setting' })
    }

    const [updated] = await db.update(hqState)
        .set({ settings: sql`${hqState.settings} || ${JSON.stringify({ [key]: body.value })}::jsonb` })
        .where(eq(hqState.userId, userId))
        .returning({ settings: hqState.settings })
    if (!updated) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })

    return { settings: hqSettingsOf(updated.settings) }
})
