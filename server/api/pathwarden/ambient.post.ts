import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { pathwardenState } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import {
    PATHWARDEN_AMBIENT_MIN_INTERVAL_MS,
    PATHWARDEN_AMBIENT_STORY_COUNT
} from '#shared/utils/gamelogic/pathwarden'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ storyId?: number }>(event)
    const storyId = Math.floor(Number(body.storyId))
    if (!Number.isInteger(storyId) || storyId < 1 || storyId > PATHWARDEN_AMBIENT_STORY_COUNT) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown ambient story' })
    }

    return db.transaction(async (tx) => {
        await tx.insert(pathwardenState).values({ userId }).onConflictDoNothing()
        const [state] = await tx.select()
            .from(pathwardenState)
            .where(eq(pathwardenState.userId, userId))
            .for('update')
        if (!state) throw createError({ statusCode: 500, statusMessage: 'Could not initialize Pathwarden progress' })

        // Stories only surface during a march, and never faster than the in-game
        // timer allows — both guards defeat the "POST every id in a loop" forge
        // of the Village Chronicler reward.
        if (!state.runStartedAt) {
            throw createError({ statusCode: 409, statusMessage: 'Ambient stories only unfold during a march' })
        }
        const now = Date.now()
        if (state.lastAmbientStoryAt && now - state.lastAmbientStoryAt.getTime() < PATHWARDEN_AMBIENT_MIN_INTERVAL_MS) {
            throw createError({ statusCode: 429, statusMessage: 'That story has not had time to unfold yet' })
        }

        const stories = [...new Set([...state.ambientStoryIds, storyId])].sort((a, b) => a - b)
        const achievementUnlocked = stories.length === PATHWARDEN_AMBIENT_STORY_COUNT && !state.ambientRewardClaimed
        await tx.update(pathwardenState)
            .set({
                ambientStoryIds: stories,
                ambientRewardClaimed: state.ambientRewardClaimed || achievementUnlocked,
                freeBoostCredits: state.freeBoostCredits + (achievementUnlocked ? 1 : 0),
                lastAmbientStoryAt: new Date(now)
            })
            .where(eq(pathwardenState.userId, userId))

        return {
            seen: stories.length,
            total: PATHWARDEN_AMBIENT_STORY_COUNT,
            achievementUnlocked,
            freeBoostCredits: state.freeBoostCredits + (achievementUnlocked ? 1 : 0)
        }
    })
})
