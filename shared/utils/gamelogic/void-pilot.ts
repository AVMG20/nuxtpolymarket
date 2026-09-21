// ─── Void Runner: pilot meta ────────────────────────────────────────────────
//
// Things that belong to the pilot rather than the ship:
// - Command Marks, a rare currency earned by killing wardens, carriers and
//   pushing deep through jump chains, spent on permanent perks.
// - Blueprints, rare finds that let the Workshop build MkII gear.
// - Lore: data logs recovered from derelicts, collected into the Codex.
// - Zone modifiers offered at every warp gate.

import type { VoidItemKind } from './void-items'

// ─── Perks ──────────────────────────────────────────────────────────────────

export type VoidPerkId = 'harness' | 'frame' | 'capacitor' | 'quartermaster' | 'revive' | 'scanner' | 'relics' | 'tanks' | 'salvager' | 'link'

export interface VoidPerkDefinition {
    id: VoidPerkId
    name: string
    description: string
    icon: string
    /** Command Marks per rank; the length is the max rank. */
    costs: number[]
    effect: (rank: number) => string
}

export const VOID_PERKS: VoidPerkDefinition[] = [
    { id: 'harness', name: 'Cargo Harness', description: 'Stow more in every hold.', icon: 'i-lucide-package', costs: [2, 4, 8], effect: r => `+${r * 8}% hold` },
    { id: 'frame', name: 'Reinforced Frame', description: 'Extra bracing on every hull.', icon: 'i-lucide-shield-half', costs: [2, 4, 8], effect: r => `+${r * 6}% hull` },
    { id: 'capacitor', name: 'Capacitor Tuning', description: 'Squeeze more out of shield generators.', icon: 'i-lucide-shield', costs: [2, 4, 8], effect: r => `+${r * 6}% shield` },
    { id: 'salvager', name: 'Salvager', description: 'Pull more scrap and alloy from kills and crates.', icon: 'i-lucide-recycle', costs: [3, 6], effect: r => `+${r * 15}% salvage` },
    { id: 'scanner', name: 'Deep Scanner', description: 'A wider, faster scan pulse.', icon: 'i-lucide-radar', costs: [3], effect: r => (r ? '+50% range, -30% cooldown' : 'Stock scanner') },
    { id: 'tanks', name: 'Extended Tanks', description: 'Launch with extra jump fuel.', icon: 'i-lucide-fuel', costs: [3, 6], effect: r => `+${r} fuel cell${r === 1 ? '' : 's'} at launch` },
    { id: 'link', name: 'Tactical Link', description: 'Faster pilot skill recharge.', icon: 'i-lucide-zap', costs: [4, 8], effect: r => `-${r * 8}% skill cooldown` },
    { id: 'relics', name: 'Relic Hunter', description: 'Relic caches turn up more often.', icon: 'i-lucide-gem', costs: [4, 8], effect: r => `+${r * 40}% relic drops` },
    { id: 'quartermaster', name: 'Quartermaster', description: 'The station stocks supplies for you at a discount.', icon: 'i-lucide-shopping-cart', costs: [5], effect: r => (r ? '-25% supply cost' : 'Full price') },
    { id: 'revive', name: 'Second Chance', description: 'Once per run, a fatal hit leaves you at 30% hull instead.', icon: 'i-lucide-heart-pulse', costs: [8], effect: r => (r ? 'One revive per run' : 'No revive') }
]

export const VOID_PERK_IDS: VoidPerkId[] = VOID_PERKS.map(p => p.id)

export type VoidPerkRanks = Record<VoidPerkId, number>

export function voidNormalizePerks(raw: Record<string, unknown> | null | undefined): VoidPerkRanks {
    const out = {} as VoidPerkRanks
    for (const perk of VOID_PERKS) out[perk.id] = Math.max(0, Math.min(perk.costs.length, Math.floor(Number(raw?.[perk.id]) || 0)))
    return out
}

export function voidPerkCost(id: VoidPerkId, rank: number) {
    return VOID_PERKS.find(p => p.id === id)?.costs[rank] ?? null
}

// ─── Marks and blueprints ───────────────────────────────────────────────────

export interface VoidRunTrophies {
    extracted: boolean
    wardenKilled: boolean
    carrierKilled: boolean
    tyrantKilled?: boolean
    harbingerKilled?: boolean
    depth: number
    elapsedMs: number
}

/**
 * Boss kills and jumps are client claims. Nobody finds and kills a boss or
 * clears a jump in under ten seconds, so that is all the server asks for:
 * real runs last one to five minutes and must never be short-changed.
 */
export const VOID_MIN_CLAIM_MS = 10_000

/** The Harbinger only exists past a jump. */
export function voidCapitalKills(run: { carrierKilled?: boolean, tyrantKilled?: boolean, harbingerKilled?: boolean, depth?: number }, elapsedMs: number) {
    const long = elapsedMs >= VOID_MIN_CLAIM_MS
    return {
        carrier: Boolean(run.carrierKilled) && long,
        tyrant: Boolean(run.tyrantKilled) && long,
        harbinger: Boolean(run.harbingerKilled) && long && voidAllowedDepth(run.depth ?? 1, elapsedMs) >= 2
    }
}

/**
 * Command Marks for a finished run. Only extractions pay. A carrier kill is a
 * client claim, so it needs a run long enough to have found and fought one.
 */
export function voidRunMarks(run: VoidRunTrophies) {
    if (!run.extracted) return 0
    let marks = 0
    const capitals = voidCapitalKills(run, run.elapsedMs)
    if (run.wardenKilled) marks += 2
    if (capitals.carrier) marks += 3
    if (capitals.tyrant) marks += 3
    if (capitals.harbinger) marks += 5
    if (voidAllowedDepth(run.depth, run.elapsedMs) >= 3) marks += 1
    return Math.min(marks, VOID_MAX_RUN_MARKS)
}

/** The most one run can pay: every boss down and depth 3 reached. Marks have no daily cap. */
export const VOID_MAX_RUN_MARKS = 14

/** Daily caps on the rare meta rewards. */
export const VOID_DAILY_BLUEPRINTS = 2
export const VOID_DAILY_GEAR = 5
export const VOID_DAILY_RELICS = 10

/** Pilot XP per finished run bounty; a run rolls two. */
export const VOID_BOUNTY_XP = 40
export const VOID_BOUNTIES_PER_RUN = 2

/**
 * Bounty XP the client reports, capped by what the run could have earned:
 * no more than one bounty per minute flown.
 */
export function voidBountyXp(reported: unknown, elapsedMs: number) {
    const earned = Math.max(0, Math.floor(Number(reported) || 0))
    const cap = VOID_BOUNTY_XP * Math.min(VOID_BOUNTIES_PER_RUN, Math.floor(Math.max(0, elapsedMs) / 60_000))
    return Math.min(earned, cap)
}

/**
 * Salvaged gear caches a run may bank, since the client reports the caches:
 * one past ninety seconds and one more per five minutes (three at most), plus
 * one each for a warden and each capital ship, within what is left of the
 * daily limit.
 */
export function voidGearCap(run: { elapsedMs: number, wardenKilled: boolean, carrierKilled: boolean, tyrantKilled?: boolean, harbingerKilled?: boolean, depth?: number }, gearToday: number) {
    const time = Math.min(3, (run.elapsedMs >= 90_000 ? 1 : 0) + Math.floor(run.elapsedMs / 300_000))
    const long = run.elapsedMs >= VOID_MIN_CLAIM_MS
    const capitals = voidCapitalKills(run, run.elapsedMs)
    const bosses = (run.wardenKilled && long ? 1 : 0) + (capitals.carrier ? 1 : 0) + (capitals.tyrant ? 1 : 0) + (capitals.harbinger ? 1 : 0)
    return Math.max(0, Math.min(VOID_DAILY_GEAR - gearToday, time + bosses))
}

/** Blueprints only come from gear kinds the pilot can use. */
export const VOID_BLUEPRINT_KINDS: VoidItemKind[] = ['gun', 'turret', 'secondary', 'device']

// ─── Lore ───────────────────────────────────────────────────────────────────

export interface VoidLoreEntry {
    id: string
    title: string
    text: string
}

export const VOID_LORE: VoidLoreEntry[] = [
    { id: 'halcyon-1', title: 'Survey log, Halcyon Drift', text: 'Ferrite yields are strong this side of the belt. The raiders are a nuisance, but the Coalition says patrols are coming. They have said that for six months.' },
    { id: 'halcyon-2', title: 'Personal note', text: 'If you find this, my share of the claim is yours. Tell Mara the ship was worth it. It was not.' },
    { id: 'halcyon-3', title: 'Coalition bulletin', text: 'Independent haulers are reminded that firing on Coalition vessels voids all docking rights. Accidents will be treated as intent.' },
    { id: 'cinder-1', title: 'Mining war memorial', text: 'Four hundred miners and the company that sent them. The minefields they laid still drift here, patient as ever.' },
    { id: 'cinder-2', title: 'Recovered order', text: 'Seed the approach with proximity charges. Leave the cobalt seams untouched; we will be back for them once the strikers are dealt with.' },
    { id: 'cinder-3', title: 'Salvager log', text: 'Found a carrier hulk with its hangar still sealed. Something inside is still warm. We are not opening it.' },
    { id: 'dark-1', title: 'Final transmission', text: 'Beacons dark. Scanner shows a signature twice our mass pacing us from behind the rocks. It does not answer hails.' },
    { id: 'dark-2', title: 'Research fragment', text: 'The iridium here resonates with drive harmonics. Whatever lives in the dark does not see ships. It hears them.' },
    { id: 'dark-3', title: 'Scrawled note', text: 'Cut the engines and it lost us. Turned them back on and it was already there.' },
    { id: 'womb-1', title: 'Biologist journal', text: 'The rocks grow. Slowly, but they grow. The mites are not a species. They are a symptom.' },
    { id: 'womb-2', title: 'Quarantine notice', text: 'All vessels leaving the Womb are to be scanned for xenite spores. Hulls that hum are to be scuttled.' },
    { id: 'womb-3', title: 'Coalition dispatch', text: 'The Sovereign has no crew. We boarded it twice. The second team came back with more people than they left with.' },
    { id: 'abyss-1', title: 'Cartographer note', text: 'The map ends here because nobody who went further drew anything we could read.' },
    { id: 'abyss-2', title: 'Dreadnought logbook', text: 'Carrier group holding at the rim. Our orders are to let nothing through. Our orders do not say from which side.' },
    { id: 'abyss-3', title: 'Unsigned', text: 'The void is not empty. It is full of things that have learned to be quiet.' },
    { id: 'relic-1', title: 'Relic appraisal', text: 'Pre-collapse capacitor, still charged. Whoever built these did not build them to be found.' }
]

export const VOID_LORE_IDS = VOID_LORE.map(l => l.id)

/** Lore logs that can turn up in a sector: its own three, plus the relic note anywhere. */
export function voidLoreForSector(tier: number) {
    const prefix = ['halcyon', 'cinder', 'dark', 'womb', 'abyss'][Math.max(1, Math.min(5, tier)) - 1]!
    return VOID_LORE.filter(l => l.id.startsWith(prefix) || l.id === 'relic-1').map(l => l.id)
}

// ─── Jump chains ────────────────────────────────────────────────────────────

export type VoidZoneModifier = 'calm' | 'ion' | 'radiation' | 'pirates' | 'graveyard' | 'rich' | 'nebula'

/**
 * What a zone changes, as multipliers on the plain rules. The engine reads
 * these, so the chips a pilot sees at the gate and what the zone really does
 * come from the same place.
 */
export interface VoidZoneMods {
    /** Units per broken rock. */
    ore: number
    /** Scrap and alloy from kills and crates. */
    salvage: number
    /** Asteroid clusters in the field. */
    rocks: number
    /** Patrols at arrival and roaming in afterwards. */
    patrols: number
    /** Added to a wing's chance of fielding an elite. */
    elites: number
    wrecks: number
    caches: number
    relics: number
    /** Shield recharge, the pilot's. */
    shieldRegen: number
    scan: number
    /** How far hostiles spot the pilot. */
    vision: number
}

export const VOID_ZONE_PLAIN: VoidZoneMods = { ore: 1, salvage: 1, rocks: 1, patrols: 1, elites: 0, wrecks: 1, caches: 1, relics: 1, shieldRegen: 1, scan: 1, vision: 1 }

export interface VoidZoneDefinition {
    id: VoidZoneModifier
    name: string
    icon: string
    color: number
    /** Upsides and downsides as chips: a few words each, numbers as percentages. */
    boons: string[]
    banes: string[]
    /** Skulls this zone adds to (or takes off) the jump's danger. */
    danger: number
    mods: VoidZoneMods
}

export const VOID_ZONES: VoidZoneDefinition[] = [
    { id: 'calm', name: 'Quiet Space', icon: 'i-lucide-moon-star', color: 0x5ec8ff, boons: ['-40% patrols'], banes: ['-20% ore'], danger: -1, mods: { ...VOID_ZONE_PLAIN, patrols: 0.6, ore: 0.8 } },
    { id: 'ion', name: 'Ion Storm', icon: 'i-lucide-cloud-lightning', color: 0x7fd4ff, boons: ['No enemy shields'], banes: ['-50% shield regen', 'Rock lightning'], danger: 0, mods: { ...VOID_ZONE_PLAIN, shieldRegen: 0.5 } },
    { id: 'radiation', name: 'Radiation Belt', icon: 'i-lucide-radiation', color: 0x9dff5e, boons: ['+30% ore'], banes: ['Hull burns unshielded'], danger: 0, mods: { ...VOID_ZONE_PLAIN, ore: 1.3 } },
    { id: 'pirates', name: 'Pirate Territory', icon: 'i-lucide-skull', color: 0xff6b4f, boons: ['+50% salvage'], banes: ['+60% patrols', 'More elites'], danger: 1, mods: { ...VOID_ZONE_PLAIN, salvage: 1.5, patrols: 1.6, elites: 0.12 } },
    { id: 'graveyard', name: 'Derelict Graveyard', icon: 'i-lucide-ship', color: 0xc9b38a, boons: ['+100% wrecks and caches'], banes: ['-40% rocks', 'Old minefields'], danger: 0, mods: { ...VOID_ZONE_PLAIN, wrecks: 2, caches: 2, rocks: 0.6 } },
    { id: 'rich', name: 'Rich Veins', icon: 'i-lucide-gem', color: 0xffd35e, boons: ['+10% ore', '+25% rocks'], banes: ['More sentinels'], danger: 1, mods: { ...VOID_ZONE_PLAIN, ore: 1.1, rocks: 1.25 } },
    { id: 'nebula', name: 'Dense Nebula', icon: 'i-lucide-cloud-fog', color: 0xc07bff, boons: ['+100% relics', '-40% enemy sight'], banes: ['Thick fog', '-50% scanner'], danger: 0, mods: { ...VOID_ZONE_PLAIN, relics: 2, vision: 0.6, scan: 0.5 } }
]

export function voidZone(id: string) {
    return VOID_ZONES.find(z => z.id === id) ?? VOID_ZONES[0]!
}

/** Deepest jump a run of this length could honestly reach: one jump per ten seconds. */
export function voidAllowedDepth(reported: number, elapsedMs: number) {
    return Math.max(1, Math.min(Math.floor(Number(reported) || 1), 1 + Math.floor(elapsedMs / VOID_MIN_CLAIM_MS), 8))
}

/**
 * Enemy toughness per jump depth. Every jump bites harder than the last:
 * +29%, +66%, +111%, +164% … while loot only climbs a flat fifth a jump, so
 * going deeper is a risk to weigh rather than free money.
 */
export function voidDepthThreat(depth: number) {
    const jumps = Math.max(1, depth) - 1
    return 1 + jumps * 0.25 + jumps * jumps * 0.04
}

export function voidDepthLoot(depth: number) {
    return 1 + (Math.max(1, depth) - 1) * 0.2
}

/** Skulls out of five for arriving at `depth` in a zone. */
export function voidJumpDanger(depth: number, zone: string) {
    return Math.max(1, Math.min(5, Math.max(1, depth) - 1 + voidZone(zone).danger))
}
