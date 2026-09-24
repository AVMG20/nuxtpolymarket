// Holdfast: display helpers shared by the lobby, leaderboard and end screen.

/** Survival time as `mm:ss`, floored to the second. Minutes keep counting past 59. */
export function formatHoldfastTime(ms: number): string {
    const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}
