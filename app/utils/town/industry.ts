// Polytown — workshops, extraction sites and storage. Each one owns its whole
// tile and keeps its identity at every stage: a farm is always a golden field,
// a lumber camp always a stand of pines, a quarry always a stone pit. Upgrades
// add sheds, silos, cranes and stock around that — never a different building.

import type { TownBuildingId } from '#shared/utils/gamelogic/town'
import {
    C, ball, barrel, box, bush, chimney, column, cone, coneRoof, crate, crystal, cyl, dome, doorAt, fence, flag, gableRoof, ground,
    hayBale, hipRoof, lantern, logPile, onFace, pineTree, plankStack, rock, roundTree, sack, shade, silo, windowRow,
    type ModelSpec, type Part, type Spinner
} from './kit'
import { HOUSE_Z, townhouse, townhouseWallHeight } from './homes'

type Factory = (stage: number, variant: number) => ModelSpec

// ─── Farm ────────────────────────────────────────────────────────────────────

const farm: Factory = (stage, variant) => {
    const spec: ModelSpec = { parts: [ground(C.soil, 0.03)] }
    const parts = spec.parts
    const wheat = [C.wheat, C.wheatLight, 0xe3b344][variant % 3]!
    // The yard grows along the back edge; everything else stays under crop.
    const yardX = [-0.14, 0.08, 0.3, 0.5, 0.5][stage]!
    const yardZ = stage === 4 ? -0.06 : stage === 0 ? -0.2 : -0.15
    for (let row = 0; row < 9; row++) {
        const z = -0.44 + row * 0.11
        const from = z < yardZ ? yardX : -0.48
        if (from > 0.4) continue
        const len = 0.48 - from
        const tone = row % 2 ? shade(wheat, -0.05) : wheat
        parts.push(box(from + len / 2, 0.03, z, len, 0.12 + (row % 3) * 0.012, 0.082, tone), box(from + len / 2, 0.15 + (row % 3) * 0.012, z, len, 0.025, 0.06, shade(wheat, 0.08)))
    }
    const barnRed = 0xb4412f
    if (stage === 0) {
        parts.push(box(-0.33, 0.03, -0.35, 0.26, 0.17, 0.24, C.wood), ...gableRoof(-0.33, 0.2, -0.35, 0.3, 0.28, 0.1, C.roofRed, 'x', C.wood), box(-0.33, 0.03, -0.225, 0.09, 0.12, 0.012, C.woodDark))
    } else {
        const bw = stage >= 3 ? 0.4 : 0.36
        const bh = 0.24 + stage * 0.025
        const bx = -0.48 + bw / 2 + 0.01
        parts.push(box(bx, 0.03, -0.32, bw, bh, 0.32, barnRed), ...gableRoof(bx, 0.03 + bh, -0.32, bw + 0.04, 0.35, 0.15, C.roofBrown, 'z', barnRed))
        parts.push(box(bx, 0.03, -0.155, 0.15, 0.17, 0.012, C.white), box(bx, 0.03, -0.15, 0.11, 0.15, 0.012, barnRed), box(bx, 0.03 + bh + 0.02, -0.155, 0.07, 0.06, 0.012, C.white))
        const silos = stage >= 4 ? 3 : stage >= 2 ? 2 : 1
        for (let i = 0; i < silos; i++) parts.push(...silo(bx + bw / 2 + 0.09 + i * 0.155, -0.37, 0.14, 0.3 + stage * 0.04 + (i % 2) * 0.05, C.metalLight, stage >= 4 ? C.gold : C.roofRed, 0.03))
    }
    if (stage >= 2) parts.push(...hayBale(0.36, 0.17, 0.41, 0.3), ...hayBale(0.2, 0.17, 0.41), ...fence(-0.48, 0.485, 0.48, 0.485))
    if (stage >= 3) {
        // The farmhouse stays a cottage: the field is the building.
        const floors = stage >= 4 ? 0.3 : 0.2
        parts.push(box(0.33, 0.03, -0.3, 0.28, floors, 0.3, C.cream), ...gableRoof(0.33, 0.03 + floors, -0.3, 0.32, 0.34, 0.12, C.roofRed, 'x', C.cream))
        parts.push(...onFace('front', 0.28, 0.3, [...windowRow(0.28, 0.08, 2, { lit: 0 }), ...(stage >= 4 ? windowRow(0.28, 0.2, 2, { lit: 1 }) : [])], 0.33, -0.3))
        chimney(spec, 0.4, 0.03 + floors + 0.04, -0.36, 0.14)
    }
    if (stage >= 4) {
        parts.push(box(-0.25, 0.03, 0.22, 0.02, 0.3, 0.02, C.woodDark), box(-0.25, 0.22, 0.22, 0.2, 0.02, 0.02, C.woodDark), ball(-0.25, 0.31, 0.22, 0.07, 0.07, C.hay, { seg: 6 }), cone(-0.25, 0.37, 0.22, 0.12, 0.05, C.woodDark, { seg: 8 }), box(-0.25, 0.2, 0.22, 0.09, 0.1, 0.04, C.roofBlue))
    }
    return spec
}

// ─── Lumber camp ─────────────────────────────────────────────────────────────

const lumber: Factory = (stage, variant) => {
    const spec: ModelSpec = { parts: [ground(0x5d8244)] }
    const parts = spec.parts
    const grown = 1 + stage * 0.03
    const stand: [number, number, number][] = [[-0.31, -0.3, 1.25], [-0.07, -0.32, 1.05], [0.16, -0.3, 1.3], [0.36, -0.33, 1], [-0.36, -0.06, 1], [-0.17, -0.1, 0.95], [0.35, -0.06, 1.1], [-0.37, 0.2, 0.95]]
    stand.forEach(([x, z, s], i) => {
        if (stage >= 3 && (i === 3 || i === 6)) return
        if (stage >= 1 && i === 5) return
        parts.push(...(i === 1 && variant % 2 ? roundTree(x, z, s * grown * 1.1, C.autumn, 0.02) : pineTree(x, z, s * grown, 0.02)))
    })
    // Felled ground at the front: stumps, chips and the stacked timber.
    for (const [x, z] of [[0.42, 0.4], [-0.2, 0.42], [0.12, 0.08]] as const) parts.push(cyl(x, 0.02, z, 0.08, 0.05, C.wood, { seg: 7 }), cyl(x, 0.07, z, 0.06, 0.006, C.woodLight, { seg: 7 }))
    parts.push(...logPile(0.1, 0.3, 0.4, Math.min(3, 1 + stage)))
    if (stage >= 1) {
        parts.push(...[[-0.3, -0.02], [-0.04, -0.02], [-0.3, 0.2], [-0.04, 0.2]].map(([x, z]) => box(x!, 0.02, z!, 0.03, 0.26, 0.03, C.woodDark)), box(-0.17, 0.27, 0.09, 0.34, 0.03, 0.3, C.roofBrown, { rotZ: 0.18 }), ...plankStack(-0.17, 0.09, 0.22, 2 + stage))
    }
    if (stage >= 2) parts.push(...logPile(0.22, 0.12, 0.3, 2), box(-0.18, 0.02, 0.38, 0.03, 0.09, 0.03, C.woodDark, { rotZ: 0.4 }), box(-0.1, 0.02, 0.38, 0.03, 0.09, 0.03, C.woodDark, { rotZ: -0.4 }), cyl(-0.14, 0.02, 0.38, 0.05, 0.2, C.wood, { rotZ: Math.PI / 2, seg: 6 }))
    if (stage >= 3) {
        const h = stage >= 4 ? 0.3 : 0.22
        parts.push(box(0.33, 0.02, -0.2, 0.3, h, 0.34, C.woodDark), ...Array.from({ length: Math.round(h / 0.05) }, (_, i) => box(0.33, 0.035 + i * 0.05, -0.2, 0.31, 0.012, 0.35, C.wood)), ...gableRoof(0.33, 0.02 + h, -0.2, 0.36, 0.4, 0.14, C.roofGreen, 'x', C.woodDark))
        parts.push(...onFace('front', 0.3, 0.34, [...doorAt(-0.07, 0.08, 0.14), ...windowRow(0.12, 0.08, 1, { w: 0.07, h: 0.08 }).map(p => ({ ...p, x: p.x + 0.08 }))], 0.33, -0.2))
        chimney(spec, 0.4, 0.02 + h + 0.04, -0.28, 0.16, C.stone)
    }
    if (stage >= 4) parts.push(...lantern(0.46, 0.2), ...logPile(-0.18, 0.44, 0.26, 1), ...crate(0.3, 0.02, 0.44))
    return spec
}

// ─── Quarry ──────────────────────────────────────────────────────────────────

const quarry: Factory = (stage, variant) => {
    const spec: ModelSpec = { parts: [ground(C.rockDark, 0.03)], spinners: [] }
    const parts = spec.parts
    const tone = [C.rock, 0x9a958a, 0x898d90][variant % 3]!
    // Benches step down from the back and sides into an open pit.
    parts.push(box(0, 0.03, -0.39, 1, 0.26, 0.22, tone), box(0, 0.03, -0.22, 1, 0.16, 0.14, shade(tone, 0.05)), box(0, 0.03, -0.1, 0.8, 0.08, 0.12, shade(tone, 0.09)))
    parts.push(box(-0.41, 0.03, 0.05, 0.18, 0.2, 0.7, shade(tone, -0.03)), box(-0.27, 0.03, 0.1, 0.12, 0.1, 0.6, shade(tone, 0.06)), box(0.42, 0.03, 0.02, 0.16, 0.17, 0.64, shade(tone, -0.05)), box(0.3, 0.03, 0.04, 0.1, 0.08, 0.5, shade(tone, 0.07)))
    parts.push(rock(-0.4, 0.2, -0.3, 0.2, 0.16, 0.18, C.rockLight, 0.5), rock(0.36, 0.26, -0.4, 0.24, 0.14, 0.2, C.rockLight, 1.2), rock(0.42, 0.17, 0.3, 0.14, 0.1, 0.12, C.rockDark, 0.3))
    // Dressed blocks waiting at the pit mouth.
    const blocks = 3 + stage * 2
    for (let i = 0; i < blocks; i++) parts.push(box(-0.1 + (i % 3) * 0.125, 0.03 + Math.floor(i / 3) * 0.085, 0.38, 0.11, 0.08, 0.13, i % 2 ? C.stoneLight : C.stone))
    if (stage >= 1) {
        const mast = 0.42 + stage * 0.06
        parts.push(box(0.12, 0.11, -0.12, 0.04, mast, 0.04, C.woodDark), box(0.12, 0.11 + mast - 0.05, 0.04, 0.035, 0.035, 0.42, C.wood, { rotX: -0.25 }), box(0.12, 0.11, -0.12, 0.12, 0.03, 0.12, C.wood))
        parts.push(box(0.12, 0.2, 0.21, 0.008, mast - 0.2, 0.008, C.iron), box(0.12, 0.14, 0.21, 0.09, 0.07, 0.09, C.stoneLight))
    }
    if (stage >= 2) {
        parts.push(box(-0.34, 0.29, -0.39, 0.24, 0.16, 0.18, C.stoneLight), ...gableRoof(-0.34, 0.45, -0.39, 0.28, 0.22, 0.09, C.roofDark, 'x', C.stoneLight), box(-0.34, 0.29, -0.297, 0.06, 0.11, 0.01, C.woodDark))
    }
    if (stage >= 3) {
        // Ore tubs on a short rail out of the pit.
        parts.push(box(-0.12, 0.03, 0.18, 0.02, 0.015, 0.5, C.iron), box(-0.04, 0.03, 0.18, 0.02, 0.015, 0.5, C.iron), ...[0, 1, 2, 3, 4].map(i => box(-0.08, 0.03, -0.04 + i * 0.11, 0.13, 0.01, 0.03, C.woodDark)), box(-0.08, 0.06, 0.12, 0.11, 0.07, 0.15, C.metal), box(-0.08, 0.13, 0.12, 0.09, 0.03, 0.12, C.stoneLight))
    }
    if (stage >= 4) {
        parts.push(box(0.3, 0.11, 0.2, 0.035, 0.4, 0.035, C.woodDark), box(0.3, 0.49, 0.06, 0.03, 0.03, 0.36, C.wood, { rotX: 0.2 }), ...lantern(-0.42, 0.44, 0.03), ...flag(0.12, 0.11 + 0.66, -0.12, C.roofRed, 0.12))
    }
    return spec
}

// ─── Mill ────────────────────────────────────────────────────────────────────

function sails(pivot: [number, number, number], span: number): Spinner {
    const parts: Part[] = [cyl(pivot[0], pivot[1] - 0.035, pivot[2] - 0.035, 0.07, 0.07, C.woodDark, { rotX: Math.PI / 2, seg: 8 })]
    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4
        const dx = -Math.sin(a), dy = Math.cos(a)
        const len = span / 2
        parts.push(box(pivot[0] + dx * len / 2, pivot[1] + dy * len / 2 - len / 2, pivot[2], 0.025, len, 0.02, C.woodDark, { rotZ: a }))
        parts.push(box(pivot[0] + dx * len * 0.6 + dy * 0.045, pivot[1] + dy * len * 0.6 - dx * 0.045 - len * 0.35, pivot[2] - 0.004, 0.085, len * 0.7, 0.008, C.bloomWhite, { rotZ: a }))
    }
    return { pivot, axis: 'z', rate: 1.6, parts }
}

const mill: Factory = (stage, variant) => {
    const spec: ModelSpec = { parts: [ground(C.cobble)] }
    const parts = spec.parts
    const base = 0.18 + stage * 0.035
    const tower = 0.5 + stage * 0.09
    const cap = [C.roofBlue, C.roofRed, C.roofBrown][variant % 3]!
    // A square granary fills the tile; the tower stands on it.
    parts.push(box(0, 0.02, 0, 0.96, base, 0.96, C.stoneLight), box(0, 0.02, 0, 0.98, 0.05, 0.98, C.stoneDark), box(0, 0.02 + base, 0, 1, 0.03, 1, C.stone), box(0, 0.05 + base, 0, 0.94, 0.025, 0.94, C.paving))
    parts.push(...onFace('front', 0.96, 0.96, [...doorAt(0.3, 0.11, Math.min(0.17, base - 0.02), C.woodDark, false), ...windowRow(0.5, 0.07, 2, { h: 0.08 }).map(p => ({ ...p, x: p.x - 0.17 }))]))
    for (const f of ['left', 'right', 'back'] as const) parts.push(...onFace(f, 0.96, 0.96, windowRow(0.96, 0.07, 3, { h: 0.08, sill: false, lit: 1 })))
    const y0 = 0.075 + base
    for (let i = 0; i < 4; i++) parts.push(cyl(0, y0 + i * tower / 4, 0, 0.6 - i * 0.04, tower / 4, i % 2 ? shade(C.white, -0.04) : C.white, { seg: 10 }))
    parts.push(...coneRoof(0, y0 + tower, 0, 0.56, 0.2, cap), ...onFace('front', 0.61, 0.61, windowRow(0.12, y0 + tower * 0.18, 1, { w: 0.07, h: 0.1 })))
    if (stage >= 2) parts.push(cyl(0, y0 + tower * 0.42, 0, 0.74, 0.02, C.wood, { seg: 10 }), cyl(0, y0 + tower * 0.42 + 0.06, 0, 0.74, 0.012, C.woodDark, { seg: 10 }))
    parts.push(sack(-0.38, 0.075 + base, 0.38), sack(-0.3, 0.075 + base, 0.4, C.cream), ...(stage >= 1 ? [sack(0.38, 0.075 + base, 0.38), ...barrel(0.38, 0.075 + base, -0.38)] : []))
    if (stage >= 3) parts.push(...crate(-0.38, 0.075 + base, -0.38), ...crate(-0.27, 0.075 + base, -0.4, 0.09), sack(0.3, 0.075 + base, 0.41, C.cream))
    if (stage >= 4) parts.push(...flag(0, y0 + tower + 0.2, 0, cap, 0.16))
    const hub = y0 + tower - 0.07
    const frontZ = 0.3 - 0.04 * 3 / 2 + 0.07
    spec.spinners = [sails([0, hub, frontZ], Math.min(0.94, 2 * (hub - y0 - 0.02)))]
    return spec
}

// ─── Sawmill ─────────────────────────────────────────────────────────────────

const sawmill: Factory = (stage, variant) => {
    const spec: ModelSpec = { parts: [ground(0xc7a46c)], spinners: [] }
    const parts = spec.parts
    const eave = 0.3 + stage * 0.05
    const roof = [C.roofBrown, C.roofGreen, 0x9c6a3c][variant % 3]!
    const shedW = stage >= 2 ? 0.66 : 0.58
    const sx = -0.49 + shedW / 2
    // Open-fronted cutting shed: back and left walls, posts along the front.
    parts.push(box(sx, 0.02, -0.46, shedW, eave, 0.05, C.wood), box(-0.465, 0.02, 0, 0.05, eave, 0.96, C.wood))
    for (let i = 0; i < 5; i++) parts.push(box(-0.49, 0.06 + i * eave / 5, 0, 0.012, 0.012, 0.97, C.woodDark))
    for (const z of [-0.2, 0.12, 0.44]) parts.push(box(sx + shedW / 2 - 0.03, 0.02, z, 0.045, eave, 0.045, C.woodDark))
    parts.push(...gableRoof(sx, 0.02 + eave, 0, shedW + 0.02, 1, 0.2, roof, 'z', C.wood))
    // Saw bench with a log on it; the blade turns while the mill is staffed.
    parts.push(box(sx + 0.02, 0.02, 0.1, 0.3, 0.1, 0.5, C.woodDark), cyl(sx + 0.02, 0.12 - 0.19, 0.2, 0.1, 0.38, C.wood, { rotX: Math.PI / 2, seg: 8 }), cyl(sx + 0.02, 0.17 - 0.003, 0.39, 0.075, 0.006, C.woodLight, { rotX: Math.PI / 2, seg: 8 }))
    const blades = stage >= 3 ? 2 : 1
    for (let i = 0; i < blades; i++) {
        const pivot: [number, number, number] = [sx + 0.02, 0.15, -0.08 - i * 0.2]
        spec.spinners!.push({ pivot, axis: 'z', parts: [cyl(pivot[0], pivot[1] - 0.006, pivot[2], 0.2, 0.012, C.metalLight, { rotX: Math.PI / 2, seg: 12 }), ...[0, 1, 2, 3].map(k => box(pivot[0], pivot[1] - 0.11, pivot[2], 0.03, 0.22, 0.014, C.metal, { rotZ: k * Math.PI / 4 }))] })
    }
    // The yard fills up with sawn stock and waiting logs.
    const yard = sx + shedW / 2 + (0.5 - sx - shedW / 2) / 2
    parts.push(...plankStack(yard, 0.34, 0.26, 3 + stage, 0.02, Math.PI / 2), ...plankStack(yard, -0.02, 0.26, 2 + stage, 0.02, Math.PI / 2), ...logPile(yard, -0.34, 0.28, Math.min(3, 1 + stage)))
    if (stage >= 1) parts.push(ball(sx + 0.2, 0.02, 0.4, 0.14, 0.07, C.woodLight, { seg: 6 }))
    if (stage >= 2) {
        parts.push(box(sx, 0.02, -0.33, shedW - 0.06, eave, 0.22, C.plank), ...onFace('front', shedW - 0.06, 0.22, windowRow(shedW - 0.1, 0.12, 3, { h: 0.09, lit: 1 }), sx, -0.33))
        chimney(spec, sx - 0.12, 0.02 + eave + 0.06, -0.36, 0.2, C.stone)
    }
    if (stage >= 4) parts.push(box(sx, 0.02 + eave + 0.2, 0, 0.2, 0.08, 0.7, C.wood), ...gableRoof(sx, 0.02 + eave + 0.28, 0, 0.26, 0.76, 0.08, roof, 'z'), ...flag(sx, 0.02 + eave + 0.36, 0.3, C.roofGreen, 0.14))
    return spec
}

// ─── Brick kiln ──────────────────────────────────────────────────────────────

function beehive(spec: ModelSpec, x: number, z: number, s: number) {
    spec.parts.push(
        cyl(x, 0.02, z, 0.46 * s, 0.16 * s, C.brick, { seg: 10 }), cyl(x, 0.02 + 0.16 * s, z, 0.48 * s, 0.02, C.brickDark, { seg: 10 }),
        dome(x, 0.04 + 0.16 * s, z, 0.46 * s, 0.26 * s, shade(C.brick, 0.04), { seg: 10 }),
        box(x, 0.02, z + 0.22 * s, 0.13 * s, 0.13 * s, 0.05, C.brickDark), box(x, 0.03, z + 0.235 * s + 0.012, 0.09 * s, 0.09 * s, 0.02, C.fire, { emissive: C.fire })
    )
    chimney(spec, x, 0.04 + 0.4 * s, z, 0.12 * s, C.brickDark, 0.08)
}

const kiln: Factory = (stage) => {
    const spec: ModelSpec = { parts: [ground(0xb88962)] }
    const parts = spec.parts
    const kilns: [number, number, number][] = stage >= 4 ? [[-0.24, -0.22, 1.05], [0.24, -0.22, 1.05], [-0.24, 0.24, 0.9]] : stage >= 2 ? [[-0.24, -0.2, 1.05], [0.24, -0.2, 1]] : [[-0.18, -0.14, 1.05 + stage * 0.15]]
    for (const [x, z, s] of kilns) beehive(spec, x, z, s)
    // Pallets of fired brick and heaps of raw clay take the rest of the yard.
    const pallets: [number, number][] = stage >= 4 ? [[0.12, 0.36], [0.3, 0.36], [0.3, 0.16]] : stage >= 2 ? [[-0.32, 0.34], [-0.12, 0.34], [0.1, 0.34], [0.3, 0.34]] : [[0.3, 0.3], [0.3, 0.08], [0.32, -0.2], [-0.3, 0.36], [0.02, 0.36]]
    pallets.forEach(([x, z], i) => {
        parts.push(box(x, 0.02, z, 0.17, 0.02, 0.15, C.woodDark))
        for (let layer = 0; layer < 2 + (i + stage) % 3; layer++) parts.push(box(x, 0.04 + layer * 0.045, z, 0.15, 0.04, 0.13, layer % 2 ? C.brick : shade(C.brick, 0.06)))
    })
    parts.push(ball(stage >= 2 ? 0.42 : -0.4, 0.02, stage >= 4 ? -0.02 : 0.12, 0.16, 0.1, 0xa8714e, { seg: 6 }))
    if (stage >= 3) {
        const h = 0.62 + (stage - 3) * 0.14
        parts.push(box(0.4, 0.02, 0.4, 0.15, h, 0.15, C.brick), box(0.4, 0.02, 0.4, 0.18, 0.08, 0.18, C.brickDark), box(0.4, 0.02 + h, 0.4, 0.18, 0.03, 0.18, C.brickDark))
        ;(spec.smoke ??= []).push([0.4, 0.1 + h, 0.4])
    }
    return spec
}

// ─── Bakery ──────────────────────────────────────────────────────────────────

const bakery: Factory = (stage, variant) => {
    const floors = [1, 2, 2, 3, 4][stage]!
    const spec = townhouse({
        floors, wall: [0xf6d9a8, C.rose, C.cream][variant % 3]!, roof: C.roofGreen, shutters: C.shutterBrown,
        roofKind: 'gableX', doorSide: 1, shop: [0xd9483b, C.white], dressed: stage >= 3, chimneys: 1, chimneyColor: C.white, paving: C.paving
    })
    const top = 0.02 + townhouseWallHeight(floors)
    // A baker's sign and a fat oven flue mark it out from the houses beside it.
    spec.parts.push(box(0.455, top - 0.12, 0.45, 0.012, 0.012, 0.1, C.iron), cyl(0.455, top - 0.21, 0.47, 0.09, 0.012, C.gold, { rotZ: Math.PI / 2, seg: 10 }), cyl(0.455, top - 0.192, 0.47, 0.045, 0.016, C.woodDark, { rotZ: Math.PI / 2, seg: 8 }))
    spec.parts.push(box(-0.3, top + 0.02, HOUSE_Z - 0.2, 0.17, 0.3 + stage * 0.03, 0.17, C.white), box(-0.3, top + 0.32 + stage * 0.03, HOUSE_Z - 0.2, 0.2, 0.03, 0.2, C.brick))
    ;(spec.smoke ??= []).push([-0.3, top + 0.4 + stage * 0.03, HOUSE_Z - 0.2])
    if (stage >= 1) spec.parts.push(box(-0.12, 0.02, 0.46, 0.4, 0.06, 0.06, C.wood), ...[-0.24, -0.12, 0].map(x => ball(x, 0.08, 0.46, 0.08, 0.04, C.hay, { seg: 6 })))
    if (stage >= 2) spec.parts.push(...barrel(-0.43, 0.02, 0.45, 0.08), sack(-0.36, 0.02, 0.46))
    if (stage >= 4) spec.parts.push(...flag(0, top + 0.28, HOUSE_Z, 0xd9483b))
    return spec
}

// ─── Smithy ──────────────────────────────────────────────────────────────────

const smithy: Factory = (stage, variant) => {
    const spec: ModelSpec = { parts: [ground(C.stoneDark)] }
    const parts = spec.parts
    const wall = [0x7c8086, 0x8a8378, 0x6f767f][variant % 3]!
    const h = [0.3, 0.36, 0.52, 0.58, 0.74][stage]!
    const d = 0.76, cz = -0.11
    parts.push(box(0, 0.02, cz, 0.96, h, d, wall), box(0, 0.02, cz, 0.98, 0.06, d + 0.02, shade(wall, -0.12)))
    for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(x * 0.46, 0.02, cz + z * (d / 2 - 0.02), 0.06, h, 0.06, shade(wall, 0.1)))
    // The open forge: a dark arch with the fire behind it.
    parts.push(...onFace('front', 0.96, d, [box(-0.18, 0.02, 0.002, 0.4, 0.22, 0.02, C.iron), box(-0.18, 0.04, 0.008, 0.3, 0.13, 0.02, C.fire, { emissive: C.fire }), box(-0.18, 0.24, 0.012, 0.46, 0.035, 0.04, C.woodDark), ...doorAt(0.3, 0.11, 0.2)], 0, cz))
    for (const f of ['left', 'right', 'back'] as const) parts.push(...onFace(f, 0.96, d, windowRow(f === 'back' ? 0.96 : d, 0.12, 2, { h: 0.09, sill: false, lit: 1 }), 0, cz))
    if (h > 0.5) {
        parts.push(box(0, 0.3, cz, 0.98, 0.022, d + 0.02, shade(wall, -0.12)))
        for (const f of ['front', 'back', 'left', 'right'] as const) parts.push(...onFace(f, 0.96, d, windowRow(f === 'left' || f === 'right' ? d : 0.96, 0.37, f === 'front' ? 3 : 2, { h: 0.1, shutters: f === 'front' ? C.shutterBrown : undefined }), 0, cz))
    }
    parts.push(...gableRoof(0, 0.02 + h, cz, 1, d + 0.06, 0.24, C.roofDark, 'x', wall))
    // Forge flue: a heavy stone stack that outgrows the roof as the smithy does.
    const stack = 0.34 + stage * 0.07
    parts.push(box(-0.18, 0.02 + h, cz - 0.16, 0.2, stack, 0.2, C.stone), box(-0.18, 0.02 + h + stack, cz - 0.16, 0.24, 0.035, 0.24, C.stoneDark))
    ;(spec.smoke ??= []).push([-0.18, 0.1 + h + stack, cz - 0.16])
    // Working yard: anvil on its block, quench trough, stock.
    parts.push(cyl(-0.34, 0.02, 0.4, 0.09, 0.07, C.woodDark, { seg: 7 }), box(-0.34, 0.09, 0.4, 0.12, 0.035, 0.06, C.iron), box(-0.34, 0.125, 0.4, 0.16, 0.025, 0.05, C.iron))
    parts.push(box(0.02, 0.02, 0.42, 0.2, 0.06, 0.09, C.wood), box(0.02, 0.07, 0.42, 0.17, 0.012, 0.06, C.water, { flat: true }))
    if (stage >= 1) parts.push(...barrel(0.42, 0.02, 0.42, 0.09), box(0.24, 0.02, 0.42, 0.12, 0.04, 0.1, C.metalLight))
    if (stage >= 2) parts.push(box(0.24, 0.06, 0.42, 0.1, 0.035, 0.08, C.metal), ...lantern(-0.46, 0.46))
    if (stage >= 3) parts.push(...crate(-0.12, 0.02, 0.44, 0.09), box(0.34, 0.27, 0.32, 0.26, 0.02, 0.14, C.roofDark, { rotX: 0.3 }))
    if (stage >= 4) parts.push(...flag(0.3, 0.02 + h + 0.2, cz, C.fire, 0.18), box(0.3, 0.02 + h + 0.1, cz, 0.18, 0.12, 0.18, C.stone))
    return spec
}

// ─── Mines ───────────────────────────────────────────────────────────────────

function mound(parts: Part[], dark: number, light: number) {
    parts.push(
        rock(-0.03, -0.12, -0.07, 0.9, 0.85, 0.8, dark), rock(0.2, -0.1, -0.06, 0.55, 0.62, 0.66, light, 0.6), rock(-0.27, -0.08, 0.1, 0.42, 0.45, 0.5, light, 1.1),
        rock(0.05, 0.3, -0.24, 0.5, 0.32, 0.45, shade(light, 0.04), 0.3), rock(0.36, -0.04, 0.3, 0.24, 0.2, 0.3, dark, 0.8), rock(-0.4, -0.03, 0.38, 0.2, 0.16, 0.2, dark)
    )
}

function portal(parts: Part[], x: number, z: number, timber = C.wood) {
    parts.push(box(x, 0.02, z - 0.04, 0.24, 0.26, 0.1, 0x16161c), box(x - 0.13, 0.02, z, 0.05, 0.3, 0.07, timber), box(x + 0.13, 0.02, z, 0.05, 0.3, 0.07, timber), box(x, 0.3, z, 0.36, 0.055, 0.09, timber))
    // Rails and an ore tub run out to the tile edge.
    for (const dx of [-0.05, 0.05]) parts.push(box(x + dx, 0.02, (z + 0.5) / 2, 0.015, 0.014, 0.5 - z, C.iron))
    for (let tz = z + 0.04; tz < 0.49; tz += 0.07) parts.push(box(x, 0.02, tz, 0.17, 0.008, 0.025, C.woodDark))
}

function headframe(spec: ModelSpec, x: number, z: number, h: number, wheels: number) {
    for (const dx of [-0.1, 0.1]) for (const dz of [-0.08, 0.08]) spec.parts.push(box(x + dx, 0.02, z + dz, 0.03, h, 0.03, C.woodDark))
    for (let y = 0.14; y < h; y += 0.16) spec.parts.push(box(x, y, z + 0.08, 0.23, 0.02, 0.02, C.wood), box(x, y, z - 0.08, 0.23, 0.02, 0.02, C.wood))
    spec.parts.push(box(x, 0.02 + h, z, 0.28, 0.025, 0.22, C.wood), ...hipRoof(x, 0.02 + h + 0.12, z, 0.32, 0.26, 0.08, C.roofDark, 0.06))
    for (let i = 0; i < wheels; i++) {
        const pivot: [number, number, number] = [x + (wheels > 1 ? (i - 0.5) * 0.1 : 0), 0.02 + h + 0.075, z]
        ;(spec.spinners ??= []).push({ pivot, axis: 'x', parts: [cyl(pivot[0], pivot[1] - 0.008, pivot[2], 0.11, 0.016, C.metal, { rotZ: Math.PI / 2, seg: 10 }), ...[0, 1].map(k => box(pivot[0], pivot[1] - 0.05, pivot[2], 0.02, 0.1, 0.014, C.metalLight, { rotX: k * Math.PI / 2 }))] })
    }
}

const mine: Factory = (stage) => {
    const spec: ModelSpec = { parts: [ground(C.rockDark)] }
    const parts = spec.parts
    mound(parts, 0x62666e, 0x7d8188)
    portal(parts, 0.08, 0.27)
    const ore = 0x9c5a3c
    parts.push(box(0.08, 0.04, 0.41, 0.13, 0.07, 0.11, C.woodDark), box(0.08, 0.11, 0.41, 0.11, 0.03, 0.09, ore))
    for (let i = 0; i <= Math.min(3, stage); i++) parts.push(ball(-0.36 + i * 0.09, 0.02, 0.43 - (i % 2) * 0.07, 0.13, 0.08 + (i % 2) * 0.03, i % 2 ? shade(ore, -0.06) : ore, { seg: 6 }))
    parts.push(...[[-0.3, 0.3, -0.25], [0.12, 0.52, -0.22], [0.4, 0.34, -0.1]].map(([x, y, z]) => rock(x!, y!, z!, 0.1, 0.08, 0.09, ore, 0.7)))
    if (stage >= 1) headframe(spec, 0.34, 0.3, 0.42 + stage * 0.09, stage >= 4 ? 2 : stage >= 2 ? 1 : 0)
    if (stage >= 2) parts.push(...lantern(-0.12, 0.34))
    if (stage >= 3) {
        // Ore bin on stilts beside the rails.
        parts.push(...[[-0.4, 0.2], [-0.22, 0.2], [-0.4, 0.36], [-0.22, 0.36]].map(([x, z]) => box(x!, 0.02, z!, 0.03, 0.2, 0.03, C.woodDark)), box(-0.31, 0.22, 0.28, 0.24, 0.14, 0.22, C.wood), box(-0.31, 0.36, 0.28, 0.2, 0.03, 0.18, ore))
    }
    if (stage >= 4) parts.push(...flag(0.05, 0.6, -0.24, C.roofRed, 0.16), ...crate(0.44, 0.02, 0.06))
    return spec
}

const gemmine: Factory = (stage) => {
    const spec: ModelSpec = { parts: [ground(C.shadowRock)] }
    const parts = spec.parts
    mound(parts, C.shadowRock, 0x77748a)
    portal(parts, 0.06, 0.27, C.woodLight)
    parts.push(box(0.06, 0.305, 0.32, 0.1, 0.07, 0.02, C.iron), crystal(0.06, 0.31, 0.335, 0.045, 0.06, C.teal))
    parts.push(box(0.06, 0.04, 0.41, 0.13, 0.07, 0.11, C.woodDark), crystal(0.035, 0.1, 0.41, 0.06, 0.11, C.lilac, 0.2), crystal(0.09, 0.1, 0.42, 0.05, 0.09, C.teal, -0.3))
    // The seam shows more with every stage: bigger spires, more of them.
    const seam: [number, number, number, number, number, number][] = [
        [-0.22, 0.42, -0.2, 0.15, 0.36, 0.16], [-0.36, 0.26, 0.02, 0.11, 0.26, 0.4], [0.36, 0.26, -0.08, 0.1, 0.22, -0.25], [-0.32, 0.03, 0.34, 0.1, 0.22, 0.25],
        [-0.05, 0.5, -0.24, 0.1, 0.24, -0.2], [0.24, 0.44, -0.22, 0.12, 0.3, 0.1], [0.42, 0.03, 0.36, 0.08, 0.18, -0.2], [-0.42, 0.03, 0.44, 0.07, 0.14, 0.1],
        [0.1, 0.56, -0.12, 0.09, 0.22, 0.3], [-0.2, 0.03, 0.42, 0.08, 0.16, -0.3]
    ]
    const grow = 1 + stage * 0.12
    seam.slice(0, 4 + stage * 1.5).forEach(([x, y, z, w, h, tilt], i) => parts.push(crystal(x, y, z, w * grow, h * grow, [C.lilac, C.violet, C.teal][i % 3], tilt)))
    if (stage >= 1) {
        const deck = 0.34
        for (const x of [0.24, 0.44]) for (const z of [0.12, 0.4]) parts.push(box(x, 0.02, z, 0.03, deck + (stage >= 2 ? 0.24 : 0), 0.03, C.woodDark))
        parts.push(box(0.34, deck, 0.26, 0.26, 0.03, 0.34, C.woodLight), crystal(0.34, deck + 0.03, 0.22, 0.06, 0.1, C.lilac), ...crate(0.36, deck + 0.03, 0.34, 0.08))
        if (stage >= 2) parts.push(...hipRoof(0.34, deck + 0.24, 0.26, 0.34, 0.42, 0.1, C.roofGreen, 0.06))
    }
    if (stage >= 3) parts.push(...lantern(-0.12, 0.36), box(0.06, 0.36, 0.2, 0.04, 0.36, 0.04, C.woodDark), box(0.06, 0.7, 0.3, 0.05, 0.035, 0.26, C.gold), box(0.06, 0.5, 0.41, 0.008, 0.2, 0.008, C.iron), cyl(0.06, 0.44, 0.41, 0.08, 0.07, C.gold, { seg: 8 }))
    if (stage >= 4) parts.push(crystal(-0.2, 0.66, -0.18, 0.18, 0.44, C.lilac, 0.1), cyl(-0.2, 0.72, -0.18, 0.2, 0.03, C.gold, { seg: 6 }))
    return spec
}

// ─── Heavy industry ──────────────────────────────────────────────────────────

function stack(spec: ModelSpec, x: number, z: number, y: number, h: number, w: number, color: number, band = C.iron) {
    spec.parts.push(cyl(x, y, z, w, h, color, { seg: 9 }), cyl(x, y, z, w * 1.25, 0.06, shade(color, -0.1), { seg: 9 }), cyl(x, y + h * 0.6, z, w * 1.1, 0.025, band, { seg: 9 }), cyl(x, y + h - 0.03, z, w * 1.15, 0.03, band, { seg: 9 }))
    ;(spec.smoke ??= []).push([x, y + h + 0.04, z])
}

const foundry: Factory = (stage, variant) => {
    const spec: ModelSpec = { parts: [ground(0x5d5f61)] }
    const parts = spec.parts
    const wall = [0x9c3d2c, 0xa6492f, 0x8c3a33][variant % 3]!
    const h = 0.42 + stage * 0.08
    const d = 0.7, cz = -0.14
    parts.push(box(0, 0.02, cz, 0.96, h, d, wall), box(0, 0.02, cz, 0.98, 0.07, d + 0.02, C.brickDark), box(0, 0.02 + h - 0.03, cz, 0.98, 0.03, d + 0.02, C.brickDark))
    for (let i = 0; i < 5; i++) parts.push(box(-0.4 + i * 0.2, 0.02, cz + d / 2, 0.05, h, 0.03, C.brickDark))
    // A band of furnace-lit glazing instead of ordinary windows.
    parts.push(...onFace('front', 0.96, d, [box(0.1, 0.2, 0.004, 0.62, 0.09, 0.02, C.fire, { emissive: C.fire }), box(-0.34, 0.02, 0.006, 0.16, 0.2, 0.02, C.iron)], 0, cz))
    for (const f of ['left', 'right', 'back'] as const) parts.push(...onFace(f, 0.96, d, [box(0, 0.2, 0.004, (f === 'back' ? 0.96 : d) - 0.2, 0.08, 0.02, C.fire, { emissive: C.fire })], 0, cz))
    parts.push(...gableRoof(0, 0.02 + h, cz, 1, d + 0.04, 0.16, C.roofDark, 'x', wall), box(0, 0.02 + h + 0.13, cz, 0.7, 0.07, 0.16, wall), ...gableRoof(0, 0.02 + h + 0.2, cz, 0.76, 0.22, 0.06, C.roofDark, 'x'))
    const stacks = Math.min(4, 2 + Math.floor(stage / 2) + (stage >= 4 ? 1 : 0))
    for (let i = 0; i < stacks; i++) stack(spec, -0.36 + i * 0.24, cz - 0.2, 0.02 + h, 0.42 + stage * 0.07 + (i % 2) * 0.08, 0.1, C.brick)
    // Yard: ingots, a slag heap and the pouring ladle.
    for (let i = 0; i < 3 + stage; i++) parts.push(box(0.22 + (i % 2) * 0.13, 0.02 + Math.floor(i / 2) * 0.035, 0.4, 0.11, 0.03, 0.06, i % 3 ? C.metalLight : C.metal))
    parts.push(ball(-0.36, 0.02, 0.4, 0.2, 0.11, 0x3e4044, { seg: 6 }), cyl(-0.08, 0.02, 0.4, 0.12, 0.1, C.iron, { seg: 8 }), cyl(-0.08, 0.115, 0.4, 0.09, 0.008, C.fire, { seg: 8, emissive: C.fire }))
    if (stage >= 2) {
        // Blast furnace rising through the roofline.
        const fh = h + 0.3 + (stage - 2) * 0.1
        parts.push(cyl(0.3, 0.02, cz + 0.12, 0.26, fh, C.metal, { seg: 10 }), ...[0.3, 0.55, 0.8].map(t => cyl(0.3, 0.02 + fh * t, cz + 0.12, 0.28, 0.025, C.iron, { seg: 10 })), cone(0.3, 0.02 + fh, cz + 0.12, 0.26, 0.1, C.iron, { seg: 10 }), cyl(0.3, 0.02 + fh + 0.06, cz + 0.12, 0.08, 0.05, C.fire, { seg: 8, emissive: C.fire }))
    }
    if (stage >= 3) parts.push(box(0.05, 0.02 + h + 0.3, cz + 0.12, 0.5, 0.04, 0.04, C.metalLight), box(-0.2, 0.02 + h, cz + 0.12, 0.04, 0.32, 0.04, C.metalLight))
    return spec
}

const factory: Factory = (stage, variant) => {
    const spec: ModelSpec = { parts: [ground(C.stone)], spinners: [] }
    const parts = spec.parts
    const wall = [0x6d8aa3, 0x7f93a0, 0x5f7f96][variant % 3]!
    const floors = [1, 1, 2, 2, 3][stage]!
    const h = 0.3 + (floors - 1) * 0.22 + (stage % 2) * 0.06
    parts.push(box(0, 0.02, 0, 0.96, h, 0.96, wall), box(0, 0.02, 0, 0.98, 0.07, 0.98, shade(wall, -0.15)))
    for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(x * 0.46, 0.02, z * 0.46, 0.06, h, 0.06, shade(wall, -0.1)))
    parts.push(...onFace('front', 0.96, 0.96, [box(-0.24, 0.02, 0.004, 0.3, 0.21, 0.02, C.iron), ...[0.05, 0.1, 0.15].map(y => box(-0.24, y, 0.012, 0.28, 0.012, 0.012, C.metal)), ...doorAt(0.34, 0.1, 0.18, C.metal, false)]))
    for (let floor = 0; floor < floors; floor++) {
        const y = (floor ? 0.3 + (floor - 1) * 0.22 : 0) + 0.11
        for (const f of ['front', 'back', 'left', 'right'] as const) {
            if (f === 'front' && floor === 0) continue
            parts.push(...onFace(f, 0.96, 0.96, [box(0, y, 0.004, 0.74, 0.1, 0.02, 0xbfe3f5, { emissive: 0x5aa9d6 }), ...[-0.25, 0, 0.25].map(x => box(x, y, 0.01, 0.015, 0.1, 0.02, shade(wall, -0.15)))]))
        }
    }
    // Saw-tooth roof: each tooth steps up to a band of north-light glazing.
    const teeth = 3
    const top = 0.02 + h
    for (let i = 0; i < teeth; i++) {
        const z = -0.32 + i * 0.32
        for (let step = 0; step < 3; step++) parts.push(box(0, top + step * 0.04, z - step * 0.05, 0.98, 0.04, 0.32 - step * 0.1, step % 2 ? 0x46586a : 0x51657a))
        parts.push(box(0, top + 0.02, z + 0.158 - 0.1, 0.9, 0.09, 0.01, 0xbfe3f5, { emissive: 0x5aa9d6 }))
    }
    const stacks = Math.min(3, 1 + Math.floor((stage + 1) / 2))
    for (let i = 0; i < stacks; i++) stack(spec, 0.36 - i * 0.2, -0.38, top, 0.4 + stage * 0.06 + i * 0.07, 0.09, C.metalLight, C.roofRed)
    if (stage >= 1) parts.push(cyl(-0.3, top + 0.04, 0.3, 0.2, 0.18 + stage * 0.02, C.metalLight, { seg: 10 }), dome(-0.3, top + 0.22 + stage * 0.02, 0.3, 0.2, 0.06, C.metal, { seg: 10 }))
    if (stage >= 2) {
        const pivot: [number, number, number] = [0.3, top + 0.2, 0.3]
        parts.push(cyl(0.3, top + 0.08, 0.3, 0.16, 0.1, C.metal, { seg: 10 }))
        spec.spinners!.push({ pivot, axis: 'y', parts: [0, 1].map(k => box(pivot[0], pivot[1] - 0.006, pivot[2], 0.2, 0.012, 0.035, C.metalLight, { rotY: k * Math.PI / 2 })) })
    }
    if (stage >= 3) parts.push(box(0, top + 0.13, 0.3, 0.42, 0.035, 0.035, C.roofRed), cyl(-0.05, top + 0.04, -0.06, 0.12, 0.14, C.roofRed, { seg: 8 }))
    if (stage >= 4) parts.push(...flag(-0.3, top + 0.3, 0.3, C.roofBlue, 0.16))
    return spec
}

// ─── Warehouse ───────────────────────────────────────────────────────────────

const warehouse: Factory = (stage, variant) => {
    const spec: ModelSpec = { parts: [ground(C.cobble)] }
    const parts = spec.parts
    const timber = [0x8d99ae, 0x9aa38f, 0xa39684][variant % 3]!
    const h = 0.3 + stage * 0.11
    const d = 0.82, cz = -0.08
    parts.push(box(0, 0.02, cz, 0.96, 0.14, d, C.stone), box(0, 0.16, cz, 0.96, h - 0.14, d, timber))
    for (let i = 0; i < 7; i++) parts.push(box(-0.45 + i * 0.15, 0.16, cz + d / 2 + 0.004, 0.02, h - 0.14, 0.012, shade(timber, -0.14)), box(-0.45 + i * 0.15, 0.16, cz - d / 2 - 0.004, 0.02, h - 0.14, 0.012, shade(timber, -0.14)))
    parts.push(...onFace('front', 0.96, d, [box(0, 0.02, 0.004, 0.36, 0.24, 0.02, C.woodDark), box(0, 0.02, 0.014, 0.012, 0.24, 0.012, C.iron), box(0, 0.26, 0.012, 0.42, 0.03, 0.03, C.wood)], 0, cz))
    for (let y = 0.34; y < h - 0.04; y += 0.22) for (const f of ['front', 'back', 'left', 'right'] as const) parts.push(...onFace(f, 0.96, d, windowRow(f === 'left' || f === 'right' ? d : 0.96, y, 3, { h: 0.08, w: 0.09, sill: false }), 0, cz))
    parts.push(...gableRoof(0, 0.02 + h, cz, 1, d + 0.06, 0.2 + stage * 0.015, C.roofBrown, 'z', timber))
    // Goods pile up on the loading apron as storage grows.
    const stock = 3 + stage * 2
    for (let i = 0; i < stock; i++) {
        const col = i % 4, row = Math.floor(i / 4)
        const x = (col < 2 ? -0.42 + col * 0.12 : 0.3 + (col - 2) * 0.12)
        parts.push(...(i % 3 === 2 ? barrel(x, 0.02 + row * 0.11, 0.42, 0.09) : crate(x, 0.02 + row * 0.11, 0.42, 0.1, i % 2 ? C.plank : C.woodLight)))
    }
    if (stage >= 2) parts.push(box(0, 0.02 + h + 0.1, cz + d / 2 + 0.06, 0.04, 0.04, 0.2, C.woodDark), box(0, 0.02 + h - 0.04, cz + d / 2 + 0.14, 0.008, 0.14, 0.008, C.iron), ...crate(0, 0.02 + h - 0.13, cz + d / 2 + 0.14, 0.08))
    if (stage >= 3) parts.push(...lantern(-0.2, 0.46), ...lantern(0.2, 0.46))
    return spec
}

// ─── Emporium ────────────────────────────────────────────────────────────────

const emporium: Factory = (stage, variant) => {
    const spec: ModelSpec = { parts: [ground(C.paving)] }
    const parts = spec.parts
    const accent = [C.purple, 0x8a3fa0, 0x5f46b8][variant % 3]!
    const floors = 1 + Math.floor((stage + 1) / 2)
    const h = 0.34 + (floors - 1) * 0.24
    const d = 0.8, cz = -0.08
    parts.push(box(0, 0.02, 0, 1, 0.04, 1, C.stoneLight), box(0, 0.06, cz, 0.96, h, d, C.white), box(0, 0.06 + h - 0.05, cz, 1, 0.04, d + 0.04, C.gold), box(0, 0.06 + h - 0.01, cz, 0.97, 0.02, d + 0.01, C.stoneLight), box(0, 0.06, cz, 0.98, 0.05, d + 0.02, accent))
    for (let floor = 1; floor < floors; floor++) parts.push(box(0, 0.06 + 0.3 + (floor - 1) * 0.24, cz, 0.98, 0.025, d + 0.02, C.gold))
    // Colonnade, arched showcase windows and hanging banners.
    const colonnade = 0.3
    for (const x of [-0.42, -0.14, 0.14, 0.42]) parts.push(...column(x, 0.06, 0.4, colonnade, C.white, C.gold))
    parts.push(box(0, 0.06 + colonnade, 0.4, 0.96, 0.05, 0.12, C.white), box(0, 0.11 + colonnade, 0.4, 1, 0.025, 0.14, C.gold))
    parts.push(...onFace('front', 0.96, d, [...doorAt(0, 0.14, 0.2, accent), ...[-0.28, 0.28].map(x => box(x, 0.1, 0.004, 0.18, 0.16, 0.02, 0x7fd6d0, { emissive: 0x2f8f86 }))], 0, cz))
    for (let floor = 0; floor < floors; floor++) {
        const y = 0.06 + (floor ? 0.36 + (floor - 1) * 0.24 : 0.12)
        for (const f of ['back', 'left', 'right', ...(floor ? ['front' as const] : [])] as const) parts.push(...onFace(f, 0.96, d, windowRow(f === 'left' || f === 'right' ? d : 0.96, y, 3, { h: 0.12, shutters: f === 'front' ? accent : undefined, lit: floor }), 0, cz))
    }
    for (const x of [-0.28, 0.28]) parts.push(box(x, 0.06 + h - 0.26, cz + d / 2 + 0.015, 0.09, 0.2, 0.012, accent), box(x, 0.06 + h - 0.29, cz + d / 2 + 0.015, 0.05, 0.03, 0.012, C.gold))
    const top = 0.07 + h
    parts.push(cyl(0, top, cz, 0.5, 0.09, C.white, { seg: 12 }), cyl(0, top + 0.09, cz, 0.54, 0.025, C.gold, { seg: 12 }), dome(0, top + 0.115, cz, 0.5, 0.24 + stage * 0.015, C.gold, { seg: 12 }), cyl(0, top + 0.34 + stage * 0.015, cz, 0.06, 0.06, C.white, { seg: 8 }), cone(0, top + 0.4 + stage * 0.015, cz, 0.07, 0.12, 0xfff3b0, { seg: 6, emissive: 0xffe08a }))
    if (stage >= 2) for (const x of [-0.37, 0.37]) parts.push(cyl(x, top, cz - 0.27, 0.17, 0.14, C.white, { seg: 8 }), dome(x, top + 0.14, cz - 0.27, 0.19, 0.11, accent, { seg: 8 }), ball(x, top + 0.24, cz - 0.27, 0.035, 0.035, C.gold, { seg: 5 }))
    if (stage >= 4) for (const x of [-0.37, 0.37]) parts.push(cyl(x, top, cz + 0.27, 0.15, 0.1, C.white, { seg: 8 }), dome(x, top + 0.1, cz + 0.27, 0.17, 0.1, accent, { seg: 8 }), ...flag(x, top + 0.19, cz + 0.27, accent, 0.14))
    if (stage >= 1) parts.push(...bush(-0.44, 0.45, 0.1), ...bush(0.44, 0.45, 0.1))
    if (stage >= 3) parts.push(...lantern(-0.28, 0.47), ...lantern(0.28, 0.47))
    return spec
}

export const INDUSTRY_MODELS: Partial<Record<TownBuildingId, Factory>> = {
    farm, lumber, quarry, mill, sawmill, kiln, bakery, smithy, mine, gemmine, foundry, factory, warehouse, emporium
}
