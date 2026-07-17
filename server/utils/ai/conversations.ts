import { and, asc, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { aiMessages } from '#server/database/schema'
import {
    AI_CONTEXT_MAX_CHARS,
    AI_CONTEXT_MAX_MESSAGES,
    AI_CONTEXT_WARNING_CHARS,
    AI_CONTEXT_WARNING_MESSAGES,
    type AiContextStatus,
    type AiToolCall
} from '#shared/utils/ai'
import type { OpenRouterMessage } from './types'

export async function conversationMessages(conversationId: string, userId: string) {
    return db.query.aiMessages.findMany({
        where: and(eq(aiMessages.conversationId, conversationId), eq(aiMessages.userId, userId)),
        orderBy: [asc(aiMessages.createdAt)]
    })
}

export function toOpenAiMessages(rows: Awaited<ReturnType<typeof conversationMessages>>): OpenRouterMessage[] {
    return rows.map((row) => {
        if (row.role === 'tool') {
            return {
                role: 'tool',
                tool_call_id: row.toolCallId ?? '',
                content: row.content
            }
        }
        if (row.role === 'assistant') {
            const toolCalls = (row.toolCalls ?? []) as AiToolCall[]
            return {
                role: 'assistant',
                content: row.content || null,
                ...(toolCalls.length ? { tool_calls: toolCalls } : {})
            }
        }
        return { role: 'user', content: row.content }
    })
}

export async function getAiContextStatus(conversationId: string, userId: string): Promise<AiContextStatus> {
    const rows = await conversationMessages(conversationId, userId)
    const characterCount = rows.reduce((sum, row) => sum + row.content.length + JSON.stringify(row.toolCalls ?? '').length, 0)
    return {
        messageCount: rows.length,
        characterCount,
        warning: rows.length >= AI_CONTEXT_WARNING_MESSAGES || characterCount >= AI_CONTEXT_WARNING_CHARS,
        blocked: rows.length >= AI_CONTEXT_MAX_MESSAGES || characterCount >= AI_CONTEXT_MAX_CHARS
    }
}

export async function insertToolResult(conversationId: string, userId: string, toolCall: AiToolCall, result: unknown) {
    await db.insert(aiMessages).values({
        conversationId,
        userId,
        role: 'tool',
        content: JSON.stringify(result),
        toolCallId: toolCall.id,
        toolName: toolCall.function.name
    })
}
