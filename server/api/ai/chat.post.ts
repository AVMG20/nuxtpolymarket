import { and, eq, isNull } from 'drizzle-orm'
import { createEventStream } from 'h3'
import { db } from '#server/database'
import { aiConversations } from '#server/database/schema'
import { continueAiConversation, getAiContextStatus, getErrorMessage } from '#server/utils/ai'
import { requireAiUser } from '#server/utils/ai-auth'
import { consumeAiPrompt, getAiUsage } from '#server/utils/ai-usage'

export default defineEventHandler(async (event) => {
    const currentUser = await requireAiUser(event)
    const body = await readBody<{ conversationId?: string, message?: string }>(event)
    const message = body.message?.trim() ?? ''
    if (!message || message.length > 2000) {
        throw createError({ statusCode: 400, statusMessage: 'Message must be between 1 and 2,000 characters' })
    }

    let conversationId = body.conversationId ?? ''
    let conversation = conversationId
        ? await db.query.aiConversations.findFirst({
            where: and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, currentUser.id), isNull(aiConversations.deletedAt))
        })
        : null
    if (conversationId && !conversation) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })

    if (!conversation) {
        const [created] = await db.insert(aiConversations).values({
            userId: currentUser.id,
            title: message.slice(0, 60)
        }).returning()
        conversation = created
        conversationId = created!.id
    } else if (conversation.title === 'New chat') {
        await db.update(aiConversations).set({ title: message.slice(0, 60), updatedAt: new Date() }).where(eq(aiConversations.id, conversationId))
    }

    const context = await getAiContextStatus(conversationId, currentUser.id)
    if (context.blocked) {
        throw createError({ statusCode: 409, statusMessage: 'This chat reached its context limit. Start a new chat to continue.' })
    }

    await consumeAiPrompt(currentUser.id, conversationId, message)
    await db.update(aiConversations).set({ updatedAt: new Date() }).where(eq(aiConversations.id, conversationId))
    const stream = createEventStream(event)

    void (async () => {
        try {
            await stream.push({ data: JSON.stringify({ type: 'conversation', conversationId }) })
            const result = await continueAiConversation(event, conversationId, currentUser.id, async (content) => {
                await stream.push({ data: JSON.stringify({ type: 'delta', content }) })
            })
            await stream.push({
                data: JSON.stringify({
                    type: 'done',
                    conversationId,
                    ...result,
                    usage: await getAiUsage(currentUser.id)
                })
            })
        } catch (error) {
            await stream.push({ data: JSON.stringify({ type: 'error', message: getErrorMessage(error) }) }).catch(() => undefined)
        } finally {
            await stream.close()
        }
    })()

    return stream.send()
})
