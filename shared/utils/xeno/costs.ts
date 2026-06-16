export const XENO_MAX_GRID_SLOTS = 36
export const XENO_MAX_BREEDER_SLOTS = 6
export const XENO_SLOT_COST_INCREMENT = 750
export const XENO_STARTING_PLANT_QTY = 2

/** Cost to unlock a grid slot at the given 0-based index. Slot 0 is free (given on init). */
export function gridSlotUnlockCost(slotIndex: number): number {
  if (slotIndex === 0) return 0
  return slotIndex * XENO_SLOT_COST_INCREMENT
}

/** Cost to unlock a breeder slot at the given 0-based index. Slot 0 is free on init. */
export function breederSlotUnlockCost(slotIndex: number): number {
  if (slotIndex === 0) return 0
  return slotIndex * XENO_SLOT_COST_INCREMENT
}
