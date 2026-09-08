import type { TownBuildingId } from '#shared/utils/gamelogic/town'
import type { Part } from './models'
import type { TownSurface } from './surfaces'

const stone = 0xc4bc9f
const dark = 0x635242
const shutter = 0x557f76
const brick = 0xb77659
const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, extra: Partial<Part> = {}): Part => ({ shape: 'box', x, y, z, w, h, d, color, ...extra })

function window(x: number, y: number, z: number): Part[] {
    return [
        box(x, y, z, 0.14, 0.17, 0.028, stone),
        box(x, y + 0.018, z + 0.019, 0.106, 0.13, 0.012, 0x64949a),
        box(x, y + 0.018, z + 0.028, 0.012, 0.13, 0.012, dark),
        box(x, y + 0.08, z + 0.028, 0.11, 0.012, 0.012, stone),
        box(x, y - 0.012, z, 0.19, 0.025, 0.07, stone)
    ]
}

function shutters(x: number, y: number, z: number): Part[] {
    return [-1, 1].flatMap(side => [
        box(x + side * 0.094, y, z, 0.047, 0.14, 0.024, shutter, { surface: 'timber' }),
        ...[0.015, 0.04, 0.065, 0.09, 0.115].map(dy => box(x + side * 0.094, y + dy, z + 0.016, 0.045, 0.008, 0.012, 0x7c9d8d))
    ])
}

/** Dress the final upgraded shell, so stone courses follow its actual height. */
export function enrichArchitecture(type: TownBuildingId, source: Part[]): Part[] {
    if (type === 'road') return source
    const wood = new Set([0xad7949, 0x5e3a1a, 0x79533b, 0xbb8a52, 0xbc6c25, 0x6f3f16])
    const masonry = new Set([0xb5462d, 0xc1440e, 0x7a1f1f, 0xba6851])
    const parts = source.map(p => {
        let surface: TownSurface | undefined
        if (!p.name) {
            if (p.shape === 'wedge') surface = 'roof'
            else if ((p.shape === 'box' || p.shape === 'cyl') && p.w > 0.09 && p.h > 0.05 && wood.has(p.color)) surface = 'timber'
            else if (p.w > 0.15 && p.h > 0.1 && masonry.has(p.color)) surface = 'brick'
            else if (p.shape === 'box' && p.w > 0.45 && p.h > 0.25 && p.d > 0.4) surface = 'plaster'
            else if (p.shape === 'cyl' && p.w > 0.35 && p.h > 0.35) surface = 'stone'
        }
        return surface ? { ...p, surface } : p
    })
    const shell = source.find(p => p.shape === 'box' && p.x === 0 && p.z === 0 && p.y === 0 && p.w > 0.45 && p.h > 0.25 && p.d > 0.4)
    if (shell) {
        const { w, h, d } = shell
        // Alternating corner blocks, projecting cornices and a finished rear facade.
        for (let row = 0; row < Math.floor(h / 0.065); row++) {
            for (const side of [-1, 1]) for (const end of [-1, 1]) {
                parts.push(box(side * (w / 2 - 0.017), 0.015 + row * 0.065, end * (d / 2 - 0.005), row % 2 ? 0.048 : 0.083, 0.052, row % 2 ? 0.083 : 0.048, row % 3 ? stone : 0xa99e86))
            }
        }
        parts.push(box(0, h - 0.025, 0, w + 0.047, 0.025, d + 0.047, stone))
        const floors = Math.max(1, Math.floor(h / 0.23))
        for (let floor = 0; floor < floors; floor++) {
            for (const x of [-w * 0.25, w * 0.25]) {
                parts.push(...window(x, 0.13 + floor * 0.23, d / 2 + 0.012).map(p => ({ ...p, x: -p.x, z: -p.z, rotY: Math.PI })))
            }
        }
        // Drainpipes and roof gutters add depth to the silhouette from above.
        for (const side of [-1, 1]) {
            parts.push(box(side * (w / 2 + 0.025), 0.02, -d / 2 - 0.026, 0.022, h - 0.02, 0.022, 0x6b766e))
            parts.push(box(side * (w / 2 + 0.03), h - 0.012, 0, 0.037, 0.025, d + 0.065, 0x6b766e))
        }
        if (type === 'house' || type === 'bakery') {
            for (const side of [-1, 1]) {
                for (const z of [-d * 0.22, d * 0.22]) {
                    parts.push(...shutters(0, h > 0.6 ? 0.16 : h * 0.38, w / 2 + 0.034).map(p => ({ ...p, x: side * p.z, z: z - side * p.x, rotY: side * Math.PI / 2 })))
                }
            }
        }
        if (type === 'house') {
            // Front door casing, fanlight and a small tiled porch on timber brackets.
            parts.push(box(-0.081, 0, 0.28, 0.023, 0.25, 0.035, stone), box(0.081, 0, 0.28, 0.023, 0.25, 0.035, stone), box(0, 0.242, 0.28, 0.19, 0.025, 0.035, stone))
            parts.push(box(0, 0.288, 0.318, 0.24, 0.028, 0.17, brick, { rotX: 0.2, surface: 'roof' }))
            for (const x of [-0.095, 0.095]) parts.push(box(x, 0.23, 0.29, 0.023, 0.065, 0.04, dark))
            // The chimney occupies +X/-Z; keep this dormer on the opposite
            // slope. Later stages already have dormers and corner towers.
            if (h < 0.6) {
                parts.push(box(-0.17, h + 0.105, 0.04, 0.16, 0.13, 0.15, stone))
                parts.push({ shape: 'pyramid', x: -0.17, y: h + 0.235, z: 0.04, w: 0.205, h: 0.085, d: 0.195, color: brick })
                parts.push(box(-0.255, h + 0.135, 0.04, 0.012, 0.075, 0.085, 0x64949a), box(-0.266, h + 0.135, 0.04, 0.012, 0.075, 0.009, stone))
            }
            // Timber gable bracing follows the raised roof after upgrades.
            parts.push(box(0, h + 0.04, 0.299, 0.025, 0.25, 0.024, dark))
            for (const side of [-1, 1]) parts.push(box(side * 0.12, h + 0.075, 0.299, 0.025, 0.21, 0.024, dark, { rotZ: side * 0.7 }))
        }
    }
    for (const vent of source.filter(p => p.name === 'smoke')) {
        for (let row = 0; row < 4; row++) {
            parts.push(box(vent.x, vent.y - 0.055 - row * 0.035, vent.z, 0.112, 0.012, 0.112, 0x8f978b))
        }
        parts.push(box(vent.x, vent.y + 0.014, vent.z, 0.13, 0.016, 0.13, 0x637478))
    }
    if (type === 'mine') {
        for (let i = 0; i < 5; i++) parts.push(box(0.1, 0.015, 0.24 + i * 0.055, 0.32, 0.02, 0.018, dark, { surface: 'timber' }))
        for (const x of [0.025, 0.175]) parts.push(box(x, 0.037, 0.36, 0.014, 0.013, 0.28, 0xa5aaa3))
    }
    if (type === 'quarry' || type === 'lumber') {
        for (let i = 0; i < 9; i++) parts.push({ shape: 'sphere', x: -0.34 + i * 0.075, y: 0.05, z: -0.02 + (i % 3) * 0.065, w: 0.035, h: 0.025, d: 0.04, color: type === 'quarry' ? stone : brick, seg: 5 })
    }
    if (type === 'farm') {
        // Individual leaves and broken earth between crop rows.
        for (let i = 0; i < 20; i++) {
            const x = (i % 5 - 2) * 0.16
            const z = (Math.floor(i / 5) - 1.5) * 0.2
            if (x < -0.15 && z < -0.2) continue
            parts.push(box(x + 0.035, 0.11, z, 0.014, 0.105, 0.035, 0xa9af5d, { rotZ: -0.65 }))
            parts.push(box(x - 0.035, 0.12, z, 0.014, 0.09, 0.035, 0xc6b567, { rotZ: 0.65 }))
        }
    }
    return parts
}
