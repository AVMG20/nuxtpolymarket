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

/** Compact countdown: "1h 14m", "2m 3s", "45s", "Ready!" */
export function formatCountdown(completesAt: string | Date, now: number): string {
  const d = typeof completesAt === 'string' ? new Date(completesAt) : completesAt
  const ms = d.getTime() - now
  if (ms <= 0) return 'Ready!'
  const totalSecs = Math.ceil(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}

/** Format a raw duration in seconds: "1h 14m", "2m 3s", "45s" */
export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}
