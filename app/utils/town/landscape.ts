import * as THREE from 'three'
import { townSurfaceMaterial } from './surfaces'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Cosmetic world-space noise: stable across reloads and plot purchases.
export function landscapeNoise(x: number, z: number, salt = 0): number {
    const n = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453
    return n - Math.floor(n)
}

/** Seamless meadow, baked once; broad patches survive at the normal play zoom. */
export function createMeadowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 512
    const ctx = canvas.getContext('2d')!
    const pixels = ctx.createImageData(512, 512)
    for (let y = 0; y < 512; y++) {
        for (let x = 0; x < 512; x++) {
            const u = x / 512 * Math.PI * 2
            const v = y / 512 * Math.PI * 2
            const patch = Math.sin(u + Math.sin(v)) * 5 + Math.cos(v * 2 - u) * 4
                + Math.sin(u * 3 + v * 2) * 2 + landscapeNoise(x, y) * 6
            const i = (y * 512 + x) * 4
            pixels.data[i] = 103 + patch
            pixels.data[i + 1] = 133 + patch
            pixels.data[i + 2] = 70 + patch * 0.65
            pixels.data[i + 3] = 255
        }
    }
    ctx.putImageData(pixels, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.anisotropy = 4
    return texture
}


// A shared crown made of small leaf masses gives every tree an irregular edge.
function leafCrown() {
    const pieces: THREE.BufferGeometry[] = []
    for (let i = 0; i < 13; i++) {
        const angle = i * 2.399963
        const y = -0.7 + i / 12 * 1.4
        const radius = Math.sqrt(1 - y * y)
        const leaf = new THREE.IcosahedronGeometry(0.19 + (i % 3) * 0.016, 0)
        leaf.scale(1, 0.88, 1)
        leaf.translate(Math.cos(angle) * radius * 0.32, y * 0.36, Math.sin(angle) * radius * 0.32)
        const positions = leaf.getAttribute('position')
        const colors = new Float32Array(positions.count * 3)
        for (let j = 0; j < positions.count; j++) {
            const light = 0.82 + i % 4 * 0.045 + Math.max(0, positions.getY(j)) * 0.14
            colors.set([light, light, light * 0.96], j * 3)
        }
        leaf.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        pieces.push(leaf)
    }
    const geometry = mergeGeometries(pieces)!
    pieces.forEach(piece => piece.dispose())
    return geometry
}
const canopy = leafCrown()
const smallFoliage = new THREE.IcosahedronGeometry(0.5, 1)
const pine = new THREE.ConeGeometry(0.5, 1, 9)
const trunk = new THREE.CylinderGeometry(0.055, 0.1, 1, 7)
const stone = new THREE.DodecahedronGeometry(0.5, 0)
const disc = new THREE.CircleGeometry(1, 48)
const bankPositions = disc.getAttribute('position')
for (let i = 1; i < bankPositions.count; i++) {
    const x = bankPositions.getX(i)
    const y = bankPositions.getY(i)
    const angle = Math.atan2(y, x)
    const radius = 1 + Math.sin(angle * 3 + 0.6) * 0.09 + Math.cos(angle * 5) * 0.045
    bankPositions.setXY(i, x * radius, y * radius)
}
disc.computeVertexNormals()
disc.rotateX(-Math.PI / 2)
const groveColors = [0x698448, 0x84964f, 0xa0a35a, 0xb4a35b, 0x526f46]
const materials = new Map<string, THREE.MeshStandardMaterial>()
function material(color: number, leaves = false, water = false) {
    if (water) return townSurfaceMaterial(color, 'water')
    if (color === 0x70553b) return townSurfaceMaterial(color, 'timber')
    const key = `${color}:${leaves}:${water}`
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({
        color, roughness: water ? 0.28 : 0.95, metalness: water ? 0.15 : 0,
        flatShading: true, vertexColors: leaves
    }))
    return materials.get(key)!
}

/** All scenery stays inside unclaimed parcels. Geometry is instanced by material. */
export function addLandscape(group: THREE.Group, parcels: { x: number, z: number }[], size: number) {
    const batches = new Map<string, { geometry: THREE.BufferGeometry, color: number, matrices: THREE.Matrix4[] }>()
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const axis = new THREE.Vector3(0, 1, 0)
    function add(key: string, geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, angle = 0) {
        key = `${key}:${color}`
        if (!batches.has(key)) batches.set(key, { geometry, color, matrices: [] })
        rotation.setFromAxisAngle(axis, angle)
        matrix.compose(position.set(x, y, z), rotation, scale.set(sx, sy, sz))
        batches.get(key)!.matrices.push(matrix.clone())
    }
    for (const parcel of parcels) {
        const { x: px, z: pz } = parcel
        const pond = landscapeNoise(px, pz, 81) > 0.90
        const cx = (px + 0.5) * size
        const cz = (pz + 0.5) * size
        if (pond) {
            // Nested banks give the water a shallow edge and a deep centre.
            // Bank stones follow the same rotated outline as the water, with
            // irregular gaps where grasses and reeds grow into the shallows.
            for (let k = 0; k < 38; k++) {
                const a = k / 38 * Math.PI * 2
                const r = 1 + Math.sin(a * 3 + 0.6) * 0.09 + Math.cos(a * 5) * 0.045
                const dx = Math.cos(a) * 2.55 * r
                const dz = Math.sin(a) * 1.83 * r
                const x = cx + dx * Math.cos(0.3) + dz * Math.sin(0.3)
                const z = cz - dx * Math.sin(0.3) + dz * Math.cos(0.3)
                const jitter = landscapeNoise(px, pz, k + 700)
                if (k % 4 !== 0) {
                    add('shore-pebbles', stone, k % 3 ? 0xb5b39c : 0x8f9483, x, 0.045 + jitter * 0.04, z, 0.13 + jitter * 0.18, 0.11 + jitter * 0.1, 0.16 + jitter * 0.16, a)
                } else {
                    add('bank-grass', smallFoliage, 0x87924f, x, 0.08, z, 0.46, 0.2, 0.35, a)
                    for (let reed = 0; reed < 4; reed++) {
                        const rx = x + (reed - 1.5) * 0.065
                        add('cattail-stem', trunk, 0x68784a, rx, 0.19, z, 0.1, 0.38 + reed * 0.025, 0.1)
                        add('cattail-head', trunk, 0x77523a, rx, 0.4 + reed * 0.012, z, 0.3, 0.1, 0.3)
                    }
                }
            }
            for (let k = 0; k < 6; k++) {
                const x = cx - 1.1 + landscapeNoise(px, pz, k + 800) * 1.1
                const z = cz - 0.55 + landscapeNoise(px, pz, k + 900) * 0.8
                add('lily', disc, k % 2 ? 0x69905b : 0x82a26a, x, 0.03, z, 0.095 + k * 0.009, 1, 0.085 + k * 0.009, k)
                if (k % 3 === 0) add('lily-flower', smallFoliage, 0xe6bdaf, x, 0.058, z, 0.08, 0.055, 0.08)
            }
            add('bank', disc, 0xaaa17a, cx, 0.005, cz, 2.6, 1, 1.85, 0.3)
            add('shore', disc, 0x789994, cx, 0.012, cz, 2.35, 1, 1.65, 0.3)
            add('water', disc, 0x477f83, cx + 0.12, 0.019, cz, 2.04, 1, 1.38, 0.3)
            for (let k = 0; k < 16; k++) {
                const angle = k / 16 * Math.PI * 2
                const x = cx + Math.cos(angle) * 2.55
                const z = cz + Math.sin(angle) * 1.9
                add('reeds', trunk, 0x88854b, x, 0.16, z, 0.24, 0.32, 0.24, angle)
                add('reed-tips', smallFoliage, 0xb9a46a, x, 0.34, z, 0.065, 0.13, 0.065)
                if (k % 4 === 0) add('bank-stones', stone, 0xb5b39c, x + 0.15, 0.08, z, 0.3, 0.16, 0.23, angle)
            }
            for (let k = 0; k < 5; k++) {
                add('ripple', disc, 0x9cbcb1, cx - 0.8 + k * 0.3, 0.022, cz - 0.6 + k * 0.28, 0.16 + k * 0.04, 1, 0.014)
            }
        }
        const density = landscapeNoise(px, pz, 19)
        const count = 9 + Math.floor(density * 19)
        for (let i = 0; i < count; i++) {
            const x = px * size + 1.35 + landscapeNoise(px, pz, i * 7 + 1) * (size - 2.7)
            const z = pz * size + 1.35 + landscapeNoise(px, pz, i * 7 + 2) * (size - 2.7)
            if (pond && ((x - cx) / 2.9) ** 2 + ((z - cz) / 2.2) ** 2 < 1) continue
            const h = 0.9 + landscapeNoise(px, pz, i * 7 + 3) * 1.15
            const angle = landscapeNoise(px, pz, i * 7 + 4) * Math.PI * 2
            if (i % 7 === 0) {
                add('rock', stone, 0x999b87, x, h * 0.16, z, h * 0.7, h * 0.46, h * 0.6, angle)
                add('small-rock', stone, 0xb5b39c, x + 0.3, 0.1, z + 0.25, 0.3, 0.25, 0.4, angle)
                add('moss', smallFoliage, 0x84915b, x - 0.08, h * 0.34, z, h * 0.42, 0.07, h * 0.32, angle)
                for (let pebble = 0; pebble < 4; pebble++) {
                    const a = angle + pebble * 1.8
                    add('scree', stone, 0xb5b39c, x + Math.cos(a) * h * 0.42, 0.04, z + Math.sin(a) * h * 0.35, 0.13, 0.09, 0.12, a)
                }
                continue
            }
            add('trunk', trunk, 0x70553b, x, h * 0.38, z, 1, h * 0.76, 1, angle)
            for (let root = 0; root < 3; root++) {
                const a = angle + root * Math.PI * 2 / 3
                add('roots', trunk, 0x70553b, x + Math.cos(a) * 0.065, h * 0.065, z + Math.sin(a) * 0.065, 0.9, h * 0.13, 0.9, a)
            }
            if (i % 5 === 0) {
                for (let tier = 0; tier < 5; tier++) {
                    const width = h * (0.85 - tier * 0.135)
                    add('pine-boughs', pine, tier % 2 ? 0x587b55 : 0x466b52, x, h * (0.48 + tier * 0.16), z, width, h * 0.58, width, angle + tier * 0.6)
                }
                continue
            }
            const color = groveColors[Math.floor(landscapeNoise(px, pz, i + 90) * groveColors.length)]!
            // Overlapping asymmetric crowns feel leafy without expensive individual leaves.
            add(`crown-${color}`, canopy, color, x, h * 0.88, z, h * 0.86, h, h * 0.8, angle)
            add(`crown-${color}`, canopy, color, x - h * 0.25, h * 0.7, z + h * 0.12, h * 0.62, h * 0.68, h * 0.6, angle + 1)
            add(`crown-${color}`, canopy, color, x + h * 0.22, h * 0.8, z - h * 0.13, h * 0.6, h * 0.74, h * 0.64, angle + 2)
            if (i % 3 === 0) {
                add('undergrowth', smallFoliage, 0x89935b, x + 0.45, 0.16, z + 0.45, 0.65, 0.4, 0.55, angle)
                for (let flower = 0; flower < 4; flower++) {
                    const a = angle + flower * 1.7
                    const fx = x + 0.45 + Math.cos(a) * 0.23
                    const fz = z + 0.45 + Math.sin(a) * 0.2
                    add('wildflower-stem', trunk, 0x6f8050, fx, 0.16, fz, 0.1, 0.32, 0.1)
                    add('wildflower', smallFoliage, i % 2 ? 0xd7bbd1 : 0xe1cb87, fx, 0.32, fz, 0.075, 0.05, 0.075)
                }
            }
        }
    }
    for (const batch of batches.values()) {
        const mesh = new THREE.InstancedMesh(batch.geometry, material(batch.color, batch.geometry === canopy, batch.color === 0x477f83 || batch.color === 0x789994), batch.matrices.length)
        batch.matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
        mesh.castShadow = batch.geometry !== disc
        mesh.receiveShadow = true
        mesh.instanceMatrix.needsUpdate = true
        group.add(mesh)
    }
}

// InstancedMesh owns GPU instance buffers; its geometry/material are shared above.
export function clearLandscape(group: THREE.Group) {
    group.traverse(object => {
        if (object instanceof THREE.InstancedMesh) object.dispose()
    })
    group.clear()
}
