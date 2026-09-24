import type { RampName } from './palette'

export type MonsterKind =
    | 'slime' | 'mushroom' | 'wolf' | 'kingSlime'
    | 'goblin' | 'spider' | 'treant' | 'ogre'
    | 'skeleton' | 'ghost' | 'bat' | 'lich'
    | 'imp' | 'salamander' | 'golem' | 'dragon'

/** Animation inputs for one monster frame. All times are in seconds. */
export interface MonsterPose {
    /** Time since spawn; drives idle loops (bob, breathe, flicker). */
    t: number
    /** True while walking in from the right. */
    moving: boolean
    /** Walk cycle clock (only advances while moving). */
    walk: number
    /** Attack progress 0..1 (0 = not attacking). ~0..0.5 wind-up, ~0.5..0.65 lunge/strike, rest recover. */
    attack: number
    /** 1 on the frame it gets hit, decays to 0 over ~0.25s. Use for recoil / squash. */
    hurt: number
}

export interface MonsterInfo {
    name: string
    boss: boolean
    /** Rough body size in logical pixels (used for HP bar placement and hit effects). */
    w: number
    h: number
    /** Height above the feet anchor where projectiles aim and hit sparks spawn. */
    hitY: number
    /** Particle ramp for hit splashes (shatter uses the real sprite colours). */
    ramp: RampName
}

export interface Zone {
    name: string
    monsters: [MonsterKind, MonsterKind, MonsterKind]
    boss: MonsterKind
}

export const ZONES: Zone[] = [
    { name: 'Greenwood Meadow', monsters: ['slime', 'mushroom', 'wolf'], boss: 'kingSlime' },
    { name: 'Darkroot Forest', monsters: ['goblin', 'spider', 'treant'], boss: 'ogre' },
    { name: 'Forsaken Crypt', monsters: ['skeleton', 'ghost', 'bat'], boss: 'lich' },
    { name: 'Cinder Peaks', monsters: ['imp', 'salamander', 'golem'], boss: 'dragon' }
]
