import type { TownState } from '../composables/useTown'
import { getTownBuilding, townLevelCost } from '#shared/utils/gamelogic/town'
import { rankTownUpgrades } from '#shared/utils/gamelogic/town-advisor'

// Polytown's recommended upgrades for spreadsheet mode, built from the state
// payload the same way the builders popover builds them (recommendedUpgrades
// in TownGame.client.vue): one candidate per building type at its lowest
// free level, ranked by rankTownUpgrades.

export interface SheetTownUpgrade {
  id: string
  type: string
  name: string
  level: number
  tier: number
  affordable: boolean
  cost: { coins: number, resources: Record<string, number> }
}

export function townRecommendations(state: TownState, balance: number, now = Date.now()) {
  const inventory = state.inventory ?? {}
  const catalog = new Map(state.catalog.map(entry => [entry.id, entry]))
  const cap = state.constants.maxLevel

  const canAfford = (cost: SheetTownUpgrade['cost']) => balance >= cost.coins
    && Object.entries(cost.resources).every(([id, q]) => (inventory[id] ?? 0) >= q)

  const rows: SheetTownUpgrade[] = []
  for (const b of state.buildings ?? []) {
    const entry = catalog.get(b.type)
    const def = getTownBuilding(b.type)
    if (!entry || !def || entry.kind === 'road' || entry.kind === 'monument') continue
    if (b.level <= 0 || b.upgradingTo !== null || b.completesAt > now) continue
    if (b.level >= (entry.maxLevel ?? cap)) continue
    const cost = townLevelCost(def, b.level + 1)
    rows.push({ id: b.id, type: b.type, name: entry.name, level: b.level, tier: entry.tier, affordable: canAfford(cost), cost })
  }
  rows.sort((a, b) => a.tier - b.tier || a.level - b.level)
  const seen = new Set<string>()
  const candidates = rows.filter(r => !seen.has(r.type) && seen.add(r.type))

  // A production surge doubles what workshops make and use, not what the townsfolk eat
  const surge = (state.boosts?.production ?? 0) > now ? 2 : 1
  const eaten: Record<string, number> = {}
  for (const need of state.needs ?? []) {
    if (need.active) eaten[need.resource] = (eaten[need.resource] ?? 0) + need.perTick
  }
  const net = state.netPerTick ?? {}
  const ticksPerHour = (3_600_000 / state.constants.tickMs) * (state.speedMultiplier ?? 0.75)
  const netPerHour: Record<string, number> = {}
  for (const id of new Set([...Object.keys(net), ...Object.keys(eaten)])) {
    const e = eaten[id] ?? 0
    netPerHour[id] = (((net[id] ?? 0) + e) * surge - e) * ticksPerHour
  }

  return rankTownUpgrades({
    jobs: state.workersDemanded ?? 0,
    residents: state.popCap ?? 0,
    happiness: state.happiness ?? 50,
    storageCap: state.storageCap ?? 0,
    netPerHour,
    stock: inventory
  }, candidates)
}
