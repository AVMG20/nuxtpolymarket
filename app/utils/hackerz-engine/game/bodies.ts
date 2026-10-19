import type * as THREE from 'three'
import { hackerzIsAirborne, type HackerzEnemyDefinition, type HackerzEnemyId } from '#shared/utils/gamelogic/hackerz'
import { FIELD_SCALE } from '../constants'
import { MOTION, burrowFrame, hoverBob } from '../rig-motion'
import { fieldToWorld } from '../scene'
import type { EnemyEntity } from '../types'
import { PER_WORLD, ROOTKIT_BURROW_MS, GLITCH_FADE_MS } from './tuning'

/*
 * A unit's body on the board: how big it is, where it stands and is drawn,
 * and how it takes up room on the ground. Pure functions of the unit.
 */

/**
 * Units drawn smaller than their height in the rules says: ROOTKIT's legs
 * spread far wider than it is tall, so at full size it straddled half the
 * fence. Its body, hitbox, standoff, stride and spacing all shrink together.
 */
const UNIT_DISPLAY_SCALE: Partial<Record<HackerzEnemyId, number>> = { titan: 0.55 }
/** How much bigger (footprint area) a body must be to barge another out of its way. */
const BARGE_RATIO = 1.6

const halves = new WeakMap<THREE.Box3, { x: number, z: number }>()

/** A unit's size on the board, in the rules' height units. */
export function unitSize(def: HackerzEnemyDefinition) {
    return def.height * (UNIT_DISPLAY_SCALE[def.id] ?? 1)
}

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

/** World position of an enemy, `lift` field units above where it stands. */
export function enemyWorld(enemy: EnemyEntity, lift: number, out: THREE.Vector3) {
    return fieldToWorld(enemy.u, enemy.d, (enemy.altitude + lift) * FIELD_SCALE, out)
}

/** Field height of an enemy's centre of mass, for aiming and splash. */
export function enemyCentreY(enemy: EnemyEntity) {
    return enemy.altitude + enemy.rig.height * PER_WORLD * 0.5
}

export function placeEnemy(enemy: EnemyEntity) {
    const bob = hackerzIsAirborne(enemy.def) ? hoverBob(enemy.hover) : 0
    fieldToWorld(enemy.u, enemy.d, (enemy.altitude + bob) * FIELD_SCALE + burrowing(enemy).lift * enemy.rig.height, enemy.rig.root.position)
    // Corrupted by a blast, the whole unit skips: it snaps to a random spot
    // nearby — sideways, up, forwards or back — holds there a few frames,
    // snaps home, and goes again until the corruption fades, stuttering
    // all the while. Cosmetic: the picture only, never where it really is.
    const glitch = glitchOf(enemy)
    if (glitch <= 0) {
        enemy.glitchJump = undefined
        return
    }
    const jump = enemy.glitchJump ??= { x: 0, y: 0, z: 0, frames: 0 }
    if (--jump.frames <= 0) {
        const away = jump.x === 0 && jump.y === 0 && jump.z === 0 && Math.random() < 0.6
        const reach = enemy.rig.height * glitch
        jump.x = away ? (Math.random() - 0.5) * 1.2 * reach : 0
        jump.y = away ? Math.random() * 0.5 * reach : 0
        jump.z = away ? (Math.random() - 0.5) * 1.2 * reach : 0
        jump.frames = away ? 2 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 4)
    }
    enemy.rig.root.position.x += jump.x
    enemy.rig.root.position.y += jump.y
    enemy.rig.root.position.z += jump.z
    // And under the skips, a constant sideways stutter.
    if (Math.random() < 0.4) enemy.rig.root.position.x += (Math.random() - 0.5) * 0.45 * glitch * enemy.rig.height
}

/** How hard a unit is glitching after a blast caught it, 0 to 1. */
export function glitchOf(enemy: EnemyEntity) {
    return Math.min(1, (enemy.glitchMs ?? 0) / GLITCH_FADE_MS)
}

/** Where a burrowing unit (ROOTKIT) is in its dive or its climb back out: its leap, spin and gathered legs. */
export function burrowing(enemy: EnemyEntity) {
    if (enemy.burrowMs > 0) return burrowFrame((ROOTKIT_BURROW_MS - enemy.burrowMs) / MOTION.burrowSinkMs, null)
    if (enemy.riseMs > 0) return burrowFrame(null, 1 - enemy.riseMs / MOTION.burrowRiseMs)
    return burrowFrame(null, null)
}

/** True while a burrowing unit is fully under the floor: out of sight, and out of every gun's reach. */
export function underground(enemy: EnemyEntity) {
    return enemy.burrowMs > 0 && ROOTKIT_BURROW_MS - enemy.burrowMs >= MOTION.burrowSinkMs
}

/** How much of a body there is to push with: its footprint's area, from its model. */
export function bulk(enemy: EnemyEntity) {
    const half = halfExtents(enemy.rig.box)
    return half.x * half.z
}

/** A body this much bigger than the one in its way barges it aside instead of waiting. */
export function outweighs(enemy: EnemyEntity, other: EnemyEntity) {
    return bulk(enemy) >= bulk(other) * BARGE_RATIO
}

/** How far a point on the ground is from the nearest edge of a body's footprint: 0 inside it. */
export function reachOf(enemy: EnemyEntity, u: number, d: number) {
    const foot = footprint(enemy)
    return Math.hypot(Math.max(0, Math.abs(enemy.u - u) - foot.u), Math.max(0, Math.abs(enemy.d - d) - foot.d))
}

/**
 * How far `enemy`, standing at (u, d), sinks into `other`'s footprint: the
 * smaller of its two overlaps, or 0 when they are clear of each other.
 */
export function sinkInto(enemy: EnemyEntity, u: number, d: number, other: EnemyEntity) {
    const fa = footprint(enemy)
    const fb = footprint(other)
    const ou = fa.u + fb.u - Math.abs(other.u - u)
    const od = fa.d + fb.d - Math.abs(other.d - d)
    return ou > 0 && od > 0 ? Math.min(ou, od) : 0
}

/**
 * A unit's half extents on the ground (field units): across the lane (`u`)
 * and along it (`d`), from its model's own bounds, turned with its yaw.
 */
export function footprint(enemy: EnemyEntity) {
    const box = enemy.rig.box
    // Collision asks for every pair every tick, so it is kept until the
    // unit turns (or changes body) rather than worked out each time.
    const foot = enemy.foot ??= { yaw: NaN, box, u: 0, d: 0 }
    if (foot.yaw === enemy.yaw && foot.box === box) return foot
    const half = halfExtents(box)
    const c = Math.abs(Math.cos(enemy.yaw))
    const s = Math.abs(Math.sin(enemy.yaw))
    foot.yaw = enemy.yaw
    foot.box = box
    foot.u = c * half.x + s * half.z
    foot.d = s * half.x + c * half.z
    return foot
}
