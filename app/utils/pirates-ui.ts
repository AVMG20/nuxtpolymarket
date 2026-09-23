import { PIRATE_RARITIES, piratePowerUp, type PiratePowerUpId, type PirateRarity } from '#shared/utils/gamelogic/pirates'

// Small display helpers shared by the Pirate Raid pages.

/** 0xRRGGBB → '#rrggbb'. */
export function pirateHex(color: number) {
  return `#${Math.max(0, Math.min(0xffffff, Math.round(color))).toString(16).padStart(6, '0')}`
}

export function pirateRarityHex(rarity: PirateRarity) {
  return pirateHex(PIRATE_RARITIES.find(entry => entry.id === rarity)?.color ?? 0xa1a1aa)
}

export function piratePowerUpHex(id: PiratePowerUpId) {
  return pirateRarityHex(piratePowerUp(id).rarity)
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

export function pirateRoman(n: number) {
  return ROMAN[n] ?? String(n)
}

/** m:ss */
export function pirateClock(ms: number, roundUp = false) {
  const total = Math.max(0, roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}

/** 1h 20m / 4m 10s / 12s */
export function pirateDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Accent colour of each right-click ability (medallion rim, cooldown ring). */
export const PIRATE_ABILITY_ACCENTS: Record<string, string> = {
  bomb: '#f3c35a',
  seekers: '#fb7185',
  consort: '#7dd3fc',
  maelstrom: '#2dd4bf',
  firestorm: '#fb923c',
  tidal: '#60a5fa'
}

export function pirateAbilityHex(id: string) {
  return PIRATE_ABILITY_ACCENTS[id] ?? '#f3c35a'
}

/** Accent colour for each boss's health bar and banner. */
export const PIRATE_BOSS_ACCENTS: Record<string, string> = {
  dreadnought: '#ef4444',
  kraken: '#a78bfa',
  phantom: '#5eead4'
}
