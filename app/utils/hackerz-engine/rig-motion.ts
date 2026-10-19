import * as THREE from 'three'
import { HACKERZ_SPIDER_MAX_DRAIN, HACKERZ_SPIDER_MAX_GROWTH } from '#shared/utils/gamelogic/hackerz'
import { kickBarrel, poseRig, type ModelRig } from './models'

/**
 * How every rig moves — the one source for both the board and the database
 * turntable. The database doubles as a mob debugging tool, so it must show a
 * unit exactly as the game animates it: change a pose here and both move
 * together; never pose a rig any other way.
 */
export const MOTION = {
    /** Leg swing per field unit walked, per unit of model height: a short unit takes quicker steps. */
    strideScale: 7,
    /** Airborne bob: phase rate, and height in field units. */
    hoverRate: 2.4,
    hoverBob: 9,
    /** Hit flash: how long it lasts, and how bright at its peak. */
    hitFlashMs: 90,
    hitFlashPeak: 0.7,
    /** Red-ground shield sheen: how fast it eases on and off, and how fast a break flare fades. */
    sheenRate: 6,
    sheenFlareDecay: 3,
    /** A hostile gun's recoil: kick in model units, and how fast it settles. */
    enemyRecoil: 0.4,
    recoilDecay: 4,
    /** A turret's recoil and its settle time, and how fast its spinners turn. */
    turretKick: 0.22,
    turretKickMs: 60,
    turretSpin: 1.5,
    /** How fast turrets and the rail swing onto a target, in radians a second. */
    turretTurn: 10,
    railTurn: 14,
    /** The gap between shots inside a volley, for burst-firing hostiles. */
    burstGapMs: 260,
    /** Hack pulses: about how often a hacking unit fires one, how long it flies, and how high it arcs (world units). */
    hackPulseMs: 560,
    hackPulseFlight: 0.35,
    hackPulseArc: 0.8,
    /** A unit rezzes in over this many seconds. */
    rezIn: 0.35,
    /** A melee jab (the Warden's prod): how fast it plays out, how far it thrusts and lifts (model units, radians). */
    strikeRate: 3,
    strikeReach: 0.45,
    strikeLift: 0.3,
    /** Where a melee weapon's business end sits on its pivot (model units, forward is +z once exported). */
    weaponTip: 1.7,
    /** A ram (the Siege Tank's plate): driven straight out this far on its pistons, no lift; its face sits just ahead of the pivot. */
    ramReach: 0.75,
    ramFace: 0.15,
    /**
     * A heave (the Daemon's leak): how fast it plays out, and its beats as
     * fractions of it — the arms reach back to the disc, hold while the block
     * comes out of it, swing it overhead and let go in front.
     */
    heaveRate: 1.3,
    heaveGrab: 0.28,
    heaveHold: 0.42,
    heaveDrop: 0.78,
    /** Arm angles (radians, from hanging): back at the disc, and up and over in front at the release. */
    heaveReach: 1.05,
    heaveOver: 3.95,
    /** Shoulder to hand, in model units. */
    heaveHand: 0.72,
    /** ROOTKIT going to ground: how long it takes to melt into the floor, and to rise back out of it. */
    burrowSinkMs: 950,
    burrowRiseMs: 700,
    /** The leap before the drill, as a fraction of height; and the drill's turns, going down. */
    burrowLeap: 0.45,
    burrowTurns: 2.5,
    /**
     * The drill point (radians at the hip and the knee): each upper leg turned
     * down flat against the body's side, each lower leg angled in under it so
     * all the tips meet beneath the middle. Set from ROOTKIT's leg geometry.
     */
    burrowGatherHip: 2.2,
    burrowGatherKnee: 1.69,
    /** ROOTKIT's forelegs injecting its brood: how fast a stab plays out, how far down it drives (radians), and where the needle ends (model units). */
    injectRate: 2.2,
    injectStab: 0.7,
    fangTip: 0.9
} as const

/**
 * Plays an injection: `inject` is 1 as the forelegs rear back, easing to 0.
 * They lift, drive down into the ground and pull out. Returns the new value.
 */
export function easeInject(rig: ModelRig, inject: number, dt: number) {
    const next = Math.max(0, inject - dt * MOTION.injectRate)
    for (const fang of rig.fangs) fang.rotation.x = (fang.userData.restX as number) + injectStab(next) * MOTION.injectStab
    return next
}

/** The forelegs' tilt through an injection: rear up, drive down, pull back out. */
function injectStab(inject: number) {
    if (inject <= 0) return 0
    const p = 1 - inject
    if (p < 0.3) return -0.5 * smooth(p / 0.3)
    if (p < 0.55) return -0.5 + 1.5 * smooth((p - 0.3) / 0.25)
    return 1 - smooth((p - 0.55) / 0.45)
}

/** True the frame the forelegs reach the bottom of their stab: the brood goes in. */
export function injectLands(before: number, after: number) {
    return before > 0.45 && after <= 0.45
}

/** How big a drainer (a spiderling) has grown on a drain this many times its first. */
export function drainGrowth(drainPower: number) {
    return 1 + (drainPower - 1) / (HACKERZ_SPIDER_MAX_DRAIN - 1) * (HACKERZ_SPIDER_MAX_GROWTH - 1)
}

/** Where each foreleg's needle is, in world space. */
export function fangTips(rig: ModelRig) {
    return rig.fangs.map((fang) => {
        fang.updateWorldMatrix(true, false)
        return fang.localToWorld(new THREE.Vector3(0, 0, MOTION.fangTip))
    })
}

/**
 * ROOTKIT going to ground, frame by frame. `sinking` is how far through its
 * dive it is (0–1), or null; `rising` how far through its climb back out
 * (0–1), or null. Going down it leaps, gathering its legs into a point under
 * it, and drills point-first into the floor, spinning; coming up it spins
 * back out of the floor and unfolds. Returns its height off the floor (as a
 * fraction of its own; under the floor is negative), its spin (radians), and
 * how far its legs are gathered (0–1).
 */
export function burrowFrame(sinking: number | null, rising: number | null) {
    if (sinking !== null) {
        const s = Math.min(1, Math.max(0, sinking))
        const gather = smooth(Math.min(1, s / 0.3))
        // Up off the floor, then down through it, point first.
        const lift = s < 0.35
            ? MOTION.burrowLeap * Math.sin(s / 0.35 * Math.PI * 0.5)
            : MOTION.burrowLeap - (MOTION.burrowLeap + 1.05) * Math.pow((s - 0.35) / 0.65, 2)
        const spin = s < 0.3 ? 0 : Math.pow((s - 0.3) / 0.7, 1.5) * MOTION.burrowTurns * Math.PI * 2
        return { lift, spin, gather }
    }
    if (rising !== null) {
        const r = Math.min(1, Math.max(0, rising))
        const out = 1 - Math.pow(1 - r, 2)
        return {
            lift: -1.05 * (1 - out),
            spin: (1 - out) * MOTION.burrowTurns * Math.PI * 2,
            gather: r < 0.55 ? 1 : 1 - smooth((r - 0.55) / 0.45)
        }
    }
    return { lift: 0, spin: 0, gather: 0 }
}

/**
 * Draws the legs into a drill point, `gather` of the way (0–1): the upper legs
 * turned down flat against the body, the lower legs angled in so their tips
 * meet under it. Run after the walk's pose, which it overrides.
 */
export function gatherLegs(rig: ModelRig, gather: number) {
    if (gather <= 0) return
    for (const leg of rig.gaitLegs) {
        if (!leg.userData.sideways) continue
        const side = Math.sign(Math.round(leg.position.x * 100))
        const knee = leg.userData.knee as THREE.Object3D | null
        leg.rotation.y *= 1 - gather
        leg.rotation.z += (-side * MOTION.burrowGatherHip - leg.rotation.z) * gather
        if (knee) knee.rotation.z += (side * MOTION.burrowGatherKnee - knee.rotation.z) * gather
    }
}

/** Eases 0→1 in and out. */
function smooth(t: number) {
    return t * t * (3 - 2 * t)
}

/**
 * The arm angle `p` of the way through a heave: one windmill — back to the
 * disc, up overhead, down in front and round to rest.
 */
function heaveAngle(p: number) {
    const { heaveGrab: grab, heaveHold: hold, heaveDrop: drop, heaveReach: reach, heaveOver: over } = MOTION
    if (p < grab) return smooth(p / grab) * reach
    if (p < hold) return reach
    if (p < drop) return reach + smooth((p - hold) / (drop - hold)) * (over - reach)
    return over + smooth((p - drop) / (1 - drop)) * (Math.PI * 2 - over)
}

/** Plays a heave: `heave` is 1 the moment it starts, easing to 0. Returns the new heave. */
export function easeHeave(rig: ModelRig, heave: number, dt: number) {
    const next = Math.max(0, heave - dt * MOTION.heaveRate)
    const angle = next > 0 ? heaveAngle(1 - next) : 0
    for (const lift of rig.lifts) lift.rotation.x = angle
    return next
}

/** True the frame the heaved block is let go. */
export function heaveReleases(before: number, after: number) {
    const at = 1 - MOTION.heaveDrop
    return before > at && after <= at
}

const _hand = new THREE.Vector3()

/**
 * Where the heaved block is, in world space: between the hands. Returns how far
 * it has come out of the disc (0–1), or 0 while nothing is in hand.
 */
export function heaveCarry(rig: ModelRig, heave: number, out: THREE.Vector3) {
    const p = 1 - heave
    const appear = MOTION.heaveGrab * 0.8
    if (heave <= 0 || !rig.lifts.length || p < appear || p >= MOTION.heaveDrop) return 0
    out.set(0, 0, 0)
    for (const lift of rig.lifts) {
        lift.updateWorldMatrix(true, false)
        out.add(lift.localToWorld(_hand.set(0, -MOTION.heaveHand, 0)))
    }
    out.divideScalar(rig.lifts.length)
    return Math.min(1, (p - appear) / (MOTION.heaveHold - appear))
}

const _tip = new THREE.Vector3()

/**
 * Plays a melee blow: `strike` is 1 the moment it is struck, easing to 0. A jab
 * (the Warden's prod) thrusts out along its own line and back, lifting a little
 * as it goes; a ram (the Siege Tank's plate) is slammed straight out on its
 * pistons, further and level. Returns the new strike.
 */
export function easeStrike(rig: ModelRig, strike: number, dt: number) {
    const weapon = rig.weapon
    const next = Math.max(0, strike - dt * MOTION.strikeRate)
    if (!weapon) return next
    const ram = rig.weaponKind === 'ram'
    // Out and back over the strike: 0 at rest, 1 at full reach.
    const thrust = next > 0 ? Math.sin((1 - next) * Math.PI) : 0
    weapon.rotation.x = rig.weaponRest.rotationX - (ram ? 0 : thrust * MOTION.strikeLift)
    _tip.set(0, 0, 1).applyEuler(weapon.rotation)
    weapon.position.copy(rig.weaponRest.position).addScaledVector(_tip, thrust * (ram ? MOTION.ramReach : MOTION.strikeReach))
    return next
}

/** True as a blow reaches full reach: the frame its impact (a spark, a slam) belongs to. */
export function strikeLands(before: number, after: number) {
    return before > 0.5 && after <= 0.5
}

const _muzzleAxis = new THREE.Vector3()
const _corner = new THREE.Vector3()
const _quat = new THREE.Quaternion()

/**
 * Where a gun's shot leaves it, in world space: the far end of its barrel along
 * the barrel's own line. A unit with fixed guns instead (the Gunship's pair)
 * fires from their tips, taking turns by `shot` (a volley's count). With
 * neither, from under its belly, a little ahead. The board and the database
 * both launch shots from here.
 */
export function muzzleOf(rig: ModelRig, out: THREE.Vector3, shot = 0) {
    const barrel = rig.barrel
    if (!barrel && rig.muzzles.length) {
        const muzzle = rig.muzzles[Math.abs(Math.round(shot)) % rig.muzzles.length]!
        muzzle.updateWorldMatrix(true, false)
        return muzzle.getWorldPosition(out)
    }
    if (!barrel) {
        rig.root.updateWorldMatrix(true, false)
        const box = rig.box
        return rig.root.localToWorld(out.set(0, box.max.y * 0.35, box.max.z * 0.6))
    }
    barrel.updateWorldMatrix(true, true)
    barrel.getWorldPosition(out)
    _muzzleAxis.set(0, 0, 1).applyQuaternion(barrel.getWorldQuaternion(_quat))
    const box = new THREE.Box3().setFromObject(barrel)
    let reach = 0
    for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) reach = Math.max(reach, _corner.set(x, y, z).sub(out).dot(_muzzleAxis))
        }
    }
    return out.addScaledVector(_muzzleAxis, reach)
}

/** The world position of a melee weapon's business end — a prod's tip, a ram's face; null without one. */
export function weaponTip(rig: ModelRig, out: THREE.Vector3) {
    if (!rig.weapon) return null
    rig.weapon.updateWorldMatrix(true, false)
    return rig.weapon.localToWorld(out.set(0, 0, rig.weaponKind === 'ram' ? MOTION.ramFace : MOTION.weaponTip))
}

/** Turns `current` toward `target` by at most `step` radians, the short way round. */
export function turnToward(current: number, target: number, step: number) {
    let diff = (target - current) % (Math.PI * 2)
    if (diff > Math.PI) diff -= Math.PI * 2
    if (diff < -Math.PI) diff += Math.PI * 2
    return current + Math.max(-step, Math.min(step, diff))
}

/**
 * Every hostile's speed in the rules, scaled up for the 3D field. Riders take
 * the long way round along the data lines where the balance sim walks them
 * straight in, so this also keeps their time to the fence near what the sim
 * assumes.
 */
export const ENEMY_PACE = 1.4
/** Speed through their own red ground, once they hold a node. */
export const THEIR_GROUND_SPEED = 2
/** Sappers run this much faster than the rules say, and shrug off every second held-ground tick. */
export const SAPPER_SPEED = 1.5

/** Field units a second a unit of this kind covers at `speed` (the rules' speed), on open or on their red ground. */
export function groundPace(speed: number, sapper: boolean, onTheirGround = false) {
    return speed * ENEMY_PACE * (sapper ? SAPPER_SPEED : 1) * (onTheirGround ? THEIR_GROUND_SPEED : 1)
}

/** The rail's recoil as it fires a round of this kind. */
export function railKickFor(projectile: string) {
    return projectile === 'slug' ? 0.5 : 0.28
}

/** Settles the rail's recoil and sets its barrel. Returns the new kick. */
export function easeRailKick(rig: ModelRig, kick: number, dt: number) {
    const next = kick + (0 - kick) * Math.min(1, dt * 18)
    if (rig.barrel) rig.barrel.position.z = rig.barrelRestZ - next
    return next
}

/** Stride gained by walking `moved` field units, for a unit `defHeight` tall. */
export function strideFor(moved: number, defHeight: number) {
    return moved / defHeight * MOTION.strideScale
}

/** Wheel roll speed for a unit that covered `moved` field units in `dt` seconds. */
export function rollSpeedFor(moved: number, rigHeight: number, dt: number, fieldScale: number) {
    return moved * fieldScale / Math.max(0.2, rigHeight * 0.18) / Math.max(dt, 1e-4)
}

/** Height a flyer bobs to at hover phase `hover`, in field units. */
export function hoverBob(hover: number) {
    return Math.sin(hover) * MOTION.hoverBob
}

/** Body flash for a unit with `flashMs` of hit flash left. */
export function hitFlash(flashMs: number) {
    return flashMs / MOTION.hitFlashMs * MOTION.hitFlashPeak
}

/** Eases the red-ground shield sheen toward on or off and fades a break flare. */
export function easeSheen(rig: ModelRig, shielded: boolean, dt: number) {
    const uniforms = rig.body.uniforms
    const sheen = uniforms.uShield!
    sheen.value += ((shielded ? 1 : 0) - sheen.value) * Math.min(1, dt * MOTION.sheenRate)
    const flare = uniforms.uShieldHit!
    if (flare.value > 0) flare.value = Math.max(0, flare.value - dt * MOTION.sheenFlareDecay)
}

/** Settles a hostile gun's recoil (1 the moment it fired) and kicks its barrel. Returns the new recoil. */
export function easeRecoil(rig: ModelRig, recoil: number, dt: number) {
    const next = Math.max(0, recoil - dt * MOTION.recoilDecay)
    kickBarrel(rig, next * next * MOTION.enemyRecoil)
    return next
}

/** Settles a turret's recoil and sets its barrel. Returns the new kick. */
export function easeTurretKick(rig: ModelRig, kick: number, dtMs: number) {
    const next = kick + (0 - kick) * Math.min(1, dtMs / MOTION.turretKickMs)
    if (rig.barrel) rig.barrel.position.z = rig.barrelRestZ - next
    return next
}

/** Turns a turret's spinners. */
export function spinTurret(rig: ModelRig, dt: number) {
    for (const spinner of rig.spins) spinner.rotation.y += dt * MOTION.turretSpin
}

export { poseRig }
