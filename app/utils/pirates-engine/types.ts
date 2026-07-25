import type { Container, Graphics, Sprite } from 'pixi.js'
import type { PirateAbilityId, PiratePowerUpDefinition, PiratePowerUpId, PirateEnemyTier } from '#shared/utils/gamelogic/pirates'

// ─── Public API ─────────────────────────────────────────────────────────────

export interface PirateCannonRuntime {
    slotIndex: number
    tierId: string
    attackRating: number
    maxDamage: number
    reloadMs: number
    range: number
    shotColor: number
    shotTrail: boolean
}

export interface PirateShipStats {
    maxHp: number
    speed: number
    defenseRating: number
    /** Hull repaired per regen cycle, applied only after PIRATE_REGEN_DELAY_MS without taking a hit. */
    regenRate: number
    cannons: PirateCannonRuntime[]
    ammo: number
    gemAmmo: number
    skinId: string
    abilityId: PirateAbilityId
    /** Upgrade level (1-5) of the equipped right-click ability. */
    abilityLevel: number
}

export interface PirateGameOverResult {
    survived: boolean
    coins: number
    elapsedMs: number
    ammoUsed: number
    gemAmmoUsed: number
    kills: number
    shotsFired: number
    abilitiesUsed: number
    sunkByType: { id: string, name: string, count: number }[]
    maxCombo: number
    reason: 'timeout' | 'defeat' | 'cancelled'
    /** 0 (pristine) to 1 (sunk) — drives how long the ship spends in dry dock afterward. */
    hullDamageFraction: number
}

export interface PirateActivePowerUp {
    id: PiratePowerUpId
    name: string
    description: string
    icon: string
    remainingMs: number | null
    stacks: number
    counter?: number
    shield?: number
}

export type PirateAbilitySound =
    | 'powder-keg-throw' | 'powder-keg-explosion'
    | 'hunter-salvo-launch' | 'hunter-salvo-hit'
    | 'consort-summon'
    | 'kraken-open' | 'kraken-loop-start' | 'kraken-loop-stop'
    | 'hellfire-barrage' | 'hellfire-multi'

export interface PirateGameCallbacks {
    onHpChange: (hp: number, maxHp: number) => void
    onCoinsChange: (coins: number) => void
    onAmmoChange: (ammo: number, gemAmmo: number) => void
    /** `locked` marks an ability that is unavailable but not counting down — the consort while its escort is still afloat. */
    onAbilityCooldownChange: (remainingMs: number, totalMs: number, locked?: boolean) => void
    onTimeChange: (elapsedMs: number, remainingMs: number) => void
    onGameOver: (result: PirateGameOverResult) => void
    onCannonFire?: () => void
    onCannonImpact?: () => void
    onShipHit?: () => void
    onAbilitySound?: (sound: PirateAbilitySound) => void
    onKill?: (tierName: string, reward: number) => void
    onTreasureCollected?: () => void
    onCombo?: (count: number) => void
    onBossSpawn?: (name: string) => void
    onPowerUpsChange?: (powerUps: PirateActivePowerUp[], nextDropMs: number, nextHealthPackMs: number) => void
    onPowerUpSpawn?: (name: string) => void
    onPowerUpCollected?: (name: string) => void
    onHealthPackSpawn?: () => void
    onHealthPackCollected?: (amount: number) => void
}

// ─── Internal runtime types ─────────────────────────────────────────────────

export type AmmoKind = 'free' | 'standard' | 'gem'

export interface Cannon extends PirateCannonRuntime {
    reloadTimer: number
}

export interface PlayerShotProfile {
    explosive: boolean
    massive: boolean
    cannonColor: number
    tierTrail: boolean
    /** Top-three cannon tiers leave a soft blooming plasma wake. */
    mutatedTrail?: boolean
    /** Consort fire uses the same bloom shape in a cold slate/blue palette. */
    consortTrail?: boolean
}

export interface Island {
    x: number
    y: number
    r: number
}

export interface ShipVisual {
    root: Container
    hull: Container
    body: Container
    sprite?: Sprite
    sails: Graphics[]
    flashOverlay: Graphics
    phase: number
}

export interface Enemy {
    id: number
    tier: PirateEnemyTier
    hp: number
    maxHp: number
    x: number
    y: number
    angle: number
    reloadTimer: number
    abilityTimer: number
    speed: number
    defense: number
    attackRating: number
    maxDamage: number
    root: Container
    visual: ShipVisual
    targetRing: Graphics
    hpBarFill: Graphics
    hpBarWidth: number
    dead: boolean
}

/**
 * A summoned escort. It mirrors the captain's loadout (same defense rating,
 * speed, and copies of their best cannon) on a much smaller hull, holds
 * station off the player's beam, and can be shot down by the fleet.
 */
export interface AllyShip {
    id: number
    hp: number
    maxHp: number
    x: number
    y: number
    angle: number
    speed: number
    defenseRating: number
    cannons: Cannon[]
    fireGapMs: number
    maxRange: number
    /** Phase offset so multiple escorts hold different stations around the player. */
    stationAngle: number
    root: Container
    visual: ShipVisual
    hpBarFill: Graphics
    hpBarWidth: number
    dead: boolean
}

export interface Treasure {
    root: Container
    x: number
    y: number
    vx: number
    vy: number
    reward: number
    age: number
}

export interface PowerUpPickup {
    root: Container
    definition: PiratePowerUpDefinition
    x: number
    y: number
    vx: number
    vy: number
    age: number
}

export interface HealthPackPickup {
    root: Container
    x: number
    y: number
    vx: number
    vy: number
    age: number
    healFraction: number
}

export interface SeaMine {
    root: Container
    x: number
    y: number
    age: number
    damageFraction: number
}

export type EnemyAbility = 'sniper' | 'mine' | 'bomb' | 'skiffs'
