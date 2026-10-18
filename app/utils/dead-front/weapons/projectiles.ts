import * as THREE from 'three'
import type { DfEvent, DfProjectileSnap } from '#shared/utils/dead-front/protocol'
import { DF_PAP_COLORS } from '#shared/utils/dead-front/weapons'
import type { DfProjectileView, DfRenderContext } from '../context'
import { DfVoxModel } from '../voxel/model'
import { dfWeaponMat } from './materials'
import { DF_WSND } from './sounds'

// Voxel projectiles (grenades, PaP grenades, X-Ray bolts, bloater spit) and the
// `explode` / `arc` events. Meshes are pooled per kind; bolt lights come from
// a fixed pool added once.

interface Live {
    mesh: THREE.Object3D
    kind: DfProjectileSnap['kind']
    seen: boolean
    trailT: number
    light: THREE.PointLight | null
    pos: THREE.Vector3
    tier: number
}

const UP = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, -1)

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
    // Voxel projectiles: a stick grenade, glowing cube clusters for the PaP shells and
    // X-Ray bolts (a core plus a stubby voxel trail), a lumpy green spit ball.
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
    const boltM = new DfVoxModel(3, 3, 18)
    boltM.box(0, 0, 0, 3, 3, 6, boltM.c(0xd8ffe0, 1)).box(1, 1, 6, 2, 2, 18, boltM.c(0x5dff7a, 1)).box(0, 0, 6, 3, 3, 10, boltM.c(0x5dff7a, 1))
    const boltG = g(boltM.mesh(0.03, [1.5, 1.5, 3])!)
    const spitM = new DfVoxModel(5, 5, 5)
    spitM.vox.ellipsoid(2.5, 2.5, 2.5, 2.6, 2.6, 2.6, (i, j, k) => spitM.c(((i + j + k) & 1) ? 0x7a9a22 : 0x9fc23a, 0.35))
    const spitG = g(spitM.mesh(0.03, [2.5, 2.5, 2.5])!)
    const additive = (hex: THREE.ColorRepresentation, k: number) => {
        const m = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
        mats.push(m)
        return m
    }
    const papMats = DF_PAP_COLORS.map(c => additive(c, 2.4))
    const boltMat = additive(0xffffff, 2.2)
    const spitMat = solidMat

    const lights: THREE.PointLight[] = []
    for (let i = 0; i < 3; i++) {
        const l = new THREE.PointLight(0x5dff7a, 0, 6, 2)
        group.add(l)
        lights.push(l)
    }
    const live = new Map<number, Live>()
    const recent: { pos: THREE.Vector3, tier: number, at: number }[] = []
    let time = 0
    const camPos = new THREE.Vector3()

    function make(p: DfProjectileSnap): Live {
        let mesh: THREE.Object3D
        if (p.kind === 'grenade') {
            mesh = new THREE.Mesh(stickG, solidMat)
        } else if (p.kind === 'pap-grenade') {
            mesh = new THREE.Mesh(ball, papMats[Math.max(0, Math.min(2, p.tier - 1))]!)
        } else if (p.kind === 'xray-bolt') {
            mesh = new THREE.Mesh(boltG, boltMat)
        } else {
            mesh = new THREE.Mesh(spitG, spitMat)
        }
        group.add(mesh)
        let light: THREE.PointLight | null = null
        if (p.kind === 'xray-bolt' || p.kind === 'pap-grenade') {
            light = lights.find(l => !(l.userData.used as boolean)) ?? null
            if (light) {
                light.userData.used = true
                light.color.set(p.kind === 'xray-bolt' ? 0x5dff7a : DF_PAP_COLORS[Math.max(0, Math.min(2, p.tier - 1))]!)
            }
        }
        return { mesh, kind: p.kind, seen: true, trailT: 0, light, pos: new THREE.Vector3(), tier: p.tier }
    }

    function release(id: number, l: Live): void {
        group.remove(l.mesh)
        if (l.light) {
            l.light.intensity = 0
            l.light.userData.used = false
        }
        if (l.kind === 'pap-grenade') recent.push({ pos: l.pos.clone(), tier: l.tier, at: time })
        live.delete(id)
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
                l.mesh.position.copy(l.pos)
                const v = new THREE.Vector3(p.vel.x, p.vel.y, p.vel.z)
                const sp = v.length()
                if (l.kind === 'xray-bolt' && sp > 0.01) l.mesh.quaternion.setFromUnitVectors(Z, v.divideScalar(sp))
                else if (l.kind === 'grenade') {
                    l.mesh.rotation.x += dt * 12
                    l.mesh.rotation.z += dt * 3
                } else if (l.kind === 'pap-grenade') {
                    l.mesh.scale.setScalar(1 + Math.sin(time * 30) * 0.15)
                    l.mesh.rotation.y += dt * 9
                    l.mesh.rotation.x += dt * 5
                } else if (l.kind === 'spit') {
                    l.mesh.rotation.y += dt * 4
                }
                if (l.light) {
                    l.light.position.copy(l.pos)
                    l.light.intensity = l.kind === 'xray-bolt' ? 6 : 3
                }
                l.trailT -= dt
                if (l.trailT <= 0 && sp > 0.5) {
                    if (l.kind === 'pap-grenade') {
                        l.trailT = 0.03
                        ctx.fx.burst('pap', l.pos, { count: 1, scale: 0.4, color: DF_PAP_COLORS[Math.max(0, Math.min(2, l.tier - 1))] })
                    } else if (l.kind === 'spit') {
                        l.trailT = 0.06
                        ctx.fx.burst('gas', l.pos, { count: 1, scale: 0.25 })
                    } else if (l.kind === 'grenade') {
                        l.trailT = 0.08
                        ctx.fx.burst('smoke', l.pos, { count: 1, scale: 0.08 })
                    }
                }
            }
            for (const [id, l] of live) if (!l.seen) release(id, l)
            for (let i = recent.length - 1; i >= 0; i--) if (time - recent[i]!.at > 1) recent.splice(i, 1)
        },
        onEvent(ev: DfEvent) {
            if (ev.k === 'explode') {
                const pos = new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z)
                const sc = Math.max(0.4, ev.radius / 4)
                switch (ev.kind) {
                    case 'grenade':
                    case 'pap-grenade': {
                        ctx.fx.burst('explosion', pos, { scale: sc })
                        ctx.fx.burst('dust', pos, { normal: UP, scale: sc })
                        ctx.fx.decal(pos, UP, 'scorch')
                        if (ev.kind === 'pap-grenade') {
                            let tier = 1
                            let best = 3
                            for (const r of recent) {
                                const d = r.pos.distanceTo(pos)
                                if (d < best) {
                                    best = d
                                    tier = r.tier
                                }
                            }
                            const c = DF_PAP_COLORS[Math.max(0, Math.min(2, tier - 1))]!
                            ctx.fx.burst('pap', pos, { scale: sc * 1.5, color: c })
                            ctx.fx.flash(pos, c, 20, 0.3)
                        }
                        play(DF_WSND.explode, pos, ev.kind === 'pap-grenade' ? 1.15 : 1)
                        break
                    }
                    case 'xray':
                        ctx.fx.burst('ray', pos, { scale: sc })
                        ctx.fx.flash(pos, 0x5dff7a, 18, 0.25)
                        ctx.fx.decal(pos, UP, 'scorch')
                        ctx.fx.shake(0.25 * distK(pos, 12))
                        play(DF_WSND.xrayHit, pos)
                        break
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
