// Xeno Slot's paylines for drawing: the row per reel, left to right. Mirrors
// PAYLINES in shared/utils/gamelogic/xenoslot.ts (not exported there); a line
// win's `line` index points into this list.
export const XENO_PAYLINES: readonly (readonly number[])[] = [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0],
    [2, 1, 0, 1, 2]
]

export const XENO_LINE_COLORS = ['#22d3ee', '#f472b6', '#a3e635', '#facc15', '#c084fc'] as const
