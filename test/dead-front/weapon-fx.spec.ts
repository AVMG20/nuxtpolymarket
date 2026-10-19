import { describe, expect, it } from 'vitest'
import { dfCollisionFromSolids } from '#shared/utils/dead-front/physics'
import type { DfSolid } from '#shared/utils/dead-front/map'
import { dfBlastSurface, dfDecalFit } from '../../app/utils/dead-front/weapons/projectiles'
import { DF_XRAY_SCHEMES, dfXrayScheme } from '../../app/utils/dead-front/weapons/xray'

// Scorch placement: a blast only scorches a world surface right next to it,
// oriented to that surface, and only as large as the surface can hold.

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): DfSolid => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, mat: 'stone' })

// A 20 m floor, a wall facing +x at x = 0 and a 0.6 m crate on the floor.
const world = dfCollisionFromSolids([
    box(-10, -1, -10, 10, 0, 10),
    box(-1, 0, -10, 0, 4, 10),
    box(5, 0, 5, 5.6, 0.6, 5.6)
])

describe('dead front scorch placement', () => {
    it('finds the floor under a blast resting on it, facing up', () => {
        const hit = dfBlastSurface(world, { x: 4, y: 0.06, z: 0 }, null)!
        expect(hit).not.toBeNull()
        expect(hit.normal.y).toBeCloseTo(1)
        expect(hit.point.y).toBeCloseTo(0)
    })

    it('finds the wall a bolt hit, facing out of it', () => {
        const hit = dfBlastSurface(world, { x: 0.08, y: 1.5, z: 0 }, { x: -1, y: 0, z: 0 })!
        expect(hit.normal.x).toBeCloseTo(1)
        expect(hit.point.x).toBeCloseTo(0)
    })

    it('skips a blast in mid-air (a zombie hit or a bolt timing out)', () => {
        expect(dfBlastSurface(world, { x: 4, y: 1.3, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull()
    })

    it('fits the scorch to the surface so it never hangs over an edge', () => {
        const open = dfBlastSurface(world, { x: 4, y: 0.06, z: 0 }, null)!
        expect(dfDecalFit(world, open, 1, [1, 0.5])).toBe(1)
        // On top of the small crate only the smallest scale (or none) fits.
        const crate = dfBlastSurface(world, { x: 5.3, y: 0.66, z: 5.3 }, null)!
        expect(crate.normal.y).toBeCloseTo(1)
        expect(dfDecalFit(world, crate, 1, [1, 0.5])).toBe(0)
        expect(dfDecalFit(world, crate, 1, [1, 0.5, 0.2])).toBe(0.2)
        // Near the top edge of the wall a big scorch would stick up into the air.
        const top = dfBlastSurface(world, { x: 0.08, y: 3.7, z: 0 }, { x: -1, y: 0, z: 0 })!
        expect(dfDecalFit(world, top, 1, [1, 0.2])).toBe(0.2)
    })
})

describe('X-Ray colour schemes', () => {
    it('gives each Pack-a-Punch tier its own colours', () => {
        const cores = new Set(DF_XRAY_SCHEMES.map(s => s.core))
        expect(cores.size).toBe(4)
        expect(dfXrayScheme(0)).toBe(DF_XRAY_SCHEMES[0])
        expect(dfXrayScheme(9)).toBe(DF_XRAY_SCHEMES[3])
    })
})
