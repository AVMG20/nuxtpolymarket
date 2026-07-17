import type { AiToolCall } from '#shared/utils/ai'

// Shared between conversation persistence and the OpenRouter transport: both
// need to agree on the wire shape of a message going to/from the model.
export type OpenRouterMessage
    = { role: 'system' | 'user', content: string }
    | { role: 'assistant', content: string | null, tool_calls?: AiToolCall[] }
    | { role: 'tool', tool_call_id: string, content: string }
