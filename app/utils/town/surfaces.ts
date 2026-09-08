import * as THREE from 'three'

export type TownSurface = 'plaster' | 'brick' | 'timber' | 'roof' | 'stone' | 'water'
const textures = new Map<TownSurface, THREE.DataTexture>()
const materials = new Map<string, THREE.MeshStandardMaterial>()

// Tiny, repeatable surface maps add close-up grain without downloading assets or
// adding geometry. DataTexture also keeps model generation usable outside a browser.
function texture(surface: TownSurface): THREE.DataTexture {
    const cached = textures.get(surface)
    if (cached) return cached
    const size = 128
    const data = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const noise = ((x * 73 + y * 139 + x * y * 17) % 31) / 31
            let shade = 241 + noise * 14
            if (surface === 'brick' || surface === 'stone') {
                const row = Math.floor(y / 16)
                const bx = (x + (row % 2) * 16) % 32
                const seam = y % 16 < 2 || bx < 2
                shade = seam ? 155 : 222 + ((row * 13 + Math.floor((x + (row % 2) * 16) / 32) * 7) % 25) + noise * 8
            } else if (surface === 'timber') {
                shade = x % 24 < 2 ? 151 : 225 + Math.sin(x * 1.7 + Math.sin(y * 0.15)) * 12 + noise * 12
            } else if (surface === 'roof') {
                shade = y % 16 < 2 ? 160 : 222 + Math.cos(x * Math.PI / 8) * 16 + noise * 12
            } else if (surface === 'water') {
                shade = 231 + Math.sin(x * Math.PI / 16 + Math.sin(y * Math.PI / 32)) * 4 + Math.cos(y * Math.PI / 8 + x * Math.PI / 32) * 2
            } else {
                shade -= Math.sin(x * 0.12 + Math.sin(y * 0.08)) * 6
            }
            const i = (y * size + x) * 4
            data[i] = data[i + 1] = data[i + 2] = Math.min(255, shade)
            data[i + 3] = 255
        }
    }
    const map = new THREE.DataTexture(data, size, size)
    map.colorSpace = THREE.SRGBColorSpace
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.magFilter = THREE.LinearFilter
    map.minFilter = THREE.LinearMipmapLinearFilter
    map.generateMipmaps = true
    map.anisotropy = 4
    map.needsUpdate = true
    textures.set(surface, map)
    return map
}

export function townSurfaceMaterial(color: number, surface: TownSurface): THREE.MeshStandardMaterial {
    const key = `${color}:${surface}`
    const cached = materials.get(key)
    if (cached) return cached
    const map = texture(surface)
    const material = new THREE.MeshStandardMaterial({
        color, map, bumpMap: map, bumpScale: surface === 'water' ? 0.014 : surface === 'plaster' ? 0.006 : 0.012,
        roughness: surface === 'water' ? 0.3 : surface === 'roof' ? 0.8 : 0.95, metalness: surface === 'water' ? 0.12 : 0, flatShading: true
    })
    materials.set(key, material)
    return material
}

/** Water shares one map; its slow drift adds life without extra scene objects. */
export function animateTownWater(seconds: number) {
    const map = textures.get('water')
    if (map) map.offset.set(seconds * 0.012 % 1, seconds * 0.006 % 1)
}
