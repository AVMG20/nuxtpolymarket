// A player's recent coin income, grouped into the same per-game labels the
// audit page uses (`normaliseCategory`), for the leaderboard's player details.

import { normaliseCategory } from './analytics-categories'
import { genreForLabel, type Genre } from './game-genres'

export const INCOME_WINDOW_DAYS = 7
export const INCOME_TOP_SOURCES = 5

/** One `GROUP BY category` row of credits from the ledger. */
export interface IncomeCategoryRow {
    category: string | null
    amount: number
}

export interface IncomeSource {
    label: string
    genre: Genre
    amount: number
    /** Fraction of the total, 0–1. */
    share: number
}

export interface IncomeSummary {
    total: number
    sources: IncomeSource[]
    /** What every source past the top ones added up to. */
    otherAmount: number
    otherCount: number
}

// Moving the player's own money around is not income: bank deposits and
// withdrawals, gifts between players, and the refunds, escrow returns and
// crash recoveries `isEarning` in server/utils/balance.ts already skips.
const TRANSFER_PREFIXES = new Set(['bank', 'gift'])
const RETURNED_MONEY = /refund|recovery|cancel/

export function isIncomeCategory(rawCategory: string | null): boolean {
    if (rawCategory === null) return true
    const lower = rawCategory.toLowerCase()
    if (TRANSFER_PREFIXES.has(lower.split(':')[0]!.trim())) return false
    return !RETURNED_MONEY.test(lower)
}

/** Folds raw credit rows into display labels, ranked by amount, keeping the top `limit`. */
export function summariseIncome(rows: IncomeCategoryRow[], limit = INCOME_TOP_SOURCES): IncomeSummary {
    const byLabel = new Map<string, number>()
    for (const row of rows) {
        if (!isIncomeCategory(row.category) || !(row.amount > 0)) continue
        const label = normaliseCategory(row.category)
        byLabel.set(label, (byLabel.get(label) ?? 0) + row.amount)
    }

    const ranked = [...byLabel.entries()]
        .map(([label, amount]) => ({ label, amount }))
        .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label))
    const total = ranked.reduce((sum, source) => sum + source.amount, 0)
    const rest = ranked.slice(limit)

    return {
        total,
        sources: ranked.slice(0, limit).map(source => ({
            ...source,
            genre: genreForLabel(source.label),
            share: total > 0 ? source.amount / total : 0
        })),
        otherAmount: rest.reduce((sum, source) => sum + source.amount, 0),
        otherCount: rest.length
    }
}
