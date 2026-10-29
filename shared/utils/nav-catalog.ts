/*
 * Every page the sidebar and the home page can link to. Sections marked
 * `fixed` are always in the sidebar; everything else is a game the player
 * chooses to keep there (shared/utils/nav-layout.ts).
 */

export interface NavLink {
    label: string
    icon: string
    to: string
    /** One line for the home page card */
    description?: string
}

export interface NavSection {
    id: string
    label: string
    items: NavLink[]
    /** Always in the sidebar, outside the player's layout */
    fixed?: boolean
    adminOnly?: boolean
    /** Home page category icon and blurb */
    icon?: string
    blurb?: string
}

export const NAV_CATALOG: NavSection[] = [
    {
        id: 'platform',
        label: 'Platform',
        fixed: true,
        items: [
            { label: 'Games', icon: 'i-lucide-house', to: '/' },
            { label: 'Gem Exchange', icon: 'i-lucide-gem', to: '/gem-exchange' },
            { label: 'Bank', icon: 'i-lucide-landmark', to: '/bank' },
            { label: 'Leaderboard', icon: 'i-lucide-trophy', to: '/leaderboard' },
            { label: 'Changelog', icon: 'i-lucide-scroll-text', to: '/changelog' }
        ]
    },
    {
        id: 'idle',
        label: 'Idle Games',
        icon: 'i-lucide-hourglass',
        blurb: 'Build something that keeps earning while you are away',
        items: [
            { label: 'Xeno', icon: 'i-lucide-sprout', to: '/xeno', description: 'Grow, breed and evolve alien plants in your own xeno garden' },
            { label: 'Hack Ops', icon: 'i-lucide-terminal', to: '/hack', description: 'Recruit agents, gear them up and send squads on timed hacking ops' },
            { label: 'Colony', icon: 'i-lucide-bug', to: '/colony', description: 'Breed alien bugs, keep them fed and let them forage while you are away' },
            { label: 'Polytown', icon: 'i-lucide-building-2', to: '/polytown', description: 'Build and level a town of shops, homes and landmarks with an AI advisor' },
            { label: 'Hero Quest', icon: 'i-lucide-swords', to: '/hero-quest', description: 'An idle RPG: your hero fights through stages and bosses on their own' }
        ]
    },
    {
        id: 'active',
        label: 'Active Games',
        icon: 'i-lucide-joystick',
        blurb: 'Hands-on runs, raids and shooters',
        items: [
            { label: 'Void Runner', icon: 'i-lucide-rocket', to: '/void', description: 'Third-person space shooter: crack ore, fight wardens and build a dreadnought' },
            { label: 'Pirate Raid', icon: 'i-lucide-anchor', to: '/pirates', description: 'Build a warship, choose a difficulty and survive a six-minute ocean raid' },
            { label: 'Pathwarden', icon: 'i-lucide-castle', to: '/pathwarden', description: 'Shape an expanding road and build a roguelike tower defense' },
            { label: 'SHAPEZZ', icon: 'i-lucide-shapes', to: '/shapezz', description: 'Endless platform-shooter mayhem with stackable mutations and quick cash-outs' },
            { label: 'Call of Xeno', icon: 'i-lucide-skull', to: '/call-of-xeno', description: 'Fight off alien waves and kit out your loadout at the workbench' },
            { label: 'Voxel Arena', icon: 'i-lucide-boxes', to: '/voxel-arena', description: 'Voxel wave survival: shoot, slash, dash and draft rogue-like upgrades' },
            { label: 'Dead Front', icon: 'i-lucide-crosshair', to: '/dead-front', description: 'Co-op round-based zombies in a ruined 1917 chapel' },
            { label: 'Firewall', icon: 'i-lucide-shield-half', to: '/firewall', description: 'Lane defence over 30 waves with five difficulties and a Mainframe' },
            { label: 'Hackerz', icon: 'i-lucide-skull', to: '/hackerz', description: 'Hold the fence against hackers on a neon 3D grid across 30 waves' },
            { label: 'Riftborn', icon: 'i-lucide-flame-kindling', to: '/riftborn', description: 'Horde-survival roguelike: six classes, wild builds and five bosses' },
            { label: 'Meadowbrawl', icon: 'i-lucide-swords', to: '/meadowbrawl', description: 'Top-down melee roguelite: chain combos and stack absurd boons' },
            { label: 'TCG', icon: 'i-lucide-layers', to: '/tcg', description: 'Open packs, collect cards and build decks for the trading card game' }
        ]
    },
    {
        id: 'casino',
        label: 'Casino',
        icon: 'i-lucide-spade',
        blurb: 'Classic tables and quick-fire originals',
        items: [
            { label: 'Dice', icon: 'i-lucide-dices', to: '/games/dice', description: 'Pick your odds and roll over or under' },
            { label: 'Limbo', icon: 'i-lucide-trending-up', to: '/games/limbo', description: 'Name a multiplier and hope the rocket flies past it' },
            { label: 'Wheel', icon: 'i-lucide-loader-pinwheel', to: '/games/wheel', description: 'Spin the wheel and land on a multiplier' },
            { label: 'Magic Hands', icon: 'i-lucide-hand', to: '/games/magichands', description: 'Place your hands and chase gold multipliers on the grid' },
            { label: 'Live Blackjack', icon: 'i-lucide-spade', to: '/games/live-blackjack', description: 'A real table: five seats, one shoe, everyone sees every card' },
            { label: 'Roulette', icon: 'i-lucide-circle-dot', to: '/games/roulette', description: 'Single-zero European wheel where everyone bets the same layout' },
            { label: 'Baccarat', icon: 'i-lucide-diamond', to: '/games/baccarat', description: 'Punto banco off a shared six-deck shoe with five seats' },
            { label: 'Three Card Poker', icon: 'i-lucide-gem', to: '/games/three-card-poker', description: 'Ante up, then play or fold against the dealer' },
            { label: 'Casino Hold\'em', icon: 'i-lucide-club', to: '/games/casino-holdem', description: 'Five seats, one board: call or fold your two cards against the dealer' },
            { label: 'Neighcasso Derby', icon: 'i-lucide-brush', to: '/games/neighcasso', description: 'Back a painted pony and watch the derby race to the line' }
        ]
    },
    {
        id: 'slots',
        label: 'Slots',
        icon: 'i-lucide-cherry',
        blurb: 'Reels, cascades and free spin features',
        items: [
            { label: 'Xeno Slot', icon: 'i-lucide-cherry', to: '/games/xenoslot', description: '5×3 line-pay reels with a Hold & Win collector bonus' },
            { label: 'Candy Madness', icon: 'i-lucide-lollipop', to: '/games/candymadness', description: '7×7 cluster-pays cascade with stacking multipliers and free spins' },
            { label: 'Aether Gates', icon: 'i-lucide-zap', to: '/games/aethergates', description: 'Volatile tumble slot with relic multipliers and a free spin meter' },
            { label: 'Fire in the Hole', icon: 'i-lucide-flame', to: '/games/fireinthehole', description: 'Mine-shaft tumbles where every drop can blow the column open' },
            { label: 'Book of Shadows', icon: 'i-lucide-book-open', to: '/games/bookofshadows', description: '5×6 zigzag grid with a column-locking fill-the-book bonus' },
            { label: 'Spiñata Slots', icon: 'i-lucide-party-popper', to: '/games/spinata', description: '50 paylines and Festival of Spins free spins' },
            { label: 'Trash Panda Heist', icon: 'i-lucide-trash-2', to: '/games/trashpanda', description: '1,024 ways, sticky multiplier wilds and a Dumpster Dive pick game' },
            { label: 'Ember Portals', icon: 'i-lucide-orbit', to: '/games/emberportals', description: 'Cluster tumbles with portal wilds that grow, merge and stay open' },
            { label: 'PolyMasters', icon: 'i-lucide-plane', to: '/games/polymasters', description: 'Crash game: fly through multipliers, dodge rockets and land to cash out' }
        ]
    },
    {
        id: 'admin',
        label: 'Admin',
        fixed: true,
        adminOnly: true,
        items: [
            { label: 'TCG Admin', icon: 'i-lucide-layers', to: '/tcg-admin' }
        ]
    }
]

/** The image name for a link: the last segment of its route. */
export function navSlug(to: string): string {
    return to.split('/').filter(Boolean).pop() ?? 'home'
}
