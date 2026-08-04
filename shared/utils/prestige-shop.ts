/**
 * The prestige shop — what tokens actually buy.
 *
 * Budget shape: a run holds its tier's whole allowance (5 / 10 / 15 / 20, see
 * PRESTIGE_TIERS.tokens) and gets it back on the next ascent, because the
 * perks it bought are wiped by that same ascent. So there is never a reason to
 * hoard: spend the run's budget on the run you are playing.
 *
 * The catalog deliberately costs ~93 tokens in full against a 20-token
 * ceiling. Nobody ever buys all of it — every run is a choice of which two or
 * three lanes to accelerate, and the four runs play differently because of it.
 *
 * Pricing is anchored on TIME SAVED, not coin value. After a wipe, coins come
 * back fast for a player who just burned ten billion of them; what actually
 * hurts to regrind is the wall clock — COLONY's builder queue is ~82 days end
 * to end, the miner rig is ~11 months to level 100, and XENO tiers are gated
 * behind breeding RNG. So colony/xeno/miner skips cost real tokens, while
 * HACKOPS — which is coin-gated, not time-gated — is the cheap lane.
 */
import { FACTORY_MAX_LEVEL, RIG_MAX_LEVEL, VAULT_MAX_LEVEL } from './miner-config'
import { MAX_TIER as COLONY_MAX_TIER } from './colony'

export type PrestigeShopGame = 'miner' | 'xeno' | 'colony' | 'hack' | 'account'

export interface PrestigeShopSection {
    id: PrestigeShopGame
    label: string
    icon: string
    /** Where the perk actually lands, linked from the shop card. */
    to: string | null
}

export const PRESTIGE_SHOP_SECTIONS: PrestigeShopSection[] = [
    { id: 'miner', label: 'Miner', icon: 'i-lucide-pickaxe', to: '/miner' },
    { id: 'xeno', label: 'Xeno', icon: 'i-lucide-sprout', to: '/xeno' },
    { id: 'colony', label: 'Colony', icon: 'i-lucide-bug', to: '/colony' },
    { id: 'hack', label: 'HackOps', icon: 'i-lucide-terminal', to: '/hack' },
    { id: 'account', label: 'Account', icon: 'i-lucide-user-cog', to: null }
]

export interface PrestigeShopItem {
    id: string
    game: PrestigeShopGame
    name: string
    icon: string
    /** One line on the card, above the grant list. */
    summary: string
    /** Exactly what one purchase puts in the account. */
    grants: string[]
    /** How many times a single run can buy this. */
    maxOwned: number
    /** Token price of the NEXT purchase, given how many are already owned. */
    cost: (owned: number) => number
}

// ─── Miner ────────────────────────────────────────────────────────────────────
// Rig income is geometric at 1.11^level, so raising the ceiling is worth far
// more than the levels handed over with it — +50 rig levels of headroom is a
// ~184x income ceiling. The granted levels are the early-game jumpstart; the
// raised cap is the endgame payoff.

export const MINER_CORE_MAX_OWNED = 10
/** Levels of extra CEILING one purchase adds. 10 buys take the rig 100 → 150. */
export const MINER_CORE_RIG_STEP = 5
export const MINER_CORE_VAULT_STEP = 5
export const MINER_CORE_FACTORY_STEP = 2
/** Levels handed over immediately on purchase (clamped to the new ceiling). */
export const MINER_CORE_RIG_GRANT = 5
export const MINER_CORE_VAULT_GRANT = 5
export const MINER_CORE_FACTORY_GRANT = 1

export function minerRigMaxLevel(coreOwned: number) {
    return RIG_MAX_LEVEL + coreOwned * MINER_CORE_RIG_STEP
}

export function minerVaultMaxLevel(coreOwned: number) {
    return VAULT_MAX_LEVEL + coreOwned * MINER_CORE_VAULT_STEP
}

export function minerFactoryMaxLevel(coreOwned: number) {
    return FACTORY_MAX_LEVEL + coreOwned * MINER_CORE_FACTORY_STEP
}

// ─── Xeno ─────────────────────────────────────────────────────────────────────

export const XENO_LEAP_MAX_OWNED = 7
/** The first leap lands on T3; each one after that unlocks the next tier. */
export const XENO_LEAP_FIRST_TIER = 3
export const XENO_LEAP_PLANTS_PER_TYPE = 50

/** Tier the NEXT leap unlocks, given how many are already owned. */
export function xenoLeapTier(owned: number) {
    return XENO_LEAP_FIRST_TIER + owned
}

// ─── Colony ───────────────────────────────────────────────────────────────────

export const COLONY_BROOD_MAX_OWNED = 3
/** Habitat starts at 1 and MAX_TIER is 6, so five uplinks reach the ceiling. */
export const COLONY_UPLINK_MAX_OWNED = COLONY_MAX_TIER - 1

// ─── HackOps ──────────────────────────────────────────────────────────────────

export const HACK_GHOST_MAX_OWNED = 5
export const HACK_GHOST_AGENTS = 1
export const HACK_GHOST_ITEMS = 3
export const HACK_DARKNET_MAX_OWNED = 5
export const HACK_DARKNET_AGENTS = 3
export const HACK_DARKNET_ITEMS = 5

// ─── Account ──────────────────────────────────────────────────────────────────

export const CREDIT_LINE_MAX_OWNED = 10
/** Borrowing power one token buys. Implemented as maxPrincipal ÷ LOAN_MULTIPLIER. */
export const CREDIT_LINE_PER_PURCHASE = 500_000

export const PRESTIGE_SHOP_ITEMS: PrestigeShopItem[] = [
    {
        id: 'miner-core',
        game: 'miner',
        name: 'Deep Core Calibration',
        icon: 'i-lucide-pickaxe',
        summary: 'Breaks the rig, vault and factory ceilings — and hands you a running start.',
        grants: [
            `+${MINER_CORE_RIG_STEP} max rig level, +${MINER_CORE_VAULT_STEP} max vault level, +${MINER_CORE_FACTORY_STEP} max factory level`,
            `Immediately +${MINER_CORE_RIG_GRANT} rig, +${MINER_CORE_VAULT_GRANT} vault, +${MINER_CORE_FACTORY_GRANT} factory level`,
            `All ${MINER_CORE_MAX_OWNED} take the rig and vault to ${minerRigMaxLevel(MINER_CORE_MAX_OWNED)} and the factory to ${minerFactoryMaxLevel(MINER_CORE_MAX_OWNED)}`
        ],
        maxOwned: MINER_CORE_MAX_OWNED,
        cost: () => 1
    },
    {
        id: 'miner-overclock',
        game: 'miner',
        name: 'Rig Overclock',
        icon: 'i-lucide-gauge',
        summary: 'The whole Overclock track, maxed, without spending a gem on it.',
        grants: [
            'Rig Overclock straight to level 10 (+20% mining and lootbox cash)',
            'Skips roughly 700 gems of Gem Shop grinding'
        ],
        maxOwned: 1,
        cost: () => 3
    },
    {
        id: 'miner-catalyst',
        game: 'miner',
        name: 'Factory Catalyst',
        icon: 'i-lucide-flask-conical',
        summary: 'The whole Catalyst track, maxed, without spending a gem on it.',
        grants: [
            'Factory Catalyst straight to level 10 (+80% gem production rate)',
            'Skips roughly 700 gems of Gem Shop grinding'
        ],
        maxOwned: 1,
        cost: () => 3
    },
    {
        id: 'xeno-leap',
        game: 'xeno',
        name: 'Xenogenesis Leap',
        icon: 'i-lucide-dna',
        summary: 'Skip the breeding RNG entirely and jump a whole plant tier.',
        grants: [
            `The first leap unlocks T${XENO_LEAP_FIRST_TIER} and stocks every plant from T1 up to it`,
            `Each leap after that unlocks the next tier and stocks that tier only`,
            `${XENO_LEAP_PLANTS_PER_TYPE} plants of every type unlocked`,
            'Costs one more token every time — 1, 2, 3, … so a full run reaches about T7'
        ],
        maxOwned: XENO_LEAP_MAX_OWNED,
        cost: owned => owned + 1
    },
    {
        id: 'colony-brood',
        game: 'colony',
        name: 'Brood Seed',
        icon: 'i-lucide-egg',
        summary: 'A founding pair of bugs, worth about 300k you do not have yet.',
        grants: [
            '1 Larva and 1 Grub, traits rolled as normal',
            'Lands in inventory ready to place in the terrarium'
        ],
        maxOwned: COLONY_BROOD_MAX_OWNED,
        cost: () => 1
    },
    {
        id: 'colony-uplink',
        game: 'colony',
        name: 'Habitat Uplink',
        icon: 'i-lucide-antenna',
        summary: 'The single biggest time skip in the shop — the builder queue is ~82 days end to end.',
        grants: [
            'Every upgrade track jumps to the requirement for the next habitat level',
            '+1 Habitat Level, instantly — no builder time, no coins, no items',
            `All ${COLONY_UPLINK_MAX_OWNED} take you to Habitat ${COLONY_MAX_TIER} and the Hive Empress`
        ],
        maxOwned: COLONY_UPLINK_MAX_OWNED,
        cost: () => 3
    },
    {
        id: 'hack-ghost',
        game: 'hack',
        name: 'Ghost Dossier',
        icon: 'i-lucide-ghost',
        summary: 'Top-shelf talent and gear, straight into the roster.',
        grants: [
            `${HACK_GHOST_AGENTS} Ghost Recruit agent (Specialist or better)`,
            `${HACK_GHOST_ITEMS} Ghost Cache items (Elite or Phantom only)`,
            'About 9.5M coins of pulls per purchase'
        ],
        maxOwned: HACK_GHOST_MAX_OWNED,
        cost: () => 3
    },
    {
        id: 'hack-darknet',
        game: 'hack',
        name: 'Darknet Package',
        icon: 'i-lucide-network',
        summary: 'Bulk mid-tier operators — the cheapest way to field a squad fast.',
        grants: [
            `${HACK_DARKNET_AGENTS} Dark Web Hire agents (Operative or better)`,
            `${HACK_DARKNET_ITEMS} Premium Stash items (Specialist or better)`,
            'About 2.1M coins of pulls per purchase'
        ],
        maxOwned: HACK_DARKNET_MAX_OWNED,
        cost: () => 1
    },
    {
        id: 'account-rakeback',
        game: 'account',
        name: 'Rakeback Unlock',
        icon: 'i-lucide-percent',
        summary: 'Turn rakeback back on without paying the 75-gem unlock again.',
        grants: ['Rakeback unlocked permanently for this run'],
        maxOwned: 1,
        cost: () => 1
    },
    {
        id: 'account-credit',
        game: 'account',
        name: 'Credit Line',
        icon: 'i-lucide-landmark',
        summary: 'Borrowing power on day one, when you have never deposited a coin.',
        grants: [
            `+${CREDIT_LINE_PER_PURCHASE.toLocaleString('en-US')} coins of bank loan allowance`,
            'Stacks — the bank normally only lends against what you have deposited'
        ],
        maxOwned: CREDIT_LINE_MAX_OWNED,
        cost: () => 1
    }
]

export function prestigeShopItem(id: string): PrestigeShopItem | null {
    return PRESTIGE_SHOP_ITEMS.find(item => item.id === id) ?? null
}

/** Tokens to buy every remaining purchase of an item, for the "buy it all" hint. */
export function prestigeShopItemTotalCost(item: PrestigeShopItem): number {
    let total = 0
    for (let owned = 0; owned < item.maxOwned; owned++) total += item.cost(owned)
    return total
}
