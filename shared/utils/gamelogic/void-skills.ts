// ─── Void Runner: pilot skills ──────────────────────────────────────────────
//
// One active skill rides on Q and right mouse. Skills are unlocked in the
// hangar and shaped by a small passive tree. The points for every tree come
// from the pilot level, not from the skill, so a skill bought late arrives
// with points already waiting. No tree can be filled: there are more nodes
// than points, and only one keystone per tree.

import type { VoidResourceBundle } from './void'

export type VoidSkillId = 'seeker' | 'shockwave' | 'berserk' | 'wingmen' | 'overdrive' | 'strike'

export interface VoidSkillNode {
    id: string
    name: string
    description: string
    /** Grid column (0..2) and row (0..3) in the tree view. */
    x: number
    y: number
    /** Allocating needs any one of these. Empty for entry nodes. */
    requires: string[]
    keystone?: boolean
    mods: Record<string, number>
}

export interface VoidSkillDefinition {
    id: VoidSkillId
    name: string
    description: string
    color: number
    icon: string
    requiresSector: number
    cost: VoidResourceBundle
    coins: number
    gems: number
    /** Base tuning; node mods add onto these keys. */
    base: Record<string, number>
    nodes: VoidSkillNode[]
}

type NodeSpec = [name: string, description: string, mods: Record<string, number>]

/**
 * Every tree has the same shape: three branches of three, then two
 * keystones that each hang off two neighbouring branches.
 */
function tree(branches: [NodeSpec[], NodeSpec[], NodeSpec[]], left: NodeSpec, right: NodeSpec): VoidSkillNode[] {
    const nodes: VoidSkillNode[] = []
    const letters = ['a', 'b', 'c']
    branches.forEach((branch, x) => {
        branch.forEach(([name, description, mods], y) => {
            nodes.push({ id: `${letters[x]}${y + 1}`, name, description, x, y, requires: y === 0 ? [] : [`${letters[x]}${y}`], mods })
        })
    })
    nodes.push({ id: 'k1', name: left[0], description: left[1], x: 0.5, y: 3, requires: ['a3', 'b3'], keystone: true, mods: left[2] })
    nodes.push({ id: 'k2', name: right[0], description: right[1], x: 1.5, y: 3, requires: ['b3', 'c3'], keystone: true, mods: right[2] })
    return nodes
}

export const VOID_SKILLS: VoidSkillDefinition[] = [
    {
        id: 'seeker',
        name: 'Seeker Missiles',
        description: 'Launch homing missiles at the nearest hostiles.',
        color: 0xff6b4f,
        icon: 'i-lucide-rocket',
        requiresSector: 0,
        cost: {},
        coins: 0,
        gems: 0,
        base: { cooldown: 8, count: 2, damage: 5, radius: 12, speed: 1 },
        nodes: tree([
            [
                ['Warhead', '+20% damage', { damagePct: 0.2 }],
                ['Shaped Charge', '+25% damage', { damagePct: 0.25 }],
                ['Wide Blast', '+50% blast radius', { radiusPct: 0.5 }]
            ],
            [
                ['Twin Rails', '+1 missile', { count: 1 }],
                ['Quick Loader', '-15% cooldown', { cooldownPct: -0.15 }],
                ['Full Rack', '+1 missile', { count: 1 }]
            ],
            [
                ['Thrusters', '+40% missile speed', { speedPct: 0.4 }],
                ['Prospector', 'Missiles hunt ore rocks when no hostiles are near', { mining: 1 }],
                ['Auto Loader', '-15% cooldown', { cooldownPct: -0.15 }]
            ]
        ],
        ['Cluster Warheads', 'Each missile bursts into 4 bomblets for 30% damage', { cluster: 1 }],
        ['Hellstorm', 'Triple the missiles at 40% damage, +25% cooldown', { hellstorm: 1, cooldownPct: 0.25 }])
    },
    {
        id: 'shockwave',
        name: 'Shockwave',
        description: 'A pulse that blasts hostiles away, cracks nearby rock and pulls in loot.',
        color: 0x7fd4ff,
        icon: 'i-lucide-radio',
        requiresSector: 0,
        cost: { ferrite: 300, scrap: 200 },
        coins: 300_000,
        gems: 0,
        base: { cooldown: 13, radius: 65, damage: 7, knock: 60 },
        nodes: tree([
            [
                ['Amplifier', '+20% radius', { radiusPct: 0.2 }],
                ['Resonance', '+25% radius', { radiusPct: 0.25 }],
                ['Concussion', 'Double knockback', { knockPct: 1 }]
            ],
            [
                ['Overpressure', '+25% damage', { damagePct: 0.25 }],
                ['Shear', '+30% damage', { damagePct: 0.3 }],
                ['Disruptor', 'Hit hostiles cannot fire for 2s', { stun: 2 }]
            ],
            [
                ['Magnet Pulse', 'Pulls loot from twice the radius', { magnet: 1 }],
                ['Quick Charge', '-15% cooldown', { cooldownPct: -0.15 }],
                ['Recharge', '-15% cooldown', { cooldownPct: -0.15 }]
            ]
        ],
        ['Aftershock', 'A second wave follows for 60% damage', { aftershock: 1 }],
        ['Implosion', 'Pulls hostiles in instead, +40% damage', { implosion: 1, damagePct: 0.4 }])
    },
    {
        id: 'berserk',
        name: 'Berserker',
        description: 'Overclock every weapon on the ship for a few seconds.',
        color: 0xff3b5c,
        icon: 'i-lucide-flame',
        requiresSector: 0,
        cost: { ferrite: 600, cobalt: 120, scrap: 400 },
        coins: 1_200_000,
        gems: 0,
        base: { cooldown: 28, duration: 6, damagePct: 0.2, ratePct: 0.2 },
        nodes: tree([
            [
                ['Fury', '+10% damage while active', { damagePct: 0.1 }],
                ['Wrath', '+15% damage while active', { damagePct: 0.15 }],
                ['Rapid Fire', '+15% fire rate while active', { ratePct: 0.15 }]
            ],
            [
                ['Endurance', '+1s duration', { duration: 1 }],
                ['Second Wind', '+1s duration', { duration: 1 }],
                ['Hair Trigger', '-15% cooldown', { cooldownPct: -0.15 }]
            ],
            [
                ['Bloodlust', 'Kills add 0.5s, up to +3s', { killExtend: 0.5 }],
                ['Vampiric', 'Kills repair 3% hull', { killHeal: 0.03 }],
                ['Cold Blood', '-10% cooldown', { cooldownPct: -0.1 }]
            ]
        ],
        ['Blood Frenzy', 'Each kill adds +4% damage, up to 10 stacks', { frenzy: 1 }],
        ['Glass Cannon', '+50% to every bonus, take 35% more damage', { glass: 1 }])
    },
    {
        id: 'wingmen',
        name: 'Wingmen',
        description: 'Call in escort fighters that fly with you and fight for a while.',
        color: 0xffd35e,
        icon: 'i-lucide-plane',
        requiresSector: 1,
        cost: { cobalt: 500, scrap: 800, alloy: 80 },
        coins: 5_000_000,
        gems: 0,
        base: { cooldown: 30, duration: 15, count: 2, damage: 0.8, rate: 3 },
        nodes: tree([
            [
                ['Squadron', '+1 wingman', { count: 1 }],
                ['Wing Commander', '+1 wingman', { count: 1 }],
                ['Long Patrol', '+40% duration', { durationPct: 0.4 }]
            ],
            [
                ['Hot Barrels', '+30% damage', { damagePct: 0.3 }],
                ['Twin Guns', '+30% fire rate', { ratePct: 0.3 }],
                ['Veterans', '+30% damage', { damagePct: 0.3 }]
            ],
            [
                ['Escort Shield', 'Restores 2% shield per second while they fly', { shieldRegen: 0.02 }],
                ['Scramble', '-15% cooldown', { cooldownPct: -0.15 }],
                ['Standby', '-15% cooldown', { cooldownPct: -0.15 }]
            ]
        ],
        ['Kamikaze', 'When time runs out they dive into the nearest hostile and explode', { kamikaze: 1 }],
        ['Honour Guard', 'They shoot down fire aimed at you, -30% damage', { guard: 1, damagePct: -0.3 }])
    },
    {
        id: 'overdrive',
        name: 'Shield Overdrive',
        description: 'Overcharge the shield past its limit and reflect part of every hit.',
        color: 0x6fb8ff,
        icon: 'i-lucide-shield-plus',
        requiresSector: 2,
        cost: { cobalt: 800, iridium: 180, alloy: 220 },
        coins: 14_000_000,
        gems: 5,
        base: { cooldown: 22, duration: 6, overcharge: 0.5, thorns: 0.25 },
        nodes: tree([
            [
                ['Capacitor', '+25% overcharge', { overcharge: 0.25 }],
                ['Dense Lattice', '+25% overcharge', { overcharge: 0.25 }],
                ['Long Charge', '+2s duration', { duration: 2 }]
            ],
            [
                ['Spikes', '+25% reflected', { thorns: 0.25 }],
                ['Barbs', '+35% reflected', { thorns: 0.35 }],
                ['Static Field', 'Shocks hostiles within 35m', { aura: 1 }]
            ],
            [
                ['Patch Kit', 'Repairs 10% hull on use', { hullRepair: 0.1 }],
                ['Fast Cycle', '-15% cooldown', { cooldownPct: -0.15 }],
                ['Rapid Cycle', '-15% cooldown', { cooldownPct: -0.15 }]
            ]
        ],
        ['Discharge', 'Leftover overcharge erupts as a blast when it ends', { discharge: 1 }],
        ['Aegis Lock', 'Invulnerable for the first 1.5s, half overcharge', { lock: 1.5 }])
    },
    {
        id: 'strike',
        name: 'Orbital Strike',
        description: 'Mark a spot under your crosshair. A second later, it detonates.',
        color: 0xffa23d,
        icon: 'i-lucide-target',
        requiresSector: 3,
        cost: { iridium: 600, xenite: 120, alloy: 450, core: 2 },
        coins: 50_000_000,
        gems: 15,
        base: { cooldown: 16, damage: 16, radius: 40, delay: 1.2, count: 1, range: 320 },
        nodes: tree([
            [
                ['Heavy Payload', '+25% damage', { damagePct: 0.25 }],
                ['Deep Strike', '+30% damage', { damagePct: 0.3 }],
                ['Wide Yield', '+30% radius', { radiusPct: 0.3 }]
            ],
            [
                ['Salvo', '+1 strike', { count: 1 }],
                ['Barrage', '+1 strike', { count: 1 }],
                ['Rearm', '-15% cooldown', { cooldownPct: -0.15 }]
            ],
            [
                ['Fast Fuse', 'Detonates twice as fast', { delayPct: -0.5 }],
                ['Firestorm', 'Leaves a fire field for 4s', { burn: 1 }],
                ['Long Range', '+60% range', { rangePct: 0.6 }]
            ]
        ],
        ['Singularity', 'Pulls hostiles and loot to the centre before it goes off', { singularity: 1 }],
        ['Carpet Bomb', 'Six strikes in a line along your aim at 40% damage', { carpet: 1 }])
    }
]

export const VOID_SKILL_IDS: VoidSkillId[] = VOID_SKILLS.map(s => s.id)

export function voidSkill(id: string): VoidSkillDefinition {
    return VOID_SKILLS.find(s => s.id === id) ?? VOID_SKILLS[0]!
}

// ─── Pilot level ────────────────────────────────────────────────────────────

export const VOID_MAX_PILOT_LEVEL = 25

/** Total XP needed to reach a level. Level 1 is free. */
export function voidXpForLevel(level: number) {
    const l = Math.max(1, Math.min(VOID_MAX_PILOT_LEVEL, Math.floor(level)))
    return 8 * Math.pow(l - 1, 3)
}

export function voidPilotLevel(xp: number) {
    let level = 1
    while (level < VOID_MAX_PILOT_LEVEL && xp >= voidXpForLevel(level + 1)) level++
    return level
}

/** Points for every tree: one at level 1, then one every four levels. */
export function voidSkillPoints(level: number) {
    return Math.min(7, Math.floor((Math.max(1, level) + 3) / 4))
}

export function voidPilotProgress(xp: number) {
    const level = voidPilotLevel(xp)
    const from = voidXpForLevel(level)
    const to = level >= VOID_MAX_PILOT_LEVEL ? from : voidXpForLevel(level + 1)
    return {
        xp,
        level,
        maxLevel: VOID_MAX_PILOT_LEVEL,
        points: voidSkillPoints(level),
        nextPointLevel: level >= VOID_MAX_PILOT_LEVEL || voidSkillPoints(level) >= 7 ? null : (voidSkillPoints(level) * 4 + 1),
        into: xp - from,
        span: Math.max(1, to - from),
        progress: level >= VOID_MAX_PILOT_LEVEL ? 1 : (xp - from) / Math.max(1, to - from)
    }
}

/**
 * XP for a finished run. Flying, killing and using the skill all count;
 * extractions and wardens pay a bonus, and deeper sectors pay more.
 * Everything is capped by wall-clock time so a forged report buys little.
 */
export function voidRunXp(run: { extracted: boolean, kills: number, elapsedMs: number, wardenKilled: boolean, tier: number, skillUses: number }) {
    const minutes = Math.max(0, run.elapsedMs) / 60_000
    const kills = Math.min(Math.max(0, Math.floor(run.kills)), Math.ceil(minutes * 25) + 5)
    const uses = Math.min(Math.max(0, Math.floor(run.skillUses)), Math.ceil(minutes * 8) + 2)
    const base = kills * 4 + Math.min(minutes, 40) * 8 + uses * 4 + (run.extracted ? 40 : 0) + (run.extracted && run.wardenKilled ? 400 : 0)
    return Math.round(base * (1 + (Math.max(1, run.tier) - 1) * 0.5))
}

// ─── Trees ──────────────────────────────────────────────────────────────────

/**
 * Validates a node selection for a skill at a pilot level. Returns the
 * cleaned list, or null when it breaks a rule (unknown node, too many
 * points, two keystones, or a node without its parent).
 */
export function voidValidateSkillNodes(skillId: string, raw: unknown, level: number): string[] | null {
    const skill = VOID_SKILLS.find(s => s.id === skillId)
    if (!skill || !Array.isArray(raw)) return null
    const picked = Array.from(new Set(raw.map(String)))
    const byId = new Map(skill.nodes.map(n => [n.id, n]))
    if (picked.some(id => !byId.has(id))) return null
    if (picked.length > voidSkillPoints(level)) return null
    if (picked.filter(id => byId.get(id)!.keystone).length > 1) return null
    const set = new Set(picked)
    for (const id of picked) {
        const node = byId.get(id)!
        if (node.requires.length && !node.requires.some(r => set.has(r))) return null
    }
    return skill.nodes.filter(n => set.has(n.id)).map(n => n.id)
}

/** Nodes stored for a skill, dropped entirely if they no longer validate. */
export function voidSkillNodesFor(stored: Record<string, unknown> | null | undefined, skillId: string, level: number) {
    return voidValidateSkillNodes(skillId, stored?.[skillId] ?? [], level) ?? []
}

/** Base tuning plus every allocated node's mods. */
export function voidSkillParams(skillId: string, nodes: readonly string[]): Record<string, number> {
    const skill = voidSkill(skillId)
    const out: Record<string, number> = { ...skill.base }
    for (const node of skill.nodes) {
        if (!nodes.includes(node.id)) continue
        for (const [key, value] of Object.entries(node.mods)) out[key] = (out[key] ?? 0) + value
    }
    return out
}

/** Final cooldown in seconds after cooldown nodes. */
export function voidSkillCooldown(params: Record<string, number>) {
    return Math.max(2, (params.cooldown ?? 10) * Math.max(0.4, 1 + (params.cooldownPct ?? 0)))
}

export function voidUnlockedSkills(s: { unlockedSkills?: string[] | null }) {
    return Array.from(new Set(['seeker', ...(s.unlockedSkills ?? [])])).filter(id => VOID_SKILL_IDS.includes(id as VoidSkillId))
}

export function voidEquippedSkill(s: { unlockedSkills?: string[] | null, equippedSkill?: string | null }): VoidSkillId {
    const id = s.equippedSkill ?? 'seeker'
    return voidUnlockedSkills(s).includes(id) ? id as VoidSkillId : 'seeker'
}
