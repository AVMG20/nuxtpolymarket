import * as THREE from 'three'

// The one material family every voxel mesh uses: Lambert with vertex colours
// (palette colour x baked AO) plus a per-vertex `aGlow` that turns palette
// voxels emissive. `uGlow` scales the glow per material (pulsing PaP camo,
// power-on surges) without a new shader program.

export interface DfVoxMaterialOpts {
    /** Glow multiplier for emissive voxels (default 1). */
    glow?: number
    side?: THREE.Side
    transparent?: boolean
    opacity?: number
    fog?: boolean
    /** Extra flat emissive added to every voxel (hit flashes). */
    emissive?: THREE.ColorRepresentation
}

export type DfVoxMaterial = THREE.MeshLambertMaterial & { userData: { uGlow: { value: number } } }

const VERT_HEAD = '#include <common>\nattribute float aGlow;\nvarying float vGlow;'
const FRAG_HEAD = '#include <common>\nuniform float uGlow;\nvarying float vGlow;'

/** Patches a Lambert/Standard material in place for voxel glow. */
export function dfPatchVoxGlow<T extends THREE.Material>(m: T, uGlow: { value: number }, extraKey = ''): T {
    const prev = m.onBeforeCompile
    m.onBeforeCompile = (shader, renderer) => {
        prev?.call(m, shader, renderer)
        shader.uniforms.uGlow = uGlow
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', VERT_HEAD)
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;')
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', FRAG_HEAD)
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * uGlow;')
    }
    const prevKey = m.customProgramCacheKey.bind(m)
    m.customProgramCacheKey = () => `dfvox${extraKey}|${prevKey()}`
    return m
}

/** A new voxel material (call `dispose()` when done). */
export function dfVoxMaterial(opts: DfVoxMaterialOpts = {}): DfVoxMaterial {
    const m = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: opts.side ?? THREE.FrontSide,
        transparent: opts.transparent ?? false,
        opacity: opts.opacity ?? 1,
        fog: opts.fog ?? true,
        emissive: opts.emissive ?? 0x000000
    }) as DfVoxMaterial
    m.userData.uGlow = { value: opts.glow ?? 1 }
    dfPatchVoxGlow(m, m.userData.uGlow)
    return m
}

let shared: DfVoxMaterial | null = null
let refs = 0

/** The shared default voxel material (ref-counted; release with `dfReleaseVoxMaterial`). */
export function dfSharedVoxMaterial(): DfVoxMaterial {
    if (!shared) shared = dfVoxMaterial()
    refs++
    return shared
}

export function dfReleaseVoxMaterial(): void {
    refs = Math.max(0, refs - 1)
    if (refs === 0 && shared) {
        shared.dispose()
        shared = null
    }
}
