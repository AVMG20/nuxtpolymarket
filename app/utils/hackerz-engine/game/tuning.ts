import * as THREE from 'three'
import type { HackerzDamageType, HackerzWeaponRuntime } from '#shared/utils/gamelogic/hackerz'
import { FIELD_HALF_WIDTH, FIELD_SCALE, FENCE_HEIGHT, GUN_Z, WALL_HEIGHT } from '../constants'

/** Field units per world unit, for heights that only exist for rendering. */
export const PER_WORLD = 1 / FIELD_SCALE

/**
 * Where leaked memory piles up: between the fence and the Daemons hitting it;
 * and how big, so a full pile stands about fence-high, the size it is beside a
 * Daemon on the database turntable.
 */
export const LEAK_D = 14

export const _v = new THREE.Vector3()
export const _w = new THREE.Vector3()

/** Held ground bites: a tick this often, of this share of max health plus a flat bite. */
export const ZONE_TICK_MS = 500

/** BLACKOUT: hostiles further out than this are dark until a ping lights them. */
export const BLACKOUT_LIGHT_D = 260

/** How long ROOTKIT stays gone when it burrows, its dive into the floor included; and how many spiderlings scatter where it goes under. */
export const ROOTKIT_BURROW_MS = 2600

export const GLITCH_FADE_MS = 400

/**
 * A model's half extents on the ground, in field units: across (`x`) and
 * along (`z`) its own axes. A rig's box is fixed once built, so each is
 * worked out once.
 */
export function halfExtents(box: THREE.Box3) {
    let half = halves.get(box)
    if (!half) {
        half = {
            x: Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) * PER_WORLD,
            z: Math.max(Math.abs(box.min.z), Math.abs(box.max.z)) * PER_WORLD
        }
        halves.set(box, half)
    }
    return half
}

export const halves = new WeakMap<THREE.Box3, { x: number, z: number }>()

/** The clearance kept between two bodies on the ground, in field units. */
export const CROWD_GAP = 4

/**
 * A rider's line is guidance, not a rail: it may stand off it by up to this
 * much (field units) to step round a body or stand beside one, which is
 * enough to reach the next pin over. It eases back onto the line, at this
 * share of its speed, whenever there is room.
 */
export const LANE_SLACK = 70

/** Where the fence is struck, and where dropped coins bank. */
export const WALL_HIT_Y = FENCE_HEIGHT * 0.55 * PER_WORLD

/** Turret and rail muzzles sit this high above the field, in field units. */
export const MUZZLE_Y = (WALL_HEIGHT + 1.1) * PER_WORLD

/** What a projectile carries, whoever fired it. */
export interface ShotSpec {
    damage: number
    pierce: number
    damageType: HackerzDamageType
    splashRadius: number
    splashDamage: number
    homing: boolean
    chain: number
    chainFalloff: number
    speed: number
    hex: number
    projectile: HackerzWeaponRuntime['projectile']
    crit: boolean
    fromTurret: boolean
}

/**
 * Rounds start on the deck, well behind the fence. Walkers stop a body-width
 * out from the fence to hit it, so the guns have to stand back far enough that
 * a unit at the fence is in front of every barrel rather than under it.
 */
export const MUZZLE_D = -GUN_Z * PER_WORLD

/** PACKET LOSS: the share of player rounds that never arrive. */
export const PACKET_LOSS = 0.25

/**
 * The Longbore punching through a body: the flame it throws up, how long the
 * round hangs in the body before carrying on, and how hard it drives it back.
 */
export const LONGBORE_FLARE = 0xc084fc

/**
 * The Longbore's track: how far either side of the middle it can glide (field
 * units, just inside the lane), and how fast — quick enough to keep up with a
 * cursor sweeping the lane.
 */
export const RAIL_TRACK = FIELD_HALF_WIDTH - 20

/** Radar ping: recharge, wavefront speed in field units a second, and how long a contact stays lit. */
export const PING_COOLDOWN_MS = 3500

/** The most hackers that work one node at once; the rest wait this much further out for a free terminal. */
export const HACK_TEAM = 4

/** Facing for a rider: down the column toward the fence, or along a rung. */
export const YAW_DOWN = 0
