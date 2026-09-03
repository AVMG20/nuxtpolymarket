// What to bake. Paths are relative to the extracted KayKit packs (see README).
export interface AnimSpec {
    name: string
    clip: string
    frames: number
    loop?: boolean
    /** Fraction of the clip to sample, for trimming dead time. */
    start?: number
    end?: number
}

export interface WeaponSpec {
    model: string
    slot: 'handslotr' | 'handslotl'
    scale?: number
    rotate?: [number, number, number]
    offset?: [number, number, number]
}

export interface SheetSpec {
    name: string
    model: string
    weapons?: WeaponSpec[]
    hide?: string[]
    tint?: string
    eyes?: string
    scale?: number
    cell: number
    viewH: number
    lookY: number
    anims: AnimSpec[]
}

export interface AtlasSheet {
    cell: number
    anchorX: number
    anchorY: number
    cols: number
    dirs: number
    anims: Record<string, { row: number, frames: number, loop: boolean }>
}

const ADV = '/KayKit_Adventurers_2.0_FREE'
const SKEL = '/KayKit_Skeletons_1.1_FREE'
const WEAP = '/KayKit_FantasyWeaponsBits_1.0_FREE/Assets/gltf'

const common = (attacks: [string, string, string], extra: AnimSpec[] = []): AnimSpec[] => [
    { name: 'idle', clip: 'Idle_A', frames: 6, loop: true },
    { name: 'run', clip: 'Running_A', frames: 8, loop: true },
    { name: 'attack1', clip: attacks[0], frames: 6, start: 0.05, end: 0.85 },
    { name: 'attack2', clip: attacks[1], frames: 6, start: 0.05, end: 0.85 },
    { name: 'finisher', clip: attacks[2], frames: 6, start: 0.05, end: 0.9 },
    { name: 'roll', clip: 'Dodge_Forward', frames: 6 },
    { name: 'hit', clip: 'Hit_A', frames: 3, end: 0.7 },
    { name: 'death', clip: 'Death_A', frames: 8 },
    { name: 'block', clip: 'Melee_Blocking', frames: 2, loop: true },
    { name: 'cast', clip: 'Ranged_Magic_Spellcasting', frames: 5 },
    { name: 'throw', clip: 'Throw', frames: 5, start: 0.1, end: 0.8 },
    { name: 'spin', clip: 'Melee_2H_Attack_Spinning', frames: 6, loop: true },
    { name: 'jumpchop', clip: 'Melee_1H_Attack_Jump_Chop', frames: 6, start: 0.05, end: 0.9 },
    { name: 'stab', clip: 'Melee_Dualwield_Attack_Stab', frames: 6, start: 0.1, end: 0.8 },
    ...extra
]

const player = (name: string, model: string, attacks: [string, string, string], weapons: WeaponSpec[], opts: Partial<SheetSpec> = {}): SheetSpec => ({
    name, model, weapons, cell: 128, viewH: 3.3, lookY: 1.15, anims: common(attacks), ...opts
})

const skeleton = (name: string, model: string, attack: string, weapons: WeaponSpec[], opts: Partial<SheetSpec> & { walk?: string, idle?: string, cellMul?: number } = {}): SheetSpec => {
    const m = opts.cellMul ?? 1
    return {
        name, model, weapons, cell: Math.round(128 * m), viewH: 3.3 * m, lookY: 1.15 * m, scale: opts.scale, tint: opts.tint, eyes: opts.eyes, hide: opts.hide,
        anims: [
            { name: 'idle', clip: opts.idle ?? 'Skeletons_Idle', frames: 6, loop: true },
            { name: 'walk', clip: opts.walk ?? 'Skeletons_Walking', frames: 8, loop: true },
            { name: 'run', clip: 'Running_A', frames: 8, loop: true },
            { name: 'attack', clip: attack, frames: 8, start: 0.05, end: 0.9 },
            { name: 'hit', clip: 'Hit_A', frames: 3, end: 0.7 },
            { name: 'death', clip: 'Skeletons_Death', frames: 8, end: 0.85 },
            { name: 'spawn', clip: 'Skeletons_Awaken_Floor', frames: 8, start: 0.05, end: 0.85 },
            { name: 'taunt', clip: 'Skeletons_Taunt', frames: 6 }
        ]
    }
}

export const SHEETS: SheetSpec[] = [
    player('knight', `${ADV}/Characters/gltf/Knight.glb`, ['Melee_1H_Attack_Slice_Horizontal', 'Melee_1H_Attack_Slice_Diagonal', 'Melee_1H_Attack_Chop'], [
        { model: `${ADV}/Assets/gltf/sword_1handed.gltf`, slot: 'handslotr' },
        { model: `${ADV}/Assets/gltf/shield_badge_color.gltf`, slot: 'handslotl' }
    ], { hide: ['HelmetVisor'] }),
    player('berserker', `${ADV}/Characters/gltf/Barbarian.glb`, ['Melee_2H_Attack_Slice', 'Melee_2H_Attack_Chop', 'Melee_2H_Attack_Spin'], [
        { model: `${ADV}/Assets/gltf/axe_2handed.gltf`, slot: 'handslotr' }
    ]),
    player('lancer', `${ADV}/Characters/gltf/Ranger.glb`, ['Melee_2H_Attack_Stab', 'Melee_1H_Attack_Stab', 'Melee_2H_Attack_Stab'], [
        { model: `${WEAP}/spear_A.gltf`, slot: 'handslotr', scale: 0.85 }
    ]),
    player('assassin', `${ADV}/Characters/gltf/Rogue_Hooded.glb`, ['Melee_Dualwield_Attack_Slice', 'Melee_Dualwield_Attack_Chop', 'Melee_Dualwield_Attack_Stab'], [
        { model: `${ADV}/Assets/gltf/dagger.gltf`, slot: 'handslotr' },
        { model: `${ADV}/Assets/gltf/dagger.gltf`, slot: 'handslotl' }
    ]),
    player('juggernaut', `${ADV}/Characters/gltf/Knight.glb`, ['Melee_2H_Attack_Slice', 'Melee_2H_Attack_Chop', 'Melee_2H_Attack_Chop'], [
        { model: `${WEAP}/hammer_B.gltf`, slot: 'handslotr', scale: 1.1 }
    ], { tint: '#8c94a8' }),
    player('reaper', `${ADV}/Characters/gltf/Mage.glb`, ['Melee_2H_Attack_Slice', 'Melee_2H_Attack_Spinning', 'Melee_2H_Attack_Spin'], [
        { model: `${WEAP}/halberd.gltf`, slot: 'handslotr', scale: 0.95 }
    ], { tint: '#7d6f9a' }),

    skeleton('grunt', `${SKEL}/characters/gltf/Skeleton_Minion.glb`, 'Melee_1H_Attack_Slice_Horizontal', [
        { model: `${SKEL}/assets/gltf/Skeleton_Blade.gltf`, slot: 'handslotr' }
    ]),
    skeleton('swarmer', `${SKEL}/characters/gltf/Skeleton_Minion.glb`, 'Melee_Unarmed_Attack_Punch_A', [], { scale: 0.68, walk: 'Running_A', eyes: '#8dff3a' }),
    skeleton('charger', `${SKEL}/characters/gltf/Skeleton_Rogue.glb`, 'Melee_Dualwield_Attack_Slice', [
        { model: `${SKEL}/assets/gltf/Skeleton_Blade.gltf`, slot: 'handslotr' },
        { model: `${SKEL}/assets/gltf/Skeleton_Blade.gltf`, slot: 'handslotl' }
    ], { walk: 'Running_A', eyes: '#ffb020' }),
    skeleton('shield', `${SKEL}/characters/gltf/Skeleton_Warrior.glb`, 'Melee_Block_Attack', [
        { model: `${SKEL}/assets/gltf/Skeleton_Axe.gltf`, slot: 'handslotr' },
        { model: `${SKEL}/assets/gltf/Skeleton_Shield_Large_A.gltf`, slot: 'handslotl' }
    ], { idle: 'Melee_Blocking' }),
    skeleton('ranged', `${SKEL}/characters/gltf/Skeleton_Rogue.glb`, 'Ranged_2H_Shoot', [
        { model: `${SKEL}/assets/gltf/Skeleton_Crossbow.gltf`, slot: 'handslotr' }
    ], { idle: 'Ranged_2H_Aiming', eyes: '#c04cff' }),
    skeleton('ogre', `${SKEL}/characters/gltf/Skeleton_Warrior.glb`, 'Melee_2H_Attack_Chop', [
        { model: `${SKEL}/assets/gltf/Skeleton_Axe.gltf`, slot: 'handslotr', scale: 1.4 }
    ], { scale: 1.9, cellMul: 1.9, tint: '#c9c2b0', eyes: '#ff3020' }),
    skeleton('warlord', `${SKEL}/characters/gltf/Skeleton_Warrior.glb`, 'Melee_2H_Attack_Spin', [
        { model: `${SKEL}/assets/gltf/Skeleton_Blade.gltf`, slot: 'handslotr', scale: 1.3 },
        { model: `${SKEL}/assets/gltf/Skeleton_Shield_Large_B.gltf`, slot: 'handslotl', scale: 1.2 }
    ], { scale: 1.4, cellMul: 1.4, tint: '#8f6a78', eyes: '#ff2040' })
]
