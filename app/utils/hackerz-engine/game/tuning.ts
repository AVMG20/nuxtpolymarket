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
