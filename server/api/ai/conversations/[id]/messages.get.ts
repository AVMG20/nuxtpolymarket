import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '#server/database'
import { aiConversations, aiMessages } from '#server/database/schema'
import { requireAiUser } from '#server/utils/ai-auth'
import { getAiContextStatus } from '#server/utils/ai'
import type { AiToolCall } from '#shared/utils/ai'

export default defineEventHandler(async (event) => {
    const currentUser = await requireAiUser(event)
    const id = getRouterParam(event, 'id') ?? ''
    const conversation = await db.query.aiConversations.findFirst({
        where: and(eq(aiConversations.id, id), eq(aiConversations.userId, currentUser.id), isNull(aiConversations.deletedAt))
    })
    if (!conversation) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })

    const messages = await db.query.aiMessages.findMany({
        where: and(eq(aiMessages.conversationId, id), eq(aiMessages.userId, currentUser.id)),
        orderBy: [asc(aiMessages.createdAt)]
    })
    return {
        conversation: { id: conversation.id, title: conversation.title },
        messages: messages.map(message => ({
            id: message.id,
            role: message.role,
            content: message.content,
            toolCalls: (message.toolCalls ?? []) as AiToolCall[],
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            createdAt: message.createdAt.toISOString()
        })),
        context: await getAiContextStatus(id, currentUser.id)
    }
})
