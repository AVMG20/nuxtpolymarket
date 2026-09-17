/**
 * The felt has no room for names, so a chip's colour is a player's identity
 * instead — deterministic from their userId, so it stays put across
 * reconnects without the table having to remember an assignment.
 */

export const ROULETTE_CHIP_COLORS: readonly string[] = [
    '#4ade80', '#fbbf24', '#60a5fa', '#f472b6', '#fb923c', '#22d3ee', '#a78bfa', '#f87171'
]

export function colorForPlayer(userId: string): string {
    let hash = 0
    for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
    return ROULETTE_CHIP_COLORS[hash % ROULETTE_CHIP_COLORS.length]!
}
