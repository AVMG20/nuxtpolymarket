import * as THREE from 'three'
import { dfVoxMaterial } from '../voxel/material'
import type { DfVoxMaterial } from '../voxel/material'

// Weapon materials: one shared voxel material for plain guns, one per
// Pack-a-Punch tier whose camo voxels breathe (uGlow pulsed on render), and
// the scope reticle. Shared materials are never disposed by models; call
// `disposeDfWeaponMaterials` when the whole game unloads.

let base: DfVoxMaterial | null = null
const pap: (DfVoxMaterial | null)[] = [null, null, null]

/** The plain weapon material. */
export function dfWeaponMat(): DfVoxMaterial {
    if (!base) {
        base = dfVoxMaterial()
        base.name = 'df-weapon'
    }
    return base
}

/** Pack-a-Punch camo material for tier 1..3: its glow pulses with time. */
export function dfPapMat(tier: number): DfVoxMaterial {
    const i = Math.max(1, Math.min(3, tier)) - 1
    let m = pap[i]
    if (!m) {
        m = dfVoxMaterial({ glow: 1 })
        m.name = `df-weapon-pap${i + 1}`
        pap[i] = m
    }
    return m
}

/** Pulses the PaP glow; hooked on camo meshes' onBeforeRender. */
export function dfTickPap(): void {
    const t = performance.now() / 1000
    for (let i = 0; i < 3; i++) {
        const m = pap[i]
        if (m) m.userData.uGlow.value = 0.75 + 0.45 * (0.5 + 0.5 * Math.sin(t * (2.2 + i * 0.6) + i))
    }
}

/** A per-model glowing material (X-Ray tubes, wonder-weapon coils); owned by the model. */
export function dfOwnedGlowMat(): DfVoxMaterial {
    const m = dfVoxMaterial({ glow: 1.6 })
    m.userData.dfOwned = true
    return m
}

let reticleTex: THREE.Texture | null = null
export function dfReticleTexture(): THREE.Texture {
    if (reticleTex) return reticleTex
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null
    if (!c) {
        reticleTex = new THREE.Texture()
        return reticleTex
    }
    c.width = 256
    c.height = 256
    const g = c.getContext('2d')!
    const grd = g.createRadialGradient(128, 128, 90, 128, 128, 128)
    grd.addColorStop(0, 'rgba(0,0,0,0)')
    grd.addColorStop(1, 'rgba(0,0,0,1)')
    g.fillStyle = grd
    g.fillRect(0, 0, 256, 256)
    g.fillStyle = 'rgba(0,0,0,0.95)'
    g.fillRect(0, 126, 100, 4)
    g.fillRect(156, 126, 100, 4)
    g.fillRect(126, 140, 4, 116)
    g.fillRect(124, 132, 8, 8)
    reticleTex = new THREE.CanvasTexture(c)
    reticleTex.colorSpace = THREE.SRGBColorSpace
    return reticleTex
}

let dotTex: THREE.Texture | null = null
/** A soft red dot with a faint halo, for the red dot sights' glass. */
export function dfDotTexture(): THREE.Texture {
    if (dotTex) return dotTex
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null
    if (!c) {
        dotTex = new THREE.Texture()
        return dotTex
    }
    c.width = 64
    c.height = 64
    const g = c.getContext('2d')!
    const halo = g.createRadialGradient(32, 32, 0, 32, 32, 30)
    halo.addColorStop(0, 'rgba(255,60,48,0.55)')
    halo.addColorStop(1, 'rgba(255,40,30,0)')
    g.fillStyle = halo
    g.fillRect(0, 0, 64, 64)
    const core = g.createRadialGradient(32, 32, 0, 32, 32, 4.5)
    core.addColorStop(0, 'rgba(255,235,225,1)')
    core.addColorStop(0.5, 'rgba(255,70,55,1)')
    core.addColorStop(1, 'rgba(255,45,35,0)')
    g.fillStyle = core
    g.fillRect(0, 0, 64, 64)
    dotTex = new THREE.CanvasTexture(c)
    dotTex.colorSpace = THREE.SRGBColorSpace
    return dotTex
}

export function disposeDfWeaponMaterials(): void {
    base?.dispose()
    base = null
    for (let i = 0; i < 3; i++) {
        pap[i]?.dispose()
        pap[i] = null
    }
    reticleTex?.dispose()
    reticleTex = null
    dotTex?.dispose()
    dotTex = null
}
