import { describe, it, expect } from 'vitest'
import { equippedAgentPower } from '../../server/utils/hack'
import { agentPower } from '../../shared/utils/hack-config'

describe('equippedAgentPower', () => {
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
