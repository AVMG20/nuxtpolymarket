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
    { id: 'revive', name: 'Second Chance', description: 'Once per run, a fatal hit leaves you at 30% hull instead.', icon: 'i-lucide-heart-pulse', costs: [10], effect: r => (r ? 'One revive per run' : 'No revive') }
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
    depth: number
    elapsedMs: number
}

/**
 * Command Marks for a finished run. Only extractions pay. A carrier kill is a
 * client claim, so it needs a run long enough to have found and fought one.
 */
export function voidRunMarks(run: VoidRunTrophies) {
    if (!run.extracted) return 0
    const minutes = run.elapsedMs / 60_000
    let marks = 0
    if (run.wardenKilled) marks += 2
    if (run.carrierKilled && minutes >= 4) marks += 3
    if (voidAllowedDepth(run.depth, run.elapsedMs) >= 3) marks += 1
    return marks
}

/** Daily caps on the rare meta rewards. */
export const VOID_DAILY_MARKS = 8
export const VOID_DAILY_BLUEPRINTS = 2
export const VOID_DAILY_GEAR = 8

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

export interface VoidZoneDefinition {
    id: VoidZoneModifier
    name: string
    description: string
    color: number
}

export const VOID_ZONES: VoidZoneDefinition[] = [
    { id: 'calm', name: 'Quiet Space', description: 'Nothing unusual. A breather.', color: 0x5ec8ff },
    { id: 'ion', name: 'Ion Storm', description: 'Shields recharge at half speed, yours and theirs. Enemy shields start drained.', color: 0x7fd4ff },
    { id: 'radiation', name: 'Radiation Belt', description: 'Hull slowly burns while the shield is down. Ore yields double.', color: 0x9dff5e },
    { id: 'pirates', name: 'Pirate Territory', description: 'Far more raiders. Salvage drops half again as much.', color: 0xff6b4f },
    { id: 'graveyard', name: 'Derelict Graveyard', description: 'Wrecks, caches and data logs everywhere. Fewer rocks.', color: 0xc9b38a },
    { id: 'rich', name: 'Rich Veins', description: 'Dense ore fields guarded by more sentinels.', color: 0xffd35e },
    { id: 'nebula', name: 'Dense Nebula', description: 'Fog halves your sight and scanner. Relic caches drop twice as often.', color: 0xc07bff }
]

export function voidZone(id: string) {
    return VOID_ZONES.find(z => z.id === id) ?? VOID_ZONES[0]!
}

/** Deepest jump a run of this length could honestly reach: one jump per two and a half minutes. */
export function voidAllowedDepth(reported: number, elapsedMs: number) {
    return Math.max(1, Math.min(Math.floor(Number(reported) || 1), 1 + Math.floor(elapsedMs / 150_000), 8))
}

/** Enemy toughness and loot per jump depth. */
export function voidDepthThreat(depth: number) {
    return 1 + (Math.max(1, depth) - 1) * 0.15
}

export function voidDepthLoot(depth: number) {
    return 1 + (Math.max(1, depth) - 1) * 0.2
}
