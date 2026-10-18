import * as THREE from 'three'
import { DF_MAP_P, DF_MAP_PALETTE, DF_VOX_CELL, DF_VOX_ORIGIN, dfMapWorld } from '#shared/utils/dead-front/map-world'
import type { DfVoxPaletteEntry } from '#shared/utils/dead-front/voxel'
import { dfMeshVox } from '../voxel/mesher'
import type { DfVoxMaterial } from '../voxel/material'

// The static map: the voxel grid greedy-meshed into 24 m x 24 m chunks (one
// draw call each, frustum culled), with baked AO and emissive voxels.

const CHUNK = 48 // cells

/**
 * Render colours for the map palette (same indices, collision untouched): one
 * cohesive moonlit set. Neighbouring shades sit close together so a cobbled
 * square reads as one surface with texture, not a checkerboard; grass is a
 * muted olive that holds up under blue moonlight; plaster and stone lean warm
 * so the lantern pools glow on them.
 */
const RENDER_COLORS: Partial<Record<keyof typeof DF_MAP_P, number>> = {
    mud1: 0x4e3e2e, mud2: 0x564430, mud3: 0x463729, crater: 0x2e251d,
    grass1: 0x4c5f34, grass2: 0x55693b, grass3: 0x44562f, dgrass: 0x3b4a2d,
    cobble1: 0x6e6a64, cobble2: 0x65615b, cobble3: 0x77736b, gutter: 0x4e4b46,
    gravel1: 0x847c6f, gravel2: 0x7a7266,
    earth1: 0x5b4935, earth2: 0x64513b,
    plaster1: 0xbfb194, plaster2: 0xb2a487,
    brick1: 0x8a4a36, brick2: 0x7d4332, brick3: 0x94523d,
    stone1: 0x88827a, stone2: 0x7d776e, stone3: 0x928b80,
    water: 0x1f3a4f
}

let renderPalette: DfVoxPaletteEntry[] | null = null

/** The map palette with the render colours applied (built once). */
export function dfLevelPalette(): DfVoxPaletteEntry[] {
    if (renderPalette) return renderPalette
    renderPalette = DF_MAP_PALETTE.map(p => ({ ...p }))
    for (const [name, hex] of Object.entries(RENDER_COLORS) as [keyof typeof DF_MAP_P, number][]) {
        const i = DF_MAP_P[name]
        if (i !== undefined && renderPalette[i]) renderPalette[i].color = hex
    }
    return renderPalette
}

export interface DfLevelMeshes {
    group: THREE.Group
    /** Triangles across all chunks (for the perf report). */
    triangles: number
    dispose(): void
}

export function buildDfLevel(material: DfVoxMaterial, shadows: boolean): DfLevelMeshes {
    const w = dfMapWorld()
    const vox = w.vox
    const group = new THREE.Group()
    group.name = 'df-level'
    let triangles = 0
    const geos: THREE.BufferGeometry[] = []
    for (let k0 = 0; k0 < vox.sz; k0 += CHUNK) {
        for (let i0 = 0; i0 < vox.sx; i0 += CHUNK) {
            const geo = dfMeshVox(vox, dfLevelPalette(), {
                cell: DF_VOX_CELL,
                origin: DF_VOX_ORIGIN,
                range: { i0, i1: Math.min(vox.sx, i0 + CHUNK), j0: 0, j1: vox.sy, k0, k1: Math.min(vox.sz, k0 + CHUNK) },
                skipFloorUnderside: true,
                aoMin: 0.42
            })
            if (!geo) continue
            geos.push(geo)
            triangles += (geo.index?.count ?? 0) / 3
            const mesh = new THREE.Mesh(geo, material)
            mesh.name = `df-chunk-${i0 / CHUNK}-${k0 / CHUNK}`
            mesh.castShadow = shadows
            mesh.receiveShadow = shadows
            mesh.matrixAutoUpdate = false
            group.add(mesh)
        }
    }
    return {
        group,
        triangles,
        dispose() {
            for (const g of geos) g.dispose()
            group.removeFromParent()
        }
    }
}
