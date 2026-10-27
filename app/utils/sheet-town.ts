import type { TownState } from '../composables/useTown'
import { rankTownUpgrades, townBoostedNet, townCanAfford, townTicksPerHour, townUpgradeCandidates } from '#shared/utils/gamelogic/town-advisor'

// Polytown's recommended upgrades for spreadsheet mode, built from the state
// payload with the same shared pieces the builders popover uses
// (recommendedUpgrades in TownGame.client.vue).

export function townRecommendations(state: TownState, balance: number, now = Date.now()) {
  const stock = state.inventory ?? {}
  const catalog = new Map(state.catalog.map(entry => [entry.id, entry] as const))
  const candidates = townUpgradeCandidates(state.buildings ?? [], catalog, state.constants.maxLevel, now,
    cost => townCanAfford(cost, balance, stock))

  const perHour = townTicksPerHour(state.constants.tickMs, state.speedMultiplier)
  const net = townBoostedNet(state.netPerTick ?? {}, state.needs ?? [], state.boostMultiplier?.production ?? 1)

  return rankTownUpgrades({
    jobs: state.workersDemanded ?? 0,
    residents: state.popCap ?? 0,
    happiness: state.happiness ?? 50,
    storageCap: state.storageCap ?? 0,
    netPerHour: Object.fromEntries(Object.entries(net).map(([id, n]) => [id, n * perHour])),
    stock
  }, candidates)
}
