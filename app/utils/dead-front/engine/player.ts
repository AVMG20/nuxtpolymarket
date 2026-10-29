import { DF_PLAYER } from '#shared/utils/dead-front/constants'
import { dfBodyFits, dfMoveBody, dfRampHeight } from '#shared/utils/dead-front/physics'
import type { DfCollisionWorld } from '#shared/utils/dead-front/physics'
import type { Vec3 } from '#shared/utils/dead-front/types'
import { dfCriticalSpring } from './interp'

// Local player movement, simulated at a fixed 60 Hz against the shared
// collision world: walk / sprint with stamina / crouch / jump with coyote
// time and buffering / stairs / air control / the CoD slide (crouch out of a
// sprint), plus the downed crawl.

export const DF_STEP = 1 / 60
const CRAWL_SPEED = 0.85
const GROUND_ACCEL = 55
const GROUND_DECEL = 58
/** Gaining speed past walking pace (into a sprint) is softer, so the sprint has weight. */
const SPRINT_ACCEL = 25
const AIR_ACCEL = 7
/** Extra gravity on the way down. */
const FALL_GRAVITY = 1.4
/** Frequency (rad/s) of the critically damped spring that eases the visual eye over what the stair ramp can't hide. */
const EYE_SPRING = 22
const COYOTE = 0.1
const JUMP_BUFFER = 0.14
/**
 * The slide: crouching out of a sprint on the ground launches you low at
 * `DF_SLIDE.boost` x your speed (capped well inside the server's movement
 * budget), coasting on friction with the crouched body (so you fit under what
 * a crouch fits under). It ends when it runs out, slows to a crawl, leaves the
 * ground, or crouch is pressed again; jumping out of it keeps the momentum,
 * and a sprint still held at the end stands you straight back into it.
 */
export const DF_SLIDE = {
    time: 0.8,
    boost: 1.22,
    maxSpeed: 9.6,
    /** Deceleration, m/s². */
    friction: 6.5,
    /** Steering: how fast (rad/s) the slide turns toward where you look. */
    steer: 1.2,
    cooldown: 0.5,
    /** Seconds after a slide in which the ground barely slows you: a slide-jump keeps its speed. */
    carry: 0.3
} as const

export interface DfMoveIntent {
    /** -1..1 forward / back. */
    fwd: number
    /** -1..1 strafe right / left. */
    right: number
    sprint: boolean
    crouch: boolean
    /** Edge: jump was pressed this frame. */
    jump: boolean
    ads: number // 0..1 blend
}

export interface DfMoveSpeeds {
    walk: number
    sprint: number
    crouch: number
    ads: number
    sprintDuration: number
}

/** One frame of head bob, in metres (x sideways in camera space) plus whether a footstep lands. */
export interface DfHeadBob {
    x: number
    y: number
    step: boolean
}

export class DfPlayerController {
    readonly pos: Vec3 = { x: 0, y: 0, z: 0 }
    readonly prev: Vec3 = { x: 0, y: 0, z: 0 }
    readonly vel: Vec3 = { x: 0, y: 0, z: 0 }
    yaw = 0
    pitch = 0
    grounded = true
    crouched = false
    /** 0 standing .. 1 crouched, eased. */
    crouchBlend = 0
    sprinting = false
    /** In a slide (see `DF_SLIDE`). */
    sliding = false
    /** 0..1 eased, for the camera's lean. */
    slideBlend = 0
    stamina = 4
    tired = false
    downed = false
    /** Kept for compatibility: the stair smoothing now lives in `viewFloor`. */
    stepOffset = 0
    /** Horizontal speed this step. */
    speed = 0
    /** Distance walked on the ground, for head bob and footsteps. */
    stride = 0
    /** Head bob phase (radians, two footsteps per cycle) and its eased amplitude. */
    bobPhase = 0
    private bobAmp = 0
    private lastFoot = 0
    private readonly bobOut: DfHeadBob = { x: 0, y: 0, step: false }
    onLand: ((impact: number) => void) | null = null
    onJump: (() => void) | null = null
    onSlide: (() => void) | null = null
    private slideLeft = 0
    private slideReadyAt = 0
    /** Crouch was pressed since the last step (a press during a sprint slides). */
    private crouchPressed = false
    private airTime = 0
    private jumpBuffered = -1
    private readonly corr: Vec3 = { x: 0, y: 0, z: 0 }
    private sprintRest = 0
    private crouchToggle = false
    /** Visual floor height the camera rides on (independent of the physics' stepped y). */
    private viewY = Number.NaN
    private viewVel = 0
    private lastTarget = Number.NaN
    private readonly spring = { e: 0, v: 0 }

    teleport(p: Vec3): void {
        this.pos.x = this.prev.x = p.x
        this.pos.y = this.prev.y = p.y
        this.pos.z = this.prev.z = p.z
        this.vel.x = this.vel.y = this.vel.z = 0
        this.corr.x = this.corr.y = this.corr.z = 0
        this.stepOffset = 0
        this.viewY = Number.NaN
        this.sliding = false
        this.slideBlend = 0
    }

    /**
     * The height the camera's feet ride at this frame, for the render
     * position (`x`, `y`, `z`, interpolated physics). On the ground it follows
     * the floor smoothed into a ramp over stair steps (`dfRampHeight`), which
     * depends only on where you stand, through a critically damped spring
     * (exact at any frame rate, no overshoot), so a flight of stairs is one
     * smooth climb or descent and a lone step eases instead of popping, at 60
     * or 144 Hz alike. Jump arcs in the air are followed exactly.
     */
    viewFloor(world: DfCollisionWorld, x: number, y: number, z: number, dt: number): number {
        const target = this.grounded ? dfRampHeight(world, x, z, y, 0.45, DF_PLAYER.stepHeight + 0.05) : y
        if (!Number.isFinite(this.viewY) || Math.abs(this.viewY - target) > 1.5) {
            this.viewY = target
            this.viewVel = 0
            this.lastTarget = target
            return target
        }
        const d = target - this.lastTarget
        this.lastTarget = target
        // in the air the arc is followed exactly; on the ground the spring rides the ramp
        if (!this.grounded) this.viewY += d
        const sp = dfCriticalSpring(this.viewY - target, this.viewVel, EYE_SPRING, dt, this.spring)
        this.viewY = target + sp.e
        this.viewVel = sp.v
        return this.viewY
    }

    /**
     * Shoves the body sideways by (dx, dz) metres against the world (a zombie
     * shouldering into you): blocked by walls like walking, and carried by the
     * interpolation too, so the camera moves with it this frame.
     */
    shove(world: DfCollisionWorld, dx: number, dz: number): void {
        if (dx === 0 && dz === 0) return
        const height = this.downed ? 0.7 : this.crouched ? DF_PLAYER.crouchHeight : DF_PLAYER.height
        const res = dfMoveBody(world, this.pos, { x: dx, y: 0, z: dz }, 1, { radius: DF_PLAYER.radius, height, stepHeight: DF_PLAYER.stepHeight })
        const mx = res.pos.x - this.pos.x
        const mz = res.pos.z - this.pos.z
        // only sideways: a shove never lifts you onto a ledge or drops you off one
        if (Math.abs(res.pos.y - this.pos.y) > 0.05) return
        this.pos.x += mx
        this.pos.z += mz
        this.prev.x += mx
        this.prev.z += mz
    }

    /** Queue a smooth correction toward the server's position. */
    correct(dx: number, dy: number, dz: number): void {
        this.corr.x = dx
        this.corr.y = dy
        this.corr.z = dz
    }

    toggleCrouch(): void {
        this.crouchToggle = !this.crouchToggle
        this.crouchPressed = true
    }

    get wantsCrouch(): boolean {
        return this.crouchToggle
    }

    set wantsCrouch(v: boolean) {
        this.crouchToggle = v
    }

    /** Eye height above the feet, eased between standing / crouched / downed. */
    eyeHeight(): number {
        if (this.downed) return 0.48
        return DF_PLAYER.eyeHeight + (DF_PLAYER.crouchEyeHeight - DF_PLAYER.eyeHeight) * this.crouchBlend
    }

    queueJump(now: number): void {
        this.jumpBuffered = now
    }

    private lastNow = 0
    private carryUntil = -1

    step(dt: number, now: number, intent: DfMoveIntent, world: DfCollisionWorld, sp: DfMoveSpeeds): void {
        this.lastNow = now
        this.prev.x = this.pos.x
        this.prev.y = this.pos.y
        this.prev.z = this.pos.z

        // slide: a crouch press in a sprint on the ground
        const pressed = this.crouchPressed
        this.crouchPressed = false
        if (this.sliding && (pressed || !this.crouchToggle || this.downed)) this.endSlide()
        else if (pressed && this.crouchToggle && this.sprinting && this.grounded && !this.downed && now >= this.slideReadyAt && this.speed > sp.walk * 1.05) {
            const hs = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z) || 1
            const v = Math.min(DF_SLIDE.maxSpeed, Math.max(hs, sp.sprint) * DF_SLIDE.boost)
            this.vel.x = (this.vel.x / hs) * v
            this.vel.z = (this.vel.z / hs) * v
            this.sliding = true
            this.slideLeft = DF_SLIDE.time
            this.onSlide?.()
        }
        this.slideBlend += ((this.sliding ? 1 : 0) - this.slideBlend) * Math.min(1, dt * 10)

        // crouch (can't stand up under a low ceiling)
        const wantCrouch = (intent.crouch || this.crouchToggle || this.sliding) && !this.downed
        if (wantCrouch) this.crouched = true
        else if (this.crouched) {
            if (dfBodyFits(world, this.pos, { radius: DF_PLAYER.radius, height: DF_PLAYER.height })) this.crouched = false
        }
        const target = this.crouched ? 1 : 0
        this.crouchBlend += (target - this.crouchBlend) * Math.min(1, dt * 12)

        // stamina and sprint
        const moving = Math.abs(intent.fwd) + Math.abs(intent.right) > 0.1
        const canSprint = intent.sprint && intent.fwd > 0.3 && !this.crouched && !this.downed && !this.tired && intent.ads < 0.3
        this.sprinting = canSprint && moving && !this.sliding
        if (this.sprinting) {
            this.stamina = Math.max(0, this.stamina - dt)
            this.sprintRest = 0
            if (this.stamina <= 0) this.tired = true
        } else {
            this.sprintRest += dt
            if (this.sprintRest > 0.7) this.stamina = Math.min(sp.sprintDuration, this.stamina + dt * sp.sprintDuration / 2.6)
            if (this.tired && this.stamina > sp.sprintDuration * 0.35) this.tired = false
        }
        if (this.stamina > sp.sprintDuration) this.stamina = sp.sprintDuration

        // wish direction from yaw (camera looks down -z at yaw 0)
        let fx = intent.fwd
        let rx = intent.right
        const il = Math.sqrt(fx * fx + rx * rx)
        if (il > 1) {
            fx /= il
            rx /= il
        }
        const sy = Math.sin(this.yaw)
        const cy = Math.cos(this.yaw)
        // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
        const wx = -sy * fx + cy * rx
        const wz = -cy * fx - sy * rx
        let speed: number
        if (this.downed) speed = CRAWL_SPEED
        else if (this.sprinting) speed = sp.sprint
        else if (this.crouched) speed = sp.crouch
        else speed = sp.walk + (sp.ads - sp.walk) * intent.ads
        // backpedal and strafe a touch slower
        if (intent.fwd < 0 && !this.downed) speed *= 0.85

        const tx = wx * speed
        const tz = wz * speed
        let accel = this.grounded ? (moving ? GROUND_ACCEL : GROUND_DECEL) : AIR_ACCEL
        if (this.grounded && now < this.carryUntil) accel = AIR_ACCEL * 2
        if (this.grounded && moving && speed > sp.walk) {
            const cur = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z)
            const wl = Math.sqrt(wx * wx + wz * wz) || 1
            // only the gain in speed is soft: turning in a sprint stays sharp
            if (cur > sp.walk * 0.95 && (this.vel.x * wx + this.vel.z * wz) / (cur * wl) > 0.85) accel = SPRINT_ACCEL
        }
        if (this.sliding) {
            // coast: friction bleeds the speed, the heading turns a little toward the look
            const hs = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z)
            const ns = Math.max(0, hs - DF_SLIDE.friction * dt)
            let hx = hs > 1e-4 ? this.vel.x / hs : -sy
            let hz = hs > 1e-4 ? this.vel.z / hs : -cy
            const cross = hx * -cy - hz * -sy
            const turn = Math.max(-DF_SLIDE.steer * dt, Math.min(DF_SLIDE.steer * dt, Math.asin(Math.max(-1, Math.min(1, cross)))))
            if (hx * -sy + hz * -cy > 0) {
                const c = Math.cos(turn)
                const s = Math.sin(turn)
                const nx = hx * c - hz * s
                hz = hx * s + hz * c
                hx = nx
            }
            this.vel.x = hx * ns
            this.vel.z = hz * ns
            this.slideLeft -= dt
            if (this.slideLeft <= 0 || ns < sp.crouch * 1.1 || !this.grounded) {
                this.endSlide()
                // a sprint held through the slide stands straight back up into it
                if (intent.sprint && intent.fwd > 0.3 && !this.tired && this.grounded) this.crouchToggle = false
            }
        } else {
            let dvx = tx - this.vel.x
            let dvz = tz - this.vel.z
            const dl = Math.sqrt(dvx * dvx + dvz * dvz)
            const maxDv = accel * dt
            if (dl > maxDv) {
                dvx *= maxDv / dl
                dvz *= maxDv / dl
            }
            if (this.grounded || moving) {
                this.vel.x += dvx
                this.vel.z += dvz
            }
        }

        // jump: buffered press + coyote time
        if (this.grounded) this.airTime = 0
        else this.airTime += dt
        if (intent.jump) this.jumpBuffered = now
        if (this.jumpBuffered >= 0 && now - this.jumpBuffered <= JUMP_BUFFER && this.airTime <= COYOTE && !this.downed && this.vel.y <= 0.5) {
            if (this.crouched) {
                // jump stands you up first if there's room
                this.crouchToggle = false
            } else {
                this.vel.y = DF_PLAYER.jumpVelocity
                this.grounded = false
                this.airTime = COYOTE + 1
                this.onJump?.()
            }
            this.jumpBuffered = -1
        }

        // falling pulls harder than rising: a jump that lands, not floats
        this.vel.y -= DF_PLAYER.gravity * (this.vel.y < 0 ? FALL_GRAVITY : 1) * dt
        const fallSpeed = this.vel.y
        const wasGrounded = this.grounded
        const height = this.downed ? 0.7 : this.crouched ? DF_PLAYER.crouchHeight : DF_PLAYER.height
        const res = dfMoveBody(world, this.pos, this.vel, dt, { radius: DF_PLAYER.radius, height, stepHeight: DF_PLAYER.stepHeight })
        this.pos.x = res.pos.x
        this.pos.y = res.pos.y
        this.pos.z = res.pos.z
        this.vel.x = res.vel.x
        this.vel.y = res.vel.y
        this.vel.z = res.vel.z
        this.grounded = res.grounded
        if (this.grounded && this.vel.y < 0) this.vel.y = 0

        if (!wasGrounded && this.grounded && fallSpeed < -2.5) this.onLand?.(Math.min(1, (-fallSpeed - 2) / 9))

        // smooth server correction
        if (this.corr.x !== 0 || this.corr.y !== 0 || this.corr.z !== 0) {
            const k = Math.min(1, dt * 9)
            const cx = this.corr.x * k
            const cyy = this.corr.y * k
            const cz = this.corr.z * k
            this.pos.x += cx
            this.pos.y += cyy
            this.pos.z += cz
            this.corr.x -= cx
            this.corr.y -= cyy
            this.corr.z -= cz
            if (Math.abs(this.corr.x) + Math.abs(this.corr.y) + Math.abs(this.corr.z) < 0.005) this.corr.x = this.corr.y = this.corr.z = 0
        }

        const hs = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z)
        this.speed = hs
        if (this.grounded && !this.sliding) {
            this.stride += hs * dt
            // a continuous phase, so switching walk / sprint / crouch never jumps the bob
            const strideLen = this.sprinting ? 2.3 : this.crouched ? 1.25 : 1.7
            this.bobPhase += (hs * dt / strideLen) * Math.PI * 2
        }
    }

    private endSlide(): void {
        if (!this.sliding) return
        this.sliding = false
        this.slideReadyAt = this.lastNow + DF_SLIDE.cooldown
        this.carryUntil = this.lastNow + DF_SLIDE.carry
    }

    /**
     * Head bob for this frame: a gentle figure-eight that eases in and out
     * with speed (never snaps on landing or stopping) and almost vanishes
     * while aiming. `step` is true on the frame a footstep lands.
     */
    headBob(dt: number, walkSpeed: number, ads: number): DfHeadBob {
        const want = this.grounded && !this.downed && !this.sliding ? Math.min(1, this.speed / Math.max(0.5, walkSpeed)) * (1 - ads * 0.85) : 0
        this.bobAmp += (want - this.bobAmp) * Math.min(1, dt * 8)
        const amp = this.bobAmp * (this.sprinting ? 1.35 : this.crouched ? 0.7 : 1)
        const out = this.bobOut
        out.y = Math.sin(this.bobPhase * 2) * 0.018 * amp
        out.x = Math.sin(this.bobPhase) * 0.013 * amp
        const foot = Math.floor(this.bobPhase / Math.PI)
        out.step = foot !== this.lastFoot
        this.lastFoot = foot
        return out
    }
}

