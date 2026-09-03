// Meadowbrawl — shared engine types.
//
// Logic space is a flat top-down plane (x, y). The renderer foreshortens y by
// GROUND_YS to fake the 45° camera; every hitbox/telegraph lives in logic
// space and is projected the same way, so what you see is exactly what hits.

export interface Vec {
    x: number
    y: number
}

export type WeaponId = 'sword' | 'greataxe' | 'spear' | 'daggers' | 'warhammer' | 'scythe'

export type HitShape =
    | { kind: 'arc', reach: number, halfAngle: number }
    | { kind: 'thrust', reach: number, width: number }
    | { kind: 'circle', radius: number }

export interface SwingDef {
    name: string
    /** Seconds of anticipation before the hitbox goes live. */
    windup: number
    /** Seconds the hitbox is live. */
    active: number
    /** Seconds of follow-through. The next combo input cancels this. */
    recovery: number
    /** Multiplier of the weapon's base damage. */
    damage: number
    shape: HitShape
    /** Forward lunge distance applied across windup + active. */
    step: number
    knockback: number
    stagger: number
    /** Visual sweep direction of the blade: 1 clockwise, -1 counter, 0 thrust. */
    sweep: 1 | -1 | 0
    finisher?: boolean
}

export type SpecialKind = 'dash' | 'slam' | 'sweep' | 'blink' | 'leap' | 'whirl'

export interface WeaponDef {
    id: WeaponId
    name: string
    tagline: string
    description: string
    baseDamage: number
    /** Seconds after recovery ends during which the chain can still continue. */
    comboWindow: number
    swings: SwingDef[]
    /** Template inserted before the finisher for every "+1 combo hit" stack. */
    extraSwing: SwingDef
    /** Every hit of this weapon counts as heavy (breaks shields). */
    heavy: boolean
    special: {
        kind: SpecialKind
        name: string
        description: string
        cooldown: number
        damage: number
    }
    color: string
}

export type EnemyTypeId = 'grunt' | 'charger' | 'swarmer' | 'shield' | 'ranged' | 'ogre' | 'warlord'

export type Rarity = 'common' | 'rare' | 'epic' | 'weapon'

export interface UpgradeDef {
    id: string
    name: string
    description: string
    rarity: Rarity
    maxStacks: number
    icon: string
}

export interface Offer {
    upgrade: UpgradeDef
    /** Stack count the player would be at after taking it. */
    stack: number
    /** Set when the offer swaps the equipped weapon. */
    weapon?: WeaponId
}

export interface SpawnGroup {
    time: number
    type: EnemyTypeId
    count: number
    side: 'north' | 'east' | 'south' | 'west'
}

export type GameEventType =
    | 'swing' | 'hit' | 'heavyHit' | 'kill' | 'block' | 'shieldBreak' | 'hurt' | 'dodge'
    | 'special' | 'waveStart' | 'waveClear' | 'upgrade' | 'death' | 'victory' | 'explode'
    | 'lightning' | 'freeze' | 'burn' | 'telegraph' | 'sprint' | 'eliteSpawn' | 'crit' | 'execute' | 'revive' | 'leap'

export interface GameEvent {
    type: GameEventType
    x?: number
    y?: number
    power?: number
}

export const GROUND_YS = 0.72
export const ARENA_W = 1500
export const ARENA_H = 1000
export const TOTAL_WAVES = 30
