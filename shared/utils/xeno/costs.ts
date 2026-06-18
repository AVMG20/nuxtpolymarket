export const XENO_MAX_GRID_SLOTS = 36
export const XENO_MAX_BREEDER_SLOTS = 6

/**
 * Cost to unlock a grid slot at the given 0-based index.
 * On init a player is granted slots 0–5 free, so the first slot actually
 * purchased is index 6. Pricing is exponential (~1.25× per slot, a constant
 * relative increase) rather than the old flat +3 000 ramp: the first bought
 * slots stay affordable for a T3–T4 player (~8k–20k) while the deepest slots
 * climb into the millions to keep pace with T5+ income.
 *   idx 6 ≈ 7.6k · idx 10 ≈ 19k · idx 20 ≈ 174k · idx 30 ≈ 1.6M · idx 35 ≈ 5M
 */
export function gridSlotUnlockCost(slotIndex: number): number {
  if (slotIndex === 0) return 0
  const raw = 2500 * Math.pow(1.25, slotIndex - 1)
  return Math.round(raw / 100) * 100
}

/**
 * Cost to unlock a breeder slot at the given 0-based index. Slot 0 is free on init.
 * Exponential 3× per slot. Realistically players settle on ~3 breeders, so the
 * 1st–2nd extra slots stay reachable mid-game while the 4th–6th become serious
 * endgame investments scaled to T5+ income (instead of topping out at 512k).
 *   idx 1: 30k · idx 2: 90k · idx 3: 270k · idx 4: 810k · idx 5: 2.43M
 */
export function breederSlotUnlockCost(slotIndex: number): number {
  if (slotIndex === 0) return 0
  return Math.round(30000 * Math.pow(3, slotIndex - 1))
}
