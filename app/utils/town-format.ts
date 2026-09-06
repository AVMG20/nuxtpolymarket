/** Countdown text for build timers and plot cooldowns: "1h 05m", "4m 12s", "8s". */
export function formatTownDuration(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000))
    const d = Math.floor(total / 86_400)
    const h = Math.floor((total % 86_400) / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h`
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
    return `${s}s`
}
