import type { DfWeaponClass, DfWeaponId } from './types'

// Gunplay rules shared by the server (authoritative) and the client
// (prediction, sounds and effects): Pack-a-Punch perks per weapon and the
// shotgun's close-range blast. Pure and unit tested.
//
// Stat changes a perk brings (a one-motion reload, a faster speedloader) live
// in `PAP_OVERRIDES` (weapons.ts), so the server and the client time them the
// same way; the effects below (burning, bursts, chain lightning, stagger) are
// resolved by the server on the hits it takes.

export type DfPapPerkId
    = | 'twin' // M1911: twin grenade-launcher pistols
        | 'schnell' // C96: full auto
        | 'speedload' // all rounds in one motion, much faster
        | 'quadload' // a shotgun loads every shell in one motion
        | 'autoload' // the pump cycles itself
        | 'stopping' // every hit staggers the zombie
        | 'dragon' // pellets / rounds set zombies on fire
        | 'blast' // kills burst, hurting the zombies around
        | 'chain' // every few hits arc lightning to nearby zombies
        | 'beltfed' // a much faster pan or box change
        | 'napalm' // fire that clings and burns longer
        | 'ray' // X-Ray: bigger, hotter bolts
        | 'storm' // the wunderweapon: longer chains, a shock blast

export interface DfPapPerkDef {
    id: DfPapPerkId
    name: string
    /** One short line for the HUD and the armory. */
    description: string
}

export const DF_PAP_PERKS: Record<DfPapPerkId, DfPapPerkDef> = {
    twin: { id: 'twin', name: 'Twin Launchers', description: 'A grenade-launcher pistol in each hand' },
    schnell: { id: 'schnell', name: 'Schnellfeuer', description: 'Full auto' },
    speedload: { id: 'speedload', name: 'Speedloader', description: 'Every round goes in at once' },
    quadload: { id: 'quadload', name: 'Quad Load', description: 'Every shell goes in at once' },
    autoload: { id: 'autoload', name: 'Self-Loading', description: 'The pump cycles itself' },
    stopping: { id: 'stopping', name: 'Stopping Power', description: 'Every hit staggers' },
    dragon: { id: 'dragon', name: 'Dragon\'s Breath', description: 'Hits set zombies on fire' },
    blast: { id: 'blast', name: 'Blast Rounds', description: 'Kills burst and hurt the pack around them' },
    chain: { id: 'chain', name: 'Chain Lightning', description: 'Every few hits arc to the zombies around' },
    beltfed: { id: 'beltfed', name: 'Quick Change', description: 'Much faster reloads' },
    napalm: { id: 'napalm', name: 'Napalm', description: 'Fire clings and burns twice as long' },
    ray: { id: 'ray', name: 'Overcharged', description: 'Bigger, hotter bolts' },
    storm: { id: 'storm', name: 'Storm Coil', description: 'Longer chains that end in a shock blast' }
}

/** Perks each Pack-a-Punch tier adds, cumulative: tier 2 keeps tier 1's. */
const PAP_PERK_TIERS: Partial<Record<DfWeaponId, [DfPapPerkId[], DfPapPerkId[], DfPapPerkId[]]>> = {
    m1911: [['twin'], [], []],
    c96: [['schnell'], [], ['blast']],
    webley: [['speedload'], ['stopping'], ['blast']],
    m1897: [['quadload'], ['dragon'], ['autoload']],
    sawnoff: [['dragon'], ['stopping'], ['blast']],
    kar98k: [['blast'], [], ['chain']],
    win1895: [['chain'], [], ['blast']],
    thompson: [['stopping'], ['chain'], []],
    mp18: [['dragon'], [], ['chain']],
    ppsh: [['beltfed'], ['chain'], []],
    bar: [['stopping'], ['blast'], []],
    lewis: [['beltfed'], ['dragon'], []],
    chauchat: [['blast'], ['stopping'], []],
    flammen: [['napalm'], [], []],
    xray: [['ray'], [], []],
    wunder: [[], ['storm'], []]
}

function tierOf(pap: number): number {
    return Math.max(0, Math.min(3, Math.floor(Number.isFinite(pap) ? pap : 0)))
}

/** Every perk a weapon has at a Pack-a-Punch tier (0..3), in the order they came. */
export function dfPapPerks(id: DfWeaponId, pap: number): DfPapPerkId[] {
    const tiers = PAP_PERK_TIERS[id]
    if (!tiers) return []
    const out: DfPapPerkId[] = []
    for (let t = 0; t < tierOf(pap); t++) out.push(...tiers[t]!)
    return out
}

/** The perks a tier brings on its own (what the Pack-a-Punch announces). */
export function dfPapNewPerks(id: DfWeaponId, pap: number): DfPapPerkId[] {
    const t = tierOf(pap)
    return t > 0 ? [...(PAP_PERK_TIERS[id]?.[t - 1] ?? [])] : []
}

export function dfHasPapPerk(id: DfWeaponId, pap: number, perk: DfPapPerkId): boolean {
    return dfPapPerks(id, pap).includes(perk)
}

// ---------------------------------------------------------------- perk effects

/**
 * Burning: a hit hands the zombie a fire that deals `share` of the hit's
 * damage again over `seconds`, in `tick` pulses. A stronger fire replaces a
 * weaker one; burn hits pay no +10, a burn kill pays the kill.
 */
export const DF_BURN = { seconds: 2.5, share: 0.45, tick: 0.5 } as const

/** Seconds a fire lasts from a weapon with these perks. */
export function dfBurnSeconds(id: DfWeaponId, pap: number): number {
    return DF_BURN.seconds * (dfHasPapPerk(id, pap, 'napalm') ? 2 : 1)
}

/** Damage per second of a fire lit by a hit of `dmg`. */
export function dfBurnDps(dmg: number): number {
    return Math.max(0, dmg) * DF_BURN.share / DF_BURN.seconds
}

/** Does a weapon light zombies on fire? (Its flame always does when packed; `dragon` rounds do.) */
export function dfIgnites(id: DfWeaponId, pap: number): boolean {
    return dfHasPapPerk(id, pap, 'dragon') || dfHasPapPerk(id, pap, 'napalm')
}

/** Blast rounds: a kill bursts for `share` of one hit's damage within `radius`, at most `max` bursts a shot. */
export const DF_KILL_BURST = { radius: 2.6, share: 0.7, max: 3 } as const

/** Chain lightning: every `every`th shot that hits arcs to `jumps` zombies within `range`, each for `share` of a hit. */
export const DF_CHAIN = { every: 4, jumps: 3, range: 6.5, share: 0.6 } as const

/** Does shot number `n` (1-based, counting shots that hit) of a chain weapon arc? */
export function dfChainFires(n: number): boolean {
    return n > 0 && n % DF_CHAIN.every === 0
}

// ---------------------------------------------------------------- shotgun blast

/**
 * A shotgun up close throws a zombie back or blows it apart: at most `range`
 * metres with at least `share` of the shot's pellets in it, a kill gibs and a
 * survivor staggers (brutes only stagger from a full blast).
 */
export const DF_SHOTGUN_BLAST = { range: 4.5, share: 0.45, bruteShare: 0.8 } as const

export type DfBlastResult = 'gib' | 'stagger' | null

/**
 * The blast of one shotgun shot on one zombie: `hit` pellets of `pellets` at
 * `dist` metres. `kill` is whether the shot killed it.
 */
export function dfShotgunBlast(cls: DfWeaponClass | undefined, hit: number, pellets: number, dist: number, kill: boolean, brute = false): DfBlastResult {
    if (cls !== 'shotgun' || pellets < 3 || !(dist <= DF_SHOTGUN_BLAST.range)) return null
    const share = hit / pellets
    if (share < DF_SHOTGUN_BLAST.share) return null
    if (kill) return 'gib'
    if (brute && share < DF_SHOTGUN_BLAST.bruteShare) return null
    return 'stagger'
}
