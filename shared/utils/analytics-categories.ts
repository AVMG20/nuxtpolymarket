// Historical rows split one game across several raw categories (bet types,
// side bets, sub-games). This collapses the segment before the first `:`
// into a single per-game display label, at read time only.

export const GENERAL_LABEL = 'General'

const CATEGORY_LABELS: Record<string, string> = {
    blackjack: 'Blackjack',
    'live-blackjack': 'Blackjack',
    lootbox: 'Lootbox',
    gems: 'Gems',
    'gem market': 'Gems',
    'gem exchange': 'Gems',
    miner: 'Miner',
    xeno: 'Xeno',
    pirates: 'Pirates',
    hackops: 'HackOps',
    rakeback: 'Rakeback',
    colony: 'Colony',
    dice: 'Dice',
    limbo: 'Limbo',
    bank: 'Bank',
    shapezz: 'Shapezz',
    wheel: 'Wheel',
    xenoslot: 'Xeno Slot',
    aethergates: 'Aethergates',
    bookofshadows: 'Book of Shadows',
    fireinthehole: 'Fire in the Hole',
    candymadness: 'Candy Madness',
    magichands: 'Magic Hands',
    spinata: 'Spinata',
    roulette: 'Roulette',
    'casino-holdem': 'Casino Hold\'em',
    'three-card-poker': 'Three Card Poker',
    baccarat: 'Baccarat'
}

function titleCase(prefix: string): string {
    return prefix
        .split(/[\s-]+/)
        .filter(Boolean)
        .map(word => word[0]!.toUpperCase() + word.slice(1))
        .join(' ')
}

function categoryPrefix(rawCategory: string): string {
    return rawCategory.split(':')[0]!.trim().toLowerCase()
}

export function normaliseCategory(rawCategory: string | null): string {
    if (rawCategory === null) return GENERAL_LABEL
    const prefix = categoryPrefix(rawCategory)
    return CATEGORY_LABELS[prefix] ?? titleCase(prefix)
}

const LABEL_TO_PREFIXES = Object.entries(CATEGORY_LABELS)
    .reduce<Record<string, string[]>>((acc, [prefix, label]) => {
        (acc[label] ??= []).push(prefix)
        return acc
    }, {})

// Falls back to the label itself so a category that isn't in the table yet
// still round-trips through the filter instead of matching nothing.
export function prefixesForLabel(label: string): string[] {
    return LABEL_TO_PREFIXES[label] ?? [label.toLowerCase()]
}
