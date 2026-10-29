/**
 * RIFTBORN: a horde-survival roguelike. The run itself is simulated on the
 * client; the server only knows when it started and caps what a finished run
 * can claim by the wall-clock time that has passed since.
 *
 * The game pays no coins or gems. Runs earn Rift XP, which levels the account;
 * every level (and some achievements) grants a skill point for the skill tree,
 * which can be respecced freely. Achievements unlock the other classes.
 */

export const RIFTBORN_RUN_SECONDS = 15 * 60
/** Boss waves; the last one is the Rift Heart, whose death wins the run. */
export const RIFTBORN_BOSS_TIMES = [180, 360, 540, 720, 900] as const

export type RiftbornClassId = 'knight' | 'ranger' | 'pyromancer' | 'stormcaller' | 'necromancer' | 'voidwalker'

export interface RiftbornClassDef {
    id: RiftbornClassId
    name: string
    title: string
    description: string
    /** Hex colour, the class's signature tint */
    color: number
    /** Achievement that unlocks the class, null for the starter */
    unlockedBy: string | null
    /** Id of the weapon the class starts every run with */
    startingWeapon: string
    /** Name of the ultimate (charged by kills, fired with E / right click) */
    ultimate: string
    ultimateDescription: string
    baseHp: number
    /** World units per second */
    baseSpeed: number
    /** Multiplier on all damage */
    might: number
    /** Flat damage taken reduction per hit */
    armor: number
    trait: string
}

export const RIFTBORN_CLASSES: readonly RiftbornClassDef[] = [
    {
        id: 'knight',
        name: 'Knight',
        title: 'The Last Bulwark',
        description: 'Wide sword arcs, high armor.',
        color: 0xf5c451,
        unlockedBy: null,
        startingWeapon: 'cleaver',
        ultimate: 'Judgement',
        ultimateDescription: 'Screen-wide shockwave that stuns.',
        baseHp: 140,
        baseSpeed: 190,
        might: 1,
        armor: 2,
        trait: '+2 armor, 1 HP per 25 kills'
    },
    {
        id: 'ranger',
        name: 'Ranger',
        title: 'Wind Archer',
        description: 'Fast, with piercing arrows.',
        color: 0x5fe08a,
        unlockedBy: 'survivor',
        startingWeapon: 'longbow',
        ultimate: 'Arrowstorm',
        ultimateDescription: 'Arrow rain around you for 4 s.',
        baseHp: 95,
        baseSpeed: 230,
        might: 1,
        armor: 0,
        trait: '+15% speed, +1 projectile'
    },
    {
        id: 'pyromancer',
        name: 'Pyromancer',
        title: 'Cinder Witch',
        description: 'Exploding fireballs that burn.',
        color: 0xff6a2b,
        unlockedBy: 'slayer',
        startingWeapon: 'fireball',
        ultimate: 'Meteor Fall',
        ultimateDescription: '12 meteors on the densest crowds.',
        baseHp: 90,
        baseSpeed: 200,
        might: 1.15,
        armor: 0,
        trait: '+15% damage, burns spread on death'
    },
    {
        id: 'stormcaller',
        name: 'Stormcaller',
        title: 'Thunder Sage',
        description: 'Lightning that chains between enemies.',
        color: 0x63c7ff,
        unlockedBy: 'boss-slayer',
        startingWeapon: 'chainLightning',
        ultimate: 'Tempest',
        ultimateDescription: 'Bolts hit everything nearby for 5 s.',
        baseHp: 100,
        baseSpeed: 205,
        might: 1,
        armor: 1,
        trait: '-10% cooldowns, crits chain once more'
    },
    {
        id: 'necromancer',
        name: 'Necromancer',
        title: 'Bone Shepherd',
        description: 'Homing skulls and skeleton allies.',
        color: 0xb06bff,
        unlockedBy: 'legion',
        startingWeapon: 'soulSkulls',
        ultimate: 'Army of the Dead',
        ultimateDescription: 'Summon 10 wraiths for 8 s.',
        baseHp: 105,
        baseSpeed: 195,
        might: 1,
        armor: 1,
        trait: 'Kills can raise a skeleton'
    },
    {
        id: 'voidwalker',
        name: 'Voidwalker',
        title: 'Rift Eater',
        description: 'Orbiting void orbs.',
        color: 0xff3fa4,
        unlockedBy: 'riftbreaker',
        startingWeapon: 'voidOrbs',
        ultimate: 'Singularity',
        ultimateDescription: 'Black hole that pulls in, then explodes.',
        baseHp: 110,
        baseSpeed: 215,
        might: 1.1,
        armor: 1,
        trait: '+10% damage, dash leaves a rift'
    }
]

export const RIFTBORN_CLASS_IDS = RIFTBORN_CLASSES.map(c => c.id)

export function riftbornClass(id: string | null | undefined): RiftbornClassDef | undefined {
    return RIFTBORN_CLASSES.find(c => c.id === id)
}


// ─── Skill tree ──────────────────────────────────────────────────────────

/** What the skill tree does to a run, read by the engine at deploy. */
export interface RiftbornMetaEffects {
    hpMul: number
    damageMul: number
    cooldownMul: number
    magnetMul: number
    armor: number
    regen: number
    luck: number
    xpMul: number
    rerolls: number
    revivals: number
    /** Added to the base crit chance */
    critChance: number
    /** Added to the crit damage multiplier */
    critDamage: number
    /** Extra projectiles on every projectile weapon */
    projectiles: number
    /** Non-boss enemies below this HP fraction die on hit, 0 = off */
    executeThreshold: number
    /** Contact hits reflect thorns × damage taken × 10 and knock back, 0 = off */
    thorns: number
    /** Cooldown reduction while the combo is at 50 or more */
    comboHaste: number
    dashCooldownMul: number
    dashIframeMul: number
    /** Extra rewards in every chest */
    chestBonus: number
    /** Free level-ups granted at the start of a run */
    startLevel: number
    ultChargeMul: number
    /** Crits splash their overkill damage onto nearby enemies */
    overkill: boolean
    /** Up to +60% damage as HP drops */
    berserk: boolean
    /** Dash teleports and detonates a rift blast at both ends */
    blinkDash: boolean
    /** Every 20 s every gem on the map is pulled in */
    magnetPulse: boolean
    /** HP healed per kill */
    killHeal: number
    /** Chance a killed enemy explodes */
    deathExplosionChance: number
}

export function riftbornBaseEffects(): RiftbornMetaEffects {
    return {
        hpMul: 1,
        damageMul: 1,
        cooldownMul: 1,
        magnetMul: 1,
        armor: 0,
        regen: 0,
        luck: 0,
        xpMul: 1,
        rerolls: 1,
        revivals: 0,
        critChance: 0,
        critDamage: 0,
        projectiles: 0,
        executeThreshold: 0,
        thorns: 0,
        comboHaste: 0,
        dashCooldownMul: 1,
        dashIframeMul: 1,
        chestBonus: 0,
        startLevel: 0,
        ultChargeMul: 1,
        overkill: false,
        berserk: false,
        blinkDash: false,
        magnetPulse: false,
        killHeal: 0,
        deathExplosionChance: 0
    }
}

export type RiftbornBranch = 'fury' | 'bulwark' | 'fortune'

export const RIFTBORN_BRANCHES: readonly { id: RiftbornBranch, name: string, color: number, icon: string }[] = [
    { id: 'fury', name: 'Fury', color: 0xff4d5e, icon: 'i-lucide-swords' },
    { id: 'bulwark', name: 'Bulwark', color: 0xf5c451, icon: 'i-lucide-shield' },
    { id: 'fortune', name: 'Fortune', color: 0x4fd8ff, icon: 'i-lucide-sparkles' }
]

export interface RiftbornSkillDef {
    id: string
    name: string
    /** What one rank does (multi-rank nodes stack) */
    description: string
    icon: string
    branch: RiftbornBranch
    /** 0 = root, 4 = deepest */
    row: number
    /** 0 left, 1 centre, 2 right within the branch */
    col: number
    maxRank: number
    /** Points per rank */
    cost: number
    /** Needs at least one rank in any of these */
    requires: string[]
    /** Keystones change how the game plays */
    keystone?: boolean
    apply(effects: RiftbornMetaEffects, rank: number): void
}

export const RIFTBORN_SKILLS: readonly RiftbornSkillDef[] = [
    // Fury
    { id: 'sharpened', name: 'Sharpened', description: '+6% damage', icon: 'i-lucide-sword', branch: 'fury', row: 0, col: 1, maxRank: 3, cost: 1, requires: [], apply: (e, r) => { e.damageMul += 0.06 * r } },
    { id: 'keenEye', name: 'Keen Eye', description: '+4% crit chance', icon: 'i-lucide-crosshair', branch: 'fury', row: 1, col: 0, maxRank: 3, cost: 1, requires: ['sharpened'], apply: (e, r) => { e.critChance += 0.04 * r } },
    { id: 'bloodlust', name: 'Bloodlust', description: '-10% cooldowns at 50+ combo', icon: 'i-lucide-droplet', branch: 'fury', row: 1, col: 2, maxRank: 2, cost: 1, requires: ['sharpened'], apply: (e, r) => { e.comboHaste += 0.1 * r } },
    { id: 'overkill', name: 'Overkill', description: '+50% crit damage, overkill splashes', icon: 'i-lucide-bomb', branch: 'fury', row: 2, col: 0, maxRank: 1, cost: 2, requires: ['keenEye'], keystone: true, apply: (e) => { e.critDamage += 0.5; e.overkill = true } },
    { id: 'executioner', name: 'Executioner', description: 'Hits kill enemies under 12% HP', icon: 'i-lucide-skull', branch: 'fury', row: 2, col: 2, maxRank: 1, cost: 2, requires: ['bloodlust'], keystone: true, apply: (e) => { e.executeThreshold = 0.12 } },
    { id: 'barrage', name: 'Barrage', description: '+1 projectile on every weapon', icon: 'i-lucide-sparkle', branch: 'fury', row: 3, col: 1, maxRank: 1, cost: 3, requires: ['overkill', 'executioner'], apply: (e) => { e.projectiles += 1 } },
    { id: 'berserker', name: 'Berserker', description: 'Up to +60% damage at low HP', icon: 'i-lucide-flame', branch: 'fury', row: 4, col: 0, maxRank: 1, cost: 2, requires: ['barrage'], keystone: true, apply: (e) => { e.berserk = true } },
    { id: 'glassCannon', name: 'Glass Cannon', description: '+40% damage, -30% max HP', icon: 'i-lucide-zap', branch: 'fury', row: 4, col: 2, maxRank: 1, cost: 2, requires: ['barrage'], keystone: true, apply: (e) => { e.damageMul += 0.4; e.hpMul -= 0.3 } },

    // Bulwark
    { id: 'thickSkin', name: 'Thick Skin', description: '+10% max HP', icon: 'i-lucide-heart', branch: 'bulwark', row: 0, col: 1, maxRank: 3, cost: 1, requires: [], apply: (e, r) => { e.hpMul += 0.1 * r } },
    { id: 'plating', name: 'Plating', description: '+1 armor', icon: 'i-lucide-shield', branch: 'bulwark', row: 1, col: 0, maxRank: 2, cost: 1, requires: ['thickSkin'], apply: (e, r) => { e.armor += r } },
    { id: 'mending', name: 'Mending', description: '+0.4 HP/s', icon: 'i-lucide-heart-pulse', branch: 'bulwark', row: 1, col: 2, maxRank: 3, cost: 1, requires: ['thickSkin'], apply: (e, r) => { e.regen += 0.4 * r } },
    { id: 'thorns', name: 'Thorns', description: 'Reflect 10x contact damage', icon: 'i-lucide-sprout', branch: 'bulwark', row: 2, col: 0, maxRank: 1, cost: 2, requires: ['plating'], keystone: true, apply: (e) => { e.thorns = 1 } },
    { id: 'vampiric', name: 'Vampiric', description: '+0.5 HP per kill', icon: 'i-lucide-droplets', branch: 'bulwark', row: 2, col: 2, maxRank: 1, cost: 2, requires: ['mending'], keystone: true, apply: (e) => { e.killHeal += 0.5 } },
    { id: 'secondWind', name: 'Second Wind', description: 'Revive once at 50% HP', icon: 'i-lucide-sunrise', branch: 'bulwark', row: 3, col: 1, maxRank: 1, cost: 3, requires: ['thorns', 'vampiric'], apply: (e) => { e.revivals += 1 } },
    { id: 'phaseStep', name: 'Phase Step', description: '-30% dash cooldown, +60% i-frames', icon: 'i-lucide-wind', branch: 'bulwark', row: 4, col: 0, maxRank: 1, cost: 2, requires: ['secondWind'], keystone: true, apply: (e) => { e.dashCooldownMul *= 0.7; e.dashIframeMul *= 1.6 } },
    { id: 'blinkDash', name: 'Blink', description: 'Dash teleports, blasts both ends', icon: 'i-lucide-orbit', branch: 'bulwark', row: 4, col: 2, maxRank: 1, cost: 2, requires: ['secondWind'], keystone: true, apply: (e) => { e.blinkDash = true } },

    // Fortune
    { id: 'magnetism', name: 'Magnetism', description: '+30% pickup range', icon: 'i-lucide-magnet', branch: 'fortune', row: 0, col: 1, maxRank: 2, cost: 1, requires: [], apply: (e, r) => { e.magnetMul += 0.3 * r } },
    { id: 'scholar', name: 'Scholar', description: '+8% experience', icon: 'i-lucide-book-open', branch: 'fortune', row: 1, col: 0, maxRank: 3, cost: 1, requires: ['magnetism'], apply: (e, r) => { e.xpMul += 0.08 * r } },
    { id: 'lucky', name: 'Lucky', description: 'Rarer level-up cards', icon: 'i-lucide-clover', branch: 'fortune', row: 1, col: 2, maxRank: 3, cost: 1, requires: ['magnetism'], apply: (e, r) => { e.luck += r } },
    { id: 'headStart', name: 'Head Start', description: 'Start with 2 level-ups', icon: 'i-lucide-rocket', branch: 'fortune', row: 2, col: 0, maxRank: 1, cost: 2, requires: ['scholar'], keystone: true, apply: (e) => { e.startLevel += 2 } },
    { id: 'treasureHunter', name: 'Treasure Hunter', description: '+1 reward in every chest', icon: 'i-lucide-gift', branch: 'fortune', row: 2, col: 2, maxRank: 1, cost: 2, requires: ['lucky'], keystone: true, apply: (e) => { e.chestBonus += 1 } },
    { id: 'fateWeaver', name: 'Fate Weaver', description: '+1 reroll, +15% ultimate charge', icon: 'i-lucide-refresh-cw', branch: 'fortune', row: 3, col: 1, maxRank: 2, cost: 1, requires: ['headStart', 'treasureHunter'], apply: (e, r) => { e.rerolls += r; e.ultChargeMul += 0.15 * r } },
    { id: 'magnetPulse', name: 'Gravity Well', description: 'Pull all XP every 20 s', icon: 'i-lucide-radar', branch: 'fortune', row: 4, col: 0, maxRank: 1, cost: 2, requires: ['fateWeaver'], keystone: true, apply: (e) => { e.magnetPulse = true } },
    { id: 'chainReaction', name: 'Chain Reaction', description: '12% of kills explode', icon: 'i-lucide-flame-kindling', branch: 'fortune', row: 4, col: 2, maxRank: 1, cost: 2, requires: ['fateWeaver'], keystone: true, apply: (e) => { e.deathExplosionChance += 0.12 } }
]

export type RiftbornSkillRanks = Record<string, number>

/** Drops unknown nodes and clamps ranks; does not check points or prerequisites. */
export function riftbornCleanSkills(raw: unknown): RiftbornSkillRanks {
    const ranks: RiftbornSkillRanks = {}
    if (!raw || typeof raw !== 'object') return ranks
    for (const def of RIFTBORN_SKILLS) {
        const value = Math.floor(Number((raw as Record<string, unknown>)[def.id] ?? 0))
        if (Number.isFinite(value) && value > 0) ranks[def.id] = Math.min(def.maxRank, value)
    }
    return ranks
}

export function riftbornSkillPointsSpent(ranks: RiftbornSkillRanks): number {
    return RIFTBORN_SKILLS.reduce((sum, def) => sum + (ranks[def.id] ?? 0) * def.cost, 0)
}

/** Why an allocation is invalid, or null when it is fine. */
export function riftbornSkillsError(ranks: RiftbornSkillRanks, points: number): string | null {
    for (const def of RIFTBORN_SKILLS) {
        if (!ranks[def.id] || def.requires.length === 0) continue
        if (!def.requires.some(id => (ranks[id] ?? 0) > 0)) return `${def.name} needs an earlier skill`
    }
    if (riftbornSkillPointsSpent(ranks) > points) return 'Not enough skill points'
    return null
}

export function riftbornMetaEffects(ranks: RiftbornSkillRanks): RiftbornMetaEffects {
    const effects = riftbornBaseEffects()
    for (const def of RIFTBORN_SKILLS) {
        const rank = ranks[def.id] ?? 0
        if (rank > 0) def.apply(effects, rank)
    }
    return effects
}

// ─── Account level ───────────────────────────────────────────────────────

export const RIFTBORN_MAX_LEVEL = 40

/** Rift XP from `level` to `level + 1` */
export function riftbornXpToNext(level: number): number {
    return 50 + 25 * level
}

export function riftbornLevelForXp(xp: number) {
    let level = 1
    let floor = 0
    while (level < RIFTBORN_MAX_LEVEL && xp >= floor + riftbornXpToNext(level)) {
        floor += riftbornXpToNext(level)
        level++
    }
    const next = level >= RIFTBORN_MAX_LEVEL ? null : riftbornXpToNext(level)
    return { level, xpIntoLevel: xp - floor, xpForNext: next }
}

// ─── Achievements ────────────────────────────────────────────────────────

export interface RiftbornAchievementContext {
    report: RiftbornRunReport
    classId: string
    /** Lifetime totals including this run */
    runsPlayed: number
    totalKills: number
    victories: number
    level: number
}

export interface RiftbornAchievementDef {
    id: string
    name: string
    description: string
    icon: string
    /** Bonus skill points */
    points: number
    /** Class it unlocks */
    unlocks?: RiftbornClassId
    check(ctx: RiftbornAchievementContext): boolean
}

export const RIFTBORN_ACHIEVEMENTS: readonly RiftbornAchievementDef[] = [
    { id: 'first-steps', name: 'First Steps', description: 'Finish your first run', icon: 'i-lucide-footprints', points: 1, check: c => c.runsPlayed >= 1 },
    { id: 'survivor', name: 'Survivor', description: 'Survive 5 minutes', icon: 'i-lucide-hourglass', points: 1, unlocks: 'ranger', check: c => c.report.time >= 300 },
    { id: 'slayer', name: 'Slayer', description: '1,000 kills in one run', icon: 'i-lucide-swords', points: 1, unlocks: 'pyromancer', check: c => c.report.kills >= 1000 },
    { id: 'boss-slayer', name: 'Giant Killer', description: 'Defeat a boss', icon: 'i-lucide-crown', points: 1, unlocks: 'stormcaller', check: c => c.report.bossKills >= 1 },
    { id: 'legion', name: 'Legion', description: '10,000 total kills', icon: 'i-lucide-skull', points: 1, unlocks: 'necromancer', check: c => c.totalKills >= 10000 },
    { id: 'riftbreaker', name: 'Riftbreaker', description: 'Win a run', icon: 'i-lucide-orbit', points: 2, unlocks: 'voidwalker', check: c => c.report.victory },
    { id: 'ascendant', name: 'Ascendant', description: 'Reach level 30 in one run', icon: 'i-lucide-trending-up', points: 1, check: c => c.report.level >= 30 },
    { id: 'marathon', name: 'Marathon', description: 'Survive 10 minutes', icon: 'i-lucide-timer', points: 1, check: c => c.report.time >= 600 },
    { id: 'massacre', name: 'Massacre', description: '3,000 kills in one run', icon: 'i-lucide-flame', points: 1, check: c => c.report.kills >= 3000 },
    { id: 'elite-hunter', name: 'Elite Hunter', description: '30 elite kills in one run', icon: 'i-lucide-target', points: 1, check: c => c.report.eliteKills >= 30 },
    { id: 'tyrant', name: 'Tyrant Slayer', description: '3 bosses in one run', icon: 'i-lucide-crown', points: 1, check: c => c.report.bossKills >= 3 },
    { id: 'veteran', name: 'Veteran', description: 'Play 25 runs', icon: 'i-lucide-medal', points: 1, check: c => c.runsPlayed >= 25 },
    { id: 'rift-lord', name: 'Rift Lord', description: 'Reach account level 20', icon: 'i-lucide-star', points: 1, check: c => c.level >= 20 },
    { id: 'exterminator', name: 'Exterminator', description: '50,000 total kills', icon: 'i-lucide-biohazard', points: 2, check: c => c.totalKills >= 50000 },
    { id: 'conqueror', name: 'Conqueror', description: 'Win 5 runs', icon: 'i-lucide-trophy', points: 2, check: c => c.victories >= 5 }
]

export function riftbornNewAchievements(have: readonly string[], ctx: RiftbornAchievementContext): RiftbornAchievementDef[] {
    return RIFTBORN_ACHIEVEMENTS.filter(a => !have.includes(a.id) && a.check(ctx))
}

export function riftbornUnlockedClasses(achievements: readonly string[]): RiftbornClassId[] {
    return RIFTBORN_CLASSES
        .filter(c => c.unlockedBy === null || achievements.includes(c.unlockedBy))
        .map(c => c.id)
}

/** Level-ups plus achievement points. */
export function riftbornSkillPoints(level: number, achievements: readonly string[]): number {
    return level - 1 + RIFTBORN_ACHIEVEMENTS
        .filter(a => achievements.includes(a.id))
        .reduce((sum, a) => sum + a.points, 0)
}

// ─── Run reports ─────────────────────────────────────────────────────────

/** What the client says happened. Every field is capped before it counts. */
export interface RiftbornRunReport {
    /** Seconds survived in game time */
    time: number
    kills: number
    eliteKills: number
    bossKills: number
    level: number
    /** Shard crystals picked up, each worth 1 Rift XP */
    shards: number
    victory: boolean
}

/** Most enemies a run can plausibly kill per second of play. */
const MAX_KILLS_PER_SECOND = 30
const MAX_ELITES_PER_SECOND = 1 / 8
const MAX_SHARDS_PER_SECOND = 1.5
/** Game time may run a touch ahead of the server's clock (latency, rounding). */
const CLOCK_GRACE_SECONDS = 5
/** The run goes on until the Rift Heart dies, so the final fight can outlast the clock. */
const MAX_OVERTIME_SECONDS = 10 * 60

export function riftbornSanitiseReport(raw: unknown, elapsedMs: number): RiftbornRunReport {
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const num = (value: unknown) => {
        const n = Math.floor(Number(value))
        return Number.isFinite(n) ? Math.max(0, n) : 0
    }
    const elapsed = Math.max(0, elapsedMs / 1000)
    const time = Math.min(num(body.time), Math.floor(elapsed + CLOCK_GRACE_SECONDS), RIFTBORN_RUN_SECONDS)
    // Rate caps use the time actually played, overtime included; only the
    // reported `time` stops at the run length.
    const played = Math.min(num(body.time), Math.floor(elapsed + CLOCK_GRACE_SECONDS), RIFTBORN_RUN_SECONDS + MAX_OVERTIME_SECONDS)
    const bossesReachable = RIFTBORN_BOSS_TIMES.filter(t => t <= time + CLOCK_GRACE_SECONDS).length
    const bossKills = Math.min(num(body.bossKills), bossesReachable)
    // The Rift Heart spawns at the last boss time; killing it is the victory,
    // even if an earlier boss is still alive.
    const victory = body.victory === true
        && time >= RIFTBORN_RUN_SECONDS - CLOCK_GRACE_SECONDS
        && bossKills >= 1
    return {
        time,
        kills: Math.min(num(body.kills), Math.floor(played * MAX_KILLS_PER_SECOND)),
        eliteKills: Math.min(num(body.eliteKills), Math.floor(played * MAX_ELITES_PER_SECOND)),
        bossKills,
        level: Math.min(num(body.level), 200),
        shards: Math.min(num(body.shards), Math.floor(played * MAX_SHARDS_PER_SECOND)),
        victory
    }
}

/** Rift XP a run earns. */
export function riftbornRunXp(report: RiftbornRunReport): number {
    return Math.floor(report.time / 6
        + report.kills / 25
        + report.eliteKills * 3
        + report.bossKills * 40
        + report.shards
        + (report.victory ? 150 : 0))
}
