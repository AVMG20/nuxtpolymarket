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
    polytown: 'Polytown',
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
    trashpanda: 'Trash Panda Heist',
    polymasters: 'PolyMasters',
    // Rounds played before the rename to PolyMasters.
    aviamasters: 'PolyMasters',
    emberportals: 'Ember Portals',
    roulette: 'Roulette',
    'casino-holdem': 'Casino Hold\'em',
    'three-card-poker': 'Three Card Poker',
    baccarat: 'Baccarat',
    town: 'Polytown',
    meadowbrawl: 'Meadowbrawl',
    riftborn: 'Riftborn',
    pathwarden: 'Pathwarden',
    firewall: 'Firewall',
    hackerz: 'Hackerz',
    'gold-miner': 'Gold Miner',
    'call-of-xeno': 'Call of Xeno',
    'storm-the-house': 'Storm the House',
    'voxel-arena': 'Voxel Arena',
    'hero-quest': 'Hero Quest',
    battler: 'Battler',
    tcg: 'TCG',
    // The vendor buyback keeps its own category so the admin page can watch
    // the module's only coin faucet.
    'tcg vendor': 'TCG',
    prestige: 'Prestige',
    draft: 'Draft',
    assets: 'Assets',
    gift: 'Gift'
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

// A category not in the table yet must still match: title-casing lost its separator, so try both.
export function prefixesForLabel(label: string): string[] {
    const known = LABEL_TO_PREFIXES[label]
    if (known) return known
    const lower = label.toLowerCase()
    return [...new Set([lower, lower.replaceAll(' ', '-')])]
}
