import type { Container, Graphics } from 'pixi.js'
import type {
    VoidDerivedStats, VoidEnemyDefinition, VoidResourceBundle, VoidResourceId,
    VoidRockDefinition, VoidTurretRuntime, VoidSpecialId
} from '#shared/utils/gamelogic/void'

// ─── Public API ─────────────────────────────────────────────────────────────

export interface VoidLaunchConfig {
    sector: number
    stats: VoidDerivedStats
    shipId: string
    turrets: VoidTurretRuntime[]
    power: number
}

export interface VoidRunResult {
    reason: 'extracted' | 'destroyed' | 'timeout' | 'cancelled'
    extracted: boolean
    haul: VoidResourceBundle
    units: number
    /** Market value of the hold at the moment the run ended, for the summary. */
    haulValue: number
    kills: number
    rocksMined: number
    shotsFired: number
    elapsedMs: number
    killsByType: { id: string, name: string, count: number }[]
    deepestStormDamage: number
    bossesKilled: number
}

export interface VoidHudCargo {
    units: number
    capacity: number
    bundle: VoidResourceBundle
    /** What the hold is worth at market rates — the run's real score. */
    value: number
}

export interface VoidGameCallbacks {
    onHullChange: (hull: number, maxHull: number, shield: number, maxShield: number) => void
    onCargoChange: (cargo: VoidHudCargo) => void
    /** `threat` is the current per-minute difficulty multiplier, shown in the HUD. */
    onTimeChange: (elapsedMs: number, stormPhase: number, threat: number) => void
    onMiningProgress: (progress: number, label: string | null) => void
    onExtractProgress: (progress: number, inRange: boolean) => void
    onBoostChange: (chargeMs: number, capacityMs: number) => void
    onRunEnd: (result: VoidRunResult) => void
    onNotice?: (text: string, kind: 'good' | 'bad' | 'info') => void
    onBossSpawn?: (name: string) => void
    onStormPhase?: (phase: 'closing' | 'engulfed') => void
    onShoot?: () => void
    onHit?: () => void
    onExplosion?: (big: boolean) => void
    onMineComplete?: (resource: VoidResourceId, amount: number) => void
}

// ─── Internal runtime ───────────────────────────────────────────────────────

export interface Particle {
    gfx: Graphics
    x: number
    y: number
    vx: number
    vy: number
    life: number
    maxLife: number
    drag: number
    spin: number
    scaleDecay: number
}

export interface Bullet {
    gfx: Container
    x: number
    y: number
    vx: number
    vy: number
    life: number
    damage: number
    /** Remaining targets it can punch through before it dies. */
    pierce: number
    splash: number
    lifesteal: number
    homing: number
    hostile: boolean
    color: number
    rocket: boolean
    chain: boolean
    hitIds: Set<number>
    targetId: number | null
}

export interface RockEntity {
    id: number
    def: VoidRockDefinition
    root: Container
    body: Graphics
    x: number
    y: number
    radius: number
    rotation: number
    spin: number
    /** 0..1 of the way through being cut. */
    progress: number
    breakGraceMs: number
    depleted: boolean
    respawnMs: number
}

export type EnemyState = 'drift' | 'chase' | 'strafe'

export interface EnemyEntity {
    id: number
    def: VoidEnemyDefinition
    root: Container
    body: Container
    hpBar: Graphics
    hpBarBg: Graphics
    x: number
    y: number
    vx: number
    vy: number
    angle: number
    hp: number
    maxHp: number
    damage: number
    speed: number
    fireTimer: number
    abilityTimer: number
    state: EnemyState
    driftAngle: number
    driftTimer: number
    strafeSign: number
    dead: boolean
    boss: boolean
    flashMs: number
    /** Set on hunter-killers so their carrier can respect a launch cap. */
    carrierId: number | null
}

export interface ShockwaveEntity {
    gfx: Graphics
    x: number
    y: number
    age: number
    telegraphMs: number
    expandMs: number
    radius: number
    damage: number
    fired: boolean
    hitPlayer: boolean
}

export interface RailbeamEntity {
    gfx: Graphics
    x: number
    y: number
    angle: number
    age: number
    chargeMs: number
    activeMs: number
    damage: number
    fired: boolean
}

export interface MineEntity {
    root: Container
    ring: Graphics
    x: number
    y: number
    age: number
    armMs: number
    life: number
    radius: number
    damage: number
    triggered: boolean
}

export interface SingularityEntity {
    gfx: Container
    x: number
    y: number
    age: number
    life: number
    damage: number
    tickMs: number
}

export interface DroneEntity {
    gfx: Container
    angle: number
    fireTimer: number
}

export interface PickupEntity {
    gfx: Container
    x: number
    y: number
    vx: number
    vy: number
    age: number
    resource: VoidResourceId
    amount: number
}

export interface SpecialFlags {
    rocket: boolean
    chain: boolean
    railgun: boolean
    drones: boolean
    siphon: boolean
    singularity: boolean
    harvester: boolean
    prospectorsEye: boolean
}

export function emptySpecialFlags(): SpecialFlags {
    return {
        rocket: false, chain: false, railgun: false, drones: false,
        siphon: false, singularity: false, harvester: false, prospectorsEye: false
    }
}

export function specialFlagKey(id: VoidSpecialId): keyof SpecialFlags {
    switch (id) {
        case 'rocket-conversion': return 'rocket'
        case 'chain-arc': return 'chain'
        case 'railgun': return 'railgun'
        case 'swarm-drones': return 'drones'
        case 'void-siphon': return 'siphon'
        case 'singularity': return 'singularity'
        case 'harvester': return 'harvester'
        case 'prospectors-eye': return 'prospectorsEye'
    }
}
