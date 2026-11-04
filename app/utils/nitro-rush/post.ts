import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'
import { CopyShader } from 'three/addons/shaders/CopyShader.js'
import { HASH_GLSL } from './glsl'

/**
 * Bloom, then one pass that does the rest of the juice: radial zoom blur for
 * nitro, chromatic aberration pulses, a colour flash, a tint and a vignette.
 */
const RushShader = {
    uniforms: {
        tDiffuse: { value: null },
        uRadial: { value: 0 },
        uAberration: { value: 0 },
        uFlash: { value: new THREE.Color(0, 0, 0) },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uTintAmount: { value: 0 },
        uVignette: { value: 0.3 },
        uSaturation: { value: 1 },
        uTime: { value: 0 }
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uRadial;
        uniform float uAberration;
        uniform vec3 uFlash;
        uniform vec3 uTint;
        uniform float uTintAmount;
        uniform float uVignette;
        uniform float uSaturation;
        uniform float uTime;
        varying vec2 vUv;
        ${HASH_GLSL}
        void main() {
            // Blur toward a focus a little above centre, where the road meets the horizon.
            vec2 dir = vUv - vec2(0.5, 0.56);
            float dist = length(dir);
            vec3 col;
            if (uRadial > 0.001) {
                col = vec3(0.0);
                float total = 0.0;
                for (int i = 0; i < 10; i++) {
                    float t = float(i) / 9.0;
                    float w = 1.0 - t * 0.7;
                    col += texture2D(tDiffuse, vUv - dir * uRadial * t * 0.14).rgb * w;
                    total += w;
                }
                col /= total;
            } else {
                col = texture2D(tDiffuse, vUv).rgb;
            }
            if (uAberration > 0.001) {
                vec2 off = dir * uAberration * 0.018;
                float k = clamp(uAberration, 0.0, 1.0);
                col.r = mix(col.r, texture2D(tDiffuse, vUv + off).r, k);
                col.b = mix(col.b, texture2D(tDiffuse, vUv - off).b, k);
            }
            col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, uSaturation);
            col = mix(col, col * uTint, clamp(uTintAmount, 0.0, 1.0));
            col += uFlash;
            float v = smoothstep(0.95, 0.3, dist * (1.0 + uVignette));
            col *= mix(1.0, v, clamp(0.6 + uVignette * 0.4, 0.0, 1.0));
            // One grain per pixel, scaled with the colour: this buffer is linear, so added noise blows up in the shadows.
            // Far less dither than Void Runner's 0.004: AgX lifts shadows much harder than its ACES.
            // A different offset per axis, so the pattern reshuffles rather than sliding diagonally.
            float grain = hash(gl_FragCoord.xy + floor(fract(uTime * 0.37) * 997.0) * vec2(1.0, 1.618)) - 0.5;
            col = col * (1.0 + grain * 0.05) + grain * 0.0005;
            gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
        }`
}

/** Draws the scene multisampled, then hands it on single-sampled: bloom blends into what it reads, which on an MSAA buffer resolves the whole screen again. */
class ScenePass extends Pass {
    // Smooth edges on the cars, HDR headroom for bloom; the stencil keeps ghosts off the car.
    // Nothing reads its depth or stencil afterwards, and resolving stencil is slow on D3D.
    readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true, resolveDepthBuffer: false, resolveStencilBuffer: false })
    private readonly draw: RenderPass
    private readonly material = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms),
        vertexShader: CopyShader.vertexShader,
        fragmentShader: CopyShader.fragmentShader,
        blending: THREE.NoBlending,
        depthTest: false,
        depthWrite: false
    })

    private readonly copy = new FullScreenQuad(this.material)

    constructor(scene: THREE.Scene, camera: THREE.Camera) {
        super()
        this.needsSwap = false
        this.draw = new RenderPass(scene, camera)
    }

    override setSize(width: number, height: number) {
        this.target.setSize(width, height)
    }

    override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
        this.draw.render(renderer, writeBuffer, this.target, 0, false)
        this.material.uniforms.tDiffuse!.value = this.target.texture
        renderer.setRenderTarget(readBuffer)
        this.copy.render(renderer)
    }

    override dispose() {
        this.target.dispose()
        this.material.dispose()
        this.copy.dispose()
    }
}

export class RushPost {
    readonly composer: EffectComposer
    readonly bloom: UnrealBloomPass
    readonly rush: ShaderPass
    private readonly scenePass: ScenePass

    constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
        // Past the scene pass only fullscreen quads get drawn: no samples, depth or stencil to pay for.
        this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }))
        this.scenePass = new ScenePass(scene, camera)
        this.composer.addPass(this.scenePass)
        this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.9)
        this.composer.addPass(this.bloom)
        this.rush = new ShaderPass(RushShader)
        this.composer.addPass(this.rush)
        this.composer.addPass(new OutputPass())
    }

    /** Where the scene's materials draw, which three builds their shaders for. */
    get sceneTarget() {
        return this.scenePass.target
    }

    setSize(w: number, h: number, pixelRatio: number) {
        this.composer.setPixelRatio(pixelRatio)
        this.composer.setSize(w, h)
    }

    set(o: { radial: number, aberration: number, flash: THREE.Color, tint: THREE.Color, tintAmount: number, vignette: number, bloom: number, saturation: number }) {
        const u = this.rush.uniforms
        u.uRadial!.value = o.radial
        u.uAberration!.value = o.aberration
        u.uFlash!.value.copy(o.flash)
        u.uTint!.value.copy(o.tint)
        u.uTintAmount!.value = o.tintAmount
        u.uVignette!.value = o.vignette
        u.uSaturation!.value = o.saturation
        u.uTime!.value = performance.now() / 1000
        this.bloom.strength = o.bloom
    }

    render() {
        this.composer.render()
    }

    dispose() {
        this.scenePass.dispose()
        this.bloom.dispose()
        this.rush.dispose()
        this.composer.dispose()
    }
}
