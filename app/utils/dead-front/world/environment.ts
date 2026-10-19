import * as THREE from 'three'
import { DfVoxModel } from '../voxel/model'
import type { DfWorldKit, DfWorldPart } from './kit'
import { dfRng } from './util'

// Night over Sainte-Croix, voxel style: a sky gradient with blocky stars and
// a pixel moon, blue fog for depth, a cold shadow-casting moonlight with a
// soft blue fill, the land beyond the walls and blocky ruins and dead trees
// on the horizon as dark silhouettes.

/** Fog / horizon colour in linear RGB. */
export const DF_FOG_COLOR = new THREE.Color().setRGB(0.045, 0.062, 0.1)
const FOG_DENSITY = 0.0165
/** Sky fill: low enough that the lantern pools read as warm islands. */
const HEMI = 0.8
/** Direction toward the moon (and the moonlight). */
export const DF_MOON_DIR = new THREE.Vector3(-0.45, 0.62, 0.64).normalize()
const FIRE_DIR = new THREE.Vector3(0.78, 0.05, -0.62).normalize()

const SKY_VERT = /* glsl */`
    varying vec3 vDir;
    void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
    }
`

const SKY_FRAG = /* glsl */`
    uniform float uTime;
    uniform vec3 uMoon;
    uniform vec3 uMoonX;
    uniform vec3 uMoonY;
    uniform vec3 uFire;
    uniform vec3 uFog;
    uniform float uFlash;
    uniform vec4 uFlare;
    uniform float uBlood;
    varying vec3 vDir;

    float hash2(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
        vec3 d = normalize(vDir);
        float up = clamp(d.y, 0.0, 1.0);
        vec3 zenith = vec3(0.012, 0.02, 0.055);
        vec3 mid = vec3(0.03, 0.045, 0.1);
        vec3 col = mix(uFog, mid, smoothstep(0.0, 0.18, up));
        col = mix(col, zenith, smoothstep(0.15, 0.85, up));
        // Banded, blocky gradient: quantise the brightness a touch.
        float band = floor(up * 18.0) / 18.0;
        col *= 0.97 + 0.03 * fract(band * 7.13);

        // Stars: square specks on a lat-long grid, fading toward the horizon.
        vec2 sp = vec2(atan(d.z, d.x) * 160.0, asin(clamp(d.y, -1.0, 1.0)) * 160.0);
        vec2 cell = floor(sp);
        vec2 f = fract(sp);
        float h = hash2(cell);
        float star = step(0.9935, h) * step(abs(f.x - 0.5), 0.2) * step(abs(f.y - 0.5), 0.2);
        float twinkle = 0.65 + 0.35 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
        col += vec3(0.5, 0.55, 0.7) * star * twinkle * smoothstep(0.06, 0.3, up);

        // Pixel moon: a 13x13 block disc with darker blocks for craters, and a halo.
        float md = dot(d, uMoon);
        vec2 mu = vec2(dot(d, uMoonX), dot(d, uMoonY)) / 0.055;
        vec2 mq = (floor(mu * 6.5) + 0.5) / 6.5;
        float disc = step(length(mq), 1.0) * step(0.0, md);
        float crater = step(0.8, hash2(floor(mu * 6.5) + 3.0)) * 0.22 + step(0.55, length(mq - vec2(0.3, 0.2))) * 0.0;
        vec3 moonCol = vec3(1.6, 1.62, 1.75) * (1.0 - crater) * (0.86 + 0.14 * (1.0 - length(mq)));
        col = mix(col, moonCol, disc);
        float halo = smoothstep(0.93, 1.0, md);
        col += vec3(0.08, 0.1, 0.16) * halo * halo * (1.0 - disc);

        // The front burns on the horizon.
        float fire = max(dot(d, uFire), 0.0);
        col += vec3(0.16, 0.045, 0.012) * pow(fire, 10.0) * (1.0 - smoothstep(0.0, 0.25, up));

        // Artillery on the horizon: a brief orange bloom low in the sky.
        float fl = max(dot(d, uFlare.xyz), 0.0);
        float fl2 = fl * fl;
        float fl8 = fl2 * fl2 * fl2 * fl2;
        col += vec3(0.9, 0.42, 0.16) * uFlare.w * (fl8 * fl8 * 0.6 + fl8 * 0.12) * (1.0 - smoothstep(0.0, 0.35, up));

        // A new round: the sky bleeds red, deepest overhead, then drains away.
        vec3 blood = mix(vec3(0.16, 0.02, 0.012), vec3(0.07, 0.008, 0.01), smoothstep(0.0, 0.8, up));
        col = mix(col, blood + col * 0.25, uBlood * 0.85);
        col += vec3(0.3, 0.03, 0.01) * uBlood * halo * halo;

        col *= 1.0 + uFlash * 1.5;
        gl_FragColor = vec4(col, 1.0);
    }
`

export interface DfEnvironment extends DfWorldPart {
    readonly moon: THREE.DirectionalLight
    /** Lightning-like flash 0..1 (power surge, artillery). */
    flash(amount: number): void
}

export function createDfEnvironment(kit: DfWorldKit): DfEnvironment {
    const { ctx, root } = kit
    const scene = ctx.scene
    const high = kit.quality === 'high'
    const disposables: { dispose(): void }[] = []
    const keep = <T extends { dispose(): void }>(d: T): T => {
        disposables.push(d)
        return d
    }

    // ---------------------------------------------------------------- fog + background
    const prevFog = scene.fog
    const prevBg = scene.background
    scene.fog = new THREE.FogExp2(DF_FOG_COLOR.clone(), FOG_DENSITY)
    scene.background = DF_FOG_COLOR.clone()

    // ---------------------------------------------------------------- sky
    const moonX = new THREE.Vector3().crossVectors(DF_MOON_DIR, new THREE.Vector3(0, 1, 0)).normalize()
    const moonY = new THREE.Vector3().crossVectors(moonX, DF_MOON_DIR).normalize()
    const skyMat = keep(new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uMoon: { value: DF_MOON_DIR.clone() },
            uMoonX: { value: moonX },
            uMoonY: { value: moonY },
            uFire: { value: FIRE_DIR.clone() },
            uFog: { value: DF_FOG_COLOR.clone() },
            uFlash: { value: 0 },
            uFlare: { value: new THREE.Vector4(FIRE_DIR.x, 0.05, FIRE_DIR.z, 0) },
            uBlood: { value: 0 }
        },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false
    }))
    const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(1, 32, 16)), skyMat)
    sky.frustumCulled = false
    sky.renderOrder = -10
    sky.name = 'df-sky'
    root.add(sky)

    // ---------------------------------------------------------------- lights
    // A readable night: a strong blue fill so silhouettes and colours read, the
    // moon as a cold key that casts the shadows, lanterns (lights.ts) for warm pools.
    const hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(0.42, 0.52, 0.85), new THREE.Color().setRGB(0.16, 0.13, 0.1), HEMI)
    root.add(hemi)
    const moon = new THREE.DirectionalLight(new THREE.Color().setRGB(0.62, 0.74, 1.0), 1.2)
    const shadowExt = high ? 30 : 24
    moon.castShadow = true
    moon.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024)
    moon.shadow.camera.left = -shadowExt
    moon.shadow.camera.right = shadowExt
    moon.shadow.camera.top = shadowExt
    moon.shadow.camera.bottom = -shadowExt
    moon.shadow.camera.near = 1
    moon.shadow.camera.far = 140
    moon.shadow.bias = -0.0005
    moon.shadow.normalBias = 0.04
    moon.shadow.intensity = 0.8
    root.add(moon)
    root.add(moon.target)
    const moonQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(DF_MOON_DIR, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)))
    const moonQi = moonQ.clone().invert()
    const texel = (shadowExt * 2) / moon.shadow.mapSize.x

    // ---------------------------------------------------------------- land beyond the grid
    const landGeo = keep(new THREE.PlaneGeometry(700, 700, 1, 1))
    landGeo.rotateX(-Math.PI / 2)
    const landMat = keep(new THREE.MeshLambertMaterial({ color: new THREE.Color(0x3a3027) }))
    const land = new THREE.Mesh(landGeo, landMat)
    land.position.y = -0.04
    land.receiveShadow = false
    root.add(land)

    // ---------------------------------------------------------------- horizon silhouettes (ruins, dead trees)
    // Unlit and unfogged: tinted a touch darker than the horizon so they read as
    // shapes against the sky without pulling the eye.
    const rnd = dfRng(19)
    const silhouette = keep(new THREE.MeshBasicMaterial({ color: DF_FOG_COLOR.clone().multiplyScalar(0.55), fog: false }))
    const ruin = new DfVoxModel(10, 14, 6)
    const r1 = ruin.c(0xffffff)
    ruin.box(0, 0, 0, 10, 6, 6, r1).box(1, 6, 1, 4, 12, 5, r1).box(6, 6, 0, 9, 9, 6, r1).box(2, 12, 2, 3, 14, 4, r1).box(7, 9, 2, 8, 11, 3, r1)
    const ruinGeo = keep(ruin.mesh(1)!)
    const tree = new DfVoxModel(9, 16, 3)
    const t1 = tree.c(0xffffff)
    tree.box(4, 0, 1, 5, 16, 2, t1).box(1, 8, 1, 4, 9, 2, t1).box(5, 11, 1, 8, 12, 2, t1).box(1, 9, 1, 2, 12, 2, t1).box(7, 12, 1, 8, 14, 2, t1).box(3, 13, 1, 4, 15, 2, t1)
    const treeGeo = keep(tree.mesh(0.45)!)
    const N = 46
    const ruins = new THREE.InstancedMesh(ruinGeo, silhouette, N)
    const trees = new THREE.InstancedMesh(treeGeo, silhouette, N)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s3 = new THREE.Vector3()
    const p3 = new THREE.Vector3()
    for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + rnd() * 0.12
        const r = 95 + rnd() * 60
        p3.set(Math.cos(a) * r, -0.5, Math.sin(a) * r)
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2)
        const sc = 0.9 + rnd() * 1.6
        s3.set(sc * (0.8 + rnd() * 0.6), sc * (0.6 + rnd() * 0.8), sc)
        ruins.setMatrixAt(i, m4.compose(p3, q, s3))
        const a2 = a + Math.PI / N
        const r2 = 70 + rnd() * 70
        p3.set(Math.cos(a2) * r2, -0.5, Math.sin(a2) * r2)
        s3.setScalar(0.8 + rnd() * 0.9)
        trees.setMatrixAt(i, m4.compose(p3, q, s3))
    }
    ruins.frustumCulled = false
    trees.frustumCulled = false
    root.add(ruins, trees)

    // ---------------------------------------------------------------- the front burning on the horizon
    // Clusters of glowing cubes (flickering through the instance colour) and
    // slow columns of smoke rising from them, out where the shelling is.
    const unit = new DfVoxModel(1, 1, 1)
    unit.box(0, 0, 0, 1, 1, 1, unit.c(0xffffff))
    const cubeGeo = keep(unit.mesh(1, [0.5, 0, 0.5])!)
    const fireMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: true }))
    const smokeMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.85, depthWrite: false }))
    const FIRES = 7
    const EMBERS = 6
    const PUFFS = 26
    const fireBase: THREE.Vector3[] = []
    const fireAng = Math.atan2(FIRE_DIR.z, FIRE_DIR.x)
    for (let i = 0; i < FIRES; i++) {
        const a = fireAng + (i - (FIRES - 1) / 2) * 0.16 + (rnd() - 0.5) * 0.08
        const r = 120 + rnd() * 45
        fireBase.push(new THREE.Vector3(Math.cos(a) * r, -0.5, Math.sin(a) * r))
    }
    const fires = new THREE.InstancedMesh(cubeGeo, fireMat, FIRES * EMBERS)
    const smoke = new THREE.InstancedMesh(cubeGeo, smokeMat, FIRES * PUFFS)
    fires.frustumCulled = false
    smoke.frustumCulled = false
    fires.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    smoke.renderOrder = -5
    fires.renderOrder = -4
    const fireSeed = Array.from({ length: FIRES * EMBERS }, () => rnd())
    const puffSeed = Array.from({ length: FIRES * PUFFS }, () => rnd())
    const hot = new THREE.Color()
    for (let i = 0; i < FIRES * EMBERS; i++) fires.setColorAt(i, hot.setRGB(3, 1.2, 0.3))
    for (let i = 0; i < FIRES * PUFFS; i++) smoke.setColorAt(i, hot.copy(DF_FOG_COLOR))
    root.add(smoke, fires)
    let flare = 0
    let flareAt = 3
    const smokeLow = new THREE.Color().setRGB(0.16, 0.07, 0.04)
    const smokeHigh = DF_FOG_COLOR.clone().multiplyScalar(0.8)
    const fq = new THREE.Quaternion()
    const fy = new THREE.Vector3(0, 1, 0)

    let flash = 0
    // Round-start blood sky: attack, hold, slow release.
    let blood = 0
    let bloodT = -1
    let rounds = 0
    const fog = scene.fog as THREE.FogExp2
    const fogBlood = new THREE.Color().setRGB(0.085, 0.018, 0.016)
    const hemiSky = hemi.color.clone()
    const hemiWarm = new THREE.Color().setRGB(0.95, 0.55, 0.35)
    const hemiBlood = new THREE.Color().setRGB(0.75, 0.22, 0.2)
    const camPos = new THREE.Vector3()
    const ls = new THREE.Vector3()
    return {
        moon,
        flash(amount) {
            flash = Math.min(1, flash + amount)
        },
        onEvent(ev) {
            if (ev.k !== 'round') return
            // The first round starts as you arrive: only later rounds bleed the sky.
            rounds++
            if (rounds > 1 || ev.round > 1) bloodT = 0
        },
        update(dt, _world, time) {
            const cam = ctx.camera
            cam.getWorldPosition(camPos)
            sky.position.copy(camPos)
            sky.scale.setScalar(cam.far * 0.92)
            skyMat.uniforms.uTime!.value = time
            flash = Math.max(0, flash - dt * 2.5)
            // Shelling: a flare now and then, which also flares the nearest fire.
            flareAt -= dt
            if (flareAt <= 0) {
                flareAt = 2.5 + Math.random() * 7
                flare = 0.6 + Math.random() * 0.6
                const a = fireAng + (Math.random() - 0.5) * 1.1
                skyMat.uniforms.uFlare!.value.set(Math.cos(a), 0.04, Math.sin(a), 0).normalize()
            }
            flare = Math.max(0, flare - dt * 3)
            skyMat.uniforms.uFlare!.value.w = flare
            for (let f = 0; f < FIRES; f++) {
                const b = fireBase[f]!
                for (let e = 0; e < EMBERS; e++) {
                    const i = f * EMBERS + e
                    const sd = fireSeed[i]!
                    const w = 0.6 + 0.4 * Math.sin(time * (3 + sd * 4) + sd * 20)
                    const sz = (1.6 + sd * 2.2) * (0.75 + w * 0.35)
                    p3.set(b.x + (sd - 0.5) * 9 + Math.sin(i) * 2, b.y + (e % 3) * 0.8, b.z + Math.cos(i * 1.7) * 3)
                    fq.setFromAxisAngle(fy, sd * 6 + time * 0.2)
                    fires.setMatrixAt(i, m4.compose(p3, fq, s3.set(sz, sz * (1.1 + w * 0.6), sz)))
                    const k = (0.7 + w * 0.6) * (1 + flare * 0.8)
                    fires.setColorAt(i, hot.setRGB(3.2 * k, 1.15 * k, 0.28 * k))
                }
                for (let n = 0; n < PUFFS; n++) {
                    const i = f * PUFFS + n
                    const sd = puffSeed[i]!
                    const u = ((time * 0.018 * (0.8 + sd * 0.4) + n / PUFFS) % 1)
                    const h = u * 70
                    const sz = 3 + u * 11 + sd * 2
                    p3.set(b.x + Math.sin(u * 4 + sd * 9) * 3 + u * 22, b.y + 2 + h, b.z + Math.cos(u * 3 + sd * 5) * 3 + u * 6)
                    fq.setFromAxisAngle(fy, sd * 6 + u * 2)
                    smoke.setMatrixAt(i, m4.compose(p3, fq, s3.setScalar(sz)))
                    hot.copy(smokeLow).lerp(smokeHigh, Math.min(1, u * 2.2))
                    smoke.setColorAt(i, hot)
                }
            }
            fires.instanceMatrix.needsUpdate = true
            smoke.instanceMatrix.needsUpdate = true
            if (fires.instanceColor) fires.instanceColor.needsUpdate = true
            if (smoke.instanceColor) smoke.instanceColor.needsUpdate = true
            if (bloodT >= 0) {
                bloodT += dt
                blood = bloodT < 0.6 ? bloodT / 0.6 : bloodT < 2.2 ? 1 : Math.max(0, 1 - (bloodT - 2.2) / 2.6)
                blood = blood * blood * (3 - 2 * blood)
                if (bloodT > 4.8) bloodT = -1
            } else {
                blood = 0
            }
            skyMat.uniforms.uBlood!.value = blood
            fog.color.copy(DF_FOG_COLOR).lerp(fogBlood, blood * 0.7)
            ;(scene.background as THREE.Color).copy(fog.color)
            skyMat.uniforms.uFog!.value.copy(fog.color)
            skyMat.uniforms.uFlash!.value = flash
            // Shell flashes on the horizon warm the whole scene for a beat.
            hemi.color.copy(hemiSky).lerp(hemiWarm, Math.min(1, flare) * 0.3).lerp(hemiBlood, blood * 0.45)
            hemi.intensity = HEMI + flash * 2.5 + flare * 0.18
            // Shadow frustum follows the camera, snapped to whole texels so edges don't crawl.
            ls.copy(camPos).applyQuaternion(moonQi)
            ls.x = Math.round(ls.x / texel) * texel
            ls.y = Math.round(ls.y / texel) * texel
            ls.applyQuaternion(moonQ)
            moon.target.position.copy(ls)
            moon.position.copy(ls).addScaledVector(DF_MOON_DIR, 70)
            moon.target.updateMatrixWorld()
        },
        dispose() {
            scene.fog = prevFog
            scene.background = prevBg
            for (const d of disposables) d.dispose()
            ruins.dispose()
            trees.dispose()
            fires.dispose()
            smoke.dispose()
            hemi.dispose()
            moon.dispose()
        }
    }
}
