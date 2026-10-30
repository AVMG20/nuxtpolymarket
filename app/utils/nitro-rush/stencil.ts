import * as THREE from 'three'

/** The player's car marks its pixels with this, and ghosts never draw over them, so the real car always shows on top. */
const CAR_STENCIL = 1

/** Writes the car's mark wherever `m` draws. */
export function marksCar(m: THREE.Material) {
    m.stencilWrite = true
    m.stencilRef = CAR_STENCIL
    m.stencilFunc = THREE.AlwaysStencilFunc
    m.stencilZPass = THREE.ReplaceStencilOp
}

/** Keeps `m` off the car's mark; three only runs the stencil test with `stencilWrite` on, though this writes nothing. */
export function avoidsCar(m: THREE.Material) {
    m.stencilWrite = true
    m.stencilRef = CAR_STENCIL
    m.stencilFunc = THREE.NotEqualStencilFunc
}
