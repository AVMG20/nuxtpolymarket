import * as THREE from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { NEON_PINK } from './config'
import { checkerTexture, concreteTexture, kerbTexture, PUDDLE_TILE_LENGTH, roadTextures, ROAD_TILE_LENGTH } from './textures'
import { mirrorStrip, ribbon, roadBelow, sweep, WALL_BASE_HALF } from './road-geometry'
import type { WorldKit } from './world-kit'
import { MIN_CLEARANCE } from '#shared/utils/nitro-rush/layout'
import { headingOf } from '#shared/utils/nitro-rush/track'

/** Kerbs only go where the line turns tighter than this (radians per metre). */
const KERB_MIN_CURVATURE = 0.004
/** The elevated road's slab, below the surface. */
const DECK_DEPTH = 0.8
const PILLAR_SPACING = 16
const PILLAR_SIZE = 0.8

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
        attribute float fade;
        varying vec4 vProj;
        varying vec2 vUv;
        varying float vDepth;
        varying float vFade;
        void main() {
            vUv = uv;
            vFade = fade;
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
        varying float vFade;
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
            k *= (1.0 - smoothstep(70.0, 220.0, vDepth)) * vFade;
            gl_FragColor = vec4(c * color * k, 1.0);
        }`
}

export type WetUniforms = typeof WetShader.uniforms

/** The wet road and its mirror, which never shows `hidden` (camera-attached effects). */
export function buildRoad({ track, group, own, add }: WorldKit, reflectionSize: { w: number, h: number }, hidden: readonly THREE.Object3D[]) {
    const hw = track.halfWidth
    const L = track.length
    const road = roadTextures(hw)
    for (const t of [road.map, road.normal, road.rough, road.wet]) own(t)
    const roadGeo = ribbon(track, 0, L, -hw, hw, 0, ROAD_TILE_LENGTH)
    add(roadGeo, own(new THREE.MeshStandardMaterial({
        map: road.map, normalMap: road.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: road.rough, roughness: 0.85, metalness: 0.05, envMapIntensity: 0.5
    })))
    // The mirror needs its plane in local XY; the same strip, stood up and laid back down.
    const reflector = new Reflector(own(mirrorStrip(track, hw).rotateX(Math.PI / 2)), {
        textureWidth: reflectionSize.w,
        textureHeight: reflectionSize.h,
        clipBias: 0.003,
        color: 0xffffff,
        shader: WetShader
    })
    const refMat = reflector.material as THREE.ShaderMaterial
    refMat.transparent = true
    refMat.blending = THREE.AdditiveBlending
    refMat.depthWrite = false
    const wetUniforms = refMat.uniforms as unknown as typeof WetShader.uniforms
    wetUniforms.tWet.value = road.wet as never
    wetUniforms.uWetRepeat.value.set(1, ROAD_TILE_LENGTH / PUDDLE_TILE_LENGTH)
    reflector.rotation.x = -Math.PI / 2
    reflector.position.y = 0.012
    reflector.renderOrder = 1
    group.add(reflector)
    // Hide camera-attached effects while the mirror view renders.
    const render = reflector.onBeforeRender.bind(reflector)
    reflector.onBeforeRender = (...args) => {
        const was = hidden.map(o => o.visible)
        for (const o of hidden) o.visible = false
        render(...args)
        hidden.forEach((o, i) => {
            o.visible = was[i]!
        })
    }
    return { reflector, wetUniforms }
}

/** Run-off aprons, the ground, kerbs on the bends and the chequered lines. */
export function buildTrackside({ track, own, add }: WorldKit) {
    const hw = track.halfWidth
    const wall = track.wallOffset
    const L = track.length
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
}

/** Concrete walls with a neon band, the raised road's deck and pillars, and an open course's end walls. */
export function buildBarriers({ track, group, own, add, instanced }: WorldKit, concrete: THREE.Texture) {
    const wall = track.wallOffset
    const L = track.length
    // The walls' outer foot: where the deck ends and the end walls reach.
    const edge = wall + WALL_BASE_HALF * 2
    const jersey: [number, number][] = [[0, 0], [0.64, 0], [0.64, 0.08], [0.49, 0.26], [0.41, 0.86], [0.23, 0.86], [0.15, 0.26], [0, 0.08], [0, 0]]
    const wallMat = own(new THREE.MeshStandardMaterial({ map: concrete, color: 0xb8b4ac, roughness: 0.92, side: THREE.DoubleSide }))
    for (const side of [-1, 1]) add(sweep(track, side, edge, jersey), wallMat)
    // A flat sweep stood just off the sloped face; outside is pink, inside cyan.
    for (const side of [-1, 1]) {
        add(sweep(track, side, wall + 0.16, [[0, 0.46], [-0.03, 0.72]]),own(new THREE.MeshBasicMaterial({ color: side > 0 ? NEON_PINK : 0x3df2ff, side: THREE.DoubleSide })))
    }
    // ── Where the road leaves the ground: the slab's sides and underside, on pillars just outside its edges ──
    if (track.elevated) {
        for (const side of [-1, 1]) add(sweep(track, side, edge, [[0, 0], [0, -DECK_DEPTH], [edge, -DECK_DEPTH]]), wallMat)
        const spots: THREE.Matrix4[] = []
        const p = { x: 0, z: 0, tx: 0, tz: 1, y: 0, grade: 0 }
        for (let s = PILLAR_SPACING / 2; s < L; s += PILLAR_SPACING) {
            track.pointAt(s, p)
            const top = p.y - DECK_DEPTH
            // Loopings, corkscrews, banks and gaps carry themselves.
            if (top < 0.3 || !track.plainRoadAt(s)) continue
            for (const side of [-1, 1]) {
                const lat = side * (edge + PILLAR_SIZE / 2)
                const x = p.x - p.tz * lat
                const z = p.z + p.tx * lat
                // A pillar may stand beside a lower level, as in a spiral, but never on its road.
                if (roadBelow(track, x, z, wall + 0.5, p.y - MIN_CLEARANCE / 2)) continue
                spots.push(new THREE.Matrix4().compose(
                    new THREE.Vector3(x, 0, z),
                    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingOf(p.tx, p.tz)),
                    new THREE.Vector3(1, top, 1)
                ))
            }
        }
        const pillars = instanced(new THREE.BoxGeometry(PILLAR_SIZE, 1, PILLAR_SIZE).translate(0, 0.5, 0), wallMat, Math.max(1, spots.length))
        spots.forEach((m, i) => pillars.setMatrixAt(i, m))
        pillars.count = spots.length
    }

    // An open course is closed off at both ends by the same wall, run straight across.
    if (!track.closed) {
        const span = edge * 2
        const barrierGeo = own(new THREE.BoxGeometry(span, 0.86, WALL_BASE_HALF * 2).translate(0, 0.43, 0))
        const bandGeo = own(new THREE.PlaneGeometry(span - 1.3, 0.26))
        const bandMat = own(new THREE.MeshBasicMaterial({ color: 0xffd23d, side: THREE.DoubleSide }))
        for (const end of [0, L]) {
            const p = track.pointAt(end)
            // The barrier's face sits at the very end of the line; its body lies outside the course.
            const out = end === 0 ? -1 : 1
            const g = new THREE.Group()
            g.position.set(p.x + p.tx * out * WALL_BASE_HALF, p.y, p.z + p.tz * out * WALL_BASE_HALF)
            g.rotation.y = headingOf(p.tx, p.tz)
            g.add(new THREE.Mesh(barrierGeo, wallMat))
            const band = new THREE.Mesh(bandGeo, bandMat)
            band.position.set(0, 0.6, out * (WALL_BASE_HALF + 0.02))
            g.add(band)
            group.add(g)
        }
    }
}
