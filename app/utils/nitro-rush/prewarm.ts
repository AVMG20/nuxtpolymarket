import * as THREE from 'three'

type Prewarmable = Pick<THREE.WebGLRenderer, 'compile' | 'initTexture' | 'setRenderTarget'>

function eachTexture(material: THREE.Material, visit: (t: THREE.Texture) => void) {
    const uniforms = (material as THREE.ShaderMaterial).uniforms
    const values = [...Object.values(material), ...Object.values(uniforms ?? {}).map(u => u.value)]
    for (const v of values) {
        // A render target's texture has nothing to upload.
        if (v instanceof THREE.Texture && !v.isRenderTargetTexture) visit(v)
    }
}

/**
 * Builds every shader and uploads every texture the scene holds, hidden effects included, so nothing stalls the frame the camera first sees it.
 * Compiled under `target` because three keys programs on it: at the canvas it would build tone-mapped variants nothing draws with.
 */
export function prewarm(renderer: Prewarmable, scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(target)
    renderer.compile(scene, camera)
    renderer.setRenderTarget(null)
    const textures = new Set<THREE.Texture>()
    scene.traverse((o) => {
        const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
        for (const m of [material ?? []].flat()) eachTexture(m, t => textures.add(t))
    })
    for (const t of textures) renderer.initTexture(t)
}
