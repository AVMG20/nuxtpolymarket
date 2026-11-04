// Rail Tycoon — text and number formats the world windows share: cargo names and swatch colours,
// percentages and ages.

import { RT_CARGO_IDS, RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'

/** A cargo index's display name. */
export function rtCargoName(cargo: number): string {
    const id = RT_CARGO_IDS[cargo]
    return id ? RT_CATALOG.cargos[id].name : 'Cargo'
}

/** A cargo index's colour as CSS, for swatches. */
export function rtCargoCss(cargo: number): string {
    const id = RT_CARGO_IDS[cargo]
    const colour = id ? RT_CATALOG.cargos[id].colour : 0x888888
    return `#${colour.toString(16).padStart(6, '0')}`
}

/** value out of max as a whole percentage, clamped to 0 to 100. */
export function rtPercent(value: number, max: number): number {
    if (!(max > 0)) return 0
    return Math.max(0, Math.min(100, Math.round(value * 100 / max)))
}

/** Age in days as the vehicle window shows it: "45 days", "1 year", "3 years". */
export function rtAgeText(days: number): string {
    const years = Math.floor(days / RT_CATALOG.time.yearDays)
    if (years === 0) return `${days} ${days === 1 ? 'day' : 'days'}`
    return `${years} ${years === 1 ? 'year' : 'years'}`
}
