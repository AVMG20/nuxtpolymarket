import type * as THREE from 'three'
import type { VoidSkillId } from '#shared/utils/gamelogic/void-skills'
import type { VoidModId, VoidWeaponFit } from '#shared/utils/gamelogic/void-items'
import type { VoidDerivedStats, VoidResourceBundle, VoidResourceId, VoidSectorDefinition, VoidTurretDefinition, VoidTurretId, VoidUpgradeLevels } from '#shared/utils/gamelogic/void'
import type { EnemyDefinition, EnemyKind } from './data'
import type { ShieldBubble, Trail } from './fx'
import type { Hardpoint, TurretModel } from './models'

export interface RunConfig {
    sector: VoidSectorDefinition
    shipId: string
    stats: VoidDerivedStats
    turrets: (VoidWeaponFit | null)[]
    levels: VoidUpgradeLevels
    gun: VoidWeaponFit | null
    /** Supplies the ship took out of stock, by id. */
    supplies: Record<string, number>
    secondary?: VoidWeaponFit | null
    device?: VoidWeaponFit | null
    perks?: Record<string, number>
    /** Lore ids the pilot already has, so logs are not repeated. */
    loreKnown?: string[]
    skill: { id: VoidSkillId, nodes: string[] }
    /** Walk the pilot through the basics on their first flight. */
    tutorial?: boolean
}

export interface RunResult {
    reason: 'extracted' | 'destroyed'
    haul: VoidResourceBundle
    /** What was in the hold when the ship went down. */
    lost?: VoidResourceBundle
    kills: number
    wardenKilled: boolean
    elapsedMs: number
    skillUses: number
    suppliesUsed: Record<string, number>
    /** Relic caches picked up; the server rolls what they hold. */
    relics: number
    gearCaches: number
    bonusXp: number
    depth: number
    carrierKilled: boolean
    lore: string[]
}

export type Phase = 'hangar' | 'flying' | 'docking' | 'dead'

export interface HudTarget {
    name: string
    hp: number
    maxHp: number
    kind: 'enemy' | 'rock' | 'crate'
    detail: string
}

export interface HudState {
    phase: Phase
    paused: boolean
    locked: boolean
    hull: number
    maxHull: number
    shield: number
    maxShield: number
    energy: number
    speed: number
    cargo: VoidResourceBundle
    cargoUnits: number
    cargoCap: number
    abilityName: string | null
    abilityReady: number
    abilityActive: boolean
    kills: number
    elapsed: number
    dock: null | { label: string, progress: number, ready: boolean }
    warden: null | { name: string, hp: number, maxHp: number }
    wardenKilled: boolean
    threat: number
    target: HudTarget | null
    lowHull: boolean
    outOfBounds: boolean
    objectives: import('./objectives').ObjectiveView | null
    streak: number
    skill: import('./skills').SkillHud | null
    supplies: { id: string, name: string, key: string, count: number, color: string }[]
    relics: number
    systems: import('./systems').SystemsHud | null
    energyLow: boolean
    gate: null | { distance: number, fuel: number }
    trader: boolean
    cockpit: boolean
}

export interface EngineEvents {
    hud: (hud: HudState) => void
    toast: (text: string, tone: 'info' | 'warn' | 'good' | 'bad') => void
    /** Big cinematic title card. */
    banner: (title: string, subtitle: string, tone: 'info' | 'bad' | 'good') => void
    end: (result: RunResult) => void
    /** A warp gate offers these zones for the next jump. */
    gate: (options: import('#shared/utils/gamelogic/void-pilot').VoidZoneModifier[]) => void
    /** The pilot opened the Free Trader. */
    trade: () => void
    pause: (paused: boolean) => void
}

export type HostileKind = EnemyKind | 'mine' | 'crate' | 'warden' | 'freighter' | 'meteor' | 'vault' | 'mothership' | 'battery' | 'reactor' | 'trader'

export interface Enemy {
    id: number
    kind: HostileKind
    def: EnemyDefinition | null
    name: string
    group: THREE.Group
    pos: THREE.Vector3
    vel: THREE.Vector3
    radius: number
    hp: number
    maxHp: number
    alive: boolean
    /** Crates are shootable but never shoot back. */
    hostile: boolean
    aggro: boolean
    elite: boolean
    anchor: THREE.Vector3
    wander: THREE.Vector3
    cooldown: number
    state: string
    stateTime: number
    /** Locked aim direction for charged attacks. */
    aim: THREE.Vector3
    orbitSign: number
    flash: number
    glow: THREE.Color
    damageMult: number
    shield: ShieldBubble | null
    flames: { material: THREE.ShaderMaterial }[]
    trail: Trail | null
    engines: THREE.Vector3[]
    hitMeshes: THREE.Mesh[]
    /** Anything behaviour-specific. */
    data: Record<string, number>
}

export interface TurretSlot {
    type: VoidTurretId
    def: VoidTurretDefinition
    fit: VoidWeaponFit | null
    shots: number
    model: TurretModel
    mount: Hardpoint
    cooldown: number
    target: Enemy | null
    rock: import('./asteroids').Asteroid | null
    retarget: number
    aligned: boolean
    beam: boolean
    beamPoint: THREE.Vector3
    /** Lead point the turret is tracking. */
    aimPoint: THREE.Vector3
    recoil: number
    worldPos: THREE.Vector3
    worldNormal: THREE.Vector3
    muzzle: THREE.Vector3
}

export interface Drone {
    group: THREE.Group
    pos: THREE.Vector3
    vel: THREE.Vector3
    angle: number
    cooldown: number
    target: Enemy | null
    rock: import('./asteroids').Asteroid | null
    retarget: number
    temporary: number
    trail: Trail
}

export interface Projectile {
    pos: THREE.Vector3
    vel: THREE.Vector3
    life: number
    damage: number
    hostile: boolean
    color: THREE.Color
    width: number
    length: number
    splash: number
    homing: Enemy | null
    kind: 'bolt' | 'orb' | 'missile' | 'pellet' | 'plasma'
    mining: number
    source: string
    /** Bomblets released when a missile bursts. */
    cluster?: number
    /** Homing turn-rate multiplier. */
    turn?: number
    crit?: number
    mod?: VoidModId | null
    dtype?: import('#shared/utils/gamelogic/void-items').VoidDamageType
}

export interface Pickup {
    pos: THREE.Vector3
    vel: THREE.Vector3
    resource: VoidResourceId
    amount: number
    life: number
    spin: number
    pulled: boolean
    pullTime: number
    /** A relic cache instead of cargo. */
    relic?: boolean
    /** A jump fuel cell instead of cargo. */
    fuel?: boolean
    /** A salvaged gear cache; the server rolls the item on extraction. */
    gear?: boolean
}

export interface Tracer {
    a: THREE.Vector3
    b: THREE.Vector3
    color: THREE.Color
    life: number
    maxLife: number
    width: number
}

export interface FloatText {
    pos: THREE.Vector3
    text: string
    color: string
    life: number
    maxLife: number
    size: number
}
