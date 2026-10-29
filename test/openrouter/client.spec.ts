import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendToolCallFragment,
  finalizeToolCalls,
  openRouterChat,
  openRouterChatStream,
  readCompletionStream,
  type OpenRouterToolCall
} from '#server/utils/openrouter'

function sseText(...payloads: unknown[]) {
  return payloads.map(payload => `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`).join('')
}

function sse(...payloads: unknown[]) {
  const text = sseText(...payloads)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(text)
      // Split mid-event so the buffer join is exercised.
      controller.enqueue(bytes.slice(0, 17))
      controller.enqueue(bytes.slice(17))
      controller.close()
    }
  })
}

function delta(delta: Record<string, unknown>, finish: string | null = null) {
  return { choices: [{ delta, finish_reason: finish }] }
}

describe('appendToolCallFragment', () => {
  it('merges OpenAI-style fragments by index', () => {
    const calls = new Map<number, OpenRouterToolCall>()
    appendToolCallFragment(calls, { index: 0, id: 'call_a', type: 'function', function: { name: 'first_tool', arguments: '' } })
    appendToolCallFragment(calls, { index: 0, function: { arguments: '' } })
    appendToolCallFragment(calls, { index: 0, function: { arguments: '{}' } })
    appendToolCallFragment(calls, { index: 1, id: 'call_b', function: { name: 'second_tool', arguments: '{"feed' } })
    appendToolCallFragment(calls, { index: 1, function: { arguments: 'Method": "coins"}' } })
    expect([...calls.values()]).toEqual([
      { id: 'call_a', type: 'function', function: { name: 'first_tool', arguments: '{}' } },
      { id: 'call_b', type: 'function', function: { name: 'second_tool', arguments: '{"feedMethod": "coins"}' } }
    ])
  })

  it('does not duplicate an id or name that a provider resends on every chunk', () => {
    const calls = new Map<number, OpenRouterToolCall>()
    appendToolCallFragment(calls, { index: 0, id: 'call_a', function: { name: 'get_status', arguments: '{' } })
    appendToolCallFragment(calls, { index: 0, id: 'call_a', function: { name: 'get_status', arguments: '}' } })
    expect(calls.get(0)).toEqual({ id: 'call_a', type: 'function', function: { name: 'get_status', arguments: '{}' } })
  })
})

describe('finalizeToolCalls', () => {
  it('renames the second of two identical ids in one response', () => {
    const calls = new Map<number, OpenRouterToolCall>([
      [0, { id: 'same', type: 'function', function: { name: 'buy', arguments: '{"levels":1}' } }],
      [1, { id: 'same', type: 'function', function: { name: 'buy', arguments: '{"levels":1}' } }]
    ])
    const ids = finalizeToolCalls(calls).map(item => item.id)
    expect(ids[0]).toBe('same')
    expect(ids[1]).not.toBe('same')
    expect(new Set(ids).size).toBe(2)
  })
})

describe('readCompletionStream', () => {
  it('collects text deltas and tool call fragments across chunk boundaries', async () => {
    const seen: string[] = []
    const result = await readCompletionStream(sse(
      delta({ role: 'assistant', content: 'Running ' }),
      delta({ content: 'now.' }),
      delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'first_tool', arguments: '' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] }, 'tool_calls'),
      '[DONE]'
    ), text => { seen.push(text) })
    expect(result.content).toBe('Running now.')
    expect(seen).toEqual(['Running ', 'now.'])
    expect(finalizeToolCalls(result.toolCalls)).toEqual([
      { id: 'call_a', type: 'function', function: { name: 'first_tool', arguments: '{}' } }
    ])
  })

  it('surfaces a provider error event', async () => {
    await expect(readCompletionStream(sse({ error: { message: 'Provider overloaded' } }))).rejects.toMatchObject({ statusMessage: 'Provider overloaded' })
  })
})

describe('openRouterChat / openRouterChatStream', () => {
  const request = { model: 'test/model', messages: [{ role: 'user' as const, content: 'hi' }] }

  function configure(apiKey: string | undefined) {
    vi.stubGlobal('useRuntimeConfig', () => ({ openRouterApiKey: apiKey, betterAuthUrl: 'http://localhost:3000' }))
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses with 503 when no API key is configured', async () => {
    configure(undefined)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(openRouterChat(request)).rejects.toMatchObject({ statusCode: 503 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('streams text and keeps tool call ids unique against taken ids', async () => {
    configure('key')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseText(
      delta({ content: 'Hi' }),
      delta({ tool_calls: [{ index: 0, id: 'dup', function: { name: 'first_tool', arguments: '{}' } }] }),
      '[DONE]'
    ))))
    const seen: string[] = []
    const result = await openRouterChatStream(request, { onText: text => { seen.push(text) }, takenToolCallIds: ['dup'] })
    expect(seen).toEqual(['Hi'])
    expect(result.content).toBe('Hi')
    expect(result.toolCalls[0]?.id.startsWith('dup_')).toBe(true)
  })
})
