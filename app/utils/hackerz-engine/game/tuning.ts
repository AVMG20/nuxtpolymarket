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
