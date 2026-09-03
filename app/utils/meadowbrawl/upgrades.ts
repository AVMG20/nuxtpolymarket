import { randomFloat, randomWeighted } from '#shared/utils/random'
import type { Offer, UpgradeDef, WeaponId } from './types'
import { WEAPONS } from './weapons'

export const UPGRADES: UpgradeDef[] = [
    // Common — the bread and butter.
    { id: 'might', name: 'Might', description: '+15% damage.', rarity: 'common', maxStacks: 6, icon: 'i-lucide-sword' },
    { id: 'haste', name: 'Haste', description: '+12% attack speed.', rarity: 'common', maxStacks: 4, icon: 'i-lucide-gauge' },
    { id: 'swift', name: 'Swiftness', description: '+10% move speed.', rarity: 'common', maxStacks: 3, icon: 'i-lucide-wind' },
    { id: 'vigor', name: 'Vigor', description: '+25 max health and heal 25.', rarity: 'common', maxStacks: 6, icon: 'i-lucide-heart' },
    { id: 'mending', name: 'Mending', description: 'Heal 50% of your max health right now.', rarity: 'common', maxStacks: 99, icon: 'i-lucide-heart-pulse' },
    { id: 'bruiser', name: 'Bruiser', description: '+35% knockback and stagger on every hit.', rarity: 'common', maxStacks: 3, icon: 'i-lucide-hammer' },
    // Rare — the build starts here.
    { id: 'lifesteal', name: 'Bloodthirst', description: 'Heal 6% of damage dealt.', rarity: 'rare', maxStacks: 3, icon: 'i-lucide-droplets' },
    { id: 'shockwave', name: 'Tremor Strikes', description: '25% chance a hit erupts into a shockwave around the target. Each stack: +12% chance, +damage.', rarity: 'rare', maxStacks: 4, icon: 'i-lucide-radio' },
    { id: 'oversized', name: 'Oversized Weapon', description: 'Your weapon grows: +22% reach, +12% damage.', rarity: 'rare', maxStacks: 3, icon: 'i-lucide-maximize-2' },
    { id: 'freeze', name: 'Frostbite', description: 'Hits chill enemies, slowing them 45%. Stacks slow harder and can freeze solid.', rarity: 'rare', maxStacks: 3, icon: 'i-lucide-snowflake' },
    { id: 'burn', name: 'Wildfire', description: 'Hits set enemies ablaze for 4 seconds. Stacks burn hotter.', rarity: 'rare', maxStacks: 3, icon: 'i-lucide-flame' },
    { id: 'doubledodge', name: 'Second Wind', description: '+1 dodge charge.', rarity: 'rare', maxStacks: 2, icon: 'i-lucide-repeat' },
    { id: 'quickspecial', name: 'Battle Rhythm', description: 'Special cooldown -25%.', rarity: 'rare', maxStacks: 3, icon: 'i-lucide-timer' },
    { id: 'sprintcharge', name: 'Bull Rush', description: 'Sprinting into enemies hits them for 70% weapon damage and sends them flying.', rarity: 'rare', maxStacks: 3, icon: 'i-lucide-zap' },
    // Epic — deliberately over the top.
    { id: 'whirlwind', name: 'Whirlwind', description: 'Every combo finisher whips up a whirlwind that shreds everything around you.', rarity: 'epic', maxStacks: 3, icon: 'i-lucide-tornado' },
    { id: 'lightning', name: 'Chain Lightning', description: 'Hits arc lightning to nearby enemies for 35% damage. Each stack: +1 jump.', rarity: 'epic', maxStacks: 3, icon: 'i-lucide-cloud-lightning' },
    { id: 'comboplus', name: '+1 Combo Hit', description: 'Adds a swing to your combo chain before the finisher.', rarity: 'epic', maxStacks: 3, icon: 'i-lucide-plus-circle' },
    { id: 'projectile', name: 'Wind Cutter', description: 'Every swing launches a blade of wind for 50% damage. Stacks pierce further.', rarity: 'epic', maxStacks: 3, icon: 'i-lucide-send' },
    { id: 'explode', name: 'Volatile Corpses', description: 'Enemies explode on death, damaging everything nearby. Chain reactions welcome.', rarity: 'epic', maxStacks: 3, icon: 'i-lucide-bomb' },
    // Second batch — the ones that make a run feel broken.
    { id: 'crit', name: 'Keen Edge', description: '15% chance to crit for 2.5× damage.', rarity: 'common', maxStacks: 4, icon: 'i-lucide-crosshair' },
    { id: 'flow', name: 'Flow State', description: 'Combo window +60%. Every consecutive hit in a chain adds +6% damage, up to +60%.', rarity: 'rare', maxStacks: 2, icon: 'i-lucide-waves' },
    { id: 'berserk', name: 'Berserker', description: 'Below half health, deal +40% damage.', rarity: 'rare', maxStacks: 3, icon: 'i-lucide-skull' },
    { id: 'thorns', name: 'Bramble Skin', description: 'Anything that hits you takes 60% weapon damage and is hurled away.', rarity: 'rare', maxStacks: 3, icon: 'i-lucide-shrub' },
    { id: 'bloodlust', name: 'Bloodlust', description: 'Each kill grants +5% attack and move speed for 4 seconds, stacking to 10.', rarity: 'rare', maxStacks: 2, icon: 'i-lucide-activity' },
    { id: 'titangrip', name: 'Titan Grip', description: 'Every hit counts as heavy: shields break, elites stagger.', rarity: 'rare', maxStacks: 1, icon: 'i-lucide-hand-metal' },
    { id: 'rollingthunder', name: 'Rolling Thunder', description: 'Your dodge roll ends in a lightning shockwave.', rarity: 'rare', maxStacks: 3, icon: 'i-lucide-zap' },
    { id: 'overcharge', name: 'Overcharge', description: '20% chance per kill to reset your special cooldown.', rarity: 'rare', maxStacks: 3, icon: 'i-lucide-battery-charging' },
    { id: 'execute', name: 'Executioner', description: 'Hits on enemies below 20% health kill outright. Elites below 30% take +50%.', rarity: 'epic', maxStacks: 3, icon: 'i-lucide-axe' },
    { id: 'echo', name: 'Echo Strike', description: 'Every third hit strikes twice.', rarity: 'epic', maxStacks: 3, icon: 'i-lucide-copy' },
    { id: 'gravity', name: 'Gravity Well', description: 'Using your special drags every nearby enemy toward you first.', rarity: 'epic', maxStacks: 2, icon: 'i-lucide-orbit' },
    { id: 'deathblossom', name: 'Death Blossom', description: 'Kills burst into a ring of six wind blades. Stacks add more.', rarity: 'epic', maxStacks: 3, icon: 'i-lucide-flower' },
    { id: 'phoenix', name: 'Phoenix Feather', description: 'Cheat death once: revive at half health in a burst of fire.', rarity: 'epic', maxStacks: 2, icon: 'i-lucide-feather' },
    // Third batch — outright absurd.
    { id: 'adrenaline', name: 'Adrenaline', description: 'Taking a hit refunds a dodge charge and grants +30% attack speed for 3 seconds.', rarity: 'rare', maxStacks: 2, icon: 'i-lucide-heart-crack' },
    { id: 'reapertoll', name: 'Reaper\'s Toll', description: 'Every kill slows every enemy on the field for 1.2 seconds.', rarity: 'rare', maxStacks: 3, icon: 'i-lucide-hourglass' },
    { id: 'colossus', name: 'Colossus', description: 'Grow 25% bigger: +30% damage, +20% reach, -8% move speed.', rarity: 'rare', maxStacks: 3, icon: 'i-lucide-expand' },
    { id: 'mirror', name: 'Mirror Edge', description: 'Every swing also strikes behind you for 50% damage.', rarity: 'epic', maxStacks: 3, icon: 'i-lucide-flip-horizontal' },
    { id: 'cleavingwind', name: 'Cleaving Wind', description: 'Combo finishers hurl a giant crescent that carves through everything.', rarity: 'epic', maxStacks: 3, icon: 'i-lucide-moon' },
    { id: 'spectral', name: 'Spectral Blades', description: 'Every fourth swing summons three orbiting blades for 5 seconds.', rarity: 'epic', maxStacks: 3, icon: 'i-lucide-sparkles' },
    { id: 'meteor', name: 'Meteor Shower', description: 'Every 6 seconds a meteor falls on a random enemy. Stacks fall faster.', rarity: 'epic', maxStacks: 3, icon: 'i-lucide-meteor' },
    { id: 'singularity', name: 'Singularity', description: 'Your special leaves a black hole behind that pulls and crushes for 3 seconds.', rarity: 'epic', maxStacks: 2, icon: 'i-lucide-circle-dot' }
]

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map(u => [u.id, u]))

export function weaponUpgradeDef(id: WeaponId): UpgradeDef {
    const w = WEAPONS[id]
    return {
        id: `weapon:${id}`,
        name: w.name,
        description: `${w.tagline}. ${w.description} Special: ${w.special.name} — ${w.special.description}`,
        rarity: 'weapon',
        maxStacks: 1,
        icon: 'i-lucide-swords'
    }
}

export const RARITY_LABEL: Record<string, string> = {
    common: 'Common',
    rare: 'Rare',
    epic: 'Epic',
    weapon: 'Weapon'
}

/**
 * Roll three distinct offers. Early waves lean rare/epic so a build shows up
 * within the first three picks. Weapons are chosen on the start screen and
 * never offered mid-run.
 */
export function rollOffers(
    wave: number,
    stacks: ReadonlyMap<string, number>,
    rng: () => number = randomFloat
): Offer[] {
    const early = wave <= 3
    const weights: Record<string, number> = {
        common: early ? 40 : 55,
        rare: early ? 42 : 31,
        epic: early ? 18 : 14
    }

    const pool: Offer[] = []
    for (const u of UPGRADES) {
        const have = stacks.get(u.id) ?? 0
        if (have >= u.maxStacks) continue
        pool.push({ upgrade: u, stack: have + 1 })
    }

    const offers: Offer[] = []
    const remaining = [...pool]
    while (offers.length < 3 && remaining.length > 0) {
        const pick = randomWeighted(remaining, o => {
            // Mending is a safety valve, not a build piece.
            if (o.upgrade.id === 'mending') return 4
            return weights[o.upgrade.rarity] ?? 1
        }, rng)
        offers.push(pick)
        remaining.splice(remaining.indexOf(pick), 1)
    }
    return offers
}
