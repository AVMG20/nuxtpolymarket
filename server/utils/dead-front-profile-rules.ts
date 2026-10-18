import { DF_PERKS, DF_PERK_IDS, DF_MAX_PERK_MODS } from '#shared/utils/dead-front/perks'
import { dfPerkLevel, dfPerkXpFromMatch } from '#shared/utils/dead-front/progression'
import { DF_WEAPONS, DF_WEAPON_IDS, DF_WEAPON_XP_PER_KILL, dfSanitizeAttachments, dfWeaponLevel } from '#shared/utils/dead-front/weapons'
import type { DfAttachmentChoice, DfLoadout, DfMatchResult, DfPerkId, DfProfileView, DfProgressReport, DfWeaponId } from '#shared/utils/dead-front/types'

// Pure profile rules (no DB): normalising stored JSON, validating REST
// inputs and merging one match result. Unit-tested in test/dead-front.

export const isDfWeaponId = (v: unknown): v is DfWeaponId => typeof v === 'string' && (DF_WEAPON_IDS as string[]).includes(v)
export const isDfPerkId = (v: unknown): v is DfPerkId => typeof v === 'string' && (DF_PERK_IDS as string[]).includes(v)

const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

export interface DfProfileRowLike {
    unlockedWeapons: unknown
    weaponXp: unknown
    loadout: unknown
    researchPerk: unknown
    perkXp: unknown
    perkMods: unknown
    gamesPlayed: number
    bestRound: number
    totalKills: number
    eggsCompleted: number
}

/** A defensive view of a stored row: unknown ids dropped, m1911 always unlocked, loadout re-validated. */
export function dfNormalizeProfile(row: DfProfileRowLike): DfProfileView {
    const unlocked = new Set<DfWeaponId>(['m1911'])
    if (Array.isArray(row.unlockedWeapons)) for (const w of row.unlockedWeapons) if (isDfWeaponId(w)) unlocked.add(w)
    const unlockedWeapons = DF_WEAPON_IDS.filter(id => unlocked.has(id))

    const weaponXp: DfProfileView['weaponXp'] = {}
    if (row.weaponXp && typeof row.weaponXp === 'object') {
        for (const [k, v] of Object.entries(row.weaponXp)) if (isDfWeaponId(k) && int(v)) weaponXp[k] = int(v)
    }
    const perkXp: DfProfileView['perkXp'] = {}
    if (row.perkXp && typeof row.perkXp === 'object') {
        for (const [k, v] of Object.entries(row.perkXp)) if (isDfPerkId(k) && int(v)) perkXp[k] = int(v)
    }
    const perkMods: DfProfileView['perkMods'] = {}
    if (row.perkMods && typeof row.perkMods === 'object') {
        for (const [k, v] of Object.entries(row.perkMods)) {
            if (!isDfPerkId(k) || !Array.isArray(v)) continue
            const mods = dfValidateMods(k, v, dfPerkLevel(perkXp[k] ?? 0))
            if (mods.length) perkMods[k] = mods
        }
    }
    const view: DfProfileView = {
        unlockedWeapons,
        weaponXp,
        loadout: { startWeapon: 'm1911', attachments: {} },
        researchPerk: isDfPerkId(row.researchPerk) ? row.researchPerk : null,
        perkXp,
        perkMods,
        gamesPlayed: int(row.gamesPlayed),
        bestRound: int(row.bestRound),
        totalKills: int(row.totalKills),
        eggsCompleted: int(row.eggsCompleted)
    }
    const stored = (row.loadout && typeof row.loadout === 'object' ? row.loadout : {}) as Partial<DfLoadout>
    view.loadout = dfValidateLoadout(view, stored.startWeapon, stored.attachments, true) ?? view.loadout
    return view
}

/**
 * Validates a loadout against the profile. Returns null when the start weapon is
 * not allowed (unless `lenient`, which falls back to the M1911).
 */
export function dfValidateLoadout(view: DfProfileView, startWeapon: unknown, attachments: unknown, lenient = false): DfLoadout | null {
    let start: DfWeaponId = 'm1911'
    if (isDfWeaponId(startWeapon) && DF_WEAPONS[startWeapon].startable && view.unlockedWeapons.includes(startWeapon)) {
        start = startWeapon
    } else if (!lenient) {
        return null
    }
    const out: DfLoadout['attachments'] = {}
    if (attachments && typeof attachments === 'object' && !Array.isArray(attachments)) {
        for (const [k, v] of Object.entries(attachments)) {
            if (!isDfWeaponId(k) || !view.unlockedWeapons.includes(k) || !v || typeof v !== 'object' || Array.isArray(v)) continue
            const clean: DfAttachmentChoice = {}
            for (const [slot, id] of Object.entries(v)) if (typeof id === 'string') (clean as Record<string, string>)[slot] = id
            const choice = dfSanitizeAttachments(k, dfWeaponLevel(view.weaponXp[k] ?? 0), clean)
            if (Object.keys(choice).length) out[k] = choice
        }
    }
    return { startWeapon: start, attachments: out }
}

/** Keeps known, unlocked, distinct modifier ids for a perk, at most DF_MAX_PERK_MODS. */
export function dfValidateMods(perk: DfPerkId, mods: unknown[], level: number): string[] {
    const out: string[] = []
    for (const id of mods) {
        if (typeof id !== 'string' || out.includes(id)) continue
        const mod = DF_PERKS[perk].modifiers.find(m => m.id === id)
        if (mod && mod.level <= level) out.push(id)
    }
    return out.slice(0, DF_MAX_PERK_MODS)
}

/** Merges one match into a profile view; returns the next view and the end-screen report. */
export function dfMergeMatchResult(view: DfProfileView, result: DfMatchResult): { next: DfProfileView, report: DfProgressReport } {
    const next: DfProfileView = {
        ...view,
        unlockedWeapons: [...view.unlockedWeapons],
        weaponXp: { ...view.weaponXp },
        perkXp: { ...view.perkXp }
    }
    const newWeapons: DfWeaponId[] = []
    for (const w of Array.isArray(result.weaponsFound) ? result.weaponsFound : []) {
        if (isDfWeaponId(w) && !next.unlockedWeapons.includes(w) && !newWeapons.includes(w)) newWeapons.push(w)
    }
    if (newWeapons.length) {
        const all = new Set([...next.unlockedWeapons, ...newWeapons])
        next.unlockedWeapons = DF_WEAPON_IDS.filter(id => all.has(id))
    }

    const weaponXpGained: DfProgressReport['weaponXpGained'] = {}
    const weaponLevelsUp: DfProgressReport['weaponLevelsUp'] = {}
    for (const [k, v] of Object.entries(result.weaponKills ?? {})) {
        const kills = Math.min(5000, int(v))
        if (!isDfWeaponId(k) || !kills) continue
        const gain = kills * DF_WEAPON_XP_PER_KILL
        const before = next.weaponXp[k] ?? 0
        next.weaponXp[k] = before + gain
        weaponXpGained[k] = gain
        const lvBefore = dfWeaponLevel(before)
        const lvAfter = dfWeaponLevel(before + gain)
        if (lvAfter > lvBefore) weaponLevelsUp[k] = lvAfter
    }

    const perk = view.researchPerk
    let perkXpGained = 0
    let perkLevelBefore = 0
    let perkLevelAfter = 0
    if (perk) {
        const before = next.perkXp[perk] ?? 0
        perkXpGained = dfPerkXpFromMatch(result)
        next.perkXp[perk] = before + perkXpGained
        perkLevelBefore = dfPerkLevel(before)
        perkLevelAfter = dfPerkLevel(before + perkXpGained)
    }

    const rounds = Math.min(10000, int(result.roundsSurvived))
    next.gamesPlayed = view.gamesPlayed + 1
    next.bestRound = Math.max(view.bestRound, rounds)
    next.totalKills = view.totalKills + Math.min(5000, int(result.kills))
    next.eggsCompleted = view.eggsCompleted + (result.completedEasterEgg ? 1 : 0)

    return {
        next,
        report: { perk, perkXpGained, perkLevelBefore, perkLevelAfter, weaponXpGained, weaponLevelsUp, newWeapons }
    }
}
