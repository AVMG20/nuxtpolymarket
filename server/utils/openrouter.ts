import type { H3Event } from 'h3'

// Generic OpenRouter client for OpenAI-compatible chat completions, streamed or
// not. It needs `runtimeConfig.openRouterApiKey` (OPENROUTER_API_KEY). It knows
// nothing about any feature: callers pick the model (a slug like
// 'openai/gpt-4o-mini' or a '@preset/…' managed on OpenRouter), the messages and
// the tools, and run any tool calls that come back themselves.

export const OPENROUTER_API_BASE = 'https://openrouter.ai/api'

export interface OpenRouterToolCall {
    id: string
    type: 'function'
    function: {
        name: string
        /** JSON text. Normalised to '{}' when the model sent nothing. */
        arguments: string
    }
}

export type OpenRouterMessage
    = { role: 'system' | 'user', content: string }
    | { role: 'assistant', content: string | null, tool_calls?: OpenRouterToolCall[] }
    | { role: 'tool', tool_call_id: string, content: string }

export interface OpenRouterTool {
    type: 'function'
    function: {
        name: string
        description?: string
        /** JSON Schema for the arguments. */
        parameters?: Record<string, unknown>
    }
}

export interface OpenRouterChatRequest {
    model: string
    messages: OpenRouterMessage[]
    tools?: OpenRouterTool[]
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function', function: { name: string } }
    temperature?: number
    max_tokens?: number
    /** Any other OpenRouter request field (response_format, provider, reasoning, …). */
    [field: string]: unknown
}

export interface OpenRouterChatResult {
    content: string
    toolCalls: OpenRouterToolCall[]
}

export interface OpenRouterRequestOptions {
    /** Resolves runtime config per request; optional outside a request. */
    event?: H3Event
    signal?: AbortSignal
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

interface OpenRouterCompletion {
    error?: { message?: string }
    choices?: Array<{
        message?: {
            content?: string | null
            tool_calls?: ToolCallFragment[]
        }
    }>
}

export function isOpenRouterConfigured(event?: H3Event) {
    return !!useRuntimeConfig(event).openRouterApiKey
}

/** Request headers for any OpenRouter endpoint, or null when no API key is configured. */
export function openRouterHeaders(event?: H3Event): Record<string, string> | null {
    const config = useRuntimeConfig(event)
    if (!config.openRouterApiKey) return null
    return {
        'Authorization': `Bearer ${config.openRouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': config.betterAuthUrl,
        'X-OpenRouter-Title': 'Polynux'
    }
}

/**
 * POST a JSON body to an OpenRouter path (e.g. '/v1/chat/completions'). Throws
 * 503 when no API key is configured and 502 with the provider's message when
 * the request fails.
 */
export async function openRouterPost(path: string, body: unknown, options: OpenRouterRequestOptions = {}) {
    const headers = openRouterHeaders(options.event)
    if (!headers) throw createError({ statusCode: 503, statusMessage: 'OpenRouter is not configured' })

    const response = await fetch(`${OPENROUTER_API_BASE}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal
    })
    if (!response.ok) {
        const text = await response.text()
        let message = `OpenRouter request failed (${response.status})`
        try {
            const parsed = JSON.parse(text) as { error?: { message?: string } }
            if (parsed.error?.message) message = parsed.error.message
        } catch {
            if (text.trim()) message = text.trim().slice(0, 300)
        }
        throw createError({ statusCode: 502, statusMessage: message })
    }
    return response
}

/** One chat completion, returned whole. */
export async function openRouterChat(request: OpenRouterChatRequest, options: OpenRouterRequestOptions = {}): Promise<OpenRouterChatResult> {
    const response = await openRouterPost('/v1/chat/completions', { ...request, stream: false }, options)
    const data = await response.json() as OpenRouterCompletion
    if (data.error) throw createError({ statusCode: 502, statusMessage: data.error.message ?? 'OpenRouter request failed' })

    const message = data.choices?.[0]?.message
    const calls = new Map<number, OpenRouterToolCall>()
    for (const [index, fragment] of (message?.tool_calls ?? []).entries()) {
        appendToolCallFragment(calls, { index, ...fragment })
    }
    return { content: message?.content ?? '', toolCalls: finalizeToolCalls(calls) }
}

/** One streamed chat completion. Text deltas go to `onText` as they arrive. */
export async function openRouterChatStream(
    request: OpenRouterChatRequest,
    options: OpenRouterRequestOptions & {
        onText?: (content: string) => void | Promise<void>
        /** Tool call ids that must not be reused (e.g. ids already in the conversation). */
        takenToolCallIds?: Iterable<string>
    } = {}
): Promise<OpenRouterChatResult> {
    const response = await openRouterPost('/v1/chat/completions', { ...request, stream: true }, options)
    if (!response.body) throw createError({ statusCode: 502, statusMessage: 'OpenRouter returned no response stream' })

    const { content, toolCalls } = await readCompletionStream(response.body, options.onText)
    return { content, toolCalls: finalizeToolCalls(toolCalls, options.takenToolCallIds) }
}

/**
 * Fold one streamed tool-call fragment into the calls seen so far. OpenAI-style
 * streams send `index` on every fragment and `id`/`name` once, then the
 * arguments in pieces. Other providers resend the id on each chunk, omit
 * `index`, or send arguments as an object, so this merges by index when
 * present, otherwise by the newest call, and never appends to an id or name
 * that is already set.
 */
export function appendToolCallFragment(calls: Map<number, OpenRouterToolCall>, fragment: ToolCallFragment) {
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

function randomToken() {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

/**
 * Turn collected fragments into usable calls: drops calls with no name,
 * normalises empty arguments to `{}` so they parse as JSON, and makes every id
 * unique, also against `takenIds`. Some providers derive the id from the call's
 * content, so the same call made twice can arrive with the same id.
 */
export function finalizeToolCalls(calls: Map<number, OpenRouterToolCall>, takenIds: Iterable<string> = []): OpenRouterToolCall[] {
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
    const toolCalls = new Map<number, OpenRouterToolCall>()
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
