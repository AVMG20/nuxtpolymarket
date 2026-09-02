import type { EnemyTypeId } from './types'

export interface EnemyTypeDef {
    id: EnemyTypeId
    name: string
    hp: number
    speed: number
    radius: number
    /** Height of the sprite, used for hit numbers and health bars. */
    height: number
    damage: number
    elite: boolean
    /** Only heavy hits stagger this enemy. */
    poise: boolean
    shield?: number
    /** Reward weight for the kill counter / score. */
    score: number
}

export const ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeDef> = {
    grunt: { id: 'grunt', name: 'Bandit', hp: 32, speed: 98, radius: 13, height: 34, damage: 10, elite: false, poise: false, score: 10 },
    charger: { id: 'charger', name: 'Tuskhog', hp: 48, speed: 82, radius: 16, height: 26, damage: 16, elite: false, poise: false, score: 20 },
    swarmer: { id: 'swarmer', name: 'Sprigling', hp: 12, speed: 150, radius: 9, height: 20, damage: 5, elite: false, poise: false, score: 5 },
    shield: { id: 'shield', name: 'Shieldwarden', hp: 72, speed: 72, radius: 15, height: 38, damage: 14, elite: false, poise: false, shield: 45, score: 30 },
    ranged: { id: 'ranged', name: 'Thornspitter', hp: 26, speed: 88, radius: 12, height: 32, damage: 8, elite: false, poise: false, score: 25 },
    ogre: { id: 'ogre', name: 'Bog Ogre', hp: 520, speed: 60, radius: 30, height: 72, damage: 30, elite: true, poise: true, score: 300 },
    warlord: { id: 'warlord', name: 'Ashen Warlord', hp: 380, speed: 92, radius: 22, height: 50, damage: 22, elite: true, poise: true, shield: 140, score: 300 }
}

/** Which wave each archetype first appears on. */
export const UNLOCK_WAVE: Record<EnemyTypeId, number> = {
    grunt: 1,
    charger: 1,
    swarmer: 3,
    shield: 5,
    ranged: 7,
    ogre: 4,
    warlord: 8
}

export interface WaveScaling {
    hp: number
    speed: number
    damage: number
}

/** Difficulty ramps mostly through count and archetypes; stats creep gently. */
export function waveScaling(wave: number): WaveScaling {
    const w = Math.max(0, wave - 1)
    return {
        hp: 1 + w * 0.07 + w * w * 0.0035,
        speed: Math.min(1.35, 1 + w * 0.018),
        damage: 1 + w * 0.06
    }
}
