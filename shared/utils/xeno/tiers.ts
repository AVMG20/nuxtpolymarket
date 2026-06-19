/** Global display maximum for any stat level (speed, yield, charges, etc.) */
export const XENO_MAX_STAT_LEVEL = 10

/** % time reduced per speed level (10% off base time per point) */
export const SPEED_REDUCTION_PER_LEVEL = 0.10

/** Maximum time reduction regardless of speed (cap at 80% reduction) */
export const MAX_SPEED_REDUCTION = 0.80

// Rarity ramp: common → uncommon → rare → epic → legendary → mythic → apex
export function tierColor(tier: number): string {
  const map: Record<number, string> = {
    1: 'text-green-600 dark:text-green-400',
    2: 'text-blue-600 dark:text-blue-400',
    3: 'text-yellow-600 dark:text-yellow-400',
    4: 'text-purple-600 dark:text-purple-400',
    5: 'text-orange-500 dark:text-orange-400',
    6: 'text-red-600 dark:text-red-400',
    7: 'text-pink-600 dark:text-pink-400',
    8: 'text-cyan-600 dark:text-cyan-400',
  }
  return map[tier] ?? 'text-muted'
}

export function tierBg(tier: number): string {
  const map: Record<number, string> = {
    1: 'bg-green-100 border-green-200 dark:bg-green-400/10 dark:border-green-400/20',
    2: 'bg-blue-100 border-blue-200 dark:bg-blue-400/10 dark:border-blue-400/20',
    3: 'bg-yellow-100 border-yellow-200 dark:bg-yellow-400/10 dark:border-yellow-400/20',
    4: 'bg-purple-100 border-purple-200 dark:bg-purple-400/10 dark:border-purple-400/20',
    5: 'bg-orange-100 border-orange-200 dark:bg-orange-400/10 dark:border-orange-400/20',
    6: 'bg-red-100 border-red-200 dark:bg-red-400/10 dark:border-red-400/20',
    7: 'bg-pink-100 border-pink-200 dark:bg-pink-400/10 dark:border-pink-400/20',
    8: 'bg-cyan-100 border-cyan-200 dark:bg-cyan-400/10 dark:border-cyan-400/20',
  }
  return map[tier] ?? 'bg-elevated border-default'
}

export function tierLabel(tier: number): string {
  return `T${tier}`
}

/** Vibrant per-tier color for plant name text */
export function tierNameColor(tier: number): string {
  const map: Record<number, string> = {
    1: 'text-white',
    2: 'text-sky-400',
    3: 'text-yellow-300',
    4: 'text-violet-400',
    5: 'text-orange-400',
    6: 'text-red-400',
    7: 'text-pink-400',
  }
  return map[tier] ?? 'text-muted'
}

/** Maps a stat level (0-10) to a text color class — same scale used by XenoLevelBadge */
export function levelTextColor(level: number): string {
  const map: Record<number, string> = {
    0: 'text-gray-400',
    1: 'text-green-400',
    2: 'text-lime-400',
    3: 'text-yellow-400',
    4: 'text-amber-400',
    5: 'text-orange-400',
    6: 'text-red-400',
    7: 'text-pink-400',
    8: 'text-purple-400',
    9: 'text-blue-400',
    10: 'text-cyan-400',
  }
  return map[level] ?? 'text-gray-400'
}

