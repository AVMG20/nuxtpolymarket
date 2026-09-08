import * as THREE from 'three'
import { TOWN_FACING } from '#shared/utils/gamelogic/town'
import { townMaterial } from './models'
import { townSurfaceMaterial } from './surfaces'

const boxGeometry = new THREE.BoxGeometry(1, 1, 1)
/** Connected streets: asphalt, stone pavements, gutters and restrained markings. */
export function createRoadParts(connections: boolean[]): THREE.Group {
    const group = new THREE.Group()
    function slab(x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material) {
        const mesh = new THREE.Mesh(boxGeometry, material)
        mesh.position.set(x, y + h / 2, z)
        mesh.scale.set(w, h, d)
        mesh.receiveShadow = true
        group.add(mesh)
    }
    slab(0, 0, 0, 1, 0.035, 1, townSurfaceMaterial(0x606461, 'asphalt'))
    const degree = connections.filter(Boolean).length
    for (let i = 0; i < 4; i++) {
        const [dx, dz] = TOWN_FACING[i]!
        if (connections[i]) {
            if (degree < 3) slab(dx * 0.3, 0.036, dz * 0.3, dx ? 0.18 : 0.027, 0.003, dx ? 0.027 : 0.18, townMaterial(0xd0c8a9))
            else for (let stripe = 0; stripe < 5; stripe++) {
                const offset = (stripe - 2) * 0.09
                slab(dx * 0.36 + dz * offset, 0.036, dz * 0.36 + dx * offset, dx ? 0.095 : 0.045, 0.003, dx ? 0.045 : 0.095, townMaterial(0xd0c8a9))
            }
            continue
        }
        slab(dx * 0.365, 0.036, dz * 0.365, dx ? 0.028 : 1, 0.008, dx ? 1 : 0.028, townMaterial(0x474f4b))
        for (let block = 0; block < 7; block++) {
            const offset = (block - 3) / 7
            slab(dx * 0.435 + dz * offset, 0.037, dz * 0.435 + dx * offset, dx ? 0.13 : 1 / 7 - 0.006, 0.034, dx ? 1 / 7 - 0.006 : 0.13, townMaterial(block % 3 ? 0xbab59f : 0xa9a894))
        }
        // Storm drain inset in the gutter, away from the driving lanes.
        for (let slot = 0; slot < 4; slot++) {
            const offset = 0.15 + slot * 0.022
            slab(dx * 0.365 + dz * offset, 0.045, dz * 0.365 + dx * offset, dx ? 0.025 : 0.01, 0.004, dx ? 0.01 : 0.025, townMaterial(0x263b38))
        }
    }
    return group
}
