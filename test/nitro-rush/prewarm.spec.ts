import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { prewarm } from '../../app/utils/nitro-rush/prewarm'

function fakeRenderer(onCompile: () => void = () => {}) {
    return {
        setRenderTarget: vi.fn(),
        compile: vi.fn(() => {
            onCompile()
            return new Set<THREE.Material>()
        }),
        initTexture: vi.fn()
    } as unknown as THREE.WebGLRenderer
}

describe('prewarm', () => {
    const camera = new THREE.PerspectiveCamera()
    const target = new THREE.WebGLRenderTarget(1, 1)

    it('compiles for the scene target, then returns to the canvas', () => {
        const renderer = fakeRenderer()
        prewarm(renderer, new THREE.Scene(), camera, target)
        expect(vi.mocked(renderer.setRenderTarget).mock.calls).toEqual([[target], [null]])
        expect(vi.mocked(renderer.setRenderTarget).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(renderer.compile).mock.invocationCallOrder[0]!)
    })

    it('uploads material and uniform textures once each, hidden ones too, but not render targets', () => {
        const map = new THREE.Texture()
        const uniform = new THREE.Texture()
        const scene = new THREE.Scene()
        scene.add(new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ map })))
        scene.add(new THREE.Mesh(undefined, [new THREE.MeshBasicMaterial({ map })]))
        const hidden = new THREE.Mesh(undefined, new THREE.ShaderMaterial({ uniforms: { a: { value: uniform }, b: { value: target.texture }, c: { value: 1 } } }))
        hidden.visible = false
        scene.add(hidden)
        const renderer = fakeRenderer()
        prewarm(renderer, scene, camera, target)
        expect(vi.mocked(renderer.initTexture).mock.calls.map(c => c[0])).toEqual([map, uniform])
    })
})
