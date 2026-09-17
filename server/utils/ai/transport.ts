import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db } from '#server/database'
import { aiMessages } from '#server/database/schema'
import type { AiToolCall } from '#shared/utils/ai'
import { shouldToolAutoRun } from '#shared/utils/ai-guard'
import { conversationMessages, getAiContextStatus, insertToolResult, toOpenAiMessages } from './conversations'
import { executeAiTool } from './executors'
import { getAiGuard, getErrorMessage } from './helpers'
import { AI_TOOLS } from './tools'
import type { OpenRouterMessage } from './types'

/**
 * Model calls one user message may trigger. Each round is one completion; a
 * round that returns tool calls runs them and starts the next. The last round
 * is forced to answer in text so a tool loop can never leave the player with
 * pending calls nobody will execute.
 */
export const MAX_TOOL_ROUNDS = 8

export interface AiStreamCallbacks {
    onText?: (content: string) => void | Promise<void>
    onAssistantMessage?: (messageId: string) => void | Promise<void>
    onToolResolved?: (toolCallId: string, result: unknown) => void | Promise<void>
}

export interface ToolCallFragment {
    index?: number
    id?: string
    type?: string
    function?: { name?: string, arguments?: unknown }
}

interface OpenRouterStreamChunk {
    error?: { message?: string }
    choices?: Array<{
        delta?: {
            content?: string | null
            tool_calls?: ToolCallFragment[]
        }
        finish_reason?: string | null
    }>
}

/**
 * Fold one streamed tool-call fragment into the calls seen so far. OpenAI-style
 * streams send `index` on every fragment and `id`/`name` once, then the
 * arguments in pieces. Other providers behind the same preset resend the id on
 * each chunk, omit `index`, or send arguments as an object, so this merges by
 * index when present, otherwise by the newest call, and never appends to an id
 * or name that is already set.
 */
export function appendToolCallFragment(calls: Map<number, AiToolCall>, fragment: ToolCallFragment) {
    const lastKey = calls.size ? Math.max(...calls.keys()) : -1
    let key = typeof fragment.index === 'number' ? fragment.index : Math.max(lastKey, 0)
    const existing = calls.get(key)
    if (typeof fragment.index !== 'number' && existing?.id && fragment.id && fragment.id !== existing.id) key = lastKey + 1

    const current = calls.get(key) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
    if (fragment.id && !current.id) current.id = fragment.id
    if (fragment.function?.name && !current.function.name) current.function.name = fragment.function.name
    const args = fragment.function?.arguments
    if (typeof args === 'string') current.function.arguments += args
    else if (args && typeof args === 'object') current.function.arguments += JSON.stringify(args)
    calls.set(key, current)
}

/** Every tool call id already used in the conversation, from both sides of the exchange. */
export function usedToolCallIds(rows: Awaited<ReturnType<typeof conversationMessages>>) {
    const ids = new Set<string>()
    for (const row of rows) {
        if (row.toolCallId) ids.add(row.toolCallId)
        for (const call of (row.toolCalls ?? []) as AiToolCall[]) ids.add(call.id)
    }
    return ids
}

function randomToken() {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

/**
 * Turn streamed fragments into the calls that get persisted. Drops calls with no
 * name, normalises empty arguments to `{}` so the executor and the next model
 * round both see valid JSON, and guarantees the id is unique in the
 * conversation. Some providers derive the id from the call's content, so the
 * same daily invoked twice in one chat arrives with the same id, which would
 * make the second one look already resolved.
 */
export function finalizeToolCalls(calls: Map<number, AiToolCall>, takenIds: Iterable<string> = []): AiToolCall[] {
    const taken = new Set(takenIds)
    return [...calls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call]) => call)
        .filter(call => call.function.name)
        .map((call) => {
            const base = call.id || 'call'
            let id = call.id || `${base}_${randomToken()}`
            while (taken.has(id)) id = `${base}_${randomToken()}`
            taken.add(id)
            return {
                id,
                type: 'function' as const,
                function: {
                    name: call.function.name,
                    arguments: call.function.arguments.trim() || '{}'
                }
            }
        })
}

/** Read an OpenAI-compatible SSE completion stream, forwarding text deltas as they arrive. */
export async function readCompletionStream(
    body: ReadableStream<Uint8Array>,
    onText?: (content: string) => void | Promise<void>
) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    const toolCalls = new Map<number, AiToolCall>()
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
        for (const fragment of delta?.tool_calls ?? []) appendToolCallFragment(toolCalls, fragment)
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

    return { content, toolCalls }
}

async function openRouterStream(
    event: H3Event,
    messages: OpenRouterMessage[],
    options: { toolChoice: 'auto' | 'none', onText?: (content: string) => void | Promise<void> }
) {
    const config = useRuntimeConfig(event)
    if (!config.openRouterApiKey) {
        throw createError({ statusCode: 503, statusMessage: 'The AI assistant is not configured' })
    }

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
            tool_choice: options.toolChoice,
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

    return readCompletionStream(response.body, options.onText)
}

/** Execute one tool call, persist its result (or the error), and tell the client. */
async function runToolCall(
    event: H3Event,
    conversationId: string,
    userId: string,
    toolCall: AiToolCall,
    onToolResolved?: AiStreamCallbacks['onToolResolved']
) {
    let result: unknown
    try {
        result = await executeAiTool(event, toolCall)
    } catch (error) {
        result = { error: getErrorMessage(error) }
    }
    await insertToolResult(conversationId, userId, toolCall, result)
    await onToolResolved?.(toolCall.id, result)
    return result
}

export async function continueAiConversation(
    event: H3Event,
    conversationId: string,
    userId: string,
    callbacks: AiStreamCallbacks = {}
) {
    let lastMessageId = ''
    for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
        const rows = await conversationMessages(conversationId, userId)
        const finalRound = round === MAX_TOOL_ROUNDS
        const response = await openRouterStream(event, toOpenAiMessages(rows), {
            toolChoice: finalRound ? 'none' : 'auto',
            onText: callbacks.onText
        })
        const toolCalls = finalRound ? [] : finalizeToolCalls(response.toolCalls, usedToolCallIds(rows))
        const [saved] = await db.insert(aiMessages).values({
            conversationId,
            userId,
            role: 'assistant',
            content: response.content,
            toolCalls: toolCalls.length ? toolCalls : null
        }).returning({ id: aiMessages.id })
        lastMessageId = saved?.id ?? ''
        if (lastMessageId) await callbacks.onAssistantMessage?.(lastMessageId)

        if (!toolCalls.length) break
        const guard = getAiGuard(event)
        const autoRun = toolCalls.filter(toolCall => shouldToolAutoRun(toolCall, guard))
        for (const toolCall of autoRun) await runToolCall(event, conversationId, userId, toolCall, callbacks.onToolResolved)

        // Anything left needs the player's approval. Calling the model again now
        // would show it unanswered tool calls, and it re-issues them; the approval
        // endpoint resumes the conversation once every call has a result.
        if (autoRun.length < toolCalls.length) break
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
    callbacks: AiStreamCallbacks = {}
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

    if (approved) {
        await runToolCall(event, conversationId, userId, toolCall, callbacks.onToolResolved)
    } else {
        const result = { declined: true, message: 'The player declined this action.' }
        await insertToolResult(conversationId, userId, toolCall, result)
        await callbacks.onToolResolved?.(toolCall.id, result)
    }

    const rows = await conversationMessages(conversationId, userId)
    const resolvedIds = new Set(rows.filter(row => row.role === 'tool' && row.toolCallId).map(row => row.toolCallId))
    const allResolved = toolCalls.every(call => resolvedIds.has(call.id))
    if (allResolved) await continueAiConversation(event, conversationId, userId, callbacks)

    return { context: await getAiContextStatus(conversationId, userId) }
}
