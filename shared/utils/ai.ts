export const AI_MONTHLY_PROMPT_LIMIT = 300
export const AI_CONTEXT_WARNING_MESSAGES = 40
export const AI_CONTEXT_MAX_MESSAGES = 60
export const AI_CONTEXT_WARNING_CHARS = 40_000
export const AI_CONTEXT_MAX_CHARS = 60_000

export type AiRole = 'user' | 'assistant' | 'tool'

export interface AiToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface AiMessageDto {
  id: string
  role: AiRole
  content: string
  toolCalls: AiToolCall[]
  toolCallId: string | null
  toolName: string | null
  createdAt: string
}

export interface AiContextStatus {
  messageCount: number
  characterCount: number
  warning: boolean
  blocked: boolean
}
