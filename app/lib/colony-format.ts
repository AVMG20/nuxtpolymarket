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

export function formatDuration(ms: number): string {
  return formatParts(Math.max(0, Math.floor(ms / 1000)))
}

/** Maps a 0-25% trait roll to a text color — gray (bad roll) through cyan (god roll). */
export function traitTextColor(pct: number): string {
  if (pct >= 24) return 'text-cyan-400'
  if (pct >= 20) return 'text-pink-400'
  if (pct >= 16) return 'text-orange-400'
  if (pct >= 12) return 'text-yellow-400'
  if (pct >= 8) return 'text-lime-400'
  if (pct >= 4) return 'text-green-400'
  return 'text-gray-400'
}

/** Colors a bug's cycle time — the faster it produces, the hotter the color. */
export function tickTimeTextColor(ms: number): string {
  const mins = ms / 60_000
  if (mins <= 1) return 'text-cyan-400'
  if (mins <= 5) return 'text-green-400'
  if (mins <= 10) return 'text-lime-400'
  if (mins <= 15) return 'text-yellow-400'
  if (mins <= 20) return 'text-orange-400'
  return 'text-red-400'
}

export function formatRate(perHour: number): string {
  if (perHour >= 1) return `${perHour.toFixed(1)}/hr`
  if (perHour * 60 >= 0.1) return `${(perHour * 60).toFixed(2)}/min`
  return `${(perHour * 3600).toFixed(2)}/s`
}
