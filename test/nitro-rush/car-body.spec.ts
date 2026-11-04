import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ARCH_R, ARCH_Y, AXLE_U, BodySurface, buildSkin, MAX_S, NOSE_U, skinStations, TAIL_U, WHEEL_R } from '../../app/utils/nitro-rush/car-body'
import { atlasUv, DECALS, mapToDecal } from '../../app/utils/nitro-rush/car-livery'
import { CAR_HALF_WIDTH, WHEELBASE } from '../../app/utils/nitro-rush/config'

describe('nitro rush car body', () => {
    const surface = new BodySurface()

    it('builds a finite skin whose uv stays on the livery', () => {
        const skin = buildSkin(surface)
        const pos = skin.attributes.position!.array
        const uv = skin.attributes.uv!.array
        expect(pos.every(Number.isFinite)).toBe(true)
        for (const t of uv) expect(t).toBeGreaterThanOrEqual(0)
        for (const t of uv) expect(t).toBeLessThanOrEqual(1)
        skin.dispose()
    })

    it('closes the skin into a full triangle grid', () => {
        const skin = buildSkin(surface)
        const rows = skinStations().length
        const cols = skin.attributes.position!.count / rows
        expect(Number.isInteger(cols)).toBe(true)
        expect(skin.index!.count).toBe((rows - 1) * (cols - 1) * 6)
        skin.dispose()
    })

    it('points a decal at its own place on the atlas', () => {
        const geo = mapToDecal(new THREE.PlaneGeometry(1, 1), DECALS.number)
        const uv = geo.attributes.uv!
        const corners = Array.from({ length: uv.count }, (_, i) => [uv.getX(i), uv.getY(i)])
        for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
            expect(corners).toContainEqual(atlasUv(DECALS.number, a, b))
        }
        geo.dispose()
    })

    it('keeps its wheels where the physics has them', () => {
        expect(AXLE_U * 2).toBeCloseTo(WHEELBASE)
        expect(ARCH_Y + ARCH_R).toBeGreaterThan(WHEEL_R * 2)
    })

    it('covers every wheel arch with fender, so no section is cut away whole', () => {
        for (const c of [-AXLE_U, AXLE_U]) {
            for (let d = -ARCH_R * 0.95; d <= ARCH_R * 0.95; d += ARCH_R / 8) {
                expect(surface.cutAt(c + d)).toBeGreaterThan(0.5)
            }
        }
    })

    it('stays within its livery canvas and about the physics width', () => {
        const p = new THREE.Vector3()
        let widest = 0
        for (const u of skinStations(0.1)) {
            const cut = surface.cutAt(u)
            expect(cut).toBeLessThanOrEqual(MAX_S)
            for (let s = 0; s <= cut; s += cut / 20) widest = Math.max(widest, surface.point(u, s, p).x)
        }
        expect(widest).toBeGreaterThan(CAR_HALF_WIDTH * 0.9)
        expect(widest).toBeLessThan(CAR_HALF_WIDTH * 1.15)
    })

    it('faces its normals outward', () => {
        const n = new THREE.Vector3()
        for (const u of [TAIL_U + 0.1, -1, 0, 1, NOSE_U - 0.1]) {
            surface.normal(u, 0, n)
            expect(n.y).toBeGreaterThan(0.5)
            surface.normal(u, surface.cutAt(u) * 0.85, n)
            expect(n.x).toBeGreaterThan(0.3)
        }
    })
})
