/**
 * FIREWALL — a lane-defence game in the Storm the House mould.
 *
 * You hold a data core against waves of intrusion daemons that walk in from the
 * left. Every wave is a fixed 25 seconds; when the clock runs out the firewall
 * purges whatever is still standing and you spend the wave's credits on
 * upgrades before deploying the next one.
 *
 * Everything in this file is pure balance data and derivation — no rendering,
 * no state. The engine reads a `FirewallLoadout` and never sees an upgrade
 * level; the shop reads the definitions and never sees a stat. That split is
 * what lets the numbers be tuned here without touching either side.
 */

/** One wave, and the shop is open on either side of it. */
export const FIREWALL_WAVE_MS = 25_000
/**
 * Spawning stops before the wave does, so the last daemon released still has
 * time to reach the wall. Without the tail, late spawns were pure free credits
 * — they were purged halfway across the field having never been a threat.
 */
export const FIREWALL_SPAWN_WINDOW_MS = 20_000
/** Survivors caught by the end-of-wave purge pay this fraction of their bounty. */
export const FIREWALL_PURGE_BOUNTY = 0.25
/** A boss walks in on every wave that is a multiple of this. */
export const FIREWALL_BOSS_EVERY = 5

export type FirewallEnemyId = 'crawler' | 'grunt' | 'sapper' | 'drone' | 'brute' | 'spitter' | 'titan'

/** How an enemy behaves once it reaches its stopping distance from the wall. */
export type FirewallEnemyKind =
    /** Walks to the wall and hits it on a timer. */
    | 'walker'
    /** Same, but airborne — spikes on the ground never touch it. */
    | 'flyer'
    /** Halts at `range` and lobs projectiles instead of closing. */
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
    /** Ranged only: how far from the wall it sets up. */
    range?: number
    /** Flyer only: cruise altitude above its ground lane. */
    altitude?: number
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
        weight: 34
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
        weight: 40
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
        weight: 20
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
        weight: 18
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
        range: 430
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
        boss: true
    }
] as const

const ENEMY_BY_ID = new Map(FIREWALL_ENEMIES.map(def => [def.id, def]))

export function firewallEnemy(id: FirewallEnemyId): FirewallEnemyDefinition {
    const def = ENEMY_BY_ID.get(id)
    if (!def) throw new Error(`Unknown firewall enemy: ${id}`)
    return def
}

// ─── Wave scaling ───────────────────────────────────────────────────────────

/**
 * Enemy health compounds while your damage is bought in flat steps, which is
 * what forces the shop to stay interesting: a build that ignores damage stops
 * killing things somewhere around wave twelve.
 */
export function firewallHpMultiplier(wave: number) {
    return Math.pow(1.135, Math.max(0, wave - 1))
}

/** Bounty grows far slower than health, so late waves are about efficiency. */
export function firewallBountyMultiplier(wave: number) {
    return 1 + Math.max(0, wave - 1) * 0.05
}

/** Total enemy cost a wave may spend. */
export function firewallWaveBudget(wave: number) {
    return Math.round(24 + (wave - 1) * 15 + Math.pow(wave, 1.65))
}

/** Paid on surviving a wave, scaled by how much of the wall is left standing. */
export function firewallClearBonus(wave: number, integrity: number) {
    return Math.round((24 + wave * 14) * (0.55 + 0.45 * Math.max(0, Math.min(1, integrity))))
}

export function firewallIsBossWave(wave: number) {
    return wave % FIREWALL_BOSS_EVERY === 0
}

/** Types that may be rolled on this wave, bosses excluded — they are scripted. */
export function firewallWavePool(wave: number) {
    return FIREWALL_ENEMIES.filter(def => !def.boss && def.fromWave <= wave)
}

// ─── Upgrades ───────────────────────────────────────────────────────────────

export type FirewallUpgradeId =
    | 'damage' | 'firerate' | 'magazine' | 'reload' | 'pierce' | 'crit'
    | 'integrity' | 'repair' | 'shield' | 'spikes'
    | 'sentry' | 'sentryPower' | 'bounty' | 'pulse'

export type FirewallUpgradeGroup = 'weapon' | 'defense' | 'support'

export interface FirewallUpgradeDefinition {
    id: FirewallUpgradeId
    name: string
    blurb: string
    icon: string
    group: FirewallUpgradeGroup
    max: number
    baseCost: number
    /** Cost multiplier per level already owned. */
    growth: number
    /** What the stat reads as at a given level, for the shop rows. */
    value: (level: number) => string
}

export const FIREWALL_UPGRADES: readonly FirewallUpgradeDefinition[] = [
    {
        id: 'damage',
        name: 'Amplifier',
        blurb: 'More damage per packet fired.',
        icon: 'i-lucide-zap',
        group: 'weapon',
        max: 12,
        baseCost: 60,
        growth: 1.34,
        value: level => `${(11 + level * 6).toFixed(0)} dmg`
    },
    {
        id: 'firerate',
        name: 'Clock Speed',
        blurb: 'Shortens the gap between shots.',
        icon: 'i-lucide-gauge',
        group: 'weapon',
        max: 10,
        baseCost: 70,
        growth: 1.38,
        value: level => `${(1000 / (330 * Math.pow(0.895, level))).toFixed(1)} shots/s`
    },
    {
        id: 'magazine',
        name: 'Buffer',
        blurb: 'Holds more packets before a flush.',
        icon: 'i-lucide-layers',
        group: 'weapon',
        max: 9,
        baseCost: 50,
        growth: 1.3,
        value: level => `${10 + level * 4} rounds`
    },
    {
        id: 'reload',
        name: 'Flush Rate',
        blurb: 'Reloads the buffer faster.',
        icon: 'i-lucide-refresh-cw',
        group: 'weapon',
        max: 8,
        baseCost: 55,
        growth: 1.32,
        value: level => `${(1500 * Math.pow(0.875, level) / 1000).toFixed(2)}s reload`
    },
    {
        id: 'pierce',
        name: 'Lance',
        blurb: 'Packets punch through extra targets.',
        icon: 'i-lucide-move-right',
        group: 'weapon',
        max: 4,
        baseCost: 220,
        growth: 1.85,
        value: level => level === 0 ? 'no pierce' : `pierces ${level}`
    },
    {
        id: 'crit',
        name: 'Exploit',
        blurb: 'Chance to land a critical packet.',
        icon: 'i-lucide-crosshair',
        group: 'weapon',
        max: 8,
        baseCost: 90,
        growth: 1.4,
        value: level => `${Math.round((0.04 + level * 0.045) * 100)}% · ${(2 + level * 0.15).toFixed(2)}x`
    },
    {
        id: 'integrity',
        name: 'Integrity',
        blurb: 'Raises maximum wall health — and repairs the difference.',
        icon: 'i-lucide-brick-wall',
        group: 'defense',
        max: 12,
        baseCost: 65,
        growth: 1.33,
        value: level => `${900 + level * 320} HP`
    },
    {
        id: 'repair',
        name: 'Patch Daemon',
        blurb: 'Rebuilds the wall continuously.',
        icon: 'i-lucide-wrench',
        group: 'defense',
        max: 10,
        baseCost: 80,
        growth: 1.36,
        value: level => `${(level * 5.5).toFixed(1)} HP/s`
    },
    {
        id: 'shield',
        name: 'Barrier',
        blurb: 'An overshield that soaks hits and recharges out of combat.',
        icon: 'i-lucide-shield',
        group: 'defense',
        max: 8,
        baseCost: 110,
        growth: 1.42,
        value: level => level === 0 ? 'offline' : `${level * 60} · ${(8 + level * 3).toFixed(0)}/s`
    },
    {
        id: 'spikes',
        name: 'Grid Trap',
        blurb: 'Electrified floor in front of the wall. Ground units only.',
        icon: 'i-lucide-grid-2x2',
        group: 'defense',
        max: 8,
        baseCost: 130,
        growth: 1.44,
        value: level => level === 0 ? 'offline' : `${level * 26} dmg/s`
    },
    {
        id: 'sentry',
        name: 'Sentry Node',
        blurb: 'A turret on the parapet that picks its own targets.',
        icon: 'i-lucide-cpu',
        group: 'support',
        max: 6,
        baseCost: 150,
        growth: 1.6,
        value: level => `${level} deployed`
    },
    {
        id: 'sentryPower',
        name: 'Node Firmware',
        blurb: 'Every sentry hits harder and cycles faster.',
        icon: 'i-lucide-microchip',
        group: 'support',
        max: 8,
        baseCost: 120,
        growth: 1.4,
        value: level => `${(7 + level * 4).toFixed(0)} dmg · ${(1000 / (950 * Math.pow(0.925, level))).toFixed(1)}/s`
    },
    {
        id: 'bounty',
        name: 'Skimmer',
        blurb: 'Siphons extra credits from every kill.',
        icon: 'i-lucide-coins',
        group: 'support',
        max: 8,
        baseCost: 140,
        growth: 1.45,
        value: level => `+${Math.round(level * 12)}% credits`
    },
    {
        id: 'pulse',
        name: 'ICE Pulse',
        blurb: 'SPACE — a shockwave that fries and shoves back everything on the field.',
        icon: 'i-lucide-radio',
        group: 'support',
        max: 6,
        baseCost: 180,
        growth: 1.5,
        value: level => level === 0
            ? 'locked'
            : `${60 + level * 55} dmg · ${(26 * Math.pow(0.86, level - 1)).toFixed(0)}s`
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
    return Math.max(10, Math.round(missingHp * 0.32 / 5) * 5)
}

// ─── Loadout ────────────────────────────────────────────────────────────────

/** Everything the engine needs to run a wave. Derived, never stored. */
export interface FirewallLoadout {
    damage: number
    fireIntervalMs: number
    magazine: number
    reloadMs: number
    pierce: number
    critChance: number
    critMultiplier: number
    bountyMultiplier: number
    wallMaxHp: number
    repairPerSec: number
    shieldMax: number
    shieldRegenPerSec: number
    spikeDps: number
    sentryCount: number
    sentryDamage: number
    sentryIntervalMs: number
    pulseDamage: number
    pulseCooldownMs: number
    pulseUnlocked: boolean
}

export function firewallLoadout(levels: FirewallUpgradeLevels): FirewallLoadout {
    const pulse = levels.pulse
    return {
        damage: 11 + levels.damage * 6,
        fireIntervalMs: 330 * Math.pow(0.895, levels.firerate),
        magazine: 10 + levels.magazine * 4,
        reloadMs: 1500 * Math.pow(0.875, levels.reload),
        pierce: levels.pierce,
        critChance: 0.04 + levels.crit * 0.045,
        critMultiplier: 2 + levels.crit * 0.15,
        bountyMultiplier: 1 + levels.bounty * 0.12,
        wallMaxHp: 900 + levels.integrity * 320,
        repairPerSec: levels.repair * 5.5,
        shieldMax: levels.shield * 60,
        shieldRegenPerSec: levels.shield > 0 ? 8 + levels.shield * 3 : 0,
        spikeDps: levels.spikes * 26,
        sentryCount: levels.sentry,
        sentryDamage: 7 + levels.sentryPower * 4,
        sentryIntervalMs: 950 * Math.pow(0.925, levels.sentryPower),
        pulseDamage: pulse > 0 ? 60 + pulse * 55 : 0,
        pulseCooldownMs: 26_000 * Math.pow(0.86, Math.max(0, pulse - 1)),
        pulseUnlocked: pulse > 0
    }
}

/** Seconds without taking a hit before the barrier starts coming back. */
export const FIREWALL_SHIELD_DELAY_MS = 3000
