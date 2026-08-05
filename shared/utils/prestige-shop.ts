/**
 * The prestige shop — what tokens actually buy.
 *
 * Budget shape: a run holds its tier's whole allowance (5 / 10 / 15 / 20, see
 * PRESTIGE_TIERS.tokens) and gets it back on the next ascent, because the
 * perks it bought are wiped by that same ascent. So there is never a reason to
 * hoard: spend the run's budget on the run you are playing.
 *
 * The catalog deliberately costs ~105 tokens in full against a 20-token
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
import { CATALYST_MAX_LEVEL, FACTORY_MAX_LEVEL, OVERCLOCK_MAX_LEVEL, RIG_MAX_LEVEL, VAULT_MAX_LEVEL } from './miner-config'
import { BASE_BUILDER_COUNT, MAX_GEMS_PER_DAY, MAX_TIER as COLONY_MAX_TIER, getBug } from './colony'

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

// ─── Miner gem tracks ─────────────────────────────────────────────────────────
// Overclock and Catalyst are each sold in two halves rather than one lump: the
// first token buys the cheap half of the gem curve (levels 1-5, ~90 gems), and
// the expensive half (6-10, ~600 gems) costs two more. Both tracks grow their
// gem price at ~1.5x per level, so a flat single price either massively
// overpaid for the front half or was unaffordable for the back half.

export const MINER_GEM_TRACK_MAX_OWNED = 2
/** Level each purchase takes the track to — 5, then the track's own max. */
export const MINER_OVERCLOCK_STEPS = [5, OVERCLOCK_MAX_LEVEL]
export const MINER_CATALYST_STEPS = [5, CATALYST_MAX_LEVEL]

/** Token price of the NEXT half: 1 for levels 1-5, 2 for 6-10. */
export function minerGemTrackCost(owned: number) {
    return owned === 0 ? 1 : 2
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

/** Highest tier a run can reach by buying every leap — T3, then one per leap. */
export const XENO_LEAP_FINAL_TIER = xenoLeapTier(XENO_LEAP_MAX_OWNED - 1)

// ─── Colony ───────────────────────────────────────────────────────────────────

/**
 * Brood Seed is two escalating packs, not three identical ones. The old
 * version handed over a Larva and a Grub — 300k against a habitat whose
 * FIRST level-up costs 250k, i.e. nothing. Each pack is now sized in coins
 * against what it actually saves you buying: ~1.9M for one token, ~8.7M for
 * three. Both are checked against BUG_TYPES' real spawn costs by
 * broodSeedValue below, so drifting the bug prices shows up in the shop copy.
 */
export const COLONY_BROOD_MAX_OWNED = 2

/** Species (and how many of each) the Nth Brood Seed purchase hands over. */
export const COLONY_BROOD_PACKS: { typeId: string, quantity: number }[][] = [
    // Pack 1 — a real T1+T2 opening hand, ~1.85M.
    [
        { typeId: 'larva', quantity: 2 },
        { typeId: 'grub', quantity: 2 },
        { typeId: 'beetle', quantity: 1 },
        { typeId: 'ladybug', quantity: 1 }
    ],
    // Pack 2 — T2/T3 scale-up, ~8.7M. Deliberately no Gem Snail; that's what
    // the Hive Brood buys.
    [
        { typeId: 'beetle', quantity: 2 },
        { typeId: 'ladybug', quantity: 2 },
        { typeId: 'cricket', quantity: 1 },
        { typeId: 'ant', quantity: 1 }
    ]
]

/** Coin value of a Brood Seed pack at current spawn costs, for the shop copy. */
export function broodSeedValue(purchaseIndex: number): number {
    const pack = COLONY_BROOD_PACKS[purchaseIndex] ?? []
    return pack.reduce((sum, entry) => sum + (getBug(entry.typeId)?.spawnCost ?? 0) * entry.quantity, 0)
}

/** Token price of the NEXT Brood Seed: 1 for the starter pack, 3 for the scale-up. */
export function colonyBroodCost(owned: number) {
    return owned === 0 ? 1 : 3
}

/** Habitat starts at 1 and MAX_TIER is 6, so five uplinks reach the ceiling. */
export const COLONY_UPLINK_MAX_OWNED = COLONY_MAX_TIER - 1

/**
 * Gem Snails are solitary, so a pack of ordinary ones crowds itself: five in
 * one terrarium tick at 28.2h each instead of 24h. The Hive Snail is a
 * prestige-only SOCIAL variant (see PURCHASABLE_BUG_TYPES), and for a gem bug
 * social buys exactly one thing — immunity to that penalty. gemTickMs clamps
 * the social multiplier at 1, so it is never FASTER than a lone snail, and
 * effectiveGemsPerDay ignores social entirely, so per-cycle output is
 * unchanged. The perk is five snails at full rate, not five fast snails.
 */
export const COLONY_HIVE_SNAIL_MAX_OWNED = 1
export const COLONY_HIVE_SNAILS_PER_PURCHASE = 5
export const COLONY_HIVE_SNAIL_TYPE_ID = 'social_gem_snail'

/**
 * Extra builders. Priced at 5 — the steepest thing in the shop — because it
 * is the only perk that compounds against COLONY's ~82-day critical path
 * rather than skipping a fixed chunk of it: two extra builders run three
 * tracks at once for the whole run.
 */
export const COLONY_BUILDER_MAX_OWNED = 2
export const COLONY_BUILDER_COST = 5

/** How many builders a run has, given how many Labour Contracts it bought. */
export function colonyBuilderCount(owned: number) {
    return BASE_BUILDER_COUNT + Math.min(owned, COLONY_BUILDER_MAX_OWNED)
}

// ─── HackOps ──────────────────────────────────────────────────────────────────

export const HACK_GHOST_MAX_OWNED = 5
export const HACK_GHOST_AGENTS = 1
export const HACK_GHOST_ITEMS = 3
export const HACK_DARKNET_MAX_OWNED = 5
export const HACK_DARKNET_AGENTS = 3
export const HACK_DARKNET_ITEMS = 5

// ─── Account ──────────────────────────────────────────────────────────────────

export const CREDIT_LINE_MAX_OWNED = 10
/**
 * Borrowing power one token buys. Implemented as maxPrincipal ÷
 * LOAN_MULTIPLIER. 500k was not worth a token next to anything else on this
 * page — a single Beetle costs more than it lent. 1M per token, 10M for the
 * lot, is a real opening position.
 */
export const CREDIT_LINE_PER_PURCHASE = 1_000_000

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
        summary: 'The Overclock track, in two halves — take the cheap half or buy the whole thing.',
        grants: [
            `1 token: Overclock to level ${MINER_OVERCLOCK_STEPS[0]} (+${MINER_OVERCLOCK_STEPS[0]! * 2}% mining and lootbox cash) — about 90 gems saved`,
            `2 more: Overclock to level ${OVERCLOCK_MAX_LEVEL} (+${OVERCLOCK_MAX_LEVEL * 2}%) — about 600 more gems saved`
        ],
        maxOwned: MINER_GEM_TRACK_MAX_OWNED,
        cost: minerGemTrackCost
    },
    {
        id: 'miner-catalyst',
        game: 'miner',
        name: 'Factory Catalyst',
        icon: 'i-lucide-flask-conical',
        summary: 'The Catalyst track, in two halves — take the cheap half or buy the whole thing.',
        grants: [
            `1 token: Catalyst to level ${MINER_CATALYST_STEPS[0]} (+${MINER_CATALYST_STEPS[0]! * 8}% gem production rate) — about 90 gems saved`,
            `2 more: Catalyst to level ${CATALYST_MAX_LEVEL} (+${CATALYST_MAX_LEVEL * 8}%) — about 600 more gems saved`
        ],
        maxOwned: MINER_GEM_TRACK_MAX_OWNED,
        cost: minerGemTrackCost
    },
    {
        id: 'xeno-leap',
        game: 'xeno',
        name: 'Xenogenesis Leap',
        icon: 'i-lucide-dna',
        summary: `Unlock plant tiers outright instead of breeding for them. First leap → T${XENO_LEAP_FIRST_TIER}, every leap after that → one tier higher.`,
        grants: [
            `1st leap (1 token) — unlocks T1, T2 and T${XENO_LEAP_FIRST_TIER}, and stocks all three`,
            `2nd leap (2 tokens) — unlocks T${XENO_LEAP_FIRST_TIER + 1}. 3rd (3 tokens) — T${XENO_LEAP_FIRST_TIER + 2}. And so on, one tier per leap.`,
            `Every leap stocks ${XENO_LEAP_PLANTS_PER_TYPE} of each plant in the tier it unlocks`,
            `All ${XENO_LEAP_MAX_OWNED} leaps cost ${(XENO_LEAP_MAX_OWNED * (XENO_LEAP_MAX_OWNED + 1)) / 2} tokens and reach T${XENO_LEAP_FINAL_TIER}`
        ],
        maxOwned: XENO_LEAP_MAX_OWNED,
        cost: owned => owned + 1
    },
    {
        id: 'colony-brood',
        game: 'colony',
        name: 'Brood Seed',
        icon: 'i-lucide-egg',
        summary: 'A real founding colony — bugs you would otherwise spend hours of XENO income buying.',
        grants: [
            `1 token: 2 Larva, 2 Grub, 1 Beetle, 1 Ladybug — about ${Math.round(broodSeedValue(0) / 100_000) / 10}M of bugs`,
            `3 tokens: 2 Beetle, 2 Ladybug, 1 Cricket, 1 Ant — about ${Math.round(broodSeedValue(1) / 100_000) / 10}M more`,
            'Traits roll against your current Research level, exactly like a bought bug',
            'Lands in inventory ready to place in the terrarium'
        ],
        maxOwned: COLONY_BROOD_MAX_OWNED,
        cost: colonyBroodCost
    },
    {
        id: 'colony-hive-snail',
        game: 'colony',
        name: 'Hive Brood',
        icon: 'i-lucide-gem',
        summary: 'A gem-snail pack that does not sabotage itself — the only social gem forager in the game.',
        grants: [
            `${COLONY_HIVE_SNAILS_PER_PURCHASE} Hive Snails — Gem Snails with the Social trait instead of Solitary`,
            'All five hold the full 24h cycle in one terrarium; five ordinary snails crowd each other out to 28.2h',
            `Up to ${COLONY_HIVE_SNAILS_PER_PURCHASE * MAX_GEMS_PER_DAY} gems a day once the Foraging tracks are up, on top of your normal snail`
        ],
        maxOwned: COLONY_HIVE_SNAIL_MAX_OWNED,
        cost: () => 1
    },
    {
        id: 'colony-builder',
        game: 'colony',
        name: 'Labour Contract',
        icon: 'i-lucide-hammer',
        summary: 'A second — and third — builder. The habitat queue stops being one thing at a time.',
        grants: [
            '+1 builder, so another upgrade track can be under construction in parallel',
            `Both contracts take the colony to ${colonyBuilderCount(COLONY_BUILDER_MAX_OWNED)} builders`,
            'One builder per track — they work on different jobs, never the same one twice'
        ],
        maxOwned: COLONY_BUILDER_MAX_OWNED,
        cost: () => COLONY_BUILDER_COST
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

/**
 * The full price ladder for an item, cheapest purchase first — [1, 2, 3, …]
 * for the Xenogenesis Leap, [1, 3] for the Brood Seed.
 *
 * Most multi-buy items escalate, and the shop used to show only the price of
 * the next one, so "Buy · 1" on a card whose second unit costs 3 read as a
 * flat price. The card renders this whole ladder with the already-bought
 * entries struck through.
 */
export function prestigeShopItemCostLadder(item: PrestigeShopItem): number[] {
    return Array.from({ length: item.maxOwned }, (_, owned) => item.cost(owned))
}

/** Whether an item's price changes between purchases — flat items skip the ladder. */
export function prestigeShopItemEscalates(item: PrestigeShopItem): boolean {
    const ladder = prestigeShopItemCostLadder(item)
    return ladder.some(cost => cost !== ladder[0])
}
