import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DF_MAP, dfInteractables } from '#shared/utils/dead-front/map'
import { dfMapWorld } from '#shared/utils/dead-front/map-world'
import { dfBuildCollision } from '#shared/utils/dead-front/physics'
import { dfBuildDecorModel } from '../../app/utils/dead-front/world/decor-models'
import { createDfDecor, dfDecorPlacements } from '../../app/utils/dead-front/world/decor'
import type { DfWorldKit } from '../../app/utils/dead-front/world/kit'
import { dfVoxMaterial } from '../../app/utils/dead-front/voxel/material'

function footprint(d: ReturnType<typeof dfDecorPlacements>[number]): THREE.Box3 {
    const m = dfBuildDecorModel(d.kind)
    const geo = m.model.mesh(m.cell, m.pivot)!
    const mat = new THREE.Matrix4().compose(
        new THREE.Vector3(d.x, d.y, d.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(d.tilt ?? 0, d.yaw, 0, 'YXZ')),
        new THREE.Vector3().setScalar(d.scale ?? 1)
    )
    geo.applyMatrix4(mat)
    geo.computeBoundingBox()
    const box = geo.boundingBox!.clone()
    geo.dispose()
    return box
}

describe('dead front set dressing', () => {
    const placements = dfDecorPlacements()

    it('keeps tall pieces out of the walking lanes (no nav node inside them)', () => {
        const nodes = DF_MAP.nav.nodes.filter(n => !n.outside)
        for (const d of placements) {
            const box = footprint(d)
            const tall = box.max.y - box.min.y > 0.45 && box.min.y < d.y + 1.6
            if (!tall) continue
            const grown = box.clone().expandByVector(new THREE.Vector3(0.2, 0, 0.2))
            const hit = nodes.find(n => n.pos.x > grown.min.x && n.pos.x < grown.max.x && n.pos.z > grown.min.z && n.pos.z < grown.max.z && Math.abs(n.pos.y - d.y) < 1)
            expect(hit, `${d.kind} at ${d.x},${d.z} covers nav node ${hit?.id} at ${hit?.pos.x},${hit?.pos.z}`).toBeUndefined()
        }
    })

    it('leaves the interactables clear', () => {
        const its = dfInteractables(DF_MAP).filter(i => i.kind !== 'fuse')
        for (const d of placements) {
            const box = footprint(d)
            if (box.max.y - box.min.y < 0.3) continue
            for (const i of its) {
                const dx = Math.max(box.min.x - i.pos.x, 0, i.pos.x - box.max.x)
                const dz = Math.max(box.min.z - i.pos.z, 0, i.pos.z - box.max.z)
                expect(Math.hypot(dx, dz), `${d.kind} at ${d.x},${d.z} crowds ${i.id}`).toBeGreaterThan(0.5)
            }
        }
    })

    it('builds the scatter into a few chunked meshes', () => {
        const root = new THREE.Group()
        const mat = dfVoxMaterial()
        const kit = {
            map: DF_MAP, world: dfMapWorld(), root, mat, collision: dfBuildCollision(DF_MAP, new Set()), quality: 'high', shadows: true
        } as unknown as DfWorldKit
        const part = createDfDecor(kit)
        expect(root.children.length).toBeGreaterThan(5)
        expect(root.children.length).toBeLessThan(48)
        let tris = 0
        root.traverse((o) => {
            const m = o as THREE.Mesh
            if (m.isMesh) tris += (m.geometry.index?.count ?? 0) / 3
        })
        expect(tris).toBeLessThan(400_000)
        part.dispose()
        expect(root.children.length).toBe(0)
        mat.dispose()
    })
})
