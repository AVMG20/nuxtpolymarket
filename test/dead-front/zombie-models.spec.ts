import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DF_ENEMIES } from '#shared/utils/dead-front/enemies'
import type { DfZombieAnim } from '#shared/utils/dead-front/protocol'
import type { DfEnemyType } from '#shared/utils/dead-front/types'
import {
    DF_ZOMBIE_OUTFITS, DF_ZOMBIE_PARENT, DF_ZOMBIE_PARTS, DF_ZOMBIE_TYPES, P, dfBuildZombie, dfZombieJoints
} from '../../app/utils/dead-front/world/zombies/models'
import { DF_POSE_LEN, dfEvalPose, dfNewPose } from '../../app/utils/dead-front/world/zombies/pose'
import type { DfPoseInput } from '../../app/utils/dead-front/world/zombies/pose'

/** World matrices of every part in the rest pose (identity rotations), feet at the origin. */
function restMatrices(type: DfEnemyType, outfit: number): { build: ReturnType<typeof dfBuildZombie>, world: THREE.Matrix4[] } {
    const build = dfBuildZombie(type, outfit)
    const joints = dfZombieJoints(build.dims)
    const world: THREE.Matrix4[] = []
    const order = [P.pelvis, P.torso, P.head, P.eyes, P.helmet, P.armUL, P.armLL, P.armUR, P.armLR, P.legUL, P.legLL, P.legUR, P.legLR]
    for (const p of order) {
        const parent = DF_ZOMBIE_PARENT[p]!
        const m = new THREE.Matrix4().makeTranslation(joints[p]!.x, joints[p]!.y, joints[p]!.z)
        world[p] = parent < 0 ? m : m.premultiply(world[parent]!)
    }
    return { build, world }
}

function restBounds(type: DfEnemyType, outfit: number): THREE.Box3 {
    const { build, world } = restMatrices(type, outfit)
    const box = new THREE.Box3()
    build.parts.forEach((part, i) => {
        if (!part) return
        const geo = part.model.mesh(build.dims.v, part.pivot)
        if (!geo) return
        geo.applyMatrix4(world[i]!)
        geo.computeBoundingBox()
        box.union(geo.boundingBox!)
        geo.dispose()
    })
    return box
}

function input(type: DfEnemyType, anim: DfZombieAnim, t: number): DfPoseInput {
    return {
        type, anim, t, phase: t * 1.3, move: 1, limp: 0.6, limpSide: 1, arms: 2, hunch: 0.05, tilt: 0.1, seed: 0.3,
        swing: t % 1.4, windup: DF_ENEMIES[type].windup, spit: t % 1.3, spitWindup: 0.75, tearPeriod: 1, height: DF_ENEMIES[type].height, tell: 0
    }
}

describe('dead front zombie models', () => {
    for (const type of DF_ZOMBIE_TYPES) {
        const def = DF_ENEMIES[type]

        it(`${type}: head centre sits at headY and the body matches the hitboxes`, () => {
            for (let outfit = 0; outfit < DF_ZOMBIE_OUTFITS; outfit++) {
                const { build, world } = restMatrices(type, outfit)
                // The head cube is 5 voxels with its centre 3 voxels above the neck joint.
                const head = new THREE.Vector3(0, 3 * build.dims.v, 0).applyMatrix4(world[P.head]!)
                expect(Math.abs(head.y - def.headY)).toBeLessThan(0.02)
                expect(Math.hypot(head.x, head.z)).toBeLessThan(def.headR)
                const box = restBounds(type, outfit)
                expect(Math.abs(box.max.y - def.height)).toBeLessThan(0.15)
                expect(box.min.y).toBeGreaterThan(-0.03)
                expect(box.min.y).toBeLessThan(0.03)
                // Body fits the collision radius (the arms get a little slack).
                expect(Math.max(-box.min.x, box.max.x)).toBeLessThan(def.radius + 0.15)
            }
        })

        it(`${type}: every animation produces finite poses`, () => {
            const pose = dfNewPose()
            const anims: DfZombieAnim[] = ['rise', 'walk', 'run', 'sprint', 'attack', 'tear', 'climb', 'spit', 'stagger']
            for (const anim of anims) {
                for (let t = 0; t < 3; t += 0.1) {
                    for (const tell of anim === 'attack' ? [0, 1, 2] : [0]) {
                        dfEvalPose({ ...input(type, anim, t), tell }, pose)
                        for (let n = 0; n < DF_POSE_LEN; n++) expect(Number.isFinite(pose[n])).toBe(true)
                    }
                }
            }
        })
    }

    it('builds every part with glowing eyes', () => {
        for (const type of DF_ZOMBIE_TYPES) {
            const b = dfBuildZombie(type, 0)
            expect(b.parts.length).toBe(DF_ZOMBIE_PARTS)
            const eyes = b.parts[P.eyes]!
            expect(eyes.model.palette.some(p => (p.emissive ?? 0) > 0.5)).toBe(true)
        }
    })

    it('gives the brute a helmet and the others none', () => {
        expect(dfBuildZombie('brute', 0).parts[P.helmet]).not.toBeNull()
        for (const type of ['shambler', 'ghoul', 'bloater'] as const) expect(dfBuildZombie(type, 0).parts[P.helmet]).toBeNull()
    })

    it('reads the silhouettes apart: ghoul lanky, brute huge, bloater swollen', () => {
        const width = (t: DfEnemyType) => {
            const b = restBounds(t, 0)
            return b.max.z - b.min.z
        }
        expect(width('bloater')).toBeGreaterThan(width('shambler'))
        expect(width('ghoul')).toBeLessThan(width('shambler') + 0.02)
        expect(restBounds('brute', 0).max.y).toBeGreaterThan(restBounds('shambler', 0).max.y + 0.3)
    })
})
