/**
 * The Passive Skill Tree's nodes (`passive-skill-tree.md`): a root ringed by three nodes of its own,
 * and three paths out of it, one per base class line. Every path has the same shape: a spine of stat nodes, two class-path nodes
 * that work only while the Hero is on that path, two Champion side nodes that hang off it and gate
 * nothing, and an endless node at the tip.
 *
 * IDs are stable and are what `hq_state.passive_tree` stores; reordering or renaming here must never
 * change one. Nothing numeric lives here: a line names a band, and `PASSIVE_BAND_MAGNITUDE` says what
 * a level of that band is worth. Costs come from the node's tier (`PASSIVE_TIER_COST`).
 */

import type { HqModifier } from '../modifiers'
import type { ChampionArchetype } from '../types'
import type { PASSIVE_BAND_MAGNITUDE } from '../constants'

export type PassivePath = 'root' | 'warrior' | 'mage' | 'archer'
export type PassiveBand = keyof typeof PASSIVE_BAND_MAGNITUDE

/** One effect line, with its per-level magnitude given as a band. */
export interface PassiveLine extends Omit<HqModifier, 'magnitude'> {
    band: PassiveBand
}

/**
 * Who a node's lines reach: the Hero, or fielded Champions, every one or only one archetype. Side
 * nodes are the Champion ones; they never gate anything (`idea-backlog.md` item 3).
 */
export type PassiveScope = { kind: 'hero' } | { kind: 'champion', archetype: ChampionArchetype | 'all' }

export interface PassiveNode {
    id: string
    name: string
    path: PassivePath
    /** The node it hangs off; null for the root. A node opens once its parent holds a level. */
    parent: string | null
    /**
     * Other nodes it is joined to, which open it too. A path's first node links the root's ring nodes
     * either side of it, closing the inner ring. A link never makes the other node a parent.
     */
    links: readonly string[]
    /**
     * Whether the line to its parent is drawn and the parent opens it. False for a path's first node:
     * it is laid out from the root but joins the tree through the ring nodes it links.
     */
    parentJoined: boolean
    /** Its ring out from the root, 1–5; sets the cost. The endless nodes have none. */
    tier: number | null
    lines: readonly PassiveLine[]
    scope: PassiveScope
    /** Works only while the Hero's class is on this node's path (§3). */
    pathLocked: boolean
    /** Has no level cap and costs on its own ladder. */
    endless: boolean
    /** A side node: a leaf that buffs Champions. */
    side: boolean
}

const HERO: PassiveScope = { kind: 'hero' }
const champions = (archetype: ChampionArchetype | 'all'): PassiveScope => ({ kind: 'champion', archetype })

function node(id: string, name: string, path: PassivePath, parent: string | null, tier: number | null, lines: PassiveLine[],
    extra: Partial<Pick<PassiveNode, 'scope' | 'pathLocked' | 'endless' | 'links' | 'parentJoined'>> = {}): PassiveNode {
    const scope = extra.scope ?? HERO
    return { id, name, path, parent, links: extra.links ?? [], parentJoined: extra.parentJoined ?? true, tier, lines, scope, pathLocked: extra.pathLocked ?? false, endless: extra.endless ?? false, side: scope.kind === 'champion' }
}

const stat = (s: HqModifier['stat'], band: PassiveBand = 'stat'): PassiveLine => ({ kind: 'stat', stat: s, band })
const line = (kind: HqModifier['kind'], band: PassiveBand): PassiveLine => ({ kind, band })

export const PASSIVE_ROOT_ID = 'tree_root'

export const PASSIVE_NODES: readonly PassiveNode[] = [
    // the generic damage root (item 3)
    node(PASSIVE_ROOT_ID, 'Awakening', 'root', null, 1, [stat('pwr')]),
    // the root's own ring, between the paths: every class's, and the way into the paths either side
    node('tree_root_fundamentals', 'Fundamentals', 'root', PASSIVE_ROOT_ID, 1, [line('basicAttack', 'stat')]),
    node('tree_root_fortitude', 'Fortitude', 'root', PASSIVE_ROOT_ID, 1, [line('maxHp', 'stat')]),
    node('tree_root_precision', 'Precision', 'root', PASSIVE_ROOT_ID, 1, [line('critChance', 'utility')]),

    // Warrior: hide, blood and spoils
    node('tree_war_iron_skin', 'Iron Skin', 'warrior', PASSIVE_ROOT_ID, 1, [stat('def')], { parentJoined: false, links: ['tree_root_fortitude', 'tree_root_precision'] }),
    node('tree_war_thick_blood', 'Thick Blood', 'warrior', 'tree_war_iron_skin', 2, [stat('vit')]),
    node('tree_war_plunder', 'Plunder', 'warrior', 'tree_war_iron_skin', 2, [line('gold', 'economy')]),
    node('tree_war_unbroken', 'Unbroken', 'warrior', 'tree_war_thick_blood', 3, [line('damageTaken', 'utility')]),
    node('tree_war_spiked_mail', 'Spiked Mail', 'warrior', 'tree_war_plunder', 3, [line('reflect', 'utility')]),
    node('tree_war_shieldbearers', 'Shieldbearers', 'warrior', 'tree_war_thick_blood', 3, [stat('def'), stat('vit')], { scope: champions('tank') }),
    node('tree_war_weapon_mastery', 'Weapon Mastery', 'warrior', 'tree_war_unbroken', 4, [line('skillDamage', 'skill')], { pathLocked: true }),
    node('tree_war_sunder', 'Sunder', 'warrior', 'tree_war_spiked_mail', 4, [line('enemyDefShred', 'utility')]),
    node('tree_war_vanguard', 'Vanguard', 'warrior', 'tree_war_spiked_mail', 4, [stat('pwr')], { scope: champions('damage') }),
    node('tree_war_battle_trance', 'Battle Trance', 'warrior', 'tree_war_weapon_mastery', 5, [line('cooldown', 'utility')], { pathLocked: true }),
    node('tree_war_colossus', 'Colossus', 'warrior', 'tree_war_battle_trance', null, [stat('vit', 'endless'), stat('def', 'endless')], { endless: true }),

    // Mage: speed, study and wards
    node('tree_mage_focus', 'Focus', 'mage', PASSIVE_ROOT_ID, 1, [stat('spd')], { parentJoined: false, links: ['tree_root_precision', 'tree_root_fundamentals'] }),
    node('tree_mage_arcane_well', 'Arcane Well', 'mage', 'tree_mage_focus', 2, [stat('pwr')]),
    node('tree_mage_insight', 'Insight', 'mage', 'tree_mage_focus', 2, [line('xp', 'economy')]),
    node('tree_mage_quickening', 'Quickening', 'mage', 'tree_mage_arcane_well', 3, [line('cooldown', 'utility')]),
    node('tree_mage_ward', 'Ward', 'mage', 'tree_mage_insight', 3, [line('controlResist', 'utility')]),
    node('tree_mage_mesmerists', 'Mesmerists', 'mage', 'tree_mage_arcane_well', 3, [stat('spd')], { scope: champions('control') }),
    node('tree_mage_spell_mastery', 'Spell Mastery', 'mage', 'tree_mage_quickening', 4, [line('skillDamage', 'skill')], { pathLocked: true }),
    node('tree_mage_mana_shield', 'Mana Shield', 'mage', 'tree_mage_ward', 4, [line('maxHp', 'stat')]),
    node('tree_mage_chorus', 'Chorus', 'mage', 'tree_mage_ward', 4, [stat('imp'), stat('lck')], { scope: champions('support') }),
    node('tree_mage_overchannel', 'Overchannel', 'mage', 'tree_mage_spell_mastery', 5, [line('cooldown', 'utility')], { pathLocked: true }),
    node('tree_mage_archmage', 'Archmage', 'mage', 'tree_mage_overchannel', null, [stat('pwr', 'endless'), stat('spd', 'endless')], { endless: true }),

    // Archer: the eye, the hand and the hunt
    node('tree_arc_keen_eye', 'Keen Eye', 'archer', PASSIVE_ROOT_ID, 1, [stat('lck')], { parentJoined: false, links: ['tree_root_fundamentals', 'tree_root_fortitude'] }),
    node('tree_arc_steady_hand', 'Steady Hand', 'archer', 'tree_arc_keen_eye', 2, [stat('imp')]),
    node('tree_arc_forager', 'Forager', 'archer', 'tree_arc_keen_eye', 2, [line('offlineEfficiency', 'economy')]),
    node('tree_arc_vital_spot', 'Vital Spot', 'archer', 'tree_arc_steady_hand', 3, [line('critChance', 'utility')]),
    node('tree_arc_light_feet', 'Light Feet', 'archer', 'tree_arc_forager', 3, [line('evasion', 'utility')]),
    node('tree_arc_pack_tactics', 'Pack Tactics', 'archer', 'tree_arc_steady_hand', 3, [stat('imp')], { scope: champions('all') }),
    node('tree_arc_marksmanship', 'Marksmanship', 'archer', 'tree_arc_vital_spot', 4, [line('skillDamage', 'skill')], { pathLocked: true }),
    node('tree_arc_hunters_mark', 'Hunter\'s Mark', 'archer', 'tree_arc_light_feet', 4, [line('critDamage', 'critDamage')]),
    node('tree_arc_volley_drill', 'Volley Drill', 'archer', 'tree_arc_light_feet', 4, [stat('spd')], { scope: champions('all') }),
    node('tree_arc_rapid_fire', 'Rapid Fire', 'archer', 'tree_arc_marksmanship', 5, [line('cooldown', 'utility')], { pathLocked: true }),
    node('tree_arc_deadeye', 'Deadeye', 'archer', 'tree_arc_rapid_fire', null, [stat('pwr', 'endless'), stat('imp', 'endless')], { endless: true })
]

const BY_ID = new Map(PASSIVE_NODES.map(n => [n.id, n]))

export function isPassiveNodeId(value: unknown): value is string {
    return typeof value === 'string' && BY_ID.has(value)
}

export function getPassiveNode(id: string): PassiveNode {
    const found = BY_ID.get(id)
    if (!found) throw new Error(`Unknown passive node ${id}`)
    return found
}

export function passiveChildrenOf(id: string | null): PassiveNode[] {
    return PASSIVE_NODES.filter(n => n.parent === id)
}
