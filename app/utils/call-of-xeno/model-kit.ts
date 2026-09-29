// Call of Xeno — tiny helpers shared by the mesh builders.

import * as THREE from 'three'

export function part(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }))
    mesh.position.set(x, y, z)
    return mesh
}
