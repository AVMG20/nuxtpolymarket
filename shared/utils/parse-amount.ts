/**
 * Parse a human-typed amount with an optional magnitude suffix: `200k`,
 * `2.5m`, `2b`, `1t`, `1,5k`, `1 000 000`. Returns `null` for anything that
 * does not read as a positive finite number. Suffixes are case-insensitive.
 */
const SUFFIXES: Record<string, number> = {
    k: 1e3,
    m: 1e6,
    b: 1e9,
    t: 1e12
}

export function parseAmount(input: string): number | null {
    const raw = input.trim().toLowerCase().replace(/[\s_]/g, '')
    if (!raw) return null

    const match = /^(\d+(?:[.,]\d+)?|[.,]\d+)([kmbt])?$/.exec(raw)
    if (!match) return null

    const value = Number(match[1]!.replace(',', '.'))
    const multiplier = match[2] ? SUFFIXES[match[2]]! : 1
    const amount = value * multiplier
    if (!Number.isFinite(amount) || amount <= 0) return null
    return amount
}
