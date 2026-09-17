/**
 * The rarity registry (§5.2): rarity is era-scoped REFERENCE DATA, not an
 * enum — the vocabulary grows with every era, so each value carries its
 * ladder position, display symbol and the sidecar codes that alias it.
 * Read from cards, never assigned; new tiers are a data patch here.
 */

export type RarityTone = 'ink' | 'silver' | 'gold' | 'pink' | 'pastel' | 'rainbow'

export interface RarityInfo {
    /** Canonical label, as thepricedex prints it. */
    label: string
    /** Ladder position — low is common. */
    order: number
    /** Printed symbol, rendered in `tone`. */
    symbol: string
    tone: RarityTone
    /** The era band the page groups by. */
    era: string
    /** Sidecar codes and variant labels that mean this tier. */
    aliases: string[]
}

export const RARITY_REGISTRY: RarityInfo[] = [
    { label: 'Basic Energy', order: 0, symbol: '⚡', tone: 'ink', era: 'Every era', aliases: ['TCGLFBE'] },
    { label: 'Common', order: 1, symbol: '●', tone: 'ink', era: 'Every era', aliases: ['C', 'Common Holo'] },
    { label: 'Uncommon', order: 2, symbol: '◆', tone: 'ink', era: 'Every era', aliases: ['U', 'CRU'] },
    { label: 'Rare', order: 3, symbol: '★', tone: 'ink', era: 'Every era', aliases: ['R'] },
    { label: 'Rare Holo', order: 4, symbol: '★', tone: 'silver', era: 'WOTC → SWSH', aliases: ['H', 'Holo Rare'] },
    { label: 'Rare Prism Star', order: 5, symbol: '✦', tone: 'pastel', era: 'Sun & Moon', aliases: ['PS'] },
    { label: 'Radiant Rare', order: 6, symbol: '✸', tone: 'pastel', era: 'Sword & Shield', aliases: ['K'] },
    { label: 'Shining Rare', order: 7, symbol: '✸', tone: 'silver', era: 'Neo / Hidden Fates', aliases: ['Shining', 'SP'] },
    { label: 'Rare BREAK', order: 8, symbol: '★', tone: 'gold', era: 'XY BREAK', aliases: ['BR'] },
    { label: 'Amazing Rare', order: 9, symbol: '✸', tone: 'rainbow', era: 'Sword & Shield', aliases: ['AMA'] },
    { label: 'Character Rare', order: 10, symbol: '★', tone: 'ink', era: 'Japanese prints', aliases: ['CHR'] },
    { label: 'Character Rare V', order: 11, symbol: '★', tone: 'silver', era: 'Japanese prints', aliases: ['CHV'] },
    { label: 'Character Super Rare', order: 12, symbol: '★★', tone: 'silver', era: 'Japanese prints', aliases: ['CSR'] },
    { label: 'Rare Holo EX', order: 13, symbol: '★★', tone: 'silver', era: 'Black & White / XY', aliases: ['EX'] },
    { label: 'Rare Holo GX', order: 14, symbol: '★★', tone: 'silver', era: 'Sun & Moon', aliases: ['GX'] },
    { label: 'Rare Holo V', order: 15, symbol: '★', tone: 'silver', era: 'Sword & Shield', aliases: ['V'] },
    { label: 'Rare Holo VMAX', order: 16, symbol: '★★', tone: 'silver', era: 'Sword & Shield', aliases: ['VM'] },
    { label: 'Rare Holo VSTAR', order: 17, symbol: '★★', tone: 'silver', era: 'Sword & Shield', aliases: ['VS'] },
    { label: 'Double Rare', order: 18, symbol: '★★', tone: 'ink', era: 'Scarlet & Violet →', aliases: ['2R'] },
    { label: 'Ultra Rare', order: 19, symbol: '★★', tone: 'silver', era: 'Scarlet & Violet →', aliases: ['UR', 'RU'] },
    { label: 'Illustration Rare', order: 20, symbol: '★', tone: 'gold', era: 'Scarlet & Violet →', aliases: ['IR'] },
    { label: 'Special Illustration Rare', order: 21, symbol: '★★', tone: 'gold', era: 'Scarlet & Violet →', aliases: ['SIR'] },
    { label: 'ACE SPEC Rare', order: 22, symbol: '★', tone: 'pink', era: 'Scarlet & Violet →', aliases: ['ACE', 'Rare ACE'] },
    { label: 'Shiny Rare', order: 23, symbol: '✧', tone: 'pastel', era: 'Shiny vault subsets', aliases: ['SH'] },
    { label: 'Shiny Rare GX', order: 24, symbol: '✧★', tone: 'silver', era: 'Hidden Fates', aliases: ['SGX'] },
    { label: 'Shiny Rare V', order: 25, symbol: '✧★', tone: 'silver', era: 'Shining Fates', aliases: ['SV'] },
    { label: 'Shiny Rare VMAX', order: 26, symbol: '✧★★', tone: 'silver', era: 'Shining Fates', aliases: ['SVM'] },
    { label: 'Shiny Ultra Rare', order: 27, symbol: '✧★★', tone: 'gold', era: 'Paldean Fates', aliases: ['SUR'] },
    { label: 'Secret Rare', order: 28, symbol: '★', tone: 'gold', era: 'Pre-SV secrets', aliases: ['SR'] },
    { label: 'Rainbow Rare', order: 29, symbol: '★', tone: 'rainbow', era: 'SM / SWSH', aliases: ['RR'] },
    { label: 'Hyper Rare', order: 30, symbol: '★★★', tone: 'gold', era: 'Scarlet & Violet →', aliases: ['HR'] },
    { label: 'Black White Rare', order: 31, symbol: '★', tone: 'gold', era: 'Black Bolt / White Flare', aliases: ['BWR'] },
    { label: 'Mega Attack Rare', order: 32, symbol: '★★', tone: 'pastel', era: 'Mega Evolution', aliases: ['MAR'] },
    { label: 'Mega Hyper Rare', order: 33, symbol: '★★★', tone: 'gold', era: 'Mega Evolution', aliases: ['MHR'] }
]

const byKey = new Map<string, RarityInfo>()
for (const info of RARITY_REGISTRY) {
    byKey.set(info.label.toLowerCase(), info)
    for (const alias of info.aliases) byKey.set(alias.toLowerCase(), info)
}

/**
 * Resolve a rarity label or sidecar code. "Reverse X" resolves as X — the
 * reverse is a foil pattern, not a rarity tier (§5.3).
 */
export function rarityInfo(labelOrCode: string | null | undefined): RarityInfo | null {
    if (!labelOrCode) return null
    const stripped = labelOrCode.replace(/^Reverse /i, '').trim()
    return byKey.get(stripped.toLowerCase()) ?? null
}

/** Ladder position for sorting; unknown tiers sort after everything known. */
export function rarityOrder(labelOrCode: string | null | undefined): number {
    return rarityInfo(labelOrCode)?.order ?? 99
}
