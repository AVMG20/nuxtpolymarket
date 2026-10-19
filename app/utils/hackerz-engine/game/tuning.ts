import * as THREE from 'three'
import { FIELD_HALF_WIDTH, FIELD_SCALE, FENCE_HEIGHT, GUN_Z, WALL_HEIGHT } from '../constants'

/*
 * The measures more than one of the game's systems works with. Anything only
 * one system uses lives in that system's own file.
 */

// ── Scale and the deck ──

/** Field units per world unit, for heights that only exist for rendering. */
export const PER_WORLD = 1 / FIELD_SCALE
/** Turret and rail muzzles sit this high above the field, in field units. */
export const MUZZLE_Y = (WALL_HEIGHT + 1.1) * PER_WORLD
/**
 * Rounds start on the deck, well behind the fence. Walkers stop a body-width
 * out from the fence to hit it, so the guns have to stand back far enough that
 * a unit at the fence is in front of every barrel rather than under it.
 */
export const MUZZLE_D = -GUN_Z * PER_WORLD
/** Where the fence is struck. */
export const WALL_HIT_Y = FENCE_HEIGHT * 0.55 * PER_WORLD
/** Where leaked memory piles up: between the fence and the Daemons hitting it. */
export const LEAK_D = 14
/** How far either side of the middle the Longbore's track runs, in field units: just inside the lane. */
export const RAIL_TRACK = FIELD_HALF_WIDTH - 20
/** The colour of the flame a railgun round throws up punching through a body. */
export const LONGBORE_FLARE = 0xc084fc

// ── Bodies on the ground ──

/** The clearance kept between two bodies on the ground, in field units. */
export const CROWD_GAP = 4
/**
 * A rider's line is guidance, not a rail: it may stand off it by up to this
 * much (field units) to step round a body or stand beside one, which is
 * enough to reach the next pin over.
 */
export const LANE_SLACK = 70
/** Facing for a rider running down its column toward the fence. */
export const YAW_DOWN = 0

// ── Clocks ──

/** How often held ground bites the units on it, and red ground heals its own. */
export const ZONE_TICK_MS = 500
/** The last stretch of a wave: everything drops what it is doing and charges the fence. */
export const FINAL_PUSH_MS = 12_000
/** How long the radar ping takes to recharge. */
export const PING_COOLDOWN_MS = 3500
/** How long a contact the ping lit stays lit. */
export const PING_REVEAL_MS = 2600
/** How long ROOTKIT stays gone when it burrows, its dive into the floor included. */
export const ROOTKIT_BURROW_MS = 2600
/** Over how much of the end a blast's glitch eases out. */
export const GLITCH_FADE_MS = 400

// ── The fight ──

/** Hackers get to work within this far of a node — a column over still counts. */
export const HACK_REACH = 125
/** The most hackers that work one node at once. */
export const HACK_TEAM = 4
/** BLACKOUT: hostiles further out than this are dark until a ping lights them. */
export const BLACKOUT_LIGHT_D = 260
/** PACKET LOSS: the share of player rounds that never arrive. */
export const PACKET_LOSS = 0.25

/**
 * Scratch vectors shared by every module of the game. Fill one and use it on
 * the same line: never hold one across a call into another system.
 */
export const _v = new THREE.Vector3()
export const _w = new THREE.Vector3()
