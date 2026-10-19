/**
 * HACKERZ — a lane-defence game in the Storm the House mould.
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
 * state. The engine reads a `HackerzLoadout` and never sees an upgrade level;
 * the shop reads the definitions and never sees a stat. That split is what lets
 * the numbers be tuned here without touching either side.
 */

// ─── Run shape ──────────────────────────────────────────────────────────────

/** One wave, and the uplink is open on either side of it. */
export const HACKERZ_WAVE_MS = 45_000
/**
 * Spawning stops before the wave does, so the last thing released still has
 * time to reach the wall. Without the tail, late spawns are free credits — they
 * get purged halfway across the field having never been a threat.
 */
export const HACKERZ_SPAWN_WINDOW_MS = 38_000
/** Survivors caught by the end-of-wave purge pay this fraction of their bounty. */
export const HACKERZ_PURGE_BOUNTY = 0.25
/** A boss walks in on every wave that is a multiple of this. */
export const HACKERZ_BOSS_EVERY = 5
/** Every second boss is the armoured one. */
export const HACKERZ_HEAVY_BOSS_EVERY = 10
/**
 * Clearing this wave ends the run as a win.
 *
 * A defence game with no last wave is a defence game whose payout is decided by
 * how long someone is willing to sit there, and this one pays site currency.
 * The whole balance below is fitted so that a fully-invested account on Zero Day
 * dies — or wins — somewhere in the low-to-mid twenties.
 */
export const HACKERZ_MAX_WAVE = 30

// ─── Difficulty ─────────────────────────────────────────────────────────────

export const HACKERZ_DIFFICULTY_IDS = ['probe', 'breach', 'siege', 'blackout', 'zeroday'] as const
export type HackerzDifficultyId = typeof HACKERZ_DIFFICULTY_IDS[number]

export interface HackerzDifficulty {
    id: HackerzDifficultyId
    name: string
    tagline: string
    /** Multiplies enemy health. */
    enemyHp: number
    /** Multiplies damage dealt to the wall. */
    enemyDamage: number
    /** Multiplies the per-wave spend budget — more bodies, not tougher ones. */
    budget: number
    /**
     * Multiplies coin drops. This is the entire reason to climb, and the spread
     * across the five rungs is deliberately much wider than the spread in enemy
     * health: Probe pays 0.06 and Zero Day pays 30, so no amount of sitting on
     * an easy rung reaches what one rung up is worth.
     */
    reward: number
    /**
     * Best wave the account has to have reached before this is selectable. The
     * gate is what stops a fresh account from farming wave three on Zero Day,
     * where the reward multiplier is worth more than a finished Breach run.
     */
    requiredBestWave: number
    color: string
}

export const HACKERZ_DIFFICULTIES: readonly HackerzDifficulty[] = [
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
        reward: 0.06,
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
        reward: 0.24,
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
        reward: 1.3,
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
        reward: 6.2,
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
        // Deliberately above the balance report's payout band (it reads WAY
        // OVER for mid investment and up): Zero Day is the jackpot rung, gated
        // behind wave 20, paid at its full rate only from wave 25 on, and a
        // deep run is hard and long. Kept at ×30 by decision on 2026-10-16.
        reward: 30,
        requiredBestWave: 20,
        color: '#e879f9'
    }
] as const

export function hackerzDifficulty(id: unknown): HackerzDifficulty {
    return HACKERZ_DIFFICULTIES.find(difficulty => difficulty.id === id) ?? HACKERZ_DIFFICULTIES[1]!
}

export function hackerzDifficultyUnlocked(difficulty: HackerzDifficulty, bestWave: number) {
    return bestWave >= difficulty.requiredBestWave
}

/**
 * The wave from which a difficulty is fought at full strength. A hard rung's
 * tougher, harder-hitting hostiles phase in over the run instead of arriving
 * at wave one: the run's gear is bought wave by wave, so ×6 health from the
 * first spawn (when the gun is still the starting one) ended every Zero Day
 * run by wave three, however much of the Mainframe was bought. The last
 * stretch is fought at the full multiplier.
 */
export const HACKERZ_DIFFICULTY_FULL_WAVE = 25

/** How far into its difficulty a wave is fought: 0 at wave one, 1 from `HACKERZ_DIFFICULTY_FULL_WAVE` on. */
export function hackerzDifficultyRamp(wave: number) {
    return Math.min(1, Math.max(0, (wave - 1) / (HACKERZ_DIFFICULTY_FULL_WAVE - 1)))
}

/**
 * A difficulty multiplier as it applies at `wave`: one above ×1 rises from
 * Breach strength (×1) at wave one to its full value; one at or below ×1
 * (Probe's soft bodies) applies from the start.
 */
function rampedMultiplier(full: number, wave: number) {
    return full <= 1 ? full : 1 + (full - 1) * hackerzDifficultyRamp(wave)
}

/** The difficulty's enemy health multiplier at `wave` (see `HACKERZ_DIFFICULTY_FULL_WAVE`). */
export function hackerzWaveEnemyHp(difficulty: HackerzDifficulty, wave: number) {
    return rampedMultiplier(difficulty.enemyHp, wave)
}

/**
 * The difficulty's coin multiplier at `wave`: it is paid at the strength it
 * is fought at. A rung that pays more than Breach rises from Breach's rate at
 * wave one to its full rate at `HACKERZ_DIFFICULTY_FULL_WAVE`, so the easy
 * opening waves of a hard rung pay like the easy rung they are.
 */
export function hackerzWaveReward(difficulty: HackerzDifficulty, wave: number) {
    const base = hackerzDifficulty('breach').reward
    if (difficulty.reward <= base) return difficulty.reward
    return base + (difficulty.reward - base) * hackerzDifficultyRamp(wave)
}

/** The difficulty's wall damage multiplier at `wave` (see `HACKERZ_DIFFICULTY_FULL_WAVE`). */
export function hackerzWaveEnemyDamage(difficulty: HackerzDifficulty, wave: number) {
    return rampedMultiplier(difficulty.enemyDamage, wave)
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
export type HackerzDamageType = 'kinetic' | 'energy'

/** Damage multiplier when a source hits the type it was built for. */
export const HACKERZ_TYPE_BONUS = 0.25

/** Kinetic chews plating; energy shreds unarmoured targets. */
export function hackerzPreferredType(armored: boolean): HackerzDamageType {
    return armored ? 'kinetic' : 'energy'
}

export function hackerzTypeMultiplier(damageType: HackerzDamageType, armored: boolean) {
    return damageType === hackerzPreferredType(armored) ? 1 + HACKERZ_TYPE_BONUS : 1
}

/** Packed RGB for damage numbers and tracers, so the two types read apart at a glance. */
export const HACKERZ_TYPE_HEX: Record<HackerzDamageType, number> = {
    kinetic: 0xfbbf24,
    energy: 0x67e8f9
}

// ─── Enemies ────────────────────────────────────────────────────────────────

export type HackerzEnemyId =
    | 'crawler' | 'grunt' | 'sapper' | 'drone' | 'brute' | 'spitter'
    | 'warden' | 'tank' | 'artillery' | 'gunship' | 'phantom'
    | 'titan' | 'leviathan' | 'zeroday'
    | 'spiderling'

/** How an enemy behaves once it reaches its stopping distance from the wall. */
export type HackerzEnemyKind =
    /** Walks to the wall and hits it on a timer. */
    | 'walker'
    /** Same, but airborne — the floor trap never touches it. */
    | 'flyer'
    /** Halts at `range` and shoots instead of closing. */
    | 'ranged'
    /** Detonates on contact for its full damage and dies doing it. */
    | 'bomber'

export interface HackerzEnemyDefinition {
    id: HackerzEnemyId
    name: string
    kind: HackerzEnemyKind
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
    /**
     * Invisible and untouchable until a radar ping reveals it. It drops its
     * cloak to strike the wall, so an unpinged one is never an unanswerable leak.
     */
    cloaked?: boolean
    /**
     * Leaks memory: every hit on the fence also leaves an allocation behind at
     * its foot, which drains this fraction of the hit again every second until
     * it is shot clear or the purge collects it.
     */
    leak?: number
    /**
     * A healer (the Wisp, a packet sniffer): instead of attacking, it flies to
     * the most damaged hostile and restores this much health every heal tick,
     * scaled to that unit's strength. Healers converge, so several on one unit
     * heal it faster. Once nothing but healers is left, they dive the fence and
     * self-destruct like a weak Sapper.
     */
    heal?: number
    /**
     * Carries a shield with this fraction of its own health (the Warden's tower
     * shield). Every hit lands on the shield until it breaks; while it holds,
     * held ground does not bite.
     */
    guard?: number
    /** Never rolled for a wave: only ever spawned by another unit (ROOTKIT's spiderlings). */
    spawnedOnly?: boolean
    /**
     * Latches onto the fence and drains it instead of striking: every drain
     * feeds it, so it drains this fraction harder each time, grows, and heals
     * by what it took.
     */
    drain?: number
}

/**
 * ROOTKIT's brood: how often its forelegs inject a pair of spiderlings, how
 * often a hacked node it has infected hatches one, how close it must pass a
 * hacked node to infect it (field units), and the most spiderlings at once.
 */
export const HACKERZ_SPIDER_INJECT_MS = 5000
export const HACKERZ_SPIDER_HATCH_MS = 4000
export const HACKERZ_SPIDER_INFECT_RADIUS = 120
export const HACKERZ_SPIDER_CAP = 30
/** How big a spiderling may grow on what it drains, and its drain's ceiling, as multiples of where it started. */
export const HACKERZ_SPIDER_MAX_GROWTH = 2.2
export const HACKERZ_SPIDER_MAX_DRAIN = 6

/** How often a healer's beam ticks. */
export const HACKERZ_HEAL_TICK_MS = 200

/** Leaked allocations within this many field units of a pile join it, and a pile holds at most this many. */
export const HACKERZ_LEAK_MERGE = 70
export const HACKERZ_LEAK_MAX = 12

export const HACKERZ_ENEMIES: readonly HackerzEnemyDefinition[] = [
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
        armored: false,
        leak: 0.1
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
        fromWave: 6,
        weight: 22,
        armored: false,
        altitude: 150,
        heal: 1
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
        armored: true,
        guard: 0.5
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
        id: 'phantom',
        name: 'Phantom',
        kind: 'walker',
        hp: 120,
        speed: 72,
        damage: 12,
        attackMs: 900,
        bounty: 34,
        cost: 12,
        height: 54,
        hex: 0xe879f9,
        fromWave: 7,
        weight: 14,
        armored: false,
        cloaked: true
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
        fromWave: HACKERZ_BOSS_EVERY,
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
        fromWave: HACKERZ_HEAVY_BOSS_EVERY,
        weight: 0,
        armored: true,
        boss: true
    },
    {
        // The last wave's boss. Splits into decoys that carry no bounty; only the
        // real one bleeds data. Kept smaller than the other bosses so a field of
        // copies reads as a threat rather than a wall of models.
        id: 'zeroday',
        name: 'ZERO DAY',
        kind: 'walker',
        hp: 10000,
        speed: 22,
        damage: 120,
        attackMs: 1500,
        bounty: 1200,
        cost: 0,
        height: 110,
        hex: 0xa3e635,
        fromWave: HACKERZ_MAX_WAVE,
        weight: 0,
        armored: true,
        boss: true
    },
    {
        id: 'spiderling',
        name: 'Spiderling',
        kind: 'walker',
        hp: 14,
        speed: 150,
        damage: 2,
        attackMs: 600,
        bounty: 2,
        cost: 0,
        height: 18,
        hex: 0xfb7185,
        fromWave: HACKERZ_MAX_WAVE + 1,
        weight: 0,
        armored: false,
        spawnedOnly: true,
        drain: 0.25
    }
] as const

const ENEMY_BY_ID = new Map(HACKERZ_ENEMIES.map(def => [def.id, def]))

export function hackerzEnemy(id: HackerzEnemyId): HackerzEnemyDefinition {
    const def = ENEMY_BY_ID.get(id)
    if (!def) throw new Error(`Unknown hackerz enemy: ${id}`)
    return def
}

/** Airborne units float; the grid trap and ground clutter ignore them. */
export function hackerzIsAirborne(def: HackerzEnemyDefinition) {
    return (def.altitude ?? 0) > 0
}

// ─── Wave scaling ───────────────────────────────────────────────────────────

/**
 * Enemy health compounds while your damage is bought in flat multiplier steps,
 * which is what forces the uplink to stay interesting: a build that ignores
 * damage stops killing things somewhere around wave fifteen.
 */
export function hackerzHpMultiplier(wave: number) {
    return Math.pow(1.117, Math.max(0, wave - 1))
}

/** Wall damage per hit creeps up so late leaks are punished harder than early ones. */
export function hackerzDamageMultiplier(wave: number) {
    return 1 + Math.max(0, wave - 1) * 0.05
}

/** Bounty grows far slower than health, so late waves are about efficiency. */
export function hackerzBountyMultiplier(wave: number) {
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
export function hackerzWaveBudget(wave: number, difficulty: HackerzDifficulty) {
    const base = 72 + (wave - 1) * 30 + Math.pow(wave, 1.7)
    return Math.max(1, Math.round(base * difficulty.budget * hackerzOpening(wave)))
}

/**
 * How hard the opening waves lean in, 0–1. A fresh run starts on the Packet
 * Rail alone, which kills about one wave-one budget per wave with every shot
 * landing; full-strength waves on top of the hackers buried it before the
 * first boss. The run eases in up to that boss and is at full pressure after.
 */
export function hackerzOpening(wave: number) {
    if (wave > HACKERZ_BOSS_EVERY) return 1
    return 0.55 + 0.45 * Math.max(0, wave - 1) / HACKERZ_BOSS_EVERY
}

/** Paid on surviving a wave, scaled by how much of the wall is left standing. */
export function hackerzClearBonus(wave: number, integrity: number) {
    return Math.round((60 + wave * 34) * (0.55 + 0.45 * Math.max(0, Math.min(1, integrity))))
}

export function hackerzIsBossWave(wave: number) {
    return wave % HACKERZ_BOSS_EVERY === 0
}

export function hackerzBossFor(wave: number): HackerzEnemyId {
    if (wave >= HACKERZ_MAX_WAVE) return 'zeroday'
    return wave % HACKERZ_HEAVY_BOSS_EVERY === 0 ? 'leviathan' : 'titan'
}

/** Types that may be rolled on this wave, bosses excluded — they are scripted. */
export function hackerzWavePool(wave: number) {
    return HACKERZ_ENEMIES.filter(def => !def.boss && !def.spawnedOnly && def.fromWave <= wave)
}

/** Ground speed from which a unit counts as a runner: hard to track, there and gone. */
export const HACKERZ_RUNNER_SPEED = 70

/**
 * How likely a type is to be rolled on this wave. Runners — sappers, wisps,
 * phantoms, gunships — get a boost that grows with the wave, so the late waves
 * mix fast, hard-to-hit targets in among the armour instead of only getting
 * heavier. The hackers are left out: the portal tops them up on its own.
 */
export function hackerzSpawnWeight(def: HackerzEnemyDefinition, wave: number) {
    if (def.id === HACKERZ_HACKER_ID || def.speed < HACKERZ_RUNNER_SPEED) return def.weight
    // The boost grows in over the opening waves rather than starting at ×1.5.
    const boost = Math.min(3, 1.5 + 0.1 * Math.max(0, wave - 1))
    const opening = Math.min(1, Math.max(0, wave - 1) / HACKERZ_BOSS_EVERY)
    return def.weight * (1 + (boost - 1) * opening)
}

/**
 * The green crawlers are the intrusion's hackers: the only units that go for
 * the path nodes. While any node can still be taken, the portal keeps this
 * many on the field, sending a fresh one for each that falls.
 */
export const HACKERZ_HACKER_ID: HackerzEnemyId = 'crawler'
export const HACKERZ_HACKER_FIELD = 7
/**
 * From this wave the intrusion comes in two waves of its own: the first
 * contingent of hackers at the start, a second one a few seconds later, and the
 * whole pack kept topped up from then on. A maxed-out battery otherwise picks
 * seven off as fast as they come and the clock runs out with nothing at stake.
 */
export const HACKERZ_HACKER_SURGE_WAVE = 15
export const HACKERZ_HACKER_CONTINGENT = 9
export const HACKERZ_HACKER_SECOND_MS = 4000

/** How many hackers the portal keeps on the field this far into a wave. */
export function hackerzHackerField(wave: number, elapsedMs: number) {
    // The opening waves send a smaller crew, growing to the full one by the first boss.
    if (wave < HACKERZ_BOSS_EVERY) return Math.min(HACKERZ_HACKER_FIELD, 2 + wave)
    if (wave < HACKERZ_HACKER_SURGE_WAVE) return HACKERZ_HACKER_FIELD
    return HACKERZ_HACKER_CONTINGENT * (elapsedMs < HACKERZ_HACKER_SECOND_MS ? 1 : 2)
}
/**
 * What a top-up hacker pays: half the credits and no coins. They never stop
 * coming, so a coin bounty on them would be a tap the site economy cannot afford.
 */
export const HACKERZ_REINFORCEMENT_BOUNTY = 0.5

// ─── Network events (bonus rounds) ──────────────────────────────────────────

export type HackerzEventId = 'ddos' | 'blackout' | 'packetloss'

export interface HackerzNetworkEvent {
    id: HackerzEventId
    name: string
    tagline: string
    icon: string
    hex: number
}

/**
 * Bonus rounds: offered at the uplink, skippable, and fought in a sandbox — the
 * wall is put back afterwards, the wave counter does not move and nothing drops
 * coins. Hold the wall above `HACKERZ_BONUS_PASS_INTEGRITY` and the round's
 * credits double. Credits only: the site economy never sees a bonus round.
 */
export const HACKERZ_EVENTS: readonly HackerzNetworkEvent[] = [
    {
        id: 'ddos',
        name: 'DDoS FLOOD',
        tagline: 'Three times the traffic at half the health.',
        icon: 'i-lucide-waves',
        hex: 0xf97316
    },
    {
        id: 'blackout',
        name: 'BLACKOUT',
        tagline: 'The grid goes dark. Only your ping shows what is coming.',
        icon: 'i-lucide-moon',
        hex: 0x818cf8
    },
    {
        id: 'packetloss',
        name: 'PACKET LOSS',
        tagline: 'A quarter of your rounds never arrive, and they glitch forward.',
        icon: 'i-lucide-wifi-off',
        hex: 0xe879f9
    }
]

/** A bonus round is offered after every this-many cleared waves. */
export const HACKERZ_BONUS_EVERY = 3
/** A sprint, not a second shift. */
export const HACKERZ_BONUS_MS = 30_000
/** Falling below this much of the wall fails the round on the spot. */
export const HACKERZ_BONUS_PASS_INTEGRITY = 0.5
/** What a passed round multiplies its credits by. */
export const HACKERZ_BONUS_MULTIPLIER = 2

/**
 * Whether the uplink after `clearedWave` offers a bonus round. `resolvedWave` is
 * the last cleared wave whose offer was played or skipped, so an offer is
 * answered once and a reload cannot bring it back.
 */
export function hackerzBonusOffered(clearedWave: number, resolvedWave: number) {
    return clearedWave > 0
        && clearedWave % HACKERZ_BONUS_EVERY === 0
        && clearedWave < HACKERZ_MAX_WAVE
        && resolvedWave < clearedWave
}

/** The events take turns, so every offer is a different problem. */
export function hackerzBonusEvent(clearedWave: number): HackerzNetworkEvent {
    const index = Math.max(0, Math.floor(clearedWave / HACKERZ_BONUS_EVERY) - 1) % HACKERZ_EVENTS.length
    return HACKERZ_EVENTS[index] as HackerzNetworkEvent
}

export function hackerzNetworkEvent(id: HackerzEventId): HackerzNetworkEvent {
    return HACKERZ_EVENTS.find(e => e.id === id) as HackerzNetworkEvent
}

// ─── Deployables ────────────────────────────────────────────────────────────

export type HackerzDeployableId = 'honeypot' | 'bomb' | 'proxy' | 'portscan' | 'blip' | 'whitehat' | 'surge'
export type HackerzDeployableStock = Record<HackerzDeployableId, number>

export interface HackerzDeployableDefinition {
    id: HackerzDeployableId
    name: string
    /**
     * The key that uses it mid-wave: it arms one that is aimed (a click then
     * places it, or picks its target), and fires one that is not at once.
     */
    key: 'Z' | 'X' | 'C' | 'V' | 'B' | 'N' | 'M'
    /** Used the moment its key is pressed, with nothing to aim. */
    instant?: boolean
    description: string
    icon: string
    hex: number
    cost: number
}

export const HACKERZ_DEPLOYABLES: readonly HackerzDeployableDefinition[] = [
    {
        id: 'honeypot',
        name: 'Honeypot',
        key: 'Z',
        description: 'A fake core. Hostiles nearby turn on it, then it blows up in their faces.',
        icon: 'i-lucide-hexagon',
        hex: 0xfacc15,
        cost: 90
    },
    {
        id: 'bomb',
        name: 'Logic Bomb',
        key: 'X',
        description: 'Sits on the grid and detonates when a hostile walks over it.',
        icon: 'i-lucide-bomb',
        hex: 0xf43f5e,
        cost: 120
    },
    {
        id: 'proxy',
        name: 'Proxy Wall',
        key: 'C',
        description: 'A barrier across part of the lane. Walkers stop to break it.',
        icon: 'i-lucide-brick-wall',
        hex: 0x38bdf8,
        cost: 150
    },
    {
        id: 'portscan',
        name: 'Portscan',
        key: 'V',
        instant: true,
        description: 'A standing radar sweep: every time the contacts fade it pings again, keeping hostiles targetable for a while.',
        icon: 'i-lucide-radar',
        hex: 0xa3e635,
        cost: 110
    },
    {
        id: 'blip',
        name: 'Cosmic Blip',
        key: 'B',
        instant: true,
        description: 'A stray cosmic ray flips the right bit: a hacked node is reclaimed on the spot.',
        icon: 'i-lucide-sparkles',
        hex: 0x22d3ee,
        cost: 220
    },
    {
        id: 'whitehat',
        name: 'White Hat',
        key: 'N',
        description: 'Click a hostile (never a boss): it switches sides and turns on its own until it falls.',
        icon: 'i-lucide-user-check',
        hex: 0xf8fafc,
        cost: 180
    },
    {
        id: 'surge',
        name: 'Power Surge',
        key: 'M',
        description: 'Overloads a patch of the grid: lightning arcs through every hostile inside it for a while.',
        icon: 'i-lucide-zap',
        hex: 0x60a5fa,
        cost: 160
    }
]

export const HACKERZ_DEPLOYABLE_IDS = HACKERZ_DEPLOYABLES.map(d => d.id)
/** The most of each a run can carry. */
export const HACKERZ_DEPLOYABLE_MAX = 5

export function hackerzDeployable(id: HackerzDeployableId): HackerzDeployableDefinition {
    return HACKERZ_DEPLOYABLES.find(d => d.id === id) as HackerzDeployableDefinition
}

/** Prices creep with the run so a late stockpile is still a choice. */
export function hackerzDeployableCost(def: HackerzDeployableDefinition, wave: number) {
    return Math.round(def.cost * (1 + Math.max(0, wave) * 0.05) / 5) * 5
}

export function hackerzEmptyStock(): HackerzDeployableStock {
    return { honeypot: 0, bomb: 0, proxy: 0, portscan: 0, blip: 0, whitehat: 0, surge: 0 }
}

/**
 * What a deployable does at a given wave: it scales with the wave like the
 * enemies do. How long a portscan or a surge runs, how many nodes a blip
 * reclaims and how many a white hat turns come from the Mainframe (see
 * `hackerzMainframeEffects`).
 */
export function hackerzDeployableStats(wave: number) {
    const w = Math.max(1, wave)
    return {
        honeypot: { lureRadius: 300, lifeMs: 9000, hp: 260 + w * 90, blastRadius: 210, blastDamage: 180 + w * 70 },
        bomb: { armMs: 500, triggerRadius: 70, blastRadius: 190, damage: 280 + w * 85 },
        proxy: { halfWidth: 130, hp: 520 + w * 130, lifeMs: 22_000 },
        /** A storm field: its radius, how often it arcs, into how many hostiles at once, and each arc's damage. */
        surge: { radius: 200, arcMs: 250, arcs: 3, damage: 30 + w * 12 }
    }
}

/** How long after a portscan's contacts fade it pings again. */
export const HACKERZ_PORTSCAN_REPING_MS = 500

// ─── Weapons ────────────────────────────────────────────────────────────────

export type HackerzWeaponId = 'rail' | 'flak' | 'arc' | 'missile' | 'sniper'

/** How a round behaves in flight and on impact. */
export type HackerzProjectile = 'rail' | 'pellet' | 'arc' | 'missile' | 'slug'

export interface HackerzWeaponDefinition {
    id: HackerzWeaponId
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
    projectile: HackerzProjectile
    speed: number
    damageType: HackerzDamageType
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

export const HACKERZ_WEAPONS: readonly HackerzWeaponDefinition[] = [
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
        // Each jump keeps 90% of the power (see HACKERZ_ARC_LOSS and Superconductor).
        chainFalloff: 0.9,
        hex: 0x818cf8
    },
    {
        id: 'missile',
        name: 'Seeker Pod',
        icon: 'i-lucide-rocket',
        cost: 2400,
        unlockWave: 10,
        tag: 'splash',
        // Scaled so each later gun stays ahead of the one before once the
        // hostiles' health at its unlock wave is counted (see scripts/hackerz-weapon-tiers.ts).
        damage: 72,
        fireIntervalMs: 850,
        magazine: 5,
        reloadMs: 2000,
        projectile: 'missile',
        speed: 900,
        damageType: 'kinetic',
        pierce: 0,
        splashRadius: 120,
        splashDamage: 43,
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
        // Scaled with the Seeker Pod's: ahead of it once hostile health at wave 14 is counted.
        damage: 180,
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

export function hackerzWeapon(id: HackerzWeaponId): HackerzWeaponDefinition {
    const def = HACKERZ_WEAPONS.find(w => w.id === id)
    if (!def) throw new Error(`Unknown hackerz weapon: ${id}`)
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
export function hackerzWeaponUnlockWave(def: HackerzWeaponDefinition, arsenalLevel: number) {
    const index = HACKERZ_WEAPONS.findIndex(w => w.id === def.id)
    return index > 0 && arsenalLevel >= index ? 1 : def.unlockWave
}

// ─── Turrets ────────────────────────────────────────────────────────────────

export type HackerzTurretId = 'gun' | 'needler' | 'warhead' | 'lance'

export interface HackerzTurretDefinition {
    id: HackerzTurretId
    name: string
    icon: string
    cost: number
    unlockWave: number
    tag: string
    damage: number
    intervalMs: number
    range: number
    damageType: HackerzDamageType
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
export const HACKERZ_TURRETS: readonly HackerzTurretDefinition[] = [
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

export function hackerzTurret(id: HackerzTurretId): HackerzTurretDefinition {
    const def = HACKERZ_TURRETS.find(t => t.id === id)
    if (!def) throw new Error(`Unknown hackerz turret: ${id}`)
    return def
}

/** Selling a mount back pays this much of what it cost. */
export const HACKERZ_TURRET_REFUND = 0.5

// ─── In-run upgrades ────────────────────────────────────────────────────────

export type HackerzUpgradeId =
    | 'damage' | 'firerate' | 'autoloader' | 'crit' | 'conduction'
    | 'integrity' | 'spire' | 'repair' | 'shield' | 'spikes'
    | 'turretPower'
    | 'pulse' | 'overclock'

export type HackerzTab = 'rail' | 'bastion' | 'turrets' | 'systems'

export interface HackerzUpgradeDefinition {
    id: HackerzUpgradeId
    name: string
    icon: string
    tab: HackerzTab
    max: number
    baseCost: number
    /** Cost multiplier per level already owned. */
    growth: number
    /** The stat at a given level. Kept to a few characters — the shop is a list. */
    value: (level: number) => string
    /** Only does anything for this gun, so the uplink offers it once the gun is owned. */
    weapon?: HackerzWeaponId
}

/**
 * The Tesla Coil's arc loses this share of its power at every jump, and each
 * level of Superconductor takes this much off that loss.
 */
export const HACKERZ_ARC_LOSS = 0.1
export const HACKERZ_ARC_LOSS_STEP = 0.005

/**
 * Twelve lines, four of them on the gun.
 *
 * The gun used to have eight, and the result was that no single purchase moved
 * the number you were looking at — magazine, reload and pierce all read as
 * "slightly better" and none of them changed a fight. Magazine and reload are
 * one line now (Autoloader), pierce belongs to the weapons that have it, and the
 * credit-rate line moved out of the run entirely (see the Mainframe below).
 */
export const HACKERZ_UPGRADES: readonly HackerzUpgradeDefinition[] = [
    {
        id: 'damage',
        name: 'Payload Amp',
        icon: 'i-lucide-zap',
        tab: 'rail',
        max: 10,
        baseCost: 160,
        growth: 1.48,
        value: level => `×${(1 + level * 0.3).toFixed(2)} dmg`
    },
    {
        id: 'firerate',
        name: 'Cycle Boost',
        icon: 'i-lucide-gauge',
        tab: 'rail',
        max: 10,
        baseCost: 180,
        growth: 1.50,
        value: level => `×${(1 / Math.pow(0.93, level)).toFixed(2)} rate`
    },
    {
        id: 'autoloader',
        name: 'Buffer Overflow',
        icon: 'i-lucide-layers',
        tab: 'rail',
        max: 8,
        baseCost: 150,
        growth: 1.44,
        value: level => `×${(1 + level * 0.25).toFixed(2)} mag · ×${Math.pow(0.9, level).toFixed(2)} reload`
    },
    {
        id: 'crit',
        name: 'Exploit Kit',
        icon: 'i-lucide-crosshair',
        tab: 'rail',
        max: 8,
        baseCost: 240,
        growth: 1.54,
        value: level => `${Math.round((0.04 + level * 0.04) * 100)}% · ${(2 + level * 0.15).toFixed(1)}x`
    },
    {
        id: 'conduction',
        name: 'Superconductor',
        icon: 'i-lucide-git-fork',
        tab: 'rail',
        max: 10,
        baseCost: 200,
        growth: 1.42,
        weapon: 'arc',
        value: level => `−${((HACKERZ_ARC_LOSS - level * HACKERZ_ARC_LOSS_STEP) * 100).toFixed(1)}%/jump`
    },
    {
        id: 'integrity',
        name: 'Hardened Kernel',
        icon: 'i-lucide-brick-wall',
        tab: 'bastion',
        max: 14,
        baseCost: 150,
        growth: 1.44,
        value: level => `+${level * 380} HP`
    },
    {
        id: 'spire',
        name: 'Rack Expansion',
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
        name: 'ICE Barrier',
        icon: 'i-lucide-shield',
        tab: 'bastion',
        max: 8,
        baseCost: 260,
        growth: 1.55,
        value: level => level === 0 ? 'offline' : `+${level * 90} · ${level * 4}/s`
    },
    {
        id: 'spikes',
        name: 'Tarpit Grid',
        icon: 'i-lucide-grid-2x2',
        tab: 'bastion',
        max: 8,
        baseCost: 290,
        growth: 1.58,
        value: level => level === 0 ? 'offline' : `${level * 42} dmg/s · 1 round/s`
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

export function hackerzUpgrade(id: HackerzUpgradeId): HackerzUpgradeDefinition {
    const def = HACKERZ_UPGRADES.find(u => u.id === id)
    if (!def) throw new Error(`Unknown hackerz upgrade: ${id}`)
    return def
}

export type HackerzUpgradeLevels = Record<HackerzUpgradeId, number>

export function hackerzEmptyLevels(): HackerzUpgradeLevels {
    return Object.fromEntries(HACKERZ_UPGRADES.map(u => [u.id, 0])) as HackerzUpgradeLevels
}

/** Cost of the next level, rounded to something that reads like a price tag. */
export function hackerzUpgradeCost(def: HackerzUpgradeDefinition, level: number) {
    return Math.round(def.baseCost * Math.pow(def.growth, level) / 5) * 5
}

/** Repairing the wall by hand is priced per missing point, so it is never a trap. */
export function hackerzRepairCost(missingHp: number) {
    return Math.max(10, Math.round(missingHp * 0.3 / 5) * 5)
}

/** Mounts on a bare wall, before Spire levels or a Rampart Charter. */
export const HACKERZ_BASE_SLOTS = 2
/**
 * Every mount the upgrades can buy — the base pair, six Spire levels and four
 * Charter mounts — has a place on the wall: eight along the parapet and four in
 * a raised row behind them.
 */
export const HACKERZ_MAX_SLOTS = 12

export function hackerzSlots(spireLevel: number, charterLevel = 0) {
    return Math.min(HACKERZ_MAX_SLOTS, HACKERZ_BASE_SLOTS + spireLevel + charterLevel)
}

/**
 * The highest level of an upgrade the uplink will sell this run. Spire levels
 * stop where the tower runs out of room: with a Rampart Charter's mounts already
 * standing, a level past that would cost credits and add nothing.
 */
export function hackerzUpgradeMax(def: { id: string, max: number }, charterLevel = 0) {
    if (def.id !== 'spire') return def.max
    return Math.max(0, Math.min(def.max, HACKERZ_MAX_SLOTS - HACKERZ_BASE_SLOTS - charterLevel))
}

// ─── Mainframe (permanent, coin-bought) ─────────────────────────────────────

export const HACKERZ_MAINFRAME_IDS = [
    'bulwark', 'munitions', 'foundry', 'grant', 'salvage', 'capacitor', 'charter', 'arsenal',
    'scanner', 'blip', 'whitehat', 'surge'
] as const
export type HackerzMainframeId = typeof HACKERZ_MAINFRAME_IDS[number]

export type HackerzMainframeLevels = Record<HackerzMainframeId, number>

export interface HackerzMainframeDefinition {
    id: HackerzMainframeId
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
 *
 * The whole tree costs a few hundred million, which is roughly what the Pirate
 * Raid armoury costs and roughly three hundred endgame runs. It used to cost a
 * hundred and sixty billion, from the era when these games were priced as coin
 * sinks first; prestige took that job, and a sink nobody can reach is not a
 * sink, it is a tree with no reason to be looked at.
 */
export const HACKERZ_MAINFRAME: readonly HackerzMainframeDefinition[] = [
    {
        id: 'bulwark',
        name: 'Bedrock Firmware',
        description: 'The wall starts every run thicker.',
        icon: 'i-lucide-brick-wall',
        color: 'success',
        max: 12,
        baseCost: 24_000,
        growth: 1.9,
        value: level => `+${level * 6}% wall HP`
    },
    {
        id: 'munitions',
        name: 'Weaponised Payloads',
        description: 'Every weapon you carry hits harder.',
        icon: 'i-lucide-zap',
        color: 'error',
        max: 12,
        baseCost: 30_000,
        growth: 1.95,
        value: level => `+${level * 5}% weapon damage`
    },
    {
        id: 'foundry',
        name: 'Turret Firmware',
        description: 'Every mounted turret hits harder.',
        icon: 'i-lucide-factory',
        color: 'warning',
        max: 12,
        baseCost: 30_000,
        growth: 1.95,
        value: level => `+${level * 5}% turret damage`
    },
    {
        id: 'grant',
        name: 'Seed Funding',
        description: 'Deploy with credits already banked.',
        icon: 'i-lucide-banknote',
        color: 'info',
        max: 10,
        baseCost: 20_000,
        growth: 1.85,
        value: level => `+${level * 200} starting credits`
    },
    {
        id: 'salvage',
        name: 'Crypto Miner',
        description: 'Strip more coin off everything you kill.',
        icon: 'i-lucide-coins',
        color: 'secondary',
        max: 13,
        baseCost: 30_000,
        growth: 1.9,
        value: level => `+${level * 8}% coin drops`
    },
    {
        id: 'capacitor',
        name: 'Always-On ICE',
        description: 'The barrier comes online without buying it first.',
        icon: 'i-lucide-shield',
        color: 'primary',
        max: 10,
        baseCost: 25_000,
        growth: 1.85,
        value: level => `+${level * 45} shield · +${level * 3}/s`
    },
    {
        id: 'charter',
        name: 'Rack Charter',
        description: 'Extra turret mounts, open from wave one.',
        icon: 'i-lucide-building-2',
        color: 'warning',
        max: 4,
        baseCost: 1_500_000,
        growth: 2.8,
        value: level => `+${level} starting mount${level === 1 ? '' : 's'}`
    },
    {
        id: 'arsenal',
        name: 'Darknet Licence',
        description: 'The uplink sells the next gun up from wave one. You still pay for it.',
        icon: 'i-lucide-swords',
        color: 'error',
        max: 4,
        baseCost: 1_200_000,
        growth: 3,
        value: (level) => {
            const unlocked = HACKERZ_WEAPONS.slice(1, level + 1).map(w => w.name)
            return unlocked.length ? unlocked.join(', ') : 'nothing yet'
        }
    },
    {
        id: 'scanner',
        name: 'Persistent Scanner',
        description: 'Every Portscan keeps sweeping for longer.',
        icon: 'i-lucide-radar',
        color: 'success',
        max: 5,
        baseCost: 40_000,
        growth: 2,
        value: level => `${15 + level * 3}s portscan`
    },
    {
        id: 'blip',
        name: 'Solar Flare',
        description: 'Every Cosmic Blip flips more nodes back.',
        icon: 'i-lucide-sparkles',
        color: 'info',
        max: 2,
        baseCost: 400_000,
        growth: 3,
        value: level => `${1 + level} node${level ? 's' : ''} per blip`
    },
    {
        id: 'whitehat',
        name: 'Bug Bounty',
        description: 'Every White Hat turns more hostiles.',
        icon: 'i-lucide-user-check',
        color: 'neutral',
        max: 4,
        baseCost: 120_000,
        growth: 2.4,
        value: level => `${1 + level} hostile${level ? 's' : ''} per white hat`
    },
    {
        id: 'surge',
        name: 'Grid Overload',
        description: 'Every Power Surge crackles for longer.',
        icon: 'i-lucide-zap',
        color: 'primary',
        max: 4,
        baseCost: 50_000,
        growth: 2,
        value: level => `${8 + level * 2}s surge`
    }
] as const

export function hackerzMainframe(id: HackerzMainframeId): HackerzMainframeDefinition {
    const def = HACKERZ_MAINFRAME.find(m => m.id === id)
    if (!def) throw new Error(`Unknown hackerz mainframe upgrade: ${id}`)
    return def
}

export function hackerzEmptyMainframe(): HackerzMainframeLevels {
    return Object.fromEntries(HACKERZ_MAINFRAME_IDS.map(id => [id, 0])) as HackerzMainframeLevels
}

/**
 * Coin cost of the next level, or `null` when maxed. Rounded to three
 * significant figures so a price tag reads as a price tag and not as a hash.
 */
export function hackerzMainframeCost(def: HackerzMainframeDefinition, level: number): number | null {
    if (level >= def.max) return null
    const raw = def.baseCost * Math.pow(def.growth, level)
    const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 2))
    return Math.round(raw / magnitude) * magnitude
}

export interface HackerzMainframeEffects {
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
    /** How long a Portscan keeps sweeping, how many nodes a Cosmic Blip reclaims, how many hostiles a White Hat turns, how long a Power Surge lasts. */
    portscanMs: number
    blipNodes: number
    whitehatTargets: number
    surgeMs: number
}

export function hackerzMainframeEffects(levels: HackerzMainframeLevels): HackerzMainframeEffects {
    return {
        wallHp: 1 + levels.bulwark * 0.06,
        weaponDamage: 1 + levels.munitions * 0.05,
        turretDamage: 1 + levels.foundry * 0.05,
        startingCredits: HACKERZ_BASE_CREDITS + levels.grant * 200,
        coins: 1 + levels.salvage * 0.08,
        shieldBase: levels.capacitor * 45,
        shieldRegenBase: levels.capacitor * 3,
        startingMounts: levels.charter,
        arsenal: levels.arsenal,
        portscanMs: (15 + levels.scanner * 3) * 1000,
        blipNodes: 1 + levels.blip,
        whitehatTargets: 1 + levels.whitehat,
        surgeMs: (8 + levels.surge * 2) * 1000
    }
}

/** Credits a run is deployed with before any Uplink Grant. */
export const HACKERZ_BASE_CREDITS = 250

/** A rough single number for "how invested is this account", for the HUD and run snapshots. */
export function hackerzPower(levels: HackerzMainframeLevels) {
    return HACKERZ_MAINFRAME.reduce((sum, def) => sum + levels[def.id] * (def.max <= 4 ? 12 : 5), 10)
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
export const HACKERZ_COIN_SCALE = 0.55

/**
 * How hard depth alone compounds a wave's coin value.
 *
 * This used to be 1.35, which on top of a linearly-growing budget and bounty
 * made a run's total roughly cubic in its final wave. That is what let a bare
 * account farm Probe: Probe softens bodies without thinning them, so a wall
 * with nothing bought still walked to wave 19, and wave 19 of *anything* paid
 * six figures. At 1.1 the depth premium is still real and still the reason to
 * survive, but the difficulty multiplier below — which is the thing you have to
 * buy your way into — is what actually decides what a run is worth.
 */
export const HACKERZ_COIN_WAVE_EXPONENT = 1.1

export function hackerzCoinValue(
    bounty: number,
    wave: number,
    difficulty: HackerzDifficulty,
    coinMultiplier: number
) {
    return Math.max(1, Math.round(
        bounty
        * HACKERZ_COIN_SCALE
        * hackerzWaveReward(difficulty, wave)
        * Math.max(0, coinMultiplier)
        * Math.pow(Math.max(1, wave), HACKERZ_COIN_WAVE_EXPONENT)
    ))
}

/**
 * Server-side ceiling on what a settled run may pay, derived from the deepest
 * wave it actually reached. Tuned so honest play brushes it only on an
 * exceptional run — it exists to bound a forged `coins` field, not to tax a
 * good one.
 */
export function hackerzMaxPayout(wave: number, difficulty: HackerzDifficulty, coinMultiplier: number) {
    const depth = Math.max(0, Math.min(wave, HACKERZ_MAX_WAVE))
    // Closed-ish form of "every wave up to here paid its whole budget in bounty",
    // with generous headroom on top of the coin curve above.
    let ceiling = 0
    for (let w = 1; w <= depth; w++) {
        const budget = hackerzWaveBudget(w, difficulty)
        // ~3.4 bounty per budget point is the richest the enemy table gets.
        const waveBounty = budget * 3.4 * hackerzBountyMultiplier(w)
        ceiling += hackerzCoinValue(waveBounty, w, difficulty, coinMultiplier)
    }
    // Padded on top of that. The balance model assumes a player lands 68% of
    // their theoretical damage; a genuinely good one lands more and kills more of
    // the wave before the purge takes it at a quarter rate, and none of that
    // should meet a cap. 1.5 leaves the best build `hackerz-sim` can describe
    // (twelve mounts, everything maxed) a 1.5x margin or better on every
    // difficulty, which is headroom for honest play without being headroom for
    // a forged `coins` field.
    return Math.floor(ceiling * 1.5)
}

export function hackerzPayoutForRun(
    coins: number,
    wave: number,
    difficulty: HackerzDifficulty,
    coinMultiplier: number
) {
    const banked = Math.max(0, Math.floor(Number.isFinite(coins) ? coins : 0))
    return Math.min(banked, hackerzMaxPayout(wave, difficulty, coinMultiplier))
}

// ─── Loadout ────────────────────────────────────────────────────────────────

/** A weapon with every upgrade already folded in. */
export interface HackerzWeaponRuntime {
    id: HackerzWeaponId
    name: string
    damage: number
    fireIntervalMs: number
    magazine: number
    reloadMs: number
    pierce: number
    projectile: HackerzProjectile
    speed: number
    damageType: HackerzDamageType
    pellets: number
    spread: number
    splashRadius: number
    splashDamage: number
    homing: boolean
    chain: number
    chainFalloff: number
    hex: number
}

export interface HackerzTurretRuntime {
    id: HackerzTurretId
    slot: number
    name: string
    damage: number
    intervalMs: number
    range: number
    damageType: HackerzDamageType
    pierce: number
    splashRadius: number
    splashDamage: number
    hex: number
}

/** Everything the engine needs to run a wave. Derived, never stored. */
export interface HackerzLoadout {
    weapon: HackerzWeaponRuntime
    turrets: HackerzTurretRuntime[]
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
    difficulty: HackerzDifficulty
    /** Deployables carried into the wave. */
    deployables: HackerzDeployableStock
    /** What the Mainframe makes of them: a Portscan's run, a Blip's nodes, a White Hat's turns, a Surge's run. */
    portscanMs: number
    blipNodes: number
    whitehatTargets: number
    surgeMs: number
}

export interface HackerzArmoury {
    levels: HackerzUpgradeLevels
    /** Weapon ids the player has bought. `rail` is always present. */
    owned: HackerzWeaponId[]
    active: HackerzWeaponId
    /** One entry per mount; `null` is an empty mount. */
    turrets: (HackerzTurretId | null)[]
    /** Deployables carried into the next wave. Absent on saves from before they existed. */
    deployables?: HackerzDeployableStock
}

/** An armoury's deployable stock, whole even for a save written before deployables. */
export function hackerzStock(armoury: HackerzArmoury): HackerzDeployableStock {
    return { ...hackerzEmptyStock(), ...armoury.deployables }
}

export function hackerzEmptyArmoury(mainframe: HackerzMainframeLevels = hackerzEmptyMainframe()): HackerzArmoury {
    return {
        levels: hackerzEmptyLevels(),
        owned: ['rail'],
        active: 'rail',
        turrets: Array.from({ length: hackerzSlots(0, mainframe.charter) }, () => null),
        deployables: hackerzEmptyStock()
    }
}

/** Base wall health before Integrity levels or a Reinforced Bulwark. */
export const HACKERZ_BASE_WALL_HP = 1000

export function hackerzWeaponRuntime(
    id: HackerzWeaponId,
    levels: HackerzUpgradeLevels,
    effects: HackerzMainframeEffects
): HackerzWeaponRuntime {
    const def = hackerzWeapon(id)
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
        // Superconductor cuts what an arc loses at each jump.
        chainFalloff: def.chainFalloff ? Math.min(1, def.chainFalloff + (levels.conduction ?? 0) * HACKERZ_ARC_LOSS_STEP) : 0,
        hex: def.hex
    }
}

export function hackerzLoadout(
    armoury: HackerzArmoury,
    mainframe: HackerzMainframeLevels,
    difficultyId: HackerzDifficultyId
): HackerzLoadout {
    const levels = armoury.levels
    const effects = hackerzMainframeEffects(mainframe)
    const pulse = levels.pulse
    const overclock = levels.overclock
    const turretScale = (1 + levels.turretPower * 0.28) * effects.turretDamage

    const turrets: HackerzTurretRuntime[] = []
    armoury.turrets.forEach((id, slot) => {
        if (!id) return
        const def = hackerzTurret(id)
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
        weapon: hackerzWeaponRuntime(armoury.active, levels, effects),
        turrets,
        slots: hackerzSlots(levels.spire, effects.startingMounts),
        spire: levels.spire,
        critChance: 0.04 + levels.crit * 0.04,
        critMultiplier: 2 + levels.crit * 0.15,
        wallMaxHp: Math.round((HACKERZ_BASE_WALL_HP + levels.integrity * 380) * effects.wallHp),
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
        difficulty: hackerzDifficulty(difficultyId),
        deployables: hackerzStock(armoury),
        portscanMs: effects.portscanMs,
        blipNodes: effects.blipNodes,
        whitehatTargets: effects.whitehatTargets,
        surgeMs: effects.surgeMs
    }
}

/** Seconds without taking a hit before the barrier starts coming back. */
export const HACKERZ_SHIELD_DELAY_MS = 3000

// ─── Database ───────────────────────────────────────────────────────────────

/**
 * The Database starts incomplete: an entry opens once its thing has been
 * bought into an armoury, or met on the board. These are known from the start:
 * the board itself, the stock rail and its radar.
 */
export const HACKERZ_CODEX_ALWAYS: readonly string[] = ['fence', 'blue', 'rail', 'ping', 'nodes', 'damage']

/** Upgrades with an entry of their own, by that entry: buying the first level opens it. */
export const HACKERZ_CODEX_UPGRADES = { barrier: 'shield', grid: 'spikes', pulse: 'pulse', overclock: 'overclock' } as const satisfies Record<string, HackerzUpgradeId>

/**
 * How the intrusion fights together, by the wave each is first seen: a node
 * defender as soon as a node falls, bodyguards once hackers bring them.
 */
export const HACKERZ_CODEX_TACTICS = ['defender', 'bodyguard'] as const
const TACTIC_FROM_WAVE: Record<typeof HACKERZ_CODEX_TACTICS[number], number> = { defender: 1, bodyguard: 10 }

/** Every entry the Database can open: the only ids the server will record. */
export const HACKERZ_CODEX_IDS: ReadonlySet<string> = new Set([
    ...HACKERZ_ENEMIES.map(def => def.id),
    ...HACKERZ_WEAPONS.map(def => def.id),
    ...HACKERZ_TURRETS.map(def => def.id),
    ...HACKERZ_DEPLOYABLES.map(def => def.id),
    ...HACKERZ_EVENTS.map(event => event.id),
    ...Object.keys(HACKERZ_CODEX_UPGRADES),
    ...HACKERZ_CODEX_TACTICS
])

/** The entries an armoury opens: every gun, turret, deployable and upgrade bought into it. */
export function hackerzCodexFromArmoury(armoury: HackerzArmoury): string[] {
    const ids: string[] = [...armoury.owned]
    for (const turret of armoury.turrets) if (turret) ids.push(turret)
    for (const [id, count] of Object.entries(hackerzStock(armoury))) if (count > 0) ids.push(id)
    for (const [entry, upgrade] of Object.entries(HACKERZ_CODEX_UPGRADES)) if ((armoury.levels[upgrade] ?? 0) > 0) ids.push(entry)
    return ids
}

/**
 * The threats a player has met by reaching a wave: every hostile that spawns
 * up to it, the bosses of the boss waves on the way, and the bonus rounds
 * offered. Lets a veteran's Database open on what they have already fought.
 */
export function hackerzCodexFromWave(bestWave: number): string[] {
    const ids: string[] = []
    for (const def of HACKERZ_ENEMIES) {
        if (!def.boss && !def.spawnedOnly && def.fromWave <= bestWave) ids.push(def.id)
    }
    for (let wave = HACKERZ_BOSS_EVERY; wave <= bestWave; wave += HACKERZ_BOSS_EVERY) ids.push(hackerzBossFor(wave))
    // ROOTKIT's brood comes with it.
    if (ids.includes('titan')) ids.push('spiderling')
    for (const tactic of HACKERZ_CODEX_TACTICS) if (TACTIC_FROM_WAVE[tactic] <= bestWave) ids.push(tactic)
    for (let wave = HACKERZ_BONUS_EVERY; wave <= bestWave && wave < HACKERZ_MAX_WAVE; wave += HACKERZ_BONUS_EVERY) ids.push(hackerzBonusEvent(wave).id)
    return [...new Set(ids)]
}

// ─── Saved runs ─────────────────────────────────────────────────────────────

/**
 * Bumped whenever the shape below, or any balance number a save depends on,
 * changes enough that a stored run would resume into a different game. A save
 * from an older version is dropped rather than migrated.
 */
export const HACKERZ_SAVE_VERSION = 1

/**
 * A run frozen between waves.
 *
 * Only ever written during the uplink — mid-wave state (enemies, bullets, the
 * clock) is deliberately not persisted, because a wave is 45 seconds and the
 * complexity of restoring one mid-flight buys nothing.
 */
export interface HackerzRunSave {
    version: number
    difficulty: HackerzDifficultyId
    /** The wave that was just cleared. The next deploy is this plus one. */
    wave: number
    credits: number
    /** Coins banked so far, settled when the run finishes. */
    coins: number
    kills: number
    wallHp: number
    armoury: HackerzArmoury
    /**
     * The last cleared wave whose bonus round was played or skipped, so an offer
     * is answered once. Absent on saves from before bonus rounds.
     */
    bonusWave?: number
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Validates a save posted by a client. Everything here is a bound rather than a
 * business rule: the endpoint that stores it re-checks the parts that decide
 * money, and this only guarantees the blob is the shape the game can read back.
 */
export function hackerzValidateSave(save: unknown): save is HackerzRunSave {
    if (typeof save !== 'object' || save === null) return false
    const candidate = save as HackerzRunSave
    if (candidate.version !== HACKERZ_SAVE_VERSION) return false
    if (!HACKERZ_DIFFICULTY_IDS.includes(candidate.difficulty)) return false
    if (!isFiniteNumber(candidate.wave) || candidate.wave < 0 || candidate.wave > HACKERZ_MAX_WAVE) return false
    if (!isFiniteNumber(candidate.credits) || candidate.credits < 0 || candidate.credits > 1e12) return false
    if (!isFiniteNumber(candidate.coins) || candidate.coins < 0 || candidate.coins > 1e15) return false
    if (!isFiniteNumber(candidate.kills) || candidate.kills < 0 || candidate.kills > 1e6) return false
    if (!isFiniteNumber(candidate.wallHp) || candidate.wallHp < 0 || candidate.wallHp > 1e9) return false
    if (candidate.bonusWave !== undefined
        && (!isFiniteNumber(candidate.bonusWave) || candidate.bonusWave < 0 || candidate.bonusWave > candidate.wave)) return false

    const armoury = candidate.armoury
    if (typeof armoury === 'object' && armoury !== null && armoury.deployables !== undefined) {
        const stock = armoury.deployables
        if (typeof stock !== 'object' || stock === null) return false
        if (Object.keys(stock).some(key => !HACKERZ_DEPLOYABLE_IDS.includes(key as HackerzDeployableId))) return false
        if (!Object.values(stock).every(n => isFiniteNumber(n) && n >= 0 && n <= HACKERZ_DEPLOYABLE_MAX)) return false
    }
    if (typeof armoury !== 'object' || armoury === null) return false
    if (!Array.isArray(armoury.owned) || armoury.owned.length > HACKERZ_WEAPONS.length) return false
    if (!armoury.owned.every(id => HACKERZ_WEAPONS.some(w => w.id === id))) return false
    if (!HACKERZ_WEAPONS.some(w => w.id === armoury.active)) return false
    if (!Array.isArray(armoury.turrets) || armoury.turrets.length > HACKERZ_MAX_SLOTS) return false
    if (!armoury.turrets.every(id => id === null || HACKERZ_TURRETS.some(t => t.id === id))) return false
    if (typeof armoury.levels !== 'object' || armoury.levels === null) return false
    return HACKERZ_UPGRADES.every((def) => {
        // A save from before an upgrade existed simply has none of it.
        const level = armoury.levels[def.id] ?? 0
        return isFiniteNumber(level) && level >= 0 && level <= def.max
    })
}

/**
 * The most waves a run could plausibly have played in the wall-clock time since
 * it started. A save that claims more than this has been edited — waves are a
 * fixed length and the uplink between them only adds time.
 */
export function hackerzMaxWaveForElapsedMs(elapsedMs: number) {
    return Math.max(0, Math.floor(Math.max(0, elapsedMs) / HACKERZ_WAVE_MS))
}

/** Uplink recharge after a settled run — 2 hours. */
export const HACKERZ_RUN_COOLDOWN_MS = 2 * 60 * 60 * 1000
export const HACKERZ_COOLDOWN_RUSH_MS_PER_GEM = 10 * 60 * 1000

export function hackerzRunCooldownRemainingMs(lastRunFinishedAt: Date | null, now: number) {
    if (!lastRunFinishedAt) return 0
    return Math.max(0, lastRunFinishedAt.getTime() + HACKERZ_RUN_COOLDOWN_MS - now)
}

/** One gem clears each started ten-minute block of uplink recharge time. */
export function hackerzCooldownRushCost(remainingMs: number) {
    return Math.max(0, Math.ceil(Math.max(0, remainingMs) / HACKERZ_COOLDOWN_RUSH_MS_PER_GEM))
}

