import { db } from '#server/database'
import { aiConversations } from '#server/database/schema'
import { requireAiUser } from '#server/utils/ai-auth'

export default defineEventHandler(async (event) => {
    const currentUser = await requireAiUser(event)
    const [conversation] = await db.insert(aiConversations).values({ userId: currentUser.id }).returning()
    return conversation
})
