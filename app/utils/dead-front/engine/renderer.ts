import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { dfNewPrGovernor, dfPixelRatioBounds, dfStepPrGovernor } from './resolution'

// Renderer + post chain:
//   world RenderPass -> viewmodel pass (same buffer, depth cleared) -> bloom
//   -> grade pass (ACES, sRGB, a light split-tone, vignette, faint grain, damage, downed).
// The viewmodel is drawn into the HDR buffer before bloom and grading, so it
// gets the same look and its muzzle flashes bloom.

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
        uGrain: { value: 0.012 }
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

        vec3 dfRrtOdtFit(vec3 v) {
            vec3 a = v * (v + 0.0245786) - 0.000090537;
            vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
            return a / b;
        }
        vec3 dfAces(vec3 color) {
            const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
            const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
            color = inM * (color / 0.6);
            color = dfRrtOdtFit(color);
            return clamp(outM * color, 0.0, 1.0);
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
                    acc += texture2D(tDiffuse, uv - fromC * k * 0.05 * uDown).rgb;
                }
                hdr = acc / 8.0;
            } else if (uDamage > 0.02) {
                // a little chromatic split on hits
                vec2 o = fromC * 0.006 * uDamage;
                hdr = vec3(texture2D(tDiffuse, uv + o).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - o).b);
            } else {
                hdr = texture2D(tDiffuse, uv).rgb;
            }
            hdr = max(hdr, vec3(0.0)) * uExposure * (1.0 + uFlash);
            vec3 c = dfToSrgb(dfAces(hdr));

            float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
            // a light split tone (cool shadows, warm highlights) that keeps the voxel colours crisp
            vec3 shadowTint = vec3(0.95, 0.99, 1.04);
            vec3 highTint = vec3(1.03, 1.0, 0.95);
            c *= mix(shadowTint, highTint, smoothstep(0.04, 0.75, l));
            // a touch of contrast and saturation
            c = mix(vec3(l), c, 1.08);
            c = clamp((c - 0.5) * 1.04 + 0.5, 0.0, 1.0);

            float desat = max(uLowHealth * 0.6, uDown * 0.9);
            c = mix(c, vec3(l) * vec3(1.02, 0.99, 0.96), desat);

            // vignette (aspect correct)
            vec2 q = fromC * vec2(uRes.x / max(uRes.y, 1.0), 1.0);
            float r = length(q);
            float vig = smoothstep(0.45, 1.15, r);
            c *= 1.0 - vig * (0.32 + uDown * 0.45);

            // blood at the edges with damage and low health, pulsing with the heartbeat when low
            float pulse = 0.85 + 0.15 * sin(uTime * 7.0);
            float red = clamp(uLowHealth * 0.75 * pulse + uDamage * 0.9, 0.0, 1.0) * smoothstep(0.2, 0.95, r);
            c = mix(c, vec3(0.32, 0.015, 0.01) * (0.6 + 0.4 * l), red * 0.85);

            // film grain sized in CSS pixels, plus a faint gate flicker
            vec2 g = floor(gl_FragCoord.xy / max(uPr, 1.0));
            float n = hash(g + fract(uTime * 13.7) * vec2(173.0, 91.0)) - 0.5;
            c += n * uGrain * (1.15 - l * 0.6);
            // dither against banding in the dark sky
            c += (hash(gl_FragCoord.xy * 1.37 + 11.0) - 0.5) / 255.0;
            gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }
    `
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

    const quality = opts.quality === 'low' || opts.quality === 'high' ? opts.quality : detectQuality(renderer.getContext())
    const target = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        samples: quality === 'high' ? 4 : 0
    })
    const composer = new EffectComposer(renderer, target)
    let worldPass: RenderPass | null = null
    let vmPass: LayerPass | null = null
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.38, 0.92)
    bloom.enabled = quality === 'high'
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

    function bounds() {
        return dfPixelRatioBounds(window.devicePixelRatio || 1, width, height, quality)
    }

    function apply(): void {
        renderer.setPixelRatio(pr)
        renderer.setSize(width, height, false)
        composer.setPixelRatio(pr)
        composer.setSize(width, height)
        gu.uRes.value.set(width * pr, height * pr)
        gu.uPr.value = pr
    }

    function resize(): void {
        const w = Math.max(1, container.clientWidth)
        const h = Math.max(1, container.clientHeight)
        width = w
        height = h
        const b = bounds()
        prBounds = b
        pr = Math.min(b.max, Math.max(b.min, sized ? pr : b.max))
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
            worldPass = new RenderPass(scene, camera)
            vmPass = new LayerPass(vmScene, vmCamera)
            composer.addPass(worldPass)
            composer.addPass(vmPass)
            composer.addPass(bloom)
            composer.addPass(grade)
            resize()
        },
        resize,
        render(dt, time, g) {
            clock += dt
            // adaptive resolution: back off when frames run long, creep back when they don't
            // (the bounds follow the screen: a window dragged to another display changes the dpr)
            if (clock >= boundsAt) {
                boundsAt = clock + 0.5
                prBounds = bounds()
            }
            const next = dfStepPrGovernor(governor, dt, clock, prBounds)
            if (next !== pr) {
                pr = next
                apply()
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
            bloom.dispose()
            grade.dispose()
            composer.dispose()
            target.dispose()
            renderer.dispose()
            canvas.remove()
        }
    }
    return api
}
