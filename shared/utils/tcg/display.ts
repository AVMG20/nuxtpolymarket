/** Display bounds (§10.5): binders page in nines, shelves row in sixes. */
export const TCG_DISPLAY = {
    maxPerUser: 12,
    nameMaxLength: 40,
    binder: { slotsPerPage: 9, defaultCapacity: 18, maxCapacity: 108 },
    shelf: { slotsPerRow: 6, defaultCapacity: 12, maxCapacity: 48 }
} as const

export type TcgDisplayKind = 'binder' | 'shelf'

export function isDisplayKind(value: string): value is TcgDisplayKind {
    return value === 'binder' || value === 'shelf'
}

/** Valid capacities snap to whole pages/rows. */
export function isValidCapacity(kind: TcgDisplayKind, capacity: number): boolean {
    const bounds = TCG_DISPLAY[kind]
    const unit = kind === 'binder' ? TCG_DISPLAY.binder.slotsPerPage : TCG_DISPLAY.shelf.slotsPerRow
    return Number.isInteger(capacity) && capacity >= unit && capacity <= bounds.maxCapacity && capacity % unit === 0
}
