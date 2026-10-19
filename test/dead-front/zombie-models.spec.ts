import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DF_ENEMIES, dfCrawlGeometry } from '#shared/utils/dead-front/enemies'
import type { DfZombieAnim } from '#shared/utils/dead-front/protocol'
import type { DfEnemyType } from '#shared/utils/dead-front/types'
import {
    DF_ZOMBIE_ORDER, DF_ZOMBIE_OUTFITS, DF_ZOMBIE_PARENT, DF_ZOMBIE_PARTS, DF_ZOMBIE_TYPES, P, dfBuildZombie, dfZombieJoints
} from '../../app/utils/dead-front/world/zombies/models'
import { DF_CRAWL_FALL, DF_POSE_LEN, DF_POSE_ROOT, dfEvalPose, dfNewPose } from '../../app/utils/dead-front/world/zombies/pose'
import type { DfPose, DfPoseInput } from '../../app/utils/dead-front/world/zombies/pose'

/** Parts only shown on some zombies (the gas mask, a crawler's stumps). */
const TOGGLED: number[] = [P.mask, P.stumpL, P.stumpR]

/** World matrices of every part, feet at the origin facing +z, posed like the zombie view's rig (rest pose by default). */
function restMatrices(type: DfEnemyType, outfit: number, pose: DfPose = dfNewPose()): { build: ReturnType<typeof dfBuildZombie>, world: THREE.Matrix4[] } {
    const build = dfBuildZombie(type, outfit)
    const joints = dfZombieJoints(build.dims)
    const world: THREE.Matrix4[] = []
    const r = DF_POSE_ROOT
    const root = new THREE.Matrix4().makeTranslation(pose[r]!, pose[r + 1]!, pose[r + 2]!)
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pose[r + 3]!, 0, pose[r + 4]!, 'XYZ')))
    for (const p of DF_ZOMBIE_ORDER) {
        const parent = DF_ZOMBIE_PARENT[p]!
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pose[p * 3]!, pose[p * 3 + 1]!, pose[p * 3 + 2]!, 'XYZ'))
        const m = new THREE.Matrix4().compose(joints[p]!, q, new THREE.Vector3(1, 1, 1))
        world[p] = m.premultiply(parent < 0 ? root : world[parent]!)
    }
    return { build, world }
}

function restBounds(type: DfEnemyType, outfit: number, pose?: DfPose, skip: number[] = TOGGLED): THREE.Box3 {
    const { build, world } = restMatrices(type, outfit, pose)
    const box = new THREE.Box3()
    build.parts.forEach((part, i) => {
        if (!part || skip.includes(i)) return
        const geo = part.model.mesh(build.dims.v * (part.cell ?? 1), part.pivot)
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
            const anims: DfZombieAnim[] = ['rise', 'walk', 'run', 'sprint', 'attack', 'tear', 'climb', 'spit', 'stagger', 'crawl']
            for (const anim of anims) {
                for (let t = 0; t < 3; t += 0.1) {
                    for (const tell of anim === 'attack' ? [0, 1, 2] : [0]) {
                        for (const crawl of [false, true]) {
                            dfEvalPose({ ...input(type, anim, t), tell, crawl, down: t * 0.3 }, pose)
                            for (let n = 0; n < DF_POSE_LEN; n++) expect(Number.isFinite(pose[n])).toBe(true)
                        }
                    }
                }
            }
        })
    }

    for (const type of ['shambler', 'ghoul'] as const) {
        it(`${type}: the crawl lies where the crawler's hitboxes are`, () => {
            const g = dfCrawlGeometry(type)
            const def = DF_ENEMIES[type]
            const pose = dfNewPose()
            const at = (m: THREE.Matrix4, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m)
            const toSegment = (p: THREE.Vector3, a: number, b: number, y: number) => Math.hypot(p.x, p.y - y, p.z - Math.max(a, Math.min(b, p.z)))
            for (const anim of ['crawl', 'attack', 'stagger'] as const) {
                for (let ph = 0; ph < 1; ph += 0.05) {
                    const inp = { ...input(type, anim, 2.5), phase: ph, swing: ph * 1.6, tilt: 0, crawl: true, down: DF_CRAWL_FALL }
                    dfEvalPose(inp, pose)
                    const { build, world } = restMatrices(type, 0, pose)
                    const v = build.dims.v
                    // head: the cube's centre is 3 voxels above the neck joint
                    const head = at(world[P.head]!, 0, 3 * v, 0)
                    expect(Math.abs(head.x), `${anim} ${ph}`).toBeLessThan(0.06)
                    expect(Math.abs(head.y - g.headY), `${anim} ${ph}`).toBeLessThan(anim === 'crawl' ? 0.05 : 0.12)
                    expect(Math.abs(head.z - g.headAhead), `${anim} ${ph}`).toBeLessThan(anim === 'crawl' ? 0.05 : 0.12)
                    // the chest lies along the body capsule, the thigh stumps along the legs capsule
                    expect(toSegment(at(world[P.torso]!, 0, 3 * v, 0), g.bodyFrom, g.bodyTo, g.bodyY)).toBeLessThan(g.bodyR * 0.6)
                    expect(toSegment(at(world[P.pelvis]!, 0, v, 0), g.bodyFrom, g.bodyTo, g.bodyY)).toBeLessThan(g.bodyR)
                    for (const leg of [P.legUL, P.legUR]) expect(toSegment(at(world[leg]!, 0, -3 * v, 0), g.legFrom, g.bodyFrom, g.legY)).toBeLessThan(g.legR + 0.04)
                    // low to the ground: nothing sinks through it, and the body stays under the head
                    const box = restBounds(type, 0, pose, [P.mask, P.legLL, P.legLR])
                    expect(box.min.y, `${anim} ${ph}`).toBeGreaterThan(-0.05)
                    const body = restBounds(type, 0, pose, [...TOGGLED, P.legLL, P.legLR, P.head, P.eyes, P.armUL, P.armLL, P.armUR, P.armLR])
                    // (the swipe rears the chest up a little)
                    expect(body.max.y, `${anim} ${ph}`).toBeLessThan(g.headY + (anim === 'attack' ? g.headR * 0.5 : 0))
                    if (anim === 'crawl') {
                        // the arms claw the ground: a hand is planted at all times
                        const hands = [P.armLL, P.armLR].map(p => at(world[p]!, 0, -6 * v, 0).y)
                        expect(Math.min(...hands)).toBeLessThan(0.1)
                        expect(Math.min(...hands)).toBeGreaterThan(-0.02)
                        expect(restBounds(type, 0, pose, [...TOGGLED, P.legLL, P.legLR]).max.y).toBeLessThan(def.headY * 0.5)
                    }
                }
            }
        })
    }

    it('topples a zombie onto its front when its legs come off', () => {
        const pose = dfNewPose()
        const heads: number[] = []
        for (let down = 0; down <= DF_CRAWL_FALL + 0.01; down += DF_CRAWL_FALL / 5) {
            dfEvalPose({ ...input('shambler', 'stagger', down), crawl: true, down }, pose)
            const { build, world } = restMatrices('shambler', 0, pose)
            heads.push(new THREE.Vector3(0, 3 * build.dims.v, 0).applyMatrix4(world[P.head]!).y)
        }
        // on its stumps at first (head at knee-less height), then all the way down
        expect(heads[0]!).toBeGreaterThan(DF_ENEMIES.shambler.headY - 0.5)
        for (let i = 1; i < heads.length; i++) expect(heads[i]!).toBeLessThan(heads[i - 1]! + 0.01)
        expect(heads.at(-1)!).toBeLessThan(0.6)
    })

    it('builds the toggled parts: gas masks and knee stumps', () => {
        for (const type of DF_ZOMBIE_TYPES) {
            for (let outfit = 0; outfit < DF_ZOMBIE_OUTFITS; outfit++) {
                const b = dfBuildZombie(type, outfit)
                expect(b.parts[P.stumpL]).not.toBeNull()
                expect(b.parts[P.stumpR]).not.toBeNull()
                // brutes wear the iron helmet, and the hooded bloater has a mask of its own
                const hooded = type === 'bloater' && outfit % 2 === 1
                expect(b.parts[P.mask] === null).toBe(type === 'brute' || hooded)
            }
        }
        // the mask fits over the head: wider than the head cube but not a balloon, goggles that glow
        const mask = dfBuildZombie('ghoul', 0).parts[P.mask]!
        expect(mask.model.palette.some(p => (p.emissive ?? 0) > 0.3)).toBe(true)
        const all = restBounds('ghoul', 0, undefined, [])
        const bare = restBounds('ghoul', 0)
        expect(all.max.z - bare.max.z).toBeGreaterThan(0.05)
        expect(all.max.z - bare.max.z).toBeLessThan(0.25)
        expect(all.max.y - bare.max.y).toBeLessThan(0.05)
    })

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
