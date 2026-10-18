import { DF_PLAYER } from '#shared/utils/dead-front/constants'
import { dfBodyFits, dfMoveBody } from '#shared/utils/dead-front/physics'
import type { DfCollisionWorld } from '#shared/utils/dead-front/physics'
import type { Vec3 } from '#shared/utils/dead-front/types'

// Local player movement, simulated at a fixed 60 Hz against the shared
// collision world: walk / sprint with stamina / crouch / jump with coyote
// time and buffering / stairs / air control, plus the downed crawl.

export const DF_STEP = 1 / 60
const CRAWL_SPEED = 0.85
const GROUND_ACCEL = 55
const GROUND_DECEL = 58
/** Gaining speed past walking pace (into a sprint) is softer, so the sprint has weight. */
const SPRINT_ACCEL = 22
const AIR_ACCEL = 7
/** Extra gravity on the way down. */
const FALL_GRAVITY = 1.4
/** Eye catch-up after a stair step: base speed plus a share of the walking speed (m/s). */
const STEP_EASE_BASE = 0.7
const STEP_EASE_PER_SPEED = 0.55
const COYOTE = 0.1
const JUMP_BUFFER = 0.14

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
    stamina = 4
    tired = false
    downed = false
    /** Smoothed eye offset that hides stair steps. */
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
    private airTime = 0
    private jumpBuffered = -1
    private readonly corr: Vec3 = { x: 0, y: 0, z: 0 }
    private sprintRest = 0
    private crouchToggle = false

    teleport(p: Vec3): void {
        this.pos.x = this.prev.x = p.x
        this.pos.y = this.prev.y = p.y
        this.pos.z = this.prev.z = p.z
        this.vel.x = this.vel.y = this.vel.z = 0
        this.corr.x = this.corr.y = this.corr.z = 0
        this.stepOffset = 0
    }

    /** Queue a smooth correction toward the server's position. */
    correct(dx: number, dy: number, dz: number): void {
        this.corr.x = dx
        this.corr.y = dy
        this.corr.z = dz
    }

    toggleCrouch(): void {
        this.crouchToggle = !this.crouchToggle
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

    step(dt: number, now: number, intent: DfMoveIntent, world: DfCollisionWorld, sp: DfMoveSpeeds): void {
        this.prev.x = this.pos.x
        this.prev.y = this.pos.y
        this.prev.z = this.pos.z

        // crouch (can't stand up under a low ceiling)
        const wantCrouch = (intent.crouch || this.crouchToggle) && !this.downed
        if (wantCrouch) this.crouched = true
        else if (this.crouched) {
            if (dfBodyFits(world, this.pos, { radius: DF_PLAYER.radius, height: DF_PLAYER.height })) this.crouched = false
        }
        const target = this.crouched ? 1 : 0
        this.crouchBlend += (target - this.crouchBlend) * Math.min(1, dt * 12)

        // stamina and sprint
        const moving = Math.abs(intent.fwd) + Math.abs(intent.right) > 0.1
        const canSprint = intent.sprint && intent.fwd > 0.3 && !this.crouched && !this.downed && !this.tired && intent.ads < 0.3
        this.sprinting = canSprint && moving
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
        if (this.grounded && moving && speed > sp.walk) {
            const cur = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z)
            const wl = Math.sqrt(wx * wx + wz * wz) || 1
            // only the gain in speed is soft: turning in a sprint stays sharp
            if (cur > sp.walk * 0.95 && (this.vel.x * wx + this.vel.z * wz) / (cur * wl) > 0.85) accel = SPRINT_ACCEL
        }
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
        const beforeY = this.pos.y
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

        // stairs: hide the snap of a step in a smoothed eye offset
        const dy = this.pos.y - beforeY
        // The eye catches up at a limited speed (about the stair slope at walking
        // pace) instead of snapping, so a flight of steps reads as one smooth climb.
        if (wasGrounded && this.grounded && Math.abs(dy) > 0.02 && Math.abs(dy) <= DF_PLAYER.stepHeight + 0.05) this.stepOffset -= dy
        if (this.stepOffset !== 0) {
            const hs0 = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z)
            const lim = (STEP_EASE_BASE + hs0 * STEP_EASE_PER_SPEED) * dt
            this.stepOffset = Math.abs(this.stepOffset) <= lim ? 0 : this.stepOffset - Math.sign(this.stepOffset) * lim
            this.stepOffset = Math.max(-0.8, Math.min(0.8, this.stepOffset * Math.exp(-dt * 1.2)))
        }

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
        if (this.grounded) {
            this.stride += hs * dt
            // a continuous phase, so switching walk / sprint / crouch never jumps the bob
            const strideLen = this.sprinting ? 2.3 : this.crouched ? 1.25 : 1.7
            this.bobPhase += (hs * dt / strideLen) * Math.PI * 2
        }
    }

    /**
     * Head bob for this frame: a gentle figure-eight that eases in and out
     * with speed (never snaps on landing or stopping) and almost vanishes
     * while aiming. `step` is true on the frame a footstep lands.
     */
    headBob(dt: number, walkSpeed: number, ads: number): DfHeadBob {
        const want = this.grounded && !this.downed ? Math.min(1, this.speed / Math.max(0.5, walkSpeed)) * (1 - ads * 0.85) : 0
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
