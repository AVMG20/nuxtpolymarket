// Architectural skins follow the existing solid volumes. No colliders, lights,
// triggers or navigation data are added here.
import * as THREE from 'three'
import { BOX, voxMaterial } from './models'
import { panel } from './model-detail'
import type { VoxPart } from './models'

type Solid = { x: number, y: number, z: number, w: number, h: number, d: number, color: number }
const FRAME = 0x172332
const ALLOY = 0x657e91
const PANEL = 0x34495a
const LIGHT = 0x52d9e6
const AMBER = 0xf4b85b

/** Thousands of fittings render in a handful of material batches. */
export function architecturalModel(parts: VoxPart[]): THREE.Group {
    const group = new THREE.Group()
    const batches = new Map<THREE.Material, VoxPart[]>()
    for (const p of parts) {
        const material = voxMaterial(p.color, p.emissive ?? 0, p.glow ?? 1)
        const list = batches.get(material) ?? []
        list.push(p)
        batches.set(material, list)
    }
    const transform = new THREE.Object3D()
    for (const [material, list] of batches) {
        const mesh = new THREE.InstancedMesh(BOX, material, list.length)
        list.forEach((p, index) => {
            transform.position.set(p.x, p.y, p.z)
            transform.scale.set(p.w, p.h, p.d)
            transform.updateMatrix()
            mesh.setMatrixAt(index, transform.matrix)
        })
        mesh.receiveShadow = true
        mesh.computeBoundingSphere()
        group.add(mesh)
    }
    return group
}

export function coverSkin(solids: Solid[]): THREE.Group {
    const parts: VoxPart[] = []
    for (const p of solids) {
        const crate = p.w === 1.5 && p.h === 1.5 && p.d === 1.5
        const tower = p.h > 3
        const top = p.y + p.h / 2
        // Panels sit just above each walkable surface, never changing its height.
        parts.push(panel(p.x, top + 0.006, p.z, p.w * 0.94, 0.012, p.d * 0.94, p.color))
        for (const side of [-1, 1]) {
            const x = p.x + side * (p.w / 2 + 0.008)
            const z = p.z + side * (p.d / 2 + 0.008)
            parts.push(panel(p.x, p.y, z, p.w * 0.85, p.h * 0.74, 0.016, p.color))
            parts.push(panel(x, p.y, p.z, 0.016, p.h * 0.74, p.d * 0.85, p.color))
            for (const level of [-0.38, 0.38]) {
                parts.push(panel(p.x, p.y + p.h * level, z, p.w * 0.96, 0.06, 0.035, ALLOY))
                parts.push(panel(x, p.y + p.h * level, p.z, 0.035, 0.06, p.d * 0.96, ALLOY))
            }
            // Recessed light channels beneath the top lip.
            parts.push(panel(p.x, top - Math.min(0.18, p.h * 0.2), z + side * 0.018, p.w * 0.58, 0.035, 0.016, crate ? AMBER : LIGHT, crate ? 0 : LIGHT))
            parts.push(panel(x + side * 0.018, top - Math.min(0.18, p.h * 0.2), p.z, 0.016, 0.035, p.d * 0.58, crate ? AMBER : LIGHT, crate ? 0 : LIGHT))
            for (const end of [-1, 1]) {
                parts.push(panel(p.x + end * p.w * 0.44, p.y, z, Math.min(0.12, p.w * 0.1), p.h * 0.96, 0.045, ALLOY))
                parts.push(panel(x, p.y, p.z + end * p.d * 0.44, 0.045, p.h * 0.96, Math.min(0.12, p.d * 0.1), ALLOY))
            }
            if (crate || tower) {
                for (let i = 0; i < (tower ? 7 : 3); i++) {
                    parts.push(panel(p.x, p.y - p.h * 0.24 + i * (tower ? 0.28 : 0.15), z + side * 0.022, p.w * 0.4, 0.055, 0.025, FRAME))
                    parts.push(panel(x + side * 0.022, p.y - p.h * 0.24 + i * (tower ? 0.28 : 0.15), p.z, 0.025, 0.055, p.d * 0.4, FRAME))
                }
            }
            if (crate) {
                parts.push(panel(p.x + 0.4, p.y + 0.13, z + side * 0.03, 0.22, 0.28, 0.025, FRAME))
                parts.push(panel(p.x + 0.4, p.y + 0.17, z + side * 0.046, 0.13, 0.04, 0.012, LIGHT, LIGHT))
            }
        }
        // Flush deck seams and corner markers give platforms a readable scale.
        if (p.w >= 3 && p.d >= 3) {
            for (let x = -p.w / 2 + 1; x < p.w / 2; x += 1) parts.push(panel(p.x + x, top + 0.014, p.z, 0.018, 0.008, p.d * 0.88, ALLOY))
            for (let z = -p.d / 2 + 1; z < p.d / 2; z += 1) parts.push(panel(p.x, top + 0.014, p.z + z, p.w * 0.88, 0.008, 0.018, ALLOY))
        }
    }
    return architecturalModel(parts)
}

export function perimeterModel(half: number): THREE.Group {
    const parts: VoxPart[] = []
    // Four distinct sector accents, with repeatable bulkhead bays.
    for (let side = 0; side < 4; side++) {
        const accent = [LIGHT, AMBER, 0xa18ced, 0x79d7b5][side]!
        const rotate = (p: VoxPart): VoxPart => {
            if (side === 0) return p
            if (side === 1) return { ...p, x: -p.z, z: p.x, w: p.d, d: p.w }
            if (side === 2) return { ...p, x: -p.x, z: -p.z }
            return { ...p, x: p.z, z: -p.x, w: p.d, d: p.w }
        }
        const add = (p: VoxPart) => parts.push(rotate(p))
        for (let x = -half + 4; x < half; x += 8) {
            const z = -half + 0.02
            add(panel(x, 5.6, z, 7.6, 9.7, 0.07, FRAME))
            add(panel(x, 6.3, z + 0.05, 6.5, 6.2, 0.09, [0x287d85, 0xb65339, 0x6650a0, 0x38776a][side]!))
            for (const dx of [-3.65, 3.65]) {
                add(panel(x + dx, 5.8, z + 0.06, 0.32, 10.8, 0.12, ALLOY))
                add(panel(x + dx, 4.8, z + 0.13, 0.075, 5.8, 0.025, accent, accent))
            }
            for (const y of [0.5, 2.8, 9.65]) add(panel(x, y, z + 0.09, 7.5, 0.22, 0.12, ALLOY))
            // Vent banks and armored service hatches.
            for (let i = 0; i < 6; i++) add(panel(x, 7.1 + i * 0.29, z + 0.12, 4.9, 0.12, 0.12, FRAME))
            add(panel(x, 4.7, z + 0.12, 2.7, 2.4, 0.1, FRAME))
            add(panel(x, 4.7, z + 0.18, 2.4, 2.05, 0.05, ALLOY))
            add(panel(x, 4.7, z + 0.21, 0.065, 1.8, 0.03, FRAME))
            for (let i = 0; i < side + 1; i++) add(panel(x - 0.5 + i * 0.32, 6.2, z + 0.17, 0.17, 0.38, 0.02, accent, accent))
            for (const dx of [-2.8, 2.8]) add(panel(x + dx, 1.6, z + 0.12, 0.28, 0.48, 0.04, AMBER))
            // Structures outside the playable boundary frame the skyline.
            add(panel(x, 11.4, -half - 2.3, 2.1, 3.4, 2.1, FRAME))
            add(panel(x, 13.15, -half - 2.3, 2.4, 0.18, 2.4, ALLOY))
            add(panel(x, 13.35, -half - 2.3, 0.65, 0.14, 0.65, accent, accent))
        }
    }
    // Thin inset deck markings and cable trenches preserve the flat floor.
    for (const sign of [-1, 1]) {
        for (let t = -32; t <= 32; t += 4) {
            parts.push(panel(t, 0.013, sign * 32, 1.1, 0.018, 0.06, LIGHT, LIGHT))
            parts.push(panel(sign * 32, 0.013, t, 0.06, 0.018, 1.1, LIGHT, LIGHT))
        }
        for (let t = -30; t <= 30; t += 2) {
            parts.push(panel(t, 0.012, sign * 6.5, 0.6, 0.014, 0.12, ALLOY))
            parts.push(panel(sign * 6.5, 0.012, t, 0.12, 0.014, 0.6, ALLOY))
        }
    }
    return architecturalModel(parts)
}

export function jumpPadModel(): THREE.Group {
    const parts: VoxPart[] = []
    for (const side of [-1, 1]) {
        parts.push(panel(side * 1.04, 0.12, 0, 0.16, 0.08, 2.2, ALLOY))
        parts.push(panel(0, 0.12, side * 1.04, 2.2, 0.08, 0.16, ALLOY))
        for (const end of [-1, 1]) parts.push(panel(side * 0.88, 0.17, end * 0.88, 0.2, 0.035, 0.2, AMBER))
    }
    for (let i = -2; i <= 2; i++) {
        parts.push(panel(0, 0.169, i * 0.3, 1.35 - Math.abs(i) * 0.28, 0.016, 0.12, FRAME))
    }
    return architecturalModel(parts)
}

export function orbitalModuleParts(index: number): VoxPart[] {
    const parts: VoxPart[] = []
    const accent = index % 3 ? LIGHT : AMBER
    parts.push(panel(0, 0, 0, 3.5, 1.6, 5, FRAME))
    parts.push(panel(0, 0.85, 0, 3, 0.15, 4.6, ALLOY))
    parts.push(panel(0, -0.85, 0, 2.6, 0.12, 4.2, PANEL))
    for (const side of [-1, 1]) {
        parts.push(panel(side * 3.1, 0, 0, 3, 0.16, 0.22, ALLOY))
        parts.push(panel(side * 4.1, 0, 0, 2.2, 0.12, 6.2, PANEL))
        for (let i = -3; i <= 3; i++) parts.push(panel(side * 4.1, 0.08, i * 0.85, 2.05, 0.025, 0.045, accent, accent))
        parts.push(panel(side * 0.95, -0.08, -2.53, 0.5, 0.65, 0.08, accent, accent))
    }
    return parts
}

/** An asymmetric four-sector arena with an open central crossing and outer loop. */
export function arenaLayout(): Solid[] {
    const solids: Solid[] = []
    const add = (x: number, z: number, w: number, h: number, d: number, color: number, y = h / 2) => solids.push({ x, y, z, w, h, d, color })
    const teal = 0x287d85
    const coral = 0xb65339
    const violet = 0x6650a0
    const ivory = 0xb3c7c4
    // Low octagonal reactor dais: four broad approaches instead of a central block.
    add(0, -3, 10, 0.6, 8, teal)
    add(0, -3, 8, 0.9, 6, teal)
    add(0, 1.7, 6, 0.3, 1.4, ivory)
    add(0, -7.7, 6, 0.3, 1.4, ivory)
    add(-5.7, -3, 1.4, 0.3, 5, ivory)
    add(5.7, -3, 1.4, 0.3, 5, ivory)
    add(0, -3, 2.2, 2.5, 2.2, teal, 2.15)
    // West: terraced teal coolant deck, approached from south and east.
    add(-18, -12, 8, 2.4, 7, teal)
    for (let i = 0; i < 6; i++) add(-18, -5.2 - i * 0.6, 4.5, (i + 1) * 0.35, 0.6, i % 2 ? teal : ivory)
    for (let i = 0; i < 6; i++) add(-10.7 - i * 0.55, -12, 0.55, (i + 1) * 0.35, 3, i % 2 ? teal : ivory)
    add(-20.4, -13.5, 1.7, 2, 1.7, teal, 3.4)
    add(-15.6, -13.5, 1.7, 2, 1.7, teal, 3.4)
    // East: orange cargo yard. Deliberate gaps replace overlapping random crates.
    add(18, 11, 7, 0.6, 8, coral)
    add(18, 6.3, 4, 0.3, 1.4, ivory)
    for (const [x, z] of [[15.5, 10], [20.5, 13], [25, 5], [25, 7], [12, 21], [-10, 22], [-27, -22], [26, -22]]) {
        add(x!, z!, 1.5, 1.5, 1.5, coral)
        add(x! + 1.7, z!, 1.5, 1.5, 1.5, ivory)
    }
    add(20.5, 13, 1.5, 1.5, 1.5, coral, 2.85)
    add(25, 5, 1.5, 1.5, 1.5, teal, 2.25)
    // Cargo gantry: walkable clearance beneath the crossbar, solid supports.
    add(14.8, 15, 0.7, 6.5, 0.7, coral, 3.85)
    add(21.2, 15, 0.7, 6.5, 0.7, coral, 3.85)
    add(18, 15, 7.1, 0.7, 0.7, coral, 7)
    // North: elevated violet observation deck with two stair routes.
    add(13, -22, 9, 3.15, 5, violet)
    for (let i = 0; i < 8; i++) {
        add(9.8, -14.6 - i * 0.6, 2.4, (i + 1) * 0.35, 0.6, i % 2 ? violet : ivory)
        add(16.2, -14.6 - i * 0.6, 2.4, (i + 1) * 0.35, 0.6, i % 2 ? violet : ivory)
    }
    add(13, -23.7, 3.8, 0.8, 0.45, violet, 3.55)
    // South: split ivory maintenance platforms create a passage through the sector.
    add(-18, 20, 5, 1.2, 8, ivory)
    add(-10, 20, 5, 1.2, 5, teal)
    for (let i = 0; i < 3; i++) {
        add(-18, 14.9 + i * 0.6, 3.5, (i + 1) * 0.3, 0.6, teal)
        add(-10, 16.4 + i * 0.6, 3.5, (i + 1) * 0.3, 0.6, ivory)
    }
    // Staggered short cover breaks long sight lines while preserving escape routes.
    for (const [x, z, w, d, color] of [
        [-6, 10, 4, 0.8, teal], [6, 14, 0.8, 4, coral],
        [13, -3, 0.8, 4, violet], [-10, -22, 4, 0.8, teal],
        [-27, 6, 0.8, 4, teal], [27, -10, 0.8, 4, coral],
        [4, 27, 4, 0.8, ivory], [-3, -27, 4, 0.8, violet]
    ]) add(x!, z!, w!, 1.15, d!, color!)
    return solids
}

export function sectorLandmarks(): THREE.Group {
    const parts: VoxPart[] = []
    // Reactor cage: all large pieces fit inside its central solid volume.
    for (const side of [-1, 1]) {
        parts.push(panel(side * 1.03, 2.18, -3, 0.1, 2.4, 2.1, 0xb3c7c4))
        parts.push(panel(0, 2.18, -3 + side * 1.03, 2.1, 2.4, 0.1, 0xb3c7c4))
        parts.push(panel(side * 1.16, 2.18, -3, 0.045, 1.65, 0.65, LIGHT, LIGHT))
        parts.push(panel(0, 2.18, -3 + side * 1.16, 0.65, 1.65, 0.045, LIGHT, LIGHT))
        for (const y of [1.12, 1.5, 2.85, 3.24]) {
            parts.push(panel(side * 1.1, y, -3, 0.065, 0.09, 2.2, FRAME))
            parts.push(panel(0, y, -3 + side * 1.1, 2.2, 0.09, 0.065, FRAME))
        }
    }
    parts.push(panel(0, 3.42, -3, 2.1, 0.07, 2.1, ALLOY))
    // Concentric inlaid reactor service rings sit flush on the central deck.
    for (let i = 0; i < 48; i++) {
        const angle = i * Math.PI / 24
        const x = Math.cos(angle), z = Math.sin(angle)
        parts.push(panel(x * 2.4, 0.918, -3 + z * 2.4, 0.18, 0.018, 0.18, LIGHT, LIGHT))
        if (i % 3 === 0) parts.push(panel(x * 2.75, 0.918, -3 + z * 2.75, 0.13, 0.018, 0.13, AMBER))
    }
    // Broad illuminated panels establish landmarks even from the opposite sector.
    for (const x of [-20.4, -15.6]) {
        parts.push(panel(x, 3.5, -12.63, 0.7, 1.4, 0.035, LIGHT, LIGHT))
        for (let i = 0; i < 5; i++) parts.push(panel(x, 2.8 + i * 0.28, -12.59, 1.3, 0.08, 0.06, FRAME))
    }
    // Cargo crane crossbar and supports have matching solids in arenaLayout.
    for (const x of [14.8, 21.2]) {
        for (let i = 0; i < 5; i++) parts.push(panel(x, 1.4 + i * 1.1, 15.38, 0.4, 0.32, 0.04, AMBER))
        parts.push(panel(x, 6.4, 15.4, 0.32, 0.12, 0.04, LIGHT, LIGHT))
    }
    for (let i = 0; i < 10; i++) parts.push(panel(14.8 + i * 0.7, 7, 15.4, 0.2, 0.45, 0.035, AMBER))
    return architecturalModel(parts)
}
