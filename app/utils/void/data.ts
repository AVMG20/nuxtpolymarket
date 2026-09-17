// Void Runner — hostile roster. Client-only: the server never needs to know
// what a Lancer is, only how much the run was allowed to bank.

import type { VoidResourceId } from '#shared/utils/gamelogic/void'

export type EnemyKind = 'mite' | 'raider' | 'lancer' | 'bulwark' | 'minelayer' | 'leech' | 'blinker' | 'carrier' | 'sentinel'

export interface EnemyDrop {
    resource: VoidResourceId
    min: number
    max: number
    chance?: number
}

export interface EnemyDefinition {
    kind: EnemyKind
    name: string
    /** Shown in the codex and when it first appears. */
    tell: string
    hp: number
    speed: number
    /** Radians per second. */
    turn: number
    scale: number
    /** Collision radius in world units. */
    radius: number
    damage: number
    /** Seconds between attacks. */
    cooldown: number
    range: number
    projectileSpeed: number
    glow: number
    drops: EnemyDrop[]
    /** Spawn weight per sector tier, index 0 = sector 1. */
    weights: [number, number, number, number, number]
    group: [number, number]
    elite?: boolean
    stationary?: boolean
}

export const ENEMIES: Record<EnemyKind, EnemyDefinition> = {
    mite: {
        kind: 'mite', name: 'Mite', tell: 'Swarms in and detonates on contact. Keep moving.',
        hp: 12, speed: 90, turn: 4.5, scale: 1.3, radius: 1.8, damage: 10, cooldown: 0, range: 3, projectileSpeed: 0,
        glow: 0xff3b3b, drops: [{ resource: 'scrap', min: 1, max: 1, chance: 0.35 }],
        weights: [22, 26, 26, 24, 22], group: [4, 7]
    },
    raider: {
        kind: 'raider', name: 'Raider', tell: 'Strafes around you and fires in bursts.',
        hp: 45, speed: 72, turn: 2.8, scale: 1.6, radius: 2.8, damage: 4, cooldown: 2.2, range: 180, projectileSpeed: 210,
        glow: 0xff5a36, drops: [{ resource: 'scrap', min: 1, max: 3 }],
        weights: [55, 38, 28, 22, 18], group: [2, 4]
    },
    lancer: {
        kind: 'lancer', name: 'Lancer', tell: 'Holds range and charges a rail shot. Break line when the red line locks.',
        hp: 70, speed: 58, turn: 2, scale: 1.5, radius: 3, damage: 34, cooldown: 4.5, range: 320, projectileSpeed: 0,
        glow: 0xff2d55, drops: [{ resource: 'scrap', min: 2, max: 4 }, { resource: 'alloy', min: 1, max: 1, chance: 0.25 }],
        weights: [8, 20, 22, 22, 20], group: [1, 3]
    },
    bulwark: {
        kind: 'bulwark', name: 'Bulwark', tell: 'Its front shield eats everything. Flank it.',
        hp: 260, speed: 32, turn: 0.9, scale: 1.6, radius: 5.2, damage: 7, cooldown: 2.4, range: 140, projectileSpeed: 110,
        glow: 0xffa436, drops: [{ resource: 'scrap', min: 4, max: 7 }, { resource: 'alloy', min: 1, max: 3, chance: 0.6 }],
        weights: [4, 14, 16, 16, 16], group: [1, 2]
    },
    minelayer: {
        kind: 'minelayer', name: 'Minelayer', tell: 'Drops proximity mines behind it. Shoot the mines or go around.',
        hp: 110, speed: 50, turn: 1.6, scale: 1.6, radius: 4.2, damage: 30, cooldown: 2.6, range: 200, projectileSpeed: 0,
        glow: 0xffd23f, drops: [{ resource: 'scrap', min: 4, max: 7 }, { resource: 'alloy', min: 1, max: 2, chance: 0.4 }],
        weights: [0, 12, 12, 12, 12], group: [1, 2]
    },
    leech: {
        kind: 'leech', name: 'Leech', tell: 'Latches on, drains your shield and drags your engines. Kill it fast.',
        hp: 80, speed: 88, turn: 3.5, scale: 1.6, radius: 2.8, damage: 9, cooldown: 0, range: 26, projectileSpeed: 0,
        glow: 0xb3ff3b, drops: [{ resource: 'scrap', min: 2, max: 4 }, { resource: 'alloy', min: 1, max: 1, chance: 0.3 }],
        weights: [0, 0, 14, 16, 16], group: [2, 3]
    },
    blinker: {
        kind: 'blinker', name: 'Blinker', tell: 'Teleports next to you and fires a shotgun burst. Watch for the shimmer.',
        hp: 95, speed: 60, turn: 3, scale: 1.6, radius: 3.1, damage: 8, cooldown: 4.2, range: 60, projectileSpeed: 120,
        glow: 0x9b5cff, drops: [{ resource: 'scrap', min: 3, max: 5 }, { resource: 'alloy', min: 1, max: 2, chance: 0.45 }],
        weights: [0, 4, 12, 16, 18], group: [1, 3]
    },
    carrier: {
        kind: 'carrier', name: 'Brood Carrier', tell: 'A flying hive. It keeps launching mites until it dies.',
        hp: 1100, speed: 22, turn: 0.45, scale: 1.6, radius: 10.5, damage: 7, cooldown: 7, range: 260, projectileSpeed: 120,
        glow: 0xff3b6b, drops: [{ resource: 'scrap', min: 14, max: 22 }, { resource: 'alloy', min: 4, max: 8 }],
        weights: [0, 3, 5, 7, 9], group: [1, 1], elite: true
    },
    sentinel: {
        kind: 'sentinel', name: 'Sentinel', tell: 'A static gun platform guarding rich ore. It fires homing orbs.',
        hp: 420, speed: 0, turn: 1.6, scale: 1.7, radius: 5.2, damage: 12, cooldown: 1.7, range: 280, projectileSpeed: 70,
        glow: 0xff4fa8, drops: [{ resource: 'scrap', min: 6, max: 10 }, { resource: 'alloy', min: 2, max: 4 }],
        weights: [0, 0, 0, 0, 0], group: [1, 1], elite: true, stationary: true
    }
}

export const ENEMY_KINDS = Object.keys(ENEMIES) as EnemyKind[]

export const WARDEN_BASE_HP = 8000

export const WARDEN_GLOW = [0x5ec8ff, 0xff8a2b, 0xc07bff, 0x3dffb0, 0xff3b7a]

/** Health and damage multipliers for a sector's threat. */
export function threatHpMult(threat: number) {
    return threat
}

export function threatDamageMult(threat: number) {
    return Math.pow(threat, 0.78)
}

/** Loot scales gently with depth so late sectors are worth the risk. */
export function dropMult(tier: number) {
    return 1 + (tier - 1) * 0.25
}
