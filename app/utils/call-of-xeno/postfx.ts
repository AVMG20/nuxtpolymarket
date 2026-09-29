// Call of Xeno — post-processing chain.
//
//   ScenePass (MSAA, HDR)  ->  UnrealBloomPass  ->  grade  ->  OutputPass
//
// The scene renders into a multisampled half-float target, is resolved into the
// composer, and everything after that runs on plain full-screen quads. Bloom has a
// high threshold so only emissives, muzzle flashes, explosions and lights glow.
// The grade pass works in linear HDR before OutputPass applies the renderer's
// tone mapping and sRGB conversion, so keep `renderer.toneMapping` set as usual.
//
// Resolution follows the rules for three.js games on this site: the canvas is
// native (`clamp(dpr, 1, 2)`), and the internal targets are never below 1:1 on a
// dpr 1 screen. Standard screens are supersampled (up to 1.5x) while the frame
// time allows, and an adaptive scale backs off when frames run long. All shader
// inputs that feed a pow, sqrt or division are clamped.
//
// The class owns the renderer's size and pixel ratio: call `setSize()` instead
// of `renderer.setSize()` / `renderer.setPixelRatio()`.

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export type CallOfXenoGrade = 'normal' | 'emergency' | 'cold'
export type CallOfXenoPostQuality = 'low' | 'high'

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const damp = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt))

// ---------------------------------------------------------------------------
// Scene pass: renders into an MSAA target, then resolves into the composer
// ---------------------------------------------------------------------------

const COPY_VERT = /* glsl */`
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`

const COPY_FRAG = /* glsl */`
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
        gl_FragColor = texture2D(tDiffuse, vUv);
    }
`

class ScenePass extends Pass {
    scene: THREE.Scene
    camera: THREE.Camera
    private target: THREE.WebGLRenderTarget
    private material: THREE.ShaderMaterial
    private quad: FullScreenQuad

    constructor(scene: THREE.Scene, camera: THREE.Camera, samples: number) {
        super()
        this.scene = scene
        this.camera = camera
        this.needsSwap = false
        this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples, depthBuffer: true })
        this.target.texture.name = 'CallOfXeno.scene'
        this.material = new THREE.ShaderMaterial({
            uniforms: { tDiffuse: { value: this.target.texture } },
            vertexShader: COPY_VERT,
            fragmentShader: COPY_FRAG,
            depthTest: false,
            depthWrite: false,
            blending: THREE.NoBlending
        })
        this.quad = new FullScreenQuad(this.material)
    }

    setSamples(samples: number) {
        if (this.target.samples === samples) return
        this.target.samples = samples
        // Disposing forces three to rebuild the framebuffer with the new sample count.
        this.target.dispose()
    }

    override setSize(width: number, height: number) {
        this.target.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)))
    }

    override render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
        const autoClear = renderer.autoClear
        renderer.autoClear = true
        renderer.setRenderTarget(this.target)
        renderer.render(this.scene, this.camera)
        renderer.autoClear = false
        renderer.setRenderTarget(this.renderToScreen ? null : readBuffer)
        this.quad.render(renderer)
        renderer.autoClear = autoClear
    }

    override dispose() {
        this.target.dispose()
        this.material.dispose()
        this.quad.dispose()
    }
}

// ---------------------------------------------------------------------------
// Grade: filmic contrast, teal-orange split tone, vignette, grain, aberration,
// damage overlay, low-health desaturation and the emergency grade
// ---------------------------------------------------------------------------

const GRADE_SHADER = {
    uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        uRes: { value: new THREE.Vector2(1920, 1080) },
        uTime: { value: 0 },
        uDamage: { value: 0 },
        uLow: { value: 0 },
        uHeart: { value: 0 },
        uFlash: { value: 0 },
        uAim: { value: 0 },
        uGradeMix: { value: 0 },
        uGradeTint: { value: new THREE.Vector3(1, 1, 1) },
        uGrain: { value: 0.09 },
        uCA: { value: 0.0016 },
        uContrast: { value: 1.1 }
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec2 uRes;
        uniform float uTime;
        uniform float uDamage;
        uniform float uLow;
        uniform float uHeart;
        uniform float uFlash;
        uniform float uAim;
        uniform float uGradeMix;
        uniform vec3 uGradeTint;
        uniform float uGrain;
        uniform float uCA;
        uniform float uContrast;
        varying vec2 vUv;

        const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

        float hash12(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
            vec2 uv = clamp(vUv, 0.0, 1.0);
            vec2 c = uv - 0.5;
            float aspect = uRes.x / max(uRes.y, 1.0);
            vec2 cc = vec2(c.x * aspect, c.y);
            float r2 = min(dot(cc, cc), 1.6);
            float dist = sqrt(max(r2, 0.0));

            // Chromatic aberration grows towards the edges and pulses with damage.
            float caAmt = uCA + uDamage * 0.014 + uLow * uHeart * 0.004;
            vec3 col;
            if (caAmt > 0.0002) {
                vec2 off = c * (caAmt * r2 * 2.0);
                col = vec3(
                    texture2D(tDiffuse, uv - off).r,
                    texture2D(tDiffuse, uv).g,
                    texture2D(tDiffuse, uv + off).b
                );
            } else {
                col = texture2D(tDiffuse, uv).rgb;
            }
            col = clamp(col, vec3(0.0), vec3(48.0));

            // Explosion exposure kick.
            col = col * (1.0 + uFlash * 1.4) + vec3(1.0, 0.94, 0.85) * (uFlash * 0.35);

            // Filmic contrast around mid grey (base clamped away from zero).
            vec3 rel = max(col / 0.18, vec3(0.0001));
            col = 0.18 * pow(rel, vec3(uContrast));

            // Teal shadows, warm highlights.
            float l = dot(col, LUMA);
            float sh = 1.0 - smoothstep(0.0, 0.35, l);
            float hi = smoothstep(0.25, 1.2, l);
            col *= mix(vec3(1.0), vec3(0.86, 1.0, 1.08), sh * 0.75);
            col *= mix(vec3(1.0), vec3(1.10, 1.0, 0.88), hi * 0.6);
            col = mix(vec3(l), col, 1.08);

            // Emergency (red) or cold grade: luminance carrying a tint.
            float le = dot(col, LUMA);
            col = mix(col, vec3(le) * uGradeTint + col * 0.12, uGradeMix);

            // Low health: drained colour.
            float ld = dot(col, LUMA);
            col = mix(col, vec3(ld) * vec3(1.0, 0.92, 0.9), uLow * 0.7);

            // Vignette tightens while aiming and when hurt.
            float inner = 0.44 - uAim * 0.07 - uLow * 0.08 - uLow * uHeart * 0.06;
            float outer = 1.02 - uAim * 0.06;
            float v = smoothstep(inner, outer, dist);
            col *= 1.0 - v * (0.55 + uAim * 0.12 + uLow * 0.2);

            // Damage: blood-red edges plus a faint flush over the whole frame.
            float dv = smoothstep(0.25, 0.95, dist) * uDamage;
            col = col * (1.0 - dv * 0.6) + vec3(0.5, 0.015, 0.02) * (dv * 0.9);
            col += vec3(0.05, 0.0, 0.0) * uDamage * uDamage;
            col += vec3(0.16, 0.0, 0.0) * (uLow * uHeart) * smoothstep(0.3, 1.0, dist);

            // Animated film grain, mostly in the shadows.
            float frame = floor(uTime * 24.0);
            vec2 seed = gl_FragCoord.xy + vec2(mod(frame, 97.0) * 17.31, mod(frame, 89.0) * 11.7);
            float n = hash12(seed) - 0.5;
            float gLum = dot(col, LUMA);
            col *= 1.0 + n * uGrain * (1.0 - smoothstep(0.0, 1.5, gLum));
            col += vec3(n * uGrain * 0.02);

            gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
        }
    `
}

const GRADE_TINTS: Record<CallOfXenoGrade, { tint: [number, number, number], mix: number }> = {
    normal: { tint: [1, 1, 1], mix: 0 },
    emergency: { tint: [1.35, 0.42, 0.38], mix: 0.6 },
    cold: { tint: [0.7, 0.95, 1.3], mix: 0.45 }
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

export class CallOfXenoPostFx {
    /** Set false to bypass the chain and render straight to the canvas. */
    enabled = true
    /** Drive `setScale` from measured frame time. On by default. */
    adaptive = true

    private renderer: THREE.WebGLRenderer
    private scenePass: ScenePass
    private composer: EffectComposer
    private bloom: UnrealBloomPass
    private grade: ShaderPass
    private output: OutputPass

    private width = 1
    private height = 1
    private canvasRatio = 1
    private scale = 1.35
    private appliedRatio = 0
    private quality: CallOfXenoPostQuality = 'high'

    private time = 0
    private damage = 0
    private low = 0
    private lowTarget = 0
    private flashValue = 0
    private aim = 0
    private aimTarget = 0
    private heartPhase = 0
    private gradeMix = 0
    private gradeTint: [number, number, number] = [1, 1, 1]
    private gradeTarget: CallOfXenoGrade = 'normal'
    private powerOff = false
    private bloomBase = 0.5

    private frameEma = 1 / 60
    private slowFor = 0
    private fastFor = 0
    private cooldown = 0

    constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
        this.renderer = renderer
        this.scenePass = new ScenePass(scene, camera, 4)

        // The composer's own targets carry the resolved (non-multisampled) image.
        this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }))
        this.composer.addPass(this.scenePass)

        this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.bloomBase, 0.55, 0.92)
        this.composer.addPass(this.bloom)

        this.grade = new ShaderPass(GRADE_SHADER)
        this.composer.addPass(this.grade)

        this.output = new OutputPass()
        this.composer.addPass(this.output)

        this.canvasRatio = clamp(window.devicePixelRatio || 1, 1, 2)
        this.scale = this.canvasRatio >= 1.5 ? 1 : 1.35
        const size = renderer.getSize(new THREE.Vector2())
        this.setSize(size.x || 1, size.y || 1)
    }

    // -- sizing -------------------------------------------------------------

    /** Resizes the canvas and every internal target. Call from `onResize` and after construction. */
    setSize(width: number, height: number) {
        this.width = Math.max(1, width)
        this.height = Math.max(1, height)
        this.canvasRatio = clamp(window.devicePixelRatio || 1, 1, 2)
        this.renderer.setPixelRatio(this.canvasRatio)
        this.renderer.setSize(this.width, this.height)
        this.applyRatio(true)
    }

    /**
     * Render scale relative to the canvas pixel ratio (0.5 to 1.5). Above 1
     * supersamples. The internal ratio never drops below 1:1 on a standard
     * screen, and Retina screens are not supersampled. Cheap to call every
     * frame: targets only resize when the effective ratio really changes.
     */
    setScale(scale: number) {
        this.scale = clamp(scale, 0.5, 1.5)
        this.applyRatio(false)
    }

    getScale() {
        return this.scale
    }

    /** The internal render ratio in use (canvas pixels per CSS pixel, times the scale). */
    getRenderRatio() {
        return this.appliedRatio
    }

    private effectiveRatio() {
        const floor = Math.min(window.devicePixelRatio || 1, 1)
        const ceil = Math.min(this.canvasRatio * 1.5, Math.max(this.canvasRatio, 1.6))
        return clamp(this.canvasRatio * this.scale, floor, ceil)
    }

    private applyRatio(force: boolean) {
        const ratio = this.effectiveRatio()
        if (!force && Math.abs(ratio - this.appliedRatio) < 0.04) return
        this.appliedRatio = ratio
        this.composer.setPixelRatio(ratio)
        this.composer.setSize(this.width, this.height)
        this.grade.uniforms.uRes!.value.set(this.width * ratio, this.height * ratio)
    }

    /** 'low' drops bloom and the aberration and uses cheaper multisampling. */
    setQuality(quality: CallOfXenoPostQuality) {
        this.quality = quality
        const high = quality === 'high'
        this.bloom.enabled = high
        this.scenePass.setSamples(high ? 4 : 2)
        this.grade.uniforms.uCA!.value = high ? 0.0016 : 0
        this.grade.uniforms.uGrain!.value = high ? 0.09 : 0.05
    }

    getQuality() {
        return this.quality
    }

    /** Points the scene pass at a different camera (rarely needed). */
    setCamera(camera: THREE.Camera) {
        this.scenePass.camera = camera
    }

    // -- controls -------------------------------------------------------------

    /**
     * Player took a hit: red edge vignette and a chromatic aberration pulse.
     * `strength` 0..1 (a heavy hit is ~1). It is an impulse: the larger of the
     * current and the new value wins, and it fades on its own. `setDamage(0)` clears it.
     */
    setDamage(strength: number) {
        const v = clamp(strength, 0, 1)
        this.damage = v === 0 ? 0 : Math.max(this.damage, v)
    }

    /** Low health state 0..1 (0 healthy, 1 nearly dead): drained colour and a heartbeat vignette. */
    setLowHealth(amount: number) {
        this.lowTarget = clamp(amount, 0, 1)
    }

    /** White-ish exposure kick, decays in about half a second. `strength` 0..2 (an explosion is ~0.3 to 1). */
    flash(strength: number) {
        this.flashValue = Math.max(this.flashValue, clamp(strength, 0, 2))
        this.bloom.strength = this.bloomBase + this.flashValue * 0.9
    }

    /** Aim-down-sights amount 0..1: subtly tightens the vignette. Smoothed internally. */
    setAim(amount: number) {
        this.aimTarget = clamp(amount, 0, 1)
    }

    /** Emergency red grade while the power is off, the normal warm-teal grade otherwise. */
    setPowerOff(off: boolean) {
        this.powerOff = off
        this.setGrade(off ? 'emergency' : 'normal')
    }

    isPowerOff() {
        return this.powerOff
    }

    /** 'normal' (warm-teal), 'emergency' (red) or 'cold' (blue). Blends over about half a second. */
    setGrade(grade: CallOfXenoGrade) {
        this.gradeTarget = grade
    }

    /** Base bloom strength (default 0.5). */
    setBloom(strength: number) {
        this.bloomBase = clamp(strength, 0, 2)
    }

    // -- frame ----------------------------------------------------------------

    /** Renders the scene through the chain to the canvas. Call once per frame instead of `renderer.render`. */
    render(dt: number) {
        dt = clamp(dt, 0, 0.1)
        if (!this.enabled) {
            this.renderer.setRenderTarget(null)
            this.renderer.render(this.scenePass.scene, this.scenePass.camera)
            return
        }
        this.step(dt)
        this.composer.render(dt)
    }

    private step(dt: number) {
        this.time += dt
        const u = this.grade.uniforms

        this.damage = Math.max(0, this.damage - dt * (0.5 + this.damage * 2))
        this.flashValue = this.flashValue < 0.002 ? 0 : this.flashValue * Math.exp(-dt * 7)
        this.aim = damp(this.aim, this.aimTarget, 10, dt)
        this.low = damp(this.low, this.lowTarget, 4, dt)
        if (this.lowTarget === 0 && this.low < 0.003) this.low = 0
        this.bloom.strength = this.bloomBase + this.flashValue * 0.9

        // Heartbeat: a double thump that speeds up as health drops.
        let heart = 0
        if (this.low > 0.01) {
            this.heartPhase = (this.heartPhase + dt * (1 + this.low * 1.2)) % 1
            const p = this.heartPhase
            const a = (p - 0.06) / 0.045
            const b = (p - 0.3) / 0.06
            heart = Math.min(1, Math.exp(-a * a) + 0.65 * Math.exp(-b * b))
        }

        const target = GRADE_TINTS[this.gradeTarget]
        const k = 1 - Math.exp(-2.5 * dt)
        this.gradeMix += (target.mix - this.gradeMix) * k
        for (let i = 0; i < 3; i++) this.gradeTint[i] = this.gradeTint[i]! + (target.tint[i]! - this.gradeTint[i]!) * k
        ;(u.uGradeTint!.value as THREE.Vector3).set(this.gradeTint[0], this.gradeTint[1], this.gradeTint[2])

        u.uTime!.value = this.time
        u.uDamage!.value = this.damage
        u.uLow!.value = this.low
        u.uHeart!.value = heart
        u.uFlash!.value = this.flashValue
        u.uAim!.value = this.aim
        u.uGradeMix!.value = this.gradeMix

        if (this.adaptive) this.adapt(dt)
    }

    /** Backs the render scale off when frames run long, and creeps it back up when there is headroom. */
    private adapt(dt: number) {
        if (dt <= 0 || dt > 0.25) return
        this.frameEma += (dt - this.frameEma) * 0.08
        this.cooldown = Math.max(0, this.cooldown - dt)
        const limit = this.canvasRatio >= 1.5 ? 1 : 1.35
        if (this.frameEma > 1 / 42) {
            this.slowFor += dt
            this.fastFor = 0
            if (this.slowFor > 1 && this.cooldown === 0) {
                this.slowFor = 0
                this.cooldown = 1.5
                this.setScale(this.scale - 0.15)
            }
        } else if (this.frameEma < 1 / 57) {
            this.fastFor += dt
            this.slowFor = 0
            if (this.fastFor > 4 && this.cooldown === 0 && this.scale < limit - 0.01) {
                this.fastFor = 0
                this.cooldown = 3
                this.setScale(Math.min(limit, this.scale + 0.1))
            }
        } else {
            this.slowFor = 0
            this.fastFor = 0
        }
    }

    dispose() {
        this.scenePass.dispose()
        this.bloom.dispose()
        this.grade.dispose()
        this.output.dispose()
        this.composer.dispose()
    }
}
