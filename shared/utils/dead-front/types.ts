// Dead Front: core types shared by the server simulation, the client engine
// and the progression endpoints. This file is the contract between modules
// (see docs/dead-front.md). Changes must stay additive.

export interface Vec3 {
    x: number
    y: number
    z: number
}

export type DfWeaponId
    = | 'm1911' // starter pistol, PaP turns it into twin grenade launchers
        | 'c96' // Mauser C96 broomhandle
        | 'm1897' // Winchester trench shotgun
        | 'kar98k' // bolt-action rifle
        | 'thompson' // M1921 drum SMG
        | 'mp18' // Bergmann SMG
        | 'ppsh' // PPSh-41 drum SMG, mystery box only
        | 'bar' // M1918 automatic rifle
        | 'lewis' // Lewis LMG
        | 'xray' // the X-Ray: a 1900s brass-and-valve ray pistol, mystery box only
        | 'wunder' // the map's wunderweapon, easter egg only

export type DfWeaponClass = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'lmg' | 'special'

export type DfAttachmentSlot = 'optic' | 'muzzle' | 'magazine' | 'stock'

export type DfAttachmentId = string

/** Attachments picked for each weapon, applied whenever that weapon is held in a match. */
export type DfAttachmentChoice = Partial<Record<DfAttachmentSlot, DfAttachmentId>>

export interface DfLoadout {
    /** The weapon a player spawns with. Must be unlocked, never `xray` or `wunder`. */
    startWeapon: DfWeaponId
    attachments: Partial<Record<DfWeaponId, DfAttachmentChoice>>
}

export type DfPerkId
    = | 'ironhide' // more health
        | 'quickhand' // faster reload
        | 'twinfire' // faster fire rate
        | 'secondwind' // revive / self-revive
        | 'fleetfoot' // movement and sprint
        | 'steadyeye' // aim and headshots

export type DfEnemyType = 'shambler' | 'ghoul' | 'brute' | 'bloater'

export type DfHitZone = 'head' | 'body' | 'limb'

/**
 * Every in-match stat a perk or perk modifier may touch. Base values come from
 * DF_BASE_EFFECTS (constants.ts). Perks and modifiers express themselves only
 * through these fields; the server simulation implements every field, the
 * client engine mirrors the ones it needs for feel (reload, ADS, movement).
 *
 * Fields ending in `Mult` are multipliers (combine by multiplying). All other
 * numeric fields combine by adding. Booleans combine with OR.
 */
export interface DfPlayerEffects {
    maxHealth: number // hit points, base 150; a zombie swipe is ~50
    regenDelay: number // seconds without damage before regen starts
    regenRate: number // hp per second while regenerating
    reloadMult: number // >1 reloads faster
    fireRateMult: number // >1 fires faster
    damageMult: number // all weapon damage
    headshotMult: number // extra multiplier on head hits
    meleeMult: number // knife damage
    moveMult: number // walk/run speed
    sprintMult: number // sprint speed on top of moveMult
    sprintDuration: number // seconds of sprint before tiring
    adsMult: number // >1 aims down sights faster
    spreadMult: number // <1 tighter hip/ADS spread
    recoilMult: number // <1 less recoil (client feel)
    swapMult: number // >1 swaps weapons faster
    reviveMult: number // >1 revives teammates faster
    bleedoutTime: number // seconds before a downed player dies
    selfRevives: number // self-revives granted (each used once per match)
    explosiveResistMult: number // fraction of explosive self/enemy damage taken (1 = full)
    pointsMult: number // points earned
    reserveAmmoMult: number // max reserve ammo
    killHeal: number // hp restored on each kill
    reloadShock: number // damage of an electric burst (radius 3m) on an empty reload; 0 = off
    meleeLunge: number // extra metres of knife lunge
    lastStandDamageMult: number // weapon damage while downed
    ammoOnKillChance: number // 0..1 chance a kill refunds one round into the magazine
    deathWish: boolean // a lethal hit at full health leaves 1 hp instead (once per round)
    doubleTapBullets: number // extra bullets per shot (each deals 30% damage)
}

export interface DfProfileView {
    unlockedWeapons: DfWeaponId[]
    weaponXp: Partial<Record<DfWeaponId, number>>
    loadout: DfLoadout
    researchPerk: DfPerkId | null
    perkXp: Partial<Record<DfPerkId, number>>
    /** Up to two selected modifier ids per perk, active whenever that perk is bought in a match. */
    perkMods: Partial<Record<DfPerkId, string[]>>
    gamesPlayed: number
    bestRound: number
    totalKills: number
    eggsCompleted: number
}

/** What a single player earned in one match, written once when they leave or the match ends. */
export interface DfMatchResult {
    roundsSurvived: number
    kills: number
    headshots: number
    downs: number
    /** Kills per weapon, used for weapon XP. */
    weaponKills: Partial<Record<DfWeaponId, number>>
    /** Weapons picked up from a wall-buy, the mystery box or the easter egg. Unlocked permanently. */
    weaponsFound: DfWeaponId[]
    completedEasterEgg: boolean
}

/** Per-player progression delta reported back in the end screen. */
export interface DfProgressReport {
    perk: DfPerkId | null
    perkXpGained: number
    perkLevelBefore: number
    perkLevelAfter: number
    weaponXpGained: Partial<Record<DfWeaponId, number>>
    weaponLevelsUp: Partial<Record<DfWeaponId, number>>
    newWeapons: DfWeaponId[]
}

/** The guided easter egg. The HUD shows `text` for the current step and points to the target. */
export type DfEggStep
    = | 'power' // turn on the power
        | 'fuses' // recover the three Tesla fuses
        | 'install' // place them in the arc generator
        | 'charge' // kill zombies near the charged generator
        | 'rods' // throw the three lightning-rod switches before the timer runs out
        | 'claim' // take the wunderweapon from the pedestal
        | 'done'

export const DF_EGG_STEPS: { id: DfEggStep, text: string }[] = [
    { id: 'power', text: 'Restore the power' },
    { id: 'fuses', text: 'Recover the Tesla fuses' },
    { id: 'install', text: 'Install the fuses in the Arc Generator' },
    { id: 'charge', text: 'Feed the generator: kill zombies near it' },
    { id: 'rods', text: 'Ground the Arc: throw the three lightning-rod switches' },
    { id: 'claim', text: 'Claim the wonder weapon' },
    { id: 'done', text: 'The Arc Generator is spent' }
]
