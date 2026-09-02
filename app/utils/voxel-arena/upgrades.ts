// Voxel Arena — the rogue-like upgrade pool and the between-wave draft.
// Pure data: no three.js.

import type { DraftCard, PlayerStats, Rarity, UpgradeCard, WeaponId } from './types'
import { WEAPONS, WEAPON_IDS } from './data'

export const RARITY_COLOR: Record<Rarity, string> = {
    common: '#9ca3af',
    rare: '#38bdf8',
    epic: '#c084fc',
    legendary: '#fbbf24'
}

export const RARITY_LABEL: Record<Rarity, string> = {
    common: 'Common',
    rare: 'Rare',
    epic: 'Epic',
    legendary: 'Legendary'
}

export const UPGRADES: UpgradeCard[] = [
    // ── Stat cards ──────────────────────────────────────────────────────
    { id: 'damage', name: 'Hollow Points', description: '+18% weapon damage.', rarity: 'common', kind: 'stat', icon: 'i-lucide-crosshair', apply: s => { s.damageMult *= 1.18 } },
    { id: 'firerate', name: 'Hair Trigger', description: '+14% fire rate.', rarity: 'common', kind: 'stat', icon: 'i-lucide-zap', apply: s => { s.fireRateMult *= 1.14 } },
    { id: 'health', name: 'Reinforced Plating', description: '+25 max health and heal to full.', rarity: 'common', kind: 'stat', icon: 'i-lucide-heart', apply: s => { s.maxHealth += 25 } },
    { id: 'speed', name: 'Servo Legs', description: '+9% movement speed.', rarity: 'common', kind: 'stat', icon: 'i-lucide-wind', apply: s => { s.moveSpeed *= 1.09 } },
    { id: 'reload', name: 'Quick Hands', description: '-20% reload time.', rarity: 'common', kind: 'stat', icon: 'i-lucide-refresh-cw', apply: s => { s.reloadMult *= 0.8 } },
    { id: 'magazine', name: 'Drum Feed', description: '+35% magazine size.', rarity: 'common', kind: 'stat', icon: 'i-lucide-database', apply: s => { s.magazineMult *= 1.35 } },
    { id: 'melee', name: 'Honed Edge', description: '+30% melee damage and +10% melee range.', rarity: 'common', kind: 'stat', icon: 'i-lucide-sword', apply: s => { s.meleeDamageMult *= 1.3; s.meleeRangeMult *= 1.1 } },
    { id: 'pickup', name: 'Magnet Core', description: '+60% pickup range and +25% drop luck.', rarity: 'common', kind: 'stat', icon: 'i-lucide-magnet', apply: s => { s.pickupRange *= 1.6; s.luck *= 1.25 } },
    { id: 'velocity', name: 'Accelerator Coils', description: '+30% projectile speed.', rarity: 'common', kind: 'stat', icon: 'i-lucide-fast-forward', apply: s => { s.projectileSpeedMult *= 1.3 } },
    { id: 'energy', name: 'Energy Siphon', description: '+4 energy per kill and +25 max energy.', rarity: 'common', kind: 'stat', icon: 'i-lucide-battery-charging', apply: s => { s.energyPerKill += 4; s.energyMax += 25 } },
    { id: 'crit', name: 'Weak Point Scanner', description: '+8% crit chance.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-scan-eye', apply: s => { s.critChance += 0.08 } },
    { id: 'critdmg', name: 'Executioner', description: '+50% critical damage.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-skull', apply: s => { s.critMult += 0.5 } },
    { id: 'dash', name: 'Extra Thruster', description: '+1 dash charge and -15% dash cooldown.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-rocket', maxStacks: 3, apply: s => { s.dashCharges += 1; s.dashCooldown *= 0.85 } },
    { id: 'jump', name: 'Anti-Grav Boots', description: '+1 mid-air jump.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-arrow-big-up', maxStacks: 2, apply: s => { s.jumpCharges += 1 } },
    { id: 'lifesteal', name: 'Leech Rounds', description: 'Heal 4% of damage dealt.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-droplets', maxStacks: 4, apply: s => { s.lifesteal += 0.04 } },
    { id: 'armor', name: 'Ablative Shell', description: 'Take 12% less damage.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-shield', maxStacks: 4, apply: s => { s.armor = 1 - (1 - s.armor) * 0.88 } },
    { id: 'regen', name: 'Nanite Swarm', description: 'Regenerate 1.5 health per second.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-activity', maxStacks: 4, apply: s => { s.healthRegen += 1.5 } },
    { id: 'nova', name: 'Overcharged Nova', description: 'Nova Burst deals +60% damage and costs 10 less energy.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-sun', maxStacks: 3, apply: s => { s.abilityMult *= 1.6; s.abilityCost = Math.max(20, s.abilityCost - 10) } },

    // ── Crazy build-defining cards ──────────────────────────────────────
    { id: 'ricochet', name: 'Ricochet Rounds', description: 'Bullets bounce to the nearest enemy after a hit. +1 bounce per stack.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-repeat', maxStacks: 3, apply: s => { s.ricochet += 1 } },
    { id: 'pierce', name: 'Penetrator Slugs', description: 'Bullets pierce through +2 enemies.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-move-right', maxStacks: 3, apply: s => { s.pierce += 2 } },
    { id: 'explosive', name: 'Explosive Rounds', description: 'Every hit detonates a small blast that damages nearby enemies.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-bomb', maxStacks: 3, apply: s => { s.explosiveRounds += 1 } },
    { id: 'chain', name: 'Static Charge', description: '25% of hits arc lightning to 3 nearby enemies.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-cloud-lightning', maxStacks: 3, apply: s => { s.chainLightning += 1 } },
    { id: 'split', name: 'Split Shot', description: 'Fire +1 projectile per shot, each at -12% damage.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-git-fork', maxStacks: 3, apply: s => { s.splitShot += 1; s.damageMult *= 0.88 } },
    { id: 'orbit', name: 'Orbital Blades', description: 'Two voxel blades orbit you, shredding whatever they touch.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-orbit', maxStacks: 3, apply: s => { s.orbitBlades += 2 } },
    { id: 'killblast', name: 'Chain Reaction', description: 'Enemies explode on death, damaging their neighbours.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-flame', maxStacks: 3, apply: s => { s.killBlast += 1 } },
    { id: 'chrono', name: 'Chrono Kill', description: 'Every kill slows time for a heartbeat. You do not slow down.', rarity: 'legendary', kind: 'crazy', icon: 'i-lucide-hourglass', maxStacks: 2, apply: s => { s.chronoKill += 1 } },
    { id: 'trail', name: 'Blazing Trail', description: 'Dashing leaves a burning trail of voxel fire.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-flame-kindling', maxStacks: 2, apply: s => { s.fireTrail += 1 } },
    { id: 'frenzy', name: 'Frenzy', description: 'Each kill grants +6% fire rate and speed for 4s, stacking to 10.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-gauge', maxStacks: 2, apply: s => { s.frenzy += 1 } },
    { id: 'aura', name: 'Vampiric Aura', description: 'Nearby enemies wither, and every tick heals you.', rarity: 'legendary', kind: 'crazy', icon: 'i-lucide-radiation', maxStacks: 2, apply: s => { s.vampireAura += 1 } },
    { id: 'homing', name: 'Seeker Rounds', description: 'All bullets steer toward the nearest enemy.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-locate-fixed', maxStacks: 2, apply: s => { s.homing += 1 } },
    { id: 'bigbullets', name: 'Big Bullets', description: 'Projectiles are 60% larger and hit 15% harder.', rarity: 'rare', kind: 'crazy', icon: 'i-lucide-circle-dot', maxStacks: 3, apply: s => { s.bulletSize += 1; s.damageMult *= 1.15 } },
    { id: 'colossus', name: 'Colossus', description: 'Grow huge. +60 max health, +40% melee damage, -8% speed.', rarity: 'legendary', kind: 'crazy', icon: 'i-lucide-mountain', maxStacks: 1, apply: s => { s.scale *= 1.35; s.maxHealth += 60; s.meleeDamageMult *= 1.4; s.moveSpeed *= 0.92 } },
    { id: 'glass', name: 'Glass Cannon', description: '+90% damage. -35% max health.', rarity: 'legendary', kind: 'crazy', icon: 'i-lucide-gem', maxStacks: 1, apply: s => { s.damageMult *= 1.9; s.maxHealth = Math.max(30, Math.round(s.maxHealth * 0.65)) } },
    { id: 'thorns', name: 'Spiked Carapace', description: 'Attackers take 200% of the damage they deal to you.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-shell', maxStacks: 3, apply: s => { s.thorns += 2 } },
    { id: 'secondwind', name: 'Second Wind', description: 'Once per wave, a killing blow instead restores 50% health.', rarity: 'legendary', kind: 'crazy', icon: 'i-lucide-heart-pulse', maxStacks: 1, apply: s => { s.secondWind += 1 } }
]

export const UPGRADE_BY_ID = new Map(UPGRADES.map(card => [card.id, card]))

export function weaponCard(id: WeaponId): UpgradeCard {
    const def = WEAPONS[id]
    return {
        id: `weapon:${id}`,
        name: def.name,
        description: def.tagline,
        rarity: def.rarity,
        kind: 'weapon',
        icon: 'i-lucide-target',
        weaponId: id,
        maxStacks: 1,
        apply: () => {}
    }
}

const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary']

export function rarityWeights(wave: number): Record<Rarity, number> {
    return {
        common: Math.max(20, 60 - wave * 3),
        rare: 28 + wave * 1.2,
        epic: 8 + wave * 1.6,
        legendary: 2 + wave * 0.9
    }
}

export const DRAFT_SIZE = 6
export const DRAFT_PICKS = 3

export interface DraftContext {
    wave: number
    /** Number of times each upgrade id has already been taken. */
    stacks: Map<string, number>
    /** Weapons already in the loadout — they are never offered again. */
    ownedWeapons: WeaponId[]
    rng: () => number
}

/**
 * Deals a draft of DRAFT_SIZE unique cards. Rarity is rolled per slot using
 * wave-scaled weights, then a card of that rarity is picked uniformly. Weapon
 * cards are always at most two per draft so the stat pool stays visible.
 */
export function dealDraft(ctx: DraftContext): DraftCard[] {
    const { wave, stacks, ownedWeapons, rng } = ctx
    const available = UPGRADES.filter(card => (stacks.get(card.id) ?? 0) < (card.maxStacks ?? 99))
    const weapons = WEAPON_IDS.filter(id => !ownedWeapons.includes(id)).map(weaponCard)
    const weights = rarityWeights(wave)
    const result: DraftCard[] = []
    const taken = new Set<string>()
    let weaponsDealt = 0

    for (let slot = 0; slot < DRAFT_SIZE; slot++) {
        const wantWeapon = weaponsDealt < 2 && weapons.some(w => !taken.has(w.id)) && rng() < 0.22
        let pool: UpgradeCard[]
        if (wantWeapon) {
            pool = weapons.filter(w => !taken.has(w.id))
        } else {
            const rarity = rollRarity(weights, rng)
            // Fall back down the rarity ladder if that tier is exhausted.
            const idx = RARITY_ORDER.indexOf(rarity)
            pool = []
            for (let i = idx; i >= 0 && pool.length === 0; i--) {
                pool = available.filter(card => card.rarity === RARITY_ORDER[i] && !taken.has(card.id))
            }
            if (pool.length === 0) pool = available.filter(card => !taken.has(card.id))
        }
        if (pool.length === 0) break
        const card = pool[Math.floor(rng() * pool.length)]!
        taken.add(card.id)
        if (card.kind === 'weapon') weaponsDealt++
        result.push({ ...card, draftKey: `${wave}:${slot}:${card.id}` })
    }
    return result
}

function rollRarity(weights: Record<Rarity, number>, rng: () => number): Rarity {
    const total = RARITY_ORDER.reduce((sum, r) => sum + weights[r], 0)
    let roll = rng() * total
    for (const r of RARITY_ORDER) {
        roll -= weights[r]
        if (roll < 0) return r
    }
    return 'common'
}

export function applyCard(card: UpgradeCard, stats: PlayerStats, stacks: Map<string, number>): void {
    card.apply(stats)
    stacks.set(card.id, (stacks.get(card.id) ?? 0) + 1)
}
