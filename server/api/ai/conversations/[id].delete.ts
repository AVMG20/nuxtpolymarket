import { and, eq, isNull } from 'drizzle-orm'
import { db } from '#server/database'
import { aiConversations, aiMessages } from '#server/database/schema'
import { requireAiUser } from '#server/utils/ai-auth'

export default defineEventHandler(async (event) => {
    const currentUser = await requireAiUser(event)
    const id = getRouterParam(event, 'id') ?? ''
    const deleted = await db.transaction(async (tx) => {
        const rows = await tx.update(aiConversations)
            .set({ title: 'Deleted chat', deletedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, currentUser.id), isNull(aiConversations.deletedAt)))
            .returning({ id: aiConversations.id })
        if (rows.length) {
            // Retain empty user-role rows as the monthly quota ledger while erasing chat content.
            await tx.update(aiMessages)
                .set({ content: '', toolCalls: null, toolCallId: null, toolName: null })
                .where(and(eq(aiMessages.conversationId, id), eq(aiMessages.userId, currentUser.id)))
        }
        return rows
    })
    if (!deleted.length) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
    return { ok: true }
})
