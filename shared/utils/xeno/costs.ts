export const XENO_MAX_GRID_SLOTS = 36
export const XENO_MAX_BREEDER_SLOTS = 6

/** Cost to unlock a grid slot at the given 0-based index. Slot 0 is free (given on init). */
export function gridSlotUnlockCost(slotIndex: number): number {
  if (slotIndex === 0) return 0
  // Base 5 000, +3 000 per additional slot
  return 1000 + (slotIndex - 1) * 3000
}

/** Cost to unlock a breeder slot at the given 0-based index. Slot 0 is free on init. */
export function breederSlotUnlockCost(slotIndex: number): number {
    if (slotIndex === 0) return 0
    // 32 000 for slot 1, doubling each time: 32k, 64k, 128k, 256k, 512k
    return 32000 * Math.pow(2, slotIndex - 1)
}
