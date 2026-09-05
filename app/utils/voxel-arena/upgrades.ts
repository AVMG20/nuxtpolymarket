// Voxel Arena — the rogue-like upgrade pool and the between-wave draft.
// Pure data: no three.js.

import type { AbilityId, DraftCard, PlayerStats, Rarity, UpgradeCard } from './types'
import { boonPrice } from './data'

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
    // Core stat boons add flat percentages and cap out, so late waves stay hard: eight
    // Hollow Points is +120%, not ×3.8.
    { id: 'damage', name: 'Hollow Points', description: '+15% weapon damage.', rarity: 'common', kind: 'stat', icon: 'i-lucide-crosshair', maxStacks: 8, apply: s => { s.damageMult += 0.15 } },
    { id: 'firerate', name: 'Hair Trigger', description: '+12% fire rate.', rarity: 'common', kind: 'stat', icon: 'i-lucide-zap', maxStacks: 6, apply: s => { s.fireRateMult += 0.12 } },
    { id: 'health', name: 'Reinforced Plating', description: '+25 max health and heal to full.', rarity: 'common', kind: 'stat', icon: 'i-lucide-heart', maxStacks: 8, apply: s => { s.maxHealth += 25 } },
    { id: 'speed', name: 'Servo Legs', description: '+8% movement speed.', rarity: 'common', kind: 'stat', icon: 'i-lucide-wind', maxStacks: 5, apply: s => { s.moveSpeed *= 1.08 } },
    { id: 'reload', name: 'Quick Hands', description: '-20% reload time.', rarity: 'common', kind: 'stat', icon: 'i-lucide-refresh-cw', maxStacks: 4, apply: s => { s.reloadMult *= 0.8 } },
    { id: 'magazine', name: 'Drum Feed', description: '+30% magazine size.', rarity: 'common', kind: 'stat', icon: 'i-lucide-database', maxStacks: 4, apply: s => { s.magazineMult += 0.3 } },
    { id: 'melee', name: 'Honed Edge', description: '+30% melee damage and +10% melee range.', rarity: 'common', kind: 'stat', icon: 'i-lucide-sword', maxStacks: 5, apply: s => { s.meleeDamageMult += 0.3; s.meleeRangeMult *= 1.1 } },
    { id: 'scavenger', name: 'Scavenger', description: '+60% pickup range, +50% drop luck and +50% ammo crate chance.', rarity: 'common', kind: 'stat', icon: 'i-lucide-magnet', maxStacks: 3, apply: s => { s.pickupRange *= 1.6; s.luck *= 1.5; s.ammoLuck *= 1.5 } },
    { id: 'pockets', name: 'Deep Pockets', description: '+40% reserve ammo on every gun.', rarity: 'common', kind: 'stat', icon: 'i-lucide-briefcase', maxStacks: 3, apply: s => { s.reserveMult *= 1.4 } },
    { id: 'bloodlust', name: 'Bloodlust', description: 'Every kill heals 3 health.', rarity: 'common', kind: 'stat', icon: 'i-lucide-heart-handshake', maxStacks: 3, apply: s => { s.bloodlust += 3 } },
    { id: 'bounty', name: 'Bounty Hunter', description: '+20% credits for every wave you clear.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-coins', maxStacks: 3, apply: s => { s.income += 0.2 } },
    { id: 'headhunter', name: 'Headhunter', description: 'Headshots put the round back in the magazine and deal +25% damage.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-target', maxStacks: 2, apply: s => { s.headhunter += 1; s.critMult += 0.25 } },
    { id: 'velocity', name: 'Accelerator Coils', description: '+30% projectile speed.', rarity: 'common', kind: 'stat', icon: 'i-lucide-fast-forward', maxStacks: 3, apply: s => { s.projectileSpeedMult *= 1.3 } },
    { id: 'energy', name: 'Energy Siphon', description: '+4 energy per kill and +25 max energy.', rarity: 'common', kind: 'stat', icon: 'i-lucide-battery-charging', maxStacks: 4, apply: s => { s.energyPerKill += 4; s.energyMax += 25 } },
    { id: 'crit', name: 'Weak Point Scanner', description: '+8% crit chance.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-scan-eye', maxStacks: 5, apply: s => { s.critChance += 0.08 } },
    { id: 'critdmg', name: 'Executioner', description: '+50% critical damage.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-skull', maxStacks: 4, apply: s => { s.critMult += 0.5 } },
    { id: 'dash', name: 'Extra Thruster', description: '+1 dash charge and -15% dash cooldown.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-rocket', maxStacks: 3, apply: s => { s.dashCharges += 1; s.dashCooldown *= 0.85 } },
    { id: 'jump', name: 'Anti-Grav Boots', description: '+1 mid-air jump.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-arrow-big-up', maxStacks: 2, apply: s => { s.jumpCharges += 1 } },
    { id: 'lifesteal', name: 'Leech Rounds', description: 'Heal 4% of damage dealt.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-droplets', maxStacks: 4, apply: s => { s.lifesteal += 0.04 } },
    { id: 'armor', name: 'Ablative Shell', description: 'Take 12% less damage.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-shield', maxStacks: 4, apply: s => { s.armor = 1 - (1 - s.armor) * 0.88 } },
    { id: 'regen', name: 'Nanite Swarm', description: 'Regenerate 1.5 health per second.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-activity', maxStacks: 4, apply: s => { s.healthRegen += 1.5 } },
    { id: 'nova', name: 'Overcharged Nova', description: 'Nova Burst deals +60% damage and costs 10 less energy.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-sun', maxStacks: 3, requiresAbility: 'nova', apply: s => { s.abilityMult *= 1.6; s.abilityCost = Math.max(20, s.abilityCost - 10) } },

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
    { id: 'juggernaut', name: 'Juggernaut', description: '+60 max health, +40% melee damage, take 10% less damage, -6% speed.', rarity: 'legendary', kind: 'crazy', icon: 'i-lucide-mountain', maxStacks: 1, apply: s => { s.maxHealth += 60; s.meleeDamageMult *= 1.4; s.armor = 1 - (1 - s.armor) * 0.9; s.moveSpeed *= 0.94 } },
    { id: 'glass', name: 'Glass Cannon', description: '+90% damage. -35% max health.', rarity: 'legendary', kind: 'crazy', icon: 'i-lucide-gem', maxStacks: 1, apply: s => { s.damageMult += 0.9; s.maxHealth = Math.max(30, Math.round(s.maxHealth * 0.65)) } },
    { id: 'thorns', name: 'Spiked Carapace', description: 'Attackers take 200% of the damage they deal to you.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-shell', maxStacks: 3, apply: s => { s.thorns += 2 } },
    { id: 'secondwind', name: 'Second Wind', description: 'Once per wave, a killing blow instead restores 50% health.', rarity: 'legendary', kind: 'crazy', icon: 'i-lucide-heart-pulse', maxStacks: 1, apply: s => { s.secondWind += 1 } },
    { id: 'incendiary', name: 'Incendiary Rounds', description: 'Every bullet sets its target on fire for 2 seconds.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-flame', maxStacks: 2, apply: s => { s.incendiary += 1 } },
    { id: 'shrapnel', name: 'Shrapnel Burst', description: 'Enemies burst into 6 lethal voxel shards when they die.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-sparkles', maxStacks: 3, apply: s => { s.shrapnel += 1 } },
    { id: 'adrenaline', name: 'Adrenaline', description: 'Below 40% health: +40% damage and +15% speed.', rarity: 'rare', kind: 'crazy', icon: 'i-lucide-heart-crack', maxStacks: 2, apply: s => { s.adrenaline += 1 } },
    { id: 'bulwark', name: 'Bulwark', description: 'Start every wave with a 40-point energy shield.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-shield-check', maxStacks: 3, apply: s => { s.bulwark += 40 } },
    { id: 'sentry', name: 'Sentry Protocol', description: 'Turrets deal +50% damage, last 6s longer and cost 15 less energy.', rarity: 'rare', kind: 'stat', icon: 'i-lucide-radar', maxStacks: 3, requiresAbility: 'sentry', apply: s => { s.sentry += 1; s.turretCost = Math.max(25, s.turretCost - 15) } },

    // ── Flashy arsenal boons ────────────────────────────────────────────
    { id: 'frost', name: 'Frost Rounds', description: 'Bullets chill their target: -45% speed for 1.5s. Stacks add duration.', rarity: 'rare', kind: 'crazy', icon: 'i-lucide-snowflake', maxStacks: 3, apply: s => { s.frost += 1 } },
    { id: 'thunderstep', name: 'Thunder Step', description: 'Every dash hurls chain lightning into the 4 nearest enemies.', rarity: 'rare', kind: 'crazy', icon: 'i-lucide-zap', maxStacks: 3, apply: s => { s.thunderStep += 1 } },
    { id: 'reloadblast', name: 'Kinetic Reload', description: 'Finishing a reload detonates a shockwave that hurls back everything close.', rarity: 'rare', kind: 'crazy', icon: 'i-lucide-refresh-ccw-dot', maxStacks: 2, apply: s => { s.reloadBlast += 1 } },
    { id: 'execute', name: 'Death Mark', description: 'Enemies under 15% health are executed on the next hit. Titans need 8%.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-skull', maxStacks: 2, apply: s => { s.execute += 1 } },
    { id: 'bulletstorm', name: 'Bullet Storm', description: 'Every 5th kill fires a ring of 16 rounds out of you in every direction.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-loader-circle', maxStacks: 2, apply: s => { s.bulletStorm += 1 } },
    { id: 'lance', name: 'Sun Lance', description: 'Every 7 seconds your next shot is a blinding beam that pierces the whole arena for 6× damage.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-sun-medium', maxStacks: 2, apply: s => { s.lance += 1 } },
    { id: 'meteorcall', name: 'Meteor Call', description: 'Every 9 seconds a meteor falls on the thickest pack. It never hurts you.', rarity: 'epic', kind: 'crazy', icon: 'i-lucide-meteor', maxStacks: 2, apply: s => { s.meteorCall += 1 } },
    { id: 'storm', name: 'Lightning Storm', description: 'Every 5 seconds lightning strikes 5 random enemies for heavy damage.', rarity: 'legendary', kind: 'crazy', icon: 'i-lucide-cloud-lightning', maxStacks: 2, apply: s => { s.storm += 1 } },
    { id: 'rift', name: 'Void Rift', description: '12% of kills tear open a rift that drags enemies in for 2s, then detonates.', rarity: 'legendary', kind: 'crazy', icon: 'i-lucide-circle-dashed', maxStacks: 2, apply: s => { s.rift += 1 } }
]

export const UPGRADE_BY_ID = new Map(UPGRADES.map(card => [card.id, card]))

const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary']

export function rarityWeights(wave: number): Record<Rarity, number> {
    return {
        common: Math.max(20, 60 - wave * 3),
        rare: 28 + wave * 1.2,
        epic: 8 + wave * 1.6,
        legendary: 2 + wave * 0.9
    }
}

export const DRAFT_SIZE = 3

export interface DraftContext {
    wave: number
    /** Number of times each upgrade id has already been taken. */
    stacks: Map<string, number>
    /** Abilities already slotted; they unlock their upgrade cards. */
    ownedAbilities: AbilityId[]
    rng: () => number
}

/**
 * Deals DRAFT_SIZE unique boons. Rarity is rolled per slot with wave-scaled
 * weights, then a card of that rarity is picked with cards the player already
 * stacks weighted down so a hand rarely repeats what they own.
 */
export function dealDraft(ctx: DraftContext): DraftCard[] {
    const { wave, stacks, ownedAbilities, rng } = ctx
    const available = UPGRADES.filter(card => (stacks.get(card.id) ?? 0) < (card.maxStacks ?? 99) && (!card.requiresAbility || ownedAbilities.includes(card.requiresAbility)))
    const weights = rarityWeights(wave)
    const result: DraftCard[] = []
    const taken = new Set<string>()

    for (let slot = 0; slot < DRAFT_SIZE; slot++) {
        const rarity = rollRarity(weights, rng)
        // Fall back down the rarity ladder if that tier is exhausted.
        const idx = RARITY_ORDER.indexOf(rarity)
        let pool: UpgradeCard[] = []
        for (let i = idx; i >= 0 && pool.length === 0; i--) {
            pool = available.filter(card => card.rarity === RARITY_ORDER[i] && !taken.has(card.id))
        }
        if (pool.length === 0) pool = available.filter(card => !taken.has(card.id))
        if (pool.length === 0) break
        const card = weightedPick(pool, stacks, rng)
        taken.add(card.id)
        const owned = stacks.get(card.id) ?? 0
        result.push({ ...card, draftKey: `${wave}:${slot}:${card.id}:${Math.floor(rng() * 1e6)}`, cost: boonPrice(card.rarity, wave), owned })
    }
    return result
}

/** Cards already held are offered less often: weight 1 / (1 + stacks). */
function weightedPick(pool: UpgradeCard[], stacks: Map<string, number>, rng: () => number): UpgradeCard {
    const weights = pool.map(card => 1 / (1 + (stacks.get(card.id) ?? 0)))
    const total = weights.reduce((sum, w) => sum + w, 0)
    let roll = rng() * total
    for (let i = 0; i < pool.length; i++) {
        roll -= weights[i]!
        if (roll < 0) return pool[i]!
    }
    return pool[pool.length - 1]!
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
