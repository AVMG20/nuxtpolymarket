import * as THREE from 'three'
import { FIELD_SCALE } from '../constants'

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
