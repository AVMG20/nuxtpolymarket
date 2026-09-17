/**
 * Prestige — the account-wide reset.
 *
 * Paying a tier's coin + gem price wipes every scrap of game progress (see
 * server/utils/prestige.ts for exactly what gets cleared) and permanently
 * raises the account's prestige level, which is worn as a coloured ring around
 * the player's emblem and a roman-numeral crown next to their name everywhere
 * they appear. Each ascent also pays out prestige tokens, the currency of the
 * prestige shop.
 *
 * Colours live here as raw CSS rather than Tailwind classes on purpose: the
 * ring is a conic-gradient and the badges are gradient-filled, neither of
 * which survives being expressed as utility classes, and a class string built
 * in a .ts file is not guaranteed to be picked up by Tailwind's scanner.
 */

export interface PrestigeTier {
    /** 1-4. Level 0 is "not prestiged" and has no tier. */
    level: number
    name: string
    roman: string
    /** Coins burned to reach this tier. */
    coinCost: number
    gemCost: number
    /**
     * The token allowance an account HOLDS at this tier — a total, not an
     * increment. Ascending sets the balance to this number rather than adding
     * to it, so the lifetime ceiling is 20 (tier IV), never 5+10+15+20.
     *
     * That also makes every ascent a full refund: the shop perks bought with
     * the last run's tokens are wiped by the same transaction, so the tokens
     * that paid for them come back. Nothing is stranded in a spent perk, and
     * there is no reason to hoard tokens instead of spending them on the run
     * you are actually playing.
     */
    tokens: number
    /** Flavour line shown on the tier card. */
    tagline: string
    /** Conic gradient painted as the rotating ring around the emblem. */
    ring: string
    /** Linear gradient used for the name badge and tier card accents. */
    badge: string
    /** Solid colour for glow, borders and text. */
    accent: string
    /** Seconds for one full rotation of the ring — higher tiers spin faster. */
    spinSeconds: number
}

export const PRESTIGE_MAX_LEVEL = 4

export const PRESTIGE_TIERS: PrestigeTier[] = [
    {
        level: 1,
        name: 'Ascendant',
        roman: 'I',
        coinCost: 10_000_000_000,
        gemCost: 5_000,
        tokens: 5,
        tagline: 'Burn the empire down and take the first step up.',
        ring: 'conic-gradient(from 0deg, #78350f, #f59e0b, #fde68a, #f59e0b, #78350f)',
        badge: 'linear-gradient(135deg, #b45309, #fbbf24)',
        accent: '#f59e0b',
        spinSeconds: 12
    },
    {
        level: 2,
        name: 'Luminary',
        roman: 'II',
        coinCost: 100_000_000_000,
        gemCost: 10_000,
        tokens: 10,
        tagline: 'Twice reforged. The board remembers your name.',
        ring: 'conic-gradient(from 0deg, #164e63, #06b6d4, #a5f3fc, #06b6d4, #164e63)',
        badge: 'linear-gradient(135deg, #0e7490, #22d3ee)',
        accent: '#22d3ee',
        spinSeconds: 9
    },
    {
        level: 3,
        name: 'Sovereign',
        roman: 'III',
        coinCost: 1_000_000_000_000,
        gemCost: 15_000,
        tokens: 15,
        tagline: 'A trillion coins, ash. Only the crown survived.',
        ring: 'conic-gradient(from 0deg, #4c1d95, #a855f7, #f5d0fe, #a855f7, #4c1d95)',
        badge: 'linear-gradient(135deg, #7e22ce, #d946ef)',
        accent: '#c084fc',
        spinSeconds: 7
    },
    {
        level: 4,
        name: 'Eternal',
        roman: 'IV',
        coinCost: 10_000_000_000_000,
        gemCost: 20_000,
        tokens: 20,
        tagline: 'Nothing left to prove. Nothing left to lose.',
        ring: 'conic-gradient(from 0deg, #f59e0b, #fde68a, #ffffff, #f0abfc, #a855f7, #38bdf8, #f59e0b)',
        badge: 'linear-gradient(135deg, #f59e0b, #f0abfc, #38bdf8)',
        accent: '#fbbf24',
        spinSeconds: 5
    }
]

/** The tier a player currently wears, or null while still at level 0. */
export function prestigeTier(level: number | null | undefined): PrestigeTier | null {
    return PRESTIGE_TIERS.find(tier => tier.level === level) ?? null
}

/** The tier a player can buy next, or null once Eternal is reached. */
export function nextPrestigeTier(level: number | null | undefined): PrestigeTier | null {
    return PRESTIGE_TIERS.find(tier => tier.level === (level ?? 0) + 1) ?? null
}

/**
 * The full token allowance this level is entitled to — what an untouched
 * account holds, and what the next ascent will restore the balance to.
 * Compare against the live `prestigeTokens` to show what is already spent.
 */
export function prestigeTokenAllowance(level: number | null | undefined): number {
    return prestigeTier(level)?.tokens ?? 0
}
