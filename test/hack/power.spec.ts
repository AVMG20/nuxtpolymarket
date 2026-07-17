import { describe, it, expect } from 'vitest'
import { equippedAgentPower } from '../../server/utils/hack'
import { agentPower } from '../../shared/utils/hack-config'

describe('equippedAgentPower', () => {
    it('matches a direct agentPower call with the same resolved gear and traits', () => {
        const itemsById = new Map([
            ['tool-1', { itemLevel: 5, mods: [{ type: 'power_flat', value: 10 }] }],
            ['software-1', { itemLevel: 3, mods: [] }],
        ])
        const agent = {
            level: 10,
            class: 'bruteforce',
            equippedTool: 'tool-1',
            equippedSoftware: 'software-1',
            equippedHardware: null,
            traits: [{ type: 'power_flat', value: 5 }],
        }

        const expected = agentPower(
            { level: 10, class: 'bruteforce' },
            [
                { itemLevel: 5, mods: [{ type: 'power_flat', value: 10 }] },
                { itemLevel: 3, mods: [] },
            ],
            [{ type: 'power_flat', value: 5 }],
        )

        expect(equippedAgentPower(agent, itemsById)).toBe(expected)
    })

    it('excludes unequipped items — only tool/software/hardware slots are resolved', () => {
        const itemsById = new Map([
            ['tool-1', { itemLevel: 5, mods: [] }],
            ['unrelated-item', { itemLevel: 99, mods: [{ type: 'power_flat', value: 999 }] }],
        ])
        const agent = {
            level: 1,
            class: 'infiltrator',
            equippedTool: 'tool-1',
            equippedSoftware: null,
            equippedHardware: null,
            traits: [],
        }

        const expected = agentPower(
            { level: 1, class: 'infiltrator' },
            [{ itemLevel: 5, mods: [] }],
            [],
        )

        expect(equippedAgentPower(agent, itemsById)).toBe(expected)
    })

    it('ignores equipped ids that no longer resolve to a row in itemsById', () => {
        const itemsById = new Map<string, { itemLevel: number; mods: unknown }>()
        const agent = {
            level: 4,
            class: 'cryptographer',
            equippedTool: 'missing-item',
            equippedSoftware: null,
            equippedHardware: null,
            traits: [],
        }

        const expected = agentPower({ level: 4, class: 'cryptographer' }, [], [])

        expect(equippedAgentPower(agent, itemsById)).toBe(expected)
    })
})
