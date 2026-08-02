/**
 * FIREWALL — a lane-defence game in the Storm the House mould.
 *
 * You hold a data core against waves of intrusion daemons that walk in from the
 * left. Every wave is a fixed span of seconds; when the clock runs out the wall
 * purges whatever is still standing and the uplink opens so you can spend the
 * wave's credits before deploying the next one.
 *
 * Two economies run at once and they are deliberately not the same currency:
 *
 * - **Credits** are earned and spent inside a single run. They buy the wall, the
 *   turrets and the guns, and they die with the run.
 * - **Coins** are the site currency. Enemies drop them, they bank at the end of
 *   a wave, and they are settled to the account when the run ends. They buy
 *   Mainframe levels, which are permanent and raise the *base* the next run
 *   starts from — never the ceiling of what a run can reach on its own.
 *
 * Everything in this file is balance data and derivation — no rendering, no
 * state. The engine reads a `FirewallLoadout` and never sees an upgrade level;
 * the shop reads the definitions and never sees a stat. That split is what lets
 * the numbers be tuned here without touching either side.
 */

// ─── Run shape ──────────────────────────────────────────────────────────────

/** One wave, and the uplink is open on either side of it. */
export const FIREWALL_WAVE_MS = 45_000
/**
 * Spawning stops before the wave does, so the last thing released still has
 * time to reach the wall. Without the tail, late spawns are free credits — they
 * get purged halfway across the field having never been a threat.
 */
export const FIREWALL_SPAWN_WINDOW_MS = 38_000
/** Survivors caught by the end-of-wave purge pay this fraction of their bounty. */
export const FIREWALL_PURGE_BOUNTY = 0.25
/** A boss walks in on every wave that is a multiple of this. */
export const FIREWALL_BOSS_EVERY = 5
/** Every second boss is the armoured one. */
export const FIREWALL_HEAVY_BOSS_EVERY = 10
/**
 * Clearing this wave ends the run as a win.
 *
 * A defence game with no last wave is a defence game whose payout is decided by
 * how long someone is willing to sit there, and this one pays site currency.
 * The whole balance below is fitted so that a fully-invested account on Zero Day
 * dies — or wins — somewhere in the low-to-mid twenties.
 */
export const FIREWALL_MAX_WAVE = 30

// ─── Difficulty ─────────────────────────────────────────────────────────────

export const FIREWALL_DIFFICULTY_IDS = ['probe', 'breach', 'siege', 'blackout', 'zeroday'] as const
export type FirewallDifficultyId = typeof FIREWALL_DIFFICULTY_IDS[number]

export interface FirewallDifficulty {
    id: FirewallDifficultyId
    name: string
    tagline: string
    /** Multiplies enemy health. */
    enemyHp: number
    /** Multiplies damage dealt to the wall. */
    enemyDamage: number
    /** Multiplies the per-wave spend budget — more bodies, not tougher ones. */
    budget: number
    /** Multiplies coin drops. This is the entire reason to climb. */
    reward: number
    /**
     * Best wave the account has to have reached before this is selectable. The
     * gate is what stops a fresh account from farming wave three on Zero Day,
     * where the reward multiplier is worth more than a finished Breach run.
     */
    requiredBestWave: number
    color: string
}

export const FIREWALL_DIFFICULTIES: readonly FirewallDifficulty[] = [
    {
        id: 'probe',
        name: 'Probe',
        tagline: 'Learn the field. Pays accordingly.',
        enemyHp: 0.68,
        enemyDamage: 0.7,
        // Probe is easy because the bodies are soft and hit for less, not because
        // there are fewer of them — a near-empty field teaches nothing about the
        // game the other four difficulties are playing.
        budget: 1.2,
        reward: 0.2,
        requiredBestWave: 0,
        color: '#22d3ee'
    },
    {
        id: 'breach',
        name: 'Breach',
        tagline: 'The intended first run.',
        enemyHp: 1,
        enemyDamage: 1,
        budget: 1.15,
        reward: 0.6,
        requiredBestWave: 0,
        color: '#a3e635'
    },
    {
        id: 'siege',
        name: 'Siege',
        tagline: 'Plating everywhere. Bring the right gun.',
        enemyHp: 1.9,
        enemyDamage: 1.35,
        budget: 1.3,
        reward: 2.4,
        requiredBestWave: 10,
        color: '#fbbf24'
    },
    {
        id: 'blackout',
        name: 'Blackout',
        tagline: 'The wall stops being enough on its own.',
        enemyHp: 3.4,
        enemyDamage: 1.9,
        budget: 1.45,
        reward: 9,
        requiredBestWave: 15,
        color: '#fb7185'
    },
    {
        id: 'zeroday',
        name: 'Zero Day',
        tagline: 'Everything you own, and it is close.',
        enemyHp: 6,
        enemyDamage: 2.5,
        budget: 1.65,
        reward: 34,
        requiredBestWave: 20,
        color: '#e879f9'
    }
] as const

export function firewallDifficulty(id: unknown): FirewallDifficulty {
    return FIREWALL_DIFFICULTIES.find(difficulty => difficulty.id === id) ?? FIREWALL_DIFFICULTIES[1]!
}

export function firewallDifficultyUnlocked(difficulty: FirewallDifficulty, bestWave: number) {
    return bestWave >= difficulty.requiredBestWave
}

// ─── Damage types ───────────────────────────────────────────────────────────

/**
 * Every source of damage is one of two types, and every enemy prefers to be hit
 * by one of them.
 *
 * There is deliberately **no penalty** for bringing the wrong type — a miss-match
 * deals full damage. Armour used to eat 78% of a non-piercing round, which meant
 * one wrong purchase turned a run into a wall of grey numbers with no way back.
 * The bonus-only version keeps the decision (bring kinetic to a Siege Tank) while
 * leaving every weapon playable against everything.
 */
export type FirewallDamageType = 'kinetic' | 'energy'

/** Damage multiplier when a source hits the type it was built for. */
export const FIREWALL_TYPE_BONUS = 0.25

/** Kinetic chews plating; energy shreds unarmoured targets. */
export function firewallPreferredType(armored: boolean): FirewallDamageType {
    return armored ? 'kinetic' : 'energy'
}

export function firewallTypeMultiplier(damageType: FirewallDamageType, armored: boolean) {
    return damageType === firewallPreferredType(armored) ? 1 + FIREWALL_TYPE_BONUS : 1
}

/** Packed RGB for damage numbers and tracers, so the two types read apart at a glance. */
export const FIREWALL_TYPE_HEX: Record<FirewallDamageType, number> = {
    kinetic: 0xfbbf24,
    energy: 0x67e8f9
}

export const FIREWALL_TYPE_LABEL: Record<FirewallDamageType, string> = {
    kinetic: 'kinetic',
    energy: 'energy'
}

// ─── Enemies ────────────────────────────────────────────────────────────────

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
     * Plated. Takes 25% extra from kinetic sources and nothing less from
     * anything else — the health numbers below already carry the durability that
     * the old flat armour reduction used to fake.
     */
    armored: boolean
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
        hp: 26,
        speed: 124,
        damage: 3,
        attackMs: 620,
        bounty: 7,
        cost: 3,
        height: 34,
        hex: 0x4ade80,
        fromWave: 1,
        weight: 34,
        armored: false
    },
    {
        id: 'grunt',
        name: 'Daemon',
        kind: 'walker',
        hp: 66,
        speed: 58,
        damage: 8,
        attackMs: 900,
        bounty: 12,
        cost: 5,
        height: 52,
        hex: 0x67e8f9,
        fromWave: 1,
        weight: 40,
        armored: false
    },
    {
        id: 'sapper',
        name: 'Sapper',
        kind: 'bomber',
        hp: 48,
        speed: 158,
        damage: 58,
        attackMs: 1,
        bounty: 20,
        cost: 8,
        height: 42,
        hex: 0xf87171,
        fromWave: 3,
        weight: 20,
        armored: false
    },
    {
        id: 'drone',
        name: 'Wisp',
        kind: 'flyer',
        hp: 50,
        speed: 104,
        damage: 7,
        attackMs: 700,
        bounty: 17,
        cost: 7,
        height: 26,
        hex: 0x93c5fd,
        fromWave: 4,
        weight: 22,
        armored: false,
        altitude: 150
    },
    {
        id: 'brute',
        name: 'Bulwark',
        kind: 'walker',
        hp: 430,
        speed: 33,
        damage: 26,
        attackMs: 1250,
        bounty: 46,
        cost: 16,
        height: 82,
        hex: 0xfbbf24,
        fromWave: 5,
        weight: 18,
        armored: true
    },
    {
        id: 'spitter',
        name: 'Lancer',
        kind: 'ranged',
        hp: 84,
        speed: 46,
        damage: 11,
        attackMs: 1700,
        bounty: 26,
        cost: 11,
        height: 56,
        hex: 0xc084fc,
        fromWave: 6,
        weight: 20,
        armored: false,
        range: 430
    },
    {
        id: 'warden',
        name: 'Warden',
        kind: 'walker',
        hp: 520,
        speed: 44,
        damage: 18,
        attackMs: 1000,
        bounty: 54,
        cost: 15,
        height: 66,
        hex: 0xa3a3a3,
        fromWave: 8,
        weight: 22,
        armored: true
    },
    {
        id: 'tank',
        name: 'Siege Tank',
        kind: 'walker',
        hp: 2400,
        speed: 26,
        damage: 52,
        attackMs: 1400,
        bounty: 150,
        cost: 34,
        height: 76,
        hex: 0xfb923c,
        fromWave: 10,
        weight: 16,
        armored: true
    },
    {
        id: 'artillery',
        name: 'Howitzer',
        kind: 'ranged',
        hp: 760,
        speed: 30,
        damage: 46,
        attackMs: 3200,
        bounty: 118,
        cost: 26,
        height: 62,
        hex: 0xf472b6,
        fromWave: 12,
        weight: 15,
        armored: true,
        // Sets up beyond every turret's reach but its own, which is what makes
        // it the thing you drop everything to kill.
        range: 820,
        burst: 2
    },
    {
        id: 'gunship',
        name: 'Gunship',
        kind: 'ranged',
        hp: 580,
        speed: 74,
        damage: 15,
        attackMs: 1500,
        bounty: 96,
        cost: 22,
        height: 40,
        hex: 0x38bdf8,
        fromWave: 14,
        weight: 16,
        armored: true,
        range: 520,
        altitude: 190,
        burst: 3
    },
    {
        id: 'titan',
        name: 'ROOTKIT',
        kind: 'walker',
        hp: 2200,
        speed: 27,
        damage: 70,
        attackMs: 1500,
        bounty: 340,
        cost: 0,
        height: 140,
        hex: 0xfb7185,
        fromWave: FIREWALL_BOSS_EVERY,
        weight: 0,
        armored: false,
        boss: true
    },
    {
        id: 'leviathan',
        name: 'BLACK ICE',
        kind: 'walker',
        hp: 9000,
        speed: 22,
        damage: 110,
        attackMs: 1600,
        bounty: 950,
        cost: 0,
        height: 176,
        hex: 0xa78bfa,
        fromWave: FIREWALL_HEAVY_BOSS_EVERY,
        weight: 0,
        armored: true,
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
    return Math.pow(1.117, Math.max(0, wave - 1))
}

/** Wall damage per hit creeps up so late leaks are punished harder than early ones. */
export function firewallDamageMultiplier(wave: number) {
    return 1 + Math.max(0, wave - 1) * 0.05
}

/** Bounty grows far slower than health, so late waves are about efficiency. */
export function firewallBountyMultiplier(wave: number) {
    return 1 + Math.max(0, wave - 1) * 0.055
}

/**
 * Total enemy cost a wave may spend.
 *
 * The flat term is doing more work than it looks like it should. A wave is 45
 * seconds and the spawn window is 38 of them, so the opening waves were handing
 * out one body every three seconds — technically a wave, but nothing to shoot
 * at for most of it. The floor is what stops the first few waves reading as dead
 * air; the linear term is the actual ramp, and the exponent is the late-wave
 * tail that the health multiplier is already fighting you on.
 */
export function firewallWaveBudget(wave: number, difficulty: FirewallDifficulty) {
    const base = 72 + (wave - 1) * 30 + Math.pow(wave, 1.7)
    return Math.max(1, Math.round(base * difficulty.budget))
}

/** Paid on surviving a wave, scaled by how much of the wall is left standing. */
export function firewallClearBonus(wave: number, integrity: number) {
    return Math.round((60 + wave * 34) * (0.55 + 0.45 * Math.max(0, Math.min(1, integrity))))
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
    /**
     * Wave the uplink will sell it on. Weapons are the run's progression track:
     * every one of these is a straight upgrade on the last, so the gate is what
     * stops a good wave one from buying the end of the game.
     */
    unlockWave: number
    /** Two or three words. The stat block says the rest. */
    tag: string
    damage: number
    fireIntervalMs: number
    magazine: number
    reloadMs: number
    projectile: FirewallProjectile
    speed: number
    damageType: FirewallDamageType
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
        unlockWave: 1,
        tag: 'all-rounder',
        damage: 12,
        fireIntervalMs: 320,
        magazine: 10,
        reloadMs: 1400,
        projectile: 'rail',
        speed: 2600,
        damageType: 'energy',
        pierce: 0,
        hex: 0x22d3ee
    },
    {
        id: 'flak',
        name: 'Fragmenter',
        icon: 'i-lucide-shell',
        cost: 650,
        unlockWave: 3,
        tag: 'crowds',
        damage: 7,
        fireIntervalMs: 600,
        magazine: 8,
        reloadMs: 1600,
        projectile: 'pellet',
        speed: 1600,
        damageType: 'energy',
        pierce: 0,
        pellets: 5,
        spread: 0.17,
        hex: 0xa3e635
    },
    {
        id: 'arc',
        name: 'Tesla Coil',
        icon: 'i-lucide-git-fork',
        cost: 1200,
        unlockWave: 6,
        tag: 'chains',
        damage: 14,
        fireIntervalMs: 400,
        magazine: 14,
        reloadMs: 1700,
        projectile: 'arc',
        speed: 3200,
        damageType: 'energy',
        pierce: 0,
        chain: 3,
        chainFalloff: 0.6,
        hex: 0x818cf8
    },
    {
        id: 'missile',
        name: 'Seeker Pod',
        icon: 'i-lucide-rocket',
        cost: 2400,
        unlockWave: 10,
        tag: 'splash',
        damage: 44,
        fireIntervalMs: 850,
        magazine: 5,
        reloadMs: 2000,
        projectile: 'missile',
        speed: 900,
        damageType: 'kinetic',
        pierce: 0,
        splashRadius: 120,
        splashDamage: 26,
        homing: true,
        hex: 0xfb923c
    },
    {
        id: 'sniper',
        name: 'Longbore',
        icon: 'i-lucide-crosshair',
        cost: 4200,
        unlockWave: 14,
        tag: 'pierce',
        damage: 130,
        fireIntervalMs: 1300,
        magazine: 4,
        reloadMs: 2200,
        projectile: 'slug',
        speed: 4400,
        damageType: 'kinetic',
        pierce: 2,
        hex: 0xf0abfc
    }
] as const

export function firewallWeapon(id: FirewallWeaponId): FirewallWeaponDefinition {
    const def = FIREWALL_WEAPONS.find(w => w.id === id)
    if (!def) throw new Error(`Unknown firewall weapon: ${id}`)
    return def
}

/**
 * The wave a weapon becomes purchasable, after Arsenal Licence.
 *
 * Each licence level lifts the gate off one more weapon in catalogue order. It
 * never hands the gun over — the credits are still the wall — so the perk buys
 * *timing*, which is the part of the run a permanent upgrade can move without
 * flattening it.
 */
export function firewallWeaponUnlockWave(def: FirewallWeaponDefinition, arsenalLevel: number) {
    const index = FIREWALL_WEAPONS.findIndex(w => w.id === def.id)
    return index > 0 && arsenalLevel >= index ? 1 : def.unlockWave
}

// ─── Turrets ────────────────────────────────────────────────────────────────

export type FirewallTurretId = 'gun' | 'needler' | 'warhead' | 'lance'

export interface FirewallTurretDefinition {
    id: FirewallTurretId
    name: string
    icon: string
    cost: number
    unlockWave: number
    tag: string
    damage: number
    intervalMs: number
    range: number
    damageType: FirewallDamageType
    pierce: number
    splashRadius?: number
    splashDamage?: number
    hex: number
}

/**
 * Four mounts' worth of choice, priced so the ladder is a real one. The Lance in
 * particular is meant to be a wave you save for rather than a box you tick on
 * the way past: it is most of a wave's income for a single mount.
 */
export const FIREWALL_TURRETS: readonly FirewallTurretDefinition[] = [
    {
        id: 'gun',
        name: 'Sentry',
        icon: 'i-lucide-cpu',
        cost: 220,
        unlockWave: 1,
        tag: 'steady',
        damage: 11,
        intervalMs: 850,
        range: 900,
        damageType: 'energy',
        pierce: 0,
        hex: 0x4ade80
    },
    {
        id: 'needler',
        name: 'Needler',
        icon: 'i-lucide-align-justify',
        cost: 520,
        unlockWave: 4,
        tag: 'fast',
        damage: 5,
        intervalMs: 220,
        range: 720,
        damageType: 'energy',
        pierce: 0,
        hex: 0x67e8f9
    },
    {
        id: 'warhead',
        name: 'Warhead Rack',
        icon: 'i-lucide-rocket',
        cost: 1400,
        unlockWave: 8,
        tag: 'splash',
        damage: 34,
        intervalMs: 1800,
        range: 950,
        damageType: 'kinetic',
        pierce: 0,
        splashRadius: 105,
        splashDamage: 18,
        hex: 0xfb923c
    },
    {
        id: 'lance',
        name: 'Rail Lance',
        icon: 'i-lucide-move-right',
        cost: 3200,
        unlockWave: 13,
        tag: 'pierce · long',
        damage: 78,
        intervalMs: 2000,
        range: 1250,
        damageType: 'kinetic',
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

// ─── In-run upgrades ────────────────────────────────────────────────────────

export type FirewallUpgradeId =
    | 'damage' | 'firerate' | 'autoloader' | 'crit'
    | 'integrity' | 'spire' | 'repair' | 'shield' | 'spikes'
    | 'turretPower'
    | 'pulse' | 'overclock'

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

/**
 * Twelve lines, four of them on the gun.
 *
 * The gun used to have eight, and the result was that no single purchase moved
 * the number you were looking at — magazine, reload and pierce all read as
 * "slightly better" and none of them changed a fight. Magazine and reload are
 * one line now (Autoloader), pierce belongs to the weapons that have it, and the
 * credit-rate line moved out of the run entirely (see the Mainframe below).
 */
export const FIREWALL_UPGRADES: readonly FirewallUpgradeDefinition[] = [
    {
        id: 'damage',
        name: 'Amplifier',
        icon: 'i-lucide-zap',
        tab: 'rail',
        max: 10,
        baseCost: 160,
        growth: 1.48,
        value: level => `×${(1 + level * 0.3).toFixed(2)} dmg`
    },
    {
        id: 'firerate',
        name: 'Clock Speed',
        icon: 'i-lucide-gauge',
        tab: 'rail',
        max: 10,
        baseCost: 180,
        growth: 1.50,
        value: level => `×${(1 / Math.pow(0.93, level)).toFixed(2)} rate`
    },
    {
        id: 'autoloader',
        name: 'Autoloader',
        icon: 'i-lucide-layers',
        tab: 'rail',
        max: 8,
        baseCost: 150,
        growth: 1.44,
        value: level => `×${(1 + level * 0.25).toFixed(2)} mag · ×${Math.pow(0.9, level).toFixed(2)} reload`
    },
    {
        id: 'crit',
        name: 'Exploit',
        icon: 'i-lucide-crosshair',
        tab: 'rail',
        max: 8,
        baseCost: 240,
        growth: 1.54,
        value: level => `${Math.round((0.04 + level * 0.04) * 100)}% · ${(2 + level * 0.15).toFixed(1)}x`
    },
    {
        id: 'integrity',
        name: 'Integrity',
        icon: 'i-lucide-brick-wall',
        tab: 'bastion',
        max: 14,
        baseCost: 150,
        growth: 1.44,
        value: level => `+${level * 380} HP`
    },
    {
        id: 'spire',
        name: 'Spire',
        icon: 'i-lucide-building-2',
        tab: 'bastion',
        max: 6,
        baseCost: 500,
        growth: 1.95,
        value: level => `+${level} mount${level === 1 ? '' : 's'}`
    },
    {
        id: 'repair',
        name: 'Patch Daemon',
        icon: 'i-lucide-wrench',
        tab: 'bastion',
        max: 10,
        baseCost: 180,
        growth: 1.48,
        value: level => `${(level * 8).toFixed(0)} HP/s`
    },
    {
        id: 'shield',
        name: 'Barrier',
        icon: 'i-lucide-shield',
        tab: 'bastion',
        max: 8,
        baseCost: 260,
        growth: 1.55,
        value: level => level === 0 ? 'offline' : `+${level * 90} · ${level * 4}/s`
    },
    {
        id: 'spikes',
        name: 'Grid Trap',
        icon: 'i-lucide-grid-2x2',
        tab: 'bastion',
        max: 8,
        baseCost: 290,
        growth: 1.58,
        value: level => level === 0 ? 'offline' : `${level * 42} dmg/s`
    },
    {
        id: 'turretPower',
        name: 'Firmware',
        icon: 'i-lucide-microchip',
        tab: 'turrets',
        max: 10,
        baseCost: 320,
        growth: 1.55,
        value: level => `×${(1 + level * 0.28).toFixed(2)} dmg · ×${(1 / Math.pow(0.945, level)).toFixed(2)} rate`
    },
    {
        id: 'pulse',
        name: 'ICE Pulse',
        icon: 'i-lucide-radio',
        tab: 'systems',
        max: 6,
        baseCost: 450,
        growth: 1.80,
        value: level => level === 0
            ? 'locked'
            : `${90 + level * 110} dmg · ${(30 * Math.pow(0.86, level - 1)).toFixed(0)}s`
    },
    {
        id: 'overclock',
        name: 'Overclock',
        icon: 'i-lucide-flame',
        tab: 'systems',
        max: 5,
        baseCost: 650,
        growth: 1.95,
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

/** Mounts on a bare wall, before Spire levels or a Rampart Charter. */
export const FIREWALL_BASE_SLOTS = 2
/** The tower has room for this many, and the geometry is authored around it. */
export const FIREWALL_MAX_SLOTS = 8

export function firewallSlots(spireLevel: number, charterLevel = 0) {
    return Math.min(FIREWALL_MAX_SLOTS, FIREWALL_BASE_SLOTS + spireLevel + charterLevel)
}

// ─── Mainframe (permanent, coin-bought) ─────────────────────────────────────

export const FIREWALL_MAINFRAME_IDS = [
    'bulwark', 'munitions', 'foundry', 'grant', 'salvage', 'capacitor', 'charter', 'arsenal'
] as const
export type FirewallMainframeId = typeof FIREWALL_MAINFRAME_IDS[number]

export type FirewallMainframeLevels = Record<FirewallMainframeId, number>

export interface FirewallMainframeDefinition {
    id: FirewallMainframeId
    name: string
    description: string
    icon: string
    color: string
    max: number
    baseCost: number
    growth: number
    /** What one more level is worth, for the shop row. */
    value: (level: number) => string
}

/**
 * The out-of-run shop. Coins buy levels here and levels raise the floor a run
 * starts from — never its ceiling.
 *
 * Every effect below is deliberately a *base* rather than a multiplier on the
 * in-run tree: Munitions is +5% weapon damage, not +5% per Amplifier level. A
 * permanent shop that scales with the in-run one compounds into a build that
 * deletes wave one, and then the only interesting part of the game is the part
 * you already skipped. What these levels are actually for is the difficulty
 * ladder — each rung of Siege → Blackout → Zero Day multiplies coins hard
 * enough that "can I hold this at all" is the real purchase.
 */
export const FIREWALL_MAINFRAME: readonly FirewallMainframeDefinition[] = [
    {
        id: 'bulwark',
        name: 'Reinforced Bulwark',
        description: 'The wall starts every run thicker.',
        icon: 'i-lucide-brick-wall',
        color: 'success',
        max: 12,
        baseCost: 100_000,
        growth: 2.45,
        value: level => `+${level * 6}% wall HP`
    },
    {
        id: 'munitions',
        name: 'Munitions Contract',
        description: 'Every weapon you carry hits harder.',
        icon: 'i-lucide-zap',
        color: 'error',
        max: 12,
        baseCost: 200_000,
        growth: 2.65,
        value: level => `+${level * 5}% weapon damage`
    },
    {
        id: 'foundry',
        name: 'Turret Foundry',
        description: 'Every mounted turret hits harder.',
        icon: 'i-lucide-factory',
        color: 'warning',
        max: 12,
        baseCost: 200_000,
        growth: 2.65,
        value: level => `+${level * 5}% turret damage`
    },
    {
        id: 'grant',
        name: 'Uplink Grant',
        description: 'Deploy with credits already banked.',
        icon: 'i-lucide-banknote',
        color: 'info',
        max: 10,
        baseCost: 100_000,
        growth: 2.45,
        value: level => `+${level * 200} starting credits`
    },
    {
        id: 'salvage',
        name: 'Salvage Rig',
        description: 'Strip more coin off everything you kill.',
        icon: 'i-lucide-coins',
        color: 'secondary',
        max: 13,
        baseCost: 300_000,
        growth: 2.85,
        value: level => `+${level * 8}% coin drops`
    },
    {
        id: 'capacitor',
        name: 'Capacitor Bank',
        description: 'The barrier comes online without buying it first.',
        icon: 'i-lucide-shield',
        color: 'primary',
        max: 10,
        baseCost: 180_000,
        growth: 2.55,
        value: level => `+${level * 45} shield · +${level * 3}/s`
    },
    {
        id: 'charter',
        name: 'Rampart Charter',
        description: 'Extra turret mounts, open from wave one.',
        icon: 'i-lucide-building-2',
        color: 'warning',
        max: 4,
        baseCost: 750_000,
        growth: 6.5,
        value: level => `+${level} starting mount${level === 1 ? '' : 's'}`
    },
    {
        id: 'arsenal',
        name: 'Arsenal Licence',
        description: 'The uplink sells the next gun up from wave one. You still pay for it.',
        icon: 'i-lucide-swords',
        color: 'error',
        max: 4,
        baseCost: 1_000_000,
        growth: 7.5,
        value: (level) => {
            const unlocked = FIREWALL_WEAPONS.slice(1, level + 1).map(w => w.name)
            return unlocked.length ? unlocked.join(', ') : 'nothing yet'
        }
    }
] as const

export function firewallMainframe(id: FirewallMainframeId): FirewallMainframeDefinition {
    const def = FIREWALL_MAINFRAME.find(m => m.id === id)
    if (!def) throw new Error(`Unknown firewall mainframe upgrade: ${id}`)
    return def
}

export function firewallEmptyMainframe(): FirewallMainframeLevels {
    return Object.fromEntries(FIREWALL_MAINFRAME_IDS.map(id => [id, 0])) as FirewallMainframeLevels
}

/**
 * Coin cost of the next level, or `null` when maxed. Rounded to three
 * significant figures so a price tag reads as a price tag and not as a hash.
 */
export function firewallMainframeCost(def: FirewallMainframeDefinition, level: number): number | null {
    if (level >= def.max) return null
    const raw = def.baseCost * Math.pow(def.growth, level)
    const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 2))
    return Math.round(raw / magnitude) * magnitude
}

export interface FirewallMainframeEffects {
    /** Multiplier on the wall's maximum health. */
    wallHp: number
    /** Multiplier on player weapon damage. */
    weaponDamage: number
    /** Multiplier on turret damage. */
    turretDamage: number
    /** Credits in hand when a run is deployed. */
    startingCredits: number
    /** Multiplier on every coin drop. */
    coins: number
    /** Shield capacity and regen granted before any in-run Barrier level. */
    shieldBase: number
    shieldRegenBase: number
    /** Turret mounts open from wave one, on top of the base two. */
    startingMounts: number
    /** How many weapons past the rail ignore their wave gate. */
    arsenal: number
}

export function firewallMainframeEffects(levels: FirewallMainframeLevels): FirewallMainframeEffects {
    return {
        wallHp: 1 + levels.bulwark * 0.06,
        weaponDamage: 1 + levels.munitions * 0.05,
        turretDamage: 1 + levels.foundry * 0.05,
        startingCredits: FIREWALL_BASE_CREDITS + levels.grant * 200,
        coins: 1 + levels.salvage * 0.08,
        shieldBase: levels.capacitor * 45,
        shieldRegenBase: levels.capacitor * 3,
        startingMounts: levels.charter,
        arsenal: levels.arsenal
    }
}

/** Credits a run is deployed with before any Uplink Grant. */
export const FIREWALL_BASE_CREDITS = 250

/** A rough single number for "how invested is this account", for the HUD and run snapshots. */
export function firewallPower(levels: FirewallMainframeLevels) {
    return FIREWALL_MAINFRAME.reduce((sum, def) => sum + levels[def.id] * (def.max <= 4 ? 12 : 5), 10)
}

// ─── Coins ──────────────────────────────────────────────────────────────────

/**
 * Converts an enemy's in-run bounty into site coins.
 *
 * The wave exponent is the part doing the work. Bounty and wave budget both grow
 * roughly linearly, so without it every wave pays about the same and the correct
 * play on a high difficulty is to farm wave three forever. Making a wave's coin
 * value superlinear in the wave number means depth is the only thing that pays,
 * which is also the thing the difficulty gate is protecting.
 */
export const FIREWALL_COIN_SCALE = 2.3

export function firewallCoinValue(
    bounty: number,
    wave: number,
    difficulty: FirewallDifficulty,
    coinMultiplier: number
) {
    return Math.max(1, Math.round(
        bounty
        * FIREWALL_COIN_SCALE
        * difficulty.reward
        * Math.max(0, coinMultiplier)
        * Math.pow(Math.max(1, wave), 1.35)
    ))
}

/**
 * Server-side ceiling on what a settled run may pay, derived from the deepest
 * wave it actually reached. Tuned so honest play brushes it only on an
 * exceptional run — it exists to bound a forged `coins` field, not to tax a
 * good one.
 */
export function firewallMaxPayout(wave: number, difficulty: FirewallDifficulty, coinMultiplier: number) {
    const depth = Math.max(0, Math.min(wave, FIREWALL_MAX_WAVE))
    // Closed-ish form of "every wave up to here paid its whole budget in bounty",
    // with generous headroom on top of the coin curve above.
    let ceiling = 0
    for (let w = 1; w <= depth; w++) {
        const budget = firewallWaveBudget(w, difficulty)
        // ~3.4 bounty per budget point is the richest the enemy table gets.
        const waveBounty = budget * 3.4 * firewallBountyMultiplier(w)
        ceiling += firewallCoinValue(waveBounty, w, difficulty, coinMultiplier)
    }
    // Doubled on top of that. The balance model assumes a player lands 68% of
    // their theoretical damage; a genuinely good one lands more and kills more of
    // the wave before the purge takes it at a quarter rate, and none of that
    // should meet a cap.
    return Math.floor(ceiling * 2)
}

export function firewallPayoutForRun(
    coins: number,
    wave: number,
    difficulty: FirewallDifficulty,
    coinMultiplier: number
) {
    const banked = Math.max(0, Math.floor(Number.isFinite(coins) ? coins : 0))
    return Math.min(banked, firewallMaxPayout(wave, difficulty, coinMultiplier))
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
    damageType: FirewallDamageType
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
    damageType: FirewallDamageType
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
    /** Spire level, which is what the tower geometry is built from. */
    spire: number
    critChance: number
    critMultiplier: number
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
    /** Multiplier applied to every coin drop, from Salvage Rig. */
    coinMultiplier: number
    difficulty: FirewallDifficulty
}

export interface FirewallArmoury {
    levels: FirewallUpgradeLevels
    /** Weapon ids the player has bought. `rail` is always present. */
    owned: FirewallWeaponId[]
    active: FirewallWeaponId
    /** One entry per mount; `null` is an empty mount. */
    turrets: (FirewallTurretId | null)[]
}

export function firewallEmptyArmoury(mainframe: FirewallMainframeLevels = firewallEmptyMainframe()): FirewallArmoury {
    return {
        levels: firewallEmptyLevels(),
        owned: ['rail'],
        active: 'rail',
        turrets: Array.from({ length: firewallSlots(0, mainframe.charter) }, () => null)
    }
}

/** Base wall health before Integrity levels or a Reinforced Bulwark. */
export const FIREWALL_BASE_WALL_HP = 1000

export function firewallWeaponRuntime(
    id: FirewallWeaponId,
    levels: FirewallUpgradeLevels,
    effects: FirewallMainframeEffects
): FirewallWeaponRuntime {
    const def = firewallWeapon(id)
    // Upgrades are multipliers rather than flat adds so that every weapon scales
    // at the same rate — a flat +6 would quietly make the fastest weapon the
    // only correct choice.
    const damageScale = (1 + levels.damage * 0.3) * effects.weaponDamage
    return {
        id: def.id,
        name: def.name,
        damage: def.damage * damageScale,
        fireIntervalMs: def.fireIntervalMs * Math.pow(0.93, levels.firerate),
        magazine: Math.max(1, Math.round(def.magazine * (1 + levels.autoloader * 0.25))),
        reloadMs: def.reloadMs * Math.pow(0.9, levels.autoloader),
        pierce: def.pierce,
        projectile: def.projectile,
        speed: def.speed,
        damageType: def.damageType,
        pellets: def.pellets ?? 1,
        spread: def.spread ?? 0,
        splashRadius: def.splashRadius ?? 0,
        splashDamage: (def.splashDamage ?? 0) * damageScale,
        homing: def.homing ?? false,
        chain: def.chain ?? 0,
        chainFalloff: def.chainFalloff ?? 0,
        hex: def.hex
    }
}

export function firewallLoadout(
    armoury: FirewallArmoury,
    mainframe: FirewallMainframeLevels,
    difficultyId: FirewallDifficultyId
): FirewallLoadout {
    const levels = armoury.levels
    const effects = firewallMainframeEffects(mainframe)
    const pulse = levels.pulse
    const overclock = levels.overclock
    const turretScale = (1 + levels.turretPower * 0.28) * effects.turretDamage

    const turrets: FirewallTurretRuntime[] = []
    armoury.turrets.forEach((id, slot) => {
        if (!id) return
        const def = firewallTurret(id)
        turrets.push({
            id: def.id,
            slot,
            name: def.name,
            damage: def.damage * turretScale,
            intervalMs: def.intervalMs * Math.pow(0.945, levels.turretPower),
            range: def.range,
            damageType: def.damageType,
            pierce: def.pierce,
            splashRadius: def.splashRadius ?? 0,
            splashDamage: (def.splashDamage ?? 0) * turretScale,
            hex: def.hex
        })
    })

    const shieldMax = effects.shieldBase + levels.shield * 90
    return {
        weapon: firewallWeaponRuntime(armoury.active, levels, effects),
        turrets,
        slots: firewallSlots(levels.spire, effects.startingMounts),
        spire: levels.spire,
        critChance: 0.04 + levels.crit * 0.04,
        critMultiplier: 2 + levels.crit * 0.15,
        wallMaxHp: Math.round((FIREWALL_BASE_WALL_HP + levels.integrity * 380) * effects.wallHp),
        repairPerSec: levels.repair * 8,
        shieldMax,
        shieldRegenPerSec: shieldMax > 0 ? effects.shieldRegenBase + 8 + levels.shield * 4 : 0,
        spikeDps: levels.spikes * 42,
        pulseDamage: pulse > 0 ? 90 + pulse * 110 : 0,
        pulseCooldownMs: 30_000 * Math.pow(0.86, Math.max(0, pulse - 1)),
        pulseUnlocked: pulse > 0,
        overclockMs: overclock > 0 ? (3 + overclock) * 1000 : 0,
        overclockMultiplier: 1.6 + overclock * 0.25,
        overclockUnlocked: overclock > 0,
        overclockCooldownMs: 24_000,
        coinMultiplier: effects.coins,
        difficulty: firewallDifficulty(difficultyId)
    }
}

/** Seconds without taking a hit before the barrier starts coming back. */
export const FIREWALL_SHIELD_DELAY_MS = 3000

// ─── Saved runs ─────────────────────────────────────────────────────────────

/**
 * Bumped whenever the shape below, or any balance number a save depends on,
 * changes enough that a stored run would resume into a different game. A save
 * from an older version is dropped rather than migrated.
 */
export const FIREWALL_SAVE_VERSION = 1

/**
 * A run frozen between waves.
 *
 * Only ever written during the uplink — mid-wave state (enemies, bullets, the
 * clock) is deliberately not persisted, because a wave is 45 seconds and the
 * complexity of restoring one mid-flight buys nothing.
 */
export interface FirewallRunSave {
    version: number
    difficulty: FirewallDifficultyId
    /** The wave that was just cleared. The next deploy is this plus one. */
    wave: number
    credits: number
    /** Coins banked so far, settled when the run finishes. */
    coins: number
    kills: number
    wallHp: number
    armoury: FirewallArmoury
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Validates a save posted by a client. Everything here is a bound rather than a
 * business rule: the endpoint that stores it re-checks the parts that decide
 * money, and this only guarantees the blob is the shape the game can read back.
 */
export function firewallValidateSave(save: unknown): save is FirewallRunSave {
    if (typeof save !== 'object' || save === null) return false
    const candidate = save as FirewallRunSave
    if (candidate.version !== FIREWALL_SAVE_VERSION) return false
    if (!FIREWALL_DIFFICULTY_IDS.includes(candidate.difficulty)) return false
    if (!isFiniteNumber(candidate.wave) || candidate.wave < 0 || candidate.wave > FIREWALL_MAX_WAVE) return false
    if (!isFiniteNumber(candidate.credits) || candidate.credits < 0 || candidate.credits > 1e12) return false
    if (!isFiniteNumber(candidate.coins) || candidate.coins < 0 || candidate.coins > 1e15) return false
    if (!isFiniteNumber(candidate.kills) || candidate.kills < 0 || candidate.kills > 1e6) return false
    if (!isFiniteNumber(candidate.wallHp) || candidate.wallHp < 0 || candidate.wallHp > 1e9) return false

    const armoury = candidate.armoury
    if (typeof armoury !== 'object' || armoury === null) return false
    if (!Array.isArray(armoury.owned) || armoury.owned.length > FIREWALL_WEAPONS.length) return false
    if (!armoury.owned.every(id => FIREWALL_WEAPONS.some(w => w.id === id))) return false
    if (!FIREWALL_WEAPONS.some(w => w.id === armoury.active)) return false
    if (!Array.isArray(armoury.turrets) || armoury.turrets.length > FIREWALL_MAX_SLOTS) return false
    if (!armoury.turrets.every(id => id === null || FIREWALL_TURRETS.some(t => t.id === id))) return false
    if (typeof armoury.levels !== 'object' || armoury.levels === null) return false
    return FIREWALL_UPGRADES.every((def) => {
        const level = armoury.levels[def.id]
        return isFiniteNumber(level) && level >= 0 && level <= def.max
    })
}

/**
 * The most waves a run could plausibly have played in the wall-clock time since
 * it started. A save that claims more than this has been edited — waves are a
 * fixed length and the uplink between them only adds time.
 */
export function firewallMaxWaveForElapsedMs(elapsedMs: number) {
    return Math.max(0, Math.floor(Math.max(0, elapsedMs) / FIREWALL_WAVE_MS))
}

/** Uplink recharge after a settled run — 2 hours. */
export const FIREWALL_RUN_COOLDOWN_MS = 2 * 60 * 60 * 1000
export const FIREWALL_COOLDOWN_RUSH_MS_PER_GEM = 10 * 60 * 1000

export function firewallRunCooldownRemainingMs(lastRunFinishedAt: Date | null, now: number) {
    if (!lastRunFinishedAt) return 0
    return Math.max(0, lastRunFinishedAt.getTime() + FIREWALL_RUN_COOLDOWN_MS - now)
}

/** One gem clears each started ten-minute block of uplink recharge time. */
export function firewallCooldownRushCost(remainingMs: number) {
    return Math.max(0, Math.ceil(Math.max(0, remainingMs) / FIREWALL_COOLDOWN_RUSH_MS_PER_GEM))
}

