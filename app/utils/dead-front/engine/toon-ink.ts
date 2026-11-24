import * as THREE from 'three'
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js'

// Ink outlines from the depth buffer alone, so they work with every vertex
// shader (the zombie rig, instancing) and need no extra geometry pass.
//
// 1/z is linear across the screen on a plane, so the second difference of
// (far-plane-relative) depth is zero on any flat face and jumps at creases and
// silhouettes. Divided by the pixel's angular size it is a scale-free number
// (about the change in slope, or a depth step in pixels), which makes small
// detail drop out by itself once it gets small on screen. A wide ring of taps
// draws the heavy silhouette line, a tight one the thin crease line; both are
// swell, thin and break up with low-frequency noise for a hand-inked stroke.
//
// The pass runs twice: once on the world (reading the world's own, possibly
// multisampled, target: this pass is its resolve into the post chain), once
// after the viewmodel (whose depth replaced the world's). It always copies
// colour to the other buffer: blending into the buffer whose depth it reads
// would be a feedback loop.

const INK_VERT = /* glsl */`
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`

const INK_FRAG = /* glsl */`
    uniform sampler2D tDepth;
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uPr;
    uniform float uNear;
    uniform float uFar;
    uniform float uPixAngle;
    uniform float uWidth;
    uniform float uFade;
    uniform vec3 uInk;
    uniform float uStrength;
    varying vec2 vUv;

    float dfInkHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
    float dfInkNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(dfInkHash(i), dfInkHash(i + vec2(1.0, 0.0)), u.x), mix(dfInkHash(i + vec2(0.0, 1.0)), dfInkHash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    // q is proportional to 1/z: linear in screen space on a plane
    float dfQ(vec2 uv) {
        return uFar / (uFar - uNear) - texture2D(tDepth, uv).r;
    }
    // Heavy-line measure on a ring of whole-pixel radius r: (edge strength, nearest q in the ring).
    // Mirrored pairs only: the depth texture is point sampled, and a lopsided pair reads a slope as an edge.
    vec2 dfRing(vec2 uv, float qc, float r) {
        float rd2 = max(1.0, floor(r * 0.7071 + 0.5));
        vec2 o = uTexel * r;
        vec2 od = uTexel * rd2;
        float qa = dfQ(uv + vec2(o.x, 0.0));
        float qb = dfQ(uv - vec2(o.x, 0.0));
        float qd = dfQ(uv + vec2(0.0, o.y));
        float qe = dfQ(uv - vec2(0.0, o.y));
        float qf = dfQ(uv + od);
        float qg = dfQ(uv - od);
        float qh = dfQ(uv + vec2(od.x, -od.y));
        float qi = dfQ(uv - vec2(od.x, -od.y));
        float qNear = max(max(max(qa, qb), max(qd, qe)), max(max(qf, qg), max(qh, qi)));
        qNear = max(qNear, qc);
        float lap = max(max(abs(qa + qb - 2.0 * qc), abs(qd + qe - 2.0 * qc)), max(abs(qf + qg - 2.0 * qc), abs(qh + qi - 2.0 * qc)) * (r / (rd2 * 1.4142)));
        // normalise by the nearest surface in the ring, so the line belongs to the thing in front
        return vec2(lap / (qNear * uPixAngle * r), qNear);
    }
    void main() {
        float A = uFar / (uFar - uNear);
        float qMin = uNear / (uFar - uNear);
        vec2 css = gl_FragCoord.xy / uPr;
        // the stroke swells and thins along its length
        float swell = 0.62 + 0.76 * dfInkNoise(css * 0.03 + 11.0);
        vec2 uv = vUv;
        float qc = dfQ(uv);

        // heavy line. The width is a fraction of a pixel: two rings (the whole pixels either side)
        // blend by it, so a stroke that widens with distance or swell grows smoothly instead of
        // stepping a pixel at a time (which shimmers while moving)
        float zc = uNear * A / max(qc, 1e-7);
        float thin = mix(1.0, 0.6, smoothstep(6.0, 45.0, zc * uFade));
        float rw = max(1.0, uWidth * uPr * swell * thin);
        float r0 = floor(rw);
        float fr = rw - r0;
        vec2 e0 = dfRing(uv, qc, r0);
        float heavy = smoothstep(2.2, 3.4, e0.x);
        float qNear = e0.y;
        if (fr > 0.03) {
            vec2 e1 = dfRing(uv, qc, r0 + 1.0);
            heavy = mix(heavy, smoothstep(2.2, 3.4, e1.x), fr);
            qNear = max(qNear, e1.y);
        }
        // nothing but sky (or nothing of the viewmodel) around: no line
        if (qNear <= qMin * 1.0001) {
            gl_FragColor = texture2D(tDiffuse, vUv);
            return;
        }

        // thin line: a tight cross, catches creases the ring is too coarse for
        vec2 t = uTexel;
        float ra = dfQ(uv + vec2(t.x, 0.0));
        float rb = dfQ(uv - vec2(t.x, 0.0));
        float rd = dfQ(uv + vec2(0.0, t.y));
        float re = dfQ(uv - vec2(0.0, t.y));
        float lap2 = max(abs(ra + rb - 2.0 * qc), abs(rd + re - 2.0 * qc));
        float qN2 = max(max(max(ra, rb), max(rd, re)), qc);
        float m2 = lap2 / (qN2 * uPixAngle);
        float fine = smoothstep(0.55, 1.1, m2) * 0.62;

        // distance: the nearest surface in the ring decides, creases go first
        float z = uNear * A / qNear * uFade;
        float farK = 1.0 - smoothstep(38.0, 95.0, z);
        float fineK = 1.0 - smoothstep(9.0, 30.0, z);
        float ink = max(heavy * farK, fine * fineK) * uStrength;
        // a dry-brush break in the stroke now and then
        ink *= 0.82 + 0.18 * smoothstep(0.2, 0.5, dfInkNoise(css * 0.11 + 5.0));
        vec4 c = texture2D(tDiffuse, vUv);
        gl_FragColor = vec4(mix(c.rgb, uInk, ink), c.a);
    }
`

export interface DfInkOpts {
    /** Reads colour and depth from this target instead of the chain's read buffer. */
    source?: THREE.WebGLRenderTarget
    /** Line half width in CSS pixels. */
    width: number
    /** Scales distances for the fade (the viewmodel never fades: 0). */
    fade: number
    strength: number
}

/** Inks the depth edges of whatever was last drawn into the read buffer (or `source`), into the write buffer. */
export class DfInkPass extends Pass {
    private readonly quad: FullScreenQuad
    readonly material: THREE.ShaderMaterial
    private pr = 1

    constructor(private camera: THREE.PerspectiveCamera, private opts: DfInkOpts) {
        super()
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                tDepth: { value: null },
                tDiffuse: { value: null },
                uTexel: { value: new THREE.Vector2(1, 1) },
                uPr: { value: 1 },
                uNear: { value: 0.05 },
                uFar: { value: 100 },
                uPixAngle: { value: 0.001 },
                uWidth: { value: opts.width },
                uFade: { value: opts.fade },
                uInk: { value: new THREE.Vector3(0.006, 0.006, 0.016) },
                uStrength: { value: opts.strength }
            },
            vertexShader: INK_VERT,
            fragmentShader: INK_FRAG,
            depthTest: false,
            depthWrite: false,
            toneMapped: false
        })
        this.quad = new FullScreenQuad(this.material)
    }

    setPixelRatio(pr: number): void {
        this.pr = pr
    }

    override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
        const src = this.opts.source ?? read
        const depth = src.depthTexture
        if (!depth) return
        const u = this.material.uniforms
        u.tDepth!.value = depth
        u.tDiffuse!.value = src.texture
        u.uTexel!.value.set(1 / src.width, 1 / src.height)
        u.uPr!.value = this.pr
        u.uNear!.value = this.camera.near
        u.uFar!.value = this.camera.far
        u.uPixAngle!.value = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5) / Math.max(1, src.height)
        renderer.setRenderTarget(write)
        this.quad.render(renderer)
    }

    override dispose(): void {
        this.material.dispose()
        this.quad.dispose()
    }
}
