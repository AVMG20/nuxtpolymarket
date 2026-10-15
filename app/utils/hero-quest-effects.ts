import type { ModifierKind } from '#shared/utils/hero-quest/modifiers'
import { MODIFIER_LABELS, REDUCING_MODIFIERS } from '#shared/utils/hero-quest/describe'

/** A fraction as a percentage, with enough decimals that a small bonus does not read as 0%. */
export function hqPercent(fraction: number): string {
    const v = Math.abs(fraction) * 100
    // trailing zeros dropped, so a round bonus reads 5% rather than 5.0%
    return `${Number(v.toFixed(v >= 10 ? 0 : v >= 1 ? 1 : 2))}%`
}

/**
 * One modifier line for a player, rounded for a glance: "PWR +1.5%", "Cooldowns -4%". The
 * Collections detail prints the exact line instead with Detailed descriptions on (`describe.modifierLine`).
 */
export function hqEffectLine(kind: ModifierKind, stat: string | undefined, magnitude: number): string {
    const label = kind === 'stat' ? (stat ?? '').toUpperCase() : MODIFIER_LABELS[kind]
    return `${label} ${REDUCING_MODIFIERS.has(kind) ? '-' : '+'}${hqPercent(magnitude)}`
}
