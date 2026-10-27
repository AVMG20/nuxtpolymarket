import * as THREE from 'three'
import { DF_MAP } from '#shared/utils/dead-front/map'
import { dfCollisionFromSolids, dfRaycast, type DfCollisionWorld, type DfRayHit } from '#shared/utils/dead-front/physics'
import type { DfEvent, DfProjectileSnap } from '#shared/utils/dead-front/protocol'
import type { Vec3 } from '#shared/utils/dead-front/types'
import { DF_PAP_COLORS } from '#shared/utils/dead-front/weapons'
import type { DfProjectileView, DfRenderContext } from '../context'
import { DfVoxModel } from '../voxel/model'
import { dfWeaponMat } from './materials'
import { DF_WSND } from './sounds'
import { dfXrayScheme } from './xray'

// Voxel projectiles (grenades, PaP grenades, X-Ray bolts, bloater spit) and the
// `explode` / `arc` events. Meshes are pooled per kind; bolt lights come from
// a fixed pool added once.
//
// The X-Ray bolt is a white-hot core in a glowing shell with a spinning ring,
// a tapered two-layer trail, sparks and its own light, all in its PaP tier's
// colour. Its impact is a flare, an expanding ring on the surface, the `ray`
// burst and a scorch. Scorches only go on a world surface right next to the
// blast (never on zombies or in mid-air) and only where the surface is broad
// enough to hold them, oriented to that surface.

interface Live {
    mesh: THREE.Object3D
    kind: DfProjectileSnap['kind']
    seen: boolean
    trailT: number
    light: THREE.PointLight | null
    pos: THREE.Vector3
    vel: THREE.Vector3
    tier: number
    /** Where the bolt was first seen (its trail grows from there). */
    from: THREE.Vector3
    spin: number
    bolt: BoltParts | null
}

interface BoltParts {
    ring: THREE.Mesh
    trail: THREE.Mesh
    halo: THREE.Mesh
}

interface Flare {
    ball: THREE.Mesh
    ring: THREE.Mesh
    ballMat: THREE.MeshBasicMaterial
    ringMat: THREE.MeshBasicMaterial
    t: number
    life: number
    size: number
}

const UP = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, -1)
const ZP = new THREE.Vector3(0, 0, 1)
const TRAIL_MAX = 2.4

/** The surface a blast at `pos` sits on: the nearest world hit within `reach` (hinted direction first). */
export function dfBlastSurface(world: DfCollisionWorld, pos: Vec3, hint: Vec3 | null, reach = 0.5): DfRayHit | null {
    const dirs: Vec3[] = [{ x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 }]
    if (hint) {
        const l = Math.hypot(hint.x, hint.y, hint.z)
        if (l > 1e-6) dirs.unshift({ x: hint.x / l, y: hint.y / l, z: hint.z / l })
    }
    let best: DfRayHit | null = null
    for (const d of dirs) {
        const h = dfRaycast(world, pos, d, reach)
        if (h && (!best || h.dist < best.dist)) best = h
    }
    return best
}

/**
 * The largest scorch scale (of `scales`, largest first) whose footprint lies
 * flat on the surface: probes around the rim must find the same plane, or the
 * decal would hang over an edge into the air. 0 when none fits.
 */
export function dfDecalFit(world: DfCollisionWorld, hit: DfRayHit, radiusAt1: number, scales: readonly number[]): number {
    const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).normalize()
    const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize()
    const t2 = new THREE.Vector3().crossVectors(n, t1).normalize()
    const o = new THREE.Vector3()
    const back = { x: -n.x, y: -n.y, z: -n.z }
    for (const s of scales) {
        const r = radiusAt1 * s
        let ok = true
        for (let a = 0; a < 8 && ok; a++) {
            const ang = (a / 8) * Math.PI * 2
            o.set(hit.point.x, hit.point.y, hit.point.z)
                .addScaledVector(t1, Math.cos(ang) * r)
                .addScaledVector(t2, Math.sin(ang) * r)
                .addScaledVector(n, 0.15)
            const h = dfRaycast(world, o, back, 0.3)
            ok = !!h && Math.abs(h.dist - 0.15) < 0.05 && h.normal.x * n.x + h.normal.y * n.y + h.normal.z * n.z > 0.9
        }
        if (ok) return s
    }
    return 0
}

/**
 * Where a blast came from: the bolt or shell of `kind` (live or just gone)
 * nearest to it within 4 m, for its heading. The tier is the server's (`tier`
 * on the `explode` event) when it sent one; the nearest projectile's only as a
 * fallback, since a point-blank or very fast bolt may never have been drawn.
 */
export function dfBlastSource<T extends { pos: Vec3, tier: number, kind: DfProjectileSnap['kind'] }>(pos: Vec3, kind: DfProjectileSnap['kind'], candidates: Iterable<T>, tier?: number): { tier: number, src: T | null } {
    let best = 4
    let src: T | null = null
    for (const c of candidates) {
        if (c.kind !== kind) continue
        const d = Math.hypot(c.pos.x - pos.x, c.pos.y - pos.y, c.pos.z - pos.z)
        if (d < best) {
            best = d
            src = c
        }
    }
    const t = typeof tier === 'number' && Number.isFinite(tier) ? tier : src?.tier ?? 0
    return { tier: Math.max(0, Math.min(3, Math.floor(t))), src }
}

export function createDfProjectileViewImpl(ctx: DfRenderContext): DfProjectileView {
    const group = new THREE.Group()
    group.name = 'df-projectiles'
    ctx.scene.add(group)
    const geos: THREE.BufferGeometry[] = []
    const mats: THREE.Material[] = []
    const g = <T extends THREE.BufferGeometry>(x: T): T => {
        geos.push(x)
        return x
    }
    const high = ctx.quality === 'high'
    // Voxel projectiles: a stick grenade, glowing cube clusters for the PaP shells,
    // the X-Ray bolt, a lumpy green spit ball.
    const solidMat = dfWeaponMat()
    const stick = new DfVoxModel(5, 22, 5)
    stick.box(0, 14, 0, 5, 22, 5, stick.shade(0x4c5038, 0.06, 2)).box(0, 13, 0, 5, 14, 5, stick.c(0x2a2b2e))
    stick.box(2, 0, 2, 3, 13, 3, stick.c(0x8a6038)).box(1, 0, 1, 4, 1, 4, stick.c(0x2a2b2e))
    const stickG = g(stick.mesh(0.014, [2.5, 14, 2.5])!)
    const glowCube = (hex: number, n: number) => {
        const m = new DfVoxModel(n, n, n)
        const hot = m.c(0xffffff, 1)
        const c = m.c(hex, 1)
        m.box(0, 0, 0, n, n, n, c)
        m.box(1, 1, 1, n - 1, n - 1, n - 1, hot)
        for (const [i, j, k] of [[0, 0, 0], [n - 1, 0, 0], [0, n - 1, 0], [0, 0, n - 1], [n - 1, n - 1, 0], [n - 1, 0, n - 1], [0, n - 1, n - 1], [n - 1, n - 1, n - 1]] as const) m.set(i, j, k, 0)
        return m
    }
    const ball = g(glowCube(0xffffff, 4).mesh(0.02, [2, 2, 2])!)
    // X-Ray bolt: a white core (pointed at the front), a fatter tinted shell, a voxel ring.
    const coreM = new DfVoxModel(3, 3, 12)
    coreM.box(1, 1, 0, 2, 2, 12, coreM.c(0xffffff, 1)).box(0, 0, 2, 3, 3, 8, coreM.c(0xffffff, 1))
    const coreG = g(coreM.mesh(0.022, [1.5, 1.5, 3])!)
    const shellM = new DfVoxModel(5, 5, 9)
    shellM.box(1, 1, 0, 4, 4, 9, shellM.c(0xffffff, 1)).box(0, 0, 2, 5, 5, 6, shellM.c(0xffffff, 1))
    for (const [i, j] of [[0, 0], [4, 0], [0, 4], [4, 4]] as const) shellM.box(i, j, 0, i + 1, j + 1, 9, 0)
    const shellG = g(shellM.mesh(0.03, [2.5, 2.5, 2.5])!)
    const ringM = new DfVoxModel(9, 9, 1)
    for (let j = 0; j < 9; j++) {
        for (let i = 0; i < 9; i++) {
            const d = Math.hypot(i - 4, j - 4)
            if (d > 3.2 && d < 4.6) ringM.set(i, j, 0, ringM.c(0xffffff, 1))
        }
    }
    const ringG = g(ringM.mesh(0.022, [4.5, 4.5, 0.5])!)
    // The trail: a unit box from z 0 (bolt) to z 1 (tail), bright at the head, fading to nothing.
    const trailG = g(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5))
    {
        const pos = trailG.getAttribute('position') as THREE.BufferAttribute
        const col = new Float32Array(pos.count * 3)
        for (let i = 0; i < pos.count; i++) {
            const f = (1 - pos.getZ(i)) ** 2
            col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f
        }
        trailG.setAttribute('color', new THREE.BufferAttribute(col, 3))
    }
    const haloG = g(new THREE.BoxGeometry(1, 1, 1))
    const spitM = new DfVoxModel(5, 5, 5)
    spitM.vox.ellipsoid(2.5, 2.5, 2.5, 2.6, 2.6, 2.6, (i, j, k) => spitM.c(((i + j + k) & 1) ? 0x7a9a22 : 0x9fc23a, 0.35))
    const spitG = g(spitM.mesh(0.03, [2.5, 2.5, 2.5])!)
    const additive = (hex: THREE.ColorRepresentation, k: number, opacity = 1) => {
        const m = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
        mats.push(m)
        return m
    }
    const papMats = DF_PAP_COLORS.map(c => additive(c, 2.4))
    const spitMat = solidMat
    // Per X-Ray tier: core, shell, ring, trail (inner and outer) and halo materials.
    const boltMats = [0, 1, 2, 3].map((t) => {
        const s = dfXrayScheme(t)
        return {
            core: additive(s.hot, 3),
            shell: additive(s.core, 1.6, 0.85),
            ring: additive(s.core, 2.2),
            trail: additive(s.core, 1.8),
            trailOuter: additive(s.core, 0.7, 0.6),
            halo: additive(s.core, 0.35, 0.5)
        }
    })
    /** HDR tint for the fx bursts of a tier (bright enough to bloom). */
    const rayColor = [0, 1, 2, 3].map(t => new THREE.Color(dfXrayScheme(t).core).multiplyScalar(4))

    const lights: THREE.PointLight[] = []
    for (let i = 0; i < 3; i++) {
        const l = new THREE.PointLight(0x5dff7a, 0, 7, 2)
        group.add(l)
        lights.push(l)
    }

    // Impact flares: a glowing voxel ball that pops and fades and a ring rushing out along the surface.
    const flareBallM = glowCube(0xffffff, 5)
    const flareBallG = g(flareBallM.mesh(0.12, [2.5, 2.5, 2.5])!)
    const flares: Flare[] = []
    for (let i = 0; i < 4; i++) {
        const ballMat = additive(0xffffff, 1)
        const ringMat = additive(0xffffff, 1)
        const b = new THREE.Mesh(flareBallG, ballMat)
        const r = new THREE.Mesh(ringG, ringMat)
        b.visible = r.visible = false
        group.add(b, r)
        flares.push({ ball: b, ring: r, ballMat, ringMat, t: 1, life: 0, size: 1 })
    }
    let flareNext = 0

    // Motes: tiny glowing voxels shed along a bolt's path and sprayed by its impact, in the tier colour.
    const MOTES = high ? 96 : 48
    const moteMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    mats.push(moteMat)
    const motes = new THREE.InstancedMesh(g(new THREE.BoxGeometry(1, 1, 1)), moteMat, MOTES)
    motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    motes.frustumCulled = false
    motes.renderOrder = 6
    group.add(motes)
    const mPos = new Float32Array(MOTES * 3)
    const mVel = new Float32Array(MOTES * 3)
    const mLife = new Float32Array(MOTES)
    const mMax = new Float32Array(MOTES)
    const mSize = new Float32Array(MOTES)
    const mGrav = new Float32Array(MOTES)
    const mCol: THREE.Color[] = []
    const zero = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < MOTES; i++) {
        mCol.push(new THREE.Color(0, 0, 0))
        motes.setColorAt(i, mCol[i]!)
        motes.setMatrixAt(i, zero)
    }
    let moteNext = 0
    const mM = new THREE.Matrix4()
    const mQ = new THREE.Quaternion()
    const mS = new THREE.Vector3()
    const mP = new THREE.Vector3()
    function mote(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grav: number, color: THREE.Color): void {
        const i = moteNext
        moteNext = (moteNext + 1) % MOTES
        mPos.set([x, y, z], i * 3)
        mVel.set([vx, vy, vz], i * 3)
        mLife[i] = mMax[i] = life
        mSize[i] = size
        mGrav[i] = grav
        mCol[i]!.copy(color)
    }
    function updateMotes(dt: number): void {
        let any = false
        for (let i = 0; i < MOTES; i++) {
            if (mLife[i]! <= 0) {
                if (mSize[i]! > 0) {
                    mSize[i] = 0
                    mM.makeScale(0, 0, 0)
                    motes.setMatrixAt(i, mM)
                    any = true
                }
                continue
            }
            any = true
            mLife[i] = mLife[i]! - dt
            const k = Math.max(0, mLife[i]! / mMax[i]!)
            const drag = Math.exp(-3 * dt)
            mVel[i * 3] = mVel[i * 3]! * drag
            mVel[i * 3 + 1] = mVel[i * 3 + 1]! * drag - mGrav[i]! * dt
            mVel[i * 3 + 2] = mVel[i * 3 + 2]! * drag
            mPos[i * 3] = mPos[i * 3]! + mVel[i * 3]! * dt
            mPos[i * 3 + 1] = mPos[i * 3 + 1]! + mVel[i * 3 + 1]! * dt
            mPos[i * 3 + 2] = mPos[i * 3 + 2]! + mVel[i * 3 + 2]! * dt
            mP.set(mPos[i * 3]!, mPos[i * 3 + 1]!, mPos[i * 3 + 2]!)
            mS.setScalar(mSize[i]! * (0.4 + 0.6 * k))
            mM.compose(mP, mQ, mS)
            motes.setMatrixAt(i, mM)
            tmpC.copy(mCol[i]!).multiplyScalar(k * k)
            motes.setColorAt(i, tmpC)
        }
        if (any) {
            motes.instanceMatrix.needsUpdate = true
            if (motes.instanceColor) motes.instanceColor.needsUpdate = true
        }
    }
    const tmpC = new THREE.Color()

    const live = new Map<number, Live>()
    /** Recently gone shells and bolts (their explode event finds the tier and heading here). */
    const recent: { pos: THREE.Vector3, vel: THREE.Vector3, tier: number, kind: DfProjectileSnap['kind'], at: number }[] = []
    let time = 0
    const camPos = new THREE.Vector3()
    const tmpV = new THREE.Vector3()
    const tmpQ = new THREE.Quaternion()

    // Static collision for decal placement: every door removed (a decal must never sit on a door that has
    // since opened), and prop proxies and invisible walls left out (their boxes are not what players see).
    let world: DfCollisionWorld | null = null
    const decalWorld = (): DfCollisionWorld => {
        world ??= dfCollisionFromSolids(DF_MAP.solids.filter(s => !s.door && !s.prop && !s.hidden && !s.playerOnly))
        return world
    }

    function make(p: DfProjectileSnap): Live {
        let mesh: THREE.Object3D
        let bolt: BoltParts | null = null
        const tier = Math.max(0, Math.min(3, p.tier | 0))
        if (p.kind === 'grenade') {
            mesh = new THREE.Mesh(stickG, solidMat)
        } else if (p.kind === 'mortar') {
            // the killstreak Granatwerfer's heavy shell: a fat dark round
            mesh = new THREE.Mesh(ball, solidMat)
            mesh.scale.setScalar(1.9)
        } else if (p.kind === 'pap-grenade') {
            mesh = new THREE.Mesh(ball, papMats[Math.max(0, Math.min(2, p.tier - 1))]!)
        } else if (p.kind === 'xray-bolt') {
            const m = boltMats[tier]!
            const grp = new THREE.Group()
            const core = new THREE.Mesh(coreG, m.core)
            const shell = new THREE.Mesh(shellG, m.shell)
            const ring = new THREE.Mesh(ringG, m.ring)
            ring.position.z = 0.02
            const trail = new THREE.Mesh(trailG, m.trail)
            const outer = new THREE.Mesh(trailG, m.trailOuter)
            trail.scale.set(0.035, 0.035, 0.01)
            outer.scale.set(1.0 / 0.035 * 0.11, 1.0 / 0.035 * 0.11, 1)
            trail.add(outer)
            const halo = new THREE.Mesh(haloG, m.halo)
            halo.scale.setScalar(0.32)
            grp.add(trail, shell, core, ring, halo)
            for (const o of [core, shell, ring, trail, outer, halo]) o.renderOrder = 6
            mesh = grp
            bolt = { ring, trail, halo }
        } else {
            mesh = new THREE.Mesh(spitG, spitMat)
        }
        group.add(mesh)
        let light: THREE.PointLight | null = null
        if (p.kind === 'xray-bolt' || p.kind === 'pap-grenade') {
            light = lights.find(l => !(l.userData.used as boolean)) ?? null
            if (light) {
                light.userData.used = true
                light.color.set(p.kind === 'xray-bolt' ? dfXrayScheme(tier).core : DF_PAP_COLORS[Math.max(0, Math.min(2, p.tier - 1))]!)
            }
        }
        const pos = new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z)
        return { mesh, kind: p.kind, seen: true, trailT: 0, light, pos, vel: new THREE.Vector3(), tier, from: pos.clone(), spin: Math.random() * 6, bolt }
    }

    function release(id: number, l: Live): void {
        group.remove(l.mesh)
        if (l.light) {
            l.light.intensity = 0
            l.light.userData.used = false
        }
        if (l.kind === 'pap-grenade' || l.kind === 'xray-bolt' || l.kind === 'grenade') recent.push({ pos: l.pos.clone(), vel: l.vel.clone(), tier: l.tier, kind: l.kind, at: time })
        live.delete(id)
    }

    /** The blast's tier (the server's, else the nearest projectile's) and the heading of the projectile behind it. */
    function nearest(pos: THREE.Vector3, kind: DfProjectileSnap['kind'], tier?: number): { tier: number, vel: THREE.Vector3 | null } {
        // a bolt whose explode event beats its release is still live
        const r = dfBlastSource(pos, kind, [...recent, ...live.values()], tier)
        return { tier: r.tier, vel: r.src?.vel ?? null }
    }

    function distK(pos: THREE.Vector3, range: number): number {
        ctx.camera.getWorldPosition(camPos)
        return Math.max(0, 1 - camPos.distanceTo(pos) / range)
    }

    function play(name: string, pos: THREE.Vector3, rate = 1): void {
        try {
            ctx.audio.play(name, { pos, rate })
        } catch {
            // optional
        }
    }

    /** Scorch a blast: only onto a world surface right at the blast, oriented to it, sized to fit. */
    function scorch(pos: THREE.Vector3, hint: THREE.Vector3 | null, scale: number): DfRayHit | null {
        const w = decalWorld()
        const hit = dfBlastSurface(w, pos, hint, 0.5)
        if (!hit) return null
        // A scorch's visible burn is ~70% of its 2-2.8 m quad: check that much of the rim.
        const fit = dfDecalFit(w, hit, 1.4 * 0.7 * scale, [1, 0.7, 0.45])
        if (fit > 0) ctx.fx.decal(hit.point, hit.normal, 'scorch', scale * fit)
        return hit
    }

    function flare(pos: THREE.Vector3, normal: THREE.Vector3 | null, tier: number, size: number): void {
        const f = flares[flareNext]!
        flareNext = (flareNext + 1) % flares.length
        const s = dfXrayScheme(tier)
        f.ballMat.color.set(s.hot).multiplyScalar(2.5)
        f.ringMat.color.set(s.core).multiplyScalar(2.5)
        f.ball.position.copy(pos)
        f.ring.position.copy(pos)
        if (normal) f.ring.position.addScaledVector(normal, 0.03)
        f.ring.quaternion.setFromUnitVectors(ZP, normal ?? tmpV.copy(ctx.camera.position).sub(pos).normalize())
        f.t = 0
        f.life = 0.38
        f.size = size
        f.ball.visible = f.ring.visible = true
    }

    return {
        update(dt, projectiles) {
            time += dt
            for (const l of live.values()) l.seen = false
            for (const p of projectiles) {
                let l = live.get(p.id)
                if (!l) {
                    l = make(p)
                    live.set(p.id, l)
                }
                l.seen = true
                l.pos.set(p.pos.x, p.pos.y, p.pos.z)
                l.vel.set(p.vel.x, p.vel.y, p.vel.z)
                l.mesh.position.copy(l.pos)
                const sp = l.vel.length()
                if (l.kind === 'xray-bolt') {
                    if (sp > 0.01) l.mesh.quaternion.setFromUnitVectors(Z, tmpV.copy(l.vel).divideScalar(sp))
                    const b = l.bolt!
                    l.spin += dt * 18
                    b.ring.rotation.z = l.spin
                    const pulse = 1 + Math.sin(time * 40 + l.spin) * 0.12
                    b.ring.scale.setScalar(pulse * 1.15)
                    b.halo.scale.setScalar(0.3 * pulse)
                    b.halo.quaternion.copy(tmpQ.setFromAxisAngle(ZP, l.spin * 0.5))
                    // The trail stretches back toward where the bolt was first seen.
                    b.trail.scale.z = Math.max(0.01, Math.min(TRAIL_MAX, l.pos.distanceTo(l.from)))
                } else if (l.kind === 'grenade') {
                    l.mesh.rotation.x += dt * 12
                    l.mesh.rotation.z += dt * 3
                } else if (l.kind === 'mortar') {
                    l.mesh.rotation.x += dt * 6
                } else if (l.kind === 'pap-grenade') {
                    l.mesh.scale.setScalar(1 + Math.sin(time * 30) * 0.15)
                    l.mesh.rotation.y += dt * 9
                    l.mesh.rotation.x += dt * 5
                } else if (l.kind === 'spit') {
                    l.mesh.rotation.y += dt * 4
                }
                if (l.light) {
                    l.light.position.copy(l.pos)
                    l.light.intensity = l.kind === 'xray-bolt' ? 6.5 + Math.sin(time * 37 + l.spin) * 1.2 : 3
                }
                l.trailT -= dt
                if (l.trailT <= 0 && sp > 0.5) {
                    if (l.kind === 'pap-grenade') {
                        l.trailT = 0.03
                        ctx.fx.burst('pap', l.pos, { count: 1, scale: 0.4, color: DF_PAP_COLORS[Math.max(0, Math.min(2, l.tier - 1))] })
                    } else if (l.kind === 'xray-bolt') {
                        l.trailT = high ? 0.012 : 0.025
                        const c = rayColor[l.tier]!
                        const r = () => (Math.random() - 0.5) * 0.9
                        mote(l.pos.x, l.pos.y, l.pos.z, r() - l.vel.x * 0.02, r() + 0.3, r() - l.vel.z * 0.02, 0.25 + Math.random() * 0.3, 0.018 + Math.random() * 0.014, 1.5, c)
                    } else if (l.kind === 'spit') {
                        l.trailT = 0.06
                        ctx.fx.burst('gas', l.pos, { count: 1, scale: 0.25 })
                    } else if (l.kind === 'grenade') {
                        l.trailT = 0.08
                        ctx.fx.burst('smoke', l.pos, { count: 1, scale: 0.08 })
                    } else if (l.kind === 'mortar') {
                        l.trailT = 0.04
                        ctx.fx.burst('smoke', l.pos, { count: 1, scale: 0.22 })
                        ctx.fx.burst('embers', l.pos, { count: 1, scale: 0.3 })
                    }
                }
            }
            for (const [id, l] of live) if (!l.seen) release(id, l)
            for (let i = recent.length - 1; i >= 0; i--) if (time - recent[i]!.at > 1) recent.splice(i, 1)
            updateMotes(dt)
            for (const f of flares) {
                if (f.t >= 1) continue
                f.t = Math.min(1, f.t + dt / f.life)
                const u = f.t
                const pop = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85
                f.ball.scale.setScalar(f.size * (0.35 + 0.45 * Math.sqrt(u)))
                f.ballMat.opacity = Math.max(0, pop) ** 1.5
                f.ring.scale.setScalar(f.size * (0.6 + 9 * (1 - (1 - u) ** 3)))
                f.ringMat.opacity = (1 - u) ** 2
                if (u >= 1) f.ball.visible = f.ring.visible = false
            }
        },
        onEvent(ev: DfEvent) {
            if (ev.k === 'explode') {
                const pos = new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z)
                const sc = Math.max(0.4, ev.radius / 4)
                switch (ev.kind) {
                    case 'grenade':
                    case 'pap-grenade': {
                        const src = nearest(pos, ev.kind, ev.tier)
                        const hit = scorch(pos, src.vel, 1)
                        const n = hit ? new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) : UP
                        ctx.fx.burst('explosion', pos, { scale: sc })
                        ctx.fx.burst('dust', pos, { normal: n, scale: sc })
                        if (ev.kind === 'pap-grenade') {
                            const c = DF_PAP_COLORS[Math.max(0, Math.min(2, src.tier - 1))]!
                            ctx.fx.burst('pap', pos, { scale: sc * 1.5, color: c })
                            ctx.fx.flash(pos, c, 20, 0.3)
                        }
                        play(DF_WSND.explode, pos, ev.kind === 'pap-grenade' ? 1.15 : 1)
                        break
                    }
                    case 'xray': {
                        const src = nearest(pos, 'xray-bolt', ev.tier)
                        const tier = src.tier
                        const hit = scorch(pos, src.vel, 0.55 + tier * 0.1)
                        const n = hit ? new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) : null
                        ctx.fx.burst('ray', pos, { scale: sc, normal: n ?? (src.vel ? tmpV.copy(src.vel).negate().normalize() : UP), color: rayColor[tier] })
                        // A spray of glowing motes off the surface (or all round in the air).
                        const sn = n ?? tmpV.set(0, 0, 0)
                        for (let i = 0; i < (high ? 26 : 14); i++) {
                            const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
                            if (n && v.dot(sn) < 0) v.reflect(sn)
                            const sp = 2 + Math.random() * 5
                            mote(pos.x, pos.y, pos.z, v.x * sp, v.y * sp + 1, v.z * sp, 0.35 + Math.random() * 0.45, 0.02 + Math.random() * 0.025, 6, rayColor[tier]!)
                        }
                        ctx.fx.flash(pos, dfXrayScheme(tier).core, 22 + tier * 4, 0.3)
                        flare(pos, n, tier, 0.6 + sc * 0.4)
                        ctx.fx.shake(0.25 * distK(pos, 12))
                        play(DF_WSND.xrayHit, pos, 1 - tier * 0.05)
                        break
                    }
                    case 'shock':
                        ctx.fx.burst('electric', pos, { scale: sc * 1.5 })
                        ctx.fx.flash(pos, 0x8ab8ff, 16, 0.2)
                        ctx.fx.shake(0.2 * distK(pos, 10))
                        play(DF_WSND.arc, pos)
                        break
                    case 'bloater':
                        ctx.fx.burst('gas', pos, { scale: sc })
                        ctx.fx.burst('blood', pos, { normal: UP, color: 0x6a8a1a, scale: 0.6 })
                        play(DF_WSND.splat, pos)
                        break
                    case 'nuke':
                        ctx.fx.burst('explosion', pos, { scale: 2.5 })
                        ctx.fx.flash(pos, 0xfff0d0, 60, 0.6)
                        ctx.fx.shake(0.6)
                        play(DF_WSND.explode, pos, 0.7)
                        break
                }
            } else if (ev.k === 'arc') {
                let from = new THREE.Vector3(ev.from.x, ev.from.y, ev.from.z)
                for (const t of ev.to) {
                    const to = new THREE.Vector3(t.x, t.y, t.z)
                    ctx.fx.lightning(from, to, 0x9fd0ff)
                    ctx.fx.burst('electric', to, { scale: 0.8 })
                    from = to
                }
                const first = ev.to[0]
                if (first) play(DF_WSND.arc, new THREE.Vector3(first.x, first.y, first.z))
            }
        },
        dispose() {
            for (const [id, l] of live) release(id, l)
            ctx.scene.remove(group)
            for (const x of geos) x.dispose()
            for (const m of mats) m.dispose()
        }
    }
}
