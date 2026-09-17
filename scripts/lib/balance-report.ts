/**
 * Shared vocabulary for the four run-game balance scripts.
 *
 * Every one of SHAPEZZ, Pirate Raid, FIREWALL and Pathwarden is the same shape
 * of economy: coins buy permanent upgrades, upgrades let you survive longer on
 * a harder setting, and surviving longer pays coins. The only way to compare
 * them is to hold the two axes fixed — how much of the permanent tree is
 * bought, and which difficulty is selected — and read the payout off that grid.
 *
 * The target bands below are the site-wide contract those four games are meant
 * to share. A game whose "nothing bought" row already pays six figures is not
 * a slightly generous game; it is a game whose entire upgrade tree is
 * decoration, because the player never has a reason to buy any of it.
 */

/** A point on the "how much of the permanent tree is bought" axis. */
export interface InvestmentTier {
    id: 'none' | 'low' | 'mid' | 'high' | 'max'
    label: string
    /** Share of the game's full permanent-upgrade cost this tier has spent. */
    share: number
    /** Coins one settled run at the best difficulty this tier can hold should pay. */
    target: [number, number]
}

export const INVESTMENT_TIERS: readonly InvestmentTier[] = [
    { id: 'none', label: 'none', share: 0, target: [1_000, 50_000] },
    { id: 'low', label: 'low', share: 0.02, target: [50_000, 250_000] },
    { id: 'mid', label: 'mid', share: 0.12, target: [250_000, 500_000] },
    { id: 'high', label: 'high', share: 0.45, target: [500_000, 1_000_000] },
    { id: 'max', label: 'maxed', share: 1, target: [1_000_000, 2_000_000] }
] as const

export function investmentTier(id: InvestmentTier['id']): InvestmentTier {
    const tier = INVESTMENT_TIERS.find(entry => entry.id === id)
    if (!tier) throw new Error(`Unknown investment tier: ${id}`)
    return tier
}

/** Where a payout sits against the band its investment tier is supposed to hit. */
export function verdict(payout: number, tier: InvestmentTier) {
    const [low, high] = tier.target
    if (payout < low) return 'LOW'
    if (payout > high * 2) return 'WAY OVER'
    if (payout > high) return 'over'
    return 'ok'
}

export const pad = (value: string | number, width: number) => String(value).padStart(width)
export const padRight = (value: string | number, width: number) => String(value).padEnd(width)

export function coins(value: number) {
    return Math.round(value).toLocaleString('en-US')
}

export function compact(value: number) {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}

export function heading(title: string) {
    console.log(`\n═══ ${title} ═══\n`)
}

export function rule(width: number) {
    console.log('─'.repeat(width))
}

/**
 * Prints the band contract itself, so every script's output is self-describing
 * and a reader does not have to open this file to know what "ok" means.
 */
export function printTargets(game: string) {
    heading(`${game} — target payout per settled run`)
    console.log(`${padRight('investment', 12)}${pad('tree spent', 12)}${pad('target payout', 24)}`)
    rule(48)
    for (const tier of INVESTMENT_TIERS) {
        console.log(
            padRight(tier.label, 12)
            + pad(`${Math.round(tier.share * 100)}%`, 12)
            + pad(`${compact(tier.target[0])} – ${compact(tier.target[1])}`, 24)
        )
    }
}
