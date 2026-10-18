import { describe, expect, it } from 'vitest'
import { dfBodyFits, dfBuildCollision, dfCollisionFromSolids, dfGroundHeight, dfLineOfSight, dfMoveBody, dfRaycast } from '../../shared/utils/dead-front/physics'
import type { DfBodyOpts, DfCollisionWorld } from '../../shared/utils/dead-front/physics'
import type { DfMapDef, DfSolid } from '../../shared/utils/dead-front/map'
import type { Vec3 } from '../../shared/utils/dead-front/types'

function solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, extra: Partial<DfSolid> = {}): DfSolid {
    return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, mat: 'stone', ...extra }
}

const floor = solid(-20, -1, -20, 20, 0, 20, { mat: 'mud' })
const player: DfBodyOpts = { radius: 0.35, height: 1.8, stepHeight: 0.42 }
const zombie: DfBodyOpts = { ...player, zombie: true }

function run(world: DfCollisionWorld, from: Vec3, vel: { x: number, z: number }, seconds: number, opts: DfBodyOpts = player, gravity = 16): { pos: Vec3, grounded: boolean } {
    let pos = { ...from }
    let v = { x: vel.x, y: 0, z: vel.z }
    let grounded = false
    const dt = 1 / 60
    for (let t = 0; t < seconds; t += dt) {
        v.y -= gravity * dt
        const r = dfMoveBody(world, pos, { x: vel.x, y: v.y, z: vel.z }, dt, opts)
        pos = r.pos
        v = r.vel
        grounded = r.grounded
    }
    return { pos, grounded }
}

describe('dfMoveBody', () => {
    it('stands on the floor and falls onto it', () => {
        const world = dfCollisionFromSolids([floor])
        const r = run(world, { x: 0, y: 2, z: 0 }, { x: 0, z: 0 }, 1.5)
        expect(r.pos.y).toBeCloseTo(0, 5)
        expect(r.grounded).toBe(true)
    })

    it('stops at a wall', () => {
        const world = dfCollisionFromSolids([floor, solid(2, 0, -5, 2.5, 3, 5)])
        const r = run(world, { x: 0, y: 0, z: 0 }, { x: 5, z: 0 }, 1)
        expect(r.pos.x).toBeCloseTo(2 - 0.35, 2)
        expect(r.pos.z).toBeCloseTo(0, 5)
    })

    it('slides along a wall when moving diagonally', () => {
        const world = dfCollisionFromSolids([floor, solid(2, 0, -10, 2.5, 3, 10)])
        const r = run(world, { x: 0, y: 0, z: 0 }, { x: 4, z: 4 }, 1)
        expect(r.pos.x).toBeCloseTo(2 - 0.35, 2)
        expect(r.pos.z).toBeGreaterThan(3.5)
    })

    it('slides around a box corner instead of sticking', () => {
        const world = dfCollisionFromSolids([floor, solid(1, 0, -1, 2, 2, 0.1)])
        const r = run(world, { x: 0, y: 0, z: 0.3 }, { x: 4, z: 0 }, 1.2)
        expect(r.pos.x).toBeGreaterThan(2)
        expect(r.pos.z).toBeGreaterThan(0.3)
    })

    it('does not tunnel through a thin wall at speed', () => {
        const world = dfCollisionFromSolids([floor, solid(2, 0, -5, 2.1, 3, 5)])
        const r = dfMoveBody(world, { x: 1.5, y: 0, z: 0 }, { x: 60, y: 0, z: 0 }, 0.05, player)
        expect(r.pos.x).toBeLessThan(2)
    })

    it('climbs stairs and walks back down them glued to the steps', () => {
        const steps: DfSolid[] = []
        for (let i = 0; i < 10; i++) steps.push(solid(2 + i * 0.5, 0, -1, 2.5 + i * 0.5, 0.32 * (i + 1), 1, { mat: 'wood' }))
        steps.push(solid(7, 0, -1, 12, 3.2, 1))
        const world = dfCollisionFromSolids([floor, ...steps])
        const up = run(world, { x: 0, y: 0, z: 0 }, { x: 4, z: 0 }, 3)
        expect(up.pos.y).toBeCloseTo(3.2, 5)
        expect(up.pos.x).toBeGreaterThan(8)
        // Walk down: never airborne by more than a step.
        let pos = up.pos
        let vy = 0
        let lowest = pos.y
        for (let t = 0; t < 3; t += 1 / 60) {
            vy -= 16 / 60
            const r = dfMoveBody(world, pos, { x: -4, y: vy, z: 0 }, 1 / 60, player)
            pos = r.pos
            vy = r.vel.y
            expect(lowest - pos.y).toBeLessThan(0.33)
            lowest = Math.min(lowest, pos.y)
            expect(r.grounded).toBe(true)
        }
        expect(pos.y).toBeCloseTo(0, 5)
    })

    it('does not step onto ledges taller than the step height', () => {
        const world = dfCollisionFromSolids([floor, solid(2, 0, -5, 4, 0.6, 5)])
        const r = run(world, { x: 0, y: 0, z: 0 }, { x: 4, z: 0 }, 1)
        expect(r.pos.y).toBeCloseTo(0, 5)
        expect(r.pos.x).toBeCloseTo(2 - 0.35, 2)
    })

    it('does not step up mid-air', () => {
        const world = dfCollisionFromSolids([floor, solid(2, 0, -5, 4, 0.3, 5)])
        const r = dfMoveBody(world, { x: 1.6, y: 0.1, z: 0 }, { x: 4, y: 3, z: 0 }, 0.02, player)
        expect(r.pos.x).toBeCloseTo(2 - 0.35, 2)
    })

    it('needs headroom to step up', () => {
        const world = dfCollisionFromSolids([floor, solid(2, 0, -5, 4, 0.3, 5), solid(2, 1.8, -5, 4, 3, 5)])
        const r = run(world, { x: 0, y: 0, z: 0 }, { x: 4, z: 0 }, 1)
        expect(r.pos.x).toBeLessThan(2)
    })

    it('stops jumps at a ceiling', () => {
        const world = dfCollisionFromSolids([floor, solid(-5, 2.2, -5, 5, 2.5, 5)])
        let pos = { x: 0, y: 0, z: 0 }
        let vy = 6
        let top = 0
        for (let t = 0; t < 1; t += 1 / 60) {
            vy -= 16 / 60
            const r = dfMoveBody(world, pos, { x: 0, y: vy, z: 0 }, 1 / 60, player)
            pos = r.pos
            vy = r.vel.y
            top = Math.max(top, pos.y)
        }
        expect(top).toBeLessThanOrEqual(2.2 - 1.8 + 1e-6)
        expect(top).toBeGreaterThan(0.3)
    })

    it('lets zombies through player-only solids', () => {
        const world = dfCollisionFromSolids([floor, solid(2, 0, -1, 2.5, 2.2, 1, { playerOnly: true })])
        expect(run(world, { x: 0, y: 0, z: 0 }, { x: 4, z: 0 }, 1).pos.x).toBeLessThan(2)
        expect(run(world, { x: 0, y: 0, z: 0 }, { x: 4, z: 0 }, 1, zombie).pos.x).toBeGreaterThan(3)
    })

    it('reports body fit', () => {
        const world = dfCollisionFromSolids([floor, solid(1, 0, -1, 2, 2, 1)])
        expect(dfBodyFits(world, { x: 0, y: 0, z: 0 }, player)).toBe(true)
        expect(dfBodyFits(world, { x: 0.8, y: 0, z: 0 }, player)).toBe(false)
        expect(dfBodyFits(world, { x: 1.5, y: 2, z: 0 }, player)).toBe(true)
    })
})

describe('dfRaycast', () => {
    const world = dfCollisionFromSolids([
        floor,
        solid(5, 0, -2, 6, 3, 2, { mat: 'brick' }),
        solid(-6, 0, -2, -5, 3, 2, { mat: 'wood', playerOnly: true }),
        solid(-2, 0, 5, 2, 3, 6, { hidden: true })
    ])

    it('hits the nearest face with its material and normal', () => {
        const hit = dfRaycast(world, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 50)
        expect(hit).not.toBeNull()
        expect(hit!.dist).toBeCloseTo(5, 6)
        expect(hit!.mat).toBe('brick')
        expect(hit!.normal).toEqual({ x: -1, y: 0, z: 0 })
        expect(hit!.point.x).toBeCloseTo(5, 6)
    })

    it('hits the ground from above', () => {
        const d = { x: 0.6, y: -0.8, z: 0 }
        const hit = dfRaycast(world, { x: 0, y: 1.6, z: 0 }, d, 50)
        expect(hit!.dist).toBeCloseTo(2, 6)
        expect(hit!.normal).toEqual({ x: 0, y: 1, z: 0 })
        expect(hit!.mat).toBe('mud')
    })

    it('respects maxDist', () => {
        expect(dfRaycast(world, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 4.9)).toBeNull()
    })

    it('ignores player-only and hidden solids', () => {
        expect(dfRaycast(world, { x: 0, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, 14)).toBeNull()
        expect(dfRaycast(world, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 14)).toBeNull()
    })

    it('works for rays starting outside the grid and along diagonals', () => {
        const hit = dfRaycast(world, { x: 40, y: 1, z: 0.5 }, { x: -1, y: 0, z: 0 }, 200)
        expect(hit!.dist).toBeCloseTo(34, 6)
        expect(hit!.normal).toEqual({ x: 1, y: 0, z: 0 })
        const brick = dfRaycast(world, { x: 0, y: 1, z: -3 }, { x: 0.8, y: 0, z: 0.6 }, 50)
        expect(brick!.mat).toBe('brick')
        expect(brick!.point.x).toBeCloseTo(5, 6)
    })

    it('passes out of a solid it starts in', () => {
        expect(dfRaycast(world, { x: 5.5, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 10)).toBeNull()
    })

    it('answers line of sight', () => {
        expect(dfLineOfSight(world, { x: 0, y: 1, z: 0 }, { x: 4, y: 1, z: 0 })).toBe(true)
        expect(dfLineOfSight(world, { x: 0, y: 1, z: 0 }, { x: 8, y: 1, z: 0 })).toBe(false)
        expect(dfLineOfSight(world, { x: 0, y: 1, z: 0 }, { x: 8, y: 4, z: 0 })).toBe(false)
        expect(dfLineOfSight(world, { x: 0, y: 4, z: 0 }, { x: 8, y: 4, z: 0 })).toBe(true)
    })
})

describe('dfGroundHeight', () => {
    const world = dfCollisionFromSolids([floor, solid(0, 0, 0, 2, 1, 2), solid(0, 3, 0, 2, 3.2, 2), solid(5, 0, 5, 6, 1, 6, { hidden: true }), solid(8, 0, 8, 9, 0.9, 9, { playerOnly: true })])

    it('finds the highest surface at or below the height', () => {
        expect(dfGroundHeight(world, 1, 1, 10)).toBeCloseTo(3.2)
        expect(dfGroundHeight(world, 1, 1, 2.9)).toBeCloseTo(1)
        expect(dfGroundHeight(world, 1, 1, 0.5)).toBeCloseTo(0)
        expect(dfGroundHeight(world, 10, 10, 5)).toBeCloseTo(0)
    })

    it('skips hidden solids, and player-only ones for zombies', () => {
        expect(dfGroundHeight(world, 5.5, 5.5, 5)).toBeCloseTo(0)
        expect(dfGroundHeight(world, 8.5, 8.5, 5)).toBeCloseTo(0.9)
        expect(dfGroundHeight(world, 8.5, 8.5, 5, true)).toBeCloseTo(0)
    })
})

describe('dfBuildCollision', () => {
    const map = {
        solids: [floor, solid(2, 0, -1, 2.5, 2.4, 1, { door: 'gate', mat: 'wood' }), solid(-5, 0, -5, -4, 3, 5)]
    } as DfMapDef

    it('removes bought doors from collision and rays', () => {
        const closed = dfBuildCollision(map, new Set())
        const open = dfBuildCollision(map, new Set(['gate']))
        expect(closed.solids.length).toBe(3)
        expect(open.solids.length).toBe(2)
        expect(run(closed, { x: 0, y: 0, z: 0 }, { x: 4, z: 0 }, 1).pos.x).toBeLessThan(2)
        expect(run(open, { x: 0, y: 0, z: 0 }, { x: 4, z: 0 }, 1).pos.x).toBeGreaterThan(3)
        expect(dfRaycast(closed, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 10)?.mat).toBe('wood')
        expect(dfRaycast(open, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 10)).toBeNull()
    })

    it('is fast enough for a full match tick', () => {
        const world = dfCollisionFromSolids([floor, ...Array.from({ length: 300 }, (_, i) => solid((i % 20) * 2 - 20, 0, Math.floor(i / 20) * 2 - 15, (i % 20) * 2 - 19.6, 2, Math.floor(i / 20) * 2 - 14.6))])
        const t0 = performance.now()
        for (let k = 0; k < 2000; k++) {
            dfMoveBody(world, { x: (k % 37) - 18, y: 0, z: (k % 23) - 11 }, { x: 3, y: -0.3, z: 2 }, 1 / 20, zombie)
            dfRaycast(world, { x: 0, y: 1.6, z: 0 }, { x: Math.cos(k), y: -0.05, z: Math.sin(k) }, 60)
        }
        expect(performance.now() - t0).toBeLessThan(500)
    })
})
