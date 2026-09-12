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
 * to end, and XENO tiers are gated behind breeding RNG. So colony/xeno skips
 * cost real tokens, while HACKOPS — which is coin-gated, not time-gated — is
 * the cheap lane.
 */
import { BASE_BUILDER_COUNT, MAX_GEMS_PER_DAY, MAX_TIER as COLONY_MAX_TIER, getBug } from './colony'

export type PrestigeShopGame = 'xeno' | 'colony' | 'hack' | 'account'

export interface PrestigeShopSection {
    id: PrestigeShopGame
    label: string
    icon: string
    /** Where the perk actually lands, linked from the shop card. */
    to: string | null
}

export const PRESTIGE_SHOP_SECTIONS: PrestigeShopSection[] = [
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
