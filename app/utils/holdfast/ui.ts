// Holdfast — UI-side tables shared by the HUD components.

import type { BuildingKind, Resource, UnitKind } from '#shared/utils/holdfast/config'

export type Tool
    = | { type: 'build', kind: BuildingKind }
      | { type: 'deploy', kind: UnitKind }
      | { type: 'move', packId: number }
      | null

export const RESOURCE_META: Record<Resource, { name: string, icon: string, color: string }> = {
    gold: { name: 'Gold', icon: 'i-lucide-coins', color: 'text-amber-300' },
    wood: { name: 'Wood', icon: 'i-lucide-tree-pine', color: 'text-orange-300' },
    stone: { name: 'Stone', icon: 'i-lucide-mountain', color: 'text-stone-300' },
    crystal: { name: 'Crystal', icon: 'i-lucide-gem', color: 'text-violet-300' }
}

export type ToolbarItem
    = | { type: 'deploy', kind: UnitKind, key: string, group: string }
      | { type: 'build', kind: BuildingKind, key: string, group: string }

export const TOOLBAR: readonly ToolbarItem[] = [
    { type: 'deploy', kind: 'warrior', key: '1', group: 'Army' },
    { type: 'deploy', kind: 'archer', key: '2', group: 'Army' },
    { type: 'build', kind: 'wall', key: '3', group: 'Defence' },
    { type: 'build', kind: 'gate', key: '4', group: 'Defence' },
    { type: 'build', kind: 'tower', key: '5', group: 'Defence' },
    { type: 'build', kind: 'goldmine', key: '6', group: 'Economy' },
    { type: 'build', kind: 'lumbercamp', key: '7', group: 'Economy' },
    { type: 'build', kind: 'stonemason', key: '8', group: 'Economy' },
    { type: 'build', kind: 'crystalmine', key: '9', group: 'Economy' },
    { type: 'build', kind: 'barracks', key: '0', group: 'Training' },
    { type: 'build', kind: 'range', key: '-', group: 'Training' }
]

/** Compact number for resource pills: 950, 1.2k, 12k. */
export function shortAmount(n: number): string {
    const v = Math.floor(n)
    if (v < 1000) return String(v)
    if (v < 10000) return `${(v / 1000).toFixed(1)}k`
    return `${Math.floor(v / 1000)}k`
}

/** Toolbar-sized labels. */
export const SHORT_NAMES: Record<string, string> = {
    warrior: 'Warriors',
    archer: 'Archers',
    wall: 'Wall',
    gate: 'Gate',
    tower: 'Tower',
    goldmine: 'Gold Mine',
    lumbercamp: 'Lumber',
    stonemason: 'Mason',
    crystalmine: 'Crystals',
    barracks: 'Barracks',
    range: 'Range'
}
