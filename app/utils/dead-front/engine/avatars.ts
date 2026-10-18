import * as THREE from 'three'
import { DF_FLAG } from '#shared/utils/dead-front/protocol'
import type { DfHeldWeapon, DfPlayerSnap } from '#shared/utils/dead-front/protocol'
import type { Vec3 } from '#shared/utils/dead-front/types'
import { buildDfWeaponModel } from '~/utils/dead-front/weapons'
import type { DfRenderContext } from '../context'
import { dfVoxMaterial } from '../voxel/material'
import { DfVoxModel } from '../voxel/model'
import type { DfInterpPlayer } from './interp'

// Remote player avatars: procedural WWI infantrymen (Brodie helmet,
// greatcoat, puttees) animated from their interpolated velocity and flags,
// holding their actual weapon model, with name tags, muzzle flashes and a
// downed pose with a revive marker.

export const DF_PLAYER_COLORS = ['#e8c872', '#7fb8e8', '#9fe07f', '#e88f7f'] as const

export function dfPlayerColor(pid: number): string {
    return DF_PLAYER_COLORS[((pid % 4) + 4) % 4]!
}


interface Geos {
    torso: THREE.BufferGeometry
    skirt: THREE.BufferGeometry
    thigh: THREE.BufferGeometry
    shin: THREE.BufferGeometry
    upperArm: THREE.BufferGeometry
    foreArm: THREE.BufferGeometry
    head: THREE.BufferGeometry
    helmet: THREE.BufferGeometry
    pack: THREE.BufferGeometry
    flash: THREE.BufferGeometry
}

const AV = 0.06

/** Blocky Tommy parts: khaki wool, puttees, a Brodie helmet, all 6 cm voxels. */
function soldierGeos(): Geos {
    const COAT = 0x8a7f55
    const COAT_D = 0x6f6644
    const WEB = 0xa69b78
    const SKIN = 0xc79a7a
    const torso = new DfVoxModel(6, 10, 4)
    torso.box(0, 0, 0, 6, 10, 4, torso.shade(COAT, 0.05, 1))
    torso.box(0, 0, 0, 6, 1, 4, torso.c(0x4e3220))
    torso.box(1, 9, 0, 5, 10, 4, torso.c(COAT_D))
    for (let j = 1; j < 9; j++) torso.set(Math.min(5, Math.max(0, Math.round(1 + (j - 1) * 0.55))), j, 0, torso.c(WEB)).set(Math.min(5, Math.max(0, Math.round(4 - (j - 1) * 0.55))), j, 0, torso.c(WEB))
    torso.box(1, 3, 0, 2, 5, 1, torso.c(0x7a6a40)).box(4, 3, 0, 5, 5, 1, torso.c(0x7a6a40))
    const skirt = new DfVoxModel(6, 6, 4)
    skirt.box(0, 0, 0, 6, 6, 4, skirt.shade(COAT, 0.05, 2))
    skirt.box(2, 0, 0, 4, 3, 1, 0)
    const thigh = new DfVoxModel(2, 7, 2)
    thigh.box(0, 0, 0, 2, 7, 2, thigh.shade(0x7f7550, 0.05, 3))
    const shin = new DfVoxModel(2, 7, 4)
    shin.box(0, 1, 1, 2, 7, 3, shin.shade(0x6b6243, 0.08, 4))
    shin.box(0, 0, 0, 2, 1, 4, shin.c(0x2c2117)).box(0, 1, 0, 2, 2, 2, shin.c(0x2c2117))
    const upper = new DfVoxModel(2, 5, 2)
    upper.box(0, 0, 0, 2, 5, 2, upper.shade(COAT, 0.05, 5))
    const fore = new DfVoxModel(2, 6, 2)
    fore.box(0, 1, 0, 2, 6, 2, fore.shade(COAT, 0.05, 6)).box(0, 0, 0, 2, 1, 2, fore.c(SKIN))
    const head = new DfVoxModel(3, 4, 3)
    head.box(0, 0, 0, 3, 4, 3, head.shade(SKIN, 0.04, 7))
    head.set(0, 2, 0, head.c(0x2a1e14)).set(2, 2, 0, head.c(0x2a1e14)).box(0, 0, 0, 3, 1, 3, head.c(0xb8896a))
    const helmet = new DfVoxModel(7, 2, 7)
    const steel = helmet.shade(0x56553d, 0.06, 8)
    helmet.box(0, 0, 0, 7, 1, 7, steel).box(1, 1, 1, 6, 2, 6, steel)
    helmet.set(0, 0, 0, 0).set(6, 0, 0, 0).set(0, 0, 6, 0).set(6, 0, 6, 0)
    const pack = new DfVoxModel(5, 5, 2)
    pack.box(0, 0, 0, 5, 5, 2, pack.shade(WEB, 0.06, 9)).box(0, 4, 0, 5, 5, 2, pack.c(0x7a6a40))
    const flash = new DfVoxModel(5, 5, 1)
    const hot = flash.c(0xffffff, 1)
    const warm = flash.c(0xffb050, 1)
    for (let t = 0; t < 5; t++) flash.set(t, 2, 0, warm).set(2, t, 0, warm)
    flash.set(2, 2, 0, hot).set(1, 1, 0, warm).set(3, 3, 0, warm).set(1, 3, 0, warm).set(3, 1, 0, warm)
    return {
        torso: torso.mesh(AV, [3, 0, 2])!,
        skirt: skirt.mesh(AV, [3, 6, 2])!,
        thigh: thigh.mesh(AV, [1, 7, 1])!,
        shin: shin.mesh(AV, [1, 7, 2.5])!,
        upperArm: upper.mesh(AV, [1, 5, 1])!,
        foreArm: fore.mesh(AV, [1, 6, 1])!,
        head: head.mesh(AV, [1.5, 0, 1.5])!,
        helmet: helmet.mesh(AV, [3.5, 0, 3.5])!,
        pack: pack.mesh(AV, [2.5, 2.5, 1])!,
        flash: flash.mesh(0.08, [2.5, 2.5, 0.5])!
    }
}

function nameTexture(name: string, color: string): { tex: THREE.CanvasTexture, aspect: number } {
    const c = document.createElement('canvas')
    const g = c.getContext('2d')!
    const font = '600 40px Georgia, "Times New Roman", serif'
    g.font = font
    const w = Math.min(512, Math.ceil(g.measureText(name).width) + 32)
    c.width = w
    c.height = 60
    g.font = font
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineWidth = 6
    g.strokeStyle = 'rgba(0,0,0,0.75)'
    g.strokeText(name, w / 2, 32)
    g.fillStyle = color
    g.fillText(name, w / 2, 32)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return { tex, aspect: w / 60 }
}

function reviveTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas')
    c.width = c.height = 96
    const g = c.getContext('2d')!
    g.fillStyle = 'rgba(0,0,0,0.55)'
    g.beginPath()
    g.arc(48, 48, 40, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = '#f2e8d0'
    g.lineWidth = 5
    g.stroke()
    g.fillStyle = '#c8241c'
    g.fillRect(40, 22, 16, 52)
    g.fillRect(22, 40, 52, 16)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
}

interface Avatar {
    pid: number
    root: THREE.Group
    body: THREE.Group
    hips: THREE.Group
    torso: THREE.Group
    chest: THREE.Group
    head: THREE.Group
    legL: THREE.Group
    legR: THREE.Group
    kneeL: THREE.Group
    kneeR: THREE.Group
    armL: THREE.Group
    armR: THREE.Group
    elbowL: THREE.Group
    elbowR: THREE.Group
    gunMount: THREE.Group
    gun: THREE.Group | null
    gunKey: string
    muzzle: THREE.Vector3
    flash: THREE.Mesh
    flashT: number
    tag: THREE.Sprite
    tagTex: THREE.CanvasTexture
    tagMat: THREE.SpriteMaterial
    revive: THREE.Sprite
    name: string
    phase: number
    stride: number
    lean: number
    crouch: number
    down: number
    kick: number
    yawVis: number
    seen: boolean
}

export interface DfAvatarManager {
    /** Updates all remote avatars from interpolated players. */
    update(dt: number, time: number, players: readonly DfInterpPlayer[], count: number): void
    /** World position of a remote player's muzzle (or null if not visible). */
    muzzle(pid: number, out: THREE.Vector3): THREE.Vector3 | null
    /** Kicks the avatar and shows its muzzle flash. */
    fired(pid: number): void
    /** Hides one avatar (the spectated player), -1 for none. */
    hidden: number
    /** Footstep callback for remote players. */
    onStep: ((pid: number, pos: Vec3, running: boolean) => void) | null
    dispose(): void
}

export function createDfAvatars(ctx: DfRenderContext): DfAvatarManager {
    const reviveTex = reviveTexture()
    const mat = dfVoxMaterial()
    const flashMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.4, 2, 1.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, side: THREE.DoubleSide })
    const geos = soldierGeos()

    const avatars = new Map<number, Avatar>()
    const tmp = new THREE.Vector3()

    function mesh(g: THREE.BufferGeometry, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh {
        const me = new THREE.Mesh(g, mat)
        me.position.set(x, y, z)
        me.castShadow = true
        parent.add(me)
        return me
    }

    function build(p: DfPlayerSnap): Avatar {
        const root = new THREE.Group()
        root.name = `df-avatar-${p.pid}`
        const body = new THREE.Group()
        root.add(body)
        const hips = new THREE.Group()
        hips.position.y = 0.9
        body.add(hips)
        // coat skirt hangs from the hips; the soldier faces -z
        mesh(geos.skirt, hips, 0, 0.06, 0)
        const torso = new THREE.Group()
        hips.add(torso)
        mesh(geos.torso, torso)
        mesh(geos.pack, torso, 0, 0.33, 0.18)
        // chest pivot (aim pitch) at the shoulders
        const chest = new THREE.Group()
        chest.position.y = 0.54
        torso.add(chest)
        const head = new THREE.Group()
        head.position.y = 0.06
        chest.add(head)
        mesh(geos.head, head, 0, 0, 0)
        const helm = mesh(geos.helmet, head, 0, 0.2, 0)
        helm.rotation.x = 0.06
        const mkArm = (side: number) => {
            const arm = new THREE.Group()
            arm.position.set(0.24 * side, 0, 0)
            chest.add(arm)
            mesh(geos.upperArm, arm)
            const elbow = new THREE.Group()
            elbow.position.y = -0.3
            arm.add(elbow)
            mesh(geos.foreArm, elbow)
            return { arm, elbow }
        }
        const L = mkArm(-1)
        const R = mkArm(1)
        R.arm.rotation.set(1.05, 0, 0.25)
        R.elbow.rotation.set(0.75, 0, 0)
        L.arm.rotation.set(1.3, 0, -0.5)
        L.elbow.rotation.set(0.35, 0, 0)
        const gunMount = new THREE.Group()
        gunMount.position.set(0.1, -0.08, -0.32)
        chest.add(gunMount)
        const mkLeg = (side: number) => {
            const leg = new THREE.Group()
            leg.position.set(0.09 * side, -0.02, 0)
            hips.add(leg)
            mesh(geos.thigh, leg)
            const knee = new THREE.Group()
            knee.position.y = -0.42
            leg.add(knee)
            mesh(geos.shin, knee)
            return { leg, knee }
        }
        const LL = mkLeg(-1)
        const RL = mkLeg(1)

        const flash = new THREE.Mesh(geos.flash, flashMat)
        flash.visible = false
        root.add(flash)

        const color = dfPlayerColor(p.pid)
        const { tex, aspect } = nameTexture(p.name, color)
        const tagMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 })
        const tag = new THREE.Sprite(tagMat)
        tag.scale.set(0.26 * aspect, 0.26, 1)
        tag.position.y = 2.15
        tag.renderOrder = 20
        root.add(tag)

        const reviveMat = new THREE.SpriteMaterial({ map: reviveTex, depthTest: false, depthWrite: false, transparent: true })
        const revive = new THREE.Sprite(reviveMat)
        revive.scale.setScalar(0.45)
        revive.position.y = 1.1
        revive.visible = false
        revive.renderOrder = 21
        root.add(revive)

        ctx.scene.add(root)
        return {
            pid: p.pid, root, body, hips, torso, chest, head,
            legL: LL.leg, legR: RL.leg, kneeL: LL.knee, kneeR: RL.knee,
            armL: L.arm, armR: R.arm, elbowL: L.elbow, elbowR: R.elbow,
            gunMount, gun: null, gunKey: '', muzzle: new THREE.Vector3(0, 0, -0.6),
            flash, flashT: 0, tag, tagTex: tex, tagMat, revive, name: p.name,
            phase: 0, stride: 0, lean: 0, crouch: 0, down: 0, kick: 0, yawVis: 0, seen: true
        }
    }

    function disposeGun(a: Avatar): void {
        if (!a.gun) return
        a.gunMount.remove(a.gun)
        a.gun.traverse((o) => {
            const m = o as THREE.Mesh
            if (m.isMesh) m.geometry?.dispose()
        })
        a.gun = null
    }

    function setGun(a: Avatar, w: DfHeldWeapon | null): void {
        const key = w ? `${w.id}:${w.pap}:${JSON.stringify(w.attachments ?? {})}` : ''
        if (key === a.gunKey) return
        a.gunKey = key
        disposeGun(a)
        if (!w) return
        let g: THREE.Group
        try {
            g = buildDfWeaponModel(w.id, w.pap, w.attachments ?? {})
        } catch {
            return
        }
        g.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) o.castShadow = true
        })
        a.gun = g
        a.gunMount.add(g)
        const box = new THREE.Box3().setFromObject(g)
        a.muzzle.set(0, (box.min.y + box.max.y) / 2 || 0, Number.isFinite(box.min.z) ? box.min.z : -0.6)
    }

    function remove(pid: number): void {
        const a = avatars.get(pid)
        if (!a) return
        disposeGun(a)
        ctx.scene.remove(a.root)
        a.tagTex.dispose()
        a.tagMat.dispose()
        ;(a.revive.material as THREE.SpriteMaterial).dispose()
        avatars.delete(pid)
    }

    const easeTo = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, dt * rate)

    function animate(a: Avatar, ip: DfInterpPlayer, dt: number, time: number): void {
        const p = ip.snap
        const flags = ip.flags
        a.root.position.set(ip.pos.x, ip.pos.y, ip.pos.z)
        a.yawVis = ip.yaw
        a.root.rotation.y = a.yawVis
        const hs = Math.sqrt(ip.vx * ip.vx + ip.vz * ip.vz)
        // movement direction relative to facing: forward is -z at yaw 0
        const fwdX = -Math.sin(ip.yaw)
        const fwdZ = -Math.cos(ip.yaw)
        const along = hs > 0.05 ? (ip.vx * fwdX + ip.vz * fwdZ) / hs : 1
        const crouched = (flags & DF_FLAG.crouch) !== 0
        const sprinting = (flags & DF_FLAG.sprint) !== 0
        const downed = p.life === 'down'
        a.crouch = easeTo(a.crouch, crouched ? 1 : 0, 10, dt)
        a.down = easeTo(a.down, downed ? 1 : 0, 6, dt)
        a.lean = easeTo(a.lean, sprinting ? 1 : 0, 6, dt)
        const strideLen = sprinting ? 2.1 : 1.45
        const prevPhase = a.phase
        a.phase += (hs / strideLen) * Math.PI * 2 * dt * (along < -0.3 ? -1 : 1)
        // footsteps twice per cycle
        if (Math.floor(prevPhase / Math.PI) !== Math.floor(a.phase / Math.PI) && hs > 0.6 && !downed && Math.abs(ip.vy) < 1.5) mgr.onStep?.(a.pid, ip.pos, sprinting)
        const amp = Math.min(1, hs / 4.4) * (sprinting ? 0.85 : 0.6) * (1 - a.crouch * 0.4)
        const s = Math.sin(a.phase)
        const c = Math.cos(a.phase)
        const airborne = Math.abs(ip.vy) > 1.5

        // legs
        a.legL.rotation.x = s * amp - a.crouch * 1.15 + (airborne ? -0.4 : 0)
        a.legR.rotation.x = -s * amp - a.crouch * 1.15 + (airborne ? -0.2 : 0)
        a.kneeL.rotation.x = Math.max(0, -c) * amp * 1.4 + a.crouch * 1.75 + (airborne ? 0.7 : 0)
        a.kneeR.rotation.x = Math.max(0, c) * amp * 1.4 + a.crouch * 1.75 + (airborne ? 0.5 : 0)
        a.hips.position.y = 0.9 - a.crouch * 0.36 + Math.abs(c) * 0.035 * amp
        a.hips.rotation.y = s * 0.08 * amp
        // torso lean (sprint forward, crouch slightly)
        a.torso.rotation.x = -(a.lean * 0.28 + a.crouch * 0.18)
        a.torso.rotation.y = -s * 0.06 * amp
        // aim pitch on the chest; sprinting carries the weapon low across the body
        a.kick = Math.max(0, a.kick - dt * 9)
        const aim = p.pitch * 0.85
        // (cancels the torso lean so the aim stays level, then drops the weapon while sprinting)
        a.chest.rotation.x = aim * (1 - a.lean) - a.lean * 0.27 + a.crouch * 0.18 + a.kick * 0.12
        a.chest.rotation.z = a.lean * 0.25
        a.head.rotation.x = p.pitch * 0.15 + a.lean * 0.2
        a.gunMount.position.z = -0.32 + a.kick * 0.05

        // downed: on the back, propped on an elbow, pistol up
        a.body.rotation.x = a.down * 1.25
        a.body.position.y = a.down * 0.05
        a.body.position.z = a.down * -0.6
        if (a.down > 0.01) {
            a.legL.rotation.x = (1 - a.down) * a.legL.rotation.x + a.down * (0.1 + Math.sin(time * 1.3) * 0.08)
            a.legR.rotation.x = (1 - a.down) * a.legR.rotation.x + a.down * -0.05
            a.kneeL.rotation.x *= 1 - a.down * 0.8
            a.kneeR.rotation.x *= 1 - a.down * 0.8
            a.chest.rotation.x = (1 - a.down) * a.chest.rotation.x + a.down * (-0.95 + p.pitch * 0.4)
        }
        a.revive.visible = downed
        if (downed) {
            const k = 0.42 + Math.sin(time * 5) * 0.05 + p.reviveProgress * 0.1
            a.revive.scale.setScalar(k)
            ;(a.revive.material as THREE.SpriteMaterial).opacity = 0.7 + Math.sin(time * 5) * 0.3
        }
        a.tag.position.y = downed ? 1.55 : 2.15 - a.crouch * 0.4

        // muzzle flash
        if (a.flashT > 0) {
            a.flashT -= dt
            a.flash.visible = a.flashT > 0
            if (a.flash.visible && a.gun) {
                a.gun.localToWorld(tmp.copy(a.muzzle))
                a.root.worldToLocal(tmp)
                a.flash.position.copy(tmp)
                a.flash.quaternion.copy(ctx.camera.quaternion)
                a.flash.rotateZ(Math.floor(Math.random() * 4) * Math.PI / 4)
                a.flash.scale.setScalar(0.8 + Math.random() * 0.5)
            }
        }
    }

    const mgr: DfAvatarManager = {
        onStep: null,
        hidden: -1,
        update(dt, time, players, count) {
            for (const a of avatars.values()) a.seen = false
            for (let i = 0; i < count; i++) {
                const ip = players[i]!
                const p = ip.snap
                if (p.life === 'dead' || !p.connected) {
                    const a = avatars.get(p.pid)
                    if (a) a.root.visible = false
                    if (a) a.seen = true
                    continue
                }
                let a = avatars.get(p.pid)
                if (!a) {
                    a = build(p)
                    avatars.set(p.pid, a)
                }
                a.seen = true
                a.root.visible = p.pid !== mgr.hidden
                const held = p.life === 'down' ? (p.weapons.find(w => w.id === 'm1911') ?? p.weapons[p.slot] ?? null) : (p.weapons[p.slot] ?? null)
                setGun(a, held)
                animate(a, ip, dt, time)
            }
            for (const [pid, a] of avatars) if (!a.seen) remove(pid)
        },
        muzzle(pid, out) {
            const a = avatars.get(pid)
            if (!a || !a.root.visible || !a.gun) return null
            a.root.updateMatrixWorld(true)
            return a.gun.localToWorld(out.copy(a.muzzle))
        },
        fired(pid) {
            const a = avatars.get(pid)
            if (!a) return
            a.kick = 1
            a.flashT = 0.05
        },
        dispose() {
            for (const pid of [...avatars.keys()]) remove(pid)
            for (const g of Object.values(geos)) g.dispose()
            mat.dispose()
            flashMat.dispose()
            reviveTex.dispose()
        }
    }
    return mgr
}
