import { and, eq, isNull } from 'drizzle-orm'
import { createEventStream } from 'h3'
import { db } from '#server/database'
import { aiConversations } from '#server/database/schema'
import { getErrorMessage } from '#server/utils/ai/helpers'
import { resolveAiToolCall } from '#server/utils/ai/transport'
import { requireAiUser } from '#server/utils/ai-auth'

export default defineEventHandler(async (event) => {
    const currentUser = await requireAiUser(event)
    const body = await readBody<{
        conversationId?: string
        assistantMessageId?: string
        toolCallId?: string
        approved?: boolean
    }>(event)
    const conversationId = body.conversationId ?? ''
    const conversation = await db.query.aiConversations.findFirst({
        where: and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, currentUser.id), isNull(aiConversations.deletedAt))
    })
    if (!conversation) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
    if (!body.assistantMessageId || !body.toolCallId || typeof body.approved !== 'boolean') {
        throw createError({ statusCode: 400, statusMessage: 'Invalid tool confirmation' })
    }

    const stream = createEventStream(event)
    void (async () => {
        try {
            const result = await resolveAiToolCall(
                event,
                conversationId,
                currentUser.id,
                body.assistantMessageId!,
                body.toolCallId!,
                body.approved!,
                async (content) => {
                    await stream.push({ data: JSON.stringify({ type: 'delta', content }) })
                },
                async (toolCallId, result) => {
                    await stream.push({ data: JSON.stringify({ type: 'tool_result', toolCallId, result }) })
                },
                async (assistantMessageId) => {
                    await stream.push({ data: JSON.stringify({ type: 'assistant_message', assistantMessageId }) })
                }
            )
            await stream.push({ data: JSON.stringify({ type: 'done', conversationId, ...result }) })
        } catch (error) {
            await stream.push({ data: JSON.stringify({ type: 'error', message: getErrorMessage(error) }) }).catch(() => undefined)
        } finally {
            await stream.close()
        }
    })()

    return stream.send()
})
