import type { ModifierKind } from '#shared/utils/hero-quest/modifiers'

const KIND_LABELS: Readonly<Record<Exclude<ModifierKind, 'stat'>, string>> = {
    maxHp: 'Max HP',
    critChance: 'Crit chance',
    critDamage: 'Crit damage',
    enemyDefShred: 'Enemy DEF ignored',
    damageTaken: 'Damage taken',
    gold: 'Gold',
    xp: 'XP',
    offlineEfficiency: 'Offline gain',
    cooldown: 'Cooldowns',
    controlResist: 'Control resist',
    reflect: 'Damage reflected'
}

/** Kinds whose magnitude takes something away, so they read with a minus. */
const REDUCING: ReadonlySet<ModifierKind> = new Set<ModifierKind>(['damageTaken', 'cooldown'])

/** A fraction as a percentage, with enough decimals that a small bonus does not read as 0%. */
export function hqPercent(fraction: number): string {
    const v = Math.abs(fraction) * 100
    // trailing zeros dropped, so a round bonus reads 5% rather than 5.0%
    return `${Number(v.toFixed(v >= 10 ? 0 : v >= 1 ? 1 : 2))}%`
}

/** One modifier line for a player: "PWR +1.5%", "Cooldowns -4%". */
export function hqEffectLine(kind: ModifierKind, stat: string | undefined, magnitude: number): string {
    const label = kind === 'stat' ? (stat ?? '').toUpperCase() : KIND_LABELS[kind]
    return `${label} ${REDUCING.has(kind) ? '-' : '+'}${hqPercent(magnitude)}`
}
