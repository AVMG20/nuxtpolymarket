import * as THREE from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { NEON_PINK } from './config'
import { BOOST_TILE_LENGTH, checkerTexture, chevronTexture, concreteTexture, kerbTexture, PUDDLE_TILE_LENGTH, roadTextures, ROAD_TILE_LENGTH } from './textures'
import { DECK_DEPTH, mirrorStrip, ribbon, roadBelow, roadLeft, roadRight, sweep, wallLeft, wallRight, type RoadWidth } from './road-geometry'
import type { WorldKit } from './world-kit'
import { MIN_CLEARANCE } from '#shared/utils/nitro-rush/layout'
import { headingOf, newTrackFrame, WALL_BASE_HALF, WALL_HEIGHT, wallFoot, type Cushion, type TrackLine } from '#shared/utils/nitro-rush/track'

/** Kerbs only go where the line turns tighter than this (radians per metre). */
const KERB_MIN_CURVATURE = 0.004
const PILLAR_SPACING = 16
const PILLAR_SIZE = 0.8
/** A crash cushion's plan, from the nose back between the walls, and its height: a touch over the walls so it reads from the deck. */
const CUSHION_LENGTH = 2.6
const CUSHION_FRONT = 1.3
const CUSHION_BACK = 1.8
const CUSHION_HEIGHT = 1

/** The walls' outer foot, wherever along the road it's measured. */
const outerFoot = (w: RoadWidth) => wallFoot(w.wall)

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
    // Painted for the normal width; a narrower or wider road stretches it across.
    const road = roadTextures(track.def.halfWidth)
    for (const t of [road.map, road.normal, road.rough, road.wet]) own(t)
    const roadMat = own(new THREE.MeshStandardMaterial({
        map: road.map, normalMap: road.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: road.rough, roughness: 0.85, metalness: 0.05, envMapIntensity: 0.5
    }))
    for (const line of track.branches) add(ribbon(line, 0, line.length, roadLeft, roadRight, 0, ROAD_TILE_LENGTH), roadMat)
    // The mirror needs its plane in local XY; the same strip, stood up and laid back down.
    const reflector = new Reflector(own(mirrorStrip(track.branches, roadRight).rotateX(Math.PI / 2)), {
        textureWidth: reflectionSize.w,
        textureHeight: reflectionSize.h,
        clipBias: 0.003,
        color: 0xffffff,
        shader: WetShader,
        // The streak blur smears away any edge MSAA would smooth.
        multisample: 0
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

/** The material of a boost pad, showing `map`; bright whatever the lighting, so a pad reads from a distance. */
export function boostPadMaterial(map: THREE.Texture) {
    return new THREE.MeshBasicMaterial({ map, polygonOffset: true, polygonOffsetFactor: -2 })
}

export function addBoostPads({ track, add }: WorldKit, material: THREE.Material) {
    for (const line of track.branches) {
        for (const p of line.boostPads) add(ribbon(line, p.from, p.to, p.latFrom, p.latTo, 0.03, BOOST_TILE_LENGTH), material)
    }
}

/** Run-off aprons, the ground, kerbs on the bends and the chequered lines. */
export function buildTrackside({ track, own, add }: WorldKit) {
    const apronTex = own(concreteTexture(90))
    apronTex.repeat.set(0.5, 1)
    const apronMat = own(new THREE.MeshStandardMaterial({ map: apronTex, color: 0x8a8a88, roughness: 0.9 }))
    for (const line of track.branches) {
        add(ribbon(line, 0, line.length, roadRight, wallRight, 0.004, 3), apronMat)
        add(ribbon(line, 0, line.length, wallLeft, roadLeft, 0.004, 3), apronMat)
    }
    const groundTex = own(concreteTexture(60))
    groundTex.repeat.set(2400 / 8, 2400 / 8)
    const ground = add(new THREE.PlaneGeometry(2400, 2400), own(new THREE.MeshStandardMaterial({ map: groundTex, color: 0x5a5a5c, roughness: 0.95 })))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.03

    const kerbMat = own(new THREE.MeshStandardMaterial({ map: own(kerbTexture()), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }))
    for (const line of track.branches) {
        let runStart = -1
        for (let i = 0; i <= line.n; i++) {
            const curved = i < line.n && line.curvature[i]! > KERB_MIN_CURVATURE
            if (curved && runStart < 0) runStart = i
            if (!curved && runStart >= 0) {
                const from = line.cum[runStart]! - 3
                const to = line.cum[i]! + 3
                add(ribbon(line, from, to, w => -w.hw - 0.5, w => -w.hw + 1.1, 0.02, 4), kerbMat)
                add(ribbon(line, from, to, w => w.hw - 1.1, w => w.hw + 0.5, 0.02, 4), kerbMat)
                runStart = -1
            }
        }
    }
    const checker = own(checkerTexture())
    checker.wrapT = THREE.RepeatWrapping
    const checkerMat = own(new THREE.MeshStandardMaterial({ map: checker, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }))
    for (const l of track.lapLines) {
        if (l.kind !== 'checkpoint') add(ribbon(track.branches[l.branch]!, l.s - 1.2, l.s + 1.2, roadLeft, roadRight, 0.016, 2.4), checkerMat)
    }
}

/** Concrete walls with a neon band, the raised road's deck and pillars, crash cushions where walls meet, and the barriers closing a road's ends unless left out. */
export function buildBarriers(kit: WorldKit, concrete: THREE.Texture, { endWalls = true } = {}) {
    const { track, own, add } = kit
    const jersey: [number, number][] = [[0, 0], [0.64, 0], [0.64, 0.08], [0.49, 0.26], [0.41, WALL_HEIGHT], [0.23, WALL_HEIGHT], [0.15, 0.26], [0, 0.08], [0, 0]]
    const wallMat = own(new THREE.MeshStandardMaterial({ map: concrete, color: 0xb8b4ac, roughness: 0.92, side: THREE.DoubleSide }))
    const bandMats = new Map<number, THREE.Material>()
    const bandMat = (side: number) => {
        let m = bandMats.get(side)
        if (!m) bandMats.set(side, m = own(new THREE.MeshBasicMaterial({ color: side > 0 ? NEON_PINK : 0x3df2ff, side: THREE.DoubleSide })))
        return m
    }
    const pillarSpots: THREE.Matrix4[] = []
    for (const line of track.branches) {
        for (const side of [-1, 1] as const) {
            add(sweep(line, side, outerFoot, jersey), wallMat)
            // A flat sweep stood just off the sloped face; outside is pink, inside cyan.
            add(sweep(line, side, w => w.wall + 0.16, [[0, 0.46], [-0.03, 0.72]]), bandMat(side))
        }
        if (line.elevated) {
            for (const side of [-1, 1] as const) add(sweep(line, side, outerFoot, [[0, 0], [0, -DECK_DEPTH]]), wallMat)
            add(ribbon(line, 0, line.length, w => -outerFoot(w), outerFoot, -DECK_DEPTH, 4), wallMat)
            pillarSpots.push(...pillarsUnder(line, track.branches.filter(l => l !== line)))
        }
    }
    if (pillarSpots.length) {
        const pillars = kit.instanced(new THREE.BoxGeometry(PILLAR_SIZE, 1, PILLAR_SIZE).translate(0, 0.5, 0), wallMat, pillarSpots.length)
        pillarSpots.forEach((m, i) => pillars.setMatrixAt(i, m))
    }
    if (track.cushions.length) buildCushions(kit, track.cushions)
    if (endWalls) buildEndWalls(kit, wallMat)
}

/** Where the raised road's slab stands on pillars just outside its edges: clear of every road under it and of another road's deck beside it. */
function pillarsUnder(line: TrackLine, others: readonly TrackLine[]) {
    const spots: THREE.Matrix4[] = []
    const f = newTrackFrame()
    for (let s = PILLAR_SPACING / 2; s < line.length; s += PILLAR_SPACING) {
        // Loopings, corkscrews and gaps carry themselves.
        if (!line.solidRoadAt(s)) continue
        line.frameAt(s, f)
        const edge = wallFoot(line.wallAt(s))
        // Right's reach across the plan: a bank draws its edges in.
        const across = Math.hypot(f.rx, f.rz)
        for (const side of [-1, 1]) {
            // A bank's raised edge stands on pillars; its low edge lies on the ground and needs none.
            const top = f.y + f.ry * side * edge - DECK_DEPTH
            if (top < 0.3) continue
            const lat = side * (edge * across + PILLAR_SIZE / 2)
            const x = f.x + f.rx / across * lat
            const z = f.z + f.rz / across * lat
            // A pillar may stand beside a lower level, as in a spiral, but never on its road, nor under a deck it shares a fork with.
            if (roadBelow([line], x, z, 0.5, f.y - MIN_CLEARANCE / 2)) continue
            if (roadBelow(others, x, z, WALL_BASE_HALF * 2, f.y + 0.5)) continue
            spots.push(new THREE.Matrix4().compose(
                new THREE.Vector3(x, 0, z),
                new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingOf(f.tx, f.tz)),
                new THREE.Vector3(1, top, 1)
            ))
        }
    }
    return spots
}

/** A tapered, striped block at each nose and tail, from the point back between the two walls. */
function buildCushions({ own, instanced }: WorldKit, cushions: readonly Cushion[]) {
    const plan = new THREE.Shape()
    const r = CUSHION_FRONT / 2
    plan.moveTo(-r, 0)
    plan.absarc(0, 0, r, Math.PI, 0, true)
    plan.lineTo(CUSHION_BACK / 2, CUSHION_LENGTH)
    plan.lineTo(-CUSHION_BACK / 2, CUSHION_LENGTH)
    plan.closePath()
    // Extruded up, with the plan's +y turned to run along local -z, which a heading turns onto the cushion's direction.
    const geo = new THREE.ExtrudeGeometry(plan, { depth: CUSHION_HEIGHT, bevelEnabled: false, curveSegments: 8 }).rotateX(-Math.PI / 2)
    const map = own(chevronTexture())
    const mat = own(new THREE.MeshStandardMaterial({ map, roughness: 0.55 }))
    const mesh = instanced(geo, mat, cushions.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    cushions.forEach((c, i) => {
        // Its rounded front sits just ahead of the point, so a car glancing the nose sees it first.
        mesh.setMatrixAt(i, m.compose(new THREE.Vector3(c.x - c.tx * r, c.y, c.z - c.tz * r), q.setFromAxisAngle(up, headingOf(c.tx, c.tz)), new THREE.Vector3(1, 1, 1)))
    })
}

/** The same wall, run straight across each end of a road that a barrier closes. */
function buildEndWalls({ track, group, own }: WorldKit, wallMat: THREE.Material) {
    const ends = track.branches.flatMap(line => [line.barrierStart && { line, end: 0 }, line.barrierEnd && { line, end: line.length }].filter(e => !!e))
    if (!ends.length) return
    const bandMat = own(new THREE.MeshBasicMaterial({ color: 0xffd23d, side: THREE.DoubleSide }))
    for (const { line, end } of ends) {
        const span = wallFoot(line.wallAt(end)) * 2
        const barrierGeo = own(new THREE.BoxGeometry(span, WALL_HEIGHT, WALL_BASE_HALF * 2).translate(0, WALL_HEIGHT / 2, 0))
        const bandGeo = own(new THREE.PlaneGeometry(span - 1.3, 0.26))
        const p = line.pointAt(end)
        // The barrier's face sits at the very end of the line; its body lies outside the course.
        const out = end === 0 ? -1 : 1
        const g = new THREE.Group()
        g.position.set(p.x + p.tx * out * WALL_BASE_HALF, p.y, p.z + p.tz * out * WALL_BASE_HALF)
        g.rotation.y = headingOf(p.tx, p.tz)
        // A draft can stop on a bank: the wall lies across the road as it's tipped there.
        g.rotateZ(Math.asin(line.frameAt(end).ry))
        g.add(new THREE.Mesh(barrierGeo, wallMat))
        const band = new THREE.Mesh(bandGeo, bandMat)
        band.position.set(0, 0.6, out * (WALL_BASE_HALF + 0.02))
        g.add(band)
        group.add(g)
    }
}
