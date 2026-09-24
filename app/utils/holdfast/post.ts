// Holdfast — post-processing, in order:
//   1. GTAO ambient occlusion at half resolution: contact shadows where walls,
//      buildings and units meet the ground, and darker crevices.
//   2. A gentle, high-threshold bloom so fire, embers and crystals glow.
//   3. A tilt-shift (top and bottom of the screen soften, which sells the
//      "toy diorama" look), two separable 9-tap passes.
//   4. A colour grade folded into the second blur pass: aerial haze towards
//      the horizon, a touch of warmth, a soft contrast S-curve, gentle
//      saturation and a vignette.
//   5. The OutputPass (tone mapping + sRGB) always runs last.
// setQuality() drops AO and bloom on slow GPUs.

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

function tiltShader(horizontal: boolean): THREE.ShaderMaterialParameters & { uniforms: Record<string, THREE.IUniform> } {
    const grade = !horizontal
    return {
        uniforms: {
            tDiffuse: { value: null },
            uStep: { value: 1 / 1024 },
            uFocus: { value: 0.52 },
            uStrength: { value: 1 },
            uVignette: { value: 0.24 },
            uHaze: { value: new THREE.Color(0xbfe4f7) },
            uHazeAmount: { value: 0.16 },
            uWarmth: { value: new THREE.Vector3(1.04, 1.0, 0.93) },
            uContrast: { value: 0.32 },
            uSaturation: { value: 1.06 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float uStep;
            uniform float uFocus;
            uniform float uStrength;
            uniform float uVignette;
            uniform vec3 uHaze;
            uniform float uHazeAmount;
            uniform vec3 uWarmth;
            uniform float uContrast;
            uniform float uSaturation;
            varying vec2 vUv;
            void main() {
                float off = abs(vUv.y - uFocus);
                // Sharp band in the middle, easing into blur towards the edges.
                float amount = smoothstep(0.2, 0.55, off) * uStrength;
                vec2 dir = ${horizontal ? 'vec2(1.0, 0.0)' : 'vec2(0.0, 1.0)'} * uStep * amount * 2.2;
                vec4 sum = texture2D(tDiffuse, vUv) * 0.1633;
                sum += texture2D(tDiffuse, vUv + dir) * 0.1531;
                sum += texture2D(tDiffuse, vUv - dir) * 0.1531;
                sum += texture2D(tDiffuse, vUv + dir * 2.0) * 0.12245;
                sum += texture2D(tDiffuse, vUv - dir * 2.0) * 0.12245;
                sum += texture2D(tDiffuse, vUv + dir * 3.0) * 0.0918;
                sum += texture2D(tDiffuse, vUv - dir * 3.0) * 0.0918;
                sum += texture2D(tDiffuse, vUv + dir * 4.0) * 0.051;
                sum += texture2D(tDiffuse, vUv - dir * 4.0) * 0.051;
                ${grade
                    ? `
                vec3 c = max(sum.rgb, 0.0);
                // Aerial haze: the far (top) edge of the view lifts towards the sky colour.
                float haze = smoothstep(0.5, 1.05, vUv.y);
                c = mix(c, uHaze, haze * haze * uHazeAmount);
                // Warm, gently saturated grade (scene-linear, before tone mapping).
                c *= uWarmth;
                float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
                c = max(mix(vec3(l), c, uSaturation), 0.0);
                // Soft S-curve in a perceptual (square-root) space; values above 1
                // keep their excess so highlights still reach the tone mapper.
                vec3 p = sqrt(c);
                vec3 q = clamp(p, 0.0, 1.0);
                p += (q * q * (3.0 - 2.0 * q) - q) * uContrast;
                c = p * p;
                // Soft vignette.
                vec2 e = vUv - 0.5;
                float vig = clamp(1.0 - dot(e, e) * 1.5, 0.0, 1.0);
                c *= mix(1.0, vig, uVignette);
                sum.rgb = c;`
                    : ''}
                gl_FragColor = sum;
            }
        `
    }
}

/** AO is computed at this fraction of the render resolution, then upsampled. */
const AO_SCALE = 0.5

/**
 * GTAO that ignores see-through things (health bars, rings, ghosts, glows,
 * the territory tint): only solid geometry should cast contact shadows.
 */
class SolidGTAOPass extends GTAOPass {
    private readonly hiddenSolid: THREE.Object3D[] = []

    _overrideVisibility(): void {
        const hidden = this.hiddenSolid
        this.scene.traverse((object) => {
            if (!object.visible) return
            const o = object as THREE.Object3D & { isPoints?: boolean, isLine?: boolean, isLine2?: boolean, material?: THREE.Material | THREE.Material[] }
            const mats = o.material === undefined ? [] : Array.isArray(o.material) ? o.material : [o.material]
            const seeThrough = mats.some(m => m.transparent || !m.depthWrite || !m.depthTest)
            if (o.isPoints || o.isLine || o.isLine2 || seeThrough) {
                object.visible = false
                hidden.push(object)
            }
        })
    }

    _restoreVisibility(): void {
        for (const object of this.hiddenSolid) object.visible = true
        this.hiddenSolid.length = 0
    }
}

export type PostQuality = 0 | 1 | 2

export class HoldfastPost {
    readonly composer: EffectComposer
    private readonly h: ShaderPass
    private readonly v: ShaderPass
    private readonly renderPass: RenderPass
    private readonly ao: SolidGTAOPass
    private readonly bloom: UnrealBloomPass
    private readonly scene: THREE.Scene

    constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
        const size = renderer.getSize(new THREE.Vector2())
        const target = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType })
        this.scene = scene
        this.composer = new EffectComposer(renderer, target)
        this.renderPass = new RenderPass(scene, camera)

        // Radius and thickness are in world units: about a wall's width, so
        // walls, houses and units ground themselves without a dirty halo.
        this.ao = new SolidGTAOPass(scene, camera, Math.max(1, size.x * AO_SCALE), Math.max(1, size.y * AO_SCALE))
        this.ao.output = GTAOPass.OUTPUT.Default
        this.ao.blendIntensity = 0.85
        this.ao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.6, thickness: 1.4, distanceFallOff: 1, scale: 1.15, samples: 12 })
        this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 })

        // Only genuinely hot pixels (fire, embers, crystals, sun glints) bloom.
        this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.45, 0.88)

        this.h = new ShaderPass(tiltShader(true))
        this.v = new ShaderPass(tiltShader(false))
        this.composer.addPass(this.renderPass)
        this.composer.addPass(this.ao)
        this.composer.addPass(this.bloom)
        this.composer.addPass(this.h)
        this.composer.addPass(this.v)
        this.composer.addPass(new OutputPass())
    }

    setSize(w: number, h: number, pixelRatio: number): void {
        this.composer.setPixelRatio(pixelRatio)
        this.composer.setSize(w, h)
        this.ao.setSize(Math.max(1, Math.round(w * pixelRatio * AO_SCALE)), Math.max(1, Math.round(h * pixelRatio * AO_SCALE)))
        this.h.uniforms.uStep!.value = 1 / Math.max(1, w * pixelRatio)
        this.v.uniforms.uStep!.value = 1 / Math.max(1, h * pixelRatio)
    }

    /** 0 = off, 1 = full. Zooming in strengthens the miniature effect. */
    setStrength(value: number): void {
        this.h.uniforms.uStrength!.value = value
        this.v.uniforms.uStrength!.value = value
    }

    /** 0 = tilt-shift and grade only, 1 = plus bloom, 2 = plus ambient occlusion. */
    setQuality(level: PostQuality): void {
        this.bloom.enabled = level >= 1
        this.ao.enabled = level >= 2
    }

    /** Overall grade intensity, 0 = neutral, 1 = default look. */
    setGrade(value: number): void {
        const k = Math.max(0, Math.min(1, value))
        const u = this.v.uniforms
        ;(u.uWarmth!.value as THREE.Vector3).set(1 + 0.04 * k, 1, 1 - 0.07 * k)
        u.uContrast!.value = 0.32 * k
        u.uSaturation!.value = 1 + 0.06 * k
        u.uHazeAmount!.value = 0.16 * k
    }

    render(): void {
        // The haze follows the fog, so it turns crimson with the Bloodmoon.
        const fog = this.scene.fog
        if (fog) (this.v.uniforms.uHaze!.value as THREE.Color).copy(fog.color)
        this.composer.render()
    }

    dispose(): void {
        this.ao.dispose()
        this.bloom.dispose()
        this.composer.dispose()
    }
}
