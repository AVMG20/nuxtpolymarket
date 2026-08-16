export const XENO_MAX_GRID_SLOTS = 36
export const XENO_MAX_BREEDER_SLOTS = 6

/**
 * Cost to unlock a grid slot at the given 0-based index.
 * On init a player is granted slots 0–5 free, so the first slot actually
 * purchased is index 6. Pricing is exponential (~1.25× per slot, a constant
 * relative increase) rather than the old flat +3 000 ramp: the first bought
 * slots stay affordable for a T3–T4 player (~4k–10k) while the deepest slots
 * climb into the millions to keep pace with T5+ income.
 *   idx 6 ≈ 3.8k · idx 10 ≈ 9.5k · idx 20 ≈ 87k · idx 30 ≈ 810k · idx 35 ≈ 2.5M
 *
 * Halved alongside the plant sell-value cut in plants.ts so the number of
 * harvests a slot costs is unchanged.
 */
export function gridSlotUnlockCost(slotIndex: number): number {
  if (slotIndex === 0) return 0
  const raw = 1250 * Math.pow(1.25, slotIndex - 1)
  return Math.round(raw / 100) * 100
}

/**
 * Cost to unlock a breeder slot at the given 0-based index. Slot 0 is free on init.
 * Exponential 3× per slot. Realistically players settle on ~3 breeders, so the
 * 1st–2nd extra slots stay reachable mid-game while the 4th–6th become serious
 * endgame investments scaled to T5+ income (instead of topping out at 512k).
 *   idx 1: 15k · idx 2: 45k · idx 3: 135k · idx 4: 405k · idx 5: 1.22M
 *
 * Halved alongside the plant sell-value cut in plants.ts, same reasoning as
 * gridSlotUnlockCost above.
 */
export function breederSlotUnlockCost(slotIndex: number): number {
  if (slotIndex === 0) return 0
  return Math.round(15000 * Math.pow(3, slotIndex - 1))
}
