import * as THREE from 'three'
import { dfPatchVoxGlow } from '../voxel/material'
import type { DfWorldKit, DfWorldPart } from './kit'

// Night over Sainte-Croix, painted: gouache washes for the sky, brush-dab
// stars, a big inked moon with a ringed halo, flat clouds with a moonlit rim,
// and the skyline (hills, the ruined town, bare trees, the front burning with
// its smoke) drawn in the sky shader as layered silhouettes. Blue-violet fog
// for depth, a cold shadow-casting moonlight with a violet fill, the land
// beyond the walls.

/** Fog / horizon colour in linear RGB. */
export const DF_FOG_COLOR = new THREE.Color().setRGB(0.048, 0.06, 0.115)
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

    float hash1(float p) {
        p = fract(p * 0.1031);
        p *= p + 33.33;
        p *= p + p;
        return fract(p);
    }
    float hash2(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
    float noise1(float x) {
        float i = floor(x);
        float f = fract(x);
        return mix(hash1(i), hash1(i + 1.0), f * f * (3.0 - 2.0 * f));
    }
    float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
        float a = 0.5;
        float v = 0.0;
        for (int i = 0; i < DF_SKY_OCTAVES; i++) {
            v += a * noise2(p);
            p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.1;
            a *= 0.5;
        }
        return v;
    }
    float seg(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a;
        vec2 ba = b - a;
        return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
    }
    // a dab of the brush: a four-point sparkle for the big stars, a blot for the small
    float starDab(vec2 f, float size, float spark) {
        vec2 a = abs(f);
        float len = length(f);
        float blot = 1.0 - smoothstep(size * 0.24, size * 0.34, length(f * vec2(1.0, 1.2)));
        float k = size * size * 0.035 * max(0.0, 1.0 - len / size) + 1e-6;
        float rays = (1.0 - smoothstep(k * 0.55, k, a.x * a.y)) * (1.0 - smoothstep(size * 0.75, size, len));
        return max(blot, rays * spark);
    }
    float starLayer(vec2 sp, float density, float size, out float tw) {
        vec2 cell = floor(sp);
        float h = hash2(cell);
        vec2 c = vec2(hash2(cell + 3.7), hash2(cell + 9.1)) * 0.4 + 0.3;
        tw = h;
        float big = step(0.8, fract(h * 37.0));
        return step(1.0 - density, h) * starDab(fract(sp) - c, size * (0.55 + 0.45 * fract(h * 91.0)) + big * 0.07, big);
    }
    // roofline of a ruined town: gables, flat roofs, broken walls, chimneys, the odd steeple
    float townHeight(float x, float seed, out float win) {
        float id = floor(x);
        float f = fract(x);
        float h = hash1(id + seed);
        float h2 = hash1(id * 1.7 + seed + 4.0);
        float base = 0.012 + 0.03 * h * h + 0.012 * h2;
        float top = base;
        float w = 0.5 - 0.5 * abs(f * 2.0 - 1.0);
        if (h2 < 0.38) top += 0.02 * min(1.0, w * 2.6);
        else if (h2 > 0.78) top -= 0.014 * step(noise1(x * 9.0 + seed), 0.45) + 0.008 * noise1(x * 23.0);
        float gap = step(h, 0.16);
        top = mix(top, 0.006 + 0.006 * noise1(x * 17.0 + seed), gap);
        float chim = step(0.62, h) * step(abs(f - 0.3 - 0.4 * h2), 0.045);
        top += chim * 0.012;
        float steeple = step(0.955, h2) * (1.0 - gap);
        float u = abs(f - 0.5);
        top = max(top, steeple * (0.05 * step(u, 0.13) + max(0.0, 0.085 * (1.0 - u / 0.15)) * step(u, 0.15)));
        win = (1.0 - gap) * step(0.83, hash1(id * 3.1 + seed)) * step(abs(f - 0.5), 0.07);
        return top;
    }
    // a bare, shell-stripped tree in its own cell
    float deadTree(vec2 q, float h) {
        float ht = 0.04 + 0.05 * h;
        float lean = (h - 0.5) * 0.02;
        vec2 topP = vec2(lean, ht);
        float d = seg(q, vec2(0.0, -0.01), topP) - 0.0022 * (1.0 - clamp(q.y / ht, 0.0, 1.0) * 0.7);
        vec2 b1 = mix(vec2(0.0), topP, 0.45 + 0.2 * h);
        vec2 b2 = mix(vec2(0.0), topP, 0.68);
        d = min(d, seg(q, b1, b1 + vec2(0.018 + 0.01 * h, 0.016)) - 0.0012);
        d = min(d, seg(q, b2, b2 + vec2(-0.016, 0.014 + 0.01 * h)) - 0.001);
        d = min(d, seg(q, topP, topP + vec2(0.007, 0.012)) - 0.0008);
        return 1.0 - smoothstep(0.0, 0.0012, d);
    }

    void main() {
        vec3 d = normalize(vDir);
        float up = clamp(d.y, 0.0, 1.0);
        float az = atan(d.z, d.x);
        float el = asin(clamp(d.y, -1.0, 1.0));
        float md = dot(d, uMoon);
        vec2 mu = vec2(dot(d, uMoonX), dot(d, uMoonY)) / 0.105;
        float mr = length(mu) + step(md, 0.0) * 99.0;

        // washes of gouache: the gradient is broken into bands along a brushy edge
        vec2 sp = d.xz / (abs(d.y) + 0.22);
        float brush = fbm(vec2(sp.x * 1.3 + 3.0, sp.y * 1.3) + d.y * 2.0);
        float t = clamp(up + (brush - 0.5) * 0.16, 0.0, 1.0);
        vec3 zenith = vec3(0.012, 0.018, 0.07);
        vec3 mid = vec3(0.03, 0.05, 0.16);
        vec3 low = vec3(0.07, 0.115, 0.24);
        float tb = floor(t * 7.0) / 7.0 + smoothstep(0.0, 0.07, fract(t * 7.0)) / 7.0;
        vec3 col = mix(low, mid, smoothstep(0.02, 0.3, tb));
        col = mix(col, zenith, smoothstep(0.25, 0.85, tb));
        // the moon's halo: two flat rings with a wobbly edge, then a soft glow
        float mw = mr + (noise2(vec2(atan(mu.y, mu.x) * 2.5, 1.0)) - 0.5) * 0.12 + (brush - 0.5) * 0.3;
        float halo = (1.0 - smoothstep(1.5, 1.58, mw)) * 0.5 + (1.0 - smoothstep(2.5, 2.62, mw)) * 0.3 + (1.0 - smoothstep(3.9, 4.1, mw)) * 0.2;
        col += vec3(0.05, 0.08, 0.17) * halo;
        float glow = max(0.0, 1.0 - mr / 7.0);
        col += vec3(0.03, 0.045, 0.09) * glow * glow;

        // stars: brush dabs and four-point sparkles, two sizes
        float tw1;
        float tw2;
        vec2 st = d.xz / (1.0 + abs(d.y));
        float s1 = starLayer(st * 70.0, 0.1, 0.16, tw1);
        float s2 = starLayer(st * 30.0 + 40.0, 0.14, 0.14, tw2);
        float twinkle1 = 0.7 + 0.3 * sin(uTime * (1.2 + tw1 * 3.0) + tw1 * 40.0);
        float twinkle2 = 0.75 + 0.25 * sin(uTime * (0.9 + tw2 * 2.0) + tw2 * 31.0);
        float starFade = smoothstep(0.05, 0.3, up) * step(1.12, mr);
        col += (vec3(0.5, 0.58, 0.8) * s1 * twinkle1 * 0.8 + mix(vec3(0.95, 0.95, 1.1), vec3(1.2, 0.95, 0.7), step(0.6, tw2)) * s2 * twinkle2) * starFade;

        // the moon: a flat cream disc, a darker limb, painted seas, an ink line round it
        float edge = mr + (noise2(vec2(atan(mu.y, mu.x) * 3.0, 4.0)) - 0.5) * 0.035;
        float disc = 1.0 - smoothstep(0.985, 1.0, edge);
        vec3 moonCol = vec3(1.28, 1.25, 1.08);
        float limb = smoothstep(0.02, 0.06, dot(mu, vec2(0.62, -0.5)) - 0.42 + (noise2(mu * 3.0 + 9.0) - 0.5) * 0.25);
        moonCol = mix(moonCol, vec3(0.74, 0.8, 0.95), limb);
        float seas = smoothstep(0.55, 0.58, fbm(mu * 1.7 + vec2(4.2, 1.3)));
        moonCol = mix(moonCol, moonCol * vec3(0.62, 0.68, 0.84), seas * 0.9);
        float pits = smoothstep(0.1, 0.085, length(fract(mu * 2.3 + 0.37) - 0.5)) * step(0.72, hash2(floor(mu * 2.3 + 0.37)));
        moonCol = mix(moonCol, moonCol * 0.72, pits);
        moonCol = mix(moonCol, vec3(0.02, 0.025, 0.07), smoothstep(0.9, 0.93, edge));
        col = mix(col, moonCol, disc);

        // clouds: flat shapes with a brushed edge, a moonlit rim and a darker belly
        vec2 cp = sp * 0.85 + vec2(uTime * 0.006, uTime * 0.002);
        float streak = noise2(vec2(cp.x * 2.0, cp.y * 11.0));
        float n = fbm(cp) + (streak - 0.5) * 0.07;
        vec2 toMoon = normalize(uMoon.xz / (abs(uMoon.y) + 0.22) - sp + 1e-4);
        #ifdef DF_SKY_RIM
        float n2 = fbm(cp + toMoon * 0.16);
        float lit = smoothstep(0.0, 0.03, n - n2 - 0.015);
        #else
        float lit = smoothstep(0.6, 0.63, n);
        #endif
        float cover = smoothstep(0.02, 0.2, up) * (1.0 - smoothstep(0.75, 1.0, up) * 0.6);
        float body = smoothstep(0.5, 0.525, n) * cover;
        float wisp = smoothstep(0.43, 0.455, n) * cover * 0.35;
        float belly = smoothstep(0.63, 0.66, n);
        float nearMoon = 1.0 - smoothstep(1.0, 6.0, mr);
        vec3 cloudDark = mix(vec3(0.022, 0.03, 0.075), vec3(0.05, 0.065, 0.14), nearMoon);
        vec3 cloudLit = mix(vec3(0.075, 0.105, 0.21), vec3(0.42, 0.48, 0.66), nearMoon * nearMoon);
        vec3 cloudCol = mix(cloudDark, cloudLit, lit * (1.0 - belly * 0.6));
        cloudCol = mix(cloudCol, vec3(0.012, 0.016, 0.045), belly * (1.0 - lit) * 0.6);
        col = mix(col, cloudCol, max(body * 0.94, wisp));

        // the front burns on the horizon: a banded glow, tongues of flame, columns of smoke
        float fireAz = atan(uFire.z, uFire.x);
        float fa = az - fireAz;
        fa = fa - 6.2831853 * floor(fa / 6.2831853 + 0.5);
        float fire = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uFire.x, 0.0, uFire.z))), 0.0);
        float f2 = fire * fire;
        float f8 = f2 * f2 * f2 * f2;
        float glowH = f8 * (0.26 + 0.05 * noise1(az * 9.0 + uTime * 0.3)) * (1.0 + uFlare.w * 0.5);
        float fg = (1.0 - smoothstep(glowH * 0.45, glowH * 0.5, el)) * 0.55 + (1.0 - smoothstep(glowH * 0.95, glowH, el)) * 0.45;
        col += vec3(0.5, 0.13, 0.03) * fg * f8 * step(0.0, el) * 0.7;
        float plume = 0.0;
        for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float x0 = (fi - 1.0) * 0.21 + 0.03;
            float lean = el * (0.55 + fi * 0.12);
            float wv = (noise2(vec2(el * 9.0 - uTime * 0.05, fi * 7.0)) - 0.5) * 0.09 * (0.3 + el * 3.0);
            float width = 0.02 + el * 0.2;
            float e = abs(fa - x0 - lean - wv) / width;
            float puff = fbm(vec2((fa - lean) * 16.0, el * 16.0 - uTime * 0.08) + fi * 5.0);
            plume = max(plume, (1.0 - smoothstep(0.55, 0.62, e + (puff - 0.5) * 0.9)) * (1.0 - smoothstep(0.3, 0.6, el)));
        }
        vec3 smokeCol = mix(vec3(0.3, 0.085, 0.03), vec3(0.03, 0.03, 0.055), smoothstep(0.02, 0.22, el));
        col = mix(col, smokeCol * (1.0 + uFlare.w), plume * 0.92);

        // artillery on the horizon: a brief orange bloom low in the sky, in two flat steps
        float fl = max(dot(d, uFlare.xyz), 0.0);
        float fl2 = fl * fl;
        float fl8 = fl2 * fl2 * fl2 * fl2;
        float burst = fl8 * fl8;
        col += vec3(0.9, 0.42, 0.16) * uFlare.w * (burst * 0.35 + step(0.55, burst) * 0.3 + step(0.3, fl8) * 0.07 + fl8 * 0.06) * (1.0 - smoothstep(0.0, 0.35, up));

        // the skyline: far hills, the ruined town, then bare trees, each darker and nearer
        float hills = 0.02 + 0.03 * noise1(az * 2.6 + 5.0) + 0.012 * noise1(az * 9.0);
        vec3 hillCol = mix(uFog, vec3(0.05, 0.075, 0.16), 0.5) + vec3(0.25, 0.07, 0.02) * f8 * 0.5;
        col = mix(col, hillCol, 1.0 - smoothstep(hills - 0.002, hills + 0.002, el));
        float win;
        float town = townHeight(az * 21.0, 3.0, win) * (0.75 + 0.5 * noise1(az * 1.7 + 2.0)) + 0.012;
        vec3 townCol = uFog * 0.62 + vec3(0.16, 0.04, 0.012) * f8;
        float townM = 1.0 - smoothstep(town - 0.0012, town + 0.0012, el);
        // a moonlit ink line along the rooftops
        float roofLine = townM * smoothstep(town - 0.0045, town - 0.003, el);
        col = mix(col, townCol, townM);
        col += vec3(0.05, 0.07, 0.13) * roofLine * (1.0 - f8);
        col += vec3(1.3, 0.6, 0.18) * win * townM * step(abs(el - town * 0.45), 0.0035) * (0.75 + 0.25 * sin(uTime * 3.0 + az * 50.0));
        float win2;
        float near = townHeight(az * 11.0 + 0.4, 9.0, win2) * 1.25 * (0.6 + 0.6 * noise1(az * 2.3 + 8.0)) + 0.004;
        float tx = az * 15.0;
        float tid = floor(tx);
        float th = hash1(tid + 21.0);
        float tree = step(0.45, th) * deadTree(vec2((fract(tx) - 0.5) / 15.0, el), fract(th * 13.0));
        float nearM = max(1.0 - smoothstep(near - 0.0012, near + 0.0012, el), tree);
        col = mix(col, uFog * 0.36 + vec3(0.07, 0.016, 0.004) * f8, nearM);
        // below the horizon the land takes over
        col = mix(col, uFog * 0.36, 1.0 - smoothstep(-0.02, 0.0, el));

        // a new round: the sky bleeds red, deepest overhead, then drains away
        vec3 blood = mix(vec3(0.2, 0.022, 0.012), vec3(0.075, 0.008, 0.012), smoothstep(0.0, 0.8, up));
        float lum = dot(col, vec3(0.3, 0.6, 0.1));
        col = mix(col, blood * (0.35 + lum * 5.0) + col * vec3(0.5, 0.12, 0.1), uBlood * 0.85);

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
        defines: high ? { DF_SKY_OCTAVES: 5, DF_SKY_RIM: 1 } : { DF_SKY_OCTAVES: 3 },
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
    const hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(0.43, 0.47, 0.9), new THREE.Color().setRGB(0.15, 0.11, 0.17), HEMI)
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
    const landMat = keep(dfPatchVoxGlow(new THREE.MeshLambertMaterial({ color: new THREE.Color(0x3a3027) }), { value: 0 }))
    const land = new THREE.Mesh(landGeo, landMat)
    land.position.y = -0.04
    land.receiveShadow = false
    root.add(land)

    const fireAng = Math.atan2(FIRE_DIR.z, FIRE_DIR.x)
    let flare = 0
    let flareAt = 3

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
            hemi.dispose()
            moon.dispose()
        }
    }
}
