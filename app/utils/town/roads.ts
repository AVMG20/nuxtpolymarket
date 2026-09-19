import type * as THREE from 'three'
import { TOWN_FACING } from '#shared/utils/gamelogic/town'
import { buildTownModel } from './models'
import { box, shade, type Part } from './kit'

const SETTS = 0x5c605f
const KERB = 0xc9bfa4
const LINE = 0xe9e0c4

/** Connected streets: dark asphalt, sandstone pavements on the open sides, restrained markings. */
export function createRoadParts(connections: boolean[]): THREE.Group {
    const parts: Part[] = [box(0, 0, 0, 1, 0.035, 1, SETTS, { flat: true })]
    // Worn patches break up the flat colour without a texture.
    for (let i = 0; i < 7; i++) {
        const x = ((i * 37) % 17) / 17 * 0.6 - 0.3
        const z = ((i * 53) % 19) / 19 * 0.6 - 0.3
        parts.push(box(x, 0.035, z, 0.1 + (i % 3) * 0.04, 0.002, 0.07 + (i % 2) * 0.05, shade(SETTS, i % 2 ? 0.035 : -0.03), { flat: true }))
    }
    const degree = connections.filter(Boolean).length
    for (let i = 0; i < 4; i++) {
        const [dx, dz] = TOWN_FACING[i]!
        if (connections[i]) {
            if (degree < 3) parts.push(box(dx * 0.3, 0.036, dz * 0.3, dx ? 0.16 : 0.025, 0.003, dx ? 0.025 : 0.16, LINE, { flat: true }))
            else for (let stripe = 0; stripe < 5; stripe++) {
                const offset = (stripe - 2) * 0.09
                parts.push(box(dx * 0.36 + dz * offset, 0.036, dz * 0.36 + dx * offset, dx ? 0.095 : 0.045, 0.003, dx ? 0.045 : 0.095, LINE, { flat: true }))
            }
            continue
        }
        parts.push(box(dx * 0.36, 0.035, dz * 0.36, dx ? 0.025 : 1, 0.006, dx ? 1 : 0.025, shade(SETTS, -0.1), { flat: true }))
        for (let slab = 0; slab < 6; slab++) {
            const offset = (slab - 2.5) / 6
            parts.push(box(dx * 0.435 + dz * offset, 0.035, dz * 0.435 + dx * offset, dx ? 0.13 : 1 / 6 - 0.006, 0.03, dx ? 1 / 6 - 0.006 : 0.13, slab % 3 ? KERB : shade(KERB, -0.05), { flat: true }))
        }
    }
    const group = buildTownModel({ parts })
    group.traverse((o) => { o.castShadow = false })
    return group
}
