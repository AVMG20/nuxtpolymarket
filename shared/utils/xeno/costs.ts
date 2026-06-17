export const XENO_MAX_GRID_SLOTS = 36
export const XENO_MAX_BREEDER_SLOTS = 6
export const XENO_STARTING_PLANT_QTY = 2

/** Cost to unlock a grid slot at the given 0-based index. Slot 0 is free (given on init). */
export function gridSlotUnlockCost(slotIndex: number): number {
  if (slotIndex === 0) return 0
  // Base 5 000, +2 500 per additional slot
  return 5000 + (slotIndex - 1) * 2500
}

/** Cost to unlock a breeder slot at the given 0-based index. Slot 0 is free on init. */
export function breederSlotUnlockCost(slotIndex: number): number {
  if (slotIndex === 0) return 0
  // 5 000 for slot 1, doubling each time: 5k, 10k, 20k, 40k, 80k
  return 5000 * Math.pow(2, slotIndex - 1)
}
