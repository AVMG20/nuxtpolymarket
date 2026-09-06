import type { TownBuildingId } from '#shared/utils/gamelogic/town'
import type { Part } from './models'
import { townVisualLevel, townVisualStage } from './appearance'

// A miniature town grows from timber workshops into ornate civic landmarks.
// Keep doors at +Z and all additions inside the original model footprint.
const P = {
    stone: 0xb4bcb3, slate: 0x58777b, cream: 0xf1e3bd, timber: 0x79533b,
    oak: 0xbb8a52, copper: 0xb77b4c, brass: 0xe4b963, glass: 0x76babb,
    dark: 0x354e55, roof: 0x347b7c, leaf: 0x517f56, bloom: 0xdd9b9d,
    grain: 0xe7c779, brick: 0xba6851, light: 0xffd293
}
const b = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, extra: Partial<Part> = {}): Part => ({ shape: 'box', x, y, z, w, h, d, color, ...extra })
const c = (x: number, y: number, z: number, w: number, h: number, color: number, extra: Partial<Part> = {}): Part => ({ shape: 'cyl', x, y, z, w, h, d: w, color, seg: 12, ...extra })
const ball = (x: number, y: number, z: number, w: number, color: number, extra: Partial<Part> = {}): Part => ({ shape: 'sphere', x, y, z, w, h: w, d: w, color, seg: 8, ...extra })

function roof(x: number, y: number, z: number, w: number, h: number, d: number, color = P.roof): Part[] {
    return [
        b(x + w / 4, y, z, w / 2, h, d, color, { shape: 'wedge' }),
        b(x - w / 4, y, z, w / 2, h, d, color, { shape: 'wedge', rotY: Math.PI }),
        b(x, y + h, z, 0.024, 0.022, d + 0.015, P.brass),
        ...[-1, 1].flatMap(side => [0.25, 0.5, 0.75, 1].map(t => b(x + side * w / 2 * t, y + h * (1 - t), z, 0.014, 0.018, d, color === P.roof ? P.slate : P.copper)))
    ]
}

function window(x: number, y: number, z: number, w = 0.1, h = 0.14): Part[] {
    return [
        b(x, y, z, w + 0.035, h + 0.035, 0.026, P.cream),
        b(x, y + 0.015, z + 0.018, w, h, 0.015, P.glass),
        b(x, y + 0.015, z + 0.03, 0.012, h, 0.012, P.dark),
        b(x, y + h / 2, z + 0.03, w, 0.012, 0.012, P.dark),
        b(x, y - 0.012, z + 0.01, w + 0.055, 0.025, 0.065, P.stone)
    ]
}

function railing(x: number, y: number, z: number, w: number, d: number): Part[] {
    const parts = [b(x, y, z, w, 0.028, d, P.stone)]
    for (const side of [-1, 1]) {
        parts.push(b(x, y + 0.12, z + side * d / 2, w, 0.014, 0.015, P.brass))
        parts.push(b(x + side * w / 2, y + 0.12, z, 0.015, 0.014, d, P.brass))
        for (let i = 0; i < 5; i++) parts.push(b(x + (i / 4 - 0.5) * w, y + 0.015, z + side * d / 2, 0.012, 0.12, 0.012, P.dark))
    }
    return parts
}

function planter(x: number, y: number, z: number, color = P.bloom): Part[] {
    return [b(x, y, z, 0.12, 0.055, 0.075, P.copper), ...[-1, 0, 1].map(i => ball(x + i * 0.033, y + 0.045, z, 0.047, i === 0 ? color : P.leaf))]
}

function lantern(x: number, y: number, z: number): Part[] {
    return [c(x, y, z, 0.023, 0.27, P.dark), b(x, y + 0.25, z, 0.065, 0.025, 0.065, P.brass), b(x, y + 0.275, z, 0.045, 0.065, 0.045, P.light, { emissive: 0x9e6b25, name: 'glow' }), b(x, y + 0.34, z, 0.085, 0.055, 0.085, P.dark, { shape: 'pyramid' })]
}

function tank(x: number, y: number, z: number, w: number, h: number, color = P.copper): Part[] {
    return [c(x, y, z, w, h, color), ...[0, h * 0.24, h * 0.77, h].map(dy => c(x, y + dy, z, w + 0.014, 0.02, P.dark)), c(x, y + h + 0.02, z, w * 0.88, w * 0.3, P.brass, { shape: 'cone' })]
}

function cargo(x: number, y: number, z: number, w = 0.13): Part[] {
    return [b(x, y, z, w, w, w, P.oak), ...[-1, 1].map(side => b(x + side * w * 0.3, y, z, 0.015, w + 0.009, w + 0.009, P.timber)), b(x, y + w * 0.48, z + w / 2 + 0.006, w, 0.014, 0.014, P.cream)]
}

function tower(x: number, y: number, z: number, w: number, h: number, royal = false): Part[] {
    return [c(x, y, z, w, h, P.cream), c(x, y + h - 0.02, z, w + 0.045, 0.045, P.brass), c(x, y + h + 0.025, z, w + 0.075, 0.22, royal ? P.brass : P.roof, { shape: 'cone' }), c(x, y + h + 0.24, z, 0.017, 0.08, P.brass), ball(x, y + h + 0.31, z, 0.036, P.brass), ...window(x, y + h * 0.4, z + w / 2, w * 0.3, h * 0.27)]
}

function truss(x: number, y: number, z: number, w: number, h: number): Part[] {
    return [b(x - w / 2, y, z, 0.04, h, 0.04, P.dark), b(x + w / 2, y, z, 0.04, h, 0.04, P.dark), b(x, y + h, z, w + 0.09, 0.045, 0.06, P.brass), b(x, y + h / 2 - 0.015, z, Math.hypot(w, h * 0.75), 0.02, 0.025, P.copper, { rotZ: Math.atan2(h * 0.75, w) })]
}

// The wall is extended and its existing roof/chimney moves intact. Doors and
// ground props stay in place, keeping the street-facing entrance recognisable.
function raiseShell(parts: Part[], roofline: number, lift: number): Part[] {
    return parts.map(p => {
        if (p.y >= roofline - 0.006) return { ...p, y: p.y + lift }
        if (p.shape === 'box' && p.y === 0 && Math.abs(p.h - roofline) < 0.005 && p.w > 0.45 && p.d > 0.4) return { ...p, h: p.h + lift }
        return p
    })
}

const SHELLS: Partial<Record<TownBuildingId, [number, number, number]>> = {
    house: [0.6, 0.42, 0.5], warehouse: [0.82, 0.36, 0.62], sawmill: [0.8, 0.34, 0.5],
    bakery: [0.66, 0.44, 0.56], smithy: [0.7, 0.38, 0.56], foundry: [0.76, 0.6, 0.6],
    factory: [0.86, 0.5, 0.66], emporium: [0.8, 0.46, 0.66]
}

export function upgradeBuildingParts(type: TownBuildingId, requestedLevel: number, original: Part[]): Part[] {
    const level = townVisualLevel(requestedLevel)
    if (level === 1 || type === 'road') return original
    const stage = townVisualStage(level)
    const shell = SHELLS[type]
    const lift = shell ? stage * (type === 'house' || type === 'emporium' ? 0.19 : 0.13) : 0
    let parts = shell ? raiseShell(original, shell[1], lift) : [...original]
    if (type === 'emporium') parts = parts.map(p => p.shape === 'sphere' && p.w === 0.5 ? { ...p, y: p.y + lift } : p)
    const trim = stage >= 3 ? P.brass : stage >= 1 ? P.copper : P.stone

    if (shell) {
        const [w, y, d] = shell
        for (let floor = 0; floor < stage; floor++) {
            const fy = y + floor * lift / stage
            parts.push(b(0, fy - 0.02, 0, w + 0.032, 0.025, d + 0.032, trim))
            for (const x of [-w * 0.27, w * 0.27]) parts.push(...window(x, fy + 0.035, d / 2 + 0.025, 0.09, lift / stage - 0.065))
            for (const side of [-1, 1]) {
                for (const z of [-d * 0.24, d * 0.24]) {
                    parts.push(...window(0, fy + 0.035, w / 2 + 0.018, 0.085, lift / stage - 0.065).map(p => ({ ...p, x: side * p.z, z: z - side * p.x, rotY: side * Math.PI / 2 })))
                }
            }
        }
        if (stage >= 2) for (const x of [-w / 2, w / 2]) parts.push(b(x, 0.05, d / 2 + 0.012, 0.032, y + lift - 0.05, 0.035, trim))
    }

    // Small upgrades happen on every level, not just at the silhouette changes.
    // The dressing differs by trade: planters, stone courses, stock, machinery.
    const progress = level - 1
    if (type === 'house' || type === 'bakery' || type === 'emporium') {
        for (let i = 0; i < Math.min(progress, 4); i++) parts.push(...planter((i - 1.5) * 0.18, 0, -0.37))
        if (level >= 3) parts.push(...lantern(-0.37, 0, 0.31))
        if (level >= 4) parts.push(...lantern(0.37, 0, 0.31))
    } else if (type !== 'park' && type !== 'farm') {
        for (let i = 0; i < Math.min(progress, 6); i++) parts.push(...cargo((i % 3 - 1) * 0.145, Math.floor(i / 3) * 0.13, -0.38, 0.115))
    }
    // Individually installed cornice studs / paving inlays make levels within a
    // stage legible without numeric labels or constantly growing the footprint.
    for (let i = 0; i < progress; i++) {
        const side = i < 10 ? -1 : 1
        const z = -0.36 + (i % 10) * 0.075
        parts.push(b(side * 0.425, 0.045, z, 0.025, 0.025 + (i % 2) * 0.012, 0.035, trim))
    }

    switch (type) {
        case 'house': {
            const eave = 0.42 + lift
            if (stage >= 1) parts.push(...railing(0, 0.4, 0.33, 0.4, 0.15), ...roof(0, eave + 0.02, 0.2, 0.21, 0.12, 0.2, P.copper), ...window(0, eave + 0.015, 0.31, 0.075, 0.08))
            if (stage >= 2) parts.push(...tower(-0.23, eave - 0.1, -0.16, 0.22, 0.35))
            if (stage >= 3) parts.push(...railing(0, eave - 0.19, 0.33, 0.48, 0.16), ...planter(-0.16, eave - 0.15, 0.37), ...planter(0.16, eave - 0.15, 0.37))
            if (stage >= 4) parts.push(...tower(0.23, eave - 0.08, -0.16, 0.22, 0.4, true))
            break
        }
        case 'park': {
            // Open central paths become a pergola, pavilion and formal garden.
            for (let i = 0; i < Math.min(progress, 8); i++) parts.push(...planter((i % 4 - 1.5) * 0.19, 0.05, i < 4 ? 0.38 : -0.38, i % 2 ? P.grain : P.bloom))
            if (stage >= 1) {
                for (const x of [-0.13, 0.13]) for (const z of [-0.04, 0.22]) parts.push(b(x, 0.05, z, 0.027, 0.36, 0.027, P.cream))
                for (let i = 0; i < 5; i++) parts.push(b((i - 2) * 0.075, 0.41, 0.09, 0.035, 0.025, 0.38, P.timber))
            }
            if (stage >= 2) parts.push(...roof(0, 0.44, 0.09, 0.38, 0.2, 0.4), ...lantern(-0.32, 0.04, 0.22), ...lantern(0.32, 0.04, 0.22))
            if (stage >= 3) parts.push(c(0.3, 0.08, -0.3, 0.06, 0.17, P.cream), c(0.3, 0.25, -0.3, 0.15, 0.025, P.brass), ball(0.3, 0.28, -0.3, 0.07, P.glass))
            if (stage >= 4) parts.push(c(0, 0.64, 0.09, 0.08, 0.15, P.brass, { shape: 'cone' }), ...[-1, 1].flatMap(side => [b(side * 0.4, 0.05, 0, 0.06, 0.16, 0.5, P.leaf), ...planter(side * 0.4, 0.21, -0.12)]))
            break
        }
        case 'warehouse': {
            const top = 0.42 + lift
            if (stage >= 1) parts.push(b(0, 0.3, 0.37, 0.7, 0.04, 0.22, P.roof), ...[-1, 1].map(side => b(side * 0.32, 0.01, 0.44, 0.025, 0.29, 0.025, P.dark)))
            if (stage >= 2) parts.push(...railing(0, top, 0, 0.7, 0.51), ...cargo(-0.2, top + 0.03, 0.1), ...cargo(0, top + 0.03, 0.1), ...cargo(-0.2, top + 0.16, 0.1))
            if (stage >= 3) parts.push(...truss(0, top + 0.02, -0.14, 0.48, 0.34), b(0.14, top + 0.14, -0.14, 0.012, 0.2, 0.012, P.dark), ...cargo(0.14, top + 0.06, -0.14, 0.09))
            if (stage >= 4) parts.push(...tower(0.29, top, 0.16, 0.16, 0.23))
            break
        }
        case 'farm': {
            if (level >= 2) parts.push(...tank(0.32, 0.06, -0.3, 0.13, 0.2, P.oak))
            if (level >= 3) parts.push(b(0.41, 0.07, 0, 0.018, 0.015, 0.7, P.copper))
            if (level >= 4) parts.push(b(-0.41, 0.07, 0.15, 0.018, 0.015, 0.45, P.copper))
            if (stage >= 1) {
                // Replace the tiny shed and its intersecting rear crop row with a barn.
                parts = parts.filter(p => !(p.x < -0.15 && p.z < -0.2 && p.y > 0.05))
                parts.push(b(-0.26, 0.06, -0.28, 0.3, 0.32 + stage * 0.035, 0.26, P.brick), ...roof(-0.26, 0.38 + stage * 0.035, -0.28, 0.35, 0.17, 0.3), b(-0.26, 0.06, -0.14, 0.15, 0.23, 0.018, P.timber))
            }
            if (stage >= 2) parts.push(...tank(0.12, 0.06, -0.29, 0.2, 0.42 + (stage - 2) * 0.08, P.cream))
            if (stage >= 3) {
                parts.push(b(0.29, 0.07, 0.05, 0.21, 0.2, 0.34, P.glass), ...roof(0.29, 0.27, 0.05, 0.24, 0.12, 0.37, P.cream))
                for (const z of [-0.1, 0, 0.1, 0.2]) parts.push(b(0.4, 0.07, z, 0.016, 0.2, 0.015, P.cream))
            }
            if (stage >= 4) parts.push(...tank(-0.07, 0.06, -0.29, 0.15, 0.48, P.copper), c(-0.26, 0.6, -0.28, 0.02, 0.22, P.brass), b(-0.22, 0.75, -0.28, 0.1, 0.02, 0.025, P.brass))
            break
        }
        case 'lumber':
            if (stage >= 1) parts.push(...truss(-0.12, 0.01, 0.24, 0.4, 0.33), ...roof(-0.12, 0.37, 0.2, 0.5, 0.15, 0.32, P.copper))
            if (stage >= 2) parts.push(b(0.26, 0.01, 0.03, 0.26, 0.35, 0.27, P.oak), ...roof(0.26, 0.36, 0.03, 0.3, 0.16, 0.3), ...window(0.26, 0.12, 0.175, 0.085, 0.12))
            if (stage >= 3) parts.push(...truss(-0.12, 0.52, 0.2, 0.29, 0.21), b(-0.12, 0.55, 0.2, 0.018, 0.19, 0.018, P.dark))
            if (stage >= 4) parts.push(...tower(0.26, 0.45, 0.03, 0.18, 0.28))
            break
        case 'quarry':
            if (stage >= 1) parts.push(...truss(0, 0.05, -0.28, 0.68, 0.62), b(0, 0.33, -0.28, 0.012, 0.33, 0.012, P.dark))
            if (stage >= 2) parts.push(b(-0.25, 0.06, 0.12, 0.24, 0.27, 0.28, P.cream), ...roof(-0.25, 0.33, 0.12, 0.28, 0.12, 0.31), ...window(-0.25, 0.13, 0.27, 0.08, 0.1))
            if (stage >= 3) parts.push(b(0.24, 0.07, 0.14, 0.18, 0.13, 0.48, P.dark), ...[0, 1, 2, 3, 4, 5].map(i => b(0.24, 0.205, -0.07 + i * 0.077, 0.19, 0.012, 0.024, P.brass)))
            if (stage >= 4) parts.push(...truss(0, 0.7, -0.28, 0.5, 0.22), ...tank(0.26, 0.25, 0.03, 0.13, 0.22, P.slate))
            break
        case 'mill': {
            const extra = stage * 0.17
            parts = parts.map(p => {
                if (p.y >= 0.55) return { ...p, y: p.y + extra }
                if (p.shape === 'cyl' && p.h === 0.6) return { ...p, h: p.h + extra }
                return p
            })
            for (let floor = 0; floor < stage; floor++) parts.push(c(0, 0.58 + floor * 0.17, 0, 0.515, 0.025, trim), ...window(0, 0.61 + floor * 0.17, 0.253, 0.085, 0.09))
            if (stage >= 1) parts.push(...railing(0, 0.4, 0, 0.64, 0.58))
            if (stage >= 2) parts.push(...tank(-0.33, 0, -0.24, 0.18, 0.43, P.cream))
            if (stage >= 3) parts.push(...railing(0, 0.72, 0, 0.6, 0.56))
            if (stage >= 4) parts.push(...tank(0.33, 0, -0.24, 0.18, 0.5, P.copper), c(0, 0.86 + extra, 0, 0.018, 0.14, P.brass), ball(0, 1 + extra, 0, 0.045, P.brass))
            break
        }
        case 'sawmill': {
            const top = 0.58 + lift
            if (stage >= 1) parts.push(...railing(0, 0.03, 0.37, 0.68, 0.13))
            if (stage >= 2) parts.push(...tank(-0.26, top - 0.07, -0.14, 0.18, 0.21), ...truss(0.16, top - 0.04, 0, 0.23, 0.19))
            if (stage >= 3) parts.push(b(0.16, top + 0.15, 0, 0.035, 0.03, 0.46, P.brass), b(0.16, top - 0.04, 0.2, 0.014, 0.19, 0.014, P.dark))
            if (stage >= 4) parts.push(...tower(-0.27, top + 0.15, -0.14, 0.15, 0.22))
            break
        }
        case 'kiln':
            if (stage >= 1) parts.push(...tank(-0.28, 0.18, -0.22, 0.18, 0.4, P.brick), ...tank(0.28, 0.18, -0.22, 0.18, 0.4, P.brick))
            if (stage >= 2) parts.push(...truss(0, 0.18, 0.28, 0.56, 0.4), b(0, 0.6, 0, 0.67, 0.055, 0.66, P.dark))
            if (stage >= 3) parts.push(...tank(0, 0.67, -0.05, 0.22, 0.3, P.brick), b(0, 0.23, 0.36, 0.22, 0.018, 0.04, P.brass))
            if (stage >= 4) parts.push(...railing(0, 0.65, 0, 0.6, 0.57), ...tank(-0.24, 0.66, -0.2, 0.13, 0.42), ...tank(0.24, 0.66, -0.2, 0.13, 0.42))
            break
        case 'bakery': {
            const top = 0.66 + lift
            if (stage >= 1) parts.push(...railing(0, 0.43, 0.35, 0.51, 0.15), ...planter(-0.17, 0.46, 0.4), ...planter(0.17, 0.46, 0.4))
            if (stage >= 2) parts.push(...roof(0.1, top - 0.08, 0.15, 0.24, 0.13, 0.26, P.copper), ...window(0.1, top - 0.07, 0.29, 0.085, 0.1))
            if (stage >= 3) parts.push(...tower(0.23, top - 0.12, -0.16, 0.19, 0.25))
            if (stage >= 4) parts.push(...railing(0, 0.44 + lift - 0.13, 0.35, 0.56, 0.16), ...planter(0, 0.48 + lift - 0.13, 0.4, P.grain))
            break
        }
        case 'smithy': {
            const top = 0.6 + lift
            if (stage >= 1) parts.push(...truss(0.23, 0.02, 0.35, 0.27, 0.29), b(0.23, 0.31, 0.35, 0.34, 0.045, 0.21, P.dark))
            if (stage >= 2) parts.push(...tank(0.22, top - 0.06, -0.12, 0.2, 0.2), b(0.22, top + 0.14, 0.02, 0.035, 0.04, 0.3, P.copper))
            if (stage >= 3) parts.push(...railing(0, top + 0.04, 0, 0.55, 0.49))
            if (stage >= 4) parts.push(...truss(0.04, top + 0.1, 0.13, 0.35, 0.25), b(0.04, top + 0.35, 0.13, 0.24, 0.055, 0.13, P.brass))
            break
        }
        case 'mine':
            if (stage >= 1) parts.push(...truss(0.08, 0.08, 0.19, 0.45, 0.61), b(0.08, 0.67, 0.19, 0.08, 0.045, 0.12, P.brass))
            if (stage >= 2) parts.push(...railing(0.08, 0.69, 0.05, 0.5, 0.35), ...roof(0.08, 0.86, 0.03, 0.48, 0.17, 0.36))
            if (stage >= 3) parts.push(...tank(-0.31, 0.05, -0.12, 0.17, 0.44, P.copper), ...lantern(0.35, 0.02, 0.28))
            if (stage >= 4) parts.push(...truss(0.08, 1.03, 0.03, 0.25, 0.2), c(0.08, 1.15, 0.03, 0.17, 0.03, P.brass, { rotX: Math.PI / 2 }), b(0.08, 0.75, 0.14, 0.015, 0.42, 0.015, P.dark))
            break
        case 'foundry': {
            const top = 0.66 + lift
            if (stage >= 1) parts.push(...tank(0, top, 0, 0.25, 0.31, P.brick))
            if (stage >= 2) parts.push(...railing(0, top + 0.025, 0, 0.72, 0.56), b(0, top + 0.22, -0.15, 0.54, 0.045, 0.045, P.copper))
            if (stage >= 3) parts.push(...truss(0, top + 0.03, 0.22, 0.57, 0.5), b(0.13, top + 0.31, 0.22, 0.016, 0.21, 0.016, P.dark), c(0.13, top + 0.24, 0.22, 0.12, 0.09, P.brass))
            if (stage >= 4) parts.push(...tank(-0.27, top, 0.05, 0.15, 0.43), ...tank(0.27, top, 0.05, 0.15, 0.43))
            break
        }
        case 'factory': {
            const top = 0.68 + lift
            if (stage >= 1) parts.push(...tank(-0.26, top, 0.16, 0.18, 0.21, P.slate))
            if (stage >= 2) parts.push(...railing(0, top + 0.015, 0.05, 0.74, 0.48), ...tank(0.26, top, 0.16, 0.18, 0.29, P.slate))
            if (stage >= 3) parts.push(b(0, top + 0.03, 0.12, 0.26, 0.3, 0.23, P.cream), ...window(0, top + 0.13, 0.247, 0.15, 0.12), ...roof(0, top + 0.33, 0.12, 0.3, 0.13, 0.27))
            if (stage >= 4) parts.push(...truss(0, top + 0.46, 0.12, 0.23, 0.17), b(0, top + 0.64, 0.12, 0.39, 0.03, 0.035, P.brass))
            break
        }
        case 'emporium': {
            const top = 0.51 + lift
            if (stage >= 1) parts.push(...railing(0, 0.45, 0.36, 0.73, 0.13))
            if (stage >= 2) for (const x of [-0.31, 0.31]) parts.push(...tower(x, top, -0.2, 0.17, 0.26, true))
            if (stage >= 3) parts.push(...railing(0, top, 0.25, 0.72, 0.16), ...planter(-0.25, top + 0.03, 0.3), ...planter(0.25, top + 0.03, 0.3))
            if (stage >= 4) for (const x of [-0.31, 0.31]) parts.push(...tower(x, top, 0.2, 0.17, 0.23, true))
            break
        }
    }

    // Highest-level landmarks get a distinct enamel pennant and gold finial.
    if (level === 20) {
        const crown = parts.filter(p => !p.name && Math.abs(p.x) < 0.12 && Math.abs(p.z) < 0.2)
        const anchor = crown.reduce((highest, p) => p.y + p.h > highest.y + highest.h ? p : highest)
        const y = anchor.y + anchor.h
        parts.push(c(anchor.x, y, anchor.z, 0.014, 0.2, P.brass), b(anchor.x + 0.057, y + 0.1, anchor.z, 0.1, 0.07, 0.012, type === 'emporium' ? P.brass : P.roof), ball(anchor.x, y + 0.2, anchor.z, 0.028, P.brass))
    }
    return parts
}
