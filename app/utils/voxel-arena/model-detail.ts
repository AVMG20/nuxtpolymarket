// Cosmetic assemblies only. Original model cores retain their animation anchors
// and combat/debris metadata; these small parts are batched by material and pivot.
import type { VoxPart } from './models'
import type { EnemyId, MeleeId, WeaponId } from './types'

const FRAME = 0x172332
const ALLOY = 0x71899b
const CERAMIC = 0xd5e4e8
const CYAN = 0x53e4ee
const AMBER = 0xf4b85b

export function panel(x: number, y: number, z: number, w: number, h: number, d: number, color = FRAME, emissive = 0): VoxPart {
    return { x, y, z, w, h, d, color, emissive, glow: emissive ? 0.65 : 0, detail: true }
}

/** Attach to the source pivot, including when several limbs share an animation. */
function mounted(p: VoxPart, source: VoxPart): VoxPart {
    return { ...p, name: source.name, pivot: source.pivot }
}

export function armorDetail(parts: VoxPart[], accent: number): VoxPart[] {
    const detail: VoxPart[] = []
    for (const p of parts) {
        if (p.emissive || p.w < 0.14 || p.h < 0.28 || p.d < 0.18) continue
        const front = p.z + p.d / 2
        // Leave visor and chest-core apertures open; armor must not hide role cues.
        if (p.name === 'head') {
            for (const side of [-1, 1]) {
                detail.push(mounted(panel(p.x + side * p.w * 0.43, p.y, front + 0.025, p.w * 0.1, p.h * 0.82, 0.055, ALLOY), p))
                detail.push(mounted(panel(p.x, p.y + side * p.h * 0.36, front + 0.02, p.w * 0.8, p.h * 0.12, 0.05, FRAME), p))
            }
        } else if (p.name === 'body') {
            for (const side of [-1, 1]) {
                detail.push(mounted(panel(p.x + side * p.w * 0.32, p.y, front + 0.02, p.w * 0.27, p.h * 0.8, 0.045, FRAME), p))
                detail.push(mounted({ ...panel(p.x + side * p.w * 0.32, p.y + p.h * 0.12, front + 0.045, p.w * 0.23, p.h * 0.48, 0.045, p.color), rotation: [0, 0, side * 0.12] }, p))
                for (let i = 0; i < 3; i++) detail.push(mounted(panel(p.x + side * p.w * 0.32, p.y - p.h * 0.15 - i * p.h * 0.075, front + 0.052, p.w * 0.2, p.h * 0.028, 0.035, ALLOY), p))
            }
        } else {
            detail.push(mounted(panel(p.x, p.y, front + 0.012, p.w * 0.84, p.h * 0.78, 0.035), p))
            detail.push(mounted(panel(p.x, p.y + p.h * 0.04, front + 0.035, p.w * 0.69, p.h * 0.58, 0.035, p.color), p))
        }
        if (p.name?.startsWith('leg') || p.name?.startsWith('arm')) {
            detail.push(mounted(panel(p.x, p.y - p.h * 0.18, front + 0.063, p.w * 0.68, 0.055, 0.035, ALLOY), p))
            detail.push(mounted(panel(p.x, p.y + p.h * 0.24, front + 0.06, p.w * 0.48, 0.026, 0.025, accent, accent), p))
        } else if (p.name === 'body' || p.name === 'head') {
            for (const side of [-1, 1]) {
                detail.push(mounted(panel(p.x + side * p.w * 0.32, p.y + p.h * 0.27, front + 0.05, 0.035, 0.035, 0.025, ALLOY), p))
                // Heat sinks on the rear silhouette.
                detail.push(mounted(panel(p.x + side * p.w * 0.33, p.y, p.z - p.d * 0.5 - 0.035, p.w * 0.18, p.h * 0.62, 0.09, FRAME), p))
            }
        }
    }
    return [...parts, ...detail]
}

const WEAPON_ACCENT: Record<WeaponId, number> = {
    pistol: CYAN, magnum: AMBER, smg: 0x7ceec2, rifle: AMBER, burst: CYAN,
    dmr: 0x9cbcff, shotgun: 0xff8c58, lmg: AMBER, saw: 0xa0db78,
    sniper: 0x9cbcff, flamer: 0xff8c58, launcher: 0xffb666, raygun: 0x87f56a, arc: 0xc398ff
}

export function firearmDetail(parts: VoxPart[], id: WeaponId): VoxPart[] {
    const accent = WEAPON_ACCENT[id]
    // Replace timber furniture with ceramic-composite shells.
    const timber = new Set([0x6b4a2a, 0x4a3220, 0x7a5a2a])
    const result: VoxPart[] = parts.map(p => ({ ...p, shape: p.d > 0.3 && p.w <= 0.12 && p.h <= 0.12 && p.z > 0.3 ? 'cylinder' : p.shape, color: timber.has(p.color) ? (id === 'rifle' ? 0x718783 : CERAMIC) : p.color }))
    const body = parts.find(p => p.z > 0 && p.y >= 0 && p.h >= 0.16)!
    const half = body.w / 2
    const length = body.d * 0.78
    for (const side of [-1, 1]) {
        result.push(panel(side * (half + 0.012), 0.035, body.z, 0.025, 0.135, length, FRAME))
        result.push(panel(side * (half + 0.029), 0.055, body.z - length * 0.15, 0.016, 0.085, length * 0.52, CERAMIC))
        result.push(panel(side * (half + 0.04), 0.061, body.z - length * 0.15, 0.008, 0.022, length * 0.3, accent, accent))
        // Fasteners, ejection recess, charge bars and side cooling louvers.
        for (let i = 0; i < 4; i++) {
            result.push(panel(side * (half + 0.027), 0.036, body.z + length * 0.22 + i * length * 0.065, 0.025, 0.08, 0.013, ALLOY))
            result.push(panel(side * (half + 0.042), -0.015, body.z - length * 0.35 + i * 0.028, 0.012, 0.018, 0.014, accent, accent))
        }
        for (const z of [body.z - length * 0.43, body.z + length * 0.43]) {
            result.push(panel(side * (half + 0.035), 0.075, z, 0.018, 0.024, 0.024, ALLOY))
        }
    }
    // Ribbed grip and trigger guard remain below the aiming line.
    for (let i = 0; i < 4; i++) result.push(panel(0, -0.12 - i * 0.046, -0.02, 0.128, 0.018, 0.15, FRAME))
    result.push(panel(0, -0.16, 0.13, 0.09, 0.025, 0.2, ALLOY))
    result.push(panel(0, -0.09, 0.23, 0.09, 0.14, 0.025, ALLOY))
    const end = Math.max(...parts.map(p => p.z + p.d / 2))
    const heavy = ['lmg', 'saw', 'flamer', 'launcher', 'arc', 'raygun'].includes(id)
    const radius = heavy ? 0.115 : 0.065
    // Four-sided muzzle collar leaves a genuinely recessed bore.
    for (const side of [-1, 1]) {
        result.push(panel(side * radius, 0.06, end - 0.03, 0.026, radius * 2.2, 0.12, ALLOY))
        result.push(panel(0, 0.06 + side * radius, end - 0.03, radius * 2.2, 0.026, 0.12, FRAME))
    }
    const emitter = ['raygun', 'arc', 'flamer'].includes(id)
    result.push(panel(0, 0.06, end + 0.004, radius * 1.35, radius * 1.35, 0.008, emitter ? accent : FRAME, emitter ? accent : 0))
    if (heavy) {
        for (let i = 0; i < 5; i++) {
            const z = end * 0.45 + i * end * 0.065
            result.push(panel(0, 0.06, z, radius * 2.1, 0.024, 0.025, accent, accent))
            for (const side of [-1, 1]) result.push(panel(side * radius, 0.04, z, 0.024, 0.18, 0.025, ALLOY))
        }
    } else {
        result.push(panel(0.105, 0.03, 0.26, 0.04, 0.075, 0.16, FRAME))
        result.push(panel(0.128, 0.03, 0.33, 0.016, 0.038, 0.018, accent, accent))
    }
    // A continuous receiver extension anchors the stock on all long guns.
    if (!['pistol', 'magnum', 'raygun'].includes(id)) {
        result.push(panel(0, 0.015, -0.33, 0.075, 0.09, 0.34, FRAME))
        result.push(panel(0, 0.025, -0.24, 0.12, 0.14, 0.09, ALLOY))
    }
    if (['sniper', 'lmg', 'saw'].includes(id)) {
        const z = id === 'saw' ? 1.1 : 1.2
        result.push(panel(0, -0.025, z, 0.17, 0.09, 0.1, FRAME))
        for (const side of [-1, 1]) result.push(panel(side * 0.06, -0.1, z, 0.04, 0.18, 0.05, ALLOY))
    }
    result.push(...weaponAssembly(id, accent))
    return result
}

export function bladeDetail(parts: VoxPart[], id: MeleeId): VoxPart[] {
    const accent = id === 'scythe' ? 0xc398ff : id === 'axe' ? 0xff8c58 : CYAN
    const result = parts.map(p => ({ ...p, color: [0x6b4a2a, 0x4a3220, 0x3a2a1a].includes(p.color) ? FRAME : p.color }))
    for (let i = 0; i < 6; i++) result.push(panel(0, 0, -0.3 + i * 0.048, 0.09, 0.09, 0.016, ALLOY))
    result.push(panel(0, 0, 0.055, 0.12, 0.12, 0.1, FRAME))
    for (const side of [-1, 1]) {
        result.push(panel(side * 0.075, 0, 0.055, 0.024, 0.065, 0.065, accent, accent))
    }
    // Inlaid conductive spine follows each blade's existing silhouette.
    for (const p of parts.filter(p => p.z > 0.1 && p.d > 0.4)) {
        result.push(panel(p.x + p.w / 2 + 0.004, p.y, p.z, 0.012, Math.min(0.032, p.h * 0.5), p.d * 0.82, accent, accent))
        for (let i = 0; i < 3; i++) result.push(panel(p.x, p.y - p.h / 2, p.z - p.d * 0.25 + i * p.d * 0.16, p.w + 0.018, 0.015, 0.025, FRAME))
    }
    return result
}

const ENEMY_ACCENT: Record<EnemyId, number> = {
    grunt: 0xff565e, runner: 0xffd46e, brute: 0xffb85c, titan: 0xff8d50,
    spitter: 0xf378db, drone: 0xffd46e, charger: 0xff8056,
    warden: CYAN, bomber: 0xff8056, mender: 0x7cf3b8
}

export function enemyDetail(parts: VoxPart[], id: EnemyId): VoxPart[] {
    const accent = ENEMY_ACCENT[id]
    const result = armorDetail(parts, accent)
    const body = parts.find(p => p.name === 'body')!
    const add = (p: VoxPart) => result.push(mounted(p, body))
    if (id === 'drone') {
        for (const x of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) {
            add(panel(x / 2, 0.5, z / 2, 0.5, 0.07, 0.08, ALLOY))
            for (const s of [-1, 1]) {
                add(panel(x + s * 0.19, 0.6, z, 0.04, 0.13, 0.42, CERAMIC))
                add(panel(x, 0.6, z + s * 0.19, 0.42, 0.13, 0.04, CERAMIC))
            }
            add(panel(x, 0.41, z, 0.17, 0.035, 0.17, accent, accent))
        }
    } else if (id === 'bomber' || id === 'spitter' || id === 'mender') {
        for (const side of [-1, 1]) {
            const x = side * body.w * 0.38
            const z = body.z - body.d / 2 - 0.12
            add(panel(x, 1.08, z, 0.2, 0.65, 0.22, FRAME))
            add(panel(x, 1.08, z - 0.12, 0.12, 0.44, 0.025, accent, accent))
            for (const y of [0.79, 1.08, 1.37]) add(panel(x, y, z, 0.24, 0.055, 0.26, ALLOY))
        }
        if (id === 'mender') {
            add(panel(0, 2.17, -0.12, 0.62, 0.06, 0.1, CERAMIC))
            for (const side of [-1, 1]) add(panel(side * 0.29, 2.02, -0.12, 0.055, 0.3, 0.1, accent, accent))
        }
    } else if (id === 'brute' || id === 'titan' || id === 'charger') {
        for (const side of [-1, 1]) {
            add(panel(side * body.w * 0.35, body.y + body.h * 0.48, -0.2, 0.25, 0.23, 0.6, ALLOY))
            for (let i = 0; i < 4; i++) add(panel(side * body.w * 0.38, body.y - 0.2 + i * 0.13, -body.d / 2 - 0.06, 0.22, 0.06, 0.18, FRAME))
        }
        if (id === 'titan') for (const side of [-1, 1]) {
            add(panel(side * 0.7, 1.9, -0.2, 0.36, 0.35, 0.55, FRAME))
            for (const x of [-0.08, 0.08]) add(panel(side * 0.7 + x, 1.91, 0.085, 0.07, 0.18, 0.025, accent, accent))
        }
    } else if (id === 'warden') {
        for (const side of [-1, 1]) {
            add(panel(-0.3 + side * 0.49, 1.05, 0.64, 0.085, 1.55, 0.08, CERAMIC))
            for (const y of [0.35, 1.75]) add(panel(-0.3 + side * 0.35, y, 0.65, 0.22, 0.07, 0.06, AMBER))
        }
    } else {
        for (const side of [-1, 1]) {
            add(panel(side * 0.2, 1.32, -0.28, 0.17, id === 'runner' ? 0.5 : 0.35, 0.2, FRAME))
            add(panel(side * 0.2, 1.1, -0.39, 0.1, 0.07, 0.025, accent, accent))
        }
    }
    return result
}

export function deviceDetail(parts: VoxPart[], accent: number): VoxPart[] {
    const result = [...parts]
    for (const p of parts) {
        if (p.emissive || Math.min(p.w, p.h, p.d) < 0.2) continue
        for (const side of [-1, 1]) {
            result.push(mounted(panel(p.x + side * p.w * 0.4, p.y, p.z + p.d / 2 + 0.012, p.w * 0.12, p.h * 0.85, 0.035, ALLOY), p))
        }
        result.push(mounted(panel(p.x, p.y - p.h * 0.25, p.z + p.d / 2 + 0.025, p.w * 0.45, Math.min(0.045, p.h * 0.1), 0.02, accent, accent), p))
    }
    return result
}

/** Bespoke assemblies give each weapon a recognizable mechanical silhouette. */
function weaponAssembly(id: WeaponId, accent: number): VoxPart[] {
    const parts: VoxPart[] = []
    const add = (p: VoxPart) => parts.push(p)
    const tube = (x: number, y: number, z: number, diameter: number, length: number, color: number, glow = false) => {
        add({ ...panel(x, y, z, diameter, diameter, length, color, glow ? color : 0), shape: 'cylinder' })
    }
    const ribbed = (x: number, y: number, start: number, count: number, spacing: number, diameter: number) => {
        for (let i = 0; i < count; i++) tube(x, y, start + i * spacing, diameter, spacing * 0.35, ALLOY)
    }
    const shell = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, tilt = 0) => {
        add({ ...panel(x, y, z, w, h, d, color), rotation: [0, 0, tilt] })
    }
    switch (id) {
        case 'pistol':
            for (const side of [-1, 1]) {
                shell(side * 0.074, 0.095, 0.16, 0.025, 0.095, 0.46, CERAMIC, side * 0.2)
                for (let i = 0; i < 5; i++) shell(side * 0.091, 0.105, -0.07 + i * 0.035, 0.013, 0.07, 0.013, FRAME, side * 0.2)
            }
            tube(0, 0, 0.49, 0.1, 0.14, ALLOY)
            add(panel(0, -0.08, 0.33, 0.115, 0.055, 0.15, FRAME))
            break
        case 'magnum':
            tube(0, 0.02, 0.06, 0.245, 0.235, FRAME)
            for (let i = 0; i < 6; i++) {
                const a = i * Math.PI / 3
                tube(Math.cos(a) * 0.1, 0.02 + Math.sin(a) * 0.1, 0.06, 0.056, 0.21, ALLOY)
            }
            for (const side of [-1, 1]) shell(side * 0.065, 0.085, 0.6, 0.03, 0.115, 0.62, CERAMIC, side * 0.18)
            ribbed(0, 0.06, 0.73, 4, 0.05, 0.135)
            break
        case 'smg':
            for (const side of [-1, 1]) {
                shell(side * 0.11, 0.035, 0.23, 0.045, 0.18, 0.52, 0x318b87, side * 0.15)
                add(panel(side * 0.08, -0.24, 0.16, 0.025, 0.32, 0.19, FRAME))
                add(panel(side * 0.07, 0.015, -0.44, 0.027, 0.04, 0.3, ALLOY))
            }
            ribbed(0, 0.06, 0.56, 4, 0.047, 0.115)
            break
        case 'rifle':
        case 'burst':
            for (const side of [-1, 1]) {
                shell(side * 0.085, 0.05, id === 'rifle' ? 0.68 : 0.55, 0.045, 0.16, 0.39, id === 'rifle' ? 0xc8904e : 0x4b8cba, side * 0.24)
                add(panel(side * 0.074, -0.255, 0.17, 0.026, 0.2, 0.18, ALLOY))
                for (let i = 0; i < 5; i++) add(panel(side * 0.111, 0.06, 0.46 + i * 0.052, 0.015, 0.09, 0.022, FRAME))
                add(panel(side * 0.075, -0.025, -0.48, 0.026, 0.065, 0.29, ALLOY))
            }
            add(panel(0, -0.015, -0.66, 0.18, 0.24, 0.07, FRAME))
            ribbed(0, 0.08, id === 'rifle' ? 1.06 : 0.86, 4, 0.047, 0.115)
            break
        case 'dmr':
        case 'sniper':
            for (const side of [-1, 1]) {
                shell(side * 0.11, 0.045, 0.6, 0.045, 0.18, 0.58, id === 'sniper' ? CERAMIC : 0x567fa3, side * 0.18)
                add(panel(side * 0.143, 0.055, 0.67, 0.012, 0.023, 0.31, accent, accent))
                shell(side * 0.075, -0.06, -0.58, 0.03, 0.12, 0.27, ALLOY, side * 0.15)
            }
            for (const side of [-1, 1]) for (let i = 0; i < 5; i++) add(panel(side * 0.142, 0.04, 0.38 + i * 0.057, 0.016, 0.065, 0.017, FRAME))
            ribbed(0, 0.08, 1.04, id === 'sniper' ? 7 : 4, 0.07, 0.1)
            if (id === 'sniper') {
                tube(0, 0.34, 0.09, 0.19, 0.52, FRAME)
                tube(0, 0.34, 0.36, 0.225, 0.07, ALLOY)
                tube(0, 0.34, 0.403, 0.16, 0.012, CYAN, true)
                add(panel(0.11, 0.34, -0.02, 0.09, 0.07, 0.07, ALLOY))
            }
            break
        case 'shotgun':
            tube(0, -0.03, 0.77, 0.14, 0.84, FRAME)
            for (const side of [-1, 1]) shell(side * 0.085, -0.025, 0.7, 0.045, 0.15, 0.34, 0xc56843, side * 0.2)
            ribbed(0, -0.02, 0.57, 6, 0.055, 0.19)
            for (let i = 0; i < 4; i++) {
                add({ ...panel(-0.1, 0, -0.035 + i * 0.072, 0.045, 0.045, 0.14, 0xc56843), shape: 'cylinder', rotation: [Math.PI / 2, 0, 0] })
                add(panel(-0.1, -0.072, -0.035 + i * 0.072, 0.05, 0.028, 0.05, AMBER))
            }
            break
        case 'lmg':
        case 'saw':
            for (const side of [-1, 1]) shell(side * 0.112, 0.02, 0.48, 0.06, 0.22, 0.55, id === 'lmg' ? 0xc29149 : 0x6a9272, side * 0.18)
            ribbed(0, 0.08, 0.79, 8, 0.069, 0.16)
            for (let i = 0; i < 6; i++) {
                add(panel(-0.16 - i * 0.035, -0.09 - i * 0.02, 0.17, 0.029, 0.035, 0.18, AMBER))
                add(panel(-0.16 - i * 0.035, -0.09 - i * 0.02, 0.28, 0.025, 0.03, 0.055, ALLOY))
            }
            add(panel(-0.23, -0.32, 0.17, 0.14, 0.22, 0.29, FRAME))
            break
        case 'flamer':
            for (const side of [-1, 1]) {
                tube(side * 0.135, -0.29, 0.13, 0.2, 0.51, 0xa3432b)
                ribbed(side * 0.135, -0.29, -0.07, 3, 0.2, 0.23)
                tube(side * 0.12, -0.1, 0.5, 0.045, 0.62, AMBER)
                shell(side * 0.11, 0.06, 0.82, 0.04, 0.19, 0.36, 0xc56843, side * 0.15)
            }
            ribbed(0, 0.06, 0.81, 5, 0.055, 0.23)
            break
        case 'launcher':
            tube(0, 0.04, 0.32, 0.44, 0.3, FRAME)
            for (let i = 0; i < 6; i++) {
                const a = i * Math.PI / 3
                tube(Math.cos(a) * 0.17, 0.04 + Math.sin(a) * 0.17, 0.33, 0.095, 0.24, 0xc29149)
                tube(Math.cos(a) * 0.17, 0.04 + Math.sin(a) * 0.17, 0.46, 0.064, 0.012, FRAME)
            }
            ribbed(0, 0.04, 0.66, 4, 0.06, 0.24)
            break
        case 'raygun':
        case 'arc':
            tube(0, 0.06, 0.5, 0.285, 0.31, FRAME)
            for (const side of [-1, 1]) {
                shell(side * 0.16, 0.06, 0.5, 0.06, 0.23, 0.39, id === 'raygun' ? 0xa84842 : 0x6a55a0, side * 0.28)
                tube(side * 0.12, 0.02, 0.22, 0.055, 0.28, accent, true)
                add(panel(side * 0.11, -0.095, 0.66, 0.045, 0.06, 0.28, ALLOY))
            }
            ribbed(0, 0.06, 0.4, 5, 0.058, 0.31)
            tube(0, 0.06, 0.77, 0.145, 0.19, accent, true)
            break
    }
    return parts
}
