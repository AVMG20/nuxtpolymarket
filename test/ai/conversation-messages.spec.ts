import { describe, expect, it } from 'vitest'
import { toOpenAiMessages } from '#server/utils/ai/conversations'

type Row = Parameters<typeof toOpenAiMessages>[0][number]

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    role: 'user',
    content: '',
    toolCalls: null,
    toolCallId: null,
    toolName: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides
  } as Row
}

describe('toOpenAiMessages — user rows', () => {
  it('maps a user row to a user message with its content', () => {
    const [message] = toOpenAiMessages([makeRow({ role: 'user', content: 'hello' })])
    expect(message).toEqual({ role: 'user', content: 'hello' })
  })

  it('falls back to the user shape for any role that is not assistant or tool', () => {
    const [message] = toOpenAiMessages([makeRow({ role: 'system', content: 'hi' })])
    expect(message).toEqual({ role: 'user', content: 'hi' })
  })
})

describe('toOpenAiMessages — tool rows', () => {
  it('carries the tool call id and content', () => {
    const [message] = toOpenAiMessages([makeRow({ role: 'tool', toolCallId: 'call-1', content: '{"ok":true}' })])
    expect(message).toEqual({ role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' })
  })

  it('falls back to an empty tool_call_id when none is stored', () => {
    const [message] = toOpenAiMessages([makeRow({ role: 'tool', toolCallId: null, content: '{}' })])
    expect(message).toEqual({ role: 'tool', tool_call_id: '', content: '{}' })
  })
})

describe('toOpenAiMessages — assistant rows', () => {
  it('nulls out empty content instead of sending an empty string', () => {
    const [message] = toOpenAiMessages([makeRow({ role: 'assistant', content: '' })])
    expect(message).toEqual({ role: 'assistant', content: null })
    expect('tool_calls' in message).toBe(false)
  })

  it('keeps non-empty content', () => {
    const [message] = toOpenAiMessages([makeRow({ role: 'assistant', content: 'thinking...' })])
    expect(message).toEqual({ role: 'assistant', content: 'thinking...' })
  })

  it('omits tool_calls when none are stored', () => {
    const [message] = toOpenAiMessages([makeRow({ role: 'assistant', content: 'ok', toolCalls: null })])
    expect('tool_calls' in message).toBe(false)
  })

  it('includes tool_calls when present', () => {
    const toolCalls = [{ id: 'call-1', type: 'function' as const, function: { name: 'get_bank_status', arguments: '{}' } }]
    const [message] = toOpenAiMessages([makeRow({ role: 'assistant', content: '', toolCalls })])
    expect(message).toEqual({ role: 'assistant', content: null, tool_calls: toolCalls })
  })
})

describe('toOpenAiMessages — ordering', () => {
  it('maps every row in the given order', () => {
    const rows = [
      makeRow({ role: 'user', content: 'first' }),
      makeRow({ role: 'assistant', content: 'second' }),
      makeRow({ role: 'tool', content: 'third', toolCallId: 'call-2' })
    ]
    const messages = toOpenAiMessages(rows)
    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual({ role: 'user', content: 'first' })
    expect(messages[1]).toEqual({ role: 'assistant', content: 'second' })
    expect(messages[2]).toEqual({ role: 'tool', tool_call_id: 'call-2', content: 'third' })
  })
})
