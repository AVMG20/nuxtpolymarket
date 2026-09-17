// Groups the per-game display labels produced by `normaliseCategory` into the
// buckets the audit page filters on. Keyed by display label rather than raw
// category so every variant of a game (`live-blackjack:side:...`) lands in the
// same genre automatically.

import { normaliseCategory, prefixesForLabel } from './analytics-categories'

export type Genre = 'casino' | 'idle' | 'active' | 'economy'

export const GENRES: Genre[] = ['casino', 'idle', 'active', 'economy']

export const GENRE_LABELS: Record<Genre, string> = {
    casino: 'Casino',
    idle: 'Idle',
    active: 'Active',
    economy: 'Economy'
}

export const GENRE_DESCRIPTIONS: Record<Genre, string> = {
    casino: 'Bet-and-roll games settled in a single request',
    idle: 'Games that accrue value over time while the player is away',
    active: 'Run-based games the player has to sit and play',
    economy: 'Money movement that is not a game: bank, gems, rakeback, prestige'
}

// Mirrors the sidebar groups in `app/layouts/default.vue` — `idleGameItems`,
// `activeGameItems`, and `slotItems` + `casinoItems` together — so the audit
// splits games the same way the navigation presents them. When a game moves
// between sidebar groups, move it here too.
const GENRE_BY_LABEL: Record<string, Genre> = {
    // Casino — slotItems + casinoItems
    Dice: 'casino',
    Limbo: 'casino',
    Wheel: 'casino',
    'Magic Hands': 'casino',
    'Xeno Slot': 'casino',
    'Candy Madness': 'casino',
    Aethergates: 'casino',
    'Fire in the Hole': 'casino',
    'Book of Shadows': 'casino',
    Spinata: 'casino',
    Roulette: 'casino',
    Blackjack: 'casino',
    Baccarat: 'casino',
    'Casino Hold\'em': 'casino',
    'Three Card Poker': 'casino',

    // Idle — idleGameItems
    Miner: 'idle',
    Xeno: 'idle',
    HackOps: 'idle',
    Colony: 'idle',
    Polytown: 'idle',
    // Not in the sidebar: lootboxes drop on a timer rather than being bought,
    // so they read as idle emission rather than a wager.
    Lootbox: 'idle',

    // Active — activeGameItems
    Pathwarden: 'active',
    Pirates: 'active',
    Shapezz: 'active',
    'Call of Xeno': 'active',
    'Voxel Arena': 'active',
    Firewall: 'active',
    Meadowbrawl: 'active',
    TCG: 'active',
    // Not in the sidebar: the TCG battler, and a standalone active game.
    Battler: 'active',
    'Storm the House': 'active',

    // Economy — platform flows, not games
    Bank: 'economy',
    Gems: 'economy',
    Rakeback: 'economy',
    Prestige: 'economy',
    Draft: 'economy',
    Assets: 'economy',
    General: 'economy'
}

/**
 * Genre of a display label. Anything unmapped is treated as `economy` — a new
 * game shows up in the audit under Economy until it is added to the table
 * above, which is visible rather than silently dropped.
 */
export function genreForLabel(label: string): Genre {
    return GENRE_BY_LABEL[label] ?? 'economy'
}

/** Genre of a raw `transactions.category` value. */
export function genreForCategory(rawCategory: string | null): Genre {
    return genreForLabel(normaliseCategory(rawCategory))
}

/** Labels the table knows about, for a given genre. */
export function labelsForGenre(genre: Genre): string[] {
    return Object.entries(GENRE_BY_LABEL)
        .filter(([, g]) => g === genre)
        .map(([label]) => label)
}

/**
 * Raw `transactions.category` prefixes belonging to a genre, so a query can
 * bucket rows by genre without round-tripping every row through JS. `economy`
 * is the fallback bucket and therefore has no closed prefix list — anything
 * that matches no other genre belongs to it.
 */
export function prefixesForGenre(genre: Genre): string[] {
    return labelsForGenre(genre).flatMap(prefixesForLabel)
}
