import type { Part } from './models'
import { townVisualStage } from './appearance'

// Amethyst grotto, oak pit props and a small brass-trimmed sorting works.
// Keep the entrance at +Z and the silhouette within a single town tile.
const P = { rock: 0x55566d, lightRock: 0x77748a, shadow: 0x393b50, oak: 0xbb8a52, wood: 0x79533b, iron: 0x354e55, brass: 0xe4b963, violet: 0x9864d9, lilac: 0xbe91ed, teal: 0x65c5bc }
const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, extra: Partial<Part> = {}): Part => ({ shape: 'box', x, y, z, w, h, d, color, ...extra })
const crystal = (x: number, y: number, z: number, w: number, h: number, color = P.violet, tilt = 0): Part => box(x, y, z, w, h, w, color, { shape: 'crystal', seg: 6, rotZ: tilt, rotY: 0.2, emissive: color === P.teal ? 0x08241f : 0x1c092e })
const rock = (x: number, y: number, z: number, w: number, h: number, d: number, color = P.rock): Part => box(x, y, z, w, h, d, color, { shape: 'sphere', seg: 5 })

export function createJewelMineParts(level = 1): Part[] {
    const stage = townVisualStage(level)
    const parts: Part[] = [
        rock(0, -0.07, 0, 0.96, 0.16, 0.91, P.shadow),
        // Separate shoulders and lintel leave a real recessed tunnel mouth.
        rock(-0.29, 0.01, -0.09, 0.39, 0.51, 0.62),
        rock(0.31, 0.01, -0.13, 0.32, 0.45, 0.55, P.lightRock),
        rock(0, 0.3, -0.16, 0.68, 0.29, 0.57, P.lightRock),
        rock(-0.1, 0.02, -0.31, 0.58, 0.49, 0.27),
        box(0.04, 0.03, 0.04, 0.3, 0.31, 0.02, 0x201c32),
        box(0.04, 0.045, 0.23, 0.27, 0.015, 0.42, P.shadow),
        box(0.04, 0.345, 0.22, 0.43, 0.075, 0.13, P.oak),
        box(0.04, 0.423, 0.22, 0.46, 0.018, 0.15, P.wood),
        // A jewel set in a brass plaque above the portal.
        box(0.04, 0.36, 0.291, 0.105, 0.085, 0.025, P.iron),
        crystal(0.04, 0.368, 0.312, 0.047, 0.069, P.teal),
        crystal(-0.22, 0.43, -0.19, 0.16, 0.4, P.lilac, 0.16),
        crystal(-0.36, 0.35, -0.12, 0.12, 0.29, P.violet, 0.4),
        crystal(-0.07, 0.48, -0.22, 0.1, 0.23, P.teal, -0.22),
        rock(-0.3, 0.025, 0.3, 0.29, 0.12, 0.25),
        crystal(-0.31, 0.07, 0.28, 0.115, 0.25, P.lilac, 0.25),
        crystal(-0.21, 0.055, 0.33, 0.085, 0.16, P.teal, -0.25),
        crystal(-0.39, 0.04, 0.34, 0.07, 0.13),
        crystal(0.36, 0.24, -0.09, 0.09, 0.19, P.teal, -0.25)
    ]
    for (const x of [-0.145, 0.225]) {
        parts.push(box(x, 0.025, 0.22, 0.065, 0.33, 0.1, P.oak))
        for (const y of [0.065, 0.28]) {
            parts.push(box(x, y, 0.22, 0.073, 0.032, 0.108, P.iron), box(x, y + 0.01, 0.28, 0.015, 0.015, 0.012, P.brass))
        }
    }
    // Ties, twin rails, and a four-wheeled ore tub with a visible crystal load.
    for (let i = 0; i < 6; i++) parts.push(box(0.04, 0.035, 0.12 + i * 0.066, 0.25, 0.023, 0.027, P.wood))
    for (const x of [-0.035, 0.115]) {
        parts.push(box(x, 0.058, 0.28, 0.016, 0.018, 0.4, P.iron))
        for (const z of [0.29, 0.405]) parts.push(box(x, 0.068, z, 0.064, 0.023, 0.064, P.iron, { shape: 'cyl', seg: 8, rotZ: Math.PI / 2 }))
    }
    parts.push(box(0.04, 0.098, 0.35, 0.19, 0.035, 0.18, P.wood))
    for (const x of [-0.055, 0.135]) parts.push(box(x, 0.12, 0.35, 0.025, 0.105, 0.2, P.iron), box(x, 0.222, 0.35, 0.035, 0.015, 0.21, P.brass))
    for (const z of [0.255, 0.445]) parts.push(box(0.04, 0.12, z, 0.21, 0.105, 0.018, P.wood), box(0.04, 0.2, z, 0.21, 0.018, 0.025, P.brass))
    parts.push(crystal(0.005, 0.16, 0.35, 0.085, 0.16, P.lilac, 0.2), crystal(0.083, 0.16, 0.37, 0.07, 0.12, P.teal, -0.3))
    // Warm lamp hanging from the right pit prop.
    parts.push(box(0.28, 0.33, 0.26, 0.09, 0.018, 0.025, P.iron), box(0.31, 0.25, 0.26, 0.013, 0.08, 0.013, P.iron), box(0.31, 0.185, 0.26, 0.05, 0.064, 0.045, 0xffd293, { emissive: 0x704019, name: 'glow' }))
    for (const y of [0.18, 0.25]) parts.push(box(0.31, y, 0.26, 0.069, 0.016, 0.064, P.brass))
    // Each level reveals another small pocket along the back of the seam.
    for (let i = 0; i < level - 1; i++) parts.push(crystal(-0.35 + (i % 7) * 0.1, 0.14 + Math.floor(i / 7) * 0.095, -0.35, 0.044, 0.08 + (i % 3) * 0.025, i % 3 === 0 ? P.teal : P.lilac))
    if (stage >= 1) {
        // Raised sorting deck and access ladder to the right of the grotto.
        for (const x of [0.19, 0.41]) for (const z of [-0.31, 0.02]) parts.push(box(x, 0.1, z, 0.034, 0.49, 0.034, P.wood))
        for (let i = 0; i < 6; i++) parts.push(box(0.3, 0.57, -0.3 + i * 0.062, 0.3, 0.035, 0.056, P.oak))
        for (const x of [0.27, 0.4]) parts.push(box(x, 0.04, 0.09, 0.018, 0.54, 0.021, P.wood))
        for (let i = 0; i < 7; i++) parts.push(box(0.335, 0.08 + i * 0.07, 0.095, 0.15, 0.016, 0.025, P.oak))
    }
    if (stage >= 2) {
        for (const x of [0.18, 0.42]) for (const z of [-0.32, 0.02]) parts.push(box(x, 0.6, z, 0.025, 0.26, 0.025, P.wood))
        parts.push(box(0.3, 0.84, -0.15, 0.36, 0.16, 0.46, P.teal, { shape: 'hip' }), box(0.3, 1, -0.15, 0.025, 0.04, 0.025, P.brass))
        for (const z of [-0.32, 0.02]) parts.push(box(0.3, 0.71, z, 0.25, 0.02, 0.022, P.brass))
    }
    if (stage >= 3) {
        // Brass winch over the entrance, with a hanging ore bucket.
        parts.push(box(0.07, 0.45, -0.03, 0.055, 0.5, 0.055, P.wood), box(0.07, 0.92, 0.1, 0.08, 0.045, 0.35, P.brass), box(0.07, 0.88, 0.23, 0.115, 0.035, 0.115, P.iron, { shape: 'cyl', rotX: Math.PI / 2 }), box(0.07, 0.59, 0.23, 0.012, 0.31, 0.012, P.iron), box(0.07, 0.53, 0.23, 0.105, 0.085, 0.105, P.brass, { shape: 'cyl', seg: 8 }))
    }
    if (stage >= 4) {
        parts.push(crystal(-0.23, 0.69, -0.2, 0.14, 0.34, P.lilac, 0.12), box(-0.23, 0.74, -0.2, 0.18, 0.035, 0.18, P.brass, { shape: 'cyl', seg: 6 }))
        for (const z of [-0.31, -0.19, -0.07]) parts.push(box(0.425, 0.6, z, 0.018, 0.16, 0.018, P.brass))
        parts.push(box(0.425, 0.76, -0.19, 0.023, 0.02, 0.28, P.brass))
    }
    return parts
}
