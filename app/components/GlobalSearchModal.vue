<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'

const { isOpen } = useGlobalSearch()
const router = useRouter()
const searchTerm = ref('')

defineShortcuts({
  meta_k: () => {
    isOpen.value = !isOpen.value
  }
})

watch(isOpen, (val) => {
  if (val) {
    searchTerm.value = ''
  }
})

function handleSelect(item?: CommandPaletteItem) {
  if (item && item.to) {
    isOpen.value = false
    router.push(item.to as string)
  }
}

const rawGroups: CommandPaletteGroup[] = [
  {
    id: 'platform',
    label: 'Platform & Navigation',
    items: [
      {
        id: 'home',
        label: 'Games Overview',
        description: 'Browse all active games, idle games, slots, and casino',
        icon: 'i-lucide-house',
        to: '/',
        keywords: ['home', 'dashboard', 'games', 'hub', 'index', 'main']
      },
      {
        id: 'ai',
        label: 'AI Assistant',
        description: 'Chat with Polynux AI assistant',
        icon: 'i-lucide-bot',
        to: '/ai',
        keywords: ['ai', 'chat', 'bot', 'assistant', 'help', 'gpt']
      },
      {
        id: 'ai-wiki',
        parentId: 'ai',
        isSubpage: true,
        treePrefix: '└──',
        label: 'Wiki & Guide',
        description: 'Documentation, guides, and system prompts for AI',
        icon: 'i-lucide-book-open',
        to: '/ai-wiki',
        keywords: ['ai', 'wiki', 'docs', 'manual', 'help', 'guide']
      },
      {
        id: 'gem-exchange',
        label: 'Gem Exchange',
        description: 'Convert coins to gems and trade platform currency',
        icon: 'i-lucide-gem',
        to: '/gem-exchange',
        keywords: ['gems', 'coins', 'exchange', 'trade', 'shop', 'convert']
      },
      {
        id: 'bank',
        label: 'Bank & Vault',
        description: 'Interest rates, deposits, balance vault, and loans',
        icon: 'i-lucide-landmark',
        to: '/bank',
        keywords: ['bank', 'vault', 'deposit', 'withdraw', 'interest', 'money', 'finance']
      },
      {
        id: 'leaderboard',
        label: 'Global Leaderboard',
        description: 'Global player rankings, net worth, and top wagers',
        icon: 'i-lucide-trophy',
        to: '/leaderboard',
        keywords: ['rankings', 'top', 'leaderboard', 'players', 'scores', 'standings']
      },
      {
        id: 'analytics',
        label: 'Analytics',
        description: 'Detailed player statistics, win rates, and history',
        icon: 'i-lucide-bar-chart-3',
        to: '/analytics',
        keywords: ['stats', 'analytics', 'charts', 'history', 'performance', 'metrics']
      },
      {
        id: 'profile',
        label: 'Profile & Settings',
        description: 'Account security, display name, rakeback, linked accounts',
        icon: 'i-lucide-user',
        to: '/profile',
        keywords: ['profile', 'account', 'settings', 'rakeback', 'password', 'email', 'security']
      },
      {
        id: 'profile-emblem',
        parentId: 'profile',
        isSubpage: true,
        treePrefix: '└──',
        label: 'Emblem Editor',
        description: 'Design and customize your pixel art emblem avatar',
        icon: 'i-lucide-palette',
        to: '/profile/emblem',
        keywords: ['emblem', 'avatar', 'pixel', 'editor', 'customize', 'logo', 'design']
      },
      {
        id: 'changelog',
        label: 'Changelog',
        description: 'Recent platform updates, feature releases, and patch notes',
        icon: 'i-lucide-scroll-text',
        to: '/changelog',
        keywords: ['updates', 'changelog', 'news', 'version', 'releases', 'notes']
      }
    ]
  },
  {
    id: 'miner',
    label: 'Miner (Idle Game)',
    items: [
      {
        id: 'miner-overview',
        label: 'Miner Overview',
        description: 'Idle mining rig, GPU hashing, and ore extraction',
        icon: 'i-lucide-pickaxe',
        to: '/miner',
        keywords: ['miner', 'mining', 'rig', 'gpu', 'ore', 'hash', 'idle']
      },
      {
        id: 'miner-factory',
        parentId: 'miner-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Factory',
        description: 'Automated factory pipelines and production lines',
        icon: 'i-lucide-factory',
        to: '/miner/factory',
        keywords: ['miner', 'factory', 'automation', 'machines', 'production', 'pipeline']
      },
      {
        id: 'miner-shop',
        parentId: 'miner-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Shop',
        description: 'Upgrade mining hardware, pickaxes, and power efficiency',
        icon: 'i-lucide-store',
        to: '/miner/shop',
        keywords: ['miner', 'shop', 'hardware', 'pickaxe', 'buy', 'upgrades', 'store']
      },
      {
        id: 'miner-lootbox',
        parentId: 'miner-overview',
        isSubpage: true,
        treePrefix: '└──',
        label: 'Lootboxes',
        description: 'Unbox rare mining gear, GPUs, and bonus chips',
        icon: 'i-lucide-gift',
        to: '/miner/lootbox',
        keywords: ['miner', 'lootbox', 'crates', 'unboxing', 'rewards', 'chest']
      }
    ]
  },
  {
    id: 'xeno',
    label: 'Xeno (Idle Game)',
    items: [
      {
        id: 'xeno-garden',
        label: 'Xeno Garden',
        description: 'Cultivate alien plants, manage garden plots, harvest biomass',
        icon: 'i-lucide-sprout',
        to: '/xeno',
        keywords: ['xeno', 'garden', 'plants', 'biomass', 'harvest', 'idle', 'sprout']
      },
      {
        id: 'xeno-breeder',
        parentId: 'xeno-garden',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Breeder',
        description: 'Cross-breed alien strains and mutate genetic traits',
        icon: 'i-lucide-dna',
        to: '/xeno/breeder',
        keywords: ['xeno', 'breeder', 'genetics', 'dna', 'crossbreed', 'mutation', 'strains']
      },
      {
        id: 'xeno-market',
        parentId: 'xeno-garden',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Market',
        description: 'Buy and sell rare Xeno specimens, seeds, and fertilizer',
        icon: 'i-lucide-store',
        to: '/xeno/market',
        keywords: ['xeno', 'market', 'sell', 'buy', 'seeds', 'store', 'fertilizer']
      },
      {
        id: 'xeno-artifacts',
        parentId: 'xeno-garden',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Artifacts',
        description: 'Equip mystical Xeno relics for passive stat boosts',
        icon: 'i-lucide-gem',
        to: '/xeno/artifacts',
        keywords: ['xeno', 'artifacts', 'relics', 'equipment', 'boosts', 'passives']
      },
      {
        id: 'xeno-encyclopedia',
        parentId: 'xeno-garden',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Xenopedia',
        description: 'Complete catalog of all discovered alien species and traits',
        icon: 'i-lucide-book-open',
        to: '/xeno/encyclopedia',
        keywords: ['xeno', 'encyclopedia', 'xenopedia', 'catalog', 'species', 'guide', 'wiki']
      },
      {
        id: 'xeno-leaderboard',
        parentId: 'xeno-garden',
        isSubpage: true,
        treePrefix: '└──',
        label: 'Leaderboard',
        description: 'Rankings of top Xeno botanists and species collectors',
        icon: 'i-lucide-trophy',
        to: '/xeno/leaderboard',
        keywords: ['xeno', 'leaderboard', 'rankings', 'top', 'botanist']
      }
    ]
  },
  {
    id: 'hack',
    label: 'Hack Ops (Idle Game)',
    items: [
      {
        id: 'hack-overview',
        label: 'Hack Ops Control',
        description: 'Deploy cyber squads on stealth hack operations',
        icon: 'i-lucide-terminal',
        to: '/hack',
        keywords: ['hack', 'cyber', 'ops', 'missions', 'stealth', 'terminal', 'briefing']
      },
      {
        id: 'hack-market',
        parentId: 'hack-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Black Market',
        description: 'Purchase exploits, cyberdeck chips, and gear upgrades',
        icon: 'i-lucide-store',
        to: '/hack/market',
        keywords: ['hack', 'market', 'shop', 'exploits', 'cyberdeck', 'buy', 'black market']
      },
      {
        id: 'hack-agents',
        parentId: 'hack-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Agents',
        description: 'Recruit and manage your elite hacker squad',
        icon: 'i-lucide-users',
        to: '/hack/agents',
        keywords: ['hack', 'agents', 'squad', 'roster', 'hackers', 'team', 'operatives']
      },
      {
        id: 'hack-loadout',
        parentId: 'hack-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Loadout',
        description: 'Configure weapons, cyberimplants, and armor per agent',
        icon: 'i-lucide-shield-half',
        to: '/hack/loadout',
        keywords: ['hack', 'loadout', 'gear', 'weapons', 'equipment', 'armory', 'cyberware']
      },
      {
        id: 'hack-items',
        parentId: 'hack-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Items',
        description: 'Inventory of software modules, hardware, and RAM chips',
        icon: 'i-lucide-cpu',
        to: '/hack/items',
        keywords: ['hack', 'items', 'inventory', 'chips', 'software', 'modules', 'hardware']
      },
      {
        id: 'hack-upgrade',
        parentId: 'hack-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Upgrades',
        description: 'Train agent attributes, hacking power, and skill trees',
        icon: 'i-lucide-arrow-up-circle',
        to: '/hack/upgrade',
        keywords: ['hack', 'upgrade', 'skills', 'level', 'training', 'power', 'attributes']
      },
      {
        id: 'hack-history',
        parentId: 'hack-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'History',
        description: 'Review logs of completed ops, loot drops, and payouts',
        icon: 'i-lucide-history',
        to: '/hack/history',
        keywords: ['hack', 'history', 'logs', 'reports', 'past', 'payouts']
      },
      {
        id: 'hack-leaderboard',
        parentId: 'hack-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Leaderboard',
        description: 'Top hacker operators ranked by power and successful ops',
        icon: 'i-lucide-trophy',
        to: '/hack/leaderboard',
        keywords: ['hack', 'leaderboard', 'rankings', 'top', 'operators']
      },
      {
        id: 'hack-wiki',
        parentId: 'hack-overview',
        isSubpage: true,
        treePrefix: '└──',
        label: 'Tactical Wiki',
        description: 'Tactical guide, agent classes, enemy firewalls, and mechanics',
        icon: 'i-lucide-book-open',
        to: '/hack/wiki',
        keywords: ['hack', 'wiki', 'guide', 'manual', 'tactics', 'strategy', 'help']
      }
    ]
  },
  {
    id: 'colony',
    label: 'Colony (Idle Game)',
    items: [
      {
        id: 'colony-overview',
        label: 'Colony Terrarium',
        description: 'Manage ant nest, ant population, and queen egg laying',
        icon: 'i-lucide-bug',
        to: '/colony',
        keywords: ['colony', 'ants', 'terrarium', 'nest', 'queen', 'idle', 'insects']
      },
      {
        id: 'colony-market',
        parentId: 'colony-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Market',
        description: 'Trade larvae, buy sugar water, fungus, and special queens',
        icon: 'i-lucide-store',
        to: '/colony/market',
        keywords: ['colony', 'market', 'store', 'buy', 'food', 'larvae', 'fungus']
      },
      {
        id: 'colony-habitat',
        parentId: 'colony-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Habitat',
        description: 'Expand underground nest tunnels and climate chambers',
        icon: 'i-lucide-home',
        to: '/colony/habitat',
        keywords: ['colony', 'habitat', 'chambers', 'tunnels', 'nest', 'expand', 'rooms']
      },
      {
        id: 'colony-research',
        parentId: 'colony-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Research',
        description: 'Mutate ant genetics and research colony efficiency skills',
        icon: 'i-lucide-flask-conical',
        to: '/colony/research',
        keywords: ['colony', 'research', 'tech', 'mutations', 'science', 'tree', 'lab']
      },
      {
        id: 'colony-encyclopedia',
        parentId: 'colony-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Colonopedia',
        description: 'Ant species guide, worker roles, and pheromone mechanics',
        icon: 'i-lucide-book-open',
        to: '/colony/encyclopedia',
        keywords: ['colony', 'encyclopedia', 'colonopedia', 'guide', 'ants', 'wiki']
      },
      {
        id: 'colony-leaderboard',
        parentId: 'colony-overview',
        isSubpage: true,
        treePrefix: '└──',
        label: 'Leaderboard',
        description: 'Top ant colonies ranked by nest population',
        icon: 'i-lucide-trophy',
        to: '/colony/leaderboard',
        keywords: ['colony', 'leaderboard', 'rankings', 'top', 'population']
      }
    ]
  },
  {
    id: 'pathwarden',
    label: 'Pathwarden (Active Game)',
    items: [
      {
        id: 'pathwarden-overview',
        label: 'Pathwarden',
        description: 'Tower defense strategy game - defend against wave attacks',
        icon: 'i-lucide-castle',
        to: '/pathwarden',
        keywords: ['pathwarden', 'tower', 'defense', 'waves', 'castle', 'strategy', 'td']
      },
      {
        id: 'pathwarden-shop',
        parentId: 'pathwarden-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Shop',
        description: 'Unlock defensive towers, elemental powers, and relics',
        icon: 'i-lucide-store',
        to: '/pathwarden/shop',
        keywords: ['pathwarden', 'shop', 'towers', 'buy', 'store', 'upgrades', 'relics']
      },
      {
        id: 'pathwarden-wiki',
        parentId: 'pathwarden-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Field Guide',
        description: 'Strategy manual, tower stats, and enemy encyclopedia',
        icon: 'i-lucide-book-open',
        to: '/pathwarden/wiki',
        keywords: ['pathwarden', 'wiki', 'guide', 'towers', 'enemies', 'strategy', 'manual']
      },
      {
        id: 'pathwarden-leaderboard',
        parentId: 'pathwarden-overview',
        isSubpage: true,
        treePrefix: '└──',
        label: 'Rankings',
        description: 'Defenders leaderboard ranked by highest wave reached',
        icon: 'i-lucide-trophy',
        to: '/pathwarden/leaderboard',
        keywords: ['pathwarden', 'leaderboard', 'rankings', 'top', 'waves']
      }
    ]
  },
  {
    id: 'pirates',
    label: 'Pirate Raid (Active Game)',
    items: [
      {
        id: 'pirates-overview',
        label: 'Pirate Raid',
        description: 'Naval combat game - battle sea monsters and rival fleets',
        icon: 'i-lucide-sailboat',
        to: '/pirates',
        keywords: ['pirates', 'raid', 'sail', 'ship', 'ocean', 'battles', 'naval', 'sea']
      },
      {
        id: 'pirates-manage',
        parentId: 'pirates-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Shipyard',
        description: 'Upgrade cannons, armor plating, sails, and crew strength',
        icon: 'i-lucide-hammer',
        to: '/pirates/manage',
        keywords: ['pirates', 'shipyard', 'manage', 'ship', 'cannons', 'hull', 'upgrades', 'crew']
      },
      {
        id: 'pirates-history',
        parentId: 'pirates-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Logbook',
        description: 'Review battle history, sunken ships, and plunder gained',
        icon: 'i-lucide-scroll-text',
        to: '/pirates/history',
        keywords: ['pirates', 'history', 'logbook', 'past', 'raids', 'plunder']
      },
      {
        id: 'pirates-wiki',
        parentId: 'pirates-overview',
        isSubpage: true,
        treePrefix: '├──',
        label: 'Field Guide',
        description: 'Guide to ship systems, active abilities, and power-up combos',
        icon: 'i-lucide-book-open',
        to: '/pirates/wiki',
        keywords: ['pirates', 'wiki', 'guide', 'abilities', 'powerups', 'manual', 'ship']
      },
      {
        id: 'pirates-leaderboard',
        parentId: 'pirates-overview',
        isSubpage: true,
        treePrefix: '└──',
        label: 'Leaderboard',
        description: 'Most notorious pirate captains ranked by plunder',
        icon: 'i-lucide-trophy',
        to: '/pirates/leaderboard',
        keywords: ['pirates', 'leaderboard', 'rankings', 'top', 'captains']
      }
    ]
  },
  {
    id: 'shapezz',
    label: 'SHAPEZZ & Active Games',
    items: [
      {
        id: 'shapezz-overview',
        label: 'SHAPEZZ Arena',
        description: 'Fast-paced arcade geometry combat game',
        icon: 'i-lucide-crosshair',
        to: '/shapezz',
        keywords: ['shapezz', 'arena', 'arcade', 'shapes', 'shooter', 'action', 'geometry']
      },
      {
        id: 'shapezz-workshop',
        parentId: 'shapezz-overview',
        isSubpage: true,
        treePrefix: '└──',
        label: 'Workshop',
        description: 'Craft custom weapons, weapon mods, and geometry shapes',
        icon: 'i-lucide-wrench',
        to: '/shapezz/workshop',
        keywords: ['shapezz', 'workshop', 'crafting', 'weapons', 'mods', 'shapes']
      },
      {
        id: 'firewall',
        label: 'Firewall',
        description: 'Cyber defense puzzle game - stop incoming malicious packets',
        icon: 'i-lucide-shield-half',
        to: '/firewall',
        keywords: ['firewall', 'security', 'cyber', 'defense', 'packets', 'puzzle']
      },
      {
        id: 'storm-the-house',
        label: 'Storm the House',
        description: 'Defend your stronghold against relentless enemy waves',
        icon: 'i-lucide-swords',
        to: '/storm-the-house',
        keywords: ['storm', 'house', 'defense', 'waves', 'shooter', 'castle']
      }
    ]
  },
  {
    id: 'casino',
    label: 'Casino & Slots',
    items: [
      {
        id: 'dice',
        label: 'Dice',
        description: 'Set win chance, roll over or under for instant multiplier payouts',
        icon: 'i-lucide-dices',
        to: '/games/dice',
        keywords: ['dice', 'casino', 'gamble', 'multiplier', 'wager', 'roll', 'chance']
      },
      {
        id: 'limbo',
        label: 'Limbo',
        description: 'Target high target multipliers up to 10,000x',
        icon: 'i-lucide-trending-up',
        to: '/games/limbo',
        keywords: ['limbo', 'casino', 'multiplier', 'wager', 'rocket', 'target']
      },
      {
        id: 'wheel',
        label: 'Wheel',
        description: 'Risk segment wheel spin with low to extreme volatility',
        icon: 'i-lucide-loader-pinwheel',
        to: '/games/wheel',
        keywords: ['wheel', 'spin', 'casino', 'gamble', 'wager', 'roulette']
      },
      {
        id: 'magichands',
        label: 'Magic Hands',
        description: 'Shell game card picker - double your wager each pick',
        icon: 'i-lucide-hand',
        to: '/games/magichands',
        keywords: ['magic', 'hands', 'shell', 'cards', 'casino', 'gamble', 'picker']
      },
      {
        id: 'blackjack',
        label: 'Blackjack',
        description: 'Classic 21 blackjack table - hit, stand, double down, or split',
        icon: 'i-lucide-spade',
        to: '/games/live-blackjack',
        keywords: ['blackjack', 'cards', '21', 'table', 'casino', 'gamble', 'dealer']
      },
      {
        id: 'xenoslot',
        label: 'Xeno Slot',
        description: 'Alien organism slot machine with expanding bio-reels',
        icon: 'i-lucide-cherry',
        to: '/games/xenoslot',
        keywords: ['slots', 'xenoslot', 'xeno', 'casino', 'reels', 'spin']
      },
      {
        id: 'candymadness',
        label: 'Candy Madness',
        description: 'Cascading candy slot machine with sugar multipliers',
        icon: 'i-lucide-lollipop',
        to: '/games/candymadness',
        keywords: ['slots', 'candymadness', 'candy', 'casino', 'reels', 'spin']
      },
      {
        id: 'aethergates',
        label: 'Aether Gates',
        description: 'Sci-fi portal slot machine with cosmic wild symbols',
        icon: 'i-lucide-zap',
        to: '/games/aethergates',
        keywords: ['slots', 'aethergates', 'aether', 'casino', 'reels', 'spin']
      },
      {
        id: 'fireinthehole',
        label: 'Fire in the Hole',
        description: 'Mining slot machine with dynamite sticky bonus spins',
        icon: 'i-lucide-flame',
        to: '/games/fireinthehole',
        keywords: ['slots', 'fireinthehole', 'mining', 'dynamite', 'casino', 'spin']
      },
      {
        id: 'bookofshadows',
        label: 'Book of Shadows',
        description: 'Occult spellbook slots with expanding free spin symbols',
        icon: 'i-lucide-book-open',
        to: '/games/bookofshadows',
        keywords: ['slots', 'bookofshadows', 'shadows', 'magic', 'casino', 'spin']
      },
      {
        id: 'spinata',
        label: 'Spiñata Slots',
        description: 'Fiesta piñata slot machine with candy bonus bursts',
        icon: 'i-lucide-party-popper',
        to: '/games/spinata',
        keywords: ['slots', 'spinata', 'pinata', 'fiesta', 'casino', 'spin']
      }
    ]
  }
]

// Decorate groups so postFilter always includes the parent item whenever a subpage matches
const groups = computed(() => {
  return rawGroups.map(group => {
    const originalItems = group.items || []
    return {
      ...group,
      postFilter: (searchTerm: string, matchedItems: CommandPaletteItem[]) => {
        if (!searchTerm || !searchTerm.trim()) return matchedItems

        const parentIdsNeeded = new Set<string>()
        for (const item of matchedItems) {
          if (item.parentId) {
            parentIdsNeeded.add(item.parentId)
          }
        }

        if (parentIdsNeeded.size === 0) return matchedItems

        const result: CommandPaletteItem[] = []
        const addedIds = new Set<string>()

        for (const fullItem of originalItems) {
          if (matchedItems.some(m => m.id === fullItem.id) || parentIdsNeeded.has(fullItem.id)) {
            if (!addedIds.has(fullItem.id)) {
              result.push(fullItem)
              addedIds.add(fullItem.id)
            }
          }
        }
        return result
      }
    }
  })
})

// All flat items for matching when pressing Enter
const allItems = computed(() => rawGroups.flatMap(g => g.items || []))

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && searchTerm.value.trim()) {
    const q = searchTerm.value.toLowerCase().trim()
    const matches = allItems.value.filter(item => {
      const text = `${item.label} ${item.description || ''} ${(item.keywords || []).join(' ')}`.toLowerCase()
      return text.includes(q)
    })
    // If a subpage matches, pick the matching subpage (or first match)
    const target = matches.find(m => m.isSubpage) || matches[0]
    if (target) {
      e.preventDefault()
      handleSelect(target)
    }
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :ui="{
      content: 'fixed top-12 sm:top-16 left-1/2 -translate-x-1/2 translate-y-0 p-0 w-[calc(100vw-2rem)] sm:max-w-xl max-h-[480px] overflow-hidden rounded-xl border border-default/80 shadow-2xl bg-elevated/95 backdrop-blur-xl'
    }"
  >
    <template #content>
      <div @keydown="onKeyDown">
        <UCommandPalette
          v-model:search-term="searchTerm"
          size="sm"
          placeholder="Search pages or subpages..."
          :groups="groups"
          :fuse="{
            fuseOptions: {
              keys: ['label', 'description', 'keywords'],
              threshold: 0.35,
              ignoreLocation: true
            },
            resultLimit: 10
          }"
          :ui="{
            viewport: 'max-h-[360px] p-1.5',
            item: 'p-0 my-0.5 rounded-lg cursor-pointer data-highlighted:bg-primary/15 transition-colors'
          }"
          close
          @update:model-value="handleSelect"
        >
          <template #item="{ item }">
            <div
              class="flex items-start gap-2.5 w-full py-2 rounded-lg transition-colors group-data-highlighted:bg-primary/15 px-3"
            >
              <!-- Tree branch symbol on far left for subpages -->
              <span
                v-if="item.isSubpage"
                class="font-mono text-muted/70 text-xs shrink-0 select-none pt-0.5"
              >
                {{ item.treePrefix || '├──' }}
              </span>

              <!-- Item icon -->
              <UIcon
                v-if="item.icon"
                :name="item.icon"
                class="size-4 shrink-0 text-muted group-data-highlighted:text-primary pt-0.5 transition-colors"
              />

              <!-- Label & Description -->
              <div class="flex-1 min-w-0 text-start">
                <div class="flex items-center gap-1.5 truncate text-xs font-semibold text-highlighted group-data-highlighted:text-primary">
                  <span>{{ item.label }}</span>
                </div>
                <p v-if="item.description" class="truncate text-[11px] text-muted font-normal mt-0.5">
                  {{ item.description }}
                </p>
              </div>
            </div>
          </template>
        </UCommandPalette>
      </div>
    </template>
  </UModal>
</template>
