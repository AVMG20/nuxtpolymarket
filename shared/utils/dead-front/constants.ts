import type { DfPlayerEffects } from './types'

// Dead Front tuning shared by server and client. Owned by the server agent
// after kickoff (see docs/dead-front.md); keep exports stable.

export const DF_TICK_HZ = 20
export const DF_SNAPSHOT_HZ = 20
/** Client interpolation delay for remote entities, in ms. */
export const DF_INTERP_DELAY_MS = 100
export const DF_MAX_PLAYERS = 4
export const DF_MAX_PERKS = 4
export const DF_MAX_ALIVE_ZOMBIES = 24
export const DF_INTERMISSION_SECONDS = 10

/** The classic points system: every non-lethal hit pays 10, kills pay by where they land. */
export const DF_POINTS = {
    hit: 10, // non-lethal bullet hit
    killBody: 60, // lethal body/limb hit (total for that hit)
    killHead: 100, // lethal headshot (total)
    killMelee: 130, // lethal knife (total)
    plank: 10, // per board repaired (capped per round)
    plankCapPerRound: 500,
    revive: 100,
    nuke: 400,
    startPoints: 500
} as const

export const DF_COSTS = {
    box: 950,
    /** Pack-a-Punch price per tier bought: index 0 buys tier 1, 1 buys tier 2, 2 buys tier 3. */
    pap: [5000, 15000, 30000],
    maxPap: 3,
    secondwindSolo: 500,
    /** Wall ammo for a Pack-a-Punched weapon. */
    papAmmo: 4500
} as const

/** Price to Pack-a-Punch a weapon currently at `currentTier` (0..2); null when it is maxed. */
export function dfPapCost(currentTier: number): number | null {
    const t = Math.max(0, Math.floor(currentTier))
    if (t >= DF_COSTS.maxPap) return null
    return DF_COSTS.pap[t] ?? null
}

/** Solo: Second Wind bottles the machine sells before it runs dry. */
export const DF_SOLO_SECONDWIND_MAX = 3

/** Seconds a revived or respawned player can't be hurt by zombies, to get their bearings. */
export const DF_REVIVE_GRACE = 1.5

export const DF_PLAYER = {
    radius: 0.35,
    height: 1.8,
    crouchHeight: 1.2,
    eyeHeight: 1.62,
    crouchEyeHeight: 1.05,
    stepHeight: 0.55, // one 0.5 m voxel step
    walkSpeed: 5,
    sprintSpeed: 7.6,
    crouchSpeed: 2.5,
    adsSpeed: 3,
    jumpVelocity: 4.6,
    gravity: 16,
    useRange: 2.2,
    reviveTime: 3,
    lastStandMinPoints: 0
} as const

export const DF_BASE_EFFECTS: DfPlayerEffects = {
    maxHealth: 150,
    regenDelay: 3.5,
    regenRate: 60,
    reloadMult: 1,
    fireRateMult: 1,
    damageMult: 1,
    headshotMult: 1,
    meleeMult: 1,
    moveMult: 1,
    sprintMult: 1,
    sprintDuration: 4,
    adsMult: 1,
    spreadMult: 1,
    recoilMult: 1,
    swapMult: 1,
    reviveMult: 1,
    bleedoutTime: 30,
    selfRevives: 0,
    explosiveResistMult: 1,
    pointsMult: 1,
    reserveAmmoMult: 1,
    killHeal: 0,
    reloadShock: 0,
    meleeLunge: 0,
    lastStandDamageMult: 1,
    ammoOnKillChance: 0,
    deathWish: false,
    doubleTapBullets: 0
}

export type DfPowerupKind = 'maxammo' | 'double' | 'insta' | 'nuke' | 'carpenter'

export const DF_POWERUP_SECONDS = 30
/** Seconds a dropped power-up stays on the ground. */
export const DF_POWERUP_LIFETIME = 25
/** Most power-ups that can drop in one round. */
export const DF_POWERUP_MAX_PER_ROUND = 4

/** Starting / max hand grenades; each round grants `grenadesPerRound`. */
export const DF_GRENADES = { start: 2, max: 4, perRound: 2, fuse: 2.5, radius: 5 } as const

/** Seconds a dropped connection keeps its player in the match. */
export const DF_RECONNECT_GRACE = 15

/** Mystery box and Pack-a-Punch timings in seconds. */
export const DF_MACHINE_TIMES = { boxRoll: 4, boxOffer: 10, boxMove: 6, papWork: 3.5, papOffer: 10 } as const

/** Knife: base damage, reach and cooldown. */
export const DF_MELEE = { damage: 150, range: 1.8, cooldown: 0.65 } as const

/** Kills that charge the Arc Generator (solo needs fewer). */
export const DF_EGG_CHARGE = { squad: 15, solo: 12 } as const

/** Seconds to throw every lightning rod once the first is thrown (a squad can split up, so it gets less). */
export const DF_EGG_ROD_TIME = { squad: 45, solo: 60 } as const
