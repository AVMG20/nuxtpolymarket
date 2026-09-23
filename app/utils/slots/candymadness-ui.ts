// Presentation constants for Candy Madness: win tiers, the bet ladder and the
// paytable/odds figures the rules panel shows. Everything here is derived from
// the real game constants in shared/utils/gamelogic/candymadness.ts.
import {
  CANDY_KEYS,
  CANDY_WEIGHTS,
  clusterPayMult,
  CM_CELLS,
  CM_SCATTER_TRIGGER,
  SCATTER_WEIGHT
} from '#shared/utils/gamelogic/candymadness'

/** Celebration tiers, in × bet. The first one opens the big-win overlay. */
export const CANDY_WIN_TIERS = [
  { at: 20, label: 'BIG WIN', from: '#ffe066', to: '#ff8a00', glow: 'rgba(255,170,0,0.8)' },
  { at: 50, label: 'MEGA WIN', from: '#ffb3e1', to: '#ff2f8f', glow: 'rgba(255,60,150,0.85)' },
  { at: 150, label: 'EPIC WIN', from: '#d9b8ff', to: '#8a3dff', glow: 'rgba(150,80,255,0.85)' },
  { at: 500, label: 'LEGENDARY', from: '#b8fff0', to: '#15c8ff', glow: 'rgba(40,210,255,0.9)' }
] as const

export const CANDY_BIG_WIN_AT = CANDY_WIN_TIERS[0].at

/** Bet steps for the − / + buttons. Typed bets can sit between steps. */
export const CANDY_BET_LADDER: number[] = (() => {
  const out: number[] = []
  for (let mag = 1; mag <= 1e11; mag *= 10) {
    for (const m of [1, 2, 5]) {
      const v = m * mag
      if (v <= 1e11) out.push(v)
    }
  }
  return out
})()

/** Cluster sizes shown as paytable columns. */
export const CANDY_PAY_SIZES = [4, 5, 6, 8, 10, 12, 15] as const

export function candyPaytable() {
  return [...CANDY_KEYS].reverse().map(sym => ({
    sym,
    pays: CANDY_PAY_SIZES.map(n => clusterPayMult(sym, n))
  }))
}

/** Compact × bet figure: 2 significant digits for tiny values. */
export function formatPayMult(x: number): string {
  if (x >= 1) return x.toFixed(2).replace(/\.?0+$/, '')
  return Number(x.toPrecision(2)).toString()
}

function choose(n: number, k: number) {
  let r = 1
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1)
  return r
}

/** P(at least `need` scatters among `cells` independent cells). */
function pAtLeast(cells: number, need: number) {
  const total = CANDY_KEYS.reduce((a, k) => a + CANDY_WEIGHTS[k], 0) + SCATTER_WEIGHT
  const p = SCATTER_WEIGHT / total
  let less = 0
  for (let k = 0; k < need; k++) less += choose(cells, k) * p ** k * (1 - p) ** (cells - k)
  return 1 - less
}

/** Average spins per bonus on a normal spin ("1 in N"). */
export const CANDY_BONUS_ODDS = Math.round(1 / pAtLeast(CM_CELLS, CM_SCATTER_TRIGGER))

/** Same with Bonus Hunter on: one scatter is guaranteed, the other 48 cells roll as usual. */
export const CANDY_HUNT_BONUS_ODDS = Math.round(1 / pAtLeast(CM_CELLS - 1, CM_SCATTER_TRIGGER - 1))
