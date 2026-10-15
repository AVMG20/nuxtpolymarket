/**
 * Big-number layer for Hero Quest.
 *
 * This is the only module in the game that imports `break_eternity.js` directly, so
 * swapping the library is a one-file edit. Enemy multipliers grow without bound in an
 * infinite-prestige game, past what any native number or Postgres `numeric` can hold —
 * all math happens here in TS, and the DB only ever stores the `text` form.
 */

import Decimal from 'break_eternity.js'

export { Decimal }
export type DecimalSource = Decimal | number | string

export const ZERO = new Decimal(0)
export const ONE = new Decimal(1)

/** Coerce anything Decimal-shaped into a Decimal. */
export function D(v: DecimalSource): Decimal {
    return v instanceof Decimal ? v : new Decimal(v)
}

export function decPow(base: DecimalSource, exp: DecimalSource): Decimal {
    return D(base).pow(D(exp))
}

export function decMin(a: DecimalSource, b: DecimalSource): Decimal {
    const left = D(a)
    const right = D(b)
    return left.lt(right) ? left : right
}

export function decMax(a: DecimalSource, b: DecimalSource): Decimal {
    const left = D(a)
    const right = D(b)
    return left.gt(right) ? left : right
}

export function decClamp(v: DecimalSource, lo: DecimalSource, hi: DecimalSource): Decimal {
    return decMin(decMax(v, lo), hi)
}

/**
 * Persistence form for `text` columns (`tech-architecture.md` §2). `toString()` on a
 * Decimal is lossless and round-trips through the constructor at any magnitude.
 */
export function toStore(v: DecimalSource): string {
    return D(v).toString()
}

export function fromStore(s: string | null | undefined, fallback: DecimalSource = 0): Decimal {
    if (s === null || s === undefined || s === '') return D(fallback)
    const parsed = new Decimal(s)
    return parsed.isNan() ? D(fallback) : parsed
}

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No']

/**
 * Display formatting for Decimal values. Suffix ladder while the exponent still has a
 * name, scientific notation past it.
 *
 * Deliberately not `app/utils/format-number.ts` — that takes `number | bigint` and
 * cannot see a Decimal at all.
 */
export function formatHq(v: DecimalSource, precision = 2): string {
    const value = D(v)
    if (value.isNan()) return 'NaN'
    if (!value.isFinite()) return value.sign < 0 ? '-∞' : '∞'

    const negative = value.lt(0)
    const abs = negative ? value.neg() : value
    const sign = negative ? '-' : ''

    if (abs.lt(1000)) {
        const n = abs.toNumber()
        return sign + (Number.isInteger(n) ? String(n) : n.toFixed(precision))
    }

    const exponent = abs.log10().floor().toNumber()
    const tier = Math.floor(exponent / 3)

    if (tier < SUFFIXES.length) {
        const scaled = abs.div(D(10).pow(tier * 3)).toNumber()
        return `${sign}${scaled.toFixed(precision)}${SUFFIXES[tier]}`
    }

    const mantissa = abs.div(D(10).pow(exponent)).toNumber()
    return `${sign}${mantissa.toFixed(precision)}e${exponent}`
}

/**
 * A plain number rounded to `decimals` places, two by default: what Hero Quest shows a player and
 * sends over the wire for a display-only float (issue #27). Not for anything the sim, the client's
 * projection or a price check reads back: those stay exact. A non-finite value passes through, and
 * -0 comes out as 0.
 */
export function roundHq(value: number, decimals = 2): number {
    if (!Number.isFinite(value)) return value
    const rounded = Number(value.toFixed(decimals))
    return Object.is(rounded, -0) ? 0 : rounded
}

/** A fraction rounded to what it shows as a percentage at two decimals: 0.123456 → 0.1235 (12.35%). */
export function roundHqFraction(fraction: number): number {
    return roundHq(fraction, 4)
}

/** A number as a player reads it: at most two decimals, no trailing zeros. */
export function hqNumber(value: number): string {
    if (!Number.isFinite(value)) return '0'
    return String(roundHq(value))
}

/** A fraction as a percentage, at most two decimals: 0.12345 → "12.35%". */
export function hqPct(fraction: number): string {
    return `${hqNumber(fraction * 100)}%`
}

/** Human-readable duration, for balance tables and time-to-boss projections. */
export function formatSeconds(seconds: number): string {
    if (!Number.isFinite(seconds)) return '∞'
    if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
    return `${Math.floor(seconds / 86400)}d ${Math.round((seconds % 86400) / 3600)}h`
}
