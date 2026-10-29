import * as THREE from 'three'

/** A canvas to paint a texture on, and the texture made from it. */

export function canvas(w: number, h: number) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return [c, c.getContext('2d')!] as const
}

export function finish(c: HTMLCanvasElement, srgb = true) {
    const t = new THREE.CanvasTexture(c)
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.needsUpdate = true
    return t
}
