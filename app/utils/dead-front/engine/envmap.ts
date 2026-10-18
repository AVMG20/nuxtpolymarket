import * as THREE from 'three'

// A tiny procedural night environment, prefiltered with PMREM. Without an
// environment map every metallic surface (blued steel, brass, iron fittings)
// renders black: metals have no diffuse term and only reflect their
// surroundings. The env is a cool moonlit sky, a dark horizon, warm-dark mud
// below, a soft moon and a couple of warm lantern patches for highlights.

/** Direction of the moon in the env (matches the world's moonlight roughly). */
const MOON = new THREE.Vector3(-0.42, 0.6, 0.68).normalize()

export function createDfEnvMap(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
    const scene = new THREE.Scene()
    const disposables: { dispose(): void }[] = []

    // gradient dome
    const dome = new THREE.SphereGeometry(10, 32, 16)
    const pos = dome.getAttribute('position') as THREE.BufferAttribute
    const col = new Float32Array(pos.count * 3)
    const sky = new THREE.Color().setRGB(0.16, 0.2, 0.32)
    const horizon = new THREE.Color().setRGB(0.07, 0.075, 0.085)
    const ground = new THREE.Color().setRGB(0.045, 0.034, 0.026)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 10
        if (y >= 0) c.copy(horizon).lerp(sky, Math.min(1, y * 1.6))
        else c.copy(horizon).lerp(ground, Math.min(1, -y * 3))
        col[i * 3] = c.r
        col[i * 3 + 1] = c.g
        col[i * 3 + 2] = c.b
    }
    dome.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })
    scene.add(new THREE.Mesh(dome, domeMat))
    disposables.push(dome, domeMat)

    // soft emitters: the moon and warm lantern patches (they become the highlights on metal)
    const disc = new THREE.CircleGeometry(1, 24)
    disposables.push(disc)
    const emitter = (dir: THREE.Vector3, size: number, color: THREE.Color) => {
        const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false })
        disposables.push(m)
        const mesh = new THREE.Mesh(disc, m)
        mesh.position.copy(dir).normalize().multiplyScalar(8)
        mesh.lookAt(0, 0, 0)
        mesh.scale.setScalar(size)
        scene.add(mesh)
    }
    emitter(MOON, 1.1, new THREE.Color().setRGB(1.6, 1.9, 2.6))
    emitter(new THREE.Vector3(0.9, 0.35, -0.3), 1.6, new THREE.Color().setRGB(2.4, 1.3, 0.55))
    emitter(new THREE.Vector3(-0.8, 0.2, -0.6), 1.2, new THREE.Color().setRGB(1.5, 0.8, 0.35))

    const pmrem = new THREE.PMREMGenerator(renderer)
    const rt = pmrem.fromScene(scene, 0.03)
    pmrem.dispose()
    for (const d of disposables) d.dispose()
    return rt
}
