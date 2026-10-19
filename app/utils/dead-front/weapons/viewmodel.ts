import * as THREE from 'three'
import { DF_PAP_COLORS, DF_WEAPONS, dfWeaponStats, type DfWeaponStats } from '#shared/utils/dead-front/weapons'
import type { DfRenderContext, DfViewmodel, DfViewmodelInput, DfViewmodelWeapon } from '../context'
import { DfVoxModel } from '../voxel/model'
import { dfWeaponMat } from './materials'
import { dfBuildGunRig, disposeDfWeaponModel, type DfGunRig } from './models'
import { DF_WSND } from './sounds'
import { dfXrayScheme } from './xray'

/** Muzzle flash colour for a weapon at a PaP tier (the X-Ray flashes in its tier's own colour). */
export function dfMuzzleFlashColor(id: DfViewmodelWeapon['id'], pap: number): number {
    if (id === 'xray') return dfXrayScheme(pap).core
    if (id === 'wunder') return 0x8ab8ff
    if (pap > 0) return Number.parseInt((DF_PAP_COLORS[Math.min(3, pap) - 1] ?? '#ffd0a0').slice(1), 16)
    return 0xffd0a0
}

// First-person viewmodel, kept deliberately simple: one voxel gun tucked into
// the lower-right corner at a slight inward angle, a single small glove on the
// grip and nothing else. Every motion is a critically damped spring (frame-rate
// independent): idle breathing, sway that lags the mouse, speed-tied bob, a
// sprint pose, a crisp recoil kick that settles in ~0.12 s, ADS in ~0.2 s with
// the sight line (rear notch and front post, measured from the model's own
// voxels) exactly on the camera axis, lower/raise on swap and a
// drop-and-raise reload.

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smooth = (x: number) => {
    const t = clamp01(x)
    return t * t * (3 - 2 * t)
}
/** 0 -> 1 -> 0 bump between a and b with eased flanks. */
const bump = (u: number, a: number, b: number, ramp = 0.15) => smooth((u - a) / ramp) * (1 - smooth((u - (b - ramp)) / ramp))

/** Critically damped spring toward a target (exact for any dt). */
class Crit {
    x = 0
    v = 0
    constructor(public omega: number) {}
    step(dt: number, target = 0): number {
        const w = this.omega
        const d = this.x - target
        const e = Math.exp(-w * dt)
        const t = (this.v + w * d) * dt
        this.x = target + (d + t) * e
        this.v = (this.v - w * t) * e
        return this.x
    }
}

/** Under-damped spring: a kick that settles with a small overshoot (zeta < 1). */
class Spring {
    x = 0
    v = 0
    constructor(public omega: number, public zeta: number) {}
    step(dt: number): number {
        // Semi-implicit Euler in fixed sub-steps: stable for any frame time we clamp to.
        const n = Math.max(1, Math.ceil(dt / 0.004))
        const h = dt / n
        for (let i = 0; i < n; i++) {
            this.v += (-2 * this.zeta * this.omega * this.v - this.omega * this.omega * this.x) * h
            this.x += this.v * h
        }
        return this.x
    }
}

/** Per-class shot feel: muzzle flash shape and the viewmodel's kick. */
interface ShotFeel {
    /** Flash star size, cone length and side-prong size (relative). */
    star: number
    cone: number
    prongs: number
    /** Seconds the flash stays up. */
    flash: number
    /** Kick: push back, muzzle flip, roll and the random yaw. */
    back: number
    flip: number
    roll: number
    yaw: number
}

const FEEL: Record<string, ShotFeel> = {
    pistol: { star: 0.85, cone: 0.9, prongs: 0.5, flash: 0.035, back: 1, flip: 1.5, roll: 0.5, yaw: 1 },
    smg: { star: 0.95, cone: 1.1, prongs: 0.7, flash: 0.03, back: 0.75, flip: 0.7, roll: 0.35, yaw: 1.3 },
    rifle: { star: 1.25, cone: 1.7, prongs: 0.9, flash: 0.045, back: 1.5, flip: 1.2, roll: 0.6, yaw: 0.8 },
    shotgun: { star: 1.8, cone: 1.3, prongs: 1.2, flash: 0.06, back: 1.9, flip: 1.4, roll: 1, yaw: 0.8 },
    lmg: { star: 1.3, cone: 1.4, prongs: 1, flash: 0.035, back: 0.9, flip: 0.6, roll: 0.4, yaw: 1.4 },
    special: { star: 1.1, cone: 0.7, prongs: 0, flash: 0.05, back: 1.1, flip: 1, roll: 0.3, yaw: 0.5 }
}

/** Guns that kick unlike their class: the PPSh's light bolt buzzes (small, quick kicks, more shake). */
const FEEL_ID: Partial<Record<DfViewmodelWeapon['id'], ShotFeel>> = {
    ppsh: { star: 0.8, cone: 1, prongs: 0.85, flash: 0.022, back: 0.5, flip: 0.42, roll: 0.3, yaw: 1.7 }
}

interface Clip {
    kind: 'mag' | 'shell-in' | 'shell' | 'shell-out'
    t: number
    dur: number
    empty: boolean
    fired: Set<number>
}

interface Casing {
    mesh: THREE.Mesh
    vel: THREE.Vector3
    spin: THREE.Vector3
    life: number
}

const V = 0.011
/** Viewmodel camera near plane: fixed, never moved while aiming (it would slice the gun open). */
export const VM_NEAR = 0.01

/** The one hand: a small dark glove wrapped round the grip with a khaki cuff. */
function gloveModel(): DfVoxModel {
    const m = new DfVoxModel(5, 8, 6)
    const leather = m.shade(0x5a4030, 0.06, 4)
    m.box(0, 2, 0, 5, 8, 6, leather)
    m.box(0, 6, 4, 5, 8, 6, m.c(0x4a3426))
    m.box(0, 0, 0, 5, 2, 6, m.shade(0x857c56, 0.05, 6))
    m.set(0, 7, 0, 0).set(4, 7, 0, 0).set(0, 0, 5, 0).set(4, 0, 5, 0)
    return m
}

function knifeModel(): DfVoxModel {
    const m = new DfVoxModel(3, 24, 4)
    m.box(1, 7, 1, 2, 24, 3, m.c(0xb8bcc2)).box(1, 23, 1, 2, 24, 2, m.c(0xdfe2e6))
    m.box(0, 0, 0, 3, 6, 4, m.c(0x2e2118)).box(0, 6, 0, 3, 7, 4, m.c(0xa58236))
    return m
}

/** A blocky muzzle flash: a star of glowing voxels facing the eye and a short cone. */
function flashModels(): { star: THREE.BufferGeometry, cone: THREE.BufferGeometry, prongs: THREE.BufferGeometry } {
    const st = new DfVoxModel(9, 9, 1)
    const hot = st.c(0xffffff, 1)
    const warm = st.c(0xffc070, 1)
    for (let t = 0; t < 9; t++) {
        st.set(t, 4, 0, Math.abs(t - 4) < 2 ? hot : warm).set(4, t, 0, Math.abs(t - 4) < 2 ? hot : warm)
        if (Math.abs(t - 4) < 3) st.set(t, t, 0, warm).set(t, 8 - t, 0, warm)
    }
    st.box(3, 3, 0, 6, 6, 1, hot)
    const cn = new DfVoxModel(5, 5, 7)
    const c1 = cn.c(0xffe0a0, 1)
    const c2 = cn.c(0xffa050, 1)
    for (let k = 0; k < 7; k++) {
        const r = k < 2 ? 2 : k < 5 ? 1 : 0
        cn.box(2 - r, 2 - r, k, 3 + r, 3 + r, k + 1, k < 3 ? c1 : c2)
    }
    // Side prongs: four short spikes splaying sideways from the muzzle (a cross of hot voxels).
    const pr = new DfVoxModel(11, 11, 3)
    const p1 = pr.c(0xffd090, 1)
    for (let t = 0; t < 11; t++) {
        if (Math.abs(t - 5) < 2) continue
        const far = Math.abs(t - 5) > 3
        pr.set(t, 5, far ? 2 : 1, p1).set(5, t, far ? 2 : 1, p1)
    }
    return { star: st.mesh(1 / 9, [4.5, 4.5, 0.5])!, cone: cn.mesh(1 / 7, [2.5, 2.5, 7])!, prongs: pr.mesh(1 / 11, [5.5, 5.5, 3])! }
}

const tmpV = new THREE.Vector3()
const tmpV2 = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const AXIS_X = new THREE.Vector3(1, 0, 0)

/**
 * Where the gun goes at full ADS: pitched so the rear-to-front sight line is
 * level, placed so it runs exactly along the camera axis `eyeRelief` ahead.
 */
export function dfAdsPose(r: Pick<DfGunRig, 'sight' | 'sightFront' | 'eyeRelief'>, out: THREE.Vector3): number {
    const rear = r.sight
    const front = r.sightFront
    const run = Math.max(1e-4, rear.z - front.z)
    const pitch = -Math.atan2(front.y - rear.y, run)
    tmpQ.setFromAxisAngle(AXIS_X, pitch)
    out.copy(rear).applyQuaternion(tmpQ).negate()
    out.z -= r.eyeRelief
    return pitch
}

export function createDfViewmodelImpl(ctx: DfRenderContext): DfViewmodel {
    const root = new THREE.Group()
    root.name = 'df-viewmodel'
    ctx.vmScene.add(root)
    const holder = new THREE.Group()
    root.add(holder)
    const holderL = new THREE.Group()
    root.add(holderL)
    const mat = dfWeaponMat()
    const geos: THREE.BufferGeometry[] = []
    // A camera-space key and fill of our own (added once, never removed) so blued steel and
    // walnut read clearly in the dark: warm from the upper left, cool rim from the right.
    const aim = new THREE.Object3D()
    aim.position.set(0.1, -0.1, -0.5)
    root.add(aim)
    const key = new THREE.DirectionalLight(0xffe6c8, 1.1)
    key.position.set(-0.6, 0.9, 0.5)
    key.target = aim
    const fill = new THREE.DirectionalLight(0xa8bcff, 0.5)
    fill.position.set(0.9, 0.2, 0.3)
    fill.target = aim
    const amb = new THREE.AmbientLight(0x9aa2b4, 0.35)
    root.add(key, fill, amb)

    const gloveG = gloveModel().mesh(V, [2.5, 4, 3], { aoMin: 0.6 })!
    const glove = new THREE.Mesh(gloveG, mat)
    const gloveL = new THREE.Mesh(gloveG, mat)
    geos.push(gloveG)
    const knifeG = knifeModel().mesh(0.009, [1.5, 3, 2])!
    geos.push(knifeG)
    const knife = new THREE.Mesh(knifeG, mat)
    knife.visible = false
    root.add(knife)

    // Muzzle flash: additive voxel sprites, shown for a couple of frames.
    const flashMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffd8a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
    const fm = flashModels()
    geos.push(fm.star, fm.cone, fm.prongs)
    const flash = new THREE.Group()
    const star = new THREE.Mesh(fm.star, flashMat)
    const cone = new THREE.Mesh(fm.cone, flashMat)
    const prongs = new THREE.Mesh(fm.prongs, flashMat)
    flash.add(star, cone, prongs)
    flash.visible = false
    root.add(flash)
    let flashT = 0

    // Pooled casings: small voxel brass and red shotgun hulls.
    // Brass with a bright shoulder; rifle cases are long and necked, pistol cases short.
    const cm = new DfVoxModel(2, 5, 2)
    cm.box(0, 0, 0, 2, 5, 2, cm.c(0xd6ad52, 0.12)).box(0, 0, 0, 2, 1, 2, cm.c(0x8a6a2a)).box(0, 4, 0, 2, 5, 2, cm.c(0xf0cf78, 0.2))
    const caseG = cm.mesh(0.0058, [1, 2.5, 1])!
    const rm = new DfVoxModel(3, 11, 3)
    rm.box(0, 0, 0, 3, 8, 3, rm.c(0xd6ad52, 0.12)).box(0, 0, 0, 3, 1, 3, rm.c(0x8a6a2a)).box(1, 8, 1, 2, 11, 2, rm.c(0xf0cf78, 0.2)).box(0, 7, 0, 3, 8, 3, rm.c(0xf0cf78, 0.2))
    const rifleCaseG = rm.mesh(0.0042, [1.5, 5.5, 1.5])!
    const hm = new DfVoxModel(3, 8, 3)
    hm.box(0, 0, 0, 3, 8, 3, hm.c(0xa8302a)).box(0, 0, 0, 3, 2, 3, hm.c(0xc9a046))
    const hullG = hm.mesh(0.0065, [1.5, 4, 1.5])!
    geos.push(caseG, hullG, rifleCaseG)
    const casings: Casing[] = []
    for (let i = 0; i < 16; i++) {
        const m = new THREE.Mesh(caseG, mat)
        m.visible = false
        root.add(m)
        casings.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 })
    }
    let caseNext = 0

    // state
    let rig: DfGunRig | null = null
    let rigL: DfGunRig | null = null
    let current: DfViewmodelWeapon | null = null
    let stats: DfWeaponStats | null = null
    let dual = false
    let side = 0
    let equipT = 1
    let equipDur = 0.5
    let swapAt = -1
    let next: DfViewmodelWeapon | null = null
    let clip: Clip | null = null
    let shellGrace = -1
    let melee = -1
    let shotT = 10
    let shotDur = 0.1
    let shotsSinceReload = 0
    let panAngle = 0
    let glowPulse = 0
    let time = 0
    let bobPhase = 0
    let grounded = true
    let downWant = false
    let adsPitch = 0
    const ads = new Crit(18)
    const sprint = new Crit(12)
    const crouch = new Crit(10)
    const downed = new Crit(6)
    const bobAmt = new Crit(10)
    const swayX = new Crit(14)
    const swayY = new Crit(14)
    const lookX = new Crit(20)
    const lookY = new Crit(20)
    const kickZ = new Spring(42, 0.62)
    const kickP = new Spring(34, 0.5)
    const kickYaw = new Crit(30)
    const kickRoll = new Spring(30, 0.55)
    let feel: ShotFeel = FEEL.pistol!
    const land = new Crit(14)
    const lower = new Crit(16)
    const aimPos = new THREE.Vector3()

    function makeRig(w: DfViewmodelWeapon): void {
        for (const r of [rig, rigL]) if (r) disposeDfWeaponModel(r.root)
        rig = dfBuildGunRig(w.id, w.pap, w.attachments)
        holder.add(rig.root)
        rig.root.add(glove)
        dual = w.id === 'm1911' && w.pap > 0
        rigL = null
        if (dual) {
            rigL = dfBuildGunRig(w.id, w.pap, w.attachments)
            rigL.root.scale.x = -1
            holderL.add(rigL.root)
            rigL.root.add(gloveL)
        }
        for (const r of [rig, rigL]) {
            if (!r) continue
            r.root.traverse((o) => {
                o.castShadow = false
            })
        }
        // The glove wraps the grip, raked with it.
        glove.position.set(0, -0.004, 0.006)
        glove.rotation.set(-0.28, 0, 0)
        gloveL.position.copy(glove.position)
        gloveL.rotation.copy(glove.rotation)
        adsPitch = dfAdsPose(rig, aimPos)
        try {
            stats = dfWeaponStats(w.id, w.pap, w.attachments)
        } catch {
            stats = null
        }
        current = w
        feel = FEEL_ID[w.id] ?? FEEL[DF_WEAPONS[w.id]?.class ?? 'pistol'] ?? FEEL.pistol!
        shotsSinceReload = 0
        clip = null
        shellGrace = -1
    }

    function play(name: string): void {
        try {
            ctx.audio.play(name)
        } catch {
            // audio is optional
        }
    }

    function suppressed(): boolean {
        const m = current?.attachments.muzzle
        return !!m && m.includes('maxim')
    }

    function ejectCasing(r: DfGunRig): void {
        if (!current || current.id === 'xray' || current.id === 'wunder' || (current.id === 'm1911' && current.pap > 0)) return
        const c = casings[caseNext]!
        caseNext = (caseNext + 1) % casings.length
        const cls = DF_WEAPONS[current.id]?.class
        c.mesh.geometry = current.id === 'm1897' ? hullG : cls === 'rifle' || cls === 'lmg' ? rifleCaseG : caseG
        r.root.updateWorldMatrix(true, false)
        c.mesh.position.copy(r.eject).applyMatrix4(r.root.matrixWorld)
        root.worldToLocal(c.mesh.position)
        // Up and out to the right (in camera space), a little back, tumbling end over end.
        c.vel.set(1 + Math.random() * 0.6, 1.3 + Math.random() * 0.6, 0.3 + Math.random() * 0.3)
        if (r.root.scale.x < 0) c.vel.x *= -1
        c.spin.set(14 + Math.random() * 14, Math.random() * 6, 10 + Math.random() * 14)
        c.mesh.rotation.set(0, 0, Math.PI / 2)
        c.life = 0.7
        c.mesh.visible = true
    }

    function muzzleObj(): THREE.Object3D | null {
        if (dual && side === 1 && rigL) return rigL.muzzle
        return rig?.muzzle ?? null
    }

    const api: DfViewmodel = {
        root,
        get adsBlend() {
            return clamp01(ads.x)
        },
        equip(w, swapMult) {
            const cls = DF_WEAPONS[w.id]?.class
            const base = cls === 'pistol' ? 0.45 : cls === 'smg' ? 0.6 : 0.7
            const T = base / Math.max(0.1, swapMult)
            equipDur = T
            if (!rig) {
                makeRig(w)
                swapAt = -1
                equipT = 0.4
                lower.x = 1
                play(DF_WSND.raise)
                return T
            }
            next = w
            equipT = 0
            swapAt = 0.4
            clip = null
            melee = -1
            return T
        },
        fire() {
            if (!rig || !stats || !current) return
            shotT = 0
            shotDur = Math.min(0.9, 60 / Math.max(1, stats.rpm))
            shotsSinceReload++
            clip = null
            shellGrace = -1
            if (dual) side = 1 - side
            // A sharp kick back and up that settles with a little overshoot, per weapon class.
            const k = Math.min(0.08, stats.recoil) * (1 - clamp01(ads.x) * 0.45)
            const fk = feel
            kickZ.v += (1.4 + k * 26) * fk.back * 30
            kickP.v += (3 + k * 110) * fk.flip * 26
            kickRoll.v += (Math.random() < 0.5 ? -1 : 1) * (0.6 + k * 20) * fk.roll * 26
            kickYaw.v += (Math.random() - 0.5) * (1.5 + k * 40) * fk.yaw * 20
            play(DF_WSND.fire(current.id, current.pap, suppressed()))
            const r = dual && side === 1 && rigL ? rigL : rig
            if (current.id !== 'kar98k' && current.id !== 'm1897') ejectCasing(r)
            if (rig.pan && stats.magSize > 0) panAngle += (Math.PI * 2) / stats.magSize
            glowPulse = 1
            if (!suppressed()) {
                // Per class: a small crisp star for pistols, a long tongue for rifles, a wide
                // bloom for the shotgun, side prongs on the automatics; random turn each shot.
                const fk = feel
                flash.visible = true
                flashT = fk.flash
                const s = (0.055 + Math.random() * 0.025) * fk.star
                star.scale.set(s, s, s)
                star.rotation.z = Math.floor(Math.random() * 4) * (Math.PI / 4)
                cone.scale.set(s * 0.5, s * 0.5, s * fk.cone * (1.1 + Math.random() * 0.6))
                cone.rotation.z = Math.floor(Math.random() * 2) * (Math.PI / 4)
                const ps = s * fk.prongs * (0.8 + Math.random() * 0.5)
                prongs.visible = ps > 0
                prongs.scale.set(ps * 1.3, ps * 1.3, ps)
                prongs.rotation.z = Math.random() < 0.5 ? 0 : Math.PI / 4
                flashMat.color.set(dfMuzzleFlashColor(current.id, current.pap)).multiplyScalar(2.6)
            }
            if (muzzleObj()) {
                api.muzzleWorld(ctx.camera, tmpV)
                ctx.camera.getWorldDirection(tmpV2)
                ctx.fx.burst('muzzle-smoke', tmpV, { normal: tmpV2, scale: suppressed() ? 0.4 : 0.8 })
                if (current.id === 'wunder') ctx.fx.burst('electric', tmpV, { normal: tmpV2, scale: 0.5 })
            }
        },
        reload(empty, seconds, shell) {
            if (!rig || !stats) return
            const dur = Math.max(0.05, seconds)
            if (shell || stats.perRoundReload > 0) {
                const first = !clip || (clip.kind !== 'shell' && clip.kind !== 'shell-in')
                clip = { kind: first && shellGrace < 0 ? 'shell-in' : 'shell', t: 0, dur, empty, fired: new Set() }
                shellGrace = -1
                return
            }
            clip = { kind: 'mag', t: 0, dur, empty, fired: new Set() }
        },
        cancelReload() {
            clip = null
            shellGrace = -1
        },
        melee() {
            melee = 0
            clip = null
            play(DF_WSND.knife)
        },
        setDowned(down) {
            downWant = down
        },
        muzzleWorld(camera, out) {
            const m = muzzleObj()
            if (!m) return out.copy(camera.position)
            root.updateMatrixWorld()
            m.getWorldPosition(tmpV)
            ctx.vmCamera.updateMatrixWorld()
            tmpV.applyMatrix4(ctx.vmCamera.matrixWorldInverse)
            const d = Math.max(0.05, -tmpV.z)
            const vt = Math.tan((ctx.vmCamera.fov * Math.PI) / 360)
            const nx = tmpV.x / (d * vt * ctx.vmCamera.aspect)
            const ny = tmpV.y / (d * vt)
            const cam = camera as THREE.PerspectiveCamera
            const wt = cam.isPerspectiveCamera ? Math.tan((cam.fov * Math.PI) / 360) : vt
            const aspect = cam.isPerspectiveCamera ? cam.aspect : ctx.vmCamera.aspect
            out.set(nx * d * wt * aspect, ny * d * wt, -d)
            camera.updateMatrixWorld()
            return out.applyMatrix4(camera.matrixWorld)
        },
        update(dt, input) {
            dt = Math.min(0.05, Math.max(0, dt))
            time += dt
            root.position.copy(ctx.vmCamera.position)
            root.quaternion.copy(ctx.vmCamera.quaternion)
            if (!rig || !stats) {
                holder.visible = false
                return
            }
            holder.visible = true
            step(dt, input)
        },
        dispose() {
            for (const r of [rig, rigL]) if (r) disposeDfWeaponModel(r.root)
            rig = rigL = null
            for (const g of geos) g.dispose()
            flashMat.dispose()
            ctx.vmScene.remove(root)
        }
    }

    /** Reload / per-shell motion: a drop-and-tilt of the gun, the magazine sliding out and back. */
    function clipAnim(c: Clip, r: DfGunRig, out: typeof res): void {
        const u = clamp01(c.t / c.dur)
        const ev = (at: number, fn: () => void) => {
            if (u >= at && !c.fired.has(at)) {
                c.fired.add(at)
                fn()
            }
        }
        if (c.kind === 'mag' && r.drum && r.reload === 'mag') {
            // A drum change: the gun cants its belly toward the eye, the drum slides off the
            // well and drops away, a fresh one swings up and is slapped home; empty, the bolt
            // handle is yanked back after.
            const dip = bump(u, 0, 1, 0.18)
            out.x -= 0.04 * dip
            out.y += 0.045 * dip
            out.pitch += 0.1 * dip
            out.roll -= 0.5 * dip
            const off = smooth((u - 0.12) / 0.08) * 0.03 + smooth((u - 0.2) / 0.2) * 0.3
            const on = smooth((u - 0.48) / 0.22)
            const drop = u < 0.48 ? off : 0.33 * (1 - on)
            out.mag.set(0, -drop, -0.05 * Math.min(1, drop / 0.1))
            const slap = bump(u, 0.7, 0.8, 0.04)
            out.y -= 0.012 * slap
            out.pitch -= 0.06 * slap
            ev(0.12, () => play(DF_WSND.drumOut))
            ev(0.7, () => play(DF_WSND.drumIn))
            if (c.empty) {
                out.bolt = bump(u, 0.82, 0.96, 0.05)
                ev(0.82, () => play(DF_WSND.boltOpen))
                ev(0.92, () => play(DF_WSND.boltClose))
            }
        } else if (c.kind === 'mag') {
            const dip = bump(u, 0, 1, 0.2)
            out.y -= 0.05 * dip
            out.pitch += 0.22 * dip
            out.roll += (r.reload === 'side' || r.reload === 'capsule' ? -0.4 : 0.32) * dip
            if (r.reload === 'stripper') {
                out.bolt = bump(u, 0.12, 0.88, 0.1)
                ev(0.12, () => play(DF_WSND.boltOpen))
                ev(0.45, () => play(DF_WSND.clip))
                ev(0.82, () => play(DF_WSND.boltClose))
            } else {
                const away = smooth((u - 0.15) / 0.2) * (1 - smooth((u - 0.55) / 0.2))
                const dir = r.reload === 'top' ? tmpV.set(0, 0.25, 0.04) : r.reload === 'side' || r.reload === 'capsule' || r.reload === 'coil' ? tmpV.set(-0.22, -0.03, 0) : tmpV.set(0, -0.26, 0.04)
                out.mag.copy(dir).multiplyScalar(away)
                ev(0.16, () => {
                    play(r.reload === 'top' ? DF_WSND.drum : DF_WSND.magOut)
                    if (r.reload === 'capsule' || r.reload === 'coil') {
                        play(DF_WSND.steam)
                        api.muzzleWorld(ctx.camera, tmpV2)
                        ctx.fx.burst('smoke', tmpV2, { scale: 0.15, color: 0xdfe8e0 })
                    }
                })
                ev(0.7, () => play(DF_WSND.magIn))
                if (r.reload === 'coil') ev(0.6, () => play(DF_WSND.charge))
                if (c.empty) {
                    out.bolt = bump(u, 0.8, 0.97, 0.06)
                    ev(0.86, () => play(r.slide ? DF_WSND.slide : DF_WSND.boltClose))
                }
            }
        } else if (c.kind === 'shell-in' || c.kind === 'shell') {
            const into = c.kind === 'shell-in' ? smooth(u / 0.4) : 1
            out.roll += -0.35 * into
            out.pitch += 0.1 * into
            out.y -= 0.02 * into
            const push = c.kind === 'shell-in' ? bump(u, 0.45, 1, 0.2) : bump(u, 0, 1, 0.25)
            out.z += 0.01 * push
            ev(0.8, () => play(DF_WSND.shell))
        } else {
            const back = 1 - smooth(u / 0.5)
            out.roll += -0.35 * back
            out.pitch += 0.1 * back
            out.pump = bump(u, 0.35, 0.95, 0.25)
            ev(0.35, () => play(r.pump ? DF_WSND.pump : DF_WSND.boltClose))
        }
    }

    const res = { x: 0, y: 0, z: 0, roll: 0, pitch: 0, mag: new THREE.Vector3(), bolt: 0, pump: 0 }
    const hip = new THREE.Vector3()
    const pos = new THREE.Vector3()
    const rot = new THREE.Euler(0, 0, 0, 'YXZ')

    function step(dt: number, input: DfViewmodelInput): void {
        const r = rig!
        const s = stats!
        // ---- equip / swap: lower, change, raise
        let lowerTarget = 0
        if (equipT < 1) {
            equipT = Math.min(1, equipT + dt / Math.max(0.05, equipDur))
            if (swapAt >= 0) {
                lowerTarget = 1
                if (equipT >= swapAt && next) {
                    makeRig(next)
                    next = null
                    swapAt = -1
                    play(DF_WSND.raise)
                }
            }
        }
        lower.step(dt, lowerTarget)

        // ---- springs
        const reloading = !!clip && clip.kind === 'mag'
        const adsWant = input.ads && !input.sprinting && !reloading && melee < 0 && equipT >= 1
        // ~0.2 s to the sights (scaled by the weapon's adsTime and the perk).
        ads.omega = 22 * Math.max(0.4, input.adsMult) * Math.min(1.6, 0.25 / Math.max(0.12, s.adsTime))
        ads.step(dt, adsWant ? 1 : 0)
        const a = clamp01(ads.x)
        const ia = 1 - a
        sprint.step(dt, input.sprinting && !clip && melee < 0 ? 1 : 0)
        crouch.step(dt, input.crouching ? 1 : 0)
        downed.step(dt, downWant ? 1 : 0)
        bobAmt.step(dt, input.grounded ? clamp01(input.speed * 1.4) : 0)
        bobPhase += dt * (4.2 + input.speed * 6.5)
        if (!grounded && input.grounded) land.v -= 1.2
        grounded = input.grounded
        // Sway lags the mouse: the look target is the clamped mouse delta, the sway chases it.
        lookX.step(dt, Math.max(-1, Math.min(1, -input.look.x * 0.04)))
        lookY.step(dt, Math.max(-1, Math.min(1, -input.look.y * 0.04)))
        swayX.step(dt, lookX.x)
        swayY.step(dt, lookY.x)
        kickZ.step(dt)
        kickP.step(dt)
        kickYaw.step(dt)
        kickRoll.step(dt)
        land.step(dt)

        // ---- base pose: tucked low-right with a slight inward cant; ADS levels the sight line on the axis
        const pistol = !r.long
        // The sight line sits at the same spot for every gun (the body hangs below it),
        // so tall receivers don't loom and short ones don't float.
        if (dual) hip.set(0.15, -0.12, -0.36)
        else if (pistol) hip.set(0.135 - r.sight.x, -0.062 - r.sight.y, -0.4)
        else hip.set(0.135 - r.sight.x, -0.072 - r.sight.y, -0.3)
        pos.copy(hip).lerp(dual ? tmpV.set(0.09, -0.09, -0.3) : aimPos, a)
        rot.set(dual ? 0 : adsPitch * a, ia * (pistol ? 0.05 : 0.06), 0)
        // Everything below fades out at full ADS so the sights rest exactly on centre.
        const sb = Math.sin(bobPhase)
        const cb = Math.cos(bobPhase * 2)
        const bob = clamp01(bobAmt.x) * ia
        pos.x += sb * 0.008 * bob + Math.sin(time * 0.9) * 0.0012 * ia
        pos.y += -Math.abs(sb) * 0.008 * bob + cb * 0.0015 * bob + Math.sin(time * 1.6) * 0.0016 * ia + land.x * 0.02
        rot.z += sb * 0.012 * bob
        const sw = 1 - a * 0.75
        rot.y += swayX.x * 0.06 * sw
        rot.x += swayY.x * 0.05 * sw
        pos.x += swayX.x * 0.008 * sw
        pos.y += swayY.x * 0.006 * sw
        pos.z += kickZ.x * 0.01
        rot.x += kickP.x * 0.01
        rot.y += kickYaw.x * 0.02
        rot.z += kickRoll.x * 0.04 * (1 - a * 0.7)
        const sp = clamp01(sprint.x)
        rot.y += sp * (pistol ? 0.3 : 0.42)
        rot.x += sp * (pistol ? -0.35 : -0.16)
        rot.z += sp * 0.28
        pos.x += sp * -0.01
        pos.y += sp * -0.012
        pos.z += sp * 0.02
        pos.y += -crouch.x * 0.006 * ia - downed.x * 0.02
        rot.z += downed.x * 0.15
        const lw = clamp01(lower.x)
        pos.y += -lw * 0.2
        rot.x += -lw * 0.8

        // melee: the gun dips right while the knife slashes across from the lower left
        let knifeK = 0
        if (melee >= 0) {
            melee += dt / 0.42
            if (melee >= 1) melee = -1
            else {
                knifeK = melee
                const d = bump(melee, 0, 1, 0.25)
                pos.x += d * 0.05
                pos.y -= d * 0.07
                rot.z -= d * 0.3
            }
        }

        // reload / shells
        res.x = 0
        res.y = 0
        res.z = 0
        res.roll = 0
        res.pitch = 0
        res.mag.set(0, 0, 0)
        res.bolt = 0
        res.pump = 0
        if (clip) {
            clip.t += dt
            clipAnim(clip, r, res)
            if (clip.t >= clip.dur) {
                const k = clip.kind
                clip = null
                shotsSinceReload = 0
                if (k === 'shell' || k === 'shell-in') shellGrace = 0
            }
        } else if (shellGrace >= 0) {
            shellGrace += dt
            if (shellGrace > 0.12) {
                shellGrace = -1
                clip = { kind: 'shell-out', t: 0, dur: 0.55, empty: false, fired: new Set() }
            }
        }
        pos.x += res.x
        pos.y += res.y
        pos.z += res.z
        rot.z += res.roll
        rot.x += res.pitch

        // per-shot action (bolt, pump, slide)
        shotT += dt
        const u = shotT / shotDur
        let slide = 0
        let bolt = res.bolt
        let pump = res.pump
        if (u < 1) {
            if (current?.id === 'kar98k') {
                bolt = Math.max(bolt, bump(u, 0.2, 0.9, 0.2))
                if (u > 0.4 && u - dt / shotDur <= 0.4) {
                    play(DF_WSND.boltOpen)
                    ejectCasing(r)
                }
                if (u > 0.75 && u - dt / shotDur <= 0.75) play(DF_WSND.boltClose)
                rot.z += bump(u, 0.15, 0.95, 0.2) * 0.1 * ia
            } else if (r.pump) {
                pump = Math.max(pump, bump(u, 0.15, 0.85, 0.3))
                if (u > 0.2 && u - dt / shotDur <= 0.2) play(DF_WSND.pump)
                if (u > 0.45 && u - dt / shotDur <= 0.45) ejectCasing(r)
            } else {
                slide = 1 - smooth(shotT / 0.06)
            }
        }
        if (r.slide && shotsSinceReload >= s.magSize && !clip) slide = 1
        if (clip?.kind === 'mag' && clip.empty) slide = Math.max(slide, 1 - smooth((clip.t / clip.dur - 0.84) / 0.06))

        holder.position.copy(pos)
        holder.rotation.copy(rot)
        holderL.position.set(-pos.x, pos.y, pos.z)
        holderL.rotation.set(rot.x, -rot.y, -rot.z)
        holderL.visible = dual

        // The near plane stays small and fixed: the whole gun (receiver, bolt, stock) stays
        // solid in the sight picture. The eye relief keeps the stock behind the eye.
        if (ctx.vmCamera.near !== VM_NEAR) {
            ctx.vmCamera.near = VM_NEAR
            ctx.vmCamera.updateProjectionMatrix()
        }

        glowPulse = Math.max(0, glowPulse - dt * 4)
        const apply = (g: DfGunRig) => {
            if (g.slide) g.slide.position.copy(g.slide.userData.rest as THREE.Vector3).setZ(0.022 * slide)
            if (g.bolt) {
                const rest = g.bolt.userData.rest as THREE.Vector3
                g.bolt.position.set(rest.x, rest.y, rest.z + 0.05 * bolt + (shotT < Math.min(0.05, shotDur * 0.45) && g.id !== 'kar98k' ? 0.015 : 0))
                if (g.id === 'kar98k') g.bolt.rotation.z = bolt * 1.2
            }
            if (g.pump) g.pump.position.copy(g.pump.userData.rest as THREE.Vector3).setZ(0.07 * pump)
            if (g.mag && g.mag !== g.pan) g.mag.position.copy(g.mag.userData.rest as THREE.Vector3).add(res.mag)
            if (g.pan) {
                g.pan.position.copy(g.pan.userData.rest as THREE.Vector3).add(res.mag)
                g.pan.rotation.y = -panAngle
            }
            if (g.glow) {
                const drain = clip && clip.kind === 'mag' ? bump(clip.t / clip.dur, 0.1, 0.7, 0.1) * 1.1 : 0
                // The Voltigeur breathes slowly and crackles (cosmetic flicker) after a shot.
                const live = g.id === 'wunder'
                    ? 1.25 + Math.sin(time * 2.2) * 0.25 + glowPulse * (1.6 + Math.random() * 1.4) + (Math.random() < 0.02 ? 0.35 : 0)
                    : 1.3 + Math.sin(time * 2.6) * 0.18 + Math.sin(time * 17) * 0.04 + glowPulse * 2.4
                g.glow.userData.uGlow.value = Math.max(0.2, live - drain)
            }
            if (g.lens) g.lens.visible = a > 0.6
        }
        apply(r)
        if (rigL) apply(rigL)
        // The glove hides once a scope is up (the scope fills the view).
        glove.visible = !(r.scoped && a > 0.6)

        root.updateMatrixWorld(true)
        knife.visible = knifeK > 0
        if (knifeK > 0) {
            const sw2 = smooth((knifeK - 0.12) / 0.45)
            const inn = bump(knifeK, 0, 1, 0.2)
            knife.position.set(-0.05 + 0.2 * (1 - sw2) - 0.22 * sw2, -0.2 + 0.12 * inn - (1 - inn) * 0.15, -0.34)
            knife.rotation.set(-1.25, 0.2 - sw2 * 0.9, 0.9 - sw2 * 0.4)
        }

        if (flash.visible) {
            flashT -= dt
            if (flashT <= 0) flash.visible = false
            const m = muzzleObj()
            if (m) {
                m.getWorldPosition(flash.position)
                root.worldToLocal(flash.position)
            }
        }
        for (const c of casings) {
            if (c.life <= 0) continue
            c.life -= dt
            c.vel.y -= 9.8 * dt
            c.mesh.position.addScaledVector(c.vel, dt)
            c.mesh.rotation.x += c.spin.x * dt
            c.mesh.rotation.z += c.spin.z * dt
            if (c.life <= 0) {
                c.mesh.visible = false
                if (Math.random() < 0.4) play(DF_WSND.casing)
            }
        }
    }

    return api
}
