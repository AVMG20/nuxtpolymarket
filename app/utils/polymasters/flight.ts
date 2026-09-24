/**
 * Turns a RoundOutcome into a world-space flight script: a smooth path y(x), the x of
 * every event, what boosters are active where, and where the flight ends.
 */
import { PM_MAX_LEVEL as MAX_LEVEL, type PmBooster as Booster, type PmFlightEvent as FlightEvent, type PmRoundOutcome as RoundOutcome } from '#shared/utils/gamelogic/polymasters'
import { ISLAND_RUNWAY_X0, ISLAND_RUNWAY_Y, ISLAND_WATER_Y, CARRIER_DECK_Y, CARRIER_WATER_Y } from './art'
import { PLANE_WHEEL_OFFSET } from './plane'

export const HORIZON = 700
export const WATER = 930
export const DECK_Y = WATER - (CARRIER_WATER_Y - CARRIER_DECK_Y) - 10
export const PLANE_DECK_Y = DECK_Y - PLANE_WHEEL_OFFSET
export const RUNWAY_Y = WATER - (ISLAND_WATER_Y - ISLAND_RUNWAY_Y) - 8
export const PLANE_RUNWAY_Y = RUNWAY_Y - PLANE_WHEEL_OFFSET

export const LIFTOFF_X = 560
export const FIRST_EVENT_X = 1600
export const SPACING = 560
/**
 * Altitude levels map straight to height: level 0 skims the waves, MAX_LEVEL is the top.
 * The island runway sits below level 0, so every landing is a descent; the plane never
 * has to climb to reach the island.
 */
const LOW_Y = 750
const TOP_Y = 200
const LEVEL_STEP = (LOW_Y - TOP_Y) / MAX_LEVEL
export const yOfLevel = (level: number) => LOW_Y - level * LEVEL_STEP

export interface ScriptedEvent {
  index: number
  x: number
  y: number
  ev: FlightEvent
  /** Booster effects active when the plane reaches this event. */
  nitro: boolean
  laser: boolean
  magnet: boolean
}

/** Where the plane touches the sea: sinks, is bounced back by a Life Buoy, or skims off (Safe Landing). */
export interface Splash {
  x: number
  type: 'sink' | 'rescue' | 'skim'
}

export interface FlightScript {
  events: ScriptedEvent[]
  splashes: Splash[]
  /** x at which the landing/splash sequence starts. */
  lastX: number
  islandX: number
  touchdownX: number | null
  splashX: number | null
  stopX: number
  pathX: number[]
  pathY: number[]
  boosterSpans: { booster: Booster; from: number; to: number }[]
}

/** Monotone cubic (Fritsch–Carlson) interpolation: smooth and never overshoots. */
function monotone(xs: number[], ys: number[]) {
  const n = xs.length
  const d: number[] = []
  const m: number[] = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!))
  m[0] = d[0]!
  m[n - 1] = d[n - 2]!
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i]! === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i]! / d[i]!
    const b = m[i + 1]! / d[i]!
    const s = a * a + b * b
    if (s > 9) {
      const tau = 3 / Math.sqrt(s)
      m[i] = tau * a * d[i]!
      m[i + 1] = tau * b * d[i]!
    }
  }
  return m
}

export function samplePath(script: FlightScript, x: number, tangents: number[]): { y: number; slope: number } {
  const xs = script.pathX
  const ys = script.pathY
  if (x <= xs[0]!) return { y: ys[0]!, slope: 0 }
  if (x >= xs[xs.length - 1]!) return { y: ys[ys.length - 1]!, slope: tangents[tangents.length - 1]! }
  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid]! <= x) lo = mid
    else hi = mid
  }
  const h = xs[hi]! - xs[lo]!
  const t = (x - xs[lo]!) / h
  const t2 = t * t
  const t3 = t2 * t
  const y =
    (2 * t3 - 3 * t2 + 1) * ys[lo]! + (t3 - 2 * t2 + t) * h * tangents[lo]! + (-2 * t3 + 3 * t2) * ys[hi]! + (t3 - t2) * h * tangents[hi]!
  const dy =
    ((6 * t2 - 6 * t) * ys[lo]!) / h + (3 * t2 - 4 * t + 1) * tangents[lo]! + ((-6 * t2 + 6 * t) * ys[hi]!) / h + (3 * t2 - 2 * t) * tangents[hi]!
  return { y, slope: dy }
}

export function buildScript(outcome: RoundOutcome): FlightScript & { tangents: number[] } {
  const startY = yOfLevel(outcome.startLevel)
  const px: number[] = [0, LIFTOFF_X, LIFTOFF_X + 380, FIRST_EVENT_X - 360]
  const py: number[] = [PLANE_DECK_Y, PLANE_DECK_Y, PLANE_DECK_Y - 110, startY]
  let level = outcome.startLevel
  let nitro = 0
  let laser = 0
  let magnet = 0
  const events: ScriptedEvent[] = []
  const spans: FlightScript['boosterSpans'] = []
  const splashes: Splash[] = []
  const jitter = (a: number) => (Math.random() - 0.5) * a

  for (const [i, ev] of outcome.events.entries()) {
    const x = FIRST_EVENT_X + i * SPACING
    const y = yOfLevel(level) + jitter(16)
    events.push({ index: i, x, y, ev, nitro: nitro > 0, laser: laser > 0, magnet: magnet > 0 })
    if (nitro > 0) nitro--
    if (laser > 0) laser--
    if (magnet > 0) magnet--
    px.push(x)
    py.push(y)
    if (ev.kind === 'booster') {
      if (ev.booster === 'nitro') {
        nitro = 3
        spans.push({ booster: 'nitro', from: x, to: x + SPACING * 3 })
      }
      if (ev.booster === 'laser') {
        laser = 4
        spans.push({ booster: 'laser', from: x, to: x + SPACING * 4 })
      }
      if (ev.booster === 'magnet') {
        magnet = 3
        spans.push({ booster: 'magnet', from: x, to: x + SPACING * 3 })
      }
    }
    level = ev.level
    if (ev.kind === 'rocket' && !ev.blocked) {
      if (ev.fall === 'crash') {
        // hit at the lowest level: the plane goes straight into the sea
        splashes.push({ x: x + 240, type: 'sink' })
        px.push(x + 240, x + 420)
        py.push(WATER - 10, WATER + 110)
        break
      }
      if (ev.fall === 'rescue' || ev.fall === 'skim') {
        const touch = x + 230
        splashes.push({ x: touch, type: ev.fall })
        px.push(touch, x + SPACING * 0.66)
        py.push(ev.fall === 'rescue' ? WATER - 18 : WATER - 70, yOfLevel(level))
        continue
      }
      // an ordinary hit knocks the plane down, quickly but without snapping
      px.push(x + SPACING * 0.42)
      py.push(yOfLevel(level))
      continue
    }
    px.push(x + SPACING * 0.5)
    py.push(yOfLevel(level) + jitter(12))
  }

  const lastX = FIRST_EVENT_X + (events.length - 1) * SPACING
  const endY = yOfLevel(level)
  let touchdownX: number | null = null
  let splashX: number | null = null
  let stopX: number
  let islandX: number

  if (outcome.landing === 'crash') {
    splashX = splashes[splashes.length - 1]!.x
    islandX = lastX + 2600
    stopX = splashX + 180
  } else if (outcome.landing === 'water' || outcome.landing === 'buoy') {
    // a glide that starts gently and steepens into the sea; higher planes glide further
    const g0 = lastX + SPACING * 0.5
    const drop = WATER - endY
    const glide = 700 + drop * 1.5
    splashX = g0 + glide
    px.push(g0 + glide * 0.4, splashX - 220, splashX)
    py.push(endY + drop * 0.18, WATER - 130, WATER - (outcome.landing === 'buoy' ? 18 : 10))
    if (outcome.landing === 'water') {
      splashes.push({ x: splashX, type: 'sink' })
      islandX = splashX + 260 - ISLAND_RUNWAY_X0
      px.push(splashX + 180)
      py.push(WATER + 110)
      stopX = splashX + 180
    } else {
      splashes.push({ x: splashX, type: 'rescue' })
      touchdownX = splashX + 1100
      islandX = touchdownX - ISLAND_RUNWAY_X0 - 80
      px.push(splashX + 360, touchdownX - 320, touchdownX, touchdownX + 700)
      py.push(WATER - 330, PLANE_RUNWAY_Y - 70, PLANE_RUNWAY_Y, PLANE_RUNWAY_Y)
      stopX = touchdownX + 420
    }
  } else {
    // approach: long enough for the height to lose, easing onto the runway
    const g0 = lastX + SPACING * 0.5
    const drop = Math.max(0, PLANE_RUNWAY_Y - endY)
    touchdownX = g0 + Math.max(outcome.landing === 'max' ? 700 : 850, 420 + drop * 1.5)
    islandX = touchdownX - ISLAND_RUNWAY_X0 - 80
    px.push(g0 + (touchdownX - 380 - g0) * 0.5, touchdownX - 380, touchdownX, touchdownX + 700)
    py.push(endY + drop * 0.35, endY + drop * 0.8, PLANE_RUNWAY_Y, PLANE_RUNWAY_Y)
    stopX = touchdownX + 420
  }

  const tangents = monotone(px, py)
  return { events, splashes, lastX, islandX, touchdownX, splashX, stopX, pathX: px, pathY: py, tangents, boosterSpans: spans }
}

/** Island vertical placement: its waterline sits on the sea line. */
export const ISLAND_TOP = WATER - ISLAND_WATER_Y
