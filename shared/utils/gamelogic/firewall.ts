/**
 * FIREWALL — a lane-defence game in the Storm the House mould.
 *
 * You hold a data core against waves of intrusion daemons that walk in from the
 * left. Every wave is a fixed 50 seconds; when the clock runs out the firewall
 * purges whatever is still standing and you spend the wave's credits in the
 * uplink before deploying the next one.
 *
 * Everything in this file is balance data and derivation — no rendering, no
 * state. The engine reads a `FirewallLoadout` and never sees an upgrade level;
 * the shop reads the definitions and never sees a stat. That split is what lets
 * the numbers be tuned here without touching either side.
 */

/** One wave, and the uplink is open on either side of it. */
export const FIREWALL_WAVE_MS = 50_000
/**
 * Spawning stops before the wave does, so the last thing released still has
 * time to reach the wall. Without the tail, late spawns are free credits — they
 * get purged halfway across the field having never been a threat.
 */
export const FIREWALL_SPAWN_WINDOW_MS = 43_000
/** Survivors caught by the end-of-wave purge pay this fraction of their bounty. */
export const FIREWALL_PURGE_BOUNTY = 0.25
/** A boss walks in on every wave that is a multiple of this. */
export const FIREWALL_BOSS_EVERY = 5
/** Every second boss is the armoured one. */
export const FIREWALL_HEAVY_BOSS_EVERY = 10

export type FirewallEnemyId =
    | 'crawler' | 'grunt' | 'sapper' | 'drone' | 'brute' | 'spitter'
    | 'warden' | 'tank' | 'artillery' | 'gunship'
    | 'titan' | 'leviathan'

/** How an enemy behaves once it reaches its stopping distance from the wall. */
export type FirewallEnemyKind =
    /** Walks to the wall and hits it on a timer. */
    | 'walker'
    /** Same, but airborne — the floor trap never touches it. */
    | 'flyer'
    /** Halts at `range` and shoots instead of closing. */
    | 'ranged'
    /** Detonates on contact for its full damage and dies doing it. */
    | 'bomber'

export interface FirewallEnemyDefinition {
    id: FirewallEnemyId
    name: string
    kind: FirewallEnemyKind
    hp: number
    /** Pixels per second at scale 1. */
    speed: number
    /** Damage per hit on the wall. */
    damage: number
    attackMs: number
    bounty: number
    /** Weight against the wave budget — the only thing that limits wave size. */
    cost: number
    /** Body height in pixels at scale 1, used for hitboxes and drawing. */
    height: number
    hex: number
    /** First wave this type can appear on. */
    fromWave: number
    /** Relative pick weight once unlocked. */
    weight: number
    /**
     * Fraction of non-armour-piercing damage shrugged off. Plated units are the
     * whole reason to own an AP weapon or turret, so this is deliberately harsh.
     */
    armor: number
    /** Ranged only: how far from the wall it sets up. */
    range?: number
    /** Airborne units cruise this far above their ground lane. */
    altitude?: number
    /** Ranged only: shots per volley. */
    burst?: number
    boss?: boolean
}

export const FIREWALL_ENEMIES: readonly FirewallEnemyDefinition[] = [
    {
        id: 'crawler',
        name: 'Crawler',
        kind: 'walker',
        hp: 24,
        speed: 124,
        damage: 3,
        attackMs: 620,
        bounty: 7,
        cost: 3,
        height: 34,
        hex: 0x4ade80,
        fromWave: 1,
        weight: 34,
        armor: 0
    },
    {
        id: 'grunt',
        name: 'Daemon',
        kind: 'walker',
        hp: 62,
        speed: 58,
        damage: 8,
        attackMs: 900,
        bounty: 12,
        cost: 5,
        height: 52,
        hex: 0x67e8f9,
        fromWave: 1,
        weight: 40,
        armor: 0
    },
    {
        id: 'sapper',
        name: 'Sapper',
        kind: 'bomber',
        hp: 44,
        speed: 158,
        damage: 62,
        attackMs: 1,
        bounty: 20,
        cost: 8,
        height: 42,
        hex: 0xf87171,
        fromWave: 3,
        weight: 20,
        armor: 0
    },
    {
        id: 'drone',
        name: 'Wisp',
        kind: 'flyer',
        hp: 46,
        speed: 104,
        damage: 7,
        attackMs: 700,
        bounty: 17,
        cost: 7,
        height: 26,
        hex: 0x93c5fd,
        fromWave: 4,
        weight: 22,
        armor: 0,
        altitude: 150
    },
    {
        id: 'brute',
        name: 'Bulwark',
        kind: 'walker',
        hp: 300,
        speed: 33,
        damage: 26,
        attackMs: 1250,
        bounty: 42,
        cost: 16,
        height: 82,
        hex: 0xfbbf24,
        fromWave: 5,
        weight: 18,
        armor: 0.2
    },
    {
        id: 'spitter',
        name: 'Lancer',
        kind: 'ranged',
        hp: 78,
        speed: 46,
        damage: 11,
        attackMs: 1700,
        bounty: 26,
        cost: 11,
        height: 56,
        hex: 0xc084fc,
        fromWave: 6,
        weight: 20,
        armor: 0,
        range: 430
    },
    {
        id: 'warden',
        name: 'Warden',
        kind: 'walker',
        hp: 240,
        speed: 44,
        damage: 18,
        attackMs: 1000,
        bounty: 46,
        cost: 15,
        height: 66,
        hex: 0xa3a3a3,
        fromWave: 8,
        weight: 22,
        armor: 0.55
    },
    {
        id: 'tank',
        name: 'Siege Tank',
        kind: 'walker',
        hp: 900,
        speed: 26,
        damage: 52,
        attackMs: 1400,
        bounty: 120,
        cost: 34,
        height: 76,
        hex: 0xfb923c,
        fromWave: 10,
        weight: 16,
        armor: 0.78
    },
    {
        id: 'artillery',
        name: 'Howitzer',
        kind: 'ranged',
        hp: 420,
        speed: 30,
        damage: 46,
        attackMs: 3200,
        bounty: 105,
        cost: 26,
        height: 62,
        hex: 0xf472b6,
        fromWave: 12,
        weight: 15,
        armor: 0.4,
        // Sets up beyond every turret's reach but its own, which is what makes
        // it the thing you drop everything to kill.
        range: 820,
        burst: 2
    },
    {
        id: 'gunship',
        name: 'Gunship',
        kind: 'ranged',
        hp: 300,
        speed: 74,
        damage: 15,
        attackMs: 1500,
        bounty: 88,
        cost: 22,
        height: 40,
        hex: 0x38bdf8,
        fromWave: 14,
        weight: 16,
        armor: 0.45,
        range: 520,
        altitude: 190,
        burst: 3
    },
    {
        id: 'titan',
        name: 'ROOTKIT',
        kind: 'walker',
        hp: 1500,
        speed: 27,
        damage: 70,
        attackMs: 1500,
        bounty: 320,
        cost: 0,
        height: 140,
        hex: 0xfb7185,
        fromWave: FIREWALL_BOSS_EVERY,
        weight: 0,
        armor: 0.25,
        boss: true
    },
    {
        id: 'leviathan',
        name: 'BLACK ICE',
        kind: 'walker',
        hp: 4200,
        speed: 22,
        damage: 110,
        attackMs: 1600,
        bounty: 900,
        cost: 0,
        height: 176,
        hex: 0xa78bfa,
        fromWave: FIREWALL_HEAVY_BOSS_EVERY,
        weight: 0,
        armor: 0.7,
        boss: true
    }
] as const

const ENEMY_BY_ID = new Map(FIREWALL_ENEMIES.map(def => [def.id, def]))

export function firewallEnemy(id: FirewallEnemyId): FirewallEnemyDefinition {
    const def = ENEMY_BY_ID.get(id)
    if (!def) throw new Error(`Unknown firewall enemy: ${id}`)
    return def
}

/** Airborne units float; the grid trap and ground clutter ignore them. */
export function firewallIsAirborne(def: FirewallEnemyDefinition) {
    return (def.altitude ?? 0) > 0
}

// ─── Wave scaling ───────────────────────────────────────────────────────────

/**
 * Enemy health compounds while your damage is bought in flat multiplier steps,
 * which is what forces the uplink to stay interesting: a build that ignores
 * damage stops killing things somewhere around wave fifteen.
 */
export function firewallHpMultiplier(wave: number) {
    return Math.pow(1.125, Math.max(0, wave - 1))
}

/** Bounty grows far slower than health, so late waves are about efficiency. */
export function firewallBountyMultiplier(wave: number) {
    return 1 + Math.max(0, wave - 1) * 0.05
}

/** Total enemy cost a wave may spend. */
export function firewallWaveBudget(wave: number) {
    return Math.round(40 + (wave - 1) * 27 + Math.pow(wave, 1.75))
}

/** Paid on surviving a wave, scaled by how much of the wall is left standing. */
export function firewallClearBonus(wave: number, integrity: number) {
    return Math.round((45 + wave * 24) * (0.55 + 0.45 * Math.max(0, Math.min(1, integrity))))
}

export function firewallIsBossWave(wave: number) {
    return wave % FIREWALL_BOSS_EVERY === 0
}

export function firewallBossFor(wave: number): FirewallEnemyId {
    return wave % FIREWALL_HEAVY_BOSS_EVERY === 0 ? 'leviathan' : 'titan'
}

/** Types that may be rolled on this wave, bosses excluded — they are scripted. */
export function firewallWavePool(wave: number) {
    return FIREWALL_ENEMIES.filter(def => !def.boss && def.fromWave <= wave)
}

// ─── Weapons ────────────────────────────────────────────────────────────────

export type FirewallWeaponId = 'rail' | 'flak' | 'arc' | 'missile' | 'sniper'

/** How a round behaves in flight and on impact. */
export type FirewallProjectile = 'rail' | 'pellet' | 'arc' | 'missile' | 'slug'

export interface FirewallWeaponDefinition {
    id: FirewallWeaponId
    name: string
    icon: string
    /** One-off purchase. The starting rail is free. */
    cost: number
    /** Two or three words. The stat block says the rest. */
    tag: string
    damage: number
    fireIntervalMs: number
    magazine: number
    reloadMs: number
    projectile: FirewallProjectile
    speed: number
    /** Ignores plating entirely. The reason to own more than one weapon. */
    armorPiercing: boolean
    pierce: number
    /** Shotgun spread: rounds per trigger pull, and the cone in radians. */
    pellets?: number
    spread?: number
    /** Splash on impact. */
    splashRadius?: number
    splashDamage?: number
    /** Missiles steer toward a target. */
    homing?: boolean
    /** Arc rounds jump to this many extra targets for a fraction of the damage. */
    chain?: number
    chainFalloff?: number
    hex: number
}

export const FIREWALL_WEAPONS: readonly FirewallWeaponDefinition[] = [
    {
        id: 'rail',
        name: 'Packet Rail',
        icon: 'i-lucide-zap',
        cost: 0,
        tag: 'all-rounder',
        damage: 11,
        fireIntervalMs: 330,
        magazine: 10,
        reloadMs: 1500,
        projectile: 'rail',
        speed: 2600,
        armorPiercing: false,
        pierce: 0,
        hex: 0x22d3ee
    },
    {
        id: 'flak',
        name: 'Fragmenter',
        icon: 'i-lucide-shell',
        cost: 400,
        tag: 'crowds',
        damage: 6,
        fireIntervalMs: 620,
        magazine: 8,
        reloadMs: 1600,
        projectile: 'pellet',
        speed: 1600,
        armorPiercing: false,
        pierce: 0,
        pellets: 5,
        spread: 0.17,
        hex: 0xfbbf24
    },
    {
        id: 'arc',
        name: 'Tesla Coil',
        icon: 'i-lucide-git-fork',
        cost: 550,
        tag: 'chains',
        damage: 10,
        fireIntervalMs: 420,
        magazine: 14,
        reloadMs: 1700,
        projectile: 'arc',
        speed: 3200,
        armorPiercing: false,
        pierce: 0,
        chain: 3,
        chainFalloff: 0.6,
        hex: 0x818cf8
    },
    {
        id: 'missile',
        name: 'Seeker Pod',
        icon: 'i-lucide-rocket',
        cost: 700,
        tag: 'armour · splash',
        damage: 26,
        fireIntervalMs: 900,
        magazine: 5,
        reloadMs: 2000,
        projectile: 'missile',
        speed: 900,
        armorPiercing: true,
        pierce: 0,
        splashRadius: 115,
        splashDamage: 16,
        homing: true,
        hex: 0xfb923c
    },
    {
        id: 'sniper',
        name: 'Longbore',
        icon: 'i-lucide-crosshair',
        cost: 800,
        tag: 'armour · pierce',
        damage: 72,
        fireIntervalMs: 1400,
        magazine: 4,
        reloadMs: 2200,
        projectile: 'slug',
        speed: 4400,
        armorPiercing: true,
        pierce: 2,
        hex: 0xf0abfc
    }
] as const

export function firewallWeapon(id: FirewallWeaponId): FirewallWeaponDefinition {
    const def = FIREWALL_WEAPONS.find(w => w.id === id)
    if (!def) throw new Error(`Unknown firewall weapon: ${id}`)
    return def
}

// ─── Turrets ────────────────────────────────────────────────────────────────

export type FirewallTurretId = 'gun' | 'needler' | 'warhead' | 'lance'

export interface FirewallTurretDefinition {
    id: FirewallTurretId
    name: string
    icon: string
    cost: number
    tag: string
    damage: number
    intervalMs: number
    range: number
    armorPiercing: boolean
    pierce: number
    splashRadius?: number
    splashDamage?: number
    hex: number
}

export const FIREWALL_TURRETS: readonly FirewallTurretDefinition[] = [
    {
        id: 'gun',
        name: 'Sentry',
        icon: 'i-lucide-cpu',
        cost: 150,
        tag: 'steady',
        damage: 10,
        intervalMs: 900,
        range: 900,
        armorPiercing: false,
        pierce: 0,
        hex: 0x4ade80
    },
    {
        id: 'needler',
        name: 'Needler',
        icon: 'i-lucide-align-justify',
        cost: 240,
        tag: 'fast',
        damage: 4,
        intervalMs: 230,
        range: 700,
        armorPiercing: false,
        pierce: 0,
        hex: 0x67e8f9
    },
    {
        id: 'warhead',
        name: 'Warhead Rack',
        icon: 'i-lucide-rocket',
        cost: 420,
        tag: 'armour · splash',
        damage: 24,
        intervalMs: 1900,
        range: 950,
        armorPiercing: true,
        pierce: 0,
        splashRadius: 100,
        splashDamage: 14,
        hex: 0xfb923c
    },
    {
        id: 'lance',
        name: 'Rail Lance',
        icon: 'i-lucide-move-right',
        cost: 480,
        tag: 'armour · pierce',
        damage: 46,
        intervalMs: 2100,
        range: 1200,
        armorPiercing: true,
        pierce: 2,
        hex: 0xf0abfc
    }
] as const

export function firewallTurret(id: FirewallTurretId): FirewallTurretDefinition {
    const def = FIREWALL_TURRETS.find(t => t.id === id)
    if (!def) throw new Error(`Unknown firewall turret: ${id}`)
    return def
}

/** Selling a mount back pays this much of what it cost. */
export const FIREWALL_TURRET_REFUND = 0.5

// ─── Upgrades ───────────────────────────────────────────────────────────────

export type FirewallUpgradeId =
    | 'damage' | 'firerate' | 'magazine' | 'reload' | 'pierce' | 'crit'
    | 'integrity' | 'repair' | 'shield' | 'spikes' | 'ramparts'
    | 'turretPower' | 'bounty' | 'pulse' | 'overclock'

export type FirewallTab = 'rail' | 'bastion' | 'turrets' | 'systems'

export interface FirewallUpgradeDefinition {
    id: FirewallUpgradeId
    name: string
    icon: string
    tab: FirewallTab
    max: number
    baseCost: number
    /** Cost multiplier per level already owned. */
    growth: number
    /** The stat at a given level. Kept to a few characters — the shop is a list. */
    value: (level: number) => string
}

export const FIREWALL_UPGRADES: readonly FirewallUpgradeDefinition[] = [
    {
        id: 'damage',
        name: 'Amplifier',
        icon: 'i-lucide-zap',
        tab: 'rail',
        max: 12,
        baseCost: 70,
        growth: 1.33,
        value: level => `×${(1 + level * 0.35).toFixed(2)} dmg`
    },
    {
        id: 'firerate',
        name: 'Clock Speed',
        icon: 'i-lucide-gauge',
        tab: 'rail',
        max: 10,
        baseCost: 80,
        growth: 1.36,
        value: level => `×${(1 / Math.pow(0.93, level)).toFixed(2)} rate`
    },
    {
        id: 'magazine',
        name: 'Buffer',
        icon: 'i-lucide-layers',
        tab: 'rail',
        max: 8,
        baseCost: 60,
        growth: 1.3,
        value: level => `×${(1 + level * 0.28).toFixed(2)} mag`
    },
    {
        id: 'reload',
        name: 'Flush Rate',
        icon: 'i-lucide-refresh-cw',
        tab: 'rail',
        max: 8,
        baseCost: 65,
        growth: 1.32,
        value: level => `×${Math.pow(0.9, level).toFixed(2)} reload`
    },
    {
        id: 'pierce',
        name: 'Lance Coil',
        icon: 'i-lucide-move-right',
        tab: 'rail',
        max: 3,
        baseCost: 260,
        growth: 1.9,
        value: level => `+${level} pierce`
    },
    {
        id: 'crit',
        name: 'Exploit',
        icon: 'i-lucide-crosshair',
        tab: 'rail',
        max: 8,
        baseCost: 100,
        growth: 1.4,
        value: level => `${Math.round((0.04 + level * 0.04) * 100)}% · ${(2 + level * 0.15).toFixed(1)}x`
    },
    {
        id: 'integrity',
        name: 'Integrity',
        icon: 'i-lucide-brick-wall',
        tab: 'bastion',
        max: 14,
        baseCost: 70,
        growth: 1.32,
        value: level => `${900 + level * 340} HP`
    },
    {
        id: 'ramparts',
        name: 'Ramparts',
        icon: 'i-lucide-building-2',
        tab: 'bastion',
        max: 6,
        baseCost: 200,
        growth: 1.55,
        value: level => `${FIREWALL_BASE_SLOTS + level} mounts`
    },
    {
        id: 'repair',
        name: 'Patch Daemon',
        icon: 'i-lucide-wrench',
        tab: 'bastion',
        max: 10,
        baseCost: 90,
        growth: 1.36,
        value: level => `${(level * 6.5).toFixed(1)} HP/s`
    },
    {
        id: 'shield',
        name: 'Barrier',
        icon: 'i-lucide-shield',
        tab: 'bastion',
        max: 8,
        baseCost: 120,
        growth: 1.42,
        value: level => level === 0 ? 'offline' : `${level * 70} · ${8 + level * 3}/s`
    },
    {
        id: 'spikes',
        name: 'Grid Trap',
        icon: 'i-lucide-grid-2x2',
        tab: 'bastion',
        max: 8,
        baseCost: 140,
        growth: 1.44,
        value: level => level === 0 ? 'offline' : `${level * 30} dmg/s`
    },
    {
        id: 'turretPower',
        name: 'Firmware',
        icon: 'i-lucide-microchip',
        tab: 'turrets',
        max: 10,
        baseCost: 130,
        growth: 1.4,
        value: level => `×${(1 + level * 0.3).toFixed(2)} · ×${(1 / Math.pow(0.94, level)).toFixed(2)}`
    },
    {
        id: 'bounty',
        name: 'Skimmer',
        icon: 'i-lucide-coins',
        tab: 'systems',
        max: 8,
        baseCost: 150,
        growth: 1.45,
        value: level => `+${level * 12}% credits`
    },
    {
        id: 'pulse',
        name: 'ICE Pulse',
        icon: 'i-lucide-radio',
        tab: 'systems',
        max: 6,
        baseCost: 190,
        growth: 1.5,
        value: level => level === 0
            ? 'locked'
            : `${60 + level * 60} dmg · ${(30 * Math.pow(0.86, level - 1)).toFixed(0)}s`
    },
    {
        id: 'overclock',
        name: 'Overclock',
        icon: 'i-lucide-flame',
        tab: 'systems',
        max: 5,
        baseCost: 320,
        growth: 1.6,
        value: level => level === 0 ? 'locked' : `${(3 + level).toFixed(0)}s ×${(1.6 + level * 0.25).toFixed(2)}`
    }
] as const

export function firewallUpgrade(id: FirewallUpgradeId): FirewallUpgradeDefinition {
    const def = FIREWALL_UPGRADES.find(u => u.id === id)
    if (!def) throw new Error(`Unknown firewall upgrade: ${id}`)
    return def
}

export type FirewallUpgradeLevels = Record<FirewallUpgradeId, number>

export function firewallEmptyLevels(): FirewallUpgradeLevels {
    return Object.fromEntries(FIREWALL_UPGRADES.map(u => [u.id, 0])) as FirewallUpgradeLevels
}

/** Cost of the next level, rounded to something that reads like a price tag. */
export function firewallUpgradeCost(def: FirewallUpgradeDefinition, level: number) {
    return Math.round(def.baseCost * Math.pow(def.growth, level) / 5) * 5
}

/** Repairing the wall by hand is priced per missing point, so it is never a trap. */
export function firewallRepairCost(missingHp: number) {
    return Math.max(10, Math.round(missingHp * 0.3 / 5) * 5)
}

/** Mounts on a bare wall, before any Ramparts levels. */
export const FIREWALL_BASE_SLOTS = 2

export function firewallSlots(rampartLevel: number) {
    return FIREWALL_BASE_SLOTS + rampartLevel
}

// ─── Loadout ────────────────────────────────────────────────────────────────

/** A weapon with every upgrade already folded in. */
export interface FirewallWeaponRuntime {
    id: FirewallWeaponId
    name: string
    damage: number
    fireIntervalMs: number
    magazine: number
    reloadMs: number
    pierce: number
    projectile: FirewallProjectile
    speed: number
    armorPiercing: boolean
    pellets: number
    spread: number
    splashRadius: number
    splashDamage: number
    homing: boolean
    chain: number
    chainFalloff: number
    hex: number
}

export interface FirewallTurretRuntime {
    id: FirewallTurretId
    slot: number
    name: string
    damage: number
    intervalMs: number
    range: number
    armorPiercing: boolean
    pierce: number
    splashRadius: number
    splashDamage: number
    hex: number
}

/** Everything the engine needs to run a wave. Derived, never stored. */
export interface FirewallLoadout {
    weapon: FirewallWeaponRuntime
    turrets: FirewallTurretRuntime[]
    slots: number
    rampart: number
    critChance: number
    critMultiplier: number
    bountyMultiplier: number
    wallMaxHp: number
    repairPerSec: number
    shieldMax: number
    shieldRegenPerSec: number
    spikeDps: number
    pulseDamage: number
    pulseCooldownMs: number
    pulseUnlocked: boolean
    overclockMs: number
    overclockMultiplier: number
    overclockUnlocked: boolean
    overclockCooldownMs: number
}

export interface FirewallArmoury {
    levels: FirewallUpgradeLevels
    /** Weapon ids the player has bought. `rail` is always present. */
    owned: FirewallWeaponId[]
    active: FirewallWeaponId
    /** One entry per mount; `null` is an empty mount. */
    turrets: (FirewallTurretId | null)[]
}

export function firewallEmptyArmoury(): FirewallArmoury {
    return {
        levels: firewallEmptyLevels(),
        owned: ['rail'],
        active: 'rail',
        turrets: Array.from({ length: FIREWALL_BASE_SLOTS }, () => null)
    }
}

export function firewallWeaponRuntime(id: FirewallWeaponId, levels: FirewallUpgradeLevels): FirewallWeaponRuntime {
    const def = firewallWeapon(id)
    return {
        id: def.id,
        name: def.name,
        // Upgrades are multipliers rather than flat adds so that every weapon
        // scales at the same rate — a flat +6 would quietly make the fastest
        // weapon the only correct choice.
        damage: def.damage * (1 + levels.damage * 0.35),
        fireIntervalMs: def.fireIntervalMs * Math.pow(0.93, levels.firerate),
        magazine: Math.max(1, Math.round(def.magazine * (1 + levels.magazine * 0.28))),
        reloadMs: def.reloadMs * Math.pow(0.9, levels.reload),
        pierce: def.pierce + levels.pierce,
        projectile: def.projectile,
        speed: def.speed,
        armorPiercing: def.armorPiercing,
        pellets: def.pellets ?? 1,
        spread: def.spread ?? 0,
        splashRadius: def.splashRadius ?? 0,
        splashDamage: (def.splashDamage ?? 0) * (1 + levels.damage * 0.35),
        homing: def.homing ?? false,
        chain: def.chain ?? 0,
        chainFalloff: def.chainFalloff ?? 0,
        hex: def.hex
    }
}

export function firewallLoadout(armoury: FirewallArmoury): FirewallLoadout {
    const levels = armoury.levels
    const pulse = levels.pulse
    const overclock = levels.overclock

    const turrets: FirewallTurretRuntime[] = []
    armoury.turrets.forEach((id, slot) => {
        if (!id) return
        const def = firewallTurret(id)
        turrets.push({
            id: def.id,
            slot,
            name: def.name,
            damage: def.damage * (1 + levels.turretPower * 0.3),
            intervalMs: def.intervalMs * Math.pow(0.94, levels.turretPower),
            range: def.range,
            armorPiercing: def.armorPiercing,
            pierce: def.pierce,
            splashRadius: def.splashRadius ?? 0,
            splashDamage: (def.splashDamage ?? 0) * (1 + levels.turretPower * 0.3),
            hex: def.hex
        })
    })

    return {
        weapon: firewallWeaponRuntime(armoury.active, levels),
        turrets,
        slots: firewallSlots(levels.ramparts),
        rampart: levels.ramparts,
        critChance: 0.04 + levels.crit * 0.04,
        critMultiplier: 2 + levels.crit * 0.15,
        bountyMultiplier: 1 + levels.bounty * 0.12,
        wallMaxHp: 900 + levels.integrity * 340,
        repairPerSec: levels.repair * 6.5,
        shieldMax: levels.shield * 70,
        shieldRegenPerSec: levels.shield > 0 ? 8 + levels.shield * 3 : 0,
        spikeDps: levels.spikes * 30,
        pulseDamage: pulse > 0 ? 60 + pulse * 60 : 0,
        pulseCooldownMs: 30_000 * Math.pow(0.86, Math.max(0, pulse - 1)),
        pulseUnlocked: pulse > 0,
        overclockMs: overclock > 0 ? (3 + overclock) * 1000 : 0,
        overclockMultiplier: 1.6 + overclock * 0.25,
        overclockUnlocked: overclock > 0,
        overclockCooldownMs: 24_000
    }
}

/** Seconds without taking a hit before the barrier starts coming back. */
export const FIREWALL_SHIELD_DELAY_MS = 3000

/** Damage left after plating, for a source that does or does not pierce armour. */
export function firewallArmorScale(armor: number, armorPiercing: boolean) {
    return armorPiercing ? 1 : 1 - armor
}
