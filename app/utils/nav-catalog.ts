export interface NavLink {
  label: string
  icon: string
  to: string
}

export interface NavSection {
  id: string
  label: string
  items: NavLink[]
  adminOnly?: boolean
}

/** Every sidebar link, in the default order. The player's saved layout
 *  (shared/utils/nav-layout.ts) only reorders and folds these. */
export const NAV_CATALOG: NavSection[] = [
  {
    id: 'platform',
    label: 'Platform',
    items: [
      { label: 'Games', icon: 'i-lucide-house', to: '/' },
      { label: 'AI Assistant', icon: 'i-lucide-bot', to: '/ai' },
      { label: 'Gem Exchange', icon: 'i-lucide-gem', to: '/gem-exchange' },
      { label: 'Bank', icon: 'i-lucide-landmark', to: '/bank' },
      { label: 'Leaderboard', icon: 'i-lucide-trophy', to: '/leaderboard' },
      { label: 'Changelog', icon: 'i-lucide-scroll-text', to: '/changelog' }
    ]
  },
  {
    id: 'idle',
    label: 'Idle Games',
    items: [
      { label: 'Xeno', icon: 'i-lucide-sprout', to: '/xeno' },
      { label: 'Hack Ops', icon: 'i-lucide-terminal', to: '/hack' },
      { label: 'Colony', icon: 'i-lucide-bug', to: '/colony' },
      { label: 'Polytown', icon: 'i-lucide-building-2', to: '/polytown' }
    ]
  },
  {
    id: 'active',
    label: 'Active Games',
    items: [
      { label: 'Void Runner', icon: 'i-lucide-rocket', to: '/void' },
      { label: 'Pirate Raid', icon: 'i-lucide-anchor', to: '/pirates' },
      { label: 'Pathwarden', icon: 'i-lucide-castle', to: '/pathwarden' },
      { label: 'SHAPEZZ', icon: 'i-lucide-shapes', to: '/shapezz' },
      { label: 'Call of Xeno', icon: 'i-lucide-skull', to: '/call-of-xeno' },
      { label: 'Voxel Arena', icon: 'i-lucide-boxes', to: '/voxel-arena' },
      { label: 'Firewall', icon: 'i-lucide-shield-half', to: '/firewall' },
      { label: 'Meadowbrawl', icon: 'i-lucide-swords', to: '/meadowbrawl' },
      { label: 'TCG', icon: 'i-lucide-layers', to: '/tcg' }
    ]
  },
  {
    id: 'casino',
    label: 'Casino',
    items: [
      { label: 'Dice', icon: 'i-lucide-dices', to: '/games/dice' },
      { label: 'Limbo', icon: 'i-lucide-trending-up', to: '/games/limbo' },
      { label: 'Wheel', icon: 'i-lucide-loader-pinwheel', to: '/games/wheel' },
      { label: 'Magic Hands', icon: 'i-lucide-hand', to: '/games/magichands' },
      { label: 'Live Blackjack', icon: 'i-lucide-spade', to: '/games/live-blackjack' },
      { label: 'Roulette', icon: 'i-lucide-circle-dot', to: '/games/roulette' },
      { label: 'Baccarat', icon: 'i-lucide-diamond', to: '/games/baccarat' },
      { label: 'Three Card Poker', icon: 'i-lucide-gem', to: '/games/three-card-poker' },
      { label: 'Casino Hold\'em', icon: 'i-lucide-club', to: '/games/casino-holdem' },
      { label: 'Neighcasso Derby', icon: 'i-lucide-brush', to: '/games/neighcasso' }
    ]
  },
  {
    id: 'slots',
    label: 'Slots',
    items: [
      { label: 'Xeno Slot', icon: 'i-lucide-cherry', to: '/games/xenoslot' },
      { label: 'Candy Madness', icon: 'i-lucide-lollipop', to: '/games/candymadness' },
      { label: 'Aether Gates', icon: 'i-lucide-zap', to: '/games/aethergates' },
      { label: 'Fire in the Hole', icon: 'i-lucide-flame', to: '/games/fireinthehole' },
      { label: 'Book of Shadows', icon: 'i-lucide-book-open', to: '/games/bookofshadows' },
      { label: 'Spiñata Slots', icon: 'i-lucide-party-popper', to: '/games/spinata' },
      { label: 'Trash Panda Heist', icon: 'i-lucide-trash-2', to: '/games/trashpanda' },
      { label: 'Ember Portals', icon: 'i-lucide-orbit', to: '/games/emberportals' },
      { label: 'PolyMasters', icon: 'i-lucide-plane', to: '/games/polymasters' }
    ]
  },
  {
    id: 'admin',
    label: 'Admin',
    adminOnly: true,
    items: [
      { label: 'TCG Admin', icon: 'i-lucide-layers', to: '/tcg-admin' }
    ]
  }
]
