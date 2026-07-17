import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db } from '#server/database'
import { aiMessages } from '#server/database/schema'
import type { AiToolCall } from '#shared/utils/ai'
import { conversationMessages, getAiContextStatus, insertToolResult, toOpenAiMessages } from './conversations'
import { executeAiTool } from './executors'
import { getErrorMessage } from './helpers'
import { AI_TOOLS, toolRequiresConfirmation } from './tools'
import type { OpenRouterMessage } from './types'

interface OpenRouterStreamChunk {
    error?: { message?: string }
    choices?: Array<{
        delta?: {
            content?: string | null
            tool_calls?: Array<{
                index: number
                id?: string
                type?: 'function'
                function?: { name?: string, arguments?: string }
            }>
        }
        finish_reason?: string | null
    }>
}

async function openRouterStream(
    event: H3Event,
    messages: OpenRouterMessage[],
    onText?: (content: string) => void | Promise<void>
) {
    const config = useRuntimeConfig(event)
    if (!config.openRouterApiKey) {
        throw createError({ statusCode: 503, statusMessage: 'The AI assistant is not configured' })
    }

    const model = config.openRouterModel
    const isGpt5 = typeof model === 'string' && /(?:^|\/)gpt-5(?:$|-)/.test(model)
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': config.betterAuthUrl,
            'X-OpenRouter-Title': 'Polynux'
        },
        body: JSON.stringify({
            model: '@preset/poly-nuxt',
            messages,
            tools: AI_TOOLS,
            tool_choice: 'auto',
            stream: true
        })
    })
    if (!response.ok) {
        const body = await response.text()
        let message = `OpenRouter request failed (${response.status})`
        try {
            const parsed = JSON.parse(body) as { error?: { message?: string } }
            if (parsed.error?.message) message = parsed.error.message
        } catch {
            if (body.trim()) message = body.trim().slice(0, 300)
        }
        throw createError({ statusCode: 502, statusMessage: message })
    }
    if (!response.body) throw createError({ statusCode: 502, statusMessage: 'OpenRouter returned no response stream' })

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const streamedTools = new Map<number, AiToolCall>()
    let content = ''
    let buffer = ''

    async function processEvent(rawEvent: string) {
        const data = rawEvent
            .split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n')
        if (!data || data === '[DONE]') return

        let chunk: OpenRouterStreamChunk
        try {
            chunk = JSON.parse(data) as OpenRouterStreamChunk
        } catch {
            throw createError({ statusCode: 502, statusMessage: 'OpenRouter returned an invalid stream event' })
        }
        if (chunk.error) throw createError({ statusCode: 502, statusMessage: chunk.error.message ?? 'OpenRouter stream failed' })

        const delta = chunk.choices?.[0]?.delta
        if (typeof delta?.content === 'string' && delta.content) {
            content += delta.content
            await onText?.(delta.content)
        }
        for (const fragment of delta?.tool_calls ?? []) {
            const current = streamedTools.get(fragment.index) ?? {
                id: '',
                type: 'function' as const,
                function: { name: '', arguments: '' }
            }
            if (fragment.id) current.id += fragment.id
            if (fragment.function?.name) current.function.name += fragment.function.name
            if (fragment.function?.arguments) current.function.arguments += fragment.function.arguments
            streamedTools.set(fragment.index, current)
        }
    }

    while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const events = buffer.split(/\r?\n\r?\n/)
        buffer = events.pop() ?? ''
        for (const rawEvent of events) await processEvent(rawEvent)
        if (done) break
    }
    if (buffer.trim()) await processEvent(buffer)

    const toolCalls = [...streamedTools.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, toolCall]) => toolCall)
        .filter(toolCall => toolCall.id && toolCall.function.name)
    return { content, toolCalls }
}

export async function continueAiConversation(
    event: H3Event,
    conversationId: string,
    userId: string,
    onText?: (content: string) => void | Promise<void>,
    onAssistantMessage?: (messageId: string) => void | Promise<void>,
    onToolResolved?: (toolCallId: string, result: unknown) => void | Promise<void>
) {
    let lastMessageId = ''
    for (let round = 0; round < 4; round++) {
        const rows = await conversationMessages(conversationId, userId)
        const response = await openRouterStream(event, toOpenAiMessages(rows), onText)
        const toolCalls = response.toolCalls
        const [saved] = await db.insert(aiMessages).values({
            conversationId,
            userId,
            role: 'assistant',
            content: response.content,
            toolCalls: toolCalls.length ? toolCalls : null
        }).returning({ id: aiMessages.id })
        lastMessageId = saved?.id ?? ''
        if (lastMessageId) await onAssistantMessage?.(lastMessageId)

        if (!toolCalls.length) break
        const canAutoApprove = getCookie(event, 'ai_auto_approve') === 'true'
        const executableTools = toolCalls.filter(toolCall => canAutoApprove || !toolRequiresConfirmation(toolCall))
        if (!executableTools.length) break
        for (const toolCall of executableTools) {
            try {
                const result = await executeAiTool(event, toolCall)
                await insertToolResult(conversationId, userId, toolCall, result)
                await onToolResolved?.(toolCall.id, result)
            } catch (error) {
                const result = {
                    error: getErrorMessage(error)
                }
                await insertToolResult(conversationId, userId, toolCall, result)
                await onToolResolved?.(toolCall.id, result)
            }
        }
    }

    return { lastMessageId, context: await getAiContextStatus(conversationId, userId) }
}

export async function resolveAiToolCall(
    event: H3Event,
    conversationId: string,
    userId: string,
    assistantMessageId: string,
    toolCallId: string,
    approved: boolean,
    onText?: (content: string) => void | Promise<void>,
    onToolResolved?: (toolCallId: string, result: unknown) => void | Promise<void>,
    onAssistantMessage?: (messageId: string) => void | Promise<void>
) {
    const assistant = await db.query.aiMessages.findFirst({
        where: and(
            eq(aiMessages.id, assistantMessageId),
            eq(aiMessages.conversationId, conversationId),
            eq(aiMessages.userId, userId),
            eq(aiMessages.role, 'assistant')
        )
    })
    const toolCalls = (assistant?.toolCalls ?? []) as AiToolCall[]
    const toolCall = toolCalls.find(call => call.id === toolCallId)
    if (!assistant || !toolCall) throw createError({ statusCode: 404, statusMessage: 'Pending tool call not found' })

    const existing = await db.query.aiMessages.findFirst({
        where: and(
            eq(aiMessages.conversationId, conversationId),
            eq(aiMessages.userId, userId),
            eq(aiMessages.toolCallId, toolCallId)
        )
    })
    if (existing) throw createError({ statusCode: 409, statusMessage: 'This tool call was already resolved' })

    if (!approved) {
        const result = { declined: true, message: 'The player declined this action.' }
        await insertToolResult(conversationId, userId, toolCall, result)
        await onToolResolved?.(toolCall.id, result)
    } else {
        let result: unknown
        try {
            result = await executeAiTool(event, toolCall)
        } catch (error) {
            result = { error: getErrorMessage(error) }
        }
        await insertToolResult(conversationId, userId, toolCall, result)
        await onToolResolved?.(toolCall.id, result)
    }

    const rows = await conversationMessages(conversationId, userId)
    const resolvedIds = new Set(rows.filter(row => row.role === 'tool' && row.toolCallId).map(row => row.toolCallId))
    const allResolved = toolCalls.every(call => resolvedIds.has(call.id))
    if (allResolved) await continueAiConversation(event, conversationId, userId, onText, onAssistantMessage, onToolResolved)

    return { context: await getAiContextStatus(conversationId, userId) }
}
