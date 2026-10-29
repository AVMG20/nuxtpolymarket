import * as THREE from 'three'
import type { Track } from '#shared/utils/nitro-rush/track'

/** What every part of the world is built with: the course, the group it joins, and ownership for disposal. */
export interface WorldKit {
    readonly track: Track
    readonly group: THREE.Group
    /** Registers something the world disposes with itself. */
    own<T extends { dispose(): void }>(x: T): T
    /** A mesh of an owned geometry, added to the world. */
    add(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh
    /** An owned instanced mesh of an owned geometry, added to the world. */
    instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number): THREE.InstancedMesh
}

export function worldKit(track: Track, group: THREE.Group, disposables: { dispose(): void }[]): WorldKit {
    const own = <T extends { dispose(): void }>(x: T) => {
        disposables.push(x)
        return x
    }
    return {
        track,
        group,
        own,
        add(geo, mat) {
            const m = new THREE.Mesh(own(geo), mat)
            group.add(m)
            return m
        },
        instanced(geo, mat, count) {
            const m = own(new THREE.InstancedMesh(own(geo), mat, count))
            group.add(m)
            return m
        }
    }
}
