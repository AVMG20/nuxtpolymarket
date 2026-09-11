import { describe, expect, it } from 'vitest'
import { appendToolCallFragment, finalizeToolCalls, readCompletionStream, usedToolCallIds } from '#server/utils/ai/transport'
import type { AiToolCall } from '#shared/utils/ai'

function sse(...payloads: unknown[]) {
  const text = payloads.map(payload => `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`).join('')
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
    const calls = new Map<number, AiToolCall>()
    appendToolCallFragment(calls, { index: 0, id: 'call_a', type: 'function', function: { name: 'run_miner_dailies', arguments: '' } })
    appendToolCallFragment(calls, { index: 0, function: { arguments: '' } })
    appendToolCallFragment(calls, { index: 0, function: { arguments: '{}' } })
    appendToolCallFragment(calls, { index: 1, id: 'call_b', function: { name: 'run_colony_dailies', arguments: '{"feed' } })
    appendToolCallFragment(calls, { index: 1, function: { arguments: 'Method": "coins"}' } })
    expect([...calls.values()]).toEqual([
      { id: 'call_a', type: 'function', function: { name: 'run_miner_dailies', arguments: '{}' } },
      { id: 'call_b', type: 'function', function: { name: 'run_colony_dailies', arguments: '{"feedMethod": "coins"}' } }
    ])
  })

  it('does not duplicate an id or name that a provider resends on every chunk', () => {
    const calls = new Map<number, AiToolCall>()
    appendToolCallFragment(calls, { index: 0, id: 'call_a', function: { name: 'get_bank_status', arguments: '{' } })
    appendToolCallFragment(calls, { index: 0, id: 'call_a', function: { name: 'get_bank_status', arguments: '}' } })
    expect(calls.get(0)).toEqual({ id: 'call_a', type: 'function', function: { name: 'get_bank_status', arguments: '{}' } })
  })

  it('starts a new call when an index-less fragment carries a fresh id', () => {
    const calls = new Map<number, AiToolCall>()
    appendToolCallFragment(calls, { id: 'call_a', function: { name: 'run_miner_dailies', arguments: '{}' } })
    appendToolCallFragment(calls, { id: 'call_b', function: { name: 'run_xeno_dailies', arguments: '{}' } })
    expect([...calls.values()].map(call => call.function.name)).toEqual(['run_miner_dailies', 'run_xeno_dailies'])
  })

  it('serialises arguments that arrive as an object', () => {
    const calls = new Map<number, AiToolCall>()
    appendToolCallFragment(calls, { index: 0, id: 'call_a', function: { name: 'trade_gems', arguments: { action: 'buy', gems: 3 } } })
    expect(calls.get(0)?.function.arguments).toBe('{"action":"buy","gems":3}')
  })
})

describe('finalizeToolCalls', () => {
  const call = (id: string, name: string, args = ''): [number, AiToolCall] => [0, { id, type: 'function', function: { name, arguments: args } }]

  it('normalises empty arguments to an empty object', () => {
    const [finalized] = finalizeToolCalls(new Map([call('call_a', 'run_miner_dailies', '  ')]))
    expect(finalized?.function.arguments).toBe('{}')
  })

  it('drops calls without a name and orders by index', () => {
    const calls = new Map<number, AiToolCall>([
      [2, { id: 'c', type: 'function', function: { name: 'third', arguments: '{}' } }],
      [1, { id: 'b', type: 'function', function: { name: '', arguments: '{}' } }],
      [0, { id: 'a', type: 'function', function: { name: 'first', arguments: '{}' } }]
    ])
    expect(finalizeToolCalls(calls).map(item => item.function.name)).toEqual(['first', 'third'])
  })

  it('renames an id already used earlier in the conversation', () => {
    const [finalized] = finalizeToolCalls(new Map([call('chatcmpl-tool-1', 'run_miner_dailies', '{}')]), ['chatcmpl-tool-1'])
    expect(finalized?.id).not.toBe('chatcmpl-tool-1')
    expect(finalized?.id.startsWith('chatcmpl-tool-1_')).toBe(true)
  })

  it('renames the second of two identical ids in one response', () => {
    const calls = new Map<number, AiToolCall>([
      [0, { id: 'same', type: 'function', function: { name: 'purchase_miner_upgrades', arguments: '{"upgrade":"rig","levels":1}' } }],
      [1, { id: 'same', type: 'function', function: { name: 'purchase_miner_upgrades', arguments: '{"upgrade":"rig","levels":1}' } }]
    ])
    const ids = finalizeToolCalls(calls).map(item => item.id)
    expect(ids[0]).toBe('same')
    expect(ids[1]).not.toBe('same')
    expect(new Set(ids).size).toBe(2)
  })

  it('invents an id when the provider sent none', () => {
    const [finalized] = finalizeToolCalls(new Map([call('', 'get_bank_status')]))
    expect(finalized?.id).toMatch(/^call_[0-9a-f]{8}$/)
  })
})

describe('usedToolCallIds', () => {
  it('collects ids from assistant tool calls and tool results', () => {
    const rows = [
      { role: 'assistant', toolCallId: null, toolCalls: [{ id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', toolCallId: 'a', toolCalls: null },
      { role: 'assistant', toolCallId: null, toolCalls: null }
    ] as unknown as Parameters<typeof usedToolCallIds>[0]
    expect([...usedToolCallIds(rows)]).toEqual(['a'])
  })
})

describe('readCompletionStream', () => {
  it('collects text deltas and tool call fragments across chunk boundaries', async () => {
    const seen: string[] = []
    const result = await readCompletionStream(sse(
      delta({ role: 'assistant', content: 'Running ' }),
      delta({ content: 'now.' }),
      delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'run_miner_dailies', arguments: '' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] }, 'tool_calls'),
      '[DONE]'
    ), text => { seen.push(text) })
    expect(result.content).toBe('Running now.')
    expect(seen).toEqual(['Running ', 'now.'])
    expect(finalizeToolCalls(result.toolCalls)).toEqual([
      { id: 'call_a', type: 'function', function: { name: 'run_miner_dailies', arguments: '{}' } }
    ])
  })

  it('surfaces a provider error event', async () => {
    await expect(readCompletionStream(sse({ error: { message: 'Provider overloaded' } }))).rejects.toMatchObject({ statusMessage: 'Provider overloaded' })
  })

  it('rejects malformed JSON', async () => {
    await expect(readCompletionStream(sse('{not json'))).rejects.toMatchObject({ statusCode: 502 })
  })
})
