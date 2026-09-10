import type { Part } from './models'

const C = { stone: 0xc9bea2, cream: 0xeee0be, dark: 0x52615e, copper: 0x4f9290, gold: 0xcaa45d, wine: 0x8c4c55, roof: 0x546975, leaf: 0x638458, wood: 0x917052 }
const b = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, extra: Partial<Part> = {}): Part => ({ shape: 'box', x, y, z, w, h, d, color, ...extra })
const c = (x: number, y: number, z: number, w: number, h: number, color: number, extra: Partial<Part> = {}): Part => ({ shape: 'cyl', x, y, z, w, h, d: w, color, seg: 16, ...extra })
const ball = (x: number, y: number, z: number, w: number, h: number, color: number): Part => ({ shape: 'sphere', x, y, z, w, h, d: w, color, seg: 10 })
function column(x: number, y: number, z: number, h: number): Part[] {
    return [c(x, y, z, 0.085, 0.03, C.stone), c(x, y + 0.03, z, 0.048, h - 0.06, C.cream), c(x, y + h - 0.03, z, 0.085, 0.03, C.gold)]
}
function arch(x: number, y: number, z: number, w: number, h: number): Part[] {
    const parts = [b(x, y, z, w, h - w / 2, 0.024, C.dark), c(x, y + h - w, z, w, 0.025, C.dark, { rotX: Math.PI / 2 })]
    for (const side of [-1, 1]) parts.push(b(x + side * (w / 2 + 0.009), y, z + 0.018, 0.018, h - w / 2, 0.026, C.cream))
    for (let i = 0; i < 9; i++) {
        const angle = i / 8 * Math.PI
        parts.push(b(x + Math.cos(angle) * (w / 2 + 0.01), y + h - w / 2 + Math.sin(angle) * (w / 2 + 0.01), z + 0.018, 0.032, 0.025, 0.03, i % 2 ? C.stone : C.cream, { rotZ: angle - Math.PI / 2 }))
    }
    return parts
}
function planter(x: number, z: number): Part[] {
    return [b(x, 0.045, z, 0.12, 0.055, 0.12, C.stone), ball(x, 0.08, z, 0.11, 0.08, C.leaf), ...[-1, 1].map(side => ball(x + side * 0.025, 0.14, z, 0.038, 0.035, 0xe6b09e))]
}
function lantern(x: number, z: number): Part[] {
    return [c(x, 0.05, z, 0.025, 0.25, C.dark), b(x, 0.3, z, 0.055, 0.07, 0.055, 0xffd999, { emissive: 0x9c682b, name: 'glow' }), { shape: 'hip', x, y: 0.37, z, w: 0.085, h: 0.04, d: 0.085, color: C.dark }]
}

function sign(x: number, y: number, z: number, color = 0x63918b): Part[] {
    return [b(x, y, z, 0.18, 0.105, 0.028, 0x92704d, { soft: true }), b(x, y + 0.013, z + 0.019, 0.154, 0.08, 0.009, color), ...[-1, 1].map(side => b(x + side * 0.067, y + 0.11, z, 0.012, 0.038, 0.012, 0x52605c))]
}

/** Civic landmarks have their own progression rather than industrial cargo upgrades. */
export function createCivicParts(type: 'bathhouse' | 'theatre' | 'park', level: number): Part[] {
    const stage = Math.floor((level - 1) / 4)
    const parts: Part[] = [b(0, 0, 0, 0.91, 0.045, 0.91, C.stone, { surface: 'stone' })]
    if (type === 'bathhouse') {
        const top = 0.42 + stage * 0.09
        parts.push(b(0, 0.045, -0.12, 0.67, top - 0.045, 0.49, C.cream, { surface: 'plaster' }), b(0, top, -0.12, 0.72, 0.035, 0.54, C.stone))
        parts.push(c(0, top + 0.035, -0.12, 0.43, 0.055, C.gold), ball(0, top + 0.04, -0.12, 0.43, 0.29, C.copper), c(0, top + 0.29, -0.12, 0.1, 0.05, C.cream), { shape: 'cone', x: 0, y: top + 0.34, z: -0.12, w: 0.15, h: 0.08, d: 0.15, color: C.copper })
        for (const x of [-0.25, 0, 0.25]) parts.push(...arch(x, 0.08, 0.134, 0.125, 0.25), ...column(x, 0.055, 0.21, top - 0.055))
        parts.push(b(0, top, 0.21, 0.68, 0.045, 0.11, C.cream))
        // Sunken courtyard pool with mosaic surround and a shallow entry stair.
        parts.push(b(0, 0.047, 0.32, 0.48, 0.015, 0.2, C.copper), b(0, 0.064, 0.32, 0.41, 0.008, 0.14, 0x4a9190, { surface: 'water' }))
        for (const x of [-0.25, 0.25]) parts.push(b(x, 0.06, 0.32, 0.03, 0.027, 0.24, C.cream))
        for (const z of [0.205, 0.435]) parts.push(b(0, 0.06, z, 0.52, 0.027, 0.025, C.cream))
        for (let i = 0; i < 10; i++) parts.push(b((i - 4.5) * 0.045, 0.088, 0.435, 0.019, 0.004, 0.018, i % 2 ? C.gold : C.copper))
        for (const side of [-1, 1]) {
            for (const z of [-0.27, -0.04]) parts.push(...arch(0, 0.12, 0.342, 0.12, 0.22).map(p => ({ ...p, x: side * p.z, z: z - side * p.x, rotY: side * Math.PI / 2, rotX: p.rotX })))
            parts.push(...planter(side * 0.37, 0.32))
        }
        // Low mosaic frieze and roof-edge ornaments frame the bathing courtyard.
        for (const x of [-0.29, -0.145, 0, 0.145, 0.29]) parts.push(b(x, top + 0.005, 0.245, 0.075, 0.038, 0.022, C.copper))
        for (const side of [-1, 1]) parts.push(c(side * 0.3, top + 0.035, 0.09, 0.035, 0.045, C.gold), ball(side * 0.3, top + 0.08, 0.09, 0.065, 0.065, C.cream))
        if (stage > 0) for (const x of [-0.25, 0.25]) parts.push(c(x, top + 0.04, -0.26, 0.12, 0.08, C.cream), ball(x, top + 0.11, -0.26, 0.14, 0.13, C.copper))
        // Copper dome seams and a ring of small glazed clerestory windows.
        for (let i = 0; i < 12; i++) {
            const a = i * Math.PI / 6
            parts.push(c(Math.cos(a) * 0.209, top + 0.14, -0.12 + Math.sin(a) * 0.209, 0.009, 0.045, 0xc1a16c))
        }
        for (const x of [-0.25, 0, 0.25]) parts.push(b(x, 0.35, 0.151, 0.075, 0.045, 0.009, 0x63918b))
    } else if (type === 'theatre') {
        const top = 0.57 + stage * 0.1
        parts.push(b(0, 0.045, -0.075, 0.74, top - 0.045, 0.57, C.wine, { surface: 'plaster' }), b(0, top, -0.075, 0.81, 0.045, 0.64, C.cream))
        parts.push({ shape: 'hip', x: 0, y: top + 0.045, z: -0.075, w: 0.79, h: 0.22, d: 0.61, color: C.roof }, b(0, top + 0.245, -0.075, 0.24, 0.028, 0.07, C.roof))
        parts.push({ shape: 'hip', x: 0, y: top + 0.025, z: 0.265, w: 0.8, h: 0.14, d: 0.1, color: C.cream }, b(0, top + 0.02, 0.265, 0.82, 0.027, 0.12, C.gold))
        for (let rib = 0; rib < 7; rib++) parts.push(b((rib - 3) * 0.093, top + 0.08, -0.075, 0.012, 0.014, 0.48, C.roof))
        for (const x of [-0.23, 0, 0.23]) parts.push(...arch(x, 0.09, 0.225, 0.125, 0.25))
        for (const x of [-0.34, -0.115, 0.115, 0.34]) parts.push(...column(x, 0.09, 0.285, top - 0.08))
        for (let i = 0; i < 3; i++) parts.push(b(0, 0.015 + i * 0.025, 0.395 - i * 0.032, 0.79 - i * 0.05, 0.025, 0.11, C.cream))
        parts.push(b(0, 0.385, 0.3, 0.76, 0.035, 0.18, C.wine), b(0, 0.37, 0.39, 0.76, 0.028, 0.022, C.gold))
        for (let i = 0; i < 13; i++) parts.push(ball((i - 6) * 0.055, 0.361, 0.408, 0.016, 0.016, 0xffdf9c))
        // A sculpted double-mask crest reads as theatre at map scale.
        for (const side of [-1, 1]) {
            parts.push(ball(side * 0.06, top - 0.13, 0.249, 0.09, 0.115, C.gold))
            for (const eye of [-1, 1]) parts.push(b(side * 0.06 + eye * 0.019, top - 0.065, 0.296, 0.014, 0.012, 0.008, C.dark))
            parts.push(b(side * 0.06, top - 0.09, 0.3, 0.029, 0.009, 0.008, C.dark, { rotZ: side * 0.25 }))
            for (const z of [-0.24, 0.04]) parts.push(b(side * 0.382, 0.17, z, 0.022, 0.24, 0.1, C.gold), b(side * 0.395, 0.19, z, 0.009, 0.19, 0.074, C.wine))
            parts.push(...lantern(side * 0.4, 0.33))
        }
        // Velvet banners and a raised pediment make the entrance a clear focal point.
        for (const side of [-1, 1]) {
            parts.push(b(side * 0.305, 0.36, 0.32, 0.065, 0.17, 0.016, C.wine), b(side * 0.305, 0.35, 0.332, 0.068, 0.018, 0.012, C.gold))
        }
        parts.push({ shape: 'hip', x: 0, y: top + 0.035, z: 0.27, w: 0.38, h: 0.2, d: 0.11, color: C.cream })
        if (stage > 0) for (const x of [-0.31, 0.31]) parts.push(c(x, top + 0.04, 0.21, 0.09, 0.15, C.gold), ball(x, top + 0.19, 0.21, 0.11, 0.1, C.cream))
        parts.push(...sign(-0.285, 0.17, 0.232, 0xb18c64), ...sign(0.285, 0.17, 0.232, 0x708e8a))
        for (const side of [-1, 1]) {
            parts.push(b(side * 0.285, 0.195, 0.254, 0.035, 0.04, 0.006, 0xeee1c4))
            parts.push(b(side * 0.31, 0.077, 0.403, 0.035, 0.015, 0.045, 0xc1a16c))
        }
    } else {
        parts.push(b(0, 0.045, 0, 0.87, 0.012, 0.87, 0x829564), b(0, 0.06, 0, 0.16, 0.009, 0.85, 0xcfc3a1), b(0, 0.06, 0, 0.85, 0.009, 0.14, 0xcfc3a1))
        parts.push(c(0, 0.07, 0, 0.34, 0.055, C.stone), c(0, 0.126, 0, 0.28, 0.008, 0x659b98, { surface: 'water' }), c(0, 0.135, 0, 0.06, 0.18, C.cream), c(0, 0.315, 0, 0.17, 0.025, C.stone), ball(0, 0.34, 0, 0.04, 0.08, 0xb9d8ca))
        for (const side of [-1, 1]) {
            parts.push(c(side * 0.28, 0.05, -0.28, 0.05, 0.22, C.wood))
            for (let i = 0; i < 7; i++) {
                const a = i * 2.4
                parts.push(ball(side * 0.28 + Math.cos(a) * 0.08, 0.2 + i % 3 * 0.045, -0.28 + Math.sin(a) * 0.065, 0.17, 0.17, i % 2 ? 0x91a46a : C.leaf))
            }
            for (const z of [0.23, 0.29, 0.35]) parts.push(b(side * 0.29, 0.14, z, 0.22, 0.02, 0.024, C.wood))
            for (const dx of [-0.075, 0.075]) parts.push(b(side * 0.29 + dx, 0.06, 0.29, 0.018, 0.08, 0.13, C.dark))
            parts.push(b(side * 0.29, 0.17, 0.37, 0.23, 0.075, 0.02, C.wood), ...planter(side * 0.37, 0.02))
        }
        if (stage > 0) {
            for (const x of [-0.16, 0.16]) parts.push(b(x, 0.06, -0.32, 0.025, 0.48, 0.025, C.cream))
            for (let i = 0; i < 7; i++) parts.push(b((i - 3) * 0.055, 0.54, -0.32, 0.024, 0.025, 0.23, C.wood))
        }
        // Low hedges frame the garden without hiding its fountain and benches.
        for (const side of [-1, 1]) for (let i = 0; i < 5; i++) parts.push({ shape: 'sphere', x: side * 0.414, y: 0.05, z: -0.34 + i * 0.1, w: 0.068, h: 0.075, d: 0.105, color: i % 2 ? 0x7b955f : 0x69835a, seg: 7 })
        for (const side of [-1, 1]) {
            parts.push(b(side * 0.26, 0.07, 0.04, 0.2, 0.03, 0.115, C.stone))
            for (let i = 0; i < 4; i++) parts.push(ball(side * 0.26 + (i - 1.5) * 0.044, 0.11, 0.04, 0.038, 0.05, i % 2 ? 0xe6b09e : C.gold))
        }
        if (stage > 1) parts.push(...lantern(-0.4, 0.36), ...lantern(0.4, 0.36))
    }
    // Each purchased level adds a visible garden or cornice ornament.
    for (let i = 0; i < level - 1; i++) {
        const x = (i % 7 - 3) * 0.11
        const z = -0.41 + Math.floor(i / 7) * 0.06
        parts.push(b(x, 0.05, z, 0.075, 0.035, 0.045, C.gold), ball(x, 0.085, z, 0.05, 0.04, i % 2 ? C.leaf : 0xdba59c))
    }
    return parts
}
