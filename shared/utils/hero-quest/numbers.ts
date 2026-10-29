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

/** How big numbers read, picked in Settings (`numberNotation`): 1.23e16 as `1.23e16`, `12.30Qa` or `12.30AA`. */
export const HQ_NOTATIONS = ['scientific', 'standard', 'alphabetical'] as const
export type HqNotation = typeof HQ_NOTATIONS[number]

export function isHqNotation(value: unknown): value is HqNotation {
    return typeof value === 'string' && (HQ_NOTATIONS as readonly string[]).includes(value)
}

// Short-scale names, one per power of 1000, from K (1e3) to Vg (1e63); past Vg, scientific.
const STANDARD_SUFFIXES = [
    '', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No',
    'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg'
]

// Alphabetical: K M B T up to 1e12, then AA (1e15) … AZ, BA … ZZ, AAA … ZZZ, one per power of 1000; past ZZZ, scientific.
const ALPHABETICAL_NAMED = ['', 'K', 'M', 'B', 'T']
const ALPHABETICAL_MAX_LETTERS = 3

/** Past this exponent a mantissa no longer means anything, so only the exponent is shown. */
const MAX_PLAIN_EXPONENT = Number.MAX_SAFE_INTEGER

function alphabeticalSuffix(tier: number): string | null {
    if (tier < ALPHABETICAL_NAMED.length) return ALPHABETICAL_NAMED[tier]!
    let n = tier - ALPHABETICAL_NAMED.length
    for (let letters = 2; letters <= ALPHABETICAL_MAX_LETTERS; letters++) {
        const count = 26 ** letters
        if (n < count) {
            let out = ''
            for (let i = 0; i < letters; i++) {
                out = String.fromCharCode(65 + (n % 26)) + out
                n = Math.floor(n / 26)
            }
            return out
        }
        n -= count
    }
    return null
}

/** The suffix for `tier` powers of 1000, or null when the notation has no name that large. */
export function hqNotationSuffix(notation: HqNotation, tier: number): string | null {
    if (notation === 'scientific' || tier < 0) return null
    if (notation === 'standard') return STANDARD_SUFFIXES[tier] ?? null
    return alphabeticalSuffix(tier)
}

/** `abs` (positive, finite) as mantissa × 10^exponent with the mantissa in [1, 10); null past MAX_PLAIN_EXPONENT. */
function splitDecimal(abs: Decimal): { mantissa: number, exponent: number } | null {
    const exp = abs.log10().floor()
    if (exp.abs().gt(MAX_PLAIN_EXPONENT)) return null
    let exponent = exp.toNumber()
    let mantissa = abs.div(D(10).pow(exponent)).toNumber()
    // log10 can land a hair either side of a power of ten
    if (mantissa >= 10) {
        mantissa /= 10
        exponent++
    } else if (mantissa < 1) {
        mantissa *= 10
        exponent--
    }
    return { mantissa, exponent }
}

/** The final text for NaN, ∞ and magnitudes too far from 1 to split, or null for an ordinary value. */
function special(value: Decimal, notation: HqNotation, precision: number): string | null {
    if (value.isNan()) return 'NaN'
    if (!value.isFinite()) return value.sign < 0 ? '-∞' : '∞'
    const abs = value.abs()
    if (abs.eq(0) || splitDecimal(abs)) return null
    if (abs.lt(1)) return '0'
    return `${value.sign < 0 ? '-' : ''}e${formatHq(abs.log10().floor(), notation, precision)}`
}

/**
 * A Decimal as the player reads it: plain below 1000, then `notation`, with `precision` decimals.
 * Rounds before choosing the suffix, so 999,996 reads 1.00M rather than 1000.00K.
 *
 * Deliberately not `app/utils/format-number.ts` — that takes `number | bigint` and
 * cannot see a Decimal at all.
 */
export function formatHq(v: DecimalSource, notation: HqNotation, precision = 2): string {
    const value = D(v)
    const done = special(value, notation, precision)
    if (done !== null) return done
    const sign = value.sign < 0 ? '-' : ''
    const abs = value.abs()

    if (abs.lt(1000)) {
        const n = abs.toNumber()
        const plain = Number.isInteger(n) ? String(n) : n.toFixed(precision)
        if (Number(plain) < 1000) return sign + plain
    }

    const { mantissa, exponent: e } = splitDecimal(abs)!
    let exponent = e
    const tier = Math.floor(exponent / 3)
    const scaled = mantissa * 10 ** (exponent - tier * 3)
    let text = scaled.toFixed(precision)
    let shownTier = tier
    if (Number(text) >= 1000) {
        shownTier++
        text = (1).toFixed(precision)
    }
    const suffix = hqNotationSuffix(notation, shownTier)
    if (suffix !== null) return sign + text + suffix

    text = mantissa.toFixed(precision)
    if (Number(text) >= 10) {
        exponent++
        text = (1).toFixed(precision)
    }
    return `${sign}${text}e${exponent}`
}

/**
 * A Decimal in three significant figures: 128, 1.24K, 12.4K, 124K, 1.24e6. The stage's damage
 * numbers and its tight readouts, where a fixed two decimals would not fit.
 */
export function formatHqShort(v: DecimalSource, notation: HqNotation): string {
    const value = D(v)
    const done = special(value, notation, 2)
    if (done !== null) return done
    if (value.eq(0)) return '0'
    const sign = value.sign < 0 ? '-' : ''
    const parts = splitDecimal(value.abs())!
    let exponent = parts.exponent
    // three significant figures, rounded before the tier is chosen so 999.9K reads 1.00M
    let mantissa = Number(parts.mantissa.toPrecision(3))
    if (mantissa >= 10) {
        mantissa /= 10
        exponent++
    }
    // toFixed takes at most 100 digits; a value that small reads 0 anyway
    if (exponent < 3) return sign + String(Number((mantissa * 10 ** exponent).toFixed(Math.min(20, Math.max(0, 2 - exponent)))))
    const tier = Math.floor(exponent / 3)
    const suffix = hqNotationSuffix(notation, tier)
    if (suffix === null) return `${sign}${mantissa.toFixed(2)}e${exponent}`
    const k = exponent - tier * 3
    return `${sign}${(mantissa * 10 ** k).toFixed(2 - k)}${suffix}`
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
