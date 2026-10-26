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

  it('starts a new call when an index-less fragment carries a fresh id', () => {
    const calls = new Map<number, OpenRouterToolCall>()
    appendToolCallFragment(calls, { id: 'call_a', function: { name: 'first_tool', arguments: '{}' } })
    appendToolCallFragment(calls, { id: 'call_b', function: { name: 'second_tool', arguments: '{}' } })
    expect([...calls.values()].map(call => call.function.name)).toEqual(['first_tool', 'second_tool'])
  })

  it('serialises arguments that arrive as an object', () => {
    const calls = new Map<number, OpenRouterToolCall>()
    appendToolCallFragment(calls, { index: 0, id: 'call_a', function: { name: 'trade', arguments: { action: 'buy', gems: 3 } } })
    expect(calls.get(0)?.function.arguments).toBe('{"action":"buy","gems":3}')
  })
})

describe('finalizeToolCalls', () => {
  const call = (id: string, name: string, args = ''): [number, OpenRouterToolCall] => [0, { id, type: 'function', function: { name, arguments: args } }]

  it('normalises empty arguments to an empty object', () => {
    const [finalized] = finalizeToolCalls(new Map([call('call_a', 'first_tool', '  ')]))
    expect(finalized?.function.arguments).toBe('{}')
  })

  it('drops calls without a name and orders by index', () => {
    const calls = new Map<number, OpenRouterToolCall>([
      [2, { id: 'c', type: 'function', function: { name: 'third', arguments: '{}' } }],
      [1, { id: 'b', type: 'function', function: { name: '', arguments: '{}' } }],
      [0, { id: 'a', type: 'function', function: { name: 'first', arguments: '{}' } }]
    ])
    expect(finalizeToolCalls(calls).map(item => item.function.name)).toEqual(['first', 'third'])
  })

  it('renames an id that is already taken', () => {
    const [finalized] = finalizeToolCalls(new Map([call('chatcmpl-tool-1', 'first_tool', '{}')]), ['chatcmpl-tool-1'])
    expect(finalized?.id).not.toBe('chatcmpl-tool-1')
    expect(finalized?.id.startsWith('chatcmpl-tool-1_')).toBe(true)
  })

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

  it('invents an id when the provider sent none', () => {
    const [finalized] = finalizeToolCalls(new Map([call('', 'get_status')]))
    expect(finalized?.id).toMatch(/^call_[0-9a-f]{8}$/)
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

  it('rejects malformed JSON', async () => {
    await expect(readCompletionStream(sse('{not json'))).rejects.toMatchObject({ statusCode: 502 })
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

  it('returns the message content and tool calls of a whole completion', async () => {
    configure('key')
    const fetchMock = vi.fn(async () => Response.json({
      choices: [{ message: { content: 'Done.', tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'first_tool', arguments: '' } }] } }]
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await openRouterChat(request)
    expect(result).toEqual({ content: 'Done.', toolCalls: [{ id: 'call_a', type: 'function', function: { name: 'first_tool', arguments: '{}' } }] })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key')
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'test/model', stream: false })
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

  it('surfaces the provider error message of a failed request', async () => {
    configure('key')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'No credits' } }, { status: 402 })))
    await expect(openRouterChat(request)).rejects.toMatchObject({ statusCode: 502, statusMessage: 'No credits' })
  })
})
