// Void Runner — the backdrop: a procedural nebula dome, a star field, a sun
// and a distant planet with an atmosphere. Everything follows the camera so
// it reads as infinitely far away.

import * as THREE from 'three'
import { LineBatch } from './fx'
import { mulberry32 } from './models'

const NEBULA_VERT = /* glsl */`
varying vec3 vDir;
void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = vec4(p.xy, p.w * 0.999995, p.w);
}`

const NEBULA_FRAG = /* glsl */`
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSeed;
varying vec3 vDir;

float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3) + uSeed);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 6; i++) {
        v += a * noise(p);
        p = p * 2.03 + vec3(1.7, 9.2, 3.1);
        a *= 0.5;
    }
    return v;
}
void main() {
    vec3 d = normalize(vDir);
    // Domain-warped clouds, concentrated in a band across the sky.
    vec3 q = vec3(fbm(d * 2.0), fbm(d * 2.0 + vec3(5.2, 1.3, 2.8)), fbm(d * 2.0 + vec3(1.1, 7.4, 3.3)));
    float n = fbm(d * 3.0 + q * 2.2);
    float band = exp(-pow(dot(d, normalize(vec3(0.3, 1.0, 0.2))) * 2.2, 2.0));
    float cloud = smoothstep(0.28, 0.72, n) * (0.3 + band * 0.9);
    float wisps = smoothstep(0.45, 0.8, fbm(d * 7.0 + q * 3.0)) * band;
    float dark = smoothstep(0.5, 0.7, fbm(d * 5.0 + 11.0)) * 0.55;

    vec3 col = uDeep * 1.5 + uMid * 0.08;
    col = mix(col, uMid * 1.4, cloud * (1.0 - dark * 0.7));
    col += uHigh * wisps * 0.35 * (1.0 - dark);
    col += uHigh * pow(cloud, 2.5) * 0.3;

    // Tiny background stars baked into the dome.
    vec3 sd = d * 420.0;
    float s = hash(floor(sd));
    float star = step(0.9965, s) * smoothstep(0.5, 0.0, length(fract(sd) - 0.5));
    col += vec3(star) * (0.6 + 0.8 * hash(floor(sd) + 3.0));

    // Sun glow.
    float sun = max(0.0, dot(d, uSunDir));
    col += uSunColor * (pow(sun, 2500.0) * 18.0 + pow(sun, 260.0) * 0.3 + pow(sun, 24.0) * 0.03);

    // Keep the backdrop well below the brightness of anything you can shoot.
    gl_FragColor = vec4(col * 0.72, 1.0);
}`

const ATMO_VERT = /* glsl */`
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorldNormal;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w * 0.99997;
}`

const ATMO_FRAG = /* glsl */`
uniform vec3 uColor;
uniform vec3 uSunDir;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vWorldNormal;
void main() {
    float rim = pow(1.0 - max(0.0, dot(vNormal, vView)), 3.0);
    float lit = smoothstep(-0.3, 0.6, dot(vWorldNormal, uSunDir));
    gl_FragColor = vec4(uColor * rim * lit * 2.5, 1.0);
}`

/**
 * The backdrop lives a few hundred units from the camera, but it must never
 * cover the world. Pinning its depth just in front of the far plane keeps it
 * behind everything while still letting it hide the stars behind it.
 */
function pushToFarPlane(material: THREE.Material, depth: number) {
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `#include <project_vertex>\n    gl_Position.z = gl_Position.w * ${depth.toFixed(5)};`
        )
    }
}

export interface Sky {
    group: THREE.Group
    sunDirection: THREE.Vector3
    sunColor: THREE.Color
    update(camera: THREE.Camera, time: number): void
    dispose(): void
}

export function createSky(palette: readonly [number, number, number], seed: number): Sky {
    const rng = mulberry32(seed)
    const group = new THREE.Group()
    const deep = new THREE.Color(palette[0])
    const mid = new THREE.Color(palette[1])
    const high = new THREE.Color(palette[2])
    const sunDirection = new THREE.Vector3(0.6, 0.35, -0.72).normalize()
    const sunColor = new THREE.Color(1, 0.9, 0.78).lerp(high, 0.25)

    const dome = new THREE.Mesh(
        new THREE.SphereGeometry(10, 48, 24),
        new THREE.ShaderMaterial({
            uniforms: {
                uDeep: { value: deep },
                uMid: { value: mid.clone().multiplyScalar(0.55 * Math.min(1, 0.22 / Math.max(0.01, mid.r * 0.3 + mid.g * 0.6 + mid.b * 0.1 + 0.08))) },
                uHigh: { value: high },
                uSunDir: { value: sunDirection },
                uSunColor: { value: sunColor },
                uSeed: { value: rng() * 10 }
            },
            vertexShader: NEBULA_VERT,
            fragmentShader: NEBULA_FRAG,
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,
            toneMapped: false
        })
    )
    dome.renderOrder = -100
    dome.frustumCulled = false
    group.add(dome)

    // Brighter foreground stars as points, with a little colour and twinkle.
    const starCount = 2200
    const positions = new Float32Array(starCount * 3)
    const colors = new Float32Array(starCount * 3)
    const sizes = new Float32Array(starCount)
    const c = new THREE.Color()
    for (let i = 0; i < starCount; i++) {
        const u = rng() * 2 - 1
        const t = rng() * Math.PI * 2
        const r = Math.sqrt(1 - u * u)
        positions[i * 3] = r * Math.cos(t) * 900
        positions[i * 3 + 1] = u * 900
        positions[i * 3 + 2] = r * Math.sin(t) * 900
        const k = rng()
        c.setHSL(k < 0.3 ? 0.6 : k < 0.5 ? 0.08 : 0.15, 0.4 * rng(), 0.75 + rng() * 0.25)
        const bright = rng() < 0.04 ? 2.5 : 0.7 + rng()
        colors[i * 3] = c.r * bright
        colors[i * 3 + 1] = c.g * bright
        colors[i * 3 + 2] = c.b * bright
        sizes[i] = rng() < 0.03 ? 3.4 : 1 + rng() * 1.3
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    starGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    const starMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(2, window.devicePixelRatio) } },
        vertexShader: /* glsl */`
            attribute vec3 aColor;
            attribute float aSize;
            uniform float uTime;
            uniform float uPixelRatio;
            varying vec3 vColor;
            void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_Position.z = gl_Position.w * 0.99999;
                float tw = 0.75 + 0.25 * sin(uTime * (1.0 + fract(position.x) * 3.0) + position.y);
                vColor = aColor * tw;
                gl_PointSize = aSize * uPixelRatio;
            }`,
        fragmentShader: /* glsl */`
            varying vec3 vColor;
            void main() {
                float r = length(gl_PointCoord - 0.5) * 2.0;
                float a = exp(-r * r * 4.0);
                gl_FragColor = vec4(vColor * a, 1.0);
            }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
    })
    const stars = new THREE.Points(starGeo, starMat)
    stars.frustumCulled = false
    stars.renderOrder = -90
    group.add(stars)

    // A planet hanging in the distance, opposite-ish to the sun.
    const planetGroup = new THREE.Group()
    const planetDir = new THREE.Vector3(-0.55 + rng() * 0.3, -0.25 + rng() * 0.2, -0.8).normalize()
    let planetGeo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 4)
    const pc = new Float32Array(planetGeo.attributes.position!.count * 3)
    const pp = planetGeo.attributes.position as THREE.BufferAttribute
    const base = mid.clone().lerp(new THREE.Color(0x888888), 0.35)
    for (let i = 0; i < pp.count; i++) {
        const y = pp.getY(i)
        const band = Math.sin(y * 9 + Math.sin(pp.getX(i) * 3) * 0.8) * 0.5 + 0.5
        c.copy(base).lerp(high, band * 0.35).multiplyScalar(0.55 + band * 0.45)
        pc[i * 3] = c.r
        pc[i * 3 + 1] = c.g
        pc[i * 3 + 2] = c.b
    }
    planetGeo.setAttribute('color', new THREE.BufferAttribute(pc, 3))
    planetGeo.computeVertexNormals()
    const planetMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 })
    pushToFarPlane(planetMat, 0.99998)
    const planet = new THREE.Mesh(planetGeo, planetMat)
    planet.scale.setScalar(120)
    const atmo = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.06, 4),
        new THREE.ShaderMaterial({
            uniforms: { uColor: { value: high.clone() }, uSunDir: { value: sunDirection } },
            vertexShader: ATMO_VERT,
            fragmentShader: ATMO_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.FrontSide,
            toneMapped: false
        })
    )
    atmo.scale.setScalar(120)
    planetGroup.add(planet, atmo)
    if (rng() < 0.6) {
        const ringGeo = new THREE.RingGeometry(1.4, 2.3, 96, 1)
        // Banded, mostly transparent ring: alpha comes from a 1D stripe texture sampled by radius.
        const bands = document.createElement('canvas')
        bands.width = 256
        bands.height = 1
        const bctx = bands.getContext('2d')!
        for (let x = 0; x < 256; x++) {
            const t = x / 255
            const a = (0.25 + 0.75 * Math.abs(Math.sin(t * 23 + Math.sin(t * 7) * 2))) * Math.sin(t * Math.PI) * (rng() < 0.08 ? 0.2 : 1)
            bctx.fillStyle = `rgba(255,255,255,${(a * 0.5).toFixed(3)})`
            bctx.fillRect(x, 0, 1, 1)
        }
        const uv = ringGeo.attributes.uv as THREE.BufferAttribute
        const rp = ringGeo.attributes.position as THREE.BufferAttribute
        for (let i = 0; i < uv.count; i++) {
            const r = Math.hypot(rp.getX(i), rp.getY(i))
            uv.setXY(i, (r - 1.4) / 0.9, 0.5)
        }
        const ringMat = new THREE.MeshBasicMaterial({ color: high.clone().lerp(new THREE.Color(0xffffff), 0.3).multiplyScalar(0.55), map: new THREE.CanvasTexture(bands), transparent: true, side: THREE.DoubleSide, depthWrite: false })
        pushToFarPlane(ringMat, 0.99996)
        const ringMesh = new THREE.Mesh(ringGeo, ringMat)
        ringMesh.scale.setScalar(120)
        ringMesh.rotation.x = Math.PI / 2 - 0.35
        ringMesh.rotation.y = 0.3
        planetGroup.add(ringMesh)
    }
    planetGroup.position.copy(planetDir).multiplyScalar(700)
    planetGroup.rotation.set(0.3, rng() * 6, 0.2)
    // The planet gets its own light so it is lit by the sun regardless of distance.
    group.add(planetGroup)

    return {
        group,
        sunDirection,
        sunColor,
        update(camera, time) {
            group.position.copy(camera.position)
            starMat.uniforms.uTime!.value = time
            planetGroup.rotation.y += 0.00005
        },
        dispose() {
            group.traverse((o) => {
                const m = o as THREE.Mesh
                m.geometry?.dispose()
                const mat = m.material as THREE.Material | undefined
                mat?.dispose()
            })
            planetGeo.dispose()
            planetGeo = null as unknown as THREE.BufferGeometry
        }
    }
}

const DUST_VERT = /* glsl */`
uniform float uScale;
uniform float uSize;
uniform float uHalf;
uniform float uMaxPx;
varying float vFade;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = max(0.001, -mv.z);
    float size = uSize * uScale / d;
    // Dust brushing past the lens must not balloon into a screen-sized
    // disc: cap the sprite and fade it out close up and at the wrap edge.
    gl_PointSize = clamp(size, 1.0, uMaxPx);
    vFade = smoothstep(3.0, 12.0, d) * (1.0 - smoothstep(uHalf, uHalf * 1.7, length(mv.xyz))) * min(1.0, size);
    gl_Position = projectionMatrix * mv;
}`

const DUST_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(0.0, 1.0, r);
    a = a * a * uOpacity * vFade;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
}`

const DUST_STREAK = new THREE.Color(0.5, 0.62, 0.82)

/**
 * Drifting dust near the camera. It is what makes speed visible in empty
 * space: points at rest, streaks when the ship is moving fast. Both blend
 * over the scene rather than adding light, so a bright nebula behind the
 * dust never pushes it over the bloom threshold into glaring blobs.
 */
export class SpaceDust {
    readonly points: THREE.Points
    readonly lines = new LineBatch(400, true)
    private positions: Float32Array
    private count: number
    private box = 140
    private material: THREE.ShaderMaterial

    constructor(count = 900) {
        this.count = count
        this.positions = new Float32Array(count * 3)
        for (let i = 0; i < count * 3; i++) this.positions[i] = (Math.random() - 0.5) * this.box
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
        this.material = new THREE.ShaderMaterial({
            vertexShader: DUST_VERT,
            fragmentShader: DUST_FRAG,
            uniforms: {
                uScale: { value: 500 },
                uSize: { value: 0.3 },
                uHalf: { value: this.box / 2 },
                uMaxPx: { value: 4 },
                uColor: { value: new THREE.Color(0x9fb6d8) },
                uOpacity: { value: 0.6 }
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            toneMapped: false
        })
        this.points = new THREE.Points(geo, this.material)
        this.points.frustumCulled = false
        this.lines.mesh.renderOrder = 29
    }

    /** `height` in device pixels. */
    setViewport(height: number, fov: number, pixelRatio: number) {
        this.material.uniforms.uScale!.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2))
        this.material.uniforms.uMaxPx!.value = 3.5 * pixelRatio
    }

    /** Wraps dust around the camera and draws velocity streaks. */
    update(camera: THREE.Vector3, velocity: THREE.Vector3) {
        const half = this.box / 2
        const speed = velocity.length()
        const streak = Math.min(1, Math.max(0, (speed - 50) / 120))
        // Streak length follows speed but stops growing, so a boost reads as
        // faster without the dust turning into long bright bars.
        const s = speed > 0 ? Math.min(0.035 * streak, 5 / speed) : 0
        const p = this.positions
        for (let i = 0; i < this.count; i++) {
            const o = i * 3
            for (let k = 0; k < 3; k++) {
                const c = k === 0 ? camera.x : k === 1 ? camera.y : camera.z
                let v = p[o + k]!
                if (v - c > half) v -= this.box
                else if (v - c < -half) v += this.box
                p[o + k] = v
            }
            if (streak > 0 && i % 3 === 0) {
                const x = p[o]!
                const y = p[o + 1]!
                const z = p[o + 2]!
                const d = Math.hypot(x - camera.x, y - camera.y, z - camera.z)
                const fade = 1 - Math.min(1, Math.max(0, (d - half) / (half * 0.7)))
                this.lines.push(x, y, z, x - velocity.x * s, y - velocity.y * s, z - velocity.z * s, DUST_STREAK, streak * 0.3 * fade, 0.04)
            }
        }
        ;(this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
        this.lines.flush()
    }
}
