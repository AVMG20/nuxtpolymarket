/**
 * The Passive Skill Tree's rules (`passive-skill-tree.md`): what points a Hero has, what a level
 * costs, what can be bought, and the modifier lines the bought levels add.
 *
 * Points are **derived from the Hero's level, never stored** (the user's call, 2026-10-11): every
 * level past the first is worth `PASSIVE_POINTS_PER_LEVEL`, and what is left is that less the cost of
 * every level the tree holds. Nothing has to credit a level-up, an account that levelled before the
 * tree existed has its points already, and a respec is clearing the map.
 *
 * Pure, like everything in `shared/`: the scene shows the same numbers the server enforces.
 */

import {
    PASSIVE_BAND_MAGNITUDE,
    PASSIVE_ENDLESS_BASE_COST,
    PASSIVE_ENDLESS_COST_STEP,
    PASSIVE_NODE_MAX_LEVEL,
    PASSIVE_POINTS_PER_LEVEL,
    PASSIVE_TIER_COST
} from './constants'
import { ASCENDANT_ID, classPath } from './content/classes'
import { PASSIVE_NODES, getPassiveNode, isPassiveNodeId, type PassiveNode, type PassivePath } from './content/passive-tree'
import type { HqModifier } from './modifiers'
import type { ChampionArchetype, ClassId } from './types'

/** Node id → levels held. Absent means none. */
export type PassiveTreeLevels = Readonly<Record<string, number>>

/** The map as stored, with unknown ids, non-integers and out-of-range levels dropped. */
export function passiveTreeOf(raw: unknown): Record<string, number> {
    const out: Record<string, number> = {}
    if (!raw || typeof raw !== 'object') return out
    for (const [id, level] of Object.entries(raw as Record<string, unknown>)) {
        if (!isPassiveNodeId(id) || typeof level !== 'number' || !Number.isInteger(level) || level <= 0) continue
        const max = maxLevelOf(getPassiveNode(id))
        out[id] = max === null ? level : Math.min(level, max)
    }
    return out
}

export function passivePointsEarned(heroLevel: number): number {
    return Math.max(0, heroLevel - 1) * PASSIVE_POINTS_PER_LEVEL
}

/** Null for an endless node. */
export function maxLevelOf(node: PassiveNode): number | null {
    return node.endless ? null : PASSIVE_NODE_MAX_LEVEL
}

/** What taking a node from `level - 1` to `level` costs. */
export function passiveLevelCost(node: PassiveNode, level: number): number {
    if (node.endless) return PASSIVE_ENDLESS_BASE_COST + (level - 1) * PASSIVE_ENDLESS_COST_STEP
    return PASSIVE_TIER_COST[(node.tier ?? 1) - 1]! * level
}

/** What a node's first `levels` levels cost together. */
export function passiveNodeSpent(node: PassiveNode, levels: number): number {
    let total = 0
    for (let level = 1; level <= levels; level++) total += passiveLevelCost(node, level)
    return total
}

export function passivePointsSpent(levels: PassiveTreeLevels): number {
    let total = 0
    for (const [id, held] of Object.entries(levels)) {
        if (isPassiveNodeId(id)) total += passiveNodeSpent(getPassiveNode(id), held)
    }
    return total
}

export function passivePointsLeft(heroLevel: number, levels: PassiveTreeLevels): number {
    return passivePointsEarned(heroLevel) - passivePointsSpent(levels)
}

/** Why a node's next level can't be bought, or null when it can. */
export type PassiveBuyBlock = 'locked' | 'maxed' | 'points'

export function passiveBuyBlock(node: PassiveNode, heroLevel: number, levels: PassiveTreeLevels): PassiveBuyBlock | null {
    const from = node.parentJoined && node.parent !== null ? [node.parent, ...node.links] : node.links
    const opened = node.parent === null || from.some(id => (levels[id] ?? 0) > 0)
    if (!opened) return 'locked'
    const held = levels[node.id] ?? 0
    const max = maxLevelOf(node)
    if (max !== null && held >= max) return 'maxed'
    if (passivePointsLeft(heroLevel, levels) < passiveLevelCost(node, held + 1)) return 'points'
    return null
}

/**
 * The class lines a Hero's class sits on. The Beginner is on none; the Ascendant, which fires every
 * master's skill, is on all three (`passive-skill-tree.md` §3).
 */
export function passivePathsOf(classId: ClassId): ReadonlySet<PassivePath> {
    if (classId === ASCENDANT_ID) return new Set<PassivePath>(['warrior', 'mage', 'archer'])
    const base = classPath(classId).find(n => n.tier === 'base')
    const path = base?.id.replace('class_', '') as PassivePath | undefined
    return new Set<PassivePath>(path ? [path] : [])
}

/** Whether a held node does anything for this class: a class-path node only on its own path. */
export function passiveNodeActive(node: PassiveNode, classId: ClassId): boolean {
    return !node.pathLocked || passivePathsOf(classId).has(node.path)
}

/** A node's lines at `level`, each band turned into a magnitude. */
export function passiveNodeLines(node: PassiveNode, level: number): HqModifier[] {
    return node.lines.map(({ band, ...rest }) => ({ ...rest, magnitude: PASSIVE_BAND_MAGNITUDE[band] * level }))
}

export interface PassiveTreeModifiers {
    hero: HqModifier[]
    /** Side-node lines by the archetype they name; `all` reaches every Champion. */
    champion: Record<ChampionArchetype | 'all', HqModifier[]>
}

/** Every line the held levels add, split by who they reach. Inactive class-path nodes add nothing. */
export function passiveTreeModifiers(levels: PassiveTreeLevels, classId: ClassId): PassiveTreeModifiers {
    const out: PassiveTreeModifiers = { hero: [], champion: { all: [], damage: [], tank: [], support: [], control: [] } }
    for (const node of PASSIVE_NODES) {
        const held = levels[node.id] ?? 0
        if (held <= 0 || !passiveNodeActive(node, classId)) continue
        const lines = passiveNodeLines(node, held)
        if (node.scope.kind === 'hero') out.hero.push(...lines)
        else out.champion[node.scope.archetype].push(...lines)
    }
    return out
}
