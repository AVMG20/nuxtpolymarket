import { DF_BASE_EFFECTS } from './constants'
import type { DfPerkId, DfPlayerEffects } from './types'

// Perks and their research modifiers. Every perk and modifier expresses
// itself only through DfPlayerEffects fields: `*Mult` fields multiply, other
// numbers add, booleans OR (see dfComputeEffects).

export interface DfPerkModifierDef {
    id: string
    name: string
    description: string
    /** Research level (1..6) that unlocks this modifier. */
    level: number
    effects: Partial<DfPlayerEffects>
}

export interface DfPerkDef {
    id: DfPerkId
    name: string // in-world bottle / machine name
    cost: number
    /** Hex colour of the machine and bottle glow, e.g. '#c0392b'. */
    color: string
    jingle: string // short flavour line shown on purchase
    description: string
    effects: Partial<DfPlayerEffects>
    modifiers: DfPerkModifierDef[] // exactly 6
}

export const DF_PERK_IDS: DfPerkId[] = ['ironhide', 'quickhand', 'twinfire', 'secondwind', 'fleetfoot', 'steadyeye']

export const DF_PERKS: Record<DfPerkId, DfPerkDef> = {
    ironhide: {
        id: 'ironhide',
        name: 'Ironhide Stout',
        cost: 2500,
        color: '#b8322a',
        jingle: 'A pint of iron for the men at the wire.',
        description: 'Take a beating: maximum health rises from 150 to 250.',
        effects: { maxHealth: 100 },
        modifiers: [
            { id: 'ironhide-sandbag', level: 1, name: 'Sandbag Lining', description: 'Take 50% less damage from explosions.', effects: { explosiveResistMult: 0.5 } },
            { id: 'ironhide-quickmend', level: 2, name: 'Quick Mend', description: 'Health starts regenerating sooner and faster.', effects: { regenDelay: -1.5, regenRate: 30 } },
            { id: 'ironhide-bloodletter', level: 3, name: 'Bloodletter', description: 'Every kill restores 8 health.', effects: { killHeal: 8 } },
            { id: 'ironhide-bulwark', level: 4, name: 'Bulwark', description: '+50 more maximum health, but you move 5% slower.', effects: { maxHealth: 50, moveMult: 0.95 } },
            { id: 'ironhide-pugilist', level: 5, name: 'Pugilist', description: 'Knife hits deal 75% more damage.', effects: { meleeMult: 1.75 } },
            { id: 'ironhide-deathwish', level: 6, name: 'Death Wish', description: 'Once per round, a lethal hit at full health leaves you on 1 hp.', effects: { deathWish: true } }
        ]
    },
    quickhand: {
        id: 'quickhand',
        name: 'Quickhand Tonic',
        cost: 3000,
        color: '#4f9a5a',
        jingle: 'Nimble fingers, steady nerves.',
        description: 'Reload twice as fast and swap weapons 30% faster.',
        effects: { reloadMult: 2, swapMult: 1.3 },
        modifiers: [
            { id: 'quickhand-shock', level: 1, name: 'Galvanic Reload', description: 'Reloading an empty magazine releases a 150-damage electric burst around you.', effects: { reloadShock: 150 } },
            { id: 'quickhand-slick', level: 2, name: 'Slick Hands', description: 'Swap weapons another 50% faster.', effects: { swapMult: 1.5 } },
            { id: 'quickhand-scavenger', level: 3, name: 'Scavenger', description: 'Kills have a 25% chance to slip a round back into the magazine.', effects: { ammoOnKillChance: 0.25 } },
            { id: 'quickhand-bandolier', level: 4, name: 'Bandolier', description: 'Carry 30% more reserve ammunition.', effects: { reserveAmmoMult: 1.3 } },
            { id: 'quickhand-speedloader', level: 5, name: 'Speedloader', description: 'Reload a further 25% faster.', effects: { reloadMult: 1.25 } },
            { id: 'quickhand-tinker', level: 6, name: 'Field Tinker', description: 'Raise your sights 20% faster after every reload and swap.', effects: { adsMult: 1.2, swapMult: 1.15 } }
        ]
    },
    twinfire: {
        id: 'twinfire',
        name: 'Twinfire Rye',
        cost: 2000,
        color: '#d0892c',
        jingle: 'Two fingers of rye, two bullets for every one.',
        description: 'Fire 33% faster and hit 10% harder.',
        effects: { fireRateMult: 1.33, damageMult: 1.1 },
        modifiers: [
            { id: 'twinfire-doubletap', level: 1, name: 'Double Tap', description: 'Each shot fires an extra bullet at 30% damage.', effects: { doubleTapBullets: 1 } },
            { id: 'twinfire-hotload', level: 2, name: 'Hot Load', description: 'Weapon damage +12%.', effects: { damageMult: 1.12 } },
            { id: 'twinfire-hairtrigger', level: 3, name: 'Hair Trigger', description: 'Fire another 15% faster, with 10% more recoil.', effects: { fireRateMult: 1.15, recoilMult: 1.1 } },
            { id: 'twinfire-deepmags', level: 4, name: 'Deep Crates', description: 'Carry 20% more reserve ammunition.', effects: { reserveAmmoMult: 1.2 } },
            { id: 'twinfire-tripletap', level: 5, name: 'Triple Tap', description: 'Two extra bullets per shot, but 5% slower fire.', effects: { doubleTapBullets: 2, fireRateMult: 0.95 } },
            { id: 'twinfire-bounty', level: 6, name: 'Bounty', description: 'Earn 15% more points.', effects: { pointsMult: 1.15 } }
        ]
    },
    secondwind: {
        id: 'secondwind',
        name: 'Second Wind Elixir',
        cost: 1500,
        color: '#4c8cc4',
        jingle: 'On your feet, soldier. Not today.',
        description: 'Revive squadmates twice as fast. Alone, each bottle picks you back up once.',
        effects: { reviveMult: 2 },
        modifiers: [
            { id: 'secondwind-tourniquet', level: 1, name: 'Tourniquet', description: 'Bleed out 15 seconds slower when downed.', effects: { bleedoutTime: 15 } },
            { id: 'secondwind-laststand', level: 2, name: 'Last Stand', description: 'Your weapon deals 75% more damage while downed.', effects: { lastStandDamageMult: 1.75 } },
            { id: 'secondwind-medic', level: 3, name: 'Field Medic', description: 'Revive another 35% faster.', effects: { reviveMult: 1.35 } },
            { id: 'secondwind-adrenaline', level: 4, name: 'Adrenaline', description: 'Regenerate health a second sooner.', effects: { regenDelay: -1 } },
            { id: 'secondwind-grit', level: 5, name: 'Grit', description: '+25 maximum health.', effects: { maxHealth: 25 } },
            { id: 'secondwind-stretcher', level: 6, name: 'Stretcher Bearer', description: 'Move 8% faster to reach the fallen.', effects: { moveMult: 1.08 } }
        ]
    },
    fleetfoot: {
        id: 'fleetfoot',
        name: 'Fleetfoot Fizz',
        cost: 2000,
        color: '#d9c24a',
        jingle: 'Light boots for heavy mud.',
        description: 'Move 8% faster, sprint 12% faster and twice as long.',
        effects: { moveMult: 1.08, sprintMult: 1.12, sprintDuration: 4 },
        modifiers: [
            { id: 'fleetfoot-lunge', level: 1, name: 'Bayonet Lunge', description: 'Your knife lunges 1.5 metres further.', effects: { meleeLunge: 1.5 } },
            { id: 'fleetfoot-marathon', level: 2, name: 'Marathon', description: 'Sprint 6 seconds longer.', effects: { sprintDuration: 6 } },
            { id: 'fleetfoot-runner', level: 3, name: 'Trench Runner', description: 'Aim 20% faster after a dash.', effects: { adsMult: 1.2 } },
            { id: 'fleetfoot-light', level: 4, name: 'Travel Light', description: 'Move another 6% faster.', effects: { moveMult: 1.06 } },
            { id: 'fleetfoot-cutthroat', level: 5, name: 'Cutthroat', description: 'Knife damage +50%.', effects: { meleeMult: 1.5 } },
            { id: 'fleetfoot-courier', level: 6, name: 'Courier', description: 'Swap weapons 25% faster and sprint 5% faster.', effects: { swapMult: 1.25, sprintMult: 1.05 } }
        ]
    },
    steadyeye: {
        id: 'steadyeye',
        name: 'Steady Eye Bitters',
        cost: 2500,
        color: '#8a5bb8',
        jingle: 'Breathe out. Squeeze.',
        description: 'Aim 35% faster, 25% tighter spread, 20% less recoil and +20% headshot damage.',
        effects: { adsMult: 1.35, spreadMult: 0.75, recoilMult: 0.8, headshotMult: 1.2 },
        modifiers: [
            { id: 'steadyeye-marksman', level: 1, name: 'Marksman', description: 'Headshots deal another 25% damage.', effects: { headshotMult: 1.25 } },
            { id: 'steadyeye-braced', level: 2, name: 'Braced', description: 'Recoil reduced another 30%.', effects: { recoilMult: 0.7 } },
            { id: 'steadyeye-trueshot', level: 3, name: 'True Shot', description: 'Spread tightened another 30%.', effects: { spreadMult: 0.7 } },
            { id: 'steadyeye-sniper', level: 4, name: 'Sniper Pay', description: 'Earn 10% more points.', effects: { pointsMult: 1.1 } },
            { id: 'steadyeye-execution', level: 5, name: 'Executioner', description: 'All damage +8%, headshots +10%.', effects: { damageMult: 1.08, headshotMult: 1.1 } },
            { id: 'steadyeye-snapsight', level: 6, name: 'Snap Sight', description: 'Aim another 40% faster.', effects: { adsMult: 1.4 } }
        ]
    }
}

/** Max selected modifiers per perk. */
export const DF_MAX_PERK_MODS = 2

/** Solo only: self-revives one Second Wind bottle grants. */
export const DF_SOLO_SELF_REVIVES = 1

function applyEffects(out: DfPlayerEffects, add: Partial<DfPlayerEffects>): void {
    const target = out as unknown as Record<string, number | boolean>
    for (const [key, value] of Object.entries(add) as [keyof DfPlayerEffects, number | boolean | undefined][]) {
        if (value === undefined) continue
        if (typeof value === 'boolean') {
            target[key] = Boolean(target[key]) || value
        } else if (key.endsWith('Mult')) {
            target[key] = (target[key] as number) * value
        } else {
            target[key] = (target[key] as number) + value
        }
    }
}

/** The perk's modifiers that a selection actually activates (known ids, deduped, max 2). */
export function dfActiveMods(perk: DfPerkId, selected: readonly string[] | undefined): DfPerkModifierDef[] {
    const def = DF_PERKS[perk]
    if (!def || !selected) return []
    const out: DfPerkModifierDef[] = []
    for (const id of selected) {
        if (out.length >= DF_MAX_PERK_MODS) break
        const mod = def.modifiers.find(m => m.id === id)
        if (mod && !out.includes(mod)) out.push(mod)
    }
    return out
}

/**
 * Effects of a set of owned perks with the player's selected modifiers.
 * `solo` matters for Second Wind (self-revive in solo).
 */
export function dfComputeEffects(
    owned: readonly DfPerkId[],
    selectedMods: Partial<Record<DfPerkId, string[]>>,
    solo: boolean
): DfPlayerEffects {
    const out: DfPlayerEffects = { ...DF_BASE_EFFECTS }
    const seen = new Set<DfPerkId>()
    for (const perk of owned) {
        const def = DF_PERKS[perk]
        if (!def || seen.has(perk)) continue
        seen.add(perk)
        applyEffects(out, def.effects)
        if (perk === 'secondwind' && solo) out.selfRevives += DF_SOLO_SELF_REVIVES
        for (const mod of dfActiveMods(perk, selectedMods?.[perk])) applyEffects(out, mod.effects)
    }
    out.regenDelay = Math.max(0.5, out.regenDelay)
    return out
}
