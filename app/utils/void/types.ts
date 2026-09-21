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
    /** Hull tier after refits: picks the paint. */
    shipTier?: number
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
    /** Tier-1 pilot guide lessons already learned; null once the guide is over. */
    guideLearned?: string[] | null
    /** Walk the pilot through the basics on their first flight. */
    tutorial?: boolean
    /** What the server says about this sector's two beacons. */
    beacons?: import('#shared/utils/gamelogic/void').VoidBeaconState[]
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
    tyrantKilled: boolean
    harbingerKilled: boolean
    telemetry: import('#shared/utils/gamelogic/void-telemetry').VoidRunTelemetry
    lore: string[]
    /** Beacon slots won or held this run. */
    beaconsCaptured: number[]
    beaconsDefended: number[]
}

export type Phase = 'hangar' | 'flying' | 'docking' | 'dead'

export interface HudTarget {
    name: string
    hp: number
    maxHp: number
    shield: number
    shieldMax: number
    kind: 'enemy' | 'rock' | 'crate'
    detail: string
    /** Metres from the ship. */
    dist: number
    hostile: boolean
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
    boosting: boolean
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
    /** The boss bar: the sector warden, or a hidden capital once it is awake. `locks` counts shield reactors still standing, `marks` are the hull fractions where its phases turn. */
    warden: null | { name: string, hp: number, maxHp: number, shield: number, shieldMax: number, carrier?: boolean, locks?: number, lockLabel?: string, marks?: number[] }
    wardenKilled: boolean
    threat: number
    /** 0-5 stars: how hard the sector is hunting you. */
    wanted: number
    target: HudTarget | null
    lowHull: boolean
    outOfBounds: boolean
    objectives: import('./objectives').ObjectiveView | null
    streak: number
    skill: import('./skills').SkillHud | null
    supplies: { id: string, name: string, key: string, count: number, color: string }[]
    relics: number
    gearCaches: number
    systems: import('./systems').SystemsHud | null
    energyLow: boolean
    gate: null | { distance: number, fuel: number }
    trader: boolean
    cockpit: boolean
    /** The pilot has scrolled the chase camera out past its default distance. */
    zoomed: boolean
}

export interface EngineEvents {
    hud: (hud: HudState) => void
    toast: (text: string, tone: 'info' | 'warn' | 'good' | 'bad') => void
    /** Big cinematic title card. An arrival past a gate names its zone, so the card can show the zone's chips. */
    banner: (title: string, subtitle: string, tone: 'info' | 'bad' | 'good', zone?: { id: import('#shared/utils/gamelogic/void-pilot').VoidZoneModifier, depth: number }) => void
    end: (result: RunResult) => void
    /** A warp gate offers these zones for the next jump. */
    gate: (options: import('#shared/utils/gamelogic/void-pilot').VoidZoneModifier[]) => void
    /** The pilot opened the Free Trader. */
    trade: () => void
    pause: (paused: boolean) => void
    /** The pilot guide ticked off a lesson; the page remembers it between runs. */
    guide?: (lesson: string) => void
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
    /** Wander phase, so each drone drifts on its own rhythm. */
    angle: number
    /** Formation spot in the ship's frame it returns to when idle. */
    slot: THREE.Vector3
    /** Which way it circles a target (1 or -1). */
    orbitDir: number
    cooldown: number
    target: Enemy | null
    rock: import('./asteroids').Asteroid | null
    retarget: number
    temporary: number
    /** Skill-summoned escorts carry their own guns: damage per bolt, shots per second and colour. */
    wing?: { damage: number, rate: number, color: number, guard: number }
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
    /** A missile sent at a rock steers for it the same way. */
    homingRock?: import('./asteroids').Asteroid | null
    kind: 'bolt' | 'orb' | 'missile' | 'pellet' | 'plasma'
    mining: number
    source: string
    /** Bomblets released when a missile bursts. */
    cluster?: number
    /** Homing turn-rate multiplier. */
    turn?: number
    /** Seconds a hostile orb keeps bending towards the pilot before it flies straight. */
    curve?: number
    crit?: number
    /** Hostile shots: who fired it, for the run's telemetry. */
    by?: string
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
