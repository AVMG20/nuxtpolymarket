// Meadowbrawl — account meta-progression and the run economy.
//
// Shared verbatim by the client (lobby shop, in-run coin display, pet and
// homestead effects) and the server (authoritative prices, unlock gates,
// checkpoint validation and the payout ceiling). The ceiling functions are
// the whole anti-cheat story: the game itself drops coins straight out of
// the per-wave pools defined here, so a checkpoint or a finish report can
// never be credited with more coins than the waves it provably cleared
// could have dropped — a tampered client claiming ten billion gets the
// ceiling, not the ten billion.

// ---------------------------------------------------------------------------
// Weapons and unlocks
// ---------------------------------------------------------------------------

export type MeadowbrawlWeaponId = 'sword' | 'greataxe' | 'spear' | 'daggers' | 'warhammer' | 'scythe'

export const MEADOWBRAWL_WEAPON_IDS: MeadowbrawlWeaponId[] = ['sword', 'greataxe', 'spear', 'daggers', 'warhammer', 'scythe']

export interface MeadowbrawlWeaponUnlock {
    weapon: MeadowbrawlWeaponId
    /** Weapon the feat has to be performed with. */
    requires: MeadowbrawlWeaponId
    /** Waves that must be cleared (the elite on that wave slain) with `requires`. */
    clearWave: number
    title: string
    description: string
}

/**
 * Every weapon past the sword is gated behind a feat with the weapon before
 * it, so unlocking the full roster means playing every class at least once.
 * The waves line up with the elite cadence: clearing wave N means the elite
 * that walked in on wave N is dead.
 */
export const MEADOWBRAWL_WEAPON_UNLOCKS: MeadowbrawlWeaponUnlock[] = [
    { weapon: 'greataxe', requires: 'sword', clearWave: 4, title: 'Ogre Slayer', description: 'Slay the Bog Ogre (wave 4) with the Sword' },
    { weapon: 'spear', requires: 'greataxe', clearWave: 8, title: 'Warlord\'s Bane', description: 'Slay the Ashen Warlord (wave 8) with the Greataxe' },
    { weapon: 'daggers', requires: 'spear', clearWave: 10, title: 'Thorn Pruner', description: 'Slay the Briar Matriarch (wave 10) with the Spear' },
    { weapon: 'warhammer', requires: 'daggers', clearWave: 12, title: 'Giant Killer', description: 'Slay the second Bog Ogre (wave 12) with the Twin Daggers' },
    { weapon: 'scythe', requires: 'warhammer', clearWave: 14, title: 'Knightfall', description: 'Slay the Hollow Knight (wave 14) with the Warhammer' }
]

export type MeadowbrawlBestWaves = Partial<Record<MeadowbrawlWeaponId, number>>

/** Weapons the recorded feats have earned, the sword always included. */
export function meadowbrawlUnlockedWeapons(best: MeadowbrawlBestWaves, stored: string[] = []): MeadowbrawlWeaponId[] {
    const set = new Set<MeadowbrawlWeaponId>(['sword'])
    for (const id of stored) if (MEADOWBRAWL_WEAPON_IDS.includes(id as MeadowbrawlWeaponId)) set.add(id as MeadowbrawlWeaponId)
    for (const unlock of MEADOWBRAWL_WEAPON_UNLOCKS) {
        if ((best[unlock.requires] ?? 0) >= unlock.clearWave) set.add(unlock.weapon)
    }
    return MEADOWBRAWL_WEAPON_IDS.filter(id => set.has(id))
}

export function meadowbrawlIsWeaponId(value: unknown): value is MeadowbrawlWeaponId {
    return typeof value === 'string' && MEADOWBRAWL_WEAPON_IDS.includes(value as MeadowbrawlWeaponId)
}

// ---------------------------------------------------------------------------
// Homestead — permanent upgrades
// ---------------------------------------------------------------------------

export type MeadowbrawlUpgradeId = 'prosperity'

export interface MeadowbrawlUpgradeDef {
    id: MeadowbrawlUpgradeId
    name: string
    description: string
    icon: string
    max: number
    /** Price of level 1. Each further level multiplies by `growth`. */
    baseCost: number
    growth: number
}

export const MEADOWBRAWL_UPGRADES: MeadowbrawlUpgradeDef[] = [
    {
        id: 'prosperity',
        name: 'Prosperity',
        description: '+20% coin value per level — every coin a foe drops is worth more',
        icon: 'i-lucide-coins',
        max: 10,
        baseCost: 1_300_000,
        growth: 1.55
    }
]

export const MEADOWBRAWL_UPGRADE_IDS = MEADOWBRAWL_UPGRADES.map(def => def.id)

export type MeadowbrawlUpgradeLevels = Record<MeadowbrawlUpgradeId, number>

export const MEADOWBRAWL_EMPTY_LEVELS: MeadowbrawlUpgradeLevels = {
    prosperity: 0
}

/** Price of the next level, or null when the track is maxed. */
export function meadowbrawlUpgradeCost(def: MeadowbrawlUpgradeDef, level: number): number | null {
    if (level >= def.max) return null
    return Math.round(def.baseCost * Math.pow(def.growth, level))
}

export function meadowbrawlUpgradeById(id: unknown): MeadowbrawlUpgradeDef | null {
    return MEADOWBRAWL_UPGRADES.find(def => def.id === id) ?? null
}

// ---------------------------------------------------------------------------
// Pets
// ---------------------------------------------------------------------------

export type MeadowbrawlPetId = 'fox' | 'tortoise' | 'owl'

export const MEADOWBRAWL_PET_IDS: MeadowbrawlPetId[] = ['fox', 'tortoise', 'owl']

export const MEADOWBRAWL_PET_MAX_LEVEL = 10
/** Level at which each pet's first and second ability come online. */
export const MEADOWBRAWL_PET_ABILITY_LEVELS = [3, 6] as const

export interface MeadowbrawlPetAbilityDef {
    id: string
    name: string
    description: string
    /** Base cooldown in seconds at the unlock level; shrinks 4% per level after. */
    cooldown: number
}

export interface MeadowbrawlPetDef {
    id: MeadowbrawlPetId
    name: string
    tagline: string
    color: string
    /** Price of level 1 (adoption). Each further level multiplies by `growth`. */
    baseCost: number
    growth: number
    passive: { name: string, description: string }
    abilities: [MeadowbrawlPetAbilityDef, MeadowbrawlPetAbilityDef]
}

export const MEADOWBRAWL_PETS: MeadowbrawlPetDef[] = [
    {
        id: 'fox',
        name: 'Ember Fox',
        tagline: 'A quick red fox with a tail of live coals.',
        color: '#ff8a3c',
        baseCost: 1_000_000,
        growth: 1.5,
        passive: { name: 'Kindled', description: '+1.5% damage per level' },
        abilities: [
            { id: 'flameDash', name: 'Flame Dash', description: 'Dashes through the thickest knot of enemies, leaving a burning trail', cooldown: 11 },
            { id: 'cinderHowl', name: 'Cinder Howl', description: 'Howls and marks the toughest foe nearby — it takes 40% more damage for a few seconds', cooldown: 20 }
        ]
    },
    {
        id: 'tortoise',
        name: 'Moss Tortoise',
        tagline: 'Slow, ancient, and impossible to knock over.',
        color: '#7fbf6a',
        baseCost: 1_000_000,
        growth: 1.5,
        passive: { name: 'Shellbound', description: '+3 max health and 1% damage reduction per level' },
        abilities: [
            { id: 'shellWard', name: 'Shell Ward', description: 'Grants a ward that absorbs the next hit you would take', cooldown: 18 },
            { id: 'mendingBloom', name: 'Mending Bloom', description: 'When you drop below half health, blooms and mends you over four seconds', cooldown: 25 }
        ]
    },
    {
        id: 'owl',
        name: 'Moonlit Owl',
        tagline: 'Silent wings and an eye for anything shiny.',
        color: '#bfc9ff',
        baseCost: 1_000_000,
        growth: 1.5,
        passive: { name: 'Keen Eyes', description: '+1% coin value and +5% coin pickup radius per level' },
        abilities: [
            { id: 'gust', name: 'Gust', description: 'When you are surrounded, beats its wings and hurls nearby foes back', cooldown: 14 },
            { id: 'luckyFeather', name: 'Lucky Feather', description: 'Drops a feather; picking it up refunds half of your Q and E cooldowns and quickens you', cooldown: 30 }
        ]
    }
]

export type MeadowbrawlPetLevels = Partial<Record<MeadowbrawlPetId, number>>

export function meadowbrawlPetById(id: unknown): MeadowbrawlPetDef | null {
    return MEADOWBRAWL_PETS.find(def => def.id === id) ?? null
}

export function meadowbrawlIsPetId(value: unknown): value is MeadowbrawlPetId {
    return typeof value === 'string' && MEADOWBRAWL_PET_IDS.includes(value as MeadowbrawlPetId)
}

/** Price of the next pet level (level 1 adopts it), or null at the cap. */
export function meadowbrawlPetCost(def: MeadowbrawlPetDef, level: number): number | null {
    if (level >= MEADOWBRAWL_PET_MAX_LEVEL) return null
    return Math.round(def.baseCost * Math.pow(def.growth, level))
}

export function meadowbrawlClampPetLevel(level: unknown): number {
    const n = Math.floor(Number(level))
    if (!Number.isFinite(n)) return 0
    return Math.min(MEADOWBRAWL_PET_MAX_LEVEL, Math.max(0, n))
}

export interface MeadowbrawlPetEffects {
    id: MeadowbrawlPetId
    level: number
    /** Multiplier on player damage (fox). */
    damageMult: number
    /** Flat max-health bonus (tortoise). */
    maxHp: number
    /** Fraction of incoming damage removed (tortoise). */
    damageReduction: number
    /** Multiplier on coin value (owl) — folded into the run's coin multiplier. */
    coinMult: number
    /** Multiplier on coin pickup radius (owl). */
    pickupMult: number
    /** Abilities online at this level, with their cooldowns at this level. */
    abilities: { id: string, name: string, cooldown: number }[]
    /** Potency multiplier on the abilities: 1 at unlock, 2 at level 10. */
    potency: number
}

/** Ability cooldown at a level: the base at unlock, 4% shorter per level after. */
export function meadowbrawlPetCooldown(base: number, level: number, unlockLevel: number): number {
    return Math.round(base * Math.pow(0.96, Math.max(0, level - unlockLevel)) * 10) / 10
}

export function meadowbrawlPetEffects(id: MeadowbrawlPetId, level: number): MeadowbrawlPetEffects {
    const def = meadowbrawlPetById(id)!
    const lv = meadowbrawlClampPetLevel(level)
    const abilities = def.abilities
        .map((a, i) => ({ id: a.id, name: a.name, cooldown: meadowbrawlPetCooldown(a.cooldown, lv, MEADOWBRAWL_PET_ABILITY_LEVELS[i]!) }))
        .filter((_, i) => lv >= MEADOWBRAWL_PET_ABILITY_LEVELS[i]!)
    return {
        id,
        level: lv,
        damageMult: id === 'fox' ? 1 + lv * 0.015 : 1,
        maxHp: id === 'tortoise' ? lv * 3 : 0,
        damageReduction: id === 'tortoise' ? lv * 0.01 : 0,
        coinMult: id === 'owl' ? 1 + lv * 0.01 : 1,
        pickupMult: id === 'owl' ? 1 + lv * 0.05 : 1,
        abilities,
        potency: 1 + (lv >= MEADOWBRAWL_PET_MAX_LEVEL ? 1 : 0)
    }
}

// ---------------------------------------------------------------------------
// Account effects
// ---------------------------------------------------------------------------

/**
 * The account never buys power: nothing here changes how hard the waves
 * hit or what a run offers. Prosperity changes what a run is worth — the
 * pets are the only account-side help in a fight.
 */
export interface MeadowbrawlAccountEffects {
    /** Multiplier on every coin's value from Prosperity alone. */
    coinMult: number
}

export function meadowbrawlAccountEffects(levels: MeadowbrawlUpgradeLevels): MeadowbrawlAccountEffects {
    return {
        coinMult: 1 + levels.prosperity * 0.2
    }
}

/** Total price of every homestead level and every pet level — the account's sink ceiling. */
export function meadowbrawlTotalUpgradeCost(): number {
    let total = 0
    for (const def of MEADOWBRAWL_UPGRADES) {
        for (let level = 0; level < def.max; level++) total += meadowbrawlUpgradeCost(def, level)!
    }
    for (const pet of MEADOWBRAWL_PETS) {
        for (let level = 0; level < MEADOWBRAWL_PET_MAX_LEVEL; level++) total += meadowbrawlPetCost(pet, level)!
    }
    return total
}

// ---------------------------------------------------------------------------
// Coins — the run economy
// ---------------------------------------------------------------------------

export const MEADOWBRAWL_TOTAL_WAVES = 30

/**
 * Elites per wave. Mirrors the engine's elite cadence exactly (there is a
 * test pinning the two together) so the coin ceiling knows how many elite
 * bounties a cleared wave could have dropped.
 */
export function meadowbrawlEliteCount(wave: number): number {
    if (wave === MEADOWBRAWL_TOTAL_WAVES) return 3
    if (wave === 10 || wave === 14) return 1
    if (wave === 22 || wave === 26) return 2
    if (wave % 4 !== 0) return 0
    return wave >= 16 ? 2 : 1
}

/**
 * Base coins the regular enemies of a wave drop between them when every one
 * of them dies. The engine hands each enemy its share by budget weight, so
 * a fully cleared wave adds up to exactly this (give or take rounding).
 */
export function meadowbrawlWaveCoinPool(wave: number): number {
    return 800 + 240 * wave + 12 * wave * wave
}

/** Base coins one elite drops on the wave it appears. */
export function meadowbrawlEliteCoinBonus(wave: number): number {
    return 1500 + 250 * wave
}

/**
 * The most base coins a run can have picked up by the end of `wave`
 * (inclusive). A small slack covers rounding in the per-enemy split.
 */
export function meadowbrawlCoinCeiling(wave: number): number {
    const w = Math.min(MEADOWBRAWL_TOTAL_WAVES, Math.max(0, Math.floor(wave)))
    let total = 0
    for (let i = 1; i <= w; i++) total += meadowbrawlWaveCoinPool(i) + meadowbrawlEliteCount(i) * meadowbrawlEliteCoinBonus(i)
    return Math.round(total * 1.02)
}

/**
 * Seconds a wave's spawns are spread across in the engine. A wave cannot end
 * before its last spawn walks in, so the wall clock puts a floor under how
 * fast waves can honestly be cleared.
 */
export function meadowbrawlWaveSpawnSpan(wave: number): number {
    return Math.min(24, 9 + wave * 0.9)
}

/** Grace on the pacing floor, so a fast honest run is never rejected. */
const PACING_SLACK = 0.55

/** Wall-clock milliseconds a run needs at minimum to have cleared `wave`. */
export function meadowbrawlMinElapsedMsForWave(wave: number): number {
    let seconds = 0
    for (let i = 1; i <= wave; i++) seconds += meadowbrawlWaveSpawnSpan(i)
    return Math.round(seconds * PACING_SLACK * 1000)
}

/**
 * Two hours between runs. Dev override: `MEADOWBRAWL_COOLDOWN_MS` in `.env`
 * — `0` disables it, any other number shortens it, unset keeps the default.
 */
export const MEADOWBRAWL_RUN_COOLDOWN_MS = (() => {
    const raw = typeof process !== 'undefined' ? process.env?.MEADOWBRAWL_COOLDOWN_MS : undefined
    if (raw === undefined || raw === '') return 2 * 60 * 60 * 1000
    const override = Number(raw)
    return Number.isFinite(override) ? Math.max(0, override) : 2 * 60 * 60 * 1000
})()

/** One gem buys ten minutes off the cooldown — twelve gems for a full one. */
export const MEADOWBRAWL_RUSH_MS_PER_GEM = 10 * 60 * 1000

export function meadowbrawlRunCooldownRemainingMs(lastRunFinishedAt: Date | null, now: number): number {
    if (!lastRunFinishedAt) return 0
    return Math.max(0, lastRunFinishedAt.getTime() + MEADOWBRAWL_RUN_COOLDOWN_MS - now)
}

export function meadowbrawlRushGemCost(remainingMs: number): number {
    return Math.max(0, Math.ceil(Math.max(0, remainingMs) / MEADOWBRAWL_RUSH_MS_PER_GEM))
}

/** Bonus on top of the coins for surviving all thirty waves. */
export const MEADOWBRAWL_VICTORY_BONUS = 1.25
/** Absolute payout ceiling — the most one run can ever pay. */
export const MEADOWBRAWL_MAX_PAYOUT = 2_000_000

export interface MeadowbrawlPayout {
    /** Cash credited. */
    awarded: number
    /** Base coins after the ceiling — what the multiplier was applied to. */
    counted: number
    /** True when the reported coins were cut down by the ceiling. */
    capped: boolean
}

/**
 * Converts a finished run into cash. `reportedCoins` is the client's base
 * coin count; `wavesCleared` is the depth the server can vouch for.
 */
export function meadowbrawlPayoutForRun(reportedCoins: number, wavesCleared: number, coinMult: number, won: boolean): MeadowbrawlPayout {
    const coins = Math.max(0, Math.floor(Number(reportedCoins) || 0))
    // The wave in progress drops coins too, so the ceiling is one wave past
    // the last one that was provably cleared.
    const ceiling = meadowbrawlCoinCeiling(won ? MEADOWBRAWL_TOTAL_WAVES : wavesCleared + 1)
    const counted = Math.min(coins, ceiling)
    const mult = Math.max(1, Number(coinMult) || 1) * (won ? MEADOWBRAWL_VICTORY_BONUS : 1)
    const awarded = Math.min(MEADOWBRAWL_MAX_PAYOUT, Math.floor(counted * mult))
    return { awarded, counted, capped: counted < coins }
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

export const MEADOWBRAWL_SAVE_VERSION = 1
/** Boons on offer after every wave. */
export const MEADOWBRAWL_OFFER_COUNT = 3

export interface MeadowbrawlRunSave {
    version: number
    /** Waves cleared so far — the run resumes at the start of `wave + 1`. */
    wave: number
    hp: number
    maxHp: number
    /** Boon stacks by upgrade id. */
    upgrades: Record<string, number>
    /** Boon ids still on offer for this wave, or null once one was picked. */
    offers: string[] | null
    /** Base coins collected. */
    coins: number
    phoenixUsed: number
    stats: {
        kills: number
        elitesKilled: number
        damageDealt: number
        damageTaken: number
        highestCombo: number
        time: number
    }
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

function isCount(value: unknown, max = 1_000_000): value is number {
    return isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= max
}

const ID_PATTERN = /^[a-z][a-z0-9]{0,31}$/

/**
 * Structural validation of a checkpoint. Only what the server relies on is
 * checked strictly (the wave, the coins, the boon count); the rest just has
 * to be the shape the game writes, since a nonsense hp value only ever
 * hurts the player who sent it.
 */
export function meadowbrawlValidateSave(save: unknown): save is MeadowbrawlRunSave {
    if (!save || typeof save !== 'object') return false
    const s = save as Record<string, unknown>
    if (s.version !== MEADOWBRAWL_SAVE_VERSION) return false
    if (!isCount(s.wave, MEADOWBRAWL_TOTAL_WAVES - 1) || s.wave < 1) return false
    if (!isFiniteNumber(s.hp) || !isFiniteNumber(s.maxHp) || s.maxHp < 1 || s.maxHp > 5000 || s.hp < 0 || s.hp > s.maxHp) return false
    if (!s.upgrades || typeof s.upgrades !== 'object' || Array.isArray(s.upgrades)) return false
    let stacks = 0
    for (const [id, count] of Object.entries(s.upgrades as Record<string, unknown>)) {
        if (!ID_PATTERN.test(id) || !isCount(count, 100)) return false
        stacks += count
    }
    if (s.offers !== null) {
        if (!Array.isArray(s.offers) || s.offers.length < 1 || s.offers.length > MEADOWBRAWL_OFFER_COUNT) return false
        if (!s.offers.every(id => typeof id === 'string' && ID_PATTERN.test(id))) return false
    }
    // One boon per cleared wave: the pick for this wave is pending while
    // offers are still up, taken once they are gone.
    const picks = s.offers === null ? s.wave : s.wave - 1
    if (stacks > picks) return false
    if (!isCount(s.coins, 100_000_000)) return false
    if (!isCount(s.phoenixUsed, 100)) return false
    const st = s.stats as Record<string, unknown> | undefined
    if (!st || typeof st !== 'object') return false
    if (!isCount(st.kills, 100_000) || !isCount(st.elitesKilled, 1000) || !isCount(st.highestCombo, 100_000)) return false
    if (!isFiniteNumber(st.damageDealt) || !isFiniteNumber(st.damageTaken) || !isFiniteNumber(st.time)) return false
    if (st.damageDealt < 0 || st.damageTaken < 0 || st.time < 0) return false
    return true
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export interface MeadowbrawlSettlementState {
    runWeapon: string | null
    runCoinMult: string | null
    runSave: MeadowbrawlRunSave | null
    runsPlayed: number
    victories: number
    totalEarned: string
    bestEarned: number
    bestWave: number
    bestWaveByWeapon: Record<string, number>
    unlockedWeapons: string[]
}

export interface MeadowbrawlRunReport {
    /** Wave the player died on (or 30 when won). Client's word, clamped by the checkpoint. */
    wave: number
    /** Base coins collected, client's word, clamped by the ceiling. */
    coins: number
    won: boolean
    /** True when the run is settled from its checkpoint alone (abandoned). */
    abandoned: boolean
}

/**
 * Turns a finished run into the row update, the payout and the unlocks it
 * should leave behind. Depth is capped by the last checkpoint the server
 * saw (every cleared wave writes one), and a win needs a checkpoint at the
 * doorstep of the last wave; the coin ceiling then follows from the depth.
 */
export function meadowbrawlSettleRun(state: MeadowbrawlSettlementState, report: MeadowbrawlRunReport, elapsedMs: number) {
    const weapon: MeadowbrawlWeaponId = meadowbrawlIsWeaponId(state.runWeapon) ? state.runWeapon : 'sword'
    const coinMult = Number(state.runCoinMult ?? '1') || 1
    const checkpoint = state.runSave?.wave ?? 0
    const claimedCleared = report.won
        ? MEADOWBRAWL_TOTAL_WAVES
        : Math.max(0, Math.min(MEADOWBRAWL_TOTAL_WAVES, Math.floor(Number(report.wave) || 0)) - 1)
    let cleared = report.abandoned ? checkpoint : Math.min(claimedCleared, checkpoint + 1)
    // Clearing the last wave writes no checkpoint (the run ends instead), so
    // a win is vouched for by a checkpoint at wave 29 and an honest clock.
    let won = report.won && !report.abandoned && checkpoint >= MEADOWBRAWL_TOTAL_WAVES - 1
    if (elapsedMs < meadowbrawlMinElapsedMsForWave(cleared)) {
        cleared = checkpoint
        won = false
    }
    const coins = report.abandoned ? (state.runSave?.coins ?? 0) : report.coins
    const payout = meadowbrawlPayoutForRun(coins, cleared, coinMult, won)

    const bestWaveByWeapon = { ...state.bestWaveByWeapon, [weapon]: Math.max(state.bestWaveByWeapon[weapon] ?? 0, cleared) }
    const before = meadowbrawlUnlockedWeapons(state.bestWaveByWeapon, state.unlockedWeapons)
    const unlockedWeapons = meadowbrawlUnlockedWeapons(bestWaveByWeapon, state.unlockedWeapons)
    const newlyUnlocked = unlockedWeapons.filter(id => !before.includes(id))

    return {
        ...payout,
        weapon,
        cleared,
        won,
        coinMult,
        runsPlayed: state.runsPlayed + 1,
        victories: state.victories + (won ? 1 : 0),
        totalEarned: (Number(state.totalEarned) + payout.awarded).toFixed(4),
        bestEarned: Math.max(state.bestEarned, payout.awarded),
        bestWave: Math.max(state.bestWave, cleared),
        bestWaveByWeapon,
        unlockedWeapons,
        newlyUnlocked
    }
}
