import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hqState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import { hqSettingsOf } from '#shared/utils/hero-quest/settings'
import { SETTING_BODY, readHqBody, type HqSettingResponse } from '#server/utils/hero-quest-api'

/**
 * Change one setting. The new value is merged into the stored ones in the UPDATE itself, so two
 * settings changed at once never overwrite each other. Settings carry no value, so there is
 * nothing for a burst to win.
 */
export default defineEventHandler(async (event): Promise<HqSettingResponse> => {
    const userId = await requireUserId(event)
    const { key, value } = await readHqBody(event, SETTING_BODY)

    const [updated] = await db.update(hqState)
        .set({ settings: sql`${hqState.settings} || ${JSON.stringify({ [key]: value })}::jsonb` })
        .where(eq(hqState.userId, userId))
        .returning({ settings: hqState.settings })
    if (!updated) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })

    return { settings: hqSettingsOf(updated.settings) }
})
