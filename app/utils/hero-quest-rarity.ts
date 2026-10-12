/**
 * Rarity presentation, in one place.
 *
 * Four collection grids render the same six-tier ladder (`gacha-shared-system.md` §1), and it was
 * already copy-pasted once before this file existed. Colours are Nuxt UI semantic tokens rather
 * than raw palette values, so a theme change carries.
 *
 * Auto-imported as a Nuxt utility, like `formatNumber` — which is why the constants carry an
 * `HQ_` prefix. `shared/utils/hack-config.ts` already exports `RARITY_LABEL` and `RARITY_ORDER`
 * into the same auto-import namespace for a different six-tier ladder, and an unprefixed name
 * here silently resolved to *that* one.
 */

export const HQ_RARITY_ORDER: readonly string[] = [
    'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'
]

/** Index-aligned with `HQ_RARITY_ORDER`, so a drop-rate row maps straight across. */
export const HQ_RARITY_LABEL: readonly string[] = [
    'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'
]

export const HQ_RARITY_TEXT_CLASS: Record<string, string> = {
    common: 'text-muted',
    uncommon: 'text-success',
    rare: 'text-info',
    epic: 'text-primary',
    legendary: 'text-warning',
    mythic: 'text-error'
}

export function hqRarityClass(rarity: string): string {
    return HQ_RARITY_TEXT_CLASS[rarity] ?? 'text-muted'
}
