import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { dfNewPrGovernor, dfPixelRatioBounds, dfPrMemoryKey, dfPrStrained, dfStepPrGovernor, dfTierMemoryKey } from './resolution'
import { DfInkPass } from './toon-ink'

// Renderer + post chain:
//   world pass (its own MSAA target) -> world ink (resolves it into the chain)
//   -> viewmodel pass (depth cleared) -> viewmodel ink -> bloom -> grade pass (a
//   hue-keeping tone map, sRGB, comic colour, halftone in the deepest shadows,
//   paper grain, vignette, damage, downed).
// The ink passes (toon-ink.ts) draw outlines from the depth buffer; the world's
// has to run before the viewmodel clears that depth. The viewmodel is drawn into
// the HDR buffer before bloom and grading, so it gets the same look and its
// muzzle flashes bloom over the ink.
// Only the world is multisampled: every pass that draws into a multisampled
// target pays to load, store and resolve all of it (colour and depth), which at
// 1440p cost ~2 ms per pass on an M2 Pro. The chain's own buffers are single
// sampled; the inked viewmodel's edges don't need it.

// NaN and Inf have every exponent bit set. A single such pixel (one bad
// fragment on one GPU) is blurred by every bloom mip into a NaN block that
// covers half the screen, and the grade's max() turns it black (Windows/D3D,
// 2026-11-17). The bloom input and the grade read through this, so a bad pixel
// stays one pixel. Bit tests, because a compiler may fold isnan() away.
const DF_FINITE_GLSL = /* glsl */`
    vec4 dfFinite(vec4 c) {
        bvec4 bad = equal(floatBitsToUint(c) & 0x7f800000u, uvec4(0x7f800000u));
        return vec4(bad.x ? 0.0 : c.x, bad.y ? 0.0 : c.y, bad.z ? 0.0 : c.z, bad.w ? 0.0 : c.w);
    }
`

const GRADE_SHADER = {
    uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uPr: { value: 1 },
        uExposure: { value: 1 },
        uLowHealth: { value: 0 },
        uDamage: { value: 0 },
        uDown: { value: 0 },
        uFlash: { value: 0 },
        uGrain: { value: 0.008 }
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
        ${DF_FINITE_GLSL}
        vec4 dfTex(vec2 uv) {
            return dfFinite(texture2D(tDiffuse, uv));
        }
        uniform float uTime;
        uniform vec2 uRes;
        uniform float uPr;
        uniform float uExposure;
        uniform float uLowHealth;
        uniform float uDamage;
        uniform float uDown;
        uniform float uFlash;
        uniform float uGrain;
        varying vec2 vUv;

        // Khronos neutral: colours below the shoulder pass through untouched, so the
        // toon bands stay flat and saturated (ACES bends and greys them)
        vec3 dfTone(vec3 color) {
            const float start = 0.76;
            const float desat = 0.15;
            float x = min(color.r, min(color.g, color.b));
            float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
            color -= offset;
            float peak = max(color.r, max(color.g, color.b));
            if (peak < start) return color;
            float d = 1.0 - start;
            float newPeak = 1.0 - d * d / (peak + d - start);
            color *= newPeak / peak;
            float g = 1.0 - 1.0 / (desat * (peak - newPeak) + 1.0);
            return mix(color, vec3(newPeak), g);
        }
        vec3 dfToSrgb(vec3 c) {
            c = clamp(c, 0.0, 1.0);
            return mix(c * 12.92, 1.055 * pow(max(c, vec3(1e-6)), vec3(0.41666)) - 0.055, step(vec3(0.0031308), c));
        }
        float hash(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
        }
        float vnoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
            vec2 uv = vUv;
            vec2 fromC = uv - 0.5;
            vec3 hdr;
            if (uDown > 0.01) {
                // downed: a woozy radial smear toward the centre
                vec3 acc = vec3(0.0);
                float j = hash(gl_FragCoord.xy + uTime);
                for (int i = 0; i < 8; i++) {
                    float k = (float(i) + j) / 8.0;
                    acc += dfTex(uv - fromC * k * 0.05 * uDown).rgb;
                }
                hdr = acc / 8.0;
            } else if (uDamage > 0.02) {
                // a little chromatic split on hits
                vec2 o = fromC * 0.006 * uDamage;
                hdr = vec3(dfTex(uv + o).r, dfTex(uv).g, dfTex(uv - o).b);
            } else {
                hdr = dfTex(uv).rgb;
            }
            hdr = max(hdr, vec3(0.0)) * uExposure * (1.0 + uFlash);
            vec3 c = dfToSrgb(dfTone(hdr * 1.3));

            float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
            // comic colour: violet-blue shadows, warm lights, a firm push in saturation and contrast
            vec3 shadowTint = vec3(0.94, 0.97, 1.07);
            vec3 highTint = vec3(1.04, 1.0, 0.94);
            c *= mix(shadowTint, highTint, smoothstep(0.04, 0.7, l));
            c = mix(vec3(l), c, 1.22);
            c = clamp((c - 0.5) * 1.1 + 0.52, 0.0, 1.0);
            l = dot(c, vec3(0.2126, 0.7152, 0.0722));

            // halftone in the deepest shadows: a 45 degree dot screen, dots growing as it gets darker
            vec2 css = gl_FragCoord.xy / max(uPr, 1.0);
            vec2 hp = mat2(0.7071, -0.7071, 0.7071, 0.7071) * css / 5.0;
            float hd = length(fract(hp) - 0.5);
            float hr = 0.46 * (1.0 - smoothstep(0.015, 0.11, l));
            float dots = 1.0 - smoothstep(hr - 0.09, hr + 0.09, hd);
            c *= 1.0 - dots * 0.3;
            // pen hatching in the mid-shadows (below the dots): fine 45 degree strokes
            float hatchBand = smoothstep(0.36, 0.14, l) * smoothstep(0.03, 0.12, l);
            float hatch = (1.0 - smoothstep(0.07, 0.13, abs(fract((css.x - css.y) / 5.5) - 0.5))) * hatchBand;
            c *= 1.0 - hatch * 0.16;

            float desat = max(uLowHealth * 0.6, uDown * 0.9);
            c = mix(c, vec3(l) * vec3(1.02, 0.99, 0.96), desat);

            // vignette (aspect correct)
            vec2 q = fromC * vec2(uRes.x / max(uRes.y, 1.0), 1.0);
            float r = length(q);
            float vig = smoothstep(0.45, 1.15, r);
            c *= 1.0 - vig * (0.32 + uDown * 0.45);

            // blood at the edges with damage and low health, pulsing with the heartbeat when low:
            // a hard-edged ink splatter that creeps in from the corners, inked along its inner edge,
            // dotted where it thins
            float pulse = 0.85 + 0.15 * sin(uTime * 7.0);
            float bloodI = clamp(uLowHealth * 0.6 * pulse + uDamage * 0.85, 0.0, 1.0);
            if (bloodI > 0.01) {
                vec2 sp = q * 2.2;
                float nz = vnoise(sp * 1.7 + 3.0) * 0.6 + vnoise(sp * 4.1 - 1.0) * 0.3 + vnoise(sp * 9.0) * 0.1;
                float edge = r + (nz - 0.5) * 0.55;
                float t = mix(1.22, 0.6, bloodI);
                float w = max(fwidth(edge), 0.003);
                float fill = smoothstep(t - w, t + w, edge);
                float rim = smoothstep(t - 0.03 - w, t - 0.03 + w, edge) * (1.0 - fill);
                float inner = 1.0 - step(t + 0.1, edge);
                float dotsMask = 1.0 - smoothstep(0.28, 0.38, length(fract(hp * 1.6) - 0.5));
                vec3 fillCol = mix(vec3(0.56, 0.04, 0.03), vec3(0.25, 0.012, 0.014), step(t + 0.1, edge));
                fillCol = mix(fillCol, vec3(0.82, 0.12, 0.08), dotsMask * inner * 0.85);
                c = mix(c, vec3(0.02, 0.0, 0.01), rim * 0.85);
                c = mix(c, fillCol, fill * 0.94);
            }

            // manga speed lines: ink rays from the edges when downed, a flicker of them on a hard hit
            float lineK = max(uDown * 0.85, uDamage * 0.4);
            if (lineK > 0.02) {
                float ang = atan(q.y, q.x + 1e-4);
                float sl = ang * 24.0 + floor(uTime * 12.0) * 5.0;
                float h = hash(vec2(floor(sl), 3.0));
                float wid = mix(0.05, 0.3, smoothstep(0.4, 1.0, r));
                float stroke = 1.0 - smoothstep(wid - 0.03, wid, abs(fract(sl) - 0.5));
                float reach = smoothstep(0.42 + 0.25 * h, 0.62 + 0.25 * h, r);
                c = mix(c, vec3(0.015, 0.0, 0.01), step(0.55, h) * stroke * reach * lineK);
            }

            // paper: a still, fibrous grain the ink sits on, plus a faint live grain
            float paper = hash(floor(css * 0.5)) * 0.5 + hash(floor(css)) * 0.3 + hash(floor(css * vec2(0.12, 1.0))) * 0.2;
            c *= 1.0 + (paper - 0.5) * 0.05;
            float n = hash(floor(css) + fract(uTime * 13.7) * vec2(173.0, 91.0)) - 0.5;
            c += n * uGrain * (1.15 - l * 0.6);
            // dither against banding in the dark sky
            c += (hash(gl_FragCoord.xy * 1.37 + 11.0) - 0.5) / 255.0;
            gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }
    `
}

/** Renders the world into its own (multisampled) target, which the world ink reads. */
class WorldPass extends Pass {
    constructor(private scene: THREE.Scene, private camera: THREE.Camera, private target: THREE.WebGLRenderTarget) {
        super()
        this.needsSwap = false
    }

    override render(renderer: THREE.WebGLRenderer): void {
        renderer.setRenderTarget(this.target)
        renderer.clear()
        renderer.render(this.scene, this.camera)
    }
}

/** Renders a second scene into the same buffer after clearing depth only. */
class LayerPass extends Pass {
    constructor(private scene: THREE.Scene, private camera: THREE.Camera) {
        super()
        this.needsSwap = false
    }

    override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
        const auto = renderer.autoClear
        renderer.autoClear = false
        renderer.setRenderTarget(this.renderToScreen ? null : read)
        renderer.clearDepth()
        renderer.render(this.scene, this.camera)
        renderer.autoClear = auto
    }
}

export interface DfGradeInput {
    lowHealth: number // 0..1
    damage: number // 0..1 hit flash
    down: number // 0..1
    flash: number // 0..1 global brightness flash (nuke, lightning)
}

export interface DfRenderer {
    readonly renderer: THREE.WebGLRenderer
    readonly canvas: HTMLCanvasElement
    readonly quality: 'low' | 'high'
    /** Current renderer pixel ratio. */
    readonly pixelRatio: number
    readonly bufferWidth: number
    readonly bufferHeight: number
    setScenes(scene: THREE.Scene, camera: THREE.PerspectiveCamera, vmScene: THREE.Scene, vmCamera: THREE.PerspectiveCamera): void
    resize(): void
    /** Whether a resolution step's hitch would go unnoticed now (between rounds, paused): step-ups wait for it. */
    setQuiet(on: boolean): void
    render(dtSec: number, time: number, grade: DfGradeInput): void
    dispose(): void
}

function detectQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): 'low' | 'high' {
    try {
        const ext = gl.getExtension('WEBGL_debug_renderer_info')
        const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
        if (/swiftshader|llvmpipe|software|mali-4|adreno \(tm\) 3|intel\(r\) hd graphics [2-5]/i.test(name)) return 'low'
    } catch {
        // ignore
    }
    if (navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 2) return 'low'
    return 'high'
}

/** How long 'auto' stays on the lighter tier for a screen before giving the full one another try. */
const TIER_MEMORY_MS = 14 * 24 * 3600 * 1000

/** 'auto' had to fall back to the lighter tier on this screen recently. */
function recallLowTier(width: number, height: number): boolean {
    try {
        const at = Number(localStorage.getItem(dfTierMemoryKey(window.devicePixelRatio || 1, width, height)))
        return at > 0 && Date.now() - at < TIER_MEMORY_MS
    } catch {
        return false
    }
}

function rememberLowTier(width: number, height: number): void {
    try {
        localStorage.setItem(dfTierMemoryKey(window.devicePixelRatio || 1, width, height), String(Date.now()))
    } catch {
        // private mode: the next match finds out again
    }
}

/** `quality` forces a tier ('auto' or omitted detects it from the GPU). */
export function createDfRenderer(container: HTMLElement, opts: { quality?: 'auto' | 'low' | 'high' } = {}): DfRenderer {
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.setClearColor(0x000000, 1)
    const canvas = renderer.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    container.appendChild(canvas)

    const auto = opts.quality !== 'low' && opts.quality !== 'high'
    let quality = opts.quality === 'low' || opts.quality === 'high' ? opts.quality : detectQuality(renderer.getContext())
    // the full tier couldn't hold 60 fps at native resolution on this screen last time
    if (auto && quality === 'high' && recallLowTier(container.clientWidth, container.clientHeight)) quality = 'low'
    // the depth textures feed the ink passes (with MSAA the world's is the resolved copy)
    const worldTarget = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        samples: quality === 'high' ? 4 : 0,
        depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType)
    })
    // the chain's two buffers (the composer clones this one): the viewmodel draws into them
    const target = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType)
    })
    const composer = new EffectComposer(renderer, target)
    let worldPass: WorldPass | null = null
    let vmPass: LayerPass | null = null
    let inks: DfInkPass[] = []
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.38, 0.92)
    bloom.enabled = quality === 'high'
    bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader
        .replace('void main() {', `${DF_FINITE_GLSL}\nvoid main() {`)
        .replace('texture2D( tDiffuse, vUv )', 'dfFinite( texture2D( tDiffuse, vUv ) )')
    const grade = new ShaderPass(GRADE_SHADER)
    const gu = grade.uniforms as typeof GRADE_SHADER.uniforms

    let pr = 1
    let width = 1
    let height = 1
    let clock = 0
    let sized = false
    /** Adaptive resolution: rare, hysteretic steps (each one reallocates the post chain). */
    const governor = dfNewPrGovernor(pr)
    let prBounds = { min: 1, max: 1 }
    let boundsAt = 0
    /** A hitch would go unnoticed right now (see `setQuiet`). */
    let quiet = true
    let lastDpr = 0
    /** The lowest ratio still ran long: the next match starts on the lighter tier. */
    let strained = false

    /** The ratio this screen settled at last time (a match starts there, not at the ceiling). */
    function recall(): number | null {
        try {
            const v = Number(localStorage.getItem(dfPrMemoryKey(window.devicePixelRatio || 1, width, height, quality)))
            return v > 0 ? v : null
        } catch {
            return null
        }
    }
    function remember(): void {
        try {
            localStorage.setItem(dfPrMemoryKey(window.devicePixelRatio || 1, width, height, quality), String(pr))
        } catch {
            // private mode: start from the ceiling next time
        }
    }

    function bounds() {
        return dfPixelRatioBounds(window.devicePixelRatio || 1, width, height, quality)
    }

    function apply(): void {
        renderer.setPixelRatio(pr)
        renderer.setSize(width, height, false)
        composer.setPixelRatio(pr)
        composer.setSize(width, height)
        worldTarget.setSize(width * pr, height * pr)
        gu.uRes.value.set(width * pr, height * pr)
        gu.uPr.value = pr
        for (const ink of inks) ink.setPixelRatio(pr)
    }

    function resize(): void {
        const w = Math.max(1, container.clientWidth)
        const h = Math.max(1, container.clientHeight)
        // the observer's first callback repeats the setup size: reallocating the post chain for nothing is a hitch
        if (sized && w === width && h === height && window.devicePixelRatio === lastDpr) return
        lastDpr = window.devicePixelRatio
        width = w
        height = h
        const b = bounds()
        prBounds = b
        pr = Math.min(b.max, Math.max(b.min, sized ? pr : (recall() ?? b.max)))
        sized = true
        governor.pr = pr
        apply()
    }

    const api: DfRenderer = {
        renderer,
        canvas,
        quality,
        get pixelRatio() {
            return pr
        },
        get bufferWidth() {
            return Math.round(width * pr)
        },
        get bufferHeight() {
            return Math.round(height * pr)
        },
        setScenes(scene, camera, vmScene, vmCamera) {
            composer.passes.length = 0
            worldPass = new WorldPass(scene, camera, worldTarget)
            vmPass = new LayerPass(vmScene, vmCamera)
            for (const ink of inks) ink.dispose()
            const lineWidth = quality === 'high' ? 1.9 : 1.3
            inks = [
                new DfInkPass(camera, { source: worldTarget, width: lineWidth, fade: 1, strength: 0.92 }),
                new DfInkPass(vmCamera, { width: lineWidth, fade: 0, strength: 0.95 })
            ]
            composer.addPass(worldPass)
            composer.addPass(inks[0]!)
            composer.addPass(vmPass)
            composer.addPass(inks[1]!)
            composer.addPass(bloom)
            composer.addPass(grade)
            resize()
        },
        resize,
        setQuiet(on) {
            quiet = on
        },
        render(dt, time, g) {
            clock += dt
            // adaptive resolution: back off when frames run long, creep back when they don't
            // (the bounds follow the screen: a window dragged to another display changes the dpr)
            if (clock >= boundsAt) {
                boundsAt = clock + 0.5
                prBounds = bounds()
            }
            const next = dfStepPrGovernor(governor, dt, clock, prBounds, quiet)
            if (next !== pr) {
                pr = next
                apply()
                remember()
            }
            if (auto && quality === 'high' && !strained && dfPrStrained(governor)) {
                // the world's lights and shadows are built for the tier, so the switch waits for the
                // next match; bloom can go now
                strained = true
                bloom.enabled = false
                rememberLowTier(width, height)
            }
            if (import.meta.dev) {
                // dev: window.__dfGrade = { lowHealth, damage, down, flash } pins the grade inputs
                const o = (window as unknown as { __dfGrade?: Partial<DfGradeInput> }).__dfGrade
                if (o) g = { ...g, ...o }
            }
            gu.uTime.value = time % 1000
            gu.uLowHealth.value = g.lowHealth
            gu.uDamage.value = g.damage
            gu.uDown.value = g.down
            gu.uFlash.value = g.flash
            gu.uExposure.value = renderer.toneMappingExposure
            composer.render(dt)
        },
        dispose() {
            composer.passes.length = 0
            for (const ink of inks) ink.dispose()
            bloom.dispose()
            grade.dispose()
            composer.dispose()
            target.dispose()
            worldTarget.dispose()
            renderer.dispose()
            canvas.remove()
        }
    }
    return api
}
