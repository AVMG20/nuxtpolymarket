import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'

const AMBIENT_STORY_COUNT = 250

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ storyId?: number }>(event)
    const storyId = Math.floor(Number(body.storyId))
    if (!Number.isInteger(storyId) || storyId < 1 || storyId > AMBIENT_STORY_COUNT) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown ambient story' })
    }

    return db.transaction(async (tx) => {
        await tx.insert(pathwardenState).values({ userId }).onConflictDoNothing()
        const [state] = await tx.select()
            .from(pathwardenState)
            .where(eq(pathwardenState.userId, userId))
            .for('update')
        if (!state) throw createError({ statusCode: 500, statusMessage: 'Could not initialize Pathwarden progress' })

        const stories = [...new Set([...state.ambientStoryIds, storyId])].sort((a, b) => a - b)
        const achievementUnlocked = stories.length === AMBIENT_STORY_COUNT && !state.ambientRewardClaimed
        await tx.update(pathwardenState)
            .set({
                ambientStoryIds: stories,
                ambientRewardClaimed: state.ambientRewardClaimed || achievementUnlocked,
                freeBoostCredits: state.freeBoostCredits + (achievementUnlocked ? 1 : 0)
            })
            .where(eq(pathwardenState.userId, userId))

        return {
            seen: stories.length,
            total: AMBIENT_STORY_COUNT,
            achievementUnlocked,
            freeBoostCredits: state.freeBoostCredits + (achievementUnlocked ? 1 : 0)
        }
    })
})
