import * as THREE from 'three'
import { DF_MAP_P, DF_MAP_PALETTE, DF_VOX_CELL, DF_VOX_ORIGIN, dfMapWorld } from '#shared/utils/dead-front/map-world'
import { DfVox } from '#shared/utils/dead-front/voxel'
import type { DfVoxPaletteEntry } from '#shared/utils/dead-front/voxel'
import { dfMeshVox } from '../voxel/mesher'
import type { DfVoxMaterial } from '../voxel/material'

// The static map: the voxel grid greedy-meshed into 24 m x 24 m chunks (one
// draw call each, frustum culled), with baked AO and emissive voxels.
//
// The palette's shades (cobble1/2/3, brick1/2/3, ...) collapse into surface
// families. The mesh itself only knows "solid", "lit window" and "stained
// glass", so greedy meshing makes big faces; the surface shader
// (surface.ts) reads each fragment's family from a 3D texture of the grid and
// paints it in world space (bricks, cobbles, planks, tiles, grass strokes).

const CHUNK = 48 // cells

/** Surface families, in shader id order (id = index + 1, 0 = air). */
export const DF_SURFS = [
    'mud', 'crater', 'grass', 'cobble', 'gutter', 'gravel', 'flag', 'stone', 'moss', 'ashlar', 'brick', 'plaster',
    'roof', 'slate', 'planks', 'beam', 'hay', 'metal', 'rust', 'marble', 'water', 'rubble', 'pane', 'lit', 'glass'
] as const
export type DfSurf = typeof DF_SURFS[number]

/** Palette name -> family (names not listed fall back on their material). */
const SURF_OF: Record<string, DfSurf> = {
    mud1: 'mud', mud2: 'mud', mud3: 'mud', earth1: 'mud', earth2: 'mud', crater: 'crater',
    grass1: 'grass', grass2: 'grass', grass3: 'grass', dgrass: 'grass',
    cobble1: 'cobble', cobble2: 'cobble', cobble3: 'cobble', gutter: 'gutter',
    gravel1: 'gravel', gravel2: 'gravel', duck: 'planks', flag1: 'flag', flag2: 'flag',
    stone1: 'stone', stone2: 'stone', stone3: 'stone', moss: 'moss',
    ashlar1: 'ashlar', ashlar2: 'ashlar', ashlar3: 'ashlar',
    brick1: 'brick', brick2: 'brick', brick3: 'brick', plaster1: 'plaster', plaster2: 'plaster',
    roof1: 'roof', roof2: 'roof', slate1: 'slate', slate2: 'slate',
    wood1: 'planks', wood2: 'planks', plank: 'planks', beam: 'beam', sill: 'beam',
    hay1: 'hay', hay2: 'hay', iron: 'metal', rust: 'rust', marble1: 'marble', marble2: 'marble',
    water: 'water', rubble1: 'rubble', rubble2: 'rubble',
    pane: 'pane', lit: 'lit', glassBlue: 'glass', glassRed: 'glass', glassGold: 'glass'
}

/**
 * Four flat tones per family (sRGB): base, dark, light, ink. One cohesive
 * moonlit set: grass a muted olive that holds up under blue moonlight,
 * plaster and stone lean warm so the lantern pools glow on them. Glass is
 * blue, red, gold and the lead.
 */
const SURF_TONES: Record<DfSurf, [number, number, number, number]> = {
    mud: [0x54432f, 0x463729, 0x64503a, 0x261d15],
    crater: [0x3b2f23, 0x2e251c, 0x4a3b2c, 0x17110c],
    grass: [0x4b5f33, 0x3e5029, 0x5a6f3d, 0x26341a],
    cobble: [0x6b6761, 0x5d5954, 0x7b766e, 0x2b2926],
    gutter: [0x57534e, 0x4a4743, 0x67635c, 0x222120],
    gravel: [0x81796c, 0x6b645a, 0x968e80, 0x3a352f],
    flag: [0x878073, 0x777065, 0x958e80, 0x37332d],
    stone: [0x857f76, 0x736e67, 0x958f84, 0x34312d],
    moss: [0x56683c, 0x45562f, 0x67794a, 0x24301a],
    ashlar: [0xbeb39a, 0xaca188, 0xcbc1a7, 0x5a5243],
    brick: [0x8a4a36, 0x773f2e, 0x9a5640, 0x3a221a],
    plaster: [0xbfb194, 0xa89b80, 0xccc0a5, 0x4e4536],
    roof: [0x8c412c, 0x733424, 0xa04f36, 0x33150f],
    slate: [0x4d525b, 0x40444c, 0x5c626c, 0x1b1e23],
    planks: [0x83633f, 0x6c5033, 0x977651, 0x2a1e13],
    beam: [0x4d3722, 0x3e2c1b, 0x5d442b, 0x1d140c],
    hay: [0xbf9f57, 0xa3843f, 0xd6ba70, 0x6b5424],
    metal: [0x3c3e42, 0x2f3134, 0x56595f, 0x151618],
    rust: [0x7b4b2b, 0x613920, 0x8f5a35, 0x2b190d],
    marble: [0xbab7ae, 0xa8a59c, 0xcdcac2, 0x6c6a64],
    water: [0x2c4a5f, 0x223b4c, 0x6489a2, 0x13222d],
    rubble: [0x6f6a5f, 0x5c5850, 0x837d70, 0x2a2622],
    pane: [0x1e2633, 0x151b24, 0x56677e, 0x2e2117],
    lit: [0xffb45c, 0xe58d3c, 0xffdca6, 0x24180e],
    glass: [0x5d72e0, 0xc8463f, 0xe2b24f, 0x15151b]
}

/**
 * Families whose borders blend into organic, inked blobs instead of 0.5 m
 * squares (a bitmask: families sharing a bit blend).
 */
const SURF_BLEND: Partial<Record<DfSurf, number>> = {
    mud: 1, crater: 1, grass: 1, cobble: 1, gutter: 1, gravel: 1, rubble: 1, hay: 1 | 4, planks: 4,
    plaster: 2, brick: 2, stone: 8, moss: 2 | 8
}

function surfOf(name: string, p: DfVoxPaletteEntry): DfSurf {
    const s = SURF_OF[name]
    if (s) return s
    if (p.emissive) return 'lit'
    switch (p.mat) {
        case 'mud': return 'mud'
        case 'wood': return 'planks'
        case 'metal': return 'metal'
        default: return 'stone'
    }
}

/** Palette index -> family id (1-based, 0 = air). */
function surfLut(): Uint8Array {
    const lut = new Uint8Array(256)
    for (const [name, i] of Object.entries(DF_MAP_P)) {
        const p = DF_MAP_PALETTE[i]
        if (p) lut[i] = DF_SURFS.indexOf(surfOf(name, p)) + 1
    }
    return lut
}

/** Shader data for the surface families. */
export interface DfSurfaceData {
    /** Family id per cell (R8, width x = sx, height = sz, depth = sy). */
    grid: THREE.Data3DTexture
    size: [number, number, number]
    /** Linear tones, 4 per family. */
    tones: THREE.Color[]
    blend: number[]
    ids: Record<DfSurf, number>
}

let surfaceData: DfSurfaceData | null = null

/** The family grid and tones for the level shader (built once; released with the level). */
export function dfLevelSurfaceData(): DfSurfaceData {
    if (surfaceData) return surfaceData
    const vox = dfMapWorld().vox
    const lut = surfLut()
    const data = new Uint8Array(vox.data.length)
    for (let n = 0; n < data.length; n++) data[n] = lut[vox.data[n]!]!
    const grid = new THREE.Data3DTexture(data, vox.sx, vox.sz, vox.sy)
    grid.format = THREE.RedFormat
    grid.type = THREE.UnsignedByteType
    grid.minFilter = THREE.NearestFilter
    grid.magFilter = THREE.NearestFilter
    grid.generateMipmaps = false
    grid.unpackAlignment = 1
    grid.needsUpdate = true
    const tones: THREE.Color[] = []
    for (const s of DF_SURFS) for (const hex of SURF_TONES[s]) tones.push(new THREE.Color(hex))
    surfaceData = {
        grid,
        size: [vox.sx, vox.sy, vox.sz],
        tones,
        blend: DF_SURFS.map(s => SURF_BLEND[s] ?? 0),
        ids: Object.fromEntries(DF_SURFS.map((s, i) => [s, i + 1])) as Record<DfSurf, number>
    }
    return surfaceData
}

let renderPalette: DfVoxPaletteEntry[] | null = null

/** The map palette with each entry's family base colour (built once). */
export function dfLevelPalette(): DfVoxPaletteEntry[] {
    if (renderPalette) return renderPalette
    renderPalette = DF_MAP_PALETTE.map(p => ({ ...p }))
    for (const [name, i] of Object.entries(DF_MAP_P)) {
        const p = renderPalette[i]
        if (p) p.color = SURF_TONES[surfOf(name, p)][0]
    }
    return renderPalette
}

/**
 * What the mesher sees: one white solid, the lit windows and the stained
 * glass (their glow differs). The shader paints the colour.
 */
const MESH_PALETTE: DfVoxPaletteEntry[] = [
    { color: 0, mat: 'mud', solid: false },
    { color: 0xffffff, mat: 'stone' },
    { color: 0xffffff, mat: 'stone', emissive: 0.9 },
    { color: 0xffffff, mat: 'stone', emissive: 0.55 }
]

function meshVox(): DfVox {
    const src = dfMapWorld().vox
    const ids = dfLevelSurfaceData().ids
    const lut = surfLut()
    const remap = new Uint8Array(256)
    for (let i = 1; i < 256; i++) {
        const s = lut[i]
        remap[i] = !s ? 0 : s === ids.lit ? 2 : s === ids.glass ? 3 : 1
    }
    const vox = new DfVox(src.sx, src.sy, src.sz)
    for (let n = 0; n < vox.data.length; n++) vox.data[n] = remap[src.data[n]!]!
    return vox
}

export interface DfLevelMeshes {
    group: THREE.Group
    /** Triangles across all chunks (for the perf report). */
    triangles: number
    dispose(): void
}

export function buildDfLevel(material: DfVoxMaterial, shadows: boolean): DfLevelMeshes {
    const vox = meshVox()
    const group = new THREE.Group()
    group.name = 'df-level'
    let triangles = 0
    const geos: THREE.BufferGeometry[] = []
    for (let k0 = 0; k0 < vox.sz; k0 += CHUNK) {
        for (let i0 = 0; i0 < vox.sx; i0 += CHUNK) {
            const geo = dfMeshVox(vox, MESH_PALETTE, {
                cell: DF_VOX_CELL,
                origin: DF_VOX_ORIGIN,
                range: { i0, i1: Math.min(vox.sx, i0 + CHUNK), j0: 0, j1: vox.sy, k0, k1: Math.min(vox.sz, k0 + CHUNK) },
                skipFloorUnderside: true,
                aoMin: 0.66,
                shade: [0.9, 1, 0.66, 0.95]
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
            surfaceData?.grid.dispose()
            surfaceData = null
            group.removeFromParent()
        }
    }
}
