import { PIRATE_WORLD_H, PIRATE_WORLD_W } from '#shared/utils/gamelogic/pirates'

// The whole sea is always in view and scaled to fit the host element.
export const WORLD_W = PIRATE_WORLD_W
export const WORLD_H = PIRATE_WORLD_H
export const BALL_SPEED = 820 // px/s
// Stagger between two player guns firing. Short enough that a full eight-port
// deck with Quick Hands is never throttled by it.
export const PLAYER_CANNON_FIRE_GAP_MS = 35
export const PICKUP_RADIUS = 50
export const HOLD_RANGE_FRACTION = 0.85
export const WAYPOINT_REACH_DIST = 12
export const PLAYER_BOMB_RADIUS = 145
/** Guns only fire once their barrel is within this many radians of the target. */
export const GUN_FIRE_ARC = 0.3
/** How fast a barrel slews toward its target, radians per second. */
export const GUN_SLEW_RATE = 7

// Pathfinding grid — coarse cells over circular island obstacles. Ships are
// treated as circles of SHIP_RADIUS for clearance checks.
export const CELL = 35
export const GRID_W = Math.ceil(WORLD_W / CELL)
export const GRID_H = Math.ceil(WORLD_H / CELL)
export const SHIP_RADIUS = 26
export const ISLAND_COUNT_MIN = 5
export const ISLAND_COUNT_MAX = 7
