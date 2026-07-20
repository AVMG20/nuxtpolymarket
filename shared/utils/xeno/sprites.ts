import { isHybrid, parseHybridResources } from './hybrids'

/**
 * ─── Plant sprites ───────────────────────────────────────────────────────────
 *
 * Plant icons are cut from two sprite sheets in /public/plant. Each sheet is a
 * COLS×ROWS grid of evenly spaced cells (top-left origin):
 *
 *   plant1.png (sheet 1) — lower & mid-tier flora. The TOP rows hold the least
 *     advanced plants (used for low tiers); the BOTTOM rows hold the magical
 *     T4-T5 flora.
 *   plant2.png (sheet 2) — the cosmic / ethereal T6-T7 flora.
 *
 * Each plant type id maps to one cell. Coordinates are [col, row], zero-based.
 *
 * The sprites are NOT laid out edge-to-edge across the full image: there's an
 * outer margin and the real pitch is tighter than width/cols. The per-sheet
 * geometry below (measured by linear-fitting the actual sprite centres) gives
 * the pixel centre of cell [0,0] (`x0`,`y0`), the column/row pitch (`dx`,`dy`)
 * and the square crop `win` used to frame each cell. Without this, icons drift
 * left/right and clip at higher column/row indices.
 */

export const PLANT_SHEET_COLS = 10
export const PLANT_SHEET_ROWS = 7

export interface SheetGeometry {
  /** natural pixel dimensions of the sheet */
  w: number
  h: number
  /** pixel centre of column 0 / row 0 */
  x0: number
  y0: number
  /** pixel distance between adjacent column / row centres */
  dx: number
  dy: number
  /** side (px) of the square region cropped around each cell centre */
  win: number
}

export const PLANT_SHEET_GEOMETRY: Record<1 | 2, SheetGeometry> = {
  1: { w: 1536, h: 1024, x0: 101.5, dx: 147, y0: 91.9, dy: 134, win: 134 },
  2: { w: 1536, h: 1024, x0: 110.3, dx: 147.3, y0: 83.3, dy: 142.8, win: 143 },
}

export interface PlantSprite {
  /** 1 → plant1.png, 2 → plant2.png */
  sheet: 1 | 2
  /** zero-based column (0..COLS-1) */
  col: number
  /** zero-based row (0..ROWS-1) */
  row: number
}

/** Public URL of a sprite sheet. */
export function plantSheetUrl(sheet: 1 | 2): string {
  return `/plant/plant${sheet}.png`
}

/** Maps every plant type id to its sprite cell. */
export const PLANT_SPRITES: Record<string, PlantSprite> = {
  // ── T1 — Starter (sheet 1, top row; glowshroom gets a special glow cell) ──
  sprout:        { sheet: 1, col: 1, row: 0 },
  tendril:       { sheet: 1, col: 0, row: 0 },
  dustbloom:     { sheet: 1, col: 4, row: 0 },
  glowshroom:    { sheet: 1, col: 9, row: 4 },

  // ── T2 — Developed (sheet 1, row 1; crystal-bud gets a crystal cell) ──
  bloom:         { sheet: 1, col: 2, row: 1 },
  creeper:       { sheet: 1, col: 0, row: 1 },
  fernite:       { sheet: 1, col: 1, row: 1 },
  ashvine:       { sheet: 1, col: 3, row: 1 },
  'crystal-bud': { sheet: 1, col: 6, row: 4 },

  // ── T3 — Advanced (sheet 1, rows 2-3; xenoform gets the rainbow cell) ──
  'crystal-vine': { sheet: 1, col: 1, row: 2 },
  'phantom-leaf': { sheet: 1, col: 7, row: 2 },
  voidbloom:      { sheet: 1, col: 9, row: 2 },
  emberfern:      { sheet: 1, col: 9, row: 3 },
  xenoform:       { sheet: 1, col: 2, row: 6 },

  // ── T4 — Elite (sheet 1, row 4, the magical band) ──
  deepfrond:   { sheet: 1, col: 3, row: 4 },
  swiftcane:   { sheet: 1, col: 5, row: 4 },
  crystalmoss: { sheet: 1, col: 1, row: 4 },
  voidfern:    { sheet: 1, col: 2, row: 4 },
  abyssform:   { sheet: 1, col: 0, row: 4 },

  // ── T5 — Cosmic (sheet 1, rows 5-6, the most advanced cells) ──
  starweave:   { sheet: 1, col: 6, row: 5 },
  voidpulse:   { sheet: 1, col: 0, row: 6 },
  cosmosbloom: { sheet: 1, col: 4, row: 6 },
  etherform:   { sheet: 1, col: 8, row: 5 },

  // ── T6 — Ethereal (sheet 2, row 0) ──
  dawnrift:     { sheet: 2, col: 5, row: 0 },
  voidlattice:  { sheet: 2, col: 2, row: 0 },
  nexusbloom:   { sheet: 2, col: 6, row: 0 },
  stellarfrond: { sheet: 2, col: 7, row: 0 },
  aetherix:     { sheet: 2, col: 1, row: 0 },

  // ── T7 — Singularity (sheet 2, rows 1-2) ──
  'tempest-spike': { sheet: 2, col: 9, row: 2 },
  'abyssal-frond': { sheet: 2, col: 6, row: 1 },
  'quantum-bloom': { sheet: 2, col: 3, row: 2 },
  starcore:        { sheet: 2, col: 7, row: 2 },
  singularity:     { sheet: 2, col: 1, row: 2 },

  // ── T8 — Transcendent (sheet 2, row 3) ──
  'solar-needle':   { sheet: 2, col: 0, row: 3 },
  'nebula-root':    { sheet: 2, col: 2, row: 3 },
  'eventide-bloom': { sheet: 2, col: 4, row: 3 },
  'gravity-vine':   { sheet: 2, col: 6, row: 3 },
  'void-orchid':    { sheet: 2, col: 8, row: 3 },

  // ── T9 — Omega (sheet 2, row 4) ──
  chronofrond:      { sheet: 2, col: 0, row: 4 },
  'darkmatter-pod': { sheet: 2, col: 2, row: 4 },
  'galaxy-bloom':   { sheet: 2, col: 4, row: 4 },
  'reality-thorn':  { sheet: 2, col: 6, row: 4 },
  'omega-core':     { sheet: 2, col: 8, row: 4 },
}

/**
 * Resolve the sprite for a plant type id. Hybrids (whose typeId encodes their
 * resources) fall back to the sprite of their first resource — matching how the
 * UI shows a hybrid's first resource as its primary icon.
 */
export function getPlantSprite(id: string | undefined | null): PlantSprite | undefined {
  if (!id) return undefined
  if (isHybrid(id)) {
    const first = parseHybridResources(id)[0]
    return first ? PLANT_SPRITES[first.id] : undefined
  }
  return PLANT_SPRITES[id]
}
