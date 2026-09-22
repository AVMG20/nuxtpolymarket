// Polytown — civic landmarks. Like everything else they own the whole tile: a
// park is lawn to the kerb, the bathhouse and theatre are full-width facades.

import type { TownBuildingId } from '#shared/utils/gamelogic/town'
import { C, ball, box, bush, column, cone, cyl, dome, doorAt, flag, flowerBed, gableRoof, ground, hipRoof, lantern, onFace, roundTree, tierRoof, windowRow, type ModelSpec, type Part } from './kit'

type Factory = (stage: number, variant: number) => ModelSpec

function bench(x: number, z: number, faceY = 0): Part[] {
    return [box(x, 0.06, z, 0.16, 0.015, 0.05, C.wood, { faceY }), box(x, 0.02, z, 0.14, 0.04, 0.03, C.iron, { faceY })]
}

const park: Factory = (stage, variant) => {
    const spec: ModelSpec = { parts: [ground(C.grass, 0.03)] }
    const parts = spec.parts
    parts.push(box(0, 0.03, 0, 0.14, 0.006, 1, C.paving, { flat: true }), box(0, 0.03, 0, 1, 0.006, 0.14, C.paving, { flat: true }), cyl(0, 0.03, 0, 0.44, 0.008, C.paving, { seg: 12, flat: true }))
    // Fountain at the crossing.
    parts.push(cyl(0, 0.035, 0, 0.3, 0.05, C.stoneLight, { seg: 12 }), cyl(0, 0.086, 0, 0.25, 0.004, C.water, { seg: 12, flat: true }), cyl(0, 0.085, 0, 0.05, 0.12 + stage * 0.03, C.stoneLight, { seg: 8 }), cyl(0, 0.2 + stage * 0.03, 0, 0.13, 0.015, C.stone, { seg: 10 }), ball(0, 0.215 + stage * 0.03, 0, 0.05, 0.07, 0xbfe6ec, { seg: 6 }))
    const crowns = [C.leaf, C.leafLight, C.leafDark, variant % 2 ? C.autumn : C.bloomPink]
    const corners: [number, number][] = [[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]]
    corners.forEach(([x, z], i) => {
        if (stage >= 2 && i === 1) return
        parts.push(...roundTree(x, z, 0.95 + ((i + variant) % 3) * 0.1 + stage * 0.05, crowns[(i + variant) % 4]!, 0.03))
    })
    parts.push(...bench(-0.17, 0.14, Math.PI / 2), ...bench(0.17, -0.14, Math.PI / 2))
    parts.push(...flowerBed(-0.3, 0.12, 0.26, 0.07, 0.03), ...flowerBed(0.3, -0.12, 0.26, 0.07, 0.03))
    if (stage >= 1) {
        // Clipped hedges to the kerb and more planting.
        for (const x of [-0.29, 0.29]) parts.push(box(x, 0.03, -0.47, 0.4, 0.07, 0.05, C.leafDark), box(x, 0.03, 0.47, 0.4, 0.07, 0.05, C.leafDark))
        for (const z of [-0.29, 0.29]) parts.push(box(-0.47, 0.03, z, 0.05, 0.07, 0.4, C.leafDark), box(0.47, 0.03, z, 0.05, 0.07, 0.4, C.leafDark))
        parts.push(...flowerBed(0.3, 0.12, 0.26, 0.07, 0.03), ...flowerBed(-0.3, -0.12, 0.26, 0.07, 0.03), ...lantern(0.12, 0.12, 0.03), ...lantern(-0.12, -0.12, 0.03))
    }
    if (stage >= 2) {
        // Bandstand in the far corner.
        parts.push(cyl(0.31, 0.03, -0.31, 0.3, 0.04, C.stoneLight, { seg: 8 }))
        for (let i = 0; i < 6; i++) parts.push(cyl(0.31 + Math.cos(i * Math.PI / 3) * 0.12, 0.07, -0.31 + Math.sin(i * Math.PI / 3) * 0.12, 0.02, 0.2, C.white, { seg: 5 }))
        parts.push(cone(0.31, 0.27, -0.31, 0.34, 0.13, C.roofGreen, { seg: 8 }), ball(0.31, 0.4, -0.31, 0.035, 0.035, C.gold, { seg: 5 }), ...bush(-0.12, 0.4, 0.1, C.leafLight, 0.03), ...bush(0.12, 0.4, 0.1, C.leafLight, 0.03))
    }
    return spec
}

const bathhouse: Factory = (stage) => {
    const spec: ModelSpec = { parts: [ground(C.paving)] }
    const parts = spec.parts
    const tile = tierRoof(stage)
    const h = 0.5 + stage * 0.13
    const d = 0.58, cz = -0.2
    parts.push(box(0, 0.02, 0, 1, 0.035, 1, C.stoneLight), box(0, 0.055, cz, 0.96, h, d, C.cream), box(0, 0.055 + h - 0.03, cz, 1, 0.04, d + 0.04, C.stoneLight))
    parts.push(cyl(0, 0.065 + h, cz, 0.54, 0.08, C.white, { seg: 12 }), dome(0, 0.145 + h, cz, 0.52, 0.28, tile, { seg: 12 }), ball(0, 0.41 + h, cz, 0.04, 0.06, C.gold, { seg: 6 }))
    for (const x of [-0.36, -0.12, 0.12, 0.36]) parts.push(...column(x, 0.055, 0.14, h - 0.03, C.white, C.stoneLight))
    parts.push(box(0, 0.055 + h - 0.06, 0.14, 0.92, 0.04, 0.1, C.white), ...onFace('front', 0.96, d, [...doorAt(0, 0.13, 0.22, tile), ...[-0.3, 0.3].map(x => box(x, 0.1, 0.004, 0.13, 0.2, 0.02, 0x7fd6d0, { emissive: 0x2f8f86 }))], 0, cz))
    for (const f of ['back', 'left', 'right'] as const) parts.push(...onFace(f, 0.96, d, windowRow(f === 'back' ? 0.96 : d, 0.15, f === 'back' ? 3 : 2, { h: 0.16, lit: 1 }), 0, cz))
    // Open-air pool across the front of the tile.
    parts.push(box(0, 0.055, 0.34, 0.84, 0.03, 0.26, C.stoneLight), box(0, 0.075, 0.34, 0.74, 0.012, 0.17, C.water, { flat: true }), box(0, 0.076, 0.34, 0.5, 0.012, 0.06, 0x7cc4d2, { flat: true }))
    for (const x of [-0.45, 0.45]) parts.push(...bush(x, 0.43, 0.09, C.leaf, 0.055))
    if (stage >= 1) {
        for (const x of [-0.34, 0.34]) parts.push(cyl(x, 0.065 + h, cz - 0.06, 0.2, 0.04, C.white, { seg: 8 }), dome(x, 0.105 + h, cz - 0.06, 0.19, 0.11, tile, { seg: 8 }), ball(x, 0.2 + h, cz - 0.06, 0.03, 0.04, C.gold, { seg: 5 }))
        parts.push(...lantern(-0.46, 0.2, 0.055), ...lantern(0.46, 0.2, 0.055), box(0, 0.085, 0.34, 0.05, 0.05, 0.05, C.white), ball(0, 0.135, 0.34, 0.04, 0.05, 0xbfe6ec, { seg: 5 }))
    }
    return spec
}

const theatre: Factory = (stage, variant) => {
    const spec: ModelSpec = { parts: [ground(C.paving)] }
    const parts = spec.parts
    const wall = [C.wine, 0x8a3d5e, 0xa34a3f][variant % 3]!
    const h = 0.72 + stage * 0.15
    const d = 0.78, cz = -0.1
    parts.push(box(0, 0.02, cz, 0.96, h, d, wall), box(0, 0.02, cz, 0.98, 0.06, d + 0.02, C.stoneLight), box(0, 0.02 + h - 0.04, cz, 1, 0.045, d + 0.04, C.gold))
    parts.push(...hipRoof(0, 0.025 + h, cz, 1, d + 0.04, 0.12, tierRoof(stage), 0.4))
    // Portico: steps, four columns and a gabled pediment.
    for (let i = 0; i < 3; i++) parts.push(box(0, 0.02 + i * 0.02, 0.41 - i * 0.025, 0.9 - i * 0.04, 0.02, 0.16, C.stoneLight))
    const porch = 0.5 + stage * 0.08
    for (const x of [-0.36, -0.12, 0.12, 0.36]) parts.push(...column(x, 0.08, 0.37, porch, C.white, C.gold))
    parts.push(box(0, 0.08 + porch, 0.35, 0.9, 0.05, 0.16, C.white), ...gableRoof(0, 0.13 + porch, 0.35, 0.94, 0.2, 0.13, tierRoof(stage), 'z', C.cream), ball(0, 0.15 + porch, 0.455, 0.08, 0.08, C.gold, { seg: 6 }))
    parts.push(...onFace('front', 0.96, d, [...[-0.24, 0, 0.24].map(x => box(x, 0.08, 0.004, 0.13, 0.22, 0.02, C.lit, { emissive: C.litGlow })), ...[-0.12, 0.12].map(x => box(x, 0.12, 0.008, 0.07, 0.2, 0.012, C.gold))], 0, cz))
    for (const f of ['back', 'left', 'right'] as const) parts.push(...onFace(f, 0.96, d, [...windowRow(f === 'back' ? 0.96 : d, 0.12, 3, { h: 0.18, lit: 1 }), ...windowRow(f === 'back' ? 0.96 : d, 0.38, 3, { h: 0.1 })], 0, cz))
    if (stage >= 1) {
        // Fly tower over the stage, and banners out front.
        parts.push(box(0, 0.025 + h, cz - 0.16, 0.6, 0.26, 0.4, wall), box(0, 0.285 + h, cz - 0.16, 0.64, 0.03, 0.44, C.gold), ...hipRoof(0, 0.315 + h, cz - 0.16, 0.64, 0.44, 0.1, tierRoof(stage), 0.16))
        for (const x of [-0.42, 0.38]) parts.push(...flag(x, 0.08, 0.45, wall, 0.4))
        parts.push(...lantern(-0.24, 0.47, 0.06), ...lantern(0.24, 0.47, 0.06))
    }
    return spec
}

export const CIVIC_MODELS: Partial<Record<TownBuildingId, Factory>> = { park, bathhouse, theatre }
