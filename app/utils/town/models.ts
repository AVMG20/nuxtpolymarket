// Polytown — procedural low-poly building models. Every building is a list of
// primitive parts (boxes, cylinders, cones, spheres) in tile-local space: the
// tile is 1×1 centred on the origin, y is up and the ground is y = 0. Named
// parts ('spin', 'smoke', 'glow') are found again by the scene for animation.
// Geometry and materials are cached and shared; instances are cheap clones.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { TownBuildingId } from '#shared/utils/gamelogic/town'

interface Part {
    shape: 'box' | 'cyl' | 'cone' | 'sphere' | 'pyramid' | 'wedge'
    x: number
    /** Bottom of the part (not the centre) — parts stack naturally. */
    y: number
    z: number
    w: number
    h: number
    d: number
    color: number
    emissive?: number
    name?: string
    rotY?: number
    rotX?: number
    rotZ?: number
    /** Sphere/cylinder radial segments (defaults keep the low-poly look). */
    seg?: number
}

const geometryCache = new Map<string, THREE.BufferGeometry>()
const materialCache = new Map<string, THREE.MeshStandardMaterial>()

function geometry(p: Part): THREE.BufferGeometry {
    const key = `${p.shape}:${p.seg ?? ''}`
    let g = geometryCache.get(key)
    if (g) return g
    switch (p.shape) {
        case 'box': g = new THREE.BoxGeometry(1, 1, 1); break
        case 'cyl': g = new THREE.CylinderGeometry(0.5, 0.5, 1, p.seg ?? 10); break
        case 'cone': g = new THREE.ConeGeometry(0.5, 1, p.seg ?? 8); break
        case 'pyramid': g = new THREE.ConeGeometry(0.5 * Math.SQRT2, 1, 4); break
        case 'sphere': g = new THREE.SphereGeometry(0.5, p.seg ?? 10, p.seg ?? 8); break
        case 'wedge': {
            // Triangular prism along z: a roof slope / sawtooth tooth.
            const shape = new THREE.Shape()
            shape.moveTo(-0.5, 0)
            shape.lineTo(0.5, 0)
            shape.lineTo(-0.5, 1)
            shape.closePath()
            g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
            g.translate(0, 0, -0.5)
            break
        }
    }
    geometryCache.set(key, g)
    return g
}

export function townMaterial(color: number, emissive = 0): THREE.MeshStandardMaterial {
    const key = `${color}:${emissive}`
    let m = materialCache.get(key)
    if (!m) {
        m = new THREE.MeshStandardMaterial({
            color,
            emissive,
            emissiveIntensity: emissive ? 1.4 : 0,
            roughness: 0.85,
            metalness: 0.02,
            flatShading: true
        })
        materialCache.set(key, m)
    }
    return m
}

export function shade(color: number, amount: number): number {
    const c = new THREE.Color(color)
    const hsl = { h: 0, s: 0, l: 0 }
    c.getHSL(hsl)
    c.setHSL(hsl.h, Math.min(1, hsl.s * (amount < 0 ? 1.05 : 0.95)), Math.max(0, Math.min(1, hsl.l + amount)))
    return c.getHex()
}

function build(parts: Part[]): THREE.Group {
    const group = new THREE.Group()
    for (const p of parts) {
        const mesh = new THREE.Mesh(geometry(p), townMaterial(p.color, p.emissive))
        mesh.position.set(p.x, p.y + p.h / 2, p.z)
        if (p.shape === 'pyramid') mesh.rotation.y = Math.PI / 4
        if (p.shape === 'wedge') mesh.position.y = p.y
        mesh.scale.set(p.w, p.h, p.d)
        if (p.rotY) mesh.rotation.y += p.rotY
        if (p.rotX) mesh.rotation.x += p.rotX
        if (p.rotZ) mesh.rotation.z += p.rotZ
        mesh.castShadow = true
        mesh.receiveShadow = true
        if (p.name) mesh.name = p.name
        group.add(mesh)
    }
    const batches = new Map<THREE.Material, THREE.Mesh[]>()
    for (const child of [...group.children]) {
        if (!(child instanceof THREE.Mesh) || child.name) continue
        const material = child.material as THREE.Material
        const batch = batches.get(material) ?? []
        batch.push(child)
        batches.set(material, batch)
    }
    for (const [material, meshes] of batches) {
        if (meshes.length < 2) continue
        const pieces = meshes.map(mesh => {
            mesh.updateMatrix()
            const source = mesh.geometry as THREE.BufferGeometry
            const piece = source.index ? source.toNonIndexed() : source.clone()
            return piece.applyMatrix4(mesh.matrix)
        })
        const merged = mergeGeometries(pieces)
        pieces.forEach(piece => piece.dispose())
        if (!merged) continue
        const mesh = new THREE.Mesh(merged, material)
        mesh.castShadow = true
        mesh.receiveShadow = true
        group.remove(...meshes)
        group.add(mesh)
    }
    return group
}

// ─── Palette ─────────────────────────────────────────────────────────────────

const WOOD = 0xad7949
const WOOD_DARK = 0x5e3a1a
const STONE = 0xa9b3b0
const STONE_DARK = 0x637478
const CREAM = 0xf3e9d2
const ROOF_RED = 0xba5543
const ROOF_BLUE = 0x387b86
const LEAF = 0x659b59
const LEAF_DARK = 0x347565
const SOIL = 0x8a6a3f
const WHEAT = 0xe0c05a
const GLOW = 0xff8c1a
const METAL = 0x4a5568
const BRICK = 0xb5462d
const GOLD = 0xe8b95d

function tree(x: number, z: number, s = 1, dark = false): Part[] {
    return [
        { shape: 'cyl', x, y: 0, z, w: 0.08 * s, h: 0.22 * s, d: 0.08 * s, color: WOOD_DARK, seg: 6 },
        { shape: 'cone', x, y: 0.14 * s, z, w: 0.38 * s, h: 0.32 * s, d: 0.38 * s, color: LEAF_DARK, seg: 9 },
        { shape: 'cone', x, y: 0.28 * s, z, w: 0.32 * s, h: 0.3 * s, d: 0.32 * s, color: dark ? LEAF_DARK : LEAF, seg: 9 },
        { shape: 'cone', x, y: 0.42 * s, z, w: 0.24 * s, h: 0.3 * s, d: 0.24 * s, color: dark ? LEAF : 0x5fb35a, seg: 7 }
    ]
}

function roundTree(x: number, z: number, s = 1): Part[] {
    return [
        { shape: 'cyl', x, y: 0, z, w: 0.08 * s, h: 0.2 * s, d: 0.08 * s, color: WOOD_DARK, seg: 6 },
        { shape: 'sphere', x, y: 0.18 * s, z, w: 0.3 * s, h: 0.34 * s, d: 0.3 * s, color: LEAF, seg: 8 },
        ...[-1, 1].map((side): Part => ({ shape: 'sphere', x: x + side * 0.1 * s, y: 0.2 * s, z: z + 0.025 * s, w: 0.22 * s, h: 0.24 * s, d: 0.25 * s, color: side < 0 ? LEAF_DARK : 0x90b765, seg: 8 }))
    ]
}

function chimney(x: number, y: number, z: number, h = 0.25): Part[] {
    return [
        { shape: 'box', x, y, z, w: 0.1, h, d: 0.1, color: STONE_DARK },
        { shape: 'box', x, y: y + h - 0.02, z, w: 0.13, h: 0.04, d: 0.13, color: STONE_DARK },
        { shape: 'box', x, y: y + h, z, w: 0.01, h: 0.01, d: 0.01, color: STONE_DARK, name: 'smoke' }
    ]
}

const MODELS: Record<TownBuildingId, () => Part[]> = {
    // Roads are drawn by the scene as connected flat tiles; the model is only a
    // fallback so the registry stays complete.
    road: () => [
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.98, h: 0.03, d: 0.98, color: 0x5b5b60 }
    ],
    house: () => [
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.6, h: 0.42, d: 0.5, color: CREAM },
        { shape: 'wedge', x: 0.175, y: 0.42, z: 0, w: 0.35, h: 0.32, d: 0.58, color: ROOF_RED, rotY: 0 },
        { shape: 'wedge', x: -0.175, y: 0.42, z: 0, w: 0.35, h: 0.32, d: 0.58, color: ROOF_RED, rotY: Math.PI },
        { shape: 'box', x: 0, y: 0, z: 0.26, w: 0.14, h: 0.24, d: 0.03, color: WOOD_DARK },
        { shape: 'box', x: 0.18, y: 0.18, z: 0.26, w: 0.12, h: 0.12, d: 0.03, color: 0xffd27a, emissive: 0xffb347, name: 'glow' },
        { shape: 'box', x: -0.18, y: 0.18, z: 0.26, w: 0.12, h: 0.12, d: 0.03, color: 0xffd27a, emissive: 0xffb347, name: 'glow' },
        ...chimney(0.2, 0.55, -0.12, 0.18)
    ],
    park: () => [
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.9, h: 0.04, d: 0.9, color: 0x6fbf5f },
        ...roundTree(-0.22, -0.18, 1.1),
        ...tree(0.22, 0.14, 1),
        ...roundTree(0.05, -0.3, 0.8),
        { shape: 'box', x: -0.1, y: 0.04, z: 0.3, w: 0.3, h: 0.05, d: 0.08, color: WOOD },
        { shape: 'cyl', x: 0.3, y: 0.04, z: -0.3, w: 0.18, h: 0.03, d: 0.18, color: 0x5aa0d8, seg: 10 }
    ],
    warehouse: () => [
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.82, h: 0.36, d: 0.62, color: 0x8d99ae },
        { shape: 'box', x: 0, y: 0.36, z: 0, w: 0.88, h: 0.06, d: 0.68, color: 0x5c6675 },
        { shape: 'box', x: 0, y: 0, z: 0.32, w: 0.34, h: 0.26, d: 0.02, color: 0x3d4552 },
        { shape: 'box', x: 0, y: 0.13, z: 0.33, w: 0.34, h: 0.02, d: 0.02, color: 0x2b3038 },
        { shape: 'box', x: -0.3, y: 0.04, z: 0.42, w: 0.14, h: 0.14, d: 0.14, color: WOOD },
        { shape: 'box', x: 0.3, y: 0.04, z: 0.42, w: 0.14, h: 0.12, d: 0.14, color: WOOD }
    ],
    farm: () => [
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.9, h: 0.06, d: 0.9, color: SOIL },
        ...[-0.3, -0.1, 0.1, 0.3].flatMap(z => [-0.32, -0.16, 0, 0.16, 0.32].map(x => ({ shape: 'box' as const, x, y: 0.06, z, w: 0.07, h: 0.16 + ((x * 7 + z * 3) % 0.05), d: 0.06, color: WHEAT }))),
        { shape: 'box', x: -0.3, y: 0.06, z: -0.3, w: 0.22, h: 0.18, d: 0.2, color: WOOD },
        { shape: 'pyramid', x: -0.3, y: 0.24, z: -0.3, w: 0.28, h: 0.12, d: 0.26, color: ROOF_RED }
    ],
    lumber: () => [
        ...tree(-0.28, -0.25, 1.2, true),
        ...tree(0.3, -0.3, 0.9, true),
        { shape: 'cyl', x: 0.2, y: 0, z: 0.25, w: 0.14, h: 0.12, d: 0.14, color: WOOD, seg: 8 },
        { shape: 'cyl', x: -0.15, y: -0.11, z: 0.28, w: 0.14, h: 0.38, d: 0.14, color: WOOD, rotZ: Math.PI / 2, seg: 8 },
        { shape: 'cyl', x: -0.15, y: -0.11, z: 0.1, w: 0.14, h: 0.38, d: 0.14, color: WOOD_DARK, rotZ: Math.PI / 2, seg: 8 },
        { shape: 'cyl', x: -0.15, y: 0.01, z: 0.19, w: 0.14, h: 0.38, d: 0.14, color: WOOD, rotZ: Math.PI / 2, seg: 8 },
        { shape: 'box', x: 0.25, y: 0.12, z: 0.25, w: 0.03, h: 0.2, d: 0.03, color: STONE_DARK, rotZ: 0.4 }
    ],
    quarry: () => [
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.9, h: 0.05, d: 0.9, color: 0x7f7f7f },
        { shape: 'box', x: -0.2, y: 0.05, z: -0.15, w: 0.34, h: 0.22, d: 0.3, color: STONE },
        { shape: 'box', x: 0.2, y: 0.05, z: 0.15, w: 0.26, h: 0.3, d: 0.24, color: STONE_DARK, rotY: 0.4 },
        { shape: 'box', x: 0.1, y: 0.05, z: -0.28, w: 0.18, h: 0.14, d: 0.16, color: 0xb0b0b0, rotY: 0.9 },
        { shape: 'box', x: -0.28, y: 0.05, z: 0.28, w: 0.16, h: 0.12, d: 0.14, color: STONE, rotY: 0.2 },
        { shape: 'box', x: 0.35, y: 0.05, z: -0.3, w: 0.05, h: 0.5, d: 0.05, color: WOOD_DARK },
        { shape: 'box', x: 0.2, y: 0.5, z: -0.3, w: 0.36, h: 0.04, d: 0.04, color: WOOD_DARK }
    ],
    mill: () => [
        { shape: 'cyl', x: 0, y: 0, z: 0, w: 0.5, h: 0.6, d: 0.5, color: CREAM, seg: 10 },
        { shape: 'cone', x: 0, y: 0.6, z: 0, w: 0.56, h: 0.26, d: 0.56, color: ROOF_BLUE, seg: 10 },
        { shape: 'box', x: 0, y: 0, z: 0.25, w: 0.14, h: 0.22, d: 0.03, color: WOOD_DARK },
        { shape: 'box', x: 0, y: 0.55, z: 0.33, w: 0.05, h: 0.05, d: 0.16, color: WOOD_DARK, name: 'spin' }
    ],
    sawmill: () => [
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.8, h: 0.34, d: 0.5, color: 0xbc6c25 },
        { shape: 'wedge', x: 0.225, y: 0.34, z: 0, w: 0.45, h: 0.24, d: 0.58, color: 0x6f3f16 },
        { shape: 'wedge', x: -0.225, y: 0.34, z: 0, w: 0.45, h: 0.24, d: 0.58, color: 0x6f3f16, rotY: Math.PI },
        { shape: 'cyl', x: 0.2, y: 0.1, z: 0.28, w: 0.3, h: 0.03, d: 0.3, color: 0xcfd8dc, rotX: Math.PI / 2, seg: 16, name: 'spin' },
        { shape: 'cyl', x: -0.25, y: -0.08, z: 0.36, w: 0.1, h: 0.3, d: 0.1, color: WOOD, rotZ: Math.PI / 2, seg: 8 }
    ],
    kiln: () => [
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.7, h: 0.18, d: 0.7, color: BRICK },
        { shape: 'sphere', x: 0, y: -0.1, z: 0, w: 0.62, h: 0.62, d: 0.62, color: 0xc1440e, seg: 12 },
        { shape: 'box', x: 0, y: 0.1, z: 0.3, w: 0.18, h: 0.14, d: 0.06, color: 0x2b1a12 },
        { shape: 'box', x: 0, y: 0.11, z: 0.31, w: 0.14, h: 0.1, d: 0.02, color: GLOW, emissive: GLOW, name: 'glow' },
        ...chimney(0, 0.4, -0.05, 0.3)
    ],
    bakery: () => [
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.66, h: 0.44, d: 0.56, color: 0xf7d9a6 },
        { shape: 'box', x: 0, y: 0.44, z: 0, w: 0.72, h: 0.06, d: 0.62, color: 0x8c5a2b },
        ...[-0.24, -0.12, 0, 0.12, 0.24].map((x, i) => ({ shape: 'box' as const, x, y: 0.3, z: 0.32, w: 0.12, h: 0.04, d: 0.16, color: i % 2 ? 0xffffff : 0xe74c3c, rotX: 0.35 })),
        { shape: 'box', x: 0.14, y: 0, z: 0.29, w: 0.14, h: 0.24, d: 0.02, color: WOOD_DARK },
        { shape: 'box', x: -0.14, y: 0.12, z: 0.29, w: 0.18, h: 0.14, d: 0.02, color: 0xfff1c9, emissive: 0xffc46b, name: 'glow' },
        ...chimney(-0.2, 0.5, -0.15, 0.22)
    ],
    smithy: () => [
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.7, h: 0.38, d: 0.56, color: 0x4a4e69 },
        { shape: 'wedge', x: 0.2, y: 0.38, z: 0, w: 0.4, h: 0.22, d: 0.64, color: 0x2f3247 },
        { shape: 'wedge', x: -0.2, y: 0.38, z: 0, w: 0.4, h: 0.22, d: 0.64, color: 0x2f3247, rotY: Math.PI },
        { shape: 'box', x: 0, y: 0.02, z: 0.29, w: 0.3, h: 0.22, d: 0.02, color: GLOW, emissive: 0xff6a00, name: 'glow' },
        { shape: 'box', x: 0.25, y: 0, z: 0.4, w: 0.16, h: 0.1, d: 0.08, color: METAL },
        ...chimney(-0.22, 0.5, -0.1, 0.26)
    ],
    mine: () => [
        { shape: 'sphere', x: -0.1, y: -0.25, z: -0.15, w: 0.9, h: 0.7, d: 0.8, color: 0x555a66, seg: 9 },
        { shape: 'box', x: 0.1, y: 0, z: 0.22, w: 0.3, h: 0.28, d: 0.06, color: 0x1a1a22 },
        { shape: 'box', x: -0.06, y: 0, z: 0.25, w: 0.05, h: 0.3, d: 0.05, color: WOOD },
        { shape: 'box', x: 0.26, y: 0, z: 0.25, w: 0.05, h: 0.3, d: 0.05, color: WOOD },
        { shape: 'box', x: 0.1, y: 0.28, z: 0.25, w: 0.4, h: 0.05, d: 0.06, color: WOOD },
        { shape: 'box', x: 0.1, y: 0, z: 0.38, w: 0.3, h: 0.01, d: 0.2, color: 0x3d3d3d },
        { shape: 'box', x: 0.1, y: 0.01, z: 0.4, w: 0.18, h: 0.1, d: 0.12, color: 0x7a4b2a, name: 'cart' },
        { shape: 'box', x: 0.1, y: 0.1, z: 0.4, w: 0.14, h: 0.05, d: 0.09, color: 0x8892a6 }
    ],
    foundry: () => [
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.76, h: 0.6, d: 0.6, color: 0x7a1f1f },
        { shape: 'box', x: 0, y: 0.6, z: 0, w: 0.82, h: 0.06, d: 0.66, color: 0x3a0c0c },
        { shape: 'box', x: 0, y: 0.2, z: 0.31, w: 0.5, h: 0.08, d: 0.02, color: GLOW, emissive: 0xff5a00, name: 'glow' },
        ...chimney(-0.22, 0.66, -0.15, 0.4),
        ...chimney(0.22, 0.66, -0.15, 0.32)
    ],
    factory: () => [
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.86, h: 0.5, d: 0.66, color: 0x577590 },
        ...[-0.28, 0, 0.28].map(x => ({ shape: 'wedge' as const, x, y: 0.5, z: 0, w: 0.28, h: 0.18, d: 0.66, color: 0x3d5266 })),
        ...[-0.28, 0, 0.28].flatMap((x, i) => chimney(x, 0.68, -0.22, 0.3 + i * 0.06)),
        { shape: 'cyl', x: 0.44, y: 0.15, z: 0.1, w: 0.22, h: 0.04, d: 0.22, color: METAL, rotZ: Math.PI / 2, seg: 8, name: 'spin' },
        { shape: 'box', x: 0, y: 0.1, z: 0.34, w: 0.5, h: 0.2, d: 0.02, color: 0xa9d6ff, emissive: 0x6fb8ff, name: 'glow' }
    ],
    emporium: () => [
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.8, h: 0.46, d: 0.66, color: 0x7b2cbf },
        { shape: 'box', x: 0, y: 0.46, z: 0, w: 0.86, h: 0.05, d: 0.72, color: GOLD },
        ...[-0.3, -0.1, 0.1, 0.3].map(x => ({ shape: 'cyl' as const, x, y: 0, z: 0.36, w: 0.07, h: 0.46, d: 0.07, color: 0xf8f1ff, seg: 8 })),
        { shape: 'sphere', x: 0, y: 0.36, z: 0, w: 0.5, h: 0.5, d: 0.5, color: GOLD, seg: 12 },
        { shape: 'cone', x: 0, y: 0.72, z: 0, w: 0.08, h: 0.18, d: 0.08, color: 0xfff6c8, emissive: 0xfff0a0, seg: 6, name: 'glow' },
        { shape: 'box', x: 0, y: 0.75, z: 0, w: 0.01, h: 0.01, d: 0.01, color: GOLD, name: 'sparkle' }
    ]
}

// Handcrafted miniature details. All dimensions remain tile-local; these parts
// are visual only and never participate in production or placement rules.
function box(x: number, y: number, z: number, w: number, h: number, d: number, color: number, extra: Partial<Part> = {}): Part {
    return { shape: 'box', x, y, z, w, h, d, color, ...extra }
}

function pot(x: number, z: number, flowers = false): Part[] {
    return [
        { shape: 'cyl', x, y: 0.015, z, w: 0.105, h: 0.09, d: 0.105, color: ROOF_RED },
        { shape: 'cyl', x, y: 0.085, z, w: 0.12, h: 0.025, d: 0.12, color: 0xdd9570 },
        ...[-1, 0, 1].map((i): Part => ({ shape: 'sphere', x: x + i * 0.025, y: 0.1 + (i === 0 ? 0.035 : 0), z, w: 0.07, h: 0.08, d: 0.07, color: flowers ? [0xf2c869, 0xe99aab, 0xf7e2b2][i + 1]! : LEAF }))
    ]
}

function barrel(x: number, z: number, y = 0): Part[] {
    return [
        { shape: 'cyl', x, y, z, w: 0.13, h: 0.17, d: 0.13, color: WOOD, seg: 12 },
        ...[0.025, 0.125].map((dy): Part => ({ shape: 'cyl', x, y: y + dy, z, w: 0.138, h: 0.018, d: 0.138, color: METAL, seg: 12 })),
        box(x, y + 0.17, z, 0.105, 0.009, 0.014, WOOD_DARK)
    ]
}

function windowFrame(x: number, y: number, z: number, w = 0.12, h = 0.14): Part[] {
    return [
        box(x, y - 0.018, z, w + 0.04, 0.022, 0.045, CREAM),
        ...[-1, 1].map(i => box(x + i * (w / 2 + 0.009), y, z, 0.018, h, 0.028, WOOD_DARK)),
        box(x, y + h, z, w + 0.036, 0.022, 0.028, WOOD_DARK),
        box(x, y, z + 0.009, 0.012, h, 0.016, CREAM),
        box(x, y + h / 2, z + 0.009, w, 0.012, 0.016, CREAM)
    ]
}

function fence(z: number, width = 0.86): Part[] {
    return [
        ...[-0.4, -0.2, 0, 0.2, 0.4].map(x => box(x, 0.02, z, 0.026, 0.19, 0.026, CREAM)),
        ...[0.075, 0.155].map(y => box(0, y, z, width, 0.025, 0.025, WOOD))
    ]
}

function roofTiles(w: number, y: number, h: number, d: number, color: number): Part[] {
    const angle = Math.atan2(h, w / 2)
    const length = Math.hypot(w / 2, h)
    return [-1, 1].flatMap(side => Array.from({ length: 5 }, (_, row) => {
        const t = (row + 0.5) / 5
        return Array.from({ length: 7 }, (_, col) => box(
            side * w / 2 * t, y + h * (1 - t) + 0.004,
            (col - 3) * d / 7, length / 5 + 0.008, 0.016, d / 7 - 0.007,
            shade(color, ((col + row * 3) % 4) * 0.025), { rotZ: -side * angle }
        ))
    }).flat())
}

function details(type: TownBuildingId): Part[] {
    const parts: Part[] = []
    const shells: Partial<Record<TownBuildingId, [number, number, number]>> = {
        house: [0.6, 0.42, 0.5], warehouse: [0.82, 0.36, 0.62], sawmill: [0.8, 0.34, 0.5],
        bakery: [0.66, 0.44, 0.56], smithy: [0.7, 0.38, 0.56], foundry: [0.76, 0.6, 0.6],
        factory: [0.86, 0.5, 0.66], emporium: [0.8, 0.46, 0.66]
    }
    const shell = shells[type]
    if (shell) {
        const [w, h, d] = shell
        parts.push(box(0, 0, 0, w + 0.04, 0.045, d + 0.04, STONE_DARK))
        for (const side of [-1, 1]) {
            parts.push(box(side * (w / 2 - 0.018), 0.04, 0, 0.035, h - 0.04, d + 0.025, type === 'emporium' ? GOLD : WOOD_DARK))
            parts.push(box(0, h - 0.045, side * d / 2, w + 0.025, 0.035, 0.03, type === 'emporium' ? GOLD : WOOD_DARK))
            // Framed glazing on both side elevations, so orbiting reveals finished facades.
            const industrial = ['warehouse', 'sawmill', 'smithy', 'foundry', 'factory'].includes(type)
            for (const z of [-d * 0.22, d * 0.22]) {
                const glazing = [box(0, h * 0.38, w / 2 + 0.014, 0.115, 0.13, 0.018, industrial ? 0x92b6bc : 0xf5d598), ...windowFrame(0, h * 0.38, w / 2 + 0.03, 0.115, 0.13)]
                parts.push(...glazing.map(p => ({ ...p, x: side * p.z, z: z - side * p.x, rotY: side * Math.PI / 2 })))
            }
            if (industrial) {
                for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
                    parts.push(box(side * (w / 2 + 0.012), 0.06 + row * 0.025, (col - 1.5) * d / 4, 0.015, 0.018, d / 4 - 0.008, row % 2 ? STONE_DARK : STONE))
                }
            }
            // Stone footings and side-wall joinery read from every camera angle.
            for (let i = 0; i < 5; i++) parts.push(box(side * (w / 2 + 0.005), 0.005, (i - 2) * d / 5, 0.022, 0.052, d / 5 - 0.012, STONE))
        }
    }
    if (type === 'house' || type === 'sawmill' || type === 'smithy') {
        const roof = type === 'house' ? [0.7, 0.42, 0.32, 0.58, ROOF_RED] : type === 'sawmill' ? [0.9, 0.34, 0.24, 0.58, WOOD_DARK] : [0.8, 0.38, 0.22, 0.64, METAL]
        parts.push(...roofTiles(roof[0]!, roof[1]!, roof[2]!, roof[3]!, roof[4]!))
        parts.push(box(0, roof[1]! + roof[2]!, 0, 0.045, 0.035, roof[3]! + 0.035, roof[4]!))
    }
    switch (type) {
        case 'house':
            parts.push({ shape: 'cyl', x: 0, y: 0.535, z: 0.3, w: 0.12, h: 0.018, d: 0.12, color: CREAM, rotX: Math.PI / 2, seg: 16 }, { shape: 'cyl', x: 0, y: 0.541, z: 0.311, w: 0.083, h: 0.01, d: 0.083, color: ROOF_BLUE, rotX: Math.PI / 2, seg: 16 })
            for (const x of [-0.18, 0.18]) {
                parts.push(...windowFrame(x, 0.18, 0.282, 0.12, 0.12))
                parts.push(box(x, 0.125, 0.29, 0.16, 0.04, 0.09, WOOD))
                for (const dx of [-0.045, 0, 0.045]) parts.push({ shape: 'sphere', x: x + dx, y: 0.16, z: 0.3, w: 0.045, h: 0.045, d: 0.045, color: dx === 0 ? 0xf2c96d : 0xdf8794 })
            }
            parts.push(box(0, 0.005, 0.33, 0.2, 0.035, 0.13, STONE), box(0.045, 0.12, 0.281, 0.017, 0.017, 0.014, GOLD), ...pot(-0.34, 0.23))
            break
        case 'park':
            parts.push(...fence(-0.43), ...pot(-0.32, 0.33, true), ...pot(0.32, 0.33, true))
            for (const x of [-0.21, 0.01]) parts.push(box(x, 0.04, 0.3, 0.025, 0.1, 0.08, METAL))
            parts.push(box(-0.1, 0.13, 0.255, 0.3, 0.06, 0.018, WOOD))
            for (let i = 0; i < 5; i++) parts.push(box(0.06, 0.042, 0.36 - i * 0.14, 0.12, 0.012, 0.1, 0xd6c4a0))
            parts.push({ shape: 'cyl', x: 0.3, y: 0.035, z: -0.3, w: 0.23, h: 0.04, d: 0.23, color: CREAM, seg: 16 }, { shape: 'cyl', x: 0.3, y: 0.076, z: -0.3, w: 0.18, h: 0.008, d: 0.18, color: 0x73c8cb, seg: 16 }, { shape: 'sphere', x: 0.3, y: 0.08, z: -0.3, w: 0.045, h: 0.11, d: 0.045, color: 0xb8e6df })
            break
        case 'warehouse':
            for (let i = 0; i < 7; i++) parts.push(box(0, 0.025 + i * 0.032, 0.338, 0.32, 0.012, 0.014, STONE))
            for (const x of [-0.3, 0.3]) {
                for (const y of [0.065, 0.14]) parts.push(box(x, y, 0.495, 0.14, 0.016, 0.014, WOOD_DARK))
                parts.push(box(x, 0.045, 0.496, 0.016, 0.12, 0.014, WOOD_DARK))
            }
            for (let i = 0; i < 7; i++) parts.push(box((i - 3) * 0.12, 0.42, 0, 0.014, 0.018, 0.66, STONE))
            parts.push(...barrel(-0.32, -0.39))
            break
        case 'farm':
            parts.push(...fence(-0.44))
            for (const z of [-0.3, -0.1, 0.1, 0.3]) {
                parts.push(box(0, 0.062, z, 0.84, 0.012, 0.12, WOOD_DARK))
                for (const x of [-0.32, -0.16, 0, 0.16, 0.32]) {
                    if (z === -0.3 && x < -0.16) continue
                    for (const side of [-1, 1]) parts.push({ shape: 'sphere', x: x + side * 0.024, y: 0.21, z, w: 0.027, h: 0.075, d: 0.032, color: side < 0 ? 0xf7d97c : WHEAT, rotZ: side * 0.5, seg: 6 })
                }
            }
            parts.push(box(0.31, 0.06, -0.32, 0.023, 0.34, 0.023, WOOD_DARK), box(0.31, 0.27, -0.32, 0.18, 0.024, 0.024, WOOD_DARK), { shape: 'sphere', x: 0.31, y: 0.36, z: -0.32, w: 0.08, h: 0.075, d: 0.08, color: CREAM }, { shape: 'cyl', x: 0.31, y: 0.42, z: -0.32, w: 0.14, h: 0.018, d: 0.14, color: WHEAT }, box(0.31, 0.27, -0.32, 0.08, 0.09, 0.06, ROOF_BLUE))
            break
        case 'lumber':
            for (const [y, z] of [[0.08, 0.1], [0.08, 0.28], [0.2, 0.19]]) {
                for (const x of [-0.344, 0.044]) {
                    parts.push({ shape: 'cyl', x, y: y! - 0.003, z: z!, w: 0.12, h: 0.006, d: 0.12, color: 0xdab47d, rotZ: Math.PI / 2, seg: 10 }, { shape: 'cyl', x: x + (x < 0 ? -0.004 : 0.004), y: y! - 0.003, z: z!, w: 0.07, h: 0.006, d: 0.07, color: WOOD, rotZ: Math.PI / 2, seg: 10 })
                }
            }
            parts.push(box(0.26, 0.25, 0.25, 0.12, 0.065, 0.018, STONE), ...barrel(0.37, 0.04))
            for (const z of [0.08, 0.24]) parts.push(box(-0.15, 0.035, z, 0.38, 0.025, 0.025, WOOD_DARK))
            for (const x of [-0.3, -0.2, -0.1]) parts.push(box(x, 0.018, -0.02, 0.07, 0.035, 0.3, WOOD))
            break
        case 'quarry':
            parts.push(box(0.05, 0.28, -0.3, 0.012, 0.23, 0.012, METAL), box(0.05, 0.25, -0.3, 0.08, 0.03, 0.06, METAL))
            for (let i = 0; i < 5; i++) parts.push(box(-0.25 + i * 0.1, 0.012, 0.39, 0.08, 0.06, 0.08, i % 2 ? STONE : CREAM))
            for (const y of [0.11, 0.2]) parts.push(box(-0.2, y, 0.003, 0.32, 0.012, 0.008, STONE_DARK))
            break
        case 'mill':
            parts.push(...windowFrame(0, 0.28, 0.247, 0.1, 0.13), box(0, 0.28, 0.245, 0.1, 0.13, 0.02, 0x82bfc3), ...barrel(-0.3, 0.16), ...barrel(-0.3, -0.02))
            for (const y of [0.07, 0.23, 0.43]) parts.push({ shape: 'cyl', x: 0, y, z: 0, w: 0.509, h: 0.014, d: 0.509, color: STONE, seg: 10 })
            break
        case 'sawmill':
            for (const x of [-0.3, -0.18, -0.06]) parts.push(box(x, 0.025, 0.38, 0.08, 0.045, 0.22, WOOD))
            parts.push(box(0.2, 0.06, 0.36, 0.33, 0.035, 0.13, WOOD_DARK))
            for (const x of [-0.32, -0.16, 0, 0.16, 0.32]) parts.push(box(x, 0.05, 0.258, 0.014, 0.25, 0.018, WOOD_DARK))
            break
        case 'kiln':
            for (let row = 0; row < 4; row++) {
                const radius = 0.3 * Math.sqrt(1 - Math.pow((0.08 + row * 0.075 - 0.21) / 0.31, 2))
                for (let i = 0; i < 12; i++) {
                    const a = (i + row * 0.5) * Math.PI / 6
                    if (Math.cos(a) > 0.8 && row < 2) continue
                    parts.push(box(Math.sin(a) * radius, 0.08 + row * 0.075, Math.cos(a) * radius, 0.13, 0.055, 0.03, shade(BRICK, (i % 3) * 0.025), { rotY: a }))
                }
            }
            for (let i = 0; i < 6; i++) parts.push(box(-0.27 + (i % 2) * 0.12, 0.02 + Math.floor(i / 2) * 0.045, 0.4, 0.105, 0.04, 0.065, BRICK))
            break
        case 'bakery':
            parts.push(...windowFrame(-0.14, 0.12, 0.31, 0.18, 0.14), box(0, 0.065, 0.39, 0.4, 0.045, 0.12, WOOD), ...pot(0.37, 0.22, true))
            for (const x of [-0.13, 0, 0.13]) {
                parts.push({ shape: 'sphere', x, y: 0.11, z: 0.39, w: 0.095, h: 0.045, d: 0.065, color: WHEAT })
                parts.push(box(x, 0.148, 0.39, 0.012, 0.005, 0.035, CREAM, { rotY: 0.4 }))
            }
            parts.push(...roofTiles(0.72, 0.5, 0.16, 0.62, ROOF_BLUE))
            break
        case 'smithy':
            parts.push(box(0.25, 0.1, 0.4, 0.21, 0.03, 0.095, STONE), box(0.25, 0.13, 0.4, 0.04, 0.09, 0.028, WOOD), box(0.25, 0.21, 0.4, 0.09, 0.04, 0.045, METAL), ...barrel(-0.36, 0.33))
            for (const x of [-0.11, -0.055, 0, 0.055, 0.11]) parts.push(box(x, 0.025, 0.313, 0.013, 0.19, 0.018, METAL))
            break
        case 'mine':
            for (const x of [-0.02, 0.22]) parts.push(box(x, 0.016, 0.37, 0.017, 0.015, 0.26, STONE))
            for (const z of [0.29, 0.37, 0.45]) parts.push(box(0.1, 0.008, z, 0.29, 0.012, 0.025, WOOD))
            for (const x of [0, 0.2]) for (const z of [0.36, 0.44]) parts.push({ shape: 'cyl', x, y: 0.02, z, w: 0.047, h: 0.025, d: 0.047, color: METAL, rotZ: Math.PI / 2, seg: 8 })
            for (const [x, y, z] of [[-0.29, 0.22, -0.22], [-0.07, 0.36, -0.1], [0.15, 0.23, -0.2]]) parts.push({ shape: 'pyramid', x: x!, y: y!, z: z!, w: 0.09, h: 0.12, d: 0.09, color: 0x80b8c2 })
            parts.push(box(0.29, 0.18, 0.29, 0.045, 0.065, 0.045, GLOW, { emissive: GLOW, name: 'glow' }))
            break
        case 'foundry':
        case 'factory':
            for (const x of [-0.3, -0.15, 0, 0.15, 0.3]) parts.push(box(x, 0.09, type === 'factory' ? 0.357 : 0.329, 0.017, type === 'factory' ? 0.22 : 0.21, 0.019, METAL))
            for (const z of [-0.2, 0, 0.2]) parts.push(box(-0.39, 0.16, z, 0.025, 0.26, 0.11, STONE_DARK))
            parts.push(...barrel(-0.29, 0.41), ...barrel(-0.12, 0.41))
            for (const x of [-0.22, 0.22]) for (const y of [0.72, 0.86]) parts.push(box(x, y, -0.15, 0.115, 0.025, 0.115, STONE))
            break
        case 'emporium':
            parts.push(box(0, 0.015, 0.41, 0.76, 0.035, 0.13, CREAM), box(0, 0.053, 0.38, 0.64, 0.03, 0.08, CREAM), ...pot(-0.39, 0.38, true), ...pot(0.39, 0.38, true))
            for (const x of [-0.3, -0.1, 0.1, 0.3]) for (const y of [0.06, 0.4]) parts.push(box(x, y, 0.36, 0.1, 0.028, 0.1, GOLD))
            for (const x of [-0.2, 0, 0.2]) parts.push(box(x, 0.13, 0.339, 0.12, 0.22, 0.025, 0x5db3b5, { emissive: 0x276863, name: 'glow' }))
            for (let i = 0; i < 12; i++) {
                const a = i * Math.PI / 6
                parts.push({ shape: 'sphere', x: Math.cos(a) * 0.247, y: 0.54, z: Math.sin(a) * 0.247, w: 0.028, h: 0.085, d: 0.028, color: CREAM })
            }
            break
    }
    return parts
}

const prototypes = new Map<TownBuildingId, THREE.Group>()

/** A fresh instance of a building model; materials are shared, meshes are cheap clones. */
export function createBuildingModel(type: TownBuildingId): THREE.Group {
    let proto = prototypes.get(type)
    if (!proto) {
        proto = build([...MODELS[type](), ...details(type)])
        if (type === 'mill') {
            const hub = proto.getObjectByName('spin')!
            // Children rotate with the existing hub animation.
            for (let i = 0; i < 4; i++) {
                const sail = build([
                    box(0, 0, 0, 0.028, 0.42, 0.025, WOOD_DARK),
                    box(0.052, 0.1, 0, 0.1, 0.3, 0.015, CREAM),
                    ...[0.14, 0.22, 0.3, 0.38].map(y => box(0.052, y, 0.012, 0.11, 0.012, 0.01, WOOD))
                ])
                // The named hub is a scaled primitive; cancel that local scale.
                const pivot = new THREE.Group()
                pivot.scale.set(20, 20, 6.25)
                sail.rotation.z = i * Math.PI / 2 + Math.PI / 4
                pivot.add(sail)
                hub.add(pivot)
            }
        }
        prototypes.set(type, proto)
    }
    return proto.clone(true)
}

/** Tiny townsfolk with boots, sleeves, hair and a brimmed hat. */
export function createVillager(color: number): THREE.Group {
    return build([
        ...[-1, 1].flatMap(side => [box(side * 0.024, 0, 0.01, 0.035, 0.03, 0.065, WOOD_DARK), box(side * 0.06, 0.055, 0, 0.027, 0.07, 0.035, color)]),
        { shape: 'cyl', x: 0, y: 0, z: 0, w: 0.09, h: 0.13, d: 0.09, color, seg: 6 },
        { shape: 'sphere', x: 0, y: 0.13, z: 0, w: 0.08, h: 0.08, d: 0.08, color: 0xf1c6a0, seg: 8 },
        { shape: 'sphere', x: 0, y: 0.18, z: -0.01, w: 0.085, h: 0.04, d: 0.08, color: WOOD_DARK },
        { shape: 'cyl', x: 0, y: 0.205, z: 0, w: 0.13, h: 0.012, d: 0.12, color: WHEAT },
        { shape: 'cyl', x: 0, y: 0.215, z: 0, w: 0.075, h: 0.028, d: 0.075, color: WHEAT }
    ])
}

export function createForSaleSign(): THREE.Group {
    return build([
        { shape: 'box', x: 0, y: 0, z: 0, w: 0.12, h: 1.4, d: 0.12, color: WOOD },
        box(0, 1.05, 0, 1.72, 0.8, 0.12, WOOD_DARK),
        box(0, 1.86, 0, 1.82, 0.07, 0.18, ROOF_BLUE),
        ...[-0.72, 0.72].map(x => box(x, 1.15, 0.065, 0.045, 0.045, 0.015, GOLD)),
        { shape: 'box', x: 0, y: 1.1, z: 0.03, w: 1.6, h: 0.7, d: 0.08, color: 0xf3e9d2, name: 'board' }
    ])
}

export const TREE_GEOMETRY = {
    trunk: new THREE.CylinderGeometry(0.07, 0.1, 0.35, 6),
    foliage: new THREE.ConeGeometry(0.42, 0.95, 7),
    bush: new THREE.SphereGeometry(0.3, 7, 6),
    rock: new THREE.DodecahedronGeometry(0.22, 0)
}
