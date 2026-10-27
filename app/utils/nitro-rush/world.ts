import * as THREE from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Theme } from './config'
import {
    BILLBOARD_ADS, bannerTexture, billboardTexture, checkerTexture, concreteTexture, FACADE_TILE, facadeTextures, kerbTexture,
    PUDDLE_TILE_LENGTH, radialTexture, roadTextures, ROAD_TILE_LENGTH, skylineTexture, type FacadeKind
} from './textures'
import type { Track } from '#shared/utils/nitro-rush/track'

/**
 * The circuit and everything around it, built once from the track's
 * centreline: the wet road and its mirror, kerbs on the bends, concrete walls
 * with a neon band, floodlights, the start gantry, a grandstand and a ring of
 * city blocks. Randomness here is cosmetic (building sizes, crowd colours),
 * so it uses Math.random.
 */

const LAMP_SPACING = 34
/** Kerbs only go where the line turns tighter than this (radians per metre). */
const KERB_MIN_CURVATURE = 0.004
/** Half the jersey barrier's base; its road-side face sits on the track's wall offset. */
const WALL_BASE_HALF = 0.32
const START_LIGHTS = 5

const WetShader = {
    name: 'WetTrackReflection',
    uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        tWet: { value: null },
        uWetRepeat: { value: new THREE.Vector2(1, 1) },
        uStrength: { value: 1 }
    },
    vertexShader: /* glsl */`
        uniform mat4 textureMatrix;
        varying vec4 vProj;
        varying vec2 vUv;
        varying float vDepth;
        void main() {
            vUv = uv;
            vProj = textureMatrix * vec4(position, 1.0);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vDepth = -mv.z;
            gl_Position = projectionMatrix * mv;
        }`,
    fragmentShader: /* glsl */`
        uniform vec3 color;
        uniform sampler2D tDiffuse;
        uniform sampler2D tWet;
        uniform vec2 uWetRepeat;
        uniform float uStrength;
        varying vec4 vProj;
        varying vec2 vUv;
        varying float vDepth;
        void main() {
            vec2 wuv = vUv * uWetRepeat;
            float wet = texture2D(tWet, wuv).r;
            float puddle = smoothstep(0.4, 0.75, wet);
            vec2 grad = vec2(texture2D(tWet, wuv + vec2(0.004, 0.0)).r - wet, texture2D(tWet, wuv + vec2(0.0, 0.004)).r - wet);
            vec2 base = vProj.xy / max(vProj.w, 0.0001);
            // Wet asphalt smears reflections into vertical streaks; standing water keeps them sharp.
            float spread = mix(0.014, 0.0025, puddle);
            vec3 c = vec3(0.0);
            for (int i = -3; i <= 3; i++) {
                float fi = float(i);
                float w = 1.0 - abs(fi) * 0.25;
                c += texture2D(tDiffuse, base + vec2(grad.x * 0.25, fi * spread + grad.y * 0.25)).rgb * w;
            }
            c /= 4.0;
            float k = mix(0.22, 0.85, puddle) * uStrength;
            // Fade with distance so the far track blends into the fog.
            k *= 1.0 - smoothstep(70.0, 220.0, vDepth);
            gl_FragColor = vec4(c * color * k, 1.0);
        }`
}

const SkyShader = {
    vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */`
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uGlow;
        uniform vec3 uCloud;
        uniform vec3 uCloudLight;
        uniform float uCover;
        uniform float uMoon;
        uniform vec3 uMoonDir;
        uniform float uTime;
        varying vec3 vDir;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
            float v = 0.0;
            float a = 0.5;
            for (int i = 0; i < 5; i++) {
                v += a * noise(p);
                p *= 2.03;
                a *= 0.5;
            }
            return v;
        }

        void main() {
            vec3 d = normalize(vDir);
            float h = clamp(d.y, 0.0, 1.0);
            float k = clamp(1.0 - h * 2.4, 0.0, 1.0);
            vec3 col = mix(uTop, uHorizon, k * k);
            // City light pollution hugging the horizon.
            float glow = clamp(1.0 - h * 7.0, 0.0, 1.0);
            col += uGlow * glow * glow * 0.6;

            // Moon and its halo. Powers by repeated squaring: no pow() on a value that could go negative.
            float md = clamp(dot(d, normalize(uMoonDir)), 0.0, 1.0);
            float disc = smoothstep(0.99955, 0.9997, md);
            float halo = md * md;
            halo = halo * halo;
            halo = halo * halo;
            halo = halo * halo * halo;
            col += vec3(0.95, 0.96, 1.0) * disc * 1.6 * uMoon + vec3(0.5, 0.55, 0.7) * halo * 0.25 * uMoon;

            // Clouds: projected onto a flat layer, lit from below by the city.
            vec2 cp = d.xz / max(d.y + 0.08, 0.02) * 0.6 + vec2(uTime * 0.01, uTime * 0.004);
            float n = fbm(cp);
            float cover = smoothstep(1.0 - uCover, 1.0 - uCover + 0.35, n);
            float under = clamp(1.0 - h * 3.0, 0.0, 1.0);
            vec3 cloud = mix(uCloud, uCloudLight, under * 0.8 + n * 0.3);
            float fade = smoothstep(0.0, 0.08, d.y);
            col = mix(col, cloud, cover * fade * 0.92);
            gl_FragColor = vec4(col, 1.0);
        }`
}

/**
 * A strip laid flat along the track between two lateral offsets (+ is right
 * of the driving direction), from distance `from` to `to`. `u` runs 0 to 1
 * across, `v` is distance divided by `vScale`, so textures tile at a fixed
 * world scale.
 */
function ribbon(track: Track, from: number, to: number, latA: number, latB: number, y: number, vScale: number) {
    const samples: { s: number, x: number, z: number, tx: number, tz: number }[] = []
    const push = (s: number, i?: number) => {
        if (i === undefined) {
            const p = track.pointAt(s)
            samples.push({ s, ...p })
        } else {
            samples.push({ s, x: track.xs[i]!, z: track.zs[i]!, tx: track.txs[i]!, tz: track.tzs[i]! })
        }
    }
    push(from)
    const closed = track.closed
    const base = closed ? from - track.wrapS(from) : 0
    for (let k = track.segmentAt(from) + 1; closed || k < track.n; k++) {
        const i = k % track.n
        const s = base + track.cum[i]! + (closed ? Math.floor(k / track.n) * track.length : 0)
        if (s >= to - 1e-6) break
        if (s > from + 1e-6) push(s, i)
    }
    push(to)
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    samples.forEach((p, i) => {
        // Right of the driving direction is (-tz, tx).
        pos.push(p.x - p.tz * latA, y, p.z + p.tx * latA, p.x - p.tz * latB, y, p.z + p.tx * latB)
        uv.push(0, p.s / vScale, 1, p.s / vScale)
        if (i > 0) {
            const a = (i - 1) * 2
            index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(index)
    g.computeVertexNormals()
    return g
}

/** A profile swept down the whole course, `profile` as [toward-the-track, height] pairs from the outer foot. */
function sweep(track: Track, side: number, offset: number, profile: [number, number][]) {
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    const n = track.n
    let u0 = 0
    for (let e = 0; e < profile.length - 1; e++) {
        const [a0, y0] = profile[e]!
        const [a1, y1] = profile[e + 1]!
        const edge = Math.hypot(a1 - a0, y1 - y0)
        const start = pos.length / 3
        // A loop's last vertex repeats the first so the seam closes; an open course stops at its last point.
        for (let i = 0; i <= (track.closed ? n : n - 1); i++) {
            const k = i % n
            const s = i === n ? track.length : track.cum[k]!
            for (const [a, y] of [[a0, y0], [a1, y1]] as const) {
                const lat = side * (offset - a)
                pos.push(track.xs[k]! - track.tzs[k]! * lat, y, track.zs[k]! + track.txs[k]! * lat)
            }
            uv.push(u0, s / 4, u0 + edge, s / 4)
            if (i > 0) {
                const b = start + (i - 1) * 2
                index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
            }
        }
        u0 += edge
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(index)
    g.computeVertexNormals()
    return g
}

/** A building's walls (facade texture tiled at a fixed scale) and its roof, as separate geometries for merging. */
function buildingParts(w: number, h: number, d: number) {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(0, h / 2, 0)
    const uv = g.attributes.uv!
    // Box faces in order: +x, -x, +y, -y, +z, -z; four vertices each.
    const faceW = [d, d, w, w, w, w]
    for (let f = 0; f < 6; f++) {
        if (f === 2 || f === 3) continue
        for (let v = 0; v < 4; v++) {
            const i = f * 4 + v
            uv.setXY(i, uv.getX(i) * faceW[f]! / FACADE_TILE, uv.getY(i) * h / FACADE_TILE)
        }
    }
    const pick = (faces: number[]) => {
        const part = new THREE.BufferGeometry()
        for (const name of ['position', 'normal', 'uv']) part.setAttribute(name, g.attributes[name]!.clone())
        const src = g.index!.array
        const idx: number[] = []
        for (const f of faces) {
            for (let k = 0; k < 6; k++) idx.push(src[f * 6 + k]!)
        }
        part.setIndex(idx)
        return part
    }
    const parts = { walls: pick([0, 1, 4, 5]), roof: pick([2]) }
    g.dispose()
    return parts
}

export class World {
    readonly group = new THREE.Group()
    readonly fog: THREE.FogExp2
    readonly reflector: Reflector
    private readonly track: Track
    private readonly disposables: { dispose(): void }[] = []
    private readonly sky: THREE.ShaderMaterial
    private readonly skyGroup = new THREE.Group()
    private readonly hemi: THREE.HemisphereLight
    private readonly sun: THREE.DirectionalLight
    private readonly lampLens: THREE.MeshStandardMaterial
    private readonly lampPoolMat: THREE.MeshBasicMaterial
    private readonly lampHeads: THREE.Vector3[] = []
    private readonly beacons: THREE.MeshStandardMaterial
    private readonly starMat: THREE.PointsMaterial
    private readonly startLights: THREE.MeshStandardMaterial[] = []
    private readonly wetUniforms: typeof WetShader.uniforms
    private readonly hidden: THREE.Object3D[] = []
    private time = 0

    constructor(scene: THREE.Scene, track: Track, reflectionSize: { w: number, h: number }) {
        this.track = track
        const own = <T extends { dispose(): void }>(x: T) => {
            this.disposables.push(x)
            return x
        }
        const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
            const m = new THREE.Mesh(own(geo), mat)
            this.group.add(m)
            return m
        }
        const hw = track.halfWidth
        const wall = track.wallOffset
        const L = track.length

        this.fog = new THREE.FogExp2(0x0d0e16, 0.0022)
        scene.fog = this.fog
        this.hemi = new THREE.HemisphereLight(0x4a5070, 0x0c0a0a, 0.4)
        this.sun = new THREE.DirectionalLight(0x9fb4ff, 0.35)
        this.sun.position.set(-30, 60, -80)
        this.group.add(this.hemi, this.sun)

        // ── Track surface and its wet mirror ──
        const road = roadTextures(hw)
        for (const t of [road.map, road.normal, road.rough, road.wet]) own(t)
        const roadGeo = ribbon(track, 0, L, -hw, hw, 0, ROAD_TILE_LENGTH)
        add(roadGeo, own(new THREE.MeshStandardMaterial({
            map: road.map, normalMap: road.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: road.rough, roughness: 0.85, metalness: 0.05, envMapIntensity: 0.5
        })))
        // The mirror needs its plane in local XY; the same strip, stood up and laid back down.
        this.reflector = new Reflector(own(roadGeo.clone().rotateX(Math.PI / 2)), {
            textureWidth: reflectionSize.w,
            textureHeight: reflectionSize.h,
            clipBias: 0.003,
            color: 0xffffff,
            shader: WetShader
        })
        const refMat = this.reflector.material as THREE.ShaderMaterial
        refMat.transparent = true
        refMat.blending = THREE.AdditiveBlending
        refMat.depthWrite = false
        this.wetUniforms = refMat.uniforms as unknown as typeof WetShader.uniforms
        this.wetUniforms.tWet.value = road.wet as never
        this.wetUniforms.uWetRepeat.value.set(1, ROAD_TILE_LENGTH / PUDDLE_TILE_LENGTH)
        this.reflector.rotation.x = -Math.PI / 2
        this.reflector.position.y = 0.012
        this.reflector.renderOrder = 1
        this.group.add(this.reflector)
        // Hide camera-attached effects while the mirror view renders.
        const render = this.reflector.onBeforeRender.bind(this.reflector)
        this.reflector.onBeforeRender = (...args) => {
            const was = this.hidden.map(o => o.visible)
            for (const o of this.hidden) o.visible = false
            render(...args)
            this.hidden.forEach((o, i) => {
                o.visible = was[i]!
            })
        }

        // ── Run-off aprons, the ground, kerbs and the chequered line ──
        const apronTex = own(concreteTexture(90))
        apronTex.repeat.set(0.5, 1)
        const apronMat = own(new THREE.MeshStandardMaterial({ map: apronTex, color: 0x8a8a88, roughness: 0.9 }))
        add(ribbon(track, 0, L, hw, wall, 0.004, 3), apronMat)
        add(ribbon(track, 0, L, -wall, -hw, 0.004, 3), apronMat)
        const groundTex = own(concreteTexture(60))
        groundTex.repeat.set(2400 / 8, 2400 / 8)
        const ground = add(new THREE.PlaneGeometry(2400, 2400), own(new THREE.MeshStandardMaterial({ map: groundTex, color: 0x5a5a5c, roughness: 0.95 })))
        ground.rotation.x = -Math.PI / 2
        ground.position.y = -0.03

        const kerbMat = own(new THREE.MeshStandardMaterial({ map: own(kerbTexture()), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }))
        let runStart = -1
        for (let i = 0; i <= track.n; i++) {
            const curved = i < track.n && track.curvature[i]! > KERB_MIN_CURVATURE
            if (curved && runStart < 0) runStart = i
            if (!curved && runStart >= 0) {
                const from = track.cum[runStart]! - 3
                const to = track.cum[i]! + 3
                add(ribbon(track, from, to, -hw - 0.5, -hw + 1.1, 0.02, 4), kerbMat)
                add(ribbon(track, from, to, hw - 1.1, hw + 0.5, 0.02, 4), kerbMat)
                runStart = -1
            }
        }
        const checker = own(checkerTexture())
        checker.wrapT = THREE.RepeatWrapping
        const checkerMat = own(new THREE.MeshStandardMaterial({ map: checker, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }))
        const lines = track.closed ? [track.startS] : [track.startS, track.finishS]
        for (const at of lines) add(ribbon(track, at - 1.2, at + 1.2, -hw, hw, 0.016, 2.4), checkerMat)

        // ── Concrete walls with a neon band on the track side ──
        const concrete = own(concreteTexture(150))
        concrete.repeat.set(0.5, 0.5)
        const jersey: [number, number][] = [[0, 0], [0.64, 0], [0.64, 0.08], [0.49, 0.26], [0.41, 0.86], [0.23, 0.86], [0.15, 0.26], [0, 0.08], [0, 0]]
        const wallMat = own(new THREE.MeshStandardMaterial({ map: concrete, color: 0xb8b4ac, roughness: 0.92, side: THREE.DoubleSide }))
        for (const side of [-1, 1]) add(sweep(track, side, wall + WALL_BASE_HALF * 2, jersey), wallMat)
        // A flat sweep stood just off the sloped face; outside is pink, inside cyan.
        for (const side of [-1, 1]) {
            add(sweep(track, side, wall + 0.16, [[0, 0.46], [-0.03, 0.72]]),own(new THREE.MeshBasicMaterial({ color: side > 0 ? 0xff2bd6 : 0x3df2ff, side: THREE.DoubleSide })))
        }
        // An open course is closed off at both ends by the same wall, run straight across.
        if (!track.closed) {
            const span = (wall + WALL_BASE_HALF * 2) * 2
            const barrierGeo = own(new THREE.BoxGeometry(span, 0.86, WALL_BASE_HALF * 2).translate(0, 0.43, 0))
            const bandGeo = own(new THREE.PlaneGeometry(span - 1.3, 0.26))
            const bandMat = own(new THREE.MeshBasicMaterial({ color: 0xffd23d, side: THREE.DoubleSide }))
            for (const end of [0, L]) {
                const p = track.pointAt(end)
                // The barrier's face sits at the very end of the line; its body lies outside the course.
                const out = end === 0 ? -1 : 1
                const g = new THREE.Group()
                g.position.set(p.x + p.tx * out * WALL_BASE_HALF, 0, p.z + p.tz * out * WALL_BASE_HALF)
                g.rotation.y = Math.atan2(-p.tx, -p.tz)
                g.add(new THREE.Mesh(barrierGeo, wallMat))
                const band = new THREE.Mesh(bandGeo, bandMat)
                band.position.set(0, 0.6, out * (WALL_BASE_HALF + 0.02))
                g.add(band)
                this.group.add(g)
            }
        }

        // ── Floodlights on the walls, arms out over the track ──
        const lampCount = Math.floor(L / LAMP_SPACING)
        const n = lampCount * 2
        const metal = own(new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.45, metalness: 0.8 }))
        this.lampLens = own(new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd2a0, emissiveIntensity: 4 }))
        this.lampPoolMat = own(new THREE.MeshBasicMaterial({
            map: own(radialTexture()), color: 0xffd2a0, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false
        }))
        const inst = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
            const m = new THREE.InstancedMesh(own(geo), mat, n)
            this.group.add(m)
            own(m)
            return m
        }
        const lamps = [
            inst(new THREE.CylinderGeometry(0.08, 0.14, 11, 10).translate(0, 5.5, 0), metal),
            inst(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8).rotateZ(Math.PI / 2).translate(-1.55, 10.8, 0), metal),
            inst(new RoundedBoxGeometry(1.3, 0.22, 0.5, 2, 0.08).translate(-3.0, 10.75, 0), metal),
            inst(new THREE.BoxGeometry(1.1, 0.04, 0.34).translate(-3.0, 10.62, 0), this.lampLens)
        ]
        const pool = inst(new THREE.PlaneGeometry(11, 16).rotateX(-Math.PI / 2).translate(-3.6, 0.03, 0), this.lampPoolMat)
        pool.renderOrder = 1
        const dummy = new THREE.Object3D()
        let li = 0
        for (let k = 0; k < lampCount; k++) {
            for (const side of [-1, 1]) {
                const s = (k + (side > 0 ? 0.5 : 0)) * LAMP_SPACING
                const p = track.pointAt(s)
                const lat = side * (wall + WALL_BASE_HALF)
                // Local -x is the arm; turn it to point across the track.
                const inX = p.tz * side
                const inZ = -p.tx * side
                dummy.position.set(p.x - p.tz * lat, 0.86, p.z + p.tx * lat)
                dummy.rotation.set(0, Math.atan2(inZ, -inX), 0)
                dummy.updateMatrix()
                for (const m of lamps) m.setMatrixAt(li, dummy.matrix)
                this.lampHeads.push(new THREE.Vector3(dummy.position.x + inX * 3, 11.5, dummy.position.z + inZ * 3))
                dummy.position.y = 0
                dummy.updateMatrix()
                pool.setMatrixAt(li, dummy.matrix)
                li++
            }
        }

        // ── Gantries over the line: posts, beam, banners, and on the start one the five lights ──
        const steel = own(new THREE.MeshStandardMaterial({ color: 0x80848c, roughness: 0.4, metalness: 0.85 }))
        const postGeo = own(new THREE.BoxGeometry(0.6, 9, 0.6).translate(0, 4.5, 0))
        const beamGeo = own(new THREE.BoxGeometry((wall + 1.2) * 2 + 0.6, 2.6, 0.8))
        const bannerGeo = own(new THREE.PlaneGeometry(10, 2.5))
        const lightGeo = own(new THREE.CylinderGeometry(0.32, 0.32, 0.15, 20).rotateX(Math.PI / 2))
        const name = track.def.name.toUpperCase()
        const buildGantry = (at: number, sub: string, lights: boolean) => {
            const p = track.pointAt(at)
            const g = new THREE.Group()
            g.position.set(p.x, 0, p.z)
            g.rotation.y = Math.atan2(-p.tx, -p.tz)
            for (const side of [-1, 1]) {
                const post = new THREE.Mesh(postGeo, steel)
                post.position.x = side * (wall + 1.2)
                g.add(post)
            }
            const beam = new THREE.Mesh(beamGeo, steel)
            beam.position.y = 8.2
            g.add(beam)
            const banner = own(bannerTexture('NITRO RUSH', `${name} · ${sub}`))
            const bannerMat = own(new THREE.MeshStandardMaterial({ map: banner, emissiveMap: banner, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.5 }))
            for (const face of [1, -1]) {
                const b = new THREE.Mesh(bannerGeo, bannerMat)
                b.position.set(face * (lights ? -3.5 : 0), 8.2, face * 0.41)
                if (face < 0) b.rotation.y = Math.PI
                g.add(b)
            }
            if (lights) {
                for (let i = 0; i < START_LIGHTS; i++) {
                    const mat = own(new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff1a1a, emissiveIntensity: 0 }))
                    this.startLights.push(mat)
                    const l = new THREE.Mesh(lightGeo, mat)
                    l.position.set(3 + i * 0.95, 8.2, 0.45)
                    g.add(l)
                }
            }
            this.group.add(g)
            return g
        }
        const gantry = buildGantry(track.startS, track.closed ? 'START / FINISH' : 'START', true)
        if (!track.closed) buildGantry(track.finishS, 'FINISH', false)

        // ── Grandstand down the outside of the main straight, with a crowd ──
        const stand = new THREE.Group()
        stand.position.copy(gantry.position)
        stand.rotation.y = gantry.rotation.y
        const standLen = 220
        // On a sprint it runs from just behind the start line forward, never out past the start barrier.
        if (!track.closed) stand.translateZ(-(standLen / 2 - track.startS + 6))
        const rows = 10
        const standMat = own(new THREE.MeshStandardMaterial({ map: concrete, color: 0x7a7874, roughness: 0.9 }))
        const stepGeos: THREE.BufferGeometry[] = []
        for (let r = 0; r < rows; r++) {
            const h = 1.2 + r * 0.6
            stepGeos.push(new THREE.BoxGeometry(1.2, h, standLen).translate(wall + 5 + r * 1.2, h / 2, 0))
        }
        stand.add(new THREE.Mesh(own(mergeGeometries(stepGeos)!), standMat))
        for (const g of stepGeos) g.dispose()
        const crowd = new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.42, 0.75, 0.32)), own(new THREE.MeshStandardMaterial({ roughness: 0.8 })), rows * Math.floor(standLen / 0.75))
        own(crowd)
        const shirts = [0xff2bd6, 0x3df2ff, 0xffd23d, 0xffffff, 0x2a2a30, 0xff5a3a, 0x5b8cff, 0xa6ff4d]
        const c = new THREE.Color()
        let ci = 0
        for (let r = 0; r < rows; r++) {
            for (let z = -standLen / 2 + 0.5; z < standLen / 2 - 0.5 && ci < crowd.count; z += 0.75) {
                if (Math.random() < 0.18) continue
                dummy.position.set(wall + 5 + r * 1.2 + (Math.random() - 0.5) * 0.3, 1.2 + r * 0.6 + 0.37, z + (Math.random() - 0.5) * 0.2)
                dummy.rotation.set(0, (Math.random() - 0.5) * 0.4, 0)
                dummy.updateMatrix()
                crowd.setMatrixAt(ci, dummy.matrix)
                crowd.setColorAt(ci, c.setHex(shirts[Math.floor(Math.random() * shirts.length)]!).multiplyScalar(0.6 + Math.random() * 0.4))
                ci++
            }
        }
        crowd.count = ci
        stand.add(crowd)
        const roof = new THREE.Mesh(own(new THREE.BoxGeometry(rows * 1.2 + 6, 0.4, standLen)), steel)
        roof.position.set(wall + 4 + rows * 0.6, 14, 0)
        roof.rotation.z = -0.08
        const roofLight = new THREE.Mesh(own(new THREE.BoxGeometry(0.2, 0.08, standLen - 4)), own(new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2dc, emissiveIntensity: 3 })))
        roofLight.position.set(wall + 4, 13.4, 0)
        stand.add(roof, roofLight)
        const colGeo = own(new THREE.CylinderGeometry(0.25, 0.25, 14, 8).translate(0, 7, 0))
        for (let z = -standLen / 2 + 10; z <= standLen / 2 - 10; z += 25) {
            const col = new THREE.Mesh(colGeo, steel)
            col.position.set(wall + 5 + rows * 1.2, 0, z)
            stand.add(col)
        }
        this.group.add(stand)
        const standBox = { x: wall + 3, len: standLen / 2 + 6 }

        // ── Billboards round the infield, facing the track ──
        const boardMats = BILLBOARD_ADS.map((_, i) => {
            const t = own(billboardTexture(i))
            return own(new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.5 }))
        })
        const boardGeo = own(new THREE.PlaneGeometry(16, 8))
        const legGeo = own(new THREE.BoxGeometry(0.3, 6, 0.3).translate(0, 3, 0))
        for (let i = 0; i < 8; i++) {
            const s = (i + 0.25) / 8 * L
            const p = track.pointAt(s)
            const lat = -(wall + 14)
            const g = new THREE.Group()
            g.position.set(p.x - p.tz * lat, 0, p.z + p.tx * lat)
            // Face the oncoming cars, angled a little toward the track.
            g.rotation.y = Math.atan2(-p.tx, -p.tz) + 0.5
            const b = new THREE.Mesh(boardGeo, boardMats[i % boardMats.length]!)
            b.position.y = 9
            g.add(b)
            for (const x of [-5, 5]) {
                const leg = new THREE.Mesh(legGeo, steel)
                leg.position.x = x
                g.add(leg)
            }
            this.group.add(g)
        }

        // ── The city: blocks on a loose grid, kept clear of the circuit and the grandstand ──
        const kinds: FacadeKind[] = ['office', 'glass', 'residential', 'brick']
        const facadeMats = kinds.map((kind) => {
            const t = facadeTextures(kind)
            own(t.map)
            own(t.emissiveMap)
            own(t.roughnessMap)
            return own(new THREE.MeshStandardMaterial({
                map: t.map, emissiveMap: t.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.1, roughnessMap: t.roughnessMap,
                roughness: 1, metalness: kind === 'glass' ? 0.7 : 0.1, envMapIntensity: kind === 'glass' ? 1.2 : 0.5
            }))
        })
        const wallsByKind: THREE.BufferGeometry[][] = kinds.map(() => [])
        const roofs: THREE.BufferGeometry[] = []
        const beaconSpots: THREE.Vector3[] = []
        const toStand = new THREE.Matrix4().makeRotationY(stand.rotation.y).setPosition(stand.position).invert()
        const local = new THREE.Vector3()
        const proj = { seg: 0, s: 0, lateral: 0, tx: 0, tz: 1 }
        const CELL = 36
        for (let gx = -12; gx <= 12; gx++) {
            for (let gz = -16; gz <= 16; gz++) {
                const x = gx * CELL + (Math.random() - 0.5) * 10
                const z = gz * CELL + (Math.random() - 0.5) * 10
                const away = Math.abs(track.project(x, z, -1, proj).lateral)
                if (away < wall + 42 || away > 340) continue
                local.set(x, 0, z).applyMatrix4(toStand)
                if (local.x > 0 && local.x < standBox.x + 40 && Math.abs(local.z) < standBox.len + 20) continue
                const w = 14 + Math.random() * 14
                const d = 14 + Math.random() * 14
                const h = 12 + Math.random() * Math.random() * 110
                const kind = Math.floor(Math.random() * kinds.length)
                const parts = buildingParts(w, h, d)
                const m = new THREE.Matrix4().makeRotationY(Math.floor(Math.random() * 4) * Math.PI / 2).setPosition(x, 0, z)
                wallsByKind[kind]!.push(parts.walls.applyMatrix4(m))
                roofs.push(parts.roof.applyMatrix4(m))
                if (h > 60) beaconSpots.push(new THREE.Vector3(x, h + 0.3, z))
            }
        }
        wallsByKind.forEach((geos, k) => {
            if (!geos.length) return
            add(mergeGeometries(geos)!, facadeMats[k]!)
            for (const g of geos) g.dispose()
        })
        if (roofs.length) {
            add(mergeGeometries(roofs)!, own(new THREE.MeshStandardMaterial({ color: 0x24252a, roughness: 0.9 })))
            for (const g of roofs) g.dispose()
        }
        this.beacons = own(new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 4 }))
        if (beaconSpots.length) {
            const beacons = new THREE.InstancedMesh(own(new THREE.SphereGeometry(0.4, 8, 6)), this.beacons, beaconSpots.length)
            own(beacons)
            beaconSpots.forEach((p, i) => {
                dummy.position.copy(p)
                dummy.rotation.set(0, 0, 0)
                dummy.updateMatrix()
                beacons.setMatrixAt(i, dummy.matrix)
            })
            this.group.add(beacons)
        }

        // ── Sky dome, far skyline and stars; they ride with the camera ──
        this.sky = own(new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            uniforms: {
                uTop: { value: new THREE.Color() },
                uHorizon: { value: new THREE.Color() },
                uGlow: { value: new THREE.Color() },
                uCloud: { value: new THREE.Color() },
                uCloudLight: { value: new THREE.Color() },
                uCover: { value: 0.5 },
                uMoon: { value: 1 },
                uMoonDir: { value: new THREE.Vector3(0.35, 0.32, -1) },
                uTime: { value: 0 }
            },
            vertexShader: SkyShader.vertexShader,
            fragmentShader: SkyShader.fragmentShader
        }))
        const skyMesh = new THREE.Mesh(own(new THREE.SphereGeometry(950, 48, 24)), this.sky)
        skyMesh.renderOrder = -10
        const skylineTex = own(skylineTexture())
        skylineTex.wrapS = THREE.RepeatWrapping
        skylineTex.repeat.set(5, 1)
        const skyline = new THREE.Mesh(
            own(new THREE.CylinderGeometry(880, 880, 300, 64, 1, true)),
            own(new THREE.MeshBasicMaterial({ map: skylineTex, transparent: true, fog: false, depthWrite: false, side: THREE.BackSide }))
        )
        skyline.position.y = 130
        skyline.renderOrder = -8
        const starPos: number[] = []
        for (let i = 0; i < 900; i++) {
            const theta = Math.random() * Math.PI * 2
            const y = 0.25 + Math.random() * 0.75
            const r = Math.sqrt(1 - y * y)
            starPos.push(Math.cos(theta) * r * 900, y * 900, Math.sin(theta) * r * 900)
        }
        const starGeo = own(new THREE.BufferGeometry())
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
        this.starMat = own(new THREE.PointsMaterial({ color: 0xdfe6ff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.6, depthWrite: false }))
        const stars = new THREE.Points(starGeo, this.starMat)
        stars.renderOrder = -9
        this.skyGroup.add(skyMesh, skyline, stars)
        this.group.add(this.skyGroup)

        scene.add(this.group)
    }

    /** The floodlight head nearest a point, so a real light can ride along with it. */
    nearestLamp(x: number, z: number, out: THREE.Vector3) {
        let best = Infinity
        for (const p of this.lampHeads) {
            const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z)
            if (d < best) {
                best = d
                out.copy(p)
            }
        }
        return out
    }

    get lampColor() {
        return this.lampLens.emissive
    }

    /** Objects the wet-track mirror should not see (camera-attached effects). */
    hideFromReflection(...objects: THREE.Object3D[]) {
        this.hidden.push(...objects)
    }

    setReflectionSize(w: number, h: number) {
        this.reflector.getRenderTarget().setSize(Math.max(64, Math.round(w)), Math.max(64, Math.round(h)))
    }

    /** Point sprites are sized in drawing-buffer pixels; keep stars at 2 CSS px. */
    setPixelRatio(pr: number) {
        this.starMat.size = 2 * pr
    }

    /** `lit` red lights, or all of them green once the race is on. */
    setStartLights(lit: number, green: boolean) {
        this.startLights.forEach((m, i) => {
            m.emissive.setHex(green ? 0x2bff5a : 0xff1a1a)
            m.emissiveIntensity = green || i < lit ? 6 : 0
        })
    }

    applyTheme(t: Theme, renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
        const u = this.sky.uniforms
        u.uTop!.value.setHex(t.skyTop)
        u.uHorizon!.value.setHex(t.skyHorizon)
        u.uGlow!.value.setHex(t.glow)
        u.uCloud!.value.setHex(t.cloud)
        u.uCloudLight!.value.setHex(t.cloudLight)
        u.uCover!.value = t.cloudCover
        u.uMoon!.value = t.moon
        this.starMat.opacity = t.moon > 0 ? 0.6 * (1 - t.cloudCover * 0.6) : 0
        this.fog.color.setHex(t.fog)
        this.fog.density = t.fogDensity
        this.lampLens.emissive.setHex(t.lamp)
        this.lampPoolMat.color.setHex(t.lamp)
        this.hemi.color.setHex(t.hemiSky)
        this.hemi.groundColor.setHex(t.hemiGround)
        this.hemi.intensity = t.hemi
        this.sun.color.setHex(t.sun)
        this.sun.intensity = t.sunIntensity
        this.sun.position.set(0, t.sunHeight, -100)
        this.wetUniforms.uStrength.value = t.wet
        scene.environmentIntensity = t.env
        renderer.setClearColor(this.fog.color)
    }

    update(dt: number, camera: THREE.Camera) {
        this.time += dt
        this.sky.uniforms.uTime!.value = this.time
        this.skyGroup.position.set(camera.position.x, 0, camera.position.z)
        this.beacons.emissiveIntensity = Math.sin(this.time * 3) > 0.6 ? 5 : 0.3
    }

    dispose() {
        for (const d of this.disposables) d.dispose()
        this.reflector.dispose()
    }
}

/**
 * A night-street reflection environment for paint and glass: a dark street
 * canyon with rows of sodium and LED lamps overhead, lit windows and signage
 * along the sides, and a dim sky above. Baked once into a PMREM map.
 */
export function buildCityEnvironment(renderer: THREE.WebGLRenderer) {
    const scene = new THREE.Scene()
    const disposables: { dispose(): void }[] = []
    const own = <T extends { dispose(): void }>(x: T) => {
        disposables.push(x)
        return x
    }
    const room = new THREE.Mesh(own(new THREE.BoxGeometry(60, 30, 60)), own(new THREE.MeshBasicMaterial({ color: 0x07080c, side: THREE.BackSide })))
    room.position.y = 12
    scene.add(room)
    const panel = (color: number, intensity: number, w: number, h: number, x: number, y: number, z: number, ry = 0, rx = 0) => {
        const m = new THREE.Mesh(own(new THREE.PlaneGeometry(w, h)), own(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })))
        m.position.set(x, y, z)
        m.rotation.set(rx, ry, 0)
        scene.add(m)
    }
    // Sky glow overhead.
    panel(0x1a2238, 1, 60, 60, 0, 26.9, 0, 0, Math.PI / 2)
    // Rows of floodlights overhead.
    for (let z = -26; z <= 26; z += 6.5) {
        panel(0xffd2a0, 6, 1.6, 0.5, -5, 14, z, 0, Math.PI / 2)
        panel(0xdfe9ff, 5, 1.6, 0.5, 5, 14, z + 3, 0, Math.PI / 2)
    }
    // Lit windows and signs on the canyon walls.
    const colors = [0xffd9a0, 0xcfe6ff, 0xffc77a, 0xff3db8, 0x33f0ff, 0xffffff]
    for (let i = 0; i < 70; i++) {
        const side = i % 2 === 0 ? -1 : 1
        const c = colors[Math.floor(Math.random() * colors.length)]!
        const neon = c === 0xff3db8 || c === 0x33f0ff
        panel(c, neon ? 3 : 1.2 + Math.random(), 1 + Math.random() * (neon ? 4 : 2), 0.6 + Math.random() * 1.5, side * 29.8, 2 + Math.random() * 20, -28 + Math.random() * 56, side * Math.PI / 2)
    }
    // A bright horizon strip ahead and behind, where the road meets the city glow.
    panel(0x3a2a40, 2, 60, 6, 0, 3, -29.8)
    panel(0x2a2030, 1.5, 60, 6, 0, 3, 29.8, Math.PI)
    const pmrem = new THREE.PMREMGenerator(renderer)
    const target = pmrem.fromScene(scene, 0.02)
    pmrem.dispose()
    for (const d of disposables) d.dispose()
    return target
}
