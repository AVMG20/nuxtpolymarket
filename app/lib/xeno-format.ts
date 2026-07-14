/** Whether a slot is done based on completesAt */
export function isDone(completesAt: string | Date): boolean {
  const d = typeof completesAt === 'string' ? new Date(completesAt) : completesAt
  return Date.now() >= d.getTime()
}

/** Progress as 0–100 based on startedAt and completesAt */
export function progressPct(startedAt: string | Date, completesAt: string | Date, now: number): number {
  const start = typeof startedAt === 'string' ? new Date(startedAt).getTime() : startedAt.getTime()
  const end = typeof completesAt === 'string' ? new Date(completesAt).getTime() : completesAt.getTime()
  const total = end - start
  if (total <= 0) return 100
  return Math.min(100, Math.max(0, ((now - start) / total) * 100))
}

function formatParts(totalSecs: number): string {
  const days = Math.floor(totalSecs / 86400)
  const h = Math.floor((totalSecs % 86400) / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  if (days > 0) return `${days}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Compact countdown: always 2 units when possible — "1h 4m", "2m 3s", "45s", "Ready!" */
export function formatCountdown(completesAt: string | Date, now: number): string {
  const d = typeof completesAt === 'string' ? new Date(completesAt) : completesAt
  const ms = d.getTime() - now
  if (ms <= 0) return 'Ready!'
  return formatParts(Math.ceil(ms / 1000))
}

/** Format a raw duration in seconds — always 2 units when possible */
export function formatDuration(secs: number): string {
  return formatParts(Math.max(0, Math.floor(secs)))
}
