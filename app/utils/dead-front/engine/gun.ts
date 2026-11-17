import type { DfHeldWeapon } from '#shared/utils/dead-front/protocol'
import type { DfWeaponClass, DfWeaponId } from '#shared/utils/dead-front/types'
import { DF_WEAPONS } from '#shared/utils/dead-front/weapons'
import type { DfWeaponStats } from '#shared/utils/dead-front/weapons'

// Client weapon state (pure, tested): fire timing per fire mode, predicted
// ammo, magazine and per-shell reloads, spread bloom, the sprint-out delay and
// the per-class recoil pattern. Times are seconds on any monotonic clock.

/** Seconds from the end of a sprint until the weapon is up and can fire, per class. */
export const DF_SPRINT_OUT: Record<DfWeaponClass, number> = {
    pistol: 0.1,
    smg: 0.14,
    shotgun: 0.18,
    rifle: 0.2,
    lmg: 0.28,
    special: 0.15
}

/** Sprint-out delay with the aim speed effect (Fleetfoot / Steady Eye shorten it). */
export function dfSprintOutTime(cls: DfWeaponClass, adsMult: number): number {
    return (DF_SPRINT_OUT[cls] ?? 0.15) / Math.max(0.5, adsMult)
}

/** How long a trigger press waits for the gun (cycling, raising, sprint-out) before it is dropped. */
export function dfPressBuffer(fireMode: DfWeaponStats['fireMode'], interval: number): number {
    if (fireMode === 'bolt' || fireMode === 'pump') return 0.2
    return Math.min(0.3, Math.max(0.15, interval * 0.6))
}

/** Seconds between shots. */
export function dfShotInterval(rpm: number, fireRateMult: number): number {
    return 60 / Math.max(1, rpm * Math.max(0.05, fireRateMult))
}

export interface DfSpreadInput {
    hipSpread: number
    adsSpread: number
    adsBlend: number
    spreadMult: number
    /** 0..1 of sprint speed. */
    move: number
    airborne: boolean
    crouched: boolean
    /** Accumulated firing bloom 0..1. */
    bloom: number
}

/**
 * Forward vector of a camera with Euler order 'YXZ' at this yaw / pitch
 * (yaw 0 looks down -z, positive pitch looks up). Roll never moves the
 * forward axis, so this is exactly the screen centre's ray.
 */
export function dfAimDir(yaw: number, pitch: number, out: { x: number, y: number, z: number }): { x: number, y: number, z: number } {
    const cp = Math.cos(pitch)
    out.x = -Math.sin(yaw) * cp
    out.y = Math.sin(pitch)
    out.z = -Math.cos(yaw) * cp
    return out
}

/** Below this bloom and movement, a fully aimed shot is a rested, precise one. */
const RESTED_BLOOM = 0.05
const RESTED_MOVE = 0.2

/**
 * Cone half-angle in radians for the next shot. A rested shot down the
 * sights (fully aimed, not moving, no bloom from recent fire) goes almost
 * exactly where the sights are: aiming is rewarded with precision.
 */
export function dfSpread(i: DfSpreadInput): number {
    if (i.adsBlend > 0.95 && i.bloom < RESTED_BLOOM && i.move < RESTED_MOVE && !i.airborne) {
        return Math.max(0, i.adsSpread * 0.1 * i.spreadMult)
    }
    const base = i.hipSpread + (i.adsSpread - i.hipSpread) * i.adsBlend
    const hip = 1 - i.adsBlend
    let k = 1 + i.move * (0.9 * hip + 0.35 * i.adsBlend) + i.bloom * (0.8 * hip + 0.5 * i.adsBlend)
    if (i.airborne) k *= 1.8
    if (i.crouched) k *= 0.82
    return Math.max(0, base * k * i.spreadMult)
}

/**
 * Uniform direction inside a cone of half-angle `spread` around `d` (unit),
 * from two uniform numbers in [0, 1). Writes into `out`.
 */
export function dfConeDir(d: { x: number, y: number, z: number }, spread: number, u: number, v: number, out: { x: number, y: number, z: number }): { x: number, y: number, z: number } {
    if (spread <= 0) {
        out.x = d.x
        out.y = d.y
        out.z = d.z
        return out
    }
    // basis around d
    let ax = 0
    let ay = 1
    const az = 0
    if (Math.abs(d.y) > 0.95) {
        ax = 1
        ay = 0
    }
    // right = d x a
    let rx = d.y * az - d.z * ay
    let ry = d.z * ax - d.x * az
    let rz = d.x * ay - d.y * ax
    const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1
    rx /= rl
    ry /= rl
    rz /= rl
    // up = right x d
    const ux = ry * d.z - rz * d.y
    const uy = rz * d.x - rx * d.z
    const uz = rx * d.y - ry * d.x
    const r = Math.tan(spread) * Math.sqrt(u)
    const a = v * Math.PI * 2
    const ox = Math.cos(a) * r
    const oy = Math.sin(a) * r
    let x = d.x + rx * ox + ux * oy
    let y = d.y + ry * ox + uy * oy
    let z = d.z + rz * ox + uz * oy
    const l = Math.sqrt(x * x + y * y + z * z) || 1
    x /= l
    y /= l
    z /= l
    out.x = x
    out.y = y
    out.z = z
    return out
}

export type DfGunEvent = 'none' | 'shell' | 'done'

/** Fraction of a magazine reload after which the new magazine is seated (a cancel keeps it). */
export const DF_RELOAD_SEATED = 0.8

export class DfGunState {
    id: DfHeldWeapon['id'] = 'm1911'
    pap = 0
    stats: DfWeaponStats | null = null
    mag = 0
    reserve = 0
    /** Earliest time the next shot may leave. */
    nextFire = 0
    /** Time the weapon finishes raising after a swap. */
    readyAt = 0
    bloom = 0
    /** Reload in progress. */
    reloading = false
    reloadEnd = 0
    /** When the running magazine reload started (for the late-cancel window). */
    reloadStart = 0
    /** Per-shell reload: time the next shell goes in. */
    nextShell = 0
    shellMode = false
    /** A buffered trigger press for semi / bolt / pump weapons stays valid until this time. */
    private pressUntil = -10
    /** Time of the last shot, and of the last frame the trigger was up (auto cadence). */
    private lastShotAt = -10
    private releasedAt = -10
    private sprinting = false
    /** Class of the held weapon (sprint-out time, recoil pattern). */
    cls: DfWeaponClass = 'pistol'
    /** Last local action that changes ammo (fire / reload), for reconciliation. */
    lastAction = -10

    setWeapon(w: DfHeldWeapon, stats: DfWeaponStats, now: number, raise: number): void {
        this.id = w.id
        this.cls = DF_WEAPONS[w.id]?.class ?? 'pistol'
        this.pap = w.pap
        this.stats = stats
        this.mag = w.mag
        this.reserve = w.reserve
        this.reloading = false
        this.readyAt = now + raise
        this.nextFire = Math.max(this.nextFire, this.readyAt)
        this.bloom = 0
        // a press made during the swap fires once the new weapon is up
        if (this.pressUntil >= now) this.pressUntil = this.readyAt + dfPressBuffer(stats.fireMode, this.interval(1))
    }

    private interval(fireRateMult: number): number {
        return this.stats ? dfShotInterval(this.stats.rpm, fireRateMult) : 0.1
    }

    /**
     * Tracks sprinting. Leaving a sprint lowers-to-raises the weapon: it can
     * fire only after the class's sprint-out time, and a press made meanwhile
     * is kept until then instead of being eaten.
     */
    setSprinting(sprinting: boolean, now: number, adsMult = 1): void {
        if (this.sprinting && !sprinting && this.stats) {
            this.readyAt = Math.max(this.readyAt, now + dfSprintOutTime(this.cls, adsMult))
            if (this.pressUntil >= now) this.pressUntil = Math.max(this.pressUntil, this.readyAt + dfPressBuffer(this.stats.fireMode, this.interval(1)))
        }
        this.sprinting = sprinting
    }

    /** Adopts the server's ammo when no local action is in flight. */
    reconcile(w: DfHeldWeapon, now: number, settle: number): void {
        if (this.reloading) return
        if (now - this.lastAction < settle) {
            // ammo can only go up from the server's side during a local action (max ammo)
            if (w.reserve > this.reserve + 1) this.reserve = w.reserve
            return
        }
        this.mag = w.mag
        this.reserve = w.reserve
    }

    get auto(): boolean {
        const m = this.stats?.fireMode
        return m === 'auto' || m === 'beam'
    }

    /** Buffers a trigger press (semi / bolt / pump fire on press, a little early or while raising). */
    press(now: number): void {
        const s = this.stats
        const buffer = s ? dfPressBuffer(s.fireMode, this.interval(1)) : 0.15
        this.pressUntil = Math.max(now, this.readyAt) + buffer
    }

    /** Whether a shot leaves now given the trigger state. Does not consume ammo. */
    canFire(now: number, held: boolean): boolean {
        const s = this.stats
        if (this.auto && !held) this.releasedAt = now
        if (!s || now < this.readyAt || now < this.nextFire || this.sprinting) return false
        if (this.mag <= 0) return false
        if (this.reloading) {
            // per-shell reloads can be interrupted by firing once a shell is in
            if (!this.shellMode) return false
        }
        if (this.auto) {
            if (!held) this.releasedAt = now
            return held
        }
        return now <= this.pressUntil
    }

    /** Records a shot fired at `now`. */
    fired(now: number, fireRateMult: number): void {
        const s = this.stats
        if (!s) return
        if (this.reloading) this.cancelReload()
        this.mag = Math.max(0, this.mag - 1)
        // Held auto fire keeps its cadence through frame hitches (catching up at
        // most one shot); a fresh pull, and every semi shot, schedules from now
        // (semi keeps the cadence only when the press was buffered early).
        const interval = dfShotInterval(s.rpm, fireRateMult)
        const late = now - this.nextFire
        let base = now
        if (this.auto) {
            const held = this.releasedAt < this.lastShotAt && now - this.lastShotAt < interval * 3 + 0.05
            if (held) base = Math.max(this.nextFire, now - interval)
        } else if (late < 0.05) {
            base = Math.max(this.nextFire, now - 0.05)
        }
        this.nextFire = Math.max(base, now - interval) + interval
        this.lastShotAt = now
        this.pressUntil = -10
        this.bloom = Math.min(1, this.bloom + (this.auto ? 0.16 : 0.3))
        this.lastAction = now
    }

    canReload(): boolean {
        const s = this.stats
        return !!s && !this.reloading && this.mag < s.magSize && this.reserve > 0
    }

    /**
     * Starts a reload. Returns the seconds the first animation step lasts
     * (whole reload for magazines, one shell for per-shell weapons) or 0.
     */
    startReload(now: number, reloadMult: number): number {
        const s = this.stats
        if (!s || !this.canReload()) return 0
        this.reloading = true
        this.lastAction = now
        const k = Math.max(0.1, reloadMult)
        if (s.perRoundReload > 0) {
            this.shellMode = true
            const first = (s.perRoundReload + (this.mag === 0 ? 0.35 : 0.15)) / k
            this.nextShell = now + first
            this.reloadEnd = this.nextShell
            return first
        }
        this.shellMode = false
        const t = (this.mag === 0 ? s.reloadEmptyTime : s.reloadTime) / k
        this.reloadStart = now
        this.reloadEnd = now + t
        return t
    }

    /**
     * Interrupts a reload (sprint, swap, knife). A magazine already seated (the
     * last fifth of the animation) counts: the rounds go in, as in a classic
     * reload cancel. Returns true when that moved ammo, so the caller can report
     * the new magazine. Without `now` the reload is simply dropped.
     */
    cancelReload(now?: number): boolean {
        const s = this.stats
        let seated = false
        if (this.reloading && !this.shellMode && s && now !== undefined) {
            const dur = Math.max(0.01, this.reloadEnd - this.reloadStart)
            if (now >= this.reloadStart + dur * DF_RELOAD_SEATED) {
                const take = Math.min(s.magSize - this.mag, this.reserve)
                this.mag += take
                this.reserve -= take
                this.lastAction = now
                seated = take > 0
            }
        }
        this.reloading = false
        this.shellMode = false
        return seated
    }

    /** Advances reloads; returns what happened this step. */
    update(now: number, dt: number, reloadMult: number): DfGunEvent {
        this.bloom = Math.max(0, this.bloom - dt * (this.auto ? 1.6 : 2.4))
        const s = this.stats
        if (!this.reloading || !s) return 'none'
        if (this.shellMode) {
            if (now < this.nextShell) return 'none'
            if (this.reserve > 0 && this.mag < s.magSize) {
                this.mag++
                this.reserve--
            }
            this.lastAction = now
            if (this.mag >= s.magSize || this.reserve <= 0) {
                this.reloading = false
                this.shellMode = false
                return 'done'
            }
            this.nextShell = now + s.perRoundReload / Math.max(0.1, reloadMult)
            this.reloadEnd = this.nextShell
            return 'shell'
        }
        if (now < this.reloadEnd) return 'none'
        const need = s.magSize - this.mag
        const take = Math.min(need, this.reserve)
        this.mag += take
        this.reserve -= take
        this.reloading = false
        this.lastAction = now
        // a fresh magazine is chambered: allow firing straight away
        this.nextFire = Math.min(this.nextFire, now)
        return 'done'
    }
}

/** How a weapon class kicks. Kick amounts are multiples of the weapon's `recoil` stat. */
export interface DfRecoilProfile {
    /** Vertical kick per shot. */
    up: number
    /** Horizontal kick amplitude per shot. */
    side: number
    /** Steady horizontal drift per shot (+ to the right). */
    drift: number
    /** Highest the climb goes in a burst, radians. */
    cap: number
    /** Seconds for the kick to land (snappy, no overshoot). */
    rise: number
    /** Recovery rate (1/s) once the trigger has rested for `delay` seconds. */
    recover: number
    delay: number
    /** Camera shake per radian of kick. */
    shake: number
    /** Camera punch per shot: the FOV widens (degrees) and the view rolls (radians), springing back. */
    punch: number
    roll: number
}

export const DF_RECOIL: Record<DfWeaponClass, DfRecoilProfile> = {
    pistol: { up: 1, side: 0.35, drift: 0, cap: 0.2, rise: 0.03, recover: 10, delay: 0.06, shake: 1.2, punch: 0.5, roll: 0.006 },
    smg: { up: 1, side: 0.55, drift: 0.12, cap: 0.15, rise: 0.028, recover: 8, delay: 0.08, shake: 0.8, punch: 0.22, roll: 0.004 },
    rifle: { up: 1, side: 0.3, drift: 0.05, cap: 0.26, rise: 0.04, recover: 6.5, delay: 0.09, shake: 1.3, punch: 1.4, roll: 0.012 },
    // the trench gun: a hard shove into the shoulder, the muzzle thrown high and the view rocked
    shotgun: { up: 1.25, side: 0.45, drift: 0, cap: 0.32, rise: 0.04, recover: 5.5, delay: 0.11, shake: 2.1, punch: 3.4, roll: 0.03 },
    lmg: { up: 1, side: 0.7, drift: -0.08, cap: 0.18, rise: 0.035, recover: 5.5, delay: 0.1, shake: 0.9, punch: 0.45, roll: 0.006 },
    special: { up: 1, side: 0.3, drift: 0, cap: 0.2, rise: 0.035, recover: 8, delay: 0.07, shake: 1, punch: 0.6, roll: 0.005 }
}

/**
 * Guns that kick unlike their class, so each has a pattern of its own: the
 * PPSh buzzes with small kicks and a wide shimmy, the Webley bucks straight
 * up, the coach gun throws the muzzle high, the Chauchat climbs and pulls hard
 * right (its long recoil), the Lewis drifts left and the flamethrower only
 * trembles.
 */
export const DF_RECOIL_ID: Partial<Record<DfWeaponId, DfRecoilProfile>> = {
    ppsh: { up: 0.85, side: 0.8, drift: 0.04, cap: 0.13, rise: 0.022, recover: 9, delay: 0.07, shake: 0.6, punch: 0.14, roll: 0.003 },
    // the C96 snaps up and settles fast; the Webley bucks straight up like a small cannon
    c96: { up: 1.05, side: 0.3, drift: 0.02, cap: 0.18, rise: 0.026, recover: 11, delay: 0.05, shake: 1, punch: 0.4, roll: 0.005 },
    webley: { up: 1.35, side: 0.2, drift: 0, cap: 0.26, rise: 0.035, recover: 8, delay: 0.08, shake: 1.8, punch: 1.3, roll: 0.014 },
    sawnoff: { up: 1.45, side: 0.4, drift: 0, cap: 0.36, rise: 0.045, recover: 5, delay: 0.12, shake: 2.4, punch: 4.4, roll: 0.04 },
    // bolt guns: one big shove per round
    kar98k: { up: 1.1, side: 0.25, drift: 0, cap: 0.28, rise: 0.04, recover: 6, delay: 0.1, shake: 1.5, punch: 1.8, roll: 0.015 },
    win1895: { up: 1, side: 0.25, drift: 0, cap: 0.24, rise: 0.04, recover: 7, delay: 0.09, shake: 1.3, punch: 1.3, roll: 0.012 },
    // the Thompson's heavy bolt climbs steadily, the MP18 barely walks
    thompson: { up: 1.05, side: 0.45, drift: 0.08, cap: 0.17, rise: 0.03, recover: 7.5, delay: 0.08, shake: 0.9, punch: 0.28, roll: 0.005 },
    mp18: { up: 0.9, side: 0.4, drift: -0.04, cap: 0.13, rise: 0.028, recover: 9, delay: 0.07, shake: 0.7, punch: 0.18, roll: 0.003 },
    bar: { up: 1.1, side: 0.4, drift: 0.1, cap: 0.22, rise: 0.035, recover: 6, delay: 0.1, shake: 1.2, punch: 0.7, roll: 0.008 },
    chauchat: { up: 1.1, side: 0.45, drift: 0.22, cap: 0.24, rise: 0.045, recover: 5, delay: 0.12, shake: 1.2, punch: 0.8, roll: 0.01 },
    lewis: { up: 1, side: 0.7, drift: -0.12, cap: 0.18, rise: 0.035, recover: 5.5, delay: 0.1, shake: 0.9, punch: 0.45, roll: 0.006 },
    flammen: { up: 1, side: 1, drift: 0, cap: 0.03, rise: 0.06, recover: 9, delay: 0.05, shake: 0.4, punch: 0, roll: 0.001 },
    // the lent launcher heaves up on every shell
    granatwerfer: { up: 1.5, side: 0.3, drift: 0, cap: 0.36, rise: 0.06, recover: 4.5, delay: 0.12, shake: 2.2, punch: 3, roll: 0.02 }
}

/** The recoil profile a weapon fires with: its own when it has one, else its class's. */
export function dfRecoilProfile(cls: DfWeaponClass, id?: DfWeaponId): DfRecoilProfile {
    return (id && DF_RECOIL_ID[id]) || DF_RECOIL[cls] || DF_RECOIL.pistol
}

/**
 * Camera recoil with a learnable per-class (and per-weapon) pattern: automatic fire climbs
 * hard for the first rounds then settles under a cap while the muzzle walks
 * left and right; the kick lands fast and recovers smoothly (two first-order
 * filters, so it never overshoots below where you aimed). Pulling the mouse
 * down against the climb is credited, so recovery doesn't drag the view past
 * the target afterwards.
 */
export class DfRecoil {
    /** Current offsets added to the view (and the aim), radians. */
    pitch = 0
    yaw = 0
    private targetPitch = 0
    private targetYaw = 0
    /** Camera punch: FOV widening (degrees) and roll (radians), added to the view. */
    fov = 0
    roll = 0
    private targetFov = 0
    private targetRoll = 0
    private lastShot = -10
    private shots = 0
    private profile: DfRecoilProfile = DF_RECOIL.pistol

    /**
     * Kicks for one shot. `amount` is the weapon's recoil already scaled by
     * perks, aiming and stance; `jitter` is a number in [0, 1) (cosmetic);
     * `id` picks the weapon's own pattern (`DF_RECOIL_ID`) over its class's;
     * `punch` scales the camera punch (less down the sights).
     * Returns the camera shake to apply.
     */
    kick(now: number, cls: DfWeaponClass, auto: boolean, amount: number, jitter: number, id?: DfWeaponId, punch = 1): number {
        const p = dfRecoilProfile(cls, id)
        this.profile = p
        if (now - this.lastShot > 0.4 || this.targetPitch < 0.002) this.shots = 0
        const n = this.shots++
        this.lastShot = now
        // autos: a hard first few rounds, then the climb settles
        const ramp = auto ? (n < 3 ? 1.2 : n < 8 ? 1 : 0.65) : 1
        const up = Math.max(0, amount) * p.up * ramp
        const room = Math.max(0, p.cap - this.targetPitch)
        // past the cap the kick turns into a little shake instead of more climb
        this.targetPitch += Math.min(up, room + up * 0.15)
        const sway = auto ? Math.sin(n * 0.9 + 0.6) * 0.75 : 0
        // autos walk a fixed sway with only a little noise, so the pattern can be learned
        const side = (sway + (jitter - 0.5) * (auto ? 0.3 : 1)) * p.side + p.drift * (auto ? 1 : 0)
        this.targetYaw += side * Math.max(0, amount)
        // keep the sideways wander bounded
        const yawCap = p.cap * 0.6
        this.targetYaw = Math.max(-yawCap, Math.min(yawCap, this.targetYaw))
        // the punch: a shove that doesn't stack past half again one shot's (autos stay a buzz)
        const k = Math.max(0, punch)
        this.targetFov = Math.min(p.punch * 1.5 * k, this.targetFov + p.punch * k)
        this.targetRoll += (jitter < 0.5 ? -1 : 1) * p.roll * k
        this.targetRoll = Math.max(-p.roll * 1.5, Math.min(p.roll * 1.5, this.targetRoll))
        return Math.min(0.14, up * p.shake)
    }

    update(dt: number, now: number): void {
        const p = this.profile
        if (now - this.lastShot > p.delay) {
            const k = 1 - Math.exp(-p.recover * dt)
            this.targetPitch -= this.targetPitch * k
            this.targetYaw -= this.targetYaw * k
        }
        const f = 1 - Math.exp(-dt / Math.max(0.005, p.rise))
        this.pitch += (this.targetPitch - this.pitch) * f
        this.yaw += (this.targetYaw - this.yaw) * f
        if (Math.abs(this.targetPitch) < 1e-5 && Math.abs(this.pitch) < 1e-5) this.targetPitch = this.pitch = 0
        if (Math.abs(this.targetYaw) < 1e-5 && Math.abs(this.yaw) < 1e-5) this.targetYaw = this.yaw = 0
        // the punch lands in a frame or two and springs back within a fifth of a second
        const decay = Math.exp(-dt * 13)
        this.targetFov *= decay
        this.targetRoll *= decay
        const g = 1 - Math.exp(-dt / 0.018)
        this.fov += (this.targetFov - this.fov) * g
        this.roll += (this.targetRoll - this.roll) * g
    }

    /**
     * The player pulled the view down by `down` radians while recoil is up.
     * Returns how much of that to hand back to the base pitch: that part of
     * the climb is considered compensated and no longer recovers.
     */
    compensate(down: number): number {
        if (!(down > 0) || this.pitch <= 0) return 0
        const a = Math.min(down, this.pitch)
        this.pitch -= a
        this.targetPitch = Math.max(0, this.targetPitch - a)
        return a
    }

    reset(): void {
        this.pitch = this.yaw = this.targetPitch = this.targetYaw = 0
        this.fov = this.roll = this.targetFov = this.targetRoll = 0
        this.shots = 0
    }
}
