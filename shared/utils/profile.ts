// ─── Rakeback ─────────────────────────────────────────────────────────────────
export const RAKEBACK_RATE = 0.005             // 0.5% of wager goes to locked balance
export const RAKEBACK_MIN_RATIO = 1000         // $/gem at small balances
export const RAKEBACK_MAX_RATIO = 5000         // $/gem at large balances
export const RAKEBACK_SCALE_CAP = 50000        // balance at which max ratio kicks in

export function rakebackClaimCost(lockedBalance: number) {
  const t = Math.min(lockedBalance / RAKEBACK_SCALE_CAP, 1)
  const ratio = RAKEBACK_MIN_RATIO + t * (RAKEBACK_MAX_RATIO - RAKEBACK_MIN_RATIO)
  return Math.max(1, Math.ceil(lockedBalance / ratio))
}
