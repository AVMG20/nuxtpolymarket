import { randomFloat, randomWeighted } from '#shared/utils/random'
import type { Element, Offer, Rarity, UpgradeDef, UpgradeKind, WeaponId } from './types'
import { WEAPONS } from './weapons'

// Boons. Three kinds (a number goes up / something happens / a bargain),
// three elemental schools that reward stacking, and a handful of plain
// bread-and-butter picks so not every card is a build decision.
//
// Descriptions are one line on purpose: the card is read mid-fight.

const boon = (
    id: string, name: string, rarity: Rarity, kind: UpgradeKind, maxStacks: number, icon: string, description: string,
    extra: { element?: Element, catch?: string } = {}
): UpgradeDef => ({ id, name, description, rarity, kind, maxStacks, icon, ...extra })

export const UPGRADES: UpgradeDef[] = [
    // ------------------------------------------------------------ common
    boon('might', 'Might', 'common', 'stat', 6, 'i-lucide-sword', '+15% damage'),
    boon('haste', 'Haste', 'common', 'stat', 4, 'i-lucide-gauge', '+12% attack speed'),
    boon('swift', 'Swiftness', 'common', 'stat', 3, 'i-lucide-wind', '+10% move speed'),
    boon('vigor', 'Vigor', 'common', 'stat', 6, 'i-lucide-heart', '+25 max health, heal 25'),
    boon('mending', 'Mending', 'common', 'stat', 99, 'i-lucide-heart-pulse', 'Heal half your health now'),
    boon('thickhide', 'Thick Hide', 'common', 'stat', 3, 'i-lucide-shield-check', 'Take 8% less damage'),
    boon('surefoot', 'Sure Footing', 'common', 'stat', 3, 'i-lucide-footprints', 'Dodge recharges 25% faster'),
    boon('feast', 'Second Helping', 'common', 'stat', 3, 'i-lucide-soup', 'Clearing a wave heals 20 more'),
    boon('bruiser', 'Bruiser', 'common', 'stat', 3, 'i-lucide-hammer', '+35% knockback and stun build'),
    boon('magpie', 'Magpie', 'common', 'stat', 3, 'i-lucide-magnet', 'Coins fly to you from farther away'),
    boon('regen', 'Meadow\'s Mercy', 'common', 'stat', 3, 'i-lucide-leaf', 'Heal 1% a second when unhurt for 4s'),
    boon('crit', 'Keen Edge', 'common', 'effect', 4, 'i-lucide-crosshair', '10% chance to crit for 2.5×'),
    boon('opener', 'Opening Strike', 'common', 'effect', 3, 'i-lucide-sparkle', 'First hit of a combo deals +30%'),
    boon('rollimpact', 'Rolling Kick', 'common', 'effect', 3, 'i-lucide-circle-arrow-right', 'Your roll bowls over anything it touches'),
    boon('fortune', 'Fortune', 'common', 'effect', 1, 'i-lucide-clover', 'One more boon to choose from'),

    // -------------------------------------------------------------- rare
    boon('lifesteal', 'Bloodthirst', 'rare', 'effect', 3, 'i-lucide-droplets', 'Heal 4% of damage dealt'),
    boon('splash', 'Rippling Blows', 'rare', 'effect', 3, 'i-lucide-radio', 'Hits deal 20% to foes around the target'),
    boon('oversized', 'Oversized Weapon', 'rare', 'stat', 3, 'i-lucide-maximize-2', '+22% reach, +12% damage'),
    boon('doubledodge', 'Second Wind', 'rare', 'stat', 2, 'i-lucide-repeat', '+1 dodge charge'),
    boon('quickspecial', 'Battle Rhythm', 'rare', 'stat', 3, 'i-lucide-timer', 'Special and ability cooldowns −25%'),
    boon('colossus', 'Colossus', 'rare', 'stat', 3, 'i-lucide-expand', 'Grow: +20% reach, +40% knockback, −8% speed'),
    boon('burn', 'Wildfire', 'rare', 'effect', 5, 'i-lucide-flame', 'Hits ignite. Stacks burn hotter and longer', { element: 'fire' }),
    boon('freeze', 'Frostbite', 'rare', 'effect', 5, 'i-lucide-snowflake', 'Hits chill. Three stacks start freezing solid', { element: 'ice' }),
    boon('static', 'Static Charge', 'rare', 'effect', 5, 'i-lucide-plug-zap', 'Hits charge the target: +8% crit against it', { element: 'shock' }),
    boon('rollingthunder', 'Rolling Thunder', 'rare', 'effect', 3, 'i-lucide-cloud-lightning', 'Your roll ends in a thunderclap. Stacks add one at the start', { element: 'shock' }),
    boon('coldsnap', 'Cold Snap', 'rare', 'effect', 3, 'i-lucide-thermometer-snowflake', 'Every kill chills the whole field', { element: 'ice' }),
    boon('sprintcharge', 'Bull Rush', 'rare', 'effect', 3, 'i-lucide-chevrons-right', 'Sprinting into foes sends them flying'),
    boon('flow', 'Flow State', 'rare', 'effect', 2, 'i-lucide-waves', 'Longer combo window. Each chained hit +6%'),
    boon('berserk', 'Berserker', 'rare', 'effect', 3, 'i-lucide-skull', 'Below half health, +40% damage'),
    boon('thorns', 'Bramble Skin', 'rare', 'effect', 3, 'i-lucide-shrub', 'Whatever hits you takes 60% weapon damage'),
    boon('bloodlust', 'Bloodlust', 'rare', 'effect', 2, 'i-lucide-activity', 'Kills stack +4% speed and damage for 4s'),
    boon('titangrip', 'Titan Grip', 'rare', 'effect', 1, 'i-lucide-hand-metal', 'Every hit is heavy: shields break, elites stagger'),
    boon('overcharge', 'Overcharge', 'rare', 'effect', 3, 'i-lucide-battery-charging', '20% chance per kill to reset your special'),
    boon('adrenaline', 'Adrenaline', 'rare', 'effect', 2, 'i-lucide-heart-crack', 'Taking a hit refunds a dodge and quickens you'),
    boon('laststand', 'Last Stand', 'rare', 'effect', 1, 'i-lucide-flag', 'Once a wave, below 25% health: 1.5s untouchable'),
    boon('glasscannon', 'Glass Cannon', 'rare', 'pact', 1, 'i-lucide-wine', '+45% damage', { catch: '−30% max health' }),
    boon('gambler', 'Gambler\'s Edge', 'rare', 'pact', 1, 'i-lucide-dices', 'Hits roll up to 200% damage', { catch: 'or as low as 50%' }),

    // -------------------------------------------------------------- epic
    boon('whirlwind', 'Whirlwind', 'epic', 'effect', 3, 'i-lucide-tornado', 'Finishers whip up a shredding whirlwind'),
    boon('comboplus', '+1 Combo Hit', 'epic', 'stat', 3, 'i-lucide-plus-circle', 'One more swing before the finisher'),
    boon('projectile', 'Wind Cutter', 'epic', 'effect', 3, 'i-lucide-send', 'Every swing launches a blade of wind'),
    boon('lightning', 'Chain Lightning', 'epic', 'effect', 3, 'i-lucide-zap', '35% chance a hit arcs to neighbours. Stacks jump farther', { element: 'shock' }),
    boon('explode', 'Volatile Corpses', 'epic', 'effect', 3, 'i-lucide-bomb', 'Foes explode on death', { element: 'fire' }),
    boon('meteor', 'Meteor Shower', 'epic', 'effect', 3, 'i-lucide-star', 'A meteor falls every 6s. Stacks fall faster', { element: 'fire' }),
    boon('phoenix', 'Phoenix Feather', 'epic', 'effect', 2, 'i-lucide-feather', 'Cheat death once, reborn in fire', { element: 'fire' }),
    boon('shatter', 'Shatter', 'epic', 'effect', 2, 'i-lucide-gem', 'Frozen foes take +50% and burst into frost', { element: 'ice' }),
    boon('execute', 'Executioner', 'epic', 'effect', 3, 'i-lucide-axe', 'Foes below 20% die outright. Elites take +50%'),
    boon('echo', 'Echo Strike', 'epic', 'effect', 3, 'i-lucide-copy', 'Every third hit strikes twice'),
    boon('gravity', 'Gravity Well', 'epic', 'effect', 2, 'i-lucide-orbit', 'Your special drags everything to you first'),
    boon('deathblossom', 'Death Blossom', 'epic', 'effect', 3, 'i-lucide-flower', 'Kills burst into a ring of wind blades'),
    boon('cleavingwind', 'Cleaving Wind', 'epic', 'effect', 3, 'i-lucide-moon', 'Finishers hurl a giant crescent'),
    boon('spectral', 'Spectral Blades', 'epic', 'effect', 3, 'i-lucide-sparkles', 'Every fourth swing summons orbiting blades'),
    boon('vanguard', 'Spectral Vanguard', 'epic', 'effect', 3, 'i-lucide-ghost', 'A spectral warrior fights beside you. Stacks add allies'),
    boon('singularity', 'Singularity', 'epic', 'effect', 2, 'i-lucide-circle-dot', 'Your special leaves a black hole behind'),
    boon('chrono', 'Chronoshear', 'epic', 'effect', 1, 'i-lucide-hourglass', 'Taking a hit slows the world for 2s'),
    boon('bloodpact', 'Blood Pact', 'epic', 'pact', 1, 'i-lucide-droplet', 'Kills heal 3, elite kills heal 25', { catch: '−25% max health' }),

    // --------------------------------------------------------- legendary
    boon('avatar', 'Avatar of the Meadow', 'legendary', 'effect', 1, 'i-lucide-sun', 'Every sixth swing sweeps the whole field'),
    boon('stormcaller', 'Stormcaller', 'legendary', 'effect', 1, 'i-lucide-cloud-rain-wind', 'Lightning falls while your combo is live', { element: 'shock' }),
    boon('conflagration', 'Conflagration', 'legendary', 'effect', 1, 'i-lucide-flame-kindling', 'Burning foes set their neighbours alight', { element: 'fire' }),
    boon('deepwinter', 'Deep Winter', 'legendary', 'effect', 1, 'i-lucide-mountain-snow', 'Every 10s a frost wave freezes all around you', { element: 'ice' }),
    boon('eclipse', 'Eclipse', 'legendary', 'effect', 1, 'i-lucide-moon-star', 'Every 25th hit stops time for 2s')
]

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map(u => [u.id, u]))

/**
 * Boons that were merged or replaced. Old checkpoints map onto the boon
 * that took over; a `null` means the stacks are simply dropped.
 */
export const LEGACY_UPGRADE_IDS: Record<string, string | null> = {
    thunderstep: 'rollingthunder',
    frenzy: 'bloodlust',
    shockwave: 'splash',
    reapertoll: 'coldsnap',
    mirror: null
}

export function resolveUpgradeId(id: string): string | null {
    if (UPGRADE_BY_ID[id]) return id
    if (id in LEGACY_UPGRADE_IDS) return LEGACY_UPGRADE_IDS[id] ?? null
    return null
}

export function weaponUpgradeDef(id: WeaponId): UpgradeDef {
    const w = WEAPONS[id]
    return {
        id: `weapon:${id}`,
        name: w.name,
        description: `${w.tagline}. ${w.description} Special: ${w.special.name} — ${w.special.description}`,
        rarity: 'weapon',
        kind: 'stat',
        maxStacks: 1,
        icon: 'i-lucide-swords'
    }
}

export const RARITY_LABEL: Record<string, string> = {
    common: 'Common',
    rare: 'Rare',
    epic: 'Epic',
    legendary: 'Legendary',
    weapon: 'Weapon'
}

export const ELEMENT_COLOR: Record<Element, string> = {
    fire: '#ff8c2a',
    ice: '#8fe3ff',
    shock: '#c9a3ff'
}

export const ELEMENT_ICON: Record<Element, string> = {
    fire: 'i-lucide-flame',
    ice: 'i-lucide-snowflake',
    shock: 'i-lucide-zap'
}

export const KIND_ICON: Record<UpgradeKind, string> = {
    stat: 'i-lucide-trending-up',
    effect: 'i-lucide-sparkles',
    pact: 'i-lucide-scale'
}

/** Total stacks held across every boon of a school. */
export function elementStacks(stacks: ReadonlyMap<string, number>, element: Element): number {
    let n = 0
    for (const [id, count] of stacks) if (UPGRADE_BY_ID[id]?.element === element) n += count
    return n
}

export interface OfferContext {
    /** Cards to roll. Fortune adds a fourth. */
    count?: number
    /** Current health fraction — Mending is only dealt to the wounded. */
    hpFrac?: number
}

const TIERS: Rarity[] = ['common', 'rare', 'epic', 'legendary']

/**
 * Tier odds by wave. The first picks lean strong so a build shows up early.
 * Legends are luck, not a schedule: they enter at wave 6 at about one card
 * in sixty, a little more in the deep waves, and no run is owed one. Once
 * you hold one the odds drop to a whisper; two is the most a run ever sees.
 */
export function tierWeights(wave: number, legendaries: number): Record<Rarity, number> {
    if (wave <= 3) return { common: 38, rare: 44, epic: 18, legendary: 0, weapon: 0 }
    let legendary = wave < 6 ? 0 : wave < 15 ? 1.5 : 2.5
    if (legendaries === 1) legendary *= 0.3
    if (legendaries >= LEGENDARY_CAP) legendary = 0
    return { common: 50, rare: 32, epic: 15, legendary, weapon: 0 }
}

/** Distinct legendaries a run can hold. */
export const LEGENDARY_CAP = 2

/**
 * Roll `count` distinct offers, tier first then card, so the odds of a
 * tier never depend on how many cards it happens to hold. Weapons are
 * chosen on the start screen and never offered mid-run.
 */
export function rollOffers(
    wave: number,
    stacks: ReadonlyMap<string, number>,
    rng: () => number = randomFloat,
    ctx: OfferContext | number = {}
): Offer[] {
    const opts: OfferContext = typeof ctx === 'number' ? { count: ctx } : ctx
    const count = opts.count ?? 3
    const hpFrac = opts.hpFrac ?? 1
    let legendaries = 0
    for (const [id, n] of stacks) if (n > 0 && UPGRADE_BY_ID[id]?.rarity === 'legendary') legendaries += 1

    const pools: Record<string, Offer[]> = { common: [], rare: [], epic: [], legendary: [] }
    for (const u of UPGRADES) {
        const have = stacks.get(u.id) ?? 0
        if (have >= u.maxStacks) continue
        if (u.id === 'mending' && hpFrac >= 0.6) continue
        pools[u.rarity]!.push({ upgrade: u, stack: have + 1 })
    }

    const weights = tierWeights(wave, legendaries)
    const offers: Offer[] = []
    while (offers.length < count) {
        const open = TIERS.filter(t => pools[t]!.length > 0 && (weights[t] > 0 || t === 'common'))
        if (open.length === 0) break
        const tier = randomWeighted(open, t => Math.max(weights[t], t === 'common' ? 1 : 0), rng)
        const pool = pools[tier]!
        const pick = randomWeighted(pool, () => 1, rng)
        offers.push(pick)
        pool.splice(pool.indexOf(pick), 1)
    }
    return offers
}
