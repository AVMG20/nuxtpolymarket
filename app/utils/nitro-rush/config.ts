/**
 * Nitro Rush tuning. Units are metres, seconds and radians; speeds are m/s.
 *
 * The car is an arcade model, not a simulation: in grip it goes where the
 * front wheels point until the tyres run out of lateral grip and it washes
 * wide; in a drift the nose swings past the direction of travel and the slip
 * angle, which the player steers, sets how hard the car turns.
 */

/** Physics runs at a fixed rate so the car feels the same at 60 Hz and 144 Hz. */
export const PHYSICS_HZ = 120

export const CAR_HALF_WIDTH = 0.95
export const WHEELBASE = 2.84

/** Engine thrust tails off linearly to nothing at this speed; drag keeps the real top a little lower. */
export const ENGINE_TOP_SPEED = 86
export const ENGINE_ACCEL = 24
export const BRAKE_DECEL = 34
export const REVERSE_ACCEL = 9
export const REVERSE_MAX = 12
export const ROLLING_DRAG = 1.2
export const AERO_DRAG = 0.0009

/** Steering ramps in and out rather than snapping, so the keyboard steers smoothly. */
export const STEER_RATE = 3.2
export const STEER_RETURN_RATE = 5.5
/** Front-wheel lock at a standstill; it narrows with speed so the car stays stable flat out. */
export const MAX_STEER_ANGLE = 0.55
export const STEER_FALLOFF_SPEED = 22
/** The most lateral acceleration the tyres hold in grip; past it the car washes wide. */
export const GRIP_LATERAL = 27
/** How quickly the nose settles back onto the direction of travel in grip. */
export const GRIP_ALIGN = 9

/** Drifting holds more lateral load than grip: that is the reward for the speed it scrubs. */
export const DRIFT_LATERAL = 34
export const DRIFT_MIN_SPEED = 16
/** How fast the travel direction swings toward the nose, per radian of slip. */
export const DRIFT_ALIGN = 1.5
/** Slip angle with the wheel fully into the drift, centred, and fully away: the tight, middle and wide lines. */
export const DRIFT_SLIP_IN = 0.78
export const DRIFT_SLIP_MID = 0.5
export const DRIFT_SLIP_WIDE = 0.22
export const DRIFT_SLIP_RESPONSE = 4.5
/** Speed scrubbed per second at a full sideways slide; scaled by sin(slip). */
export const DRIFT_SCRUB = 22

/** How much of the speed into a wall bounces back out of it. */
export const WALL_RESTITUTION = 0.25
/** Speed lost along the wall per unit of impact speed: high enough that turning off a wall loses to braking for the bend (scripts/nitro-rush-walls.ts). */
export const WALL_FRICTION = 2
/** Share of its speed along the wall a hit always leaves, so a medium crash doesn't leave the car crawling straight across the road. */
export const WALL_KEEP_MIN = 0.2
/** Impacts above this (m/s into the wall) break a drift. */
export const WALL_HARD_IMPACT = 7
/** Share of its speed the car sheds per second while rubbing a side wall. */
export const WALL_SCRAPE = 1.5
/** Metres off a side wall that still count as rubbing it: a car pressed on one lifts off a little between hits. */
export const WALL_TOUCH_GAP = 0.2
/** Seconds after a hit that the car still counts as pressed on the wall: a rub only hits where the wall bends, at the road's points. */
export const WALL_PRESS_HOLD = 0.3

export const NITRO_DURATION = 3
export const NITRO_ACCEL = 16
export const NITRO_TOP_SPEED_MULT = 1.2
/** Nitro earned per second of drift, banked when the drift ends. */
export const NITRO_PER_DRIFT_SECOND = 0.16

export const COUNTDOWN_SECONDS = 3

/** Displayed km/h per m/s. */
export const KMH_PER_SPEED = 3.6

/** The player's own ghost, unless a source gives a colour. */
export const GHOST_COLOR = 0x8fd8ff
/** The course record holder's ghost. */
export const RECORD_GHOST_COLOR = 0xffc83d
/** The neon pink of the walls, arches and the builder's highlights. */
export const NEON_PINK = 0xff2bd6

/** How the builder marks each line block, on the map and in the 3D preview. */
export const LINE_COLORS = { start: 0xffffff, checkpoint: 0x3df2ff, finish: 0xffd23d } as const

/** A hex colour number as CSS reads it. */
export const cssColor = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`

export interface Theme {
    skyTop: number
    skyHorizon: number
    /** City light pollution along the horizon. */
    glow: number
    cloud: number
    /** Cloud underside, lit by the city. */
    cloudLight: number
    cloudCover: number
    moon: number
    fog: number
    fogDensity: number
    /** Floodlight colour. */
    lamp: number
    hemiSky: number
    hemiGround: number
    hemi: number
    sun: number
    sunIntensity: number
    sunHeight: number
    /** Reflection strength on paint and glass. */
    env: number
    /** How wet the track is. */
    wet: number
}

export const NIGHT: Theme = {
    skyTop: 0x03050c, skyHorizon: 0x1d1830, glow: 0xff9a5a, cloud: 0x0c0d14, cloudLight: 0x4a3a3a, cloudCover: 0.55, moon: 1,
    fog: 0x0d0e16, fogDensity: 0.0022, lamp: 0xffd2a0, hemiSky: 0x4a5070, hemiGround: 0x0c0a0a, hemi: 0.4, sun: 0x9fb4ff, sunIntensity: 0.35, sunHeight: 60, env: 1.7, wet: 0.8
}

export { findPaint, PAINTS, type PaintId } from '#shared/utils/nitro-rush/paints'
