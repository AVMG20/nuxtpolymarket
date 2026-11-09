import { requireUserId } from '#server/utils/auth'
import { craftItem } from '#server/utils/hero-quest-craft'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { CRAFT_BODY, readHqBody, type HqCraftResponse } from '#server/utils/hero-quest-api'

/** Craft a specific item with its gacha's Essence: the full RNG bypass, paid only from duplicates of finished items. */
export default defineEventHandler(async (event): Promise<HqCraftResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'gacha')
    const { system, contentId, max } = await readHqBody(event, CRAFT_BODY)
    return craftItem(userId, system, contentId, max)
})
