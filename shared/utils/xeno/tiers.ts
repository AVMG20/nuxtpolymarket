/** Global display maximum for any stat level (speed, yield, charges, etc.) */
export const XENO_MAX_STAT_LEVEL = 10

/** Max speed level achievable per tier (through breeding/mutations) */
export const TIER_MAX_SPEED: Record<number, number> = {
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8,
}

/** Max yield level achievable per tier */
export const TIER_MAX_YIELD: Record<number, number> = {
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8,
}

/** % time reduced per speed level (10% off base time per point) */
export const SPEED_REDUCTION_PER_LEVEL = 0.10

/** Maximum time reduction regardless of speed (cap at 80% reduction) */
export const MAX_SPEED_REDUCTION = 0.80

export function tierColor(tier: number): string {
  const map: Record<number, string> = {
    1: 'text-green-600 dark:text-green-400',
    2: 'text-blue-600 dark:text-blue-400',
    3: 'text-purple-600 dark:text-purple-400',
    4: 'text-orange-500 dark:text-orange-400',
    5: 'text-red-600 dark:text-red-400',
    6: 'text-pink-600 dark:text-pink-400',
    7: 'text-yellow-600 dark:text-yellow-400',
    8: 'text-cyan-600 dark:text-cyan-400',
  }
  return map[tier] ?? 'text-muted'
}

export function tierBg(tier: number): string {
  const map: Record<number, string> = {
    1: 'bg-green-100 border-green-200 dark:bg-green-400/10 dark:border-green-400/20',
    2: 'bg-blue-100 border-blue-200 dark:bg-blue-400/10 dark:border-blue-400/20',
    3: 'bg-purple-100 border-purple-200 dark:bg-purple-400/10 dark:border-purple-400/20',
    4: 'bg-orange-100 border-orange-200 dark:bg-orange-400/10 dark:border-orange-400/20',
    5: 'bg-red-100 border-red-200 dark:bg-red-400/10 dark:border-red-400/20',
    6: 'bg-pink-100 border-pink-200 dark:bg-pink-400/10 dark:border-pink-400/20',
    7: 'bg-yellow-100 border-yellow-200 dark:bg-yellow-400/10 dark:border-yellow-400/20',
    8: 'bg-cyan-100 border-cyan-200 dark:bg-cyan-400/10 dark:border-cyan-400/20',
  }
  return map[tier] ?? 'bg-elevated border-default'
}

export function tierProgressColor(tier: number): string {
  const map: Record<number, string> = {
    1: 'bg-green-500 dark:bg-green-400',
    2: 'bg-blue-500 dark:bg-blue-400',
    3: 'bg-purple-500 dark:bg-purple-400',
    4: 'bg-orange-500 dark:bg-orange-400',
    5: 'bg-red-500 dark:bg-red-400',
    6: 'bg-pink-500 dark:bg-pink-400',
    7: 'bg-yellow-500 dark:bg-yellow-400',
    8: 'bg-cyan-500 dark:bg-cyan-400',
  }
  return map[tier] ?? 'bg-primary'
}

export function tierCard(tier: number): string {
  const map: Record<number, string> = {
    1: 'bg-green-100 border-green-300 hover:bg-green-200 dark:bg-green-400/10 dark:border-green-400/50 dark:hover:bg-green-400/15',
    2: 'bg-blue-100 border-blue-300 hover:bg-blue-200 dark:bg-blue-400/10 dark:border-blue-400/50 dark:hover:bg-blue-400/15',
    3: 'bg-purple-100 border-purple-300 hover:bg-purple-200 dark:bg-purple-400/10 dark:border-purple-400/50 dark:hover:bg-purple-400/15',
    4: 'bg-orange-100 border-orange-300 hover:bg-orange-200 dark:bg-orange-400/10 dark:border-orange-400/50 dark:hover:bg-orange-400/15',
    5: 'bg-red-100 border-red-300 hover:bg-red-200 dark:bg-red-400/10 dark:border-red-400/50 dark:hover:bg-red-400/15',
    6: 'bg-pink-100 border-pink-300 hover:bg-pink-200 dark:bg-pink-400/10 dark:border-pink-400/50 dark:hover:bg-pink-400/15',
    7: 'bg-yellow-100 border-yellow-300 hover:bg-yellow-200 dark:bg-yellow-400/10 dark:border-yellow-400/50 dark:hover:bg-yellow-400/15',
    8: 'bg-cyan-100 border-cyan-300 hover:bg-cyan-200 dark:bg-cyan-400/10 dark:border-cyan-400/50 dark:hover:bg-cyan-400/15',
  }
  return map[tier] ?? 'bg-elevated border-default hover:bg-elevated/80'
}

export function tierRing(tier: number): string {
  const map: Record<number, string> = {
    1: 'ring-2 ring-green-600 dark:ring-green-400',
    2: 'ring-2 ring-blue-600 dark:ring-blue-400',
    3: 'ring-2 ring-purple-600 dark:ring-purple-400',
    4: 'ring-2 ring-orange-500 dark:ring-orange-400',
    5: 'ring-2 ring-red-600 dark:ring-red-400',
    6: 'ring-2 ring-pink-600 dark:ring-pink-400',
    7: 'ring-2 ring-yellow-600 dark:ring-yellow-400',
    8: 'ring-2 ring-cyan-600 dark:ring-cyan-400',
  }
  return map[tier] ?? 'ring-2 ring-primary'
}

export function tierLabel(tier: number): string {
  return `T${tier}`
}

// ─── Per-plant color utilities ──────────────────────────────────────────────
// Each plant has a unique color key (e.g. 'lime', 'amber') set in plants.ts.
// These functions convert that key to Tailwind class strings for display.

interface PlantColorClasses {
  text: string
  bg: string
  bgOnly: string
  card: string
  cardBg: string
  ring: string
  progress: string
}

const PLANT_COLOR_MAP: Record<string, PlantColorClasses> = {
  lime:    { text: 'text-lime-600 dark:text-lime-400',       bgOnly: 'bg-lime-100 dark:bg-lime-400/10',       bg: 'bg-lime-100 border-lime-200 dark:bg-lime-400/10 dark:border-lime-400/20',          cardBg: 'bg-lime-100 hover:bg-lime-200 dark:bg-lime-400/10 dark:hover:bg-lime-400/15',          card: 'bg-lime-100 border-lime-300 hover:bg-lime-200 dark:bg-lime-400/10 dark:border-lime-400/50 dark:hover:bg-lime-400/15',          ring: 'ring-2 ring-lime-500 dark:ring-lime-400',       progress: 'bg-lime-500 dark:bg-lime-400' },
  green:   { text: 'text-green-600 dark:text-green-400',     bgOnly: 'bg-green-100 dark:bg-green-400/10',     bg: 'bg-green-100 border-green-200 dark:bg-green-400/10 dark:border-green-400/20',        cardBg: 'bg-green-100 hover:bg-green-200 dark:bg-green-400/10 dark:hover:bg-green-400/15',      bg: 'bg-green-100 border-green-200 dark:bg-green-400/10 dark:border-green-400/20',        card: 'bg-green-100 border-green-300 hover:bg-green-200 dark:bg-green-400/10 dark:border-green-400/50 dark:hover:bg-green-400/15',      ring: 'ring-2 ring-green-500 dark:ring-green-400',     progress: 'bg-green-500 dark:bg-green-400' },
  amber:   { text: 'text-amber-600 dark:text-amber-400',     bgOnly: 'bg-amber-100 dark:bg-amber-400/10',     bg: 'bg-amber-100 border-amber-200 dark:bg-amber-400/10 dark:border-amber-400/20',        cardBg: 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-400/10 dark:hover:bg-amber-400/15',      card: 'bg-amber-100 border-amber-300 hover:bg-amber-200 dark:bg-amber-400/10 dark:border-amber-400/50 dark:hover:bg-amber-400/15',      ring: 'ring-2 ring-amber-500 dark:ring-amber-400',     progress: 'bg-amber-500 dark:bg-amber-400' },
  rose:    { text: 'text-rose-600 dark:text-rose-400',       bgOnly: 'bg-rose-100 dark:bg-rose-400/10',       bg: 'bg-rose-100 border-rose-200 dark:bg-rose-400/10 dark:border-rose-400/20',            cardBg: 'bg-rose-100 hover:bg-rose-200 dark:bg-rose-400/10 dark:hover:bg-rose-400/15',          card: 'bg-rose-100 border-rose-300 hover:bg-rose-200 dark:bg-rose-400/10 dark:border-rose-400/50 dark:hover:bg-rose-400/15',            ring: 'ring-2 ring-rose-500 dark:ring-rose-400',       progress: 'bg-rose-500 dark:bg-rose-400' },
  teal:    { text: 'text-teal-600 dark:text-teal-400',       bgOnly: 'bg-teal-100 dark:bg-teal-400/10',       bg: 'bg-teal-100 border-teal-200 dark:bg-teal-400/10 dark:border-teal-400/20',            cardBg: 'bg-teal-100 hover:bg-teal-200 dark:bg-teal-400/10 dark:hover:bg-teal-400/15',          card: 'bg-teal-100 border-teal-300 hover:bg-teal-200 dark:bg-teal-400/10 dark:border-teal-400/50 dark:hover:bg-teal-400/15',            ring: 'ring-2 ring-teal-500 dark:ring-teal-400',       progress: 'bg-teal-500 dark:bg-teal-400' },
  emerald: { text: 'text-emerald-600 dark:text-emerald-400', bgOnly: 'bg-emerald-100 dark:bg-emerald-400/10', bg: 'bg-emerald-100 border-emerald-200 dark:bg-emerald-400/10 dark:border-emerald-400/20', cardBg: 'bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-400/10 dark:hover:bg-emerald-400/15', card: 'bg-emerald-100 border-emerald-300 hover:bg-emerald-200 dark:bg-emerald-400/10 dark:border-emerald-400/50 dark:hover:bg-emerald-400/15', ring: 'ring-2 ring-emerald-500 dark:ring-emerald-400', progress: 'bg-emerald-500 dark:bg-emerald-400' },
  sky:     { text: 'text-sky-600 dark:text-sky-400',         bgOnly: 'bg-sky-100 dark:bg-sky-400/10',         bg: 'bg-sky-100 border-sky-200 dark:bg-sky-400/10 dark:border-sky-400/20',                cardBg: 'bg-sky-100 hover:bg-sky-200 dark:bg-sky-400/10 dark:hover:bg-sky-400/15',              card: 'bg-sky-100 border-sky-300 hover:bg-sky-200 dark:bg-sky-400/10 dark:border-sky-400/50 dark:hover:bg-sky-400/15',                    ring: 'ring-2 ring-sky-500 dark:ring-sky-400',         progress: 'bg-sky-500 dark:bg-sky-400' },
  violet:  { text: 'text-violet-600 dark:text-violet-400',   bgOnly: 'bg-violet-100 dark:bg-violet-400/10',   bg: 'bg-violet-100 border-violet-200 dark:bg-violet-400/10 dark:border-violet-400/20',    cardBg: 'bg-violet-100 hover:bg-violet-200 dark:bg-violet-400/10 dark:hover:bg-violet-400/15',  card: 'bg-violet-100 border-violet-300 hover:bg-violet-200 dark:bg-violet-400/10 dark:border-violet-400/50 dark:hover:bg-violet-400/15',  ring: 'ring-2 ring-violet-500 dark:ring-violet-400',   progress: 'bg-violet-500 dark:bg-violet-400' },
  indigo:  { text: 'text-indigo-600 dark:text-indigo-400',   bgOnly: 'bg-indigo-100 dark:bg-indigo-400/10',   bg: 'bg-indigo-100 border-indigo-200 dark:bg-indigo-400/10 dark:border-indigo-400/20',    cardBg: 'bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-400/10 dark:hover:bg-indigo-400/15',  card: 'bg-indigo-100 border-indigo-300 hover:bg-indigo-200 dark:bg-indigo-400/10 dark:border-indigo-400/50 dark:hover:bg-indigo-400/15',  ring: 'ring-2 ring-indigo-500 dark:ring-indigo-400',   progress: 'bg-indigo-500 dark:bg-indigo-400' },
  slate:   { text: 'text-slate-600 dark:text-slate-300',     bgOnly: 'bg-slate-100 dark:bg-slate-400/10',     bg: 'bg-slate-100 border-slate-200 dark:bg-slate-400/10 dark:border-slate-400/20',        cardBg: 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-400/10 dark:hover:bg-slate-400/15',      card: 'bg-slate-100 border-slate-300 hover:bg-slate-200 dark:bg-slate-400/10 dark:border-slate-400/50 dark:hover:bg-slate-400/15',        ring: 'ring-2 ring-slate-500 dark:ring-slate-400',     progress: 'bg-slate-500 dark:bg-slate-400' },
  fuchsia: { text: 'text-fuchsia-600 dark:text-fuchsia-400', bgOnly: 'bg-fuchsia-100 dark:bg-fuchsia-400/10', bg: 'bg-fuchsia-100 border-fuchsia-200 dark:bg-fuchsia-400/10 dark:border-fuchsia-400/20', cardBg: 'bg-fuchsia-100 hover:bg-fuchsia-200 dark:bg-fuchsia-400/10 dark:hover:bg-fuchsia-400/15', card: 'bg-fuchsia-100 border-fuchsia-300 hover:bg-fuchsia-200 dark:bg-fuchsia-400/10 dark:border-fuchsia-400/50 dark:hover:bg-fuchsia-400/15', ring: 'ring-2 ring-fuchsia-500 dark:ring-fuchsia-400', progress: 'bg-fuchsia-500 dark:bg-fuchsia-400' },
  yellow:  { text: 'text-yellow-600 dark:text-yellow-400',   bgOnly: 'bg-yellow-100 dark:bg-yellow-400/10',   bg: 'bg-yellow-100 border-yellow-200 dark:bg-yellow-400/10 dark:border-yellow-400/20',    cardBg: 'bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-400/10 dark:hover:bg-yellow-400/15',  card: 'bg-yellow-100 border-yellow-300 hover:bg-yellow-200 dark:bg-yellow-400/10 dark:border-yellow-400/50 dark:hover:bg-yellow-400/15',  ring: 'ring-2 ring-yellow-500 dark:ring-yellow-400',   progress: 'bg-yellow-500 dark:bg-yellow-400' },
  cyan:    { text: 'text-cyan-600 dark:text-cyan-400',       bgOnly: 'bg-cyan-100 dark:bg-cyan-400/10',       bg: 'bg-cyan-100 border-cyan-200 dark:bg-cyan-400/10 dark:border-cyan-400/20',              cardBg: 'bg-cyan-100 hover:bg-cyan-200 dark:bg-cyan-400/10 dark:hover:bg-cyan-400/15',          card: 'bg-cyan-100 border-cyan-300 hover:bg-cyan-200 dark:bg-cyan-400/10 dark:border-cyan-400/50 dark:hover:bg-cyan-400/15',              ring: 'ring-2 ring-cyan-500 dark:ring-cyan-400',       progress: 'bg-cyan-500 dark:bg-cyan-400' },
  orange:  { text: 'text-orange-600 dark:text-orange-400',   bgOnly: 'bg-orange-100 dark:bg-orange-400/10',   bg: 'bg-orange-100 border-orange-200 dark:bg-orange-400/10 dark:border-orange-400/20',      cardBg: 'bg-orange-100 hover:bg-orange-200 dark:bg-orange-400/10 dark:hover:bg-orange-400/15',  card: 'bg-orange-100 border-orange-300 hover:bg-orange-200 dark:bg-orange-400/10 dark:border-orange-400/50 dark:hover:bg-orange-400/15',  ring: 'ring-2 ring-orange-500 dark:ring-orange-400',   progress: 'bg-orange-500 dark:bg-orange-400' },
  blue:    { text: 'text-blue-600 dark:text-blue-400',       bgOnly: 'bg-blue-100 dark:bg-blue-400/10',       bg: 'bg-blue-100 border-blue-200 dark:bg-blue-400/10 dark:border-blue-400/20',              cardBg: 'bg-blue-100 hover:bg-blue-200 dark:bg-blue-400/10 dark:hover:bg-blue-400/15',          card: 'bg-blue-100 border-blue-300 hover:bg-blue-200 dark:bg-blue-400/10 dark:border-blue-400/50 dark:hover:bg-blue-400/15',              ring: 'ring-2 ring-blue-500 dark:ring-blue-400',       progress: 'bg-blue-500 dark:bg-blue-400' },
  purple:  { text: 'text-purple-600 dark:text-purple-400',   bgOnly: 'bg-purple-100 dark:bg-purple-400/10',   bg: 'bg-purple-100 border-purple-200 dark:bg-purple-400/10 dark:border-purple-400/20',      cardBg: 'bg-purple-100 hover:bg-purple-200 dark:bg-purple-400/10 dark:hover:bg-purple-400/15',  card: 'bg-purple-100 border-purple-300 hover:bg-purple-200 dark:bg-purple-400/10 dark:border-purple-400/50 dark:hover:bg-purple-400/15',  ring: 'ring-2 ring-purple-500 dark:ring-purple-400',   progress: 'bg-purple-500 dark:bg-purple-400' },
  pink:    { text: 'text-pink-600 dark:text-pink-400',       bgOnly: 'bg-pink-100 dark:bg-pink-400/10',       bg: 'bg-pink-100 border-pink-200 dark:bg-pink-400/10 dark:border-pink-400/20',              cardBg: 'bg-pink-100 hover:bg-pink-200 dark:bg-pink-400/10 dark:hover:bg-pink-400/15',          card: 'bg-pink-100 border-pink-300 hover:bg-pink-200 dark:bg-pink-400/10 dark:border-pink-400/50 dark:hover:bg-pink-400/15',              ring: 'ring-2 ring-pink-500 dark:ring-pink-400',       progress: 'bg-pink-500 dark:bg-pink-400' },
  stone:   { text: 'text-stone-600 dark:text-stone-300',     bgOnly: 'bg-stone-100 dark:bg-stone-400/10',     bg: 'bg-stone-100 border-stone-200 dark:bg-stone-400/10 dark:border-stone-400/20',          cardBg: 'bg-stone-100 hover:bg-stone-200 dark:bg-stone-400/10 dark:hover:bg-stone-400/15',      card: 'bg-stone-100 border-stone-300 hover:bg-stone-200 dark:bg-stone-400/10 dark:border-stone-400/50 dark:hover:bg-stone-400/15',          ring: 'ring-2 ring-stone-500 dark:ring-stone-400',     progress: 'bg-stone-500 dark:bg-stone-400' },
}

const FALLBACK_PLANT_COLORS: PlantColorClasses = {
  text: 'text-muted', bg: 'bg-elevated border-default', card: 'bg-elevated border-default hover:bg-elevated/80', ring: 'ring-2 ring-primary', progress: 'bg-primary',
}

function pc(colorKey: string): PlantColorClasses {
  return PLANT_COLOR_MAP[colorKey] ?? FALLBACK_PLANT_COLORS
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

export function plantColor(colorKey: string): string    { return pc(colorKey).text }
export function plantBg(colorKey: string): string      { return pc(colorKey).bg }
export function plantBgOnly(colorKey: string): string  { return pc(colorKey).bgOnly }
export function plantCard(colorKey: string): string    { return pc(colorKey).card }
export function plantCardBg(colorKey: string): string  { return pc(colorKey).cardBg }
export function plantRing(colorKey: string): string    { return pc(colorKey).ring }
export function plantProgress(colorKey: string): string { return pc(colorKey).progress }
