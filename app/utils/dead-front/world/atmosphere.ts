import * as THREE from 'three'
import { DF_VOX_CELL, DF_VOX_ORIGIN } from '#shared/utils/dead-front/map-world'
import type { DfWorldKit, DfWorldPart } from './kit'

// Night air over Sainte-Croix: a low ground mist that pools in the open (never
// indoors: it is masked by the roofs in the voxel grid), drifting ash and the
// odd ember blown in from the burning front, all around the camera.

const MIST_VERT = /* glsl */`
    #include <common>
    #include <fog_pars_vertex>
    varying vec3 vWorld;
    void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }
`

const MIST_FRAG = /* glsl */`
    #include <common>
    #include <fog_pars_fragment>
    uniform sampler2D uMask;
    uniform vec4 uMaskRect;
    uniform float uTime;
    uniform float uOpacity;
    uniform float uLayer;
    uniform vec3 uColor;
    varying vec3 vWorld;

    float vhash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
    float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), u.x), mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    void main() {
        vec2 p = vWorld.xz;
        float t = uTime;
        // Two drifting octaves, pushed by a slow wind, a third that churns.
        float n = vnoise(p * 0.11 + vec2(t * 0.045, t * 0.02) + uLayer * 7.3) * 0.6
            + vnoise(p * 0.29 - vec2(t * 0.03, -t * 0.05) + uLayer * 3.1) * 0.3
            + vnoise(p * 0.7 + vec2(t * 0.11, t * 0.07)) * 0.1;
        float wisps = smoothstep(0.45, 0.9, n);
        vec2 muv = (p - uMaskRect.xy) / uMaskRect.zw;
        float mask = texture2D(uMask, clamp(muv, 0.0, 1.0)).r;
        // Thin out right around the viewer so it never smears over the lens.
        float near = smoothstep(1.2, 5.0, distance(vWorld, cameraPosition));
        float a = wisps * mask * near * uOpacity;
        gl_FragColor = vec4(uColor, a);
        #include <fog_fragment>
    }
`

/** Soft mask of open ground (1) vs roofed or walled cells (0), one texel per voxel column. */
function buildMistMask(kit: DfWorldKit): THREE.DataTexture {
    const vox = kit.world.vox
    const roofJ = Math.ceil((2.5 - DF_VOX_ORIGIN.y) / DF_VOX_CELL)
    const data = new Uint8Array(vox.sx * vox.sz)
    for (let k = 0; k < vox.sz; k++) {
        for (let i = 0; i < vox.sx; i++) {
            let open = 1
            for (let j = roofJ; j < vox.sy; j++) {
                if (vox.get(i, j, k)) {
                    open = 0
                    break
                }
            }
            data[i + k * vox.sx] = open * 255
        }
    }
    // One box blur pass so the mist feathers out at doorways and walls.
    const out = new Uint8Array(data.length)
    for (let k = 0; k < vox.sz; k++) {
        for (let i = 0; i < vox.sx; i++) {
            let sum = 0
            let n = 0
            for (let dk = -2; dk <= 2; dk++) {
                for (let di = -2; di <= 2; di++) {
                    const x = i + di
                    const z = k + dk
                    if (x < 0 || z < 0 || x >= vox.sx || z >= vox.sz) continue
                    sum += data[x + z * vox.sx]!
                    n++
                }
            }
            out[i + k * vox.sx] = Math.round(sum / n)
        }
    }
    const tex = new THREE.DataTexture(out, vox.sx, vox.sz, THREE.RedFormat, THREE.UnsignedByteType)
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearFilter
    tex.needsUpdate = true
    return tex
}

const ASH = 150
const EMBERS = 26
/** Half size of the box of air around the camera that the motes wrap within. */
const R = 13

export function createDfAtmosphere(kit: DfWorldKit): DfWorldPart {
    const { ctx, root } = kit
    const high = kit.quality === 'high'
    const disposables: { dispose(): void }[] = []

    // ---------------------------------------------------------------- ground mist
    const vox = kit.world.vox
    const mask = buildMistMask(kit)
    disposables.push(mask)
    const w = vox.sx * DF_VOX_CELL
    const d = vox.sz * DF_VOX_CELL
    const planeGeo = new THREE.PlaneGeometry(w, d, 1, 1)
    planeGeo.rotateX(-Math.PI / 2)
    disposables.push(planeGeo)
    const mistColor = new THREE.Color().setRGB(0.085, 0.1, 0.145)
    const layers = high ? [0.12, 0.34, 0.6] : [0.2, 0.5]
    const mistMats: THREE.ShaderMaterial[] = []
    const mists: THREE.Mesh[] = []
    layers.forEach((y, n) => {
        const m = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
                uMask: { value: mask },
                uMaskRect: { value: new THREE.Vector4(DF_VOX_ORIGIN.x, DF_VOX_ORIGIN.z, w, d) },
                uTime: { value: 0 },
                uOpacity: { value: (high ? 0.3 : 0.38) * (1 - n * 0.25) },
                uLayer: { value: n },
                uColor: { value: mistColor }
            }]),
            vertexShader: MIST_VERT,
            fragmentShader: MIST_FRAG,
            transparent: true,
            depthWrite: false,
            fog: true
        })
        // The mask texture must not be cloned by the merge.
        m.uniforms.uMask!.value = mask
        mistMats.push(m)
        disposables.push(m)
        const mesh = new THREE.Mesh(planeGeo, m)
        mesh.position.set(DF_VOX_ORIGIN.x + w / 2, y, DF_VOX_ORIGIN.z + d / 2)
        mesh.renderOrder = 2
        mesh.frustumCulled = false
        mesh.name = 'df-mist'
        root.add(mesh)
        mists.push(mesh)
    })

    // ---------------------------------------------------------------- ash and embers
    const cube = new THREE.BoxGeometry(1, 1, 1)
    disposables.push(cube)
    const ashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, fog: true })
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    disposables.push(ashMat, emberMat)
    const ashN = high ? ASH : Math.round(ASH * 0.5)
    const ash = new THREE.InstancedMesh(cube, ashMat, ashN)
    const embers = new THREE.InstancedMesh(cube, emberMat, EMBERS)
    for (const m of [ash, embers]) {
        m.frustumCulled = false
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        m.renderOrder = 5
        root.add(m)
    }
    interface Mote { x: number, y: number, z: number, seed: number, size: number }
    const spawn = (n: number): Mote[] => Array.from({ length: n }, () => ({
        x: (Math.random() * 2 - 1) * R,
        y: Math.random() * 9,
        z: (Math.random() * 2 - 1) * R,
        seed: Math.random(),
        size: 0
    }))
    const ashM = spawn(ashN)
    const emberM = spawn(EMBERS)
    for (const e of emberM) e.size = 0.025 + e.seed * 0.03
    for (const a of ashM) a.size = 0.018 + a.seed * 0.022
    const col = new THREE.Color()
    const ashCol = new THREE.Color().setRGB(0.07, 0.072, 0.085)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e3 = new THREE.Euler()
    const v3 = new THREE.Vector3()
    const s3 = new THREE.Vector3()
    const cam = new THREE.Vector3()
    const bufSize = new THREE.Vector2()
    const wrap = (v: number, c: number) => {
        const r = v - c
        return r > R ? v - 2 * R : r < -R ? v + 2 * R : v
    }

    let time = 0
    return {
        update(dt) {
            time += dt
            for (const m of mistMats) m.uniforms.uTime!.value = time
            ctx.camera.getWorldPosition(cam)
            ctx.renderer.getDrawingBufferSize(bufSize)
            // Metres per pixel at 1 m, for a minimum on-screen size of ~1.6 px.
            const mpp = 2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) * 0.5) / Math.max(1, bufSize.y)
            const windX = 0.35 + Math.sin(time * 0.13) * 0.25
            const windZ = 0.12 + Math.cos(time * 0.09) * 0.15
            for (let i = 0; i < ashM.length; i++) {
                const a = ashM[i]!
                a.x = wrap(a.x + (windX + Math.sin(time * 0.7 + a.seed * 30) * 0.25) * dt, cam.x)
                a.z = wrap(a.z + (windZ + Math.cos(time * 0.6 + a.seed * 20) * 0.25) * dt, cam.z)
                a.y -= (0.12 + a.seed * 0.18) * dt
                if (a.y < cam.y - 2.5) a.y += 9
                if (a.y > cam.y + 6.5) a.y -= 9
                v3.set(a.x, a.y, a.z)
                const dist = v3.distanceTo(cam)
                const minS = dist * mpp * 1.6
                const s = Math.max(a.size, minS)
                e3.set(time * (0.6 + a.seed), a.seed * 9, time * 0.4)
                ash.setMatrixAt(i, m4.compose(v3, q.setFromEuler(e3), s3.set(s, s * 0.35, s)))
                // Dim motes that only got bigger to stay visible, and fade very close ones.
                const k = (a.size / s) * Math.min(1, dist / 1.5)
                ash.setColorAt(i, col.copy(ashCol).multiplyScalar(k))
            }
            for (let i = 0; i < emberM.length; i++) {
                const e = emberM[i]!
                e.x = wrap(e.x + (windX * 1.6 + Math.sin(time * 1.3 + e.seed * 40) * 0.4) * dt, cam.x)
                e.z = wrap(e.z + (windZ * 1.6 + Math.cos(time * 1.1 + e.seed * 17) * 0.4) * dt, cam.z)
                e.y += (0.15 + e.seed * 0.25) * dt
                if (e.y > cam.y + 6.5) e.y -= 9
                if (e.y < cam.y - 2.5) e.y += 9
                v3.set(e.x, e.y, e.z)
                const dist = v3.distanceTo(cam)
                const s = Math.max(e.size, dist * mpp * 1.8)
                e3.set(time * 2 + e.seed * 9, time * 1.5, e.seed * 5)
                embers.setMatrixAt(i, m4.compose(v3, q.setFromEuler(e3), s3.setScalar(s)))
                const flick = 0.55 + 0.45 * Math.sin(time * (5 + e.seed * 7) + e.seed * 50)
                const k = (e.size / s) * (e.size / s) * flick * Math.max(0, 1 - dist / (R * 1.1))
                embers.setColorAt(i, col.setRGB(2.4 * k, 0.75 * k, 0.18 * k))
            }
            for (const m of [ash, embers]) {
                m.instanceMatrix.needsUpdate = true
                if (m.instanceColor) m.instanceColor.needsUpdate = true
            }
        },
        dispose() {
            for (const m of mists) m.removeFromParent()
            ash.removeFromParent()
            embers.removeFromParent()
            ash.dispose()
            embers.dispose()
            for (const x of disposables) x.dispose()
        }
    }
}
