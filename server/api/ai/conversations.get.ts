import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '#server/database'
import { aiConversations } from '#server/database/schema'
import { requireAiUser } from '#server/utils/ai-auth'
import { getAiUsage } from '#server/utils/ai-usage'

export default defineEventHandler(async (event) => {
    const currentUser = await requireAiUser(event)
    const [conversations, usage] = await Promise.all([
        db.query.aiConversations.findMany({
            where: and(eq(aiConversations.userId, currentUser.id), isNull(aiConversations.deletedAt)),
            orderBy: [desc(aiConversations.updatedAt)]
        }),
        getAiUsage(currentUser.id)
    ])

    return {
        conversations: conversations.map(conversation => ({
            id: conversation.id,
            title: conversation.title,
            createdAt: conversation.createdAt.toISOString(),
            updatedAt: conversation.updatedAt.toISOString()
        })),
        usage
    }
})
