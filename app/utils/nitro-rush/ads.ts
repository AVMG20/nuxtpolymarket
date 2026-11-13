import { NAV_CATALOG } from '#shared/utils/nav-catalog'

/** The ads round a Nitro Rush course: one per game in the sidebar catalog, plus a few house ads. */

export interface TrackAd {
    title: string
    sub: string
    /** A colour emoji, or empty for a text-only ad. */
    icon: string
    /** The background gradient, dark to less dark. */
    bg: readonly [string, string]
    /** The accent: title glow and trim. */
    col: string
}

type Look = Omit<TrackAd, 'title'> & { title?: string }

/** Hand-made looks by route; a catalog game without one still gets an ad from FALLBACK_COLOURS. */
export const AD_LOOKS: Readonly<Record<string, Look>> = {
    '/void': { bg: ['#06061a', '#1b1050'], icon: '🚀', sub: 'THE DEEP IS CALLING', col: '#a98bff' },
    '/hero-quest': { bg: ['#1a1000', '#4a2c00'], icon: '⚔️', sub: 'YOUR PARTY AWAITS', col: '#ffc233' },
    '/colony': { bg: ['#0e1a00', '#264a00'], icon: '🐛', sub: 'GROW THE HIVE', col: '#a6ff4d' },
    '/xeno': { bg: ['#001a0e', '#00402a'], icon: '🌱', sub: 'HARVEST THE UNKNOWN', col: '#3dffb0' },
    '/pirates': { bg: ['#001428', '#003a66'], icon: '🏴‍☠️', sub: 'SIX MINUTES OF PLUNDER', col: '#4dc3ff' },
    '/pathwarden': { bg: ['#14140a', '#3a3a14'], icon: '🏰', sub: 'HOLD THE ROAD', col: '#e8e070' },
    '/call-of-xeno': { bg: ['#1a0004', '#4a000c'], icon: '🧟', sub: 'SURVIVE THE NIGHT', col: '#ff4d5e' },
    '/hack': { bg: ['#000a00', '#002a10'], icon: '💻', sub: 'ACCESS GRANTED', col: '#33ff66' },
    '/polytown': { bg: ['#0a1420', '#1f3a5a'], icon: '🏙️', sub: 'BUILD YOUR CITY', col: '#7fd4ff' },
    '/shapezz': { bg: ['#0a0020', '#24006a'], icon: '🔷', sub: 'GEOMETRY MAYHEM', col: '#6af0ff' },
    '/voxel-arena': { bg: ['#0a1418', '#16384a'], icon: '🧊', sub: 'SHOOT. SLASH. DASH.', col: '#66e0ff' },
    '/dead-front': { bg: ['#12100a', '#3a3018'], icon: '🪖', sub: 'HOLD THE CHAPEL', col: '#d8c27a' },
    '/firewall': { bg: ['#000e1a', '#00304a'], icon: '🛡️', sub: '30 WAVES. ONE CORE.', col: '#33e0ff' },
    '/hackerz': { bg: ['#06001a', '#16004a'], icon: '👾', sub: 'HOLD THE FENCE', col: '#b066ff' },
    '/riftborn': { bg: ['#1a0600', '#4a1400'], icon: '🌋', sub: 'SIX CLASSES. FIVE BOSSES.', col: '#ff6a33' },
    '/meadowbrawl': { bg: ['#0a1400', '#1e3a0a'], icon: '🌼', sub: 'CHAIN THE COMBO', col: '#ffe14d' },
    '/rail-tycoon': { bg: ['#140c06', '#3a2410'], icon: '🚂', sub: 'ALL ABOARD', col: '#ffa64d' },
    '/tcg': { bg: ['#10061a', '#2e1050'], icon: '🎴', sub: 'OPEN. COLLECT. DUEL.', col: '#e07bff' },
    '/games/dice': { bg: ['#140a00', '#3a2400'], icon: '🎲', sub: 'ROLL THE ODDS', col: '#ffb84d' },
    '/games/limbo': { bg: ['#00121a', '#00344a'], icon: '📈', sub: 'HOW HIGH WILL IT GO', col: '#4dffea' },
    '/games/wheel': { bg: ['#1a0010', '#4a0030'], icon: '🎡', sub: 'SPIN TO WIN', col: '#ff5ab4' },
    '/games/magichands': { bg: ['#140a1a', '#38184a'], icon: '✋', sub: 'CHASE THE GOLD', col: '#ffd24d' },
    '/games/live-blackjack': { bg: ['#001a14', '#00402e'], icon: '🃏', sub: 'BEAT THE DEALER', col: '#4dffc8' },
    '/games/roulette': { bg: ['#1a0004', '#3a000a'], icon: '🔴', sub: 'SINGLE ZERO', col: '#ff4d4d' },
    '/games/baccarat': { bg: ['#0a0a1a', '#1a1a40'], icon: '♦️', sub: 'PUNTO OR BANCO', col: '#ff6a8a' },
    '/games/three-card-poker': { bg: ['#06140a', '#123a1e'], icon: '♠️', sub: 'PLAY OR FOLD', col: '#7dff9a' },
    '/games/casino-holdem': { bg: ['#000e14', '#002a3a'], icon: '♣️', sub: 'CALL THE DEALER', col: '#66d4ff' },
    '/games/neighcasso': { bg: ['#1a0a14', '#3a1430'], icon: '🐴', sub: 'PAINT THE FINISH', col: '#ff9ad0' },
    '/games/xenoslot': { bg: ['#001a0a', '#003a1a'], icon: '🍒', sub: 'HOLD & WIN', col: '#5aff8a' },
    '/games/candymadness': { bg: ['#2a0018', '#5a0a3a'], icon: '🍬', sub: 'SWEET MULTIPLIERS', col: '#ff8ad8' },
    '/games/aethergates': { bg: ['#0a0a20', '#1e1e5a'], icon: '🌀', sub: 'OPEN THE GATES', col: '#8aa4ff' },
    '/games/fireinthehole': { bg: ['#1a0a00', '#4a1a00'], icon: '💣', sub: 'DIG DEEP. BLOW UP.', col: '#ff7a1a' },
    '/games/bookofshadows': { bg: ['#0a0614', '#24123a'], icon: '📖', sub: 'TURN THE PAGE', col: '#c79bff' },
    '/games/spinata': { bg: ['#1a0a00', '#4a2400'], icon: '🪅', sub: 'FESTIVAL OF SPINS', col: '#ffb02e' },
    '/games/trashpanda': { bg: ['#0e0e10', '#2a2a30'], icon: '🦝', sub: 'DUMPSTER DIVE', col: '#b8c0cc' },
    '/games/emberportals': { bg: ['#1a0400', '#4a0e00'], icon: '🔥', sub: 'THE PORTALS ARE OPEN', col: '#ff5a1f' },
    '/games/polymasters': { bg: ['#00101a', '#002a48'], icon: '✈️', sub: 'LAND TO CASH OUT', col: '#5ac8ff' },
    '/gem-exchange': { bg: ['#14001a', '#38004a'], icon: '💎', sub: 'TRADE UP', col: '#d07bff' },
    '/bank': { title: 'POLYNUX BANK', bg: ['#0e0e14', '#24243a'], icon: '🏦', sub: 'YOUR COINS, SAFE', col: '#c8d4ff' }
}

/** Ads for no page: the site itself and a made-up sponsor. */
const HOUSE_ADS: readonly TrackAd[] = [
    { title: 'POLYNUX', bg: ['#140a24', '#3a0f5a'], icon: '🎰', sub: 'PLAY. WIN. REPEAT.', col: '#ff3db8' },
    { title: 'NITRO ENERGY', bg: ['#001a1a', '#003a3a'], icon: '⚡', sub: 'ZERO SUGAR · ALL RUSH', col: '#33f0ff' }
]

/** Accents for a game with no look yet, picked by its name so it keeps the same one. */
const FALLBACK_COLOURS = ['#ff3db8', '#33f0ff', '#ffc233', '#a6ff4d', '#a98bff', '#ff7a1a'] as const

/** Platform pages that aren't worth an ad, and the game the ads stand round. */
const NOT_ADVERTISED = new Set(['/', '/leaderboard', '/changelog', '/nitro-rush'])

function fallbackLook(label: string): Look {
    let h = 0
    for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    const col = FALLBACK_COLOURS[h % FALLBACK_COLOURS.length]!
    return { bg: ['#0b0b12', '#1e1e2e'], icon: '', sub: 'NOW ON POLYNUX', col }
}

/** Every ad, in catalog order then the house ads. */
export const TRACK_ADS: readonly TrackAd[] = [
    ...NAV_CATALOG.filter(s => !s.adminOnly).flatMap(s => s.items)
        .filter(item => !NOT_ADVERTISED.has(item.to))
        .map((item) => {
            const { title, ...look } = AD_LOOKS[item.to] ?? fallbackLook(item.label)
            return { title: title ?? item.label.toUpperCase(), ...look }
        }),
    ...HOUSE_ADS
]

/** How many different ads one course shows, so it paints only a handful of textures. */
const ADS_PER_COURSE = 12

/**
 * Hands out ads round a course in turn from a random dozen, so neighbours differ and no ad crowds the others out.
 * Cosmetic, so it uses Math.random.
 */
export function adDeck(ads: readonly TrackAd[] = TRACK_ADS, size = ADS_PER_COURSE) {
    const order = ads.map((_, i) => i)
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const swap = order[i]!
        order[i] = order[j]!
        order[j] = swap
    }
    const picked = order.slice(0, Math.min(size, order.length))
    let next = 0
    return () => picked[next++ % picked.length]!
}

export type AdDeck = ReturnType<typeof adDeck>
