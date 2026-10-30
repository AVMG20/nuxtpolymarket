import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

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
        uGrain: { value: 0.016 },
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
        uniform float uGrain;
        uniform float uSaturation;
        uniform float uTime;
        varying vec2 vUv;
        float grainHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
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
            // Film grain, strongest in the shadows like a real sensor.
            float g = grainHash(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5;
            float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col += g * uGrain * (1.0 - clamp(lum, 0.0, 1.0));
            gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
        }`
}

export class RushPost {
    readonly composer: EffectComposer
    readonly bloom: UnrealBloomPass
    readonly rush: ShaderPass

    constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
        // Multisampled, half-float target: smooth edges on the cars, HDR headroom for bloom; the stencil keeps ghosts off the car.
        const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true })
        this.composer = new EffectComposer(renderer, target)
        this.composer.addPass(new RenderPass(scene, camera))
        this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.9)
        this.composer.addPass(this.bloom)
        this.rush = new ShaderPass(RushShader)
        this.composer.addPass(this.rush)
        this.composer.addPass(new OutputPass())
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
        this.bloom.dispose()
        this.rush.dispose()
        this.composer.dispose()
    }
}
