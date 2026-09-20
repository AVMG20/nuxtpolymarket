// Void Runner — the capital bosses beyond the Dreadnought Carrier.
//
// Tyrant Siege Cruiser: hides in every zone. No shield, but three citadel guns
// that cannot be destroyed, storm rockets once it is hurt and a relief wing
// when it is dying. Its stern furnace is the soft spot.
// Eclipse Harbinger: waits past the jump gates. Shield pylons that reignite
// once, lance emitters that never stop, Ravagers from the ring hangars and a
// singularity core that drags the pilot in before it bursts.

import * as THREE from 'three'
import { randomFloat, randomPick } from '#shared/utils/random'
import type { VoidTurretId } from '#shared/utils/gamelogic/void'
import type { CapitalId, CapitalModel, CapitalMount } from './capital-models'
import { alertGroup, faceTowards, fireBolt, fireOrb, lead, randDir, spawnEnemy, steer } from './enemies'
import { disposeTree, type VoidEngine } from './engine'
import { explosion } from './fx'
import { buildTurret } from './turrets'
import type { TurretModel } from './models'
import type { Enemy, HostileKind } from './types'

export interface CapitalSpec {
    id: CapitalId
    /** `enemy.data.capital`: 0 is the Dreadnought Carrier. */
    index: number
    name: string
    scale: number
    /** Hull as a multiple of a warden's base hull. */
    hull: number
    glow: number
    orbit: number
    speed: number
    citadel: VoidTurretId
    intro: string
    /** Hull fractions where the fight changes, ticked on the boss bar. */
    marks: number[]
}

export const CAPITALS: Record<CapitalId, CapitalSpec> = {
    tyrant: {
        id: 'tyrant', index: 1, name: 'Tyrant Siege Cruiser', scale: 1.9, hull: 4.5, glow: 0xff8a2b, orbit: 240, speed: 12, citadel: 'flak',
        intro: 'Its citadel guns cannot be destroyed. Hit the stern furnace.', marks: [0.33, 0.66]
    },
    harbinger: {
        id: 'harbinger', index: 2, name: 'Eclipse Harbinger', scale: 2.4, hull: 10.5, glow: 0xc07bff, orbit: 120, speed: 6, citadel: 'beam',
        intro: 'Break the shield pylons on its ring. The lance emitters never stop.', marks: [0.35, 0.5, 0.7]
    }
}

/** A fitting's place on the hull, in the hull root's frame (already scaled). */
export interface CapitalSlot {
    position: THREE.Vector3
    normal: THREE.Vector3
    quat: THREE.Quaternion
}

interface Citadel extends CapitalSlot {
    inv: THREE.Quaternion
    turret: TurretModel
    cooldown: number
    burst: number
    burstTimer: number
}

interface CapitalRuntime {
    spec: CapitalSpec
    model: CapitalModel
    citadels: Citadel[]
    pylons: CapitalSlot[]
    silos: CapitalSlot[]
    hangars: CapitalSlot[]
    /** Rotor spin multiplier, eased towards its target. */
    spin: number
}

const UP = new THREE.Vector3(0, 1, 0)
const WEAK_RADIUS = 17
const PULSE_RANGE = 540
const PULSE_SPEED = 340

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _d = new THREE.Vector3()
const _c = new THREE.Color()

function slotOf(m: CapitalMount, scale: number): CapitalSlot {
    return { position: m.position.clone().multiplyScalar(scale), normal: m.normal.clone().normalize(), quat: new THREE.Quaternion().setFromUnitVectors(UP, m.normal.clone().normalize()) }
}

export function capitalOf(e: Enemy) {
    return e.group.userData.capital as CapitalRuntime | undefined
}

/** Shot collision and hull scale for `enemyRayHit`. */
export function capitalShape(e: Enemy) {
    const rt = capitalOf(e)
    return rt ? { inside: rt.model.inside, scale: rt.spec.scale } : null
}

function children(engine: VoidEngine, e: Enemy, kinds: string[]) {
    let n = 0
    for (const o of engine.enemies) if (o.alive && o.data.group === e.data.group && kinds.includes(o.kind)) n++
    return n
}

function worldOf(e: Enemy, slot: CapitalSlot, lift: number, out: THREE.Vector3) {
    return e.group.localToWorld(out.copy(slot.position).addScaledVector(slot.normal, lift))
}

function worldDir(e: Enemy, slot: CapitalSlot, out: THREE.Vector3) {
    return out.copy(slot.normal).applyQuaternion(e.group.quaternion)
}

// ─── Spawning ──────────────────────────────────────────────────────────────

export function spawnCapital(engine: VoidEngine, id: CapitalId, pos: THREE.Vector3) {
    const spec = CAPITALS[id]
    const groupId = 9000 + engine.nextId()
    const m = spawnEnemy(engine, 'mothership', pos, { aggro: false, group: groupId, capital: id })
    const model = m.group.userData.capitalModel as CapitalModel
    m.data.carrier = 1
    m.data.capital = spec.index
    m.data.heading = randomFloat() * Math.PI * 2
    m.data.launch = 10
    m.data.phase = 0
    m.data.strikeCd = 6
    m.data.pulseCd = 8
    m.group.rotation.y = m.data.heading
    m.group.updateMatrixWorld(true)

    const rt: CapitalRuntime = {
        spec,
        model,
        citadels: [],
        pylons: model.pylons.map(p => slotOf(p, spec.scale)),
        silos: model.silos.map(p => slotOf(p, spec.scale)),
        hangars: model.hangars.map(p => slotOf(p, spec.scale)),
        spin: 1
    }
    m.group.userData.capital = rt

    // Citadel guns are part of the hull: nothing to lock, nothing to kill.
    for (const [i, mount] of model.citadels.entries()) {
        const slot = slotOf(mount, spec.scale)
        const turret = buildTurret(spec.citadel, spec.glow)
        turret.root.scale.setScalar(4.4 * spec.scale)
        turret.root.position.copy(slot.position)
        turret.root.quaternion.copy(slot.quat)
        m.group.add(turret.root)
        rt.citadels.push({ ...slot, inv: slot.quat.clone().invert(), turret, cooldown: 2 + i * 0.5, burst: 0, burstTimer: 0 })
    }

    const batteries: Enemy[] = []
    for (const [slot, mount] of model.batteries.entries()) {
        const at = slotOf(mount, spec.scale)
        const b = spawnEnemy(engine, 'battery', m.group.localToWorld(at.position.clone()), { aggro: false, group: groupId, scale: spec.scale })
        b.data.carrier = 1
        b.data.slot = slot
        b.cooldown = 1 + slot * 0.35
        b.group.userData.parent = m
        b.group.userData.mount = at
        batteries.push(b)
    }
    m.group.userData.batteries = batteries
    m.group.userData.reactors = rt.pylons.map((_, slot) => spawnPylon(engine, m, rt, slot))

    const escorts: [HostileKind, boolean][] = id === 'tyrant'
        ? [['bulwark', false], ['bulwark', false], ['ravager', false], ['raider', true], ['raider', false], ['raider', false]]
        : [['ravager', false], ['ravager', false], ['bulwark', false], ['bulwark', false], ['blinker', true], ['blinker', false]]
    for (const [kind, elite] of escorts) {
        const escort = spawnEnemy(engine, kind, pos.clone().add(randDir(0.4).multiplyScalar(m.radius + 30 + randomFloat() * 50)), { aggro: false, group: groupId, elite })
        escort.data.carrier = 1
    }
    return m
}

function spawnPylon(engine: VoidEngine, m: Enemy, rt: CapitalRuntime, slot: number) {
    const at = rt.pylons[slot]!
    const r = spawnEnemy(engine, 'reactor', m.group.localToWorld(at.position.clone()), { aggro: m.aggro, group: m.data.group, scale: rt.spec.scale * 1.6 })
    r.name = 'Shield pylon'
    r.hp = r.maxHp = r.maxHp * 1.6
    r.glow.set(rt.spec.glow)
    r.data.carrier = 1
    r.data.slot = slot
    r.group.userData.parent = m
    r.group.userData.mount = at
    return r
}

// ─── The fight ─────────────────────────────────────────────────────────────

export function updateCapital(engine: VoidEngine, e: Enemy, dt: number, dist: number) {
    const rt = capitalOf(e)!
    const spec = rt.spec
    const p = engine.player
    const harbinger = spec.id === 'harbinger'

    // A slow, stately orbit around where it was parked.
    e.data.heading! += dt * (spec.speed / spec.orbit) * 0.45
    const h = e.data.heading!
    const desired = _a.set(Math.cos(h) * spec.orbit, 0, Math.sin(h) * spec.orbit).add(e.anchor).sub(e.pos)
    if (desired.lengthSq() > 1) desired.setLength(spec.speed)
    steer(e, desired, 0.4, dt)
    e.pos.addScaledVector(e.vel, dt)
    faceTowards(e, _d.copy(e.vel), 0.06, dt)
    e.group.updateMatrixWorld(true)

    rt.spin += ((e.data.phase! >= 1 ? 3.2 : 1) * ((e.data.pulseT ?? 0) > 0 ? 2.5 : 1) - rt.spin) * Math.min(1, dt * 0.8)
    for (const r of rt.model.rotors) r.object.rotation.z += r.speed * rt.spin * dt

    const reactors = e.group.userData.reactors as Enemy[]
    const shielded = reactors.some(r => r.alive)
    if (harbinger && !shielded && !e.data.shieldDown) {
        e.data.shieldDown = 1
        engine.rings.spawn(e.pos, e.radius * 1.8, 0x6fd8ff, 1.2, 3)
        engine.flashes.flash(e.pos, 0x6fd8ff, 200, 500, 1)
        engine.audio.play('blink', { pitch: 0.3, volume: 1.5 })
        engine.events.banner('Harbinger shields down', 'The hull is exposed', 'good')
    }
    if (!p?.alive) return
    if (!e.data.seen && dist < 700) {
        e.data.seen = 1
        engine.events.banner(spec.name, spec.intro, 'bad')
        engine.audio.play('wardenAlert', { volume: 0.9, pitch: harbinger ? 0.5 : 0.62 })
        if (!e.aggro) alertGroup(engine, e)
    }
    // Escorts keep station on the hull instead of idling where it was parked.
    for (const o of engine.enemies) {
        if (o.alive && o !== e && o.data.group === e.data.group && o.kind !== 'battery' && o.kind !== 'reactor') o.anchor.copy(e.pos)
    }
    for (const [x, y, z, r] of rt.model.keepOut) {
        const c = e.group.localToWorld(_a.set(x, y, z).multiplyScalar(spec.scale))
        const off = _b.subVectors(p.pos, c)
        const d = off.length()
        const min = r * spec.scale + p.radius
        if (d < min && d > 0.01) {
            p.pos.addScaledVector(off.divideScalar(d), min - d)
            const into = p.vel.dot(off)
            if (into < 0) p.vel.addScaledVector(off, -into * 1.3)
        }
    }
    if (harbinger) updatePulse(engine, e, rt, dt)
    if (!e.aggro || dist > 1000) return

    // An EMP near the hull knocks the citadel guns out for a few seconds.
    if ((e.data.stunT ?? 0) > 0) {
        e.data.gunStun = 3
        e.data.stunT = 0
    }
    if ((e.data.gunStun ?? 0) > 0) e.data.gunStun! -= dt
    updateCitadels(engine, e, rt, dt, dist)

    const frac = e.hp / e.maxHp
    if (harbinger) harbingerPhases(engine, e, rt, dt, dist, frac)
    else tyrantPhases(engine, e, rt, dt, dist, frac)
}

function updateCitadels(engine: VoidEngine, e: Enemy, rt: CapitalRuntime, dt: number, dist: number) {
    const p = engine.player!
    const harbinger = rt.spec.id === 'harbinger'
    const stunned = (e.data.gunStun ?? 0) > 0
    const rage = e.data.phase! >= 2 ? 1.4 : 1
    for (const c of rt.citadels) {
        const local = e.group.worldToLocal(_a.copy(p.pos)).sub(c.position).applyQuaternion(c.inv)
        if (!stunned) {
            c.turret.yaw.rotation.y = Math.atan2(-local.x, -local.z)
            c.turret.pitch.rotation.x = THREE.MathUtils.clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.15, 1.3)
        } else if (Math.random() < dt * 10) {
            const at = worldOf(e, c, 3 * rt.spec.scale, _b)
            engine.sparks.emit(at.x, at.y, at.z, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.5, _c.set(0xc49bff).multiplyScalar(3), 0.14)
        }
        c.cooldown -= dt * rage
        if (stunned || dist > 640) continue
        const from = worldOf(e, c, 3 * rt.spec.scale, _b)
        if (harbinger) {
            // Lance emitters: quick three-round bursts of violet bolts.
            if (c.cooldown <= 0) {
                c.cooldown = 2.3 + randomFloat() * 0.6
                c.burst = 3
                c.burstTimer = 0
            }
            if (c.burst > 0 && (c.burstTimer -= dt) <= 0) {
                c.burst--
                c.burstTimer = 0.13
                fireBolt(engine, from, lead(from, p.pos, p.vel, 250), 250, 9 * e.damageMult, rt.spec.glow)
                if (c.burst === 2) engine.audio.play('enemyShot', { distance: dist * 0.5, pan: engine.panOf(from), pitch: 1.2 })
            }
        } else if (c.cooldown <= 0) {
            // Siege guns: a heavy pair of shells, slow enough to fly around.
            c.cooldown = 1.8 + randomFloat() * 0.6
            const aim = lead(from, p.pos, p.vel, 180).clone()
            const right = _a.crossVectors(aim, UP).normalize()
            for (const side of [-1, 1]) fireOrb(engine, from, _d.copy(aim).addScaledVector(right, side * 0.025), 180, 15 * e.damageMult, rt.spec.glow, 1.6)
            engine.audio.play('flak', { distance: dist * 0.5, pan: engine.panOf(from), pitch: 0.7, volume: 0.8 })
        }
    }
}

function launchFlight(engine: VoidEngine, e: Enemy, rt: CapitalRuntime, kinds: HostileKind[]) {
    if (!rt.hangars.length) return
    e.data.bay = ((e.data.bay ?? 0) + 1) % rt.hangars.length
    const bay = rt.hangars[e.data.bay]!
    const mouth = worldOf(e, bay, 4, new THREE.Vector3())
    const out = worldDir(e, bay, new THREE.Vector3())
    for (const [i, kind] of kinds.entries()) {
        const f = spawnEnemy(engine, kind, mouth.clone().addScaledVector(out, 8 + i * 6), { aggro: true, group: e.data.group })
        f.data.carrier = 1
        f.vel.copy(out).multiplyScalar(40)
    }
    engine.rings.spawn(mouth, 18, e.glow, 0.6, 2.5)
    engine.audio.play('undock', { distance: mouth.distanceTo(engine.camera.position) * 0.4, pitch: 0.6 })
}

function reinforce(engine: VoidEngine, e: Enemy, wing: [HostileKind, boolean][]) {
    const p = engine.player!
    // The relief wing warps in on the pilot's flank, not on top of the hull.
    const side = _a.subVectors(p.pos, e.pos).normalize().cross(UP).normalize()
    for (const [i, [kind, elite]] of wing.entries()) {
        const at = p.pos.clone().addScaledVector(side, (i % 2 ? -1 : 1) * (180 + i * 30)).add(randDir(0.3).multiplyScalar(40))
        const s = spawnEnemy(engine, kind, at, { aggro: true, group: e.data.group, warpIn: true, elite })
        s.data.carrier = 1
    }
    engine.audio.play('warning', { volume: 1 })
}

function fireRocket(engine: VoidEngine, e: Enemy, silo: CapitalSlot, cooldown: number) {
    const from = worldOf(e, silo, 3, new THREE.Vector3())
    engine.threats.launchRocket(e, from, worldDir(e, silo, _d), 50 * e.damageMult, cooldown)
}

function tyrantPhases(engine: VoidEngine, e: Enemy, rt: CapitalRuntime, dt: number, dist: number, frac: number) {
    if (frac < 0.66 && e.data.phase! < 1) {
        e.data.phase = 1
        e.data.threatCd = 2
        engine.events.banner('Silos open', 'Storm rockets inbound. Break across them.', 'bad')
        engine.audio.play('warning', { volume: 1 })
    }
    if (frac < 0.33 && e.data.phase! < 2) {
        e.data.phase = 2
        engine.events.banner('The Tyrant calls for help', 'A relief wing is warping in', 'bad')
        engine.rings.spawn(e.pos, e.radius * 1.6, e.glow, 1, 3)
        engine.flashes.flash(e.pos, e.glow, 160, 500, 0.8)
        reinforce(engine, e, [['mauler', false], ['ravager', false], ['ravager', false]])
    }
    if (e.data.phase! >= 1 && dist < 780 && dist > 130 && engine.threats.ready(e, dt)) {
        e.data.silo = ((e.data.silo ?? 0) + 1) % rt.silos.length
        fireRocket(engine, e, rt.silos[e.data.silo]!, e.data.phase! >= 2 ? 9 : 12)
    }
    // The furnace burns hotter the closer it is to death.
    if (e.data.phase! >= 1 && Math.random() < dt * (e.data.phase! >= 2 ? 40 : 14)) {
        const at = e.group.localToWorld(_a.copy(rt.model.core).multiplyScalar(rt.spec.scale)).add(_b.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14))
        const back = _d.set(0, 0, 1).applyQuaternion(e.group.quaternion).multiplyScalar(30)
        engine.particles.emit(at.x, at.y, at.z, back.x, back.y, back.z, { life: 0.8, size: 4, sizeEnd: 0.5, color: 0xffb050, colorEnd: 0xff3a0a, intensity: 2.6, drag: 0.6 })
    }
    e.data.launch! -= dt
    if (e.data.launch! <= 0) {
        e.data.launch = 24
        if (children(engine, e, ['raider']) < 4) launchFlight(engine, e, rt, ['raider', 'raider'])
    }
}

function harbingerPhases(engine: VoidEngine, e: Enemy, rt: CapitalRuntime, dt: number, dist: number, frac: number) {
    const p = engine.player!
    if (frac < 0.7 && e.data.phase! < 1) {
        e.data.phase = 1
        e.data.threatCd = 3
        e.data.launch = 4
        engine.events.banner('The ring spins up', 'Rocket salvos and Ravagers from the hangars', 'bad')
        engine.audio.play('charge', { pitch: 0.4, volume: 1.4 })
    }
    if (frac < 0.5 && !e.data.reignited) {
        // Two pylons come back once: the shield has to be broken a second time.
        e.data.reignited = 1
        e.data.shieldDown = 0
        const reactors = e.group.userData.reactors as Enemy[]
        for (const slot of [0, 2]) {
            if (!rt.pylons[slot]) continue
            const r = spawnPylon(engine, e, rt, slot)
            reactors.push(r)
            engine.rings.spawn(r.pos, 40, 0x6fd8ff, 0.8, 3)
        }
        engine.flashes.flash(e.pos, 0x6fd8ff, 200, 600, 1)
        engine.audio.play('shieldHit', { pitch: 0.4, volume: 1.6 })
        engine.events.banner('Shield pylons reignited', 'Two are back. Break them again.', 'bad')
    }
    if (frac < 0.35 && e.data.phase! < 2) {
        e.data.phase = 2
        e.data.pulseCd = 5
        engine.events.banner('The core opens', 'When it pulls, burn away from it', 'bad')
        engine.flashes.flash(e.pos, e.glow, 260, 700, 1)
        engine.trauma = Math.max(engine.trauma, 0.6)
        reinforce(engine, e, [['mauler', false], ['mauler', false], ['ravager', true]])
    }

    // Lance strikes, called from whichever emitter has the angle.
    e.data.strikeCd! -= dt
    if (e.data.strikeCd! <= 0 && dist < 720 && (e.data.gunStun ?? 0) <= 0 && rt.citadels.length) {
        const rage = e.data.phase! >= 2
        e.data.strikeCd = (rage ? 4.2 : e.data.phase! >= 1 ? 5.6 : 7) * (0.85 + randomFloat() * 0.3)
        const from = worldOf(e, randomPick(rt.citadels), 3 * rt.spec.scale, new THREE.Vector3())
        // A strike shares the rocket cooldown on ordinary hostiles; here the salvos keep their own clock.
        const keep = e.data.threatCd ?? 6
        engine.threats.callStrike(e, p.pos, p.vel, 38 * e.damageMult, 0, from)
        // Overcharged: a second mark where a hard turn would take the pilot.
        if (rage) engine.threats.callStrike(e, _a.copy(p.pos).add(randDir(0.5).multiplyScalar(70)), p.vel, 38 * e.damageMult, 0, from)
        e.data.threatCd = keep
    }

    if (e.data.phase! < 1) return
    // Salvos of three, one from each silo.
    if ((e.data.salvo ?? 0) > 0) {
        e.data.salvoT! -= dt
        if (e.data.salvoT! <= 0) {
            e.data.salvo!--
            e.data.salvoT = 0.55
            fireRocket(engine, e, rt.silos[e.data.salvo! % rt.silos.length]!, e.data.phase! >= 2 ? 13 : 16)
        }
    } else if (dist < 820 && dist > 150 && engine.threats.ready(e, dt)) {
        e.data.salvo = 3
        e.data.salvoT = 0
    }
    e.data.launch! -= dt
    if (e.data.launch! <= 0) {
        e.data.launch = 26
        if (children(engine, e, ['ravager']) < 2) launchFlight(engine, e, rt, ['ravager'])
        else if (children(engine, e, ['raider', 'blinker']) < 4) launchFlight(engine, e, rt, ['blinker', 'raider'])
    }
}

/** The singularity pulse: a long pull towards the core, then a shockwave that fades with distance. */
function updatePulse(engine: VoidEngine, e: Enemy, rt: CapitalRuntime, dt: number) {
    const p = engine.player!
    const core = e.group.localToWorld(_a.copy(rt.model.core).multiplyScalar(rt.spec.scale)).clone()
    const d = core.distanceTo(p.pos)
    if ((e.data.waveR ?? 0) > 0) {
        e.data.waveR! += PULSE_SPEED * dt
        if (!e.data.waveHit && e.data.waveR! >= d) {
            e.data.waveHit = 1
            const falloff = 1 - d / PULSE_RANGE
            if (falloff > 0) {
                engine.damagePlayer(60 * e.damageMult * falloff, core)
                p.vel.addScaledVector(_b.subVectors(p.pos, core).normalize(), 120 * falloff)
                engine.trauma = Math.min(1, engine.trauma + 0.7 * falloff)
            }
        }
        if (e.data.waveR! > PULSE_RANGE) e.data.waveR = 0
    }
    if (e.data.phase! < 2 || !e.aggro) return
    if ((e.data.pulseT ?? 0) > 0) {
        e.data.pulseT! -= dt
        const k = 1 - e.data.pulseT! / 2.8
        // The pull is strongest close in, where the blast will hurt the most.
        const pull = 46 * Math.max(0, 1 - d / 760)
        if (pull > 0 && d > 1) p.vel.addScaledVector(_b.subVectors(core, p.pos).divideScalar(d), pull * dt)
        for (let i = 0; i < 3; i++) {
            const dir = randDir(0.8)
            const r = 90 + Math.random() * 260
            engine.sparks.emit(core.x + dir.x * r, core.y + dir.y * r, core.z + dir.z * r, -dir.x * r * 1.4, -dir.y * r * 1.4, -dir.z * r * 1.4, 0.7, _c.set(rt.spec.glow).multiplyScalar(3), 0.3)
        }
        engine.particles.glow(core.x, core.y, core.z, _c.set(rt.spec.glow).multiplyScalar(1 + k * 4), 20 + k * 50, 0.8)
        if (Math.random() < dt * (4 + k * 14)) engine.lightning(core.clone(), core.clone().add(randDir().multiplyScalar(60 + k * 80)), rt.spec.glow)
        if (e.data.pulseT! <= 0) {
            e.data.waveR = 1
            e.data.waveHit = 0
            explosion(engine.fx, core, _b.set(0, 0, 0), 8, rt.spec.glow, false)
            engine.rings.spawn(core, PULSE_RANGE, rt.spec.glow, PULSE_RANGE / PULSE_SPEED, 4)
            engine.rings.spawn(core, PULSE_RANGE, rt.spec.glow, PULSE_RANGE / PULSE_SPEED, 3, UP.clone(), 0.05)
            engine.rings.spawn(core, PULSE_RANGE * 0.6, 0xffffff, 0.9, 2.5, undefined, 0.04)
            engine.flashes.flash(core, rt.spec.glow, 320, 900, 0.9)
            engine.audio.play('explosionLarge', { volume: 1.8, pitch: 0.5 })
        }
        return
    }
    e.data.pulseCd! -= dt
    if (e.data.pulseCd! <= 0 && d < 900) {
        e.data.pulseCd = 20
        e.data.pulseT = 2.8
        engine.events.toast('Singularity charging: burn away', 'warn')
        engine.audio.play('charge', { pitch: 0.35, volume: 1.8 })
        engine.audio.play('warning', { volume: 1 })
    }
}

// ─── Damage and death ─────────────────────────────────────────────────────

/** The Tyrant's stern furnace takes half again as much from anything that lands on it. */
export function capitalWeakSpot(engine: VoidEngine, e: Enemy, point: THREE.Vector3) {
    const rt = capitalOf(e)
    if (rt?.spec.id !== 'tyrant') return 1
    const core = e.group.localToWorld(_a.copy(rt.model.core).multiplyScalar(rt.spec.scale))
    if (core.distanceToSquared(point) > (WEAK_RADIUS * rt.spec.scale) ** 2) return 1
    if (Math.random() < 0.35) engine.rings.spawn(point, 6, 0xffb050, 0.25, 3)
    return 1.5
}

export function capitalDeath(engine: VoidEngine, e: Enemy) {
    const rt = capitalOf(e)!
    const spec = rt.spec
    const tier = engine.config!.sector.tier
    const harbinger = spec.id === 'harbinger'
    engine.events.banner(`${spec.name} destroyed`, harbinger ? 'The ring breaks and the core takes the rest' : 'Its hold spills across the sector', 'good')
    engine.audio.play('explosionLarge', { volume: 2 })
    engine.trauma = 1
    const origin = e.pos.clone()
    const quat = e.group.quaternion.clone()
    const scene = engine.scene
    const core = e.group.localToWorld(rt.model.core.clone().multiplyScalar(spec.scale))

    if (harbinger) {
        // The rotor segments tear loose and tumble away burning.
        for (const piece of rt.model.debris) {
            const wreck = new THREE.Group()
            wreck.position.copy(piece.getWorldPosition(_b))
            scene.add(wreck)
            wreck.attach(piece)
            engine.corpses.push({
                group: wreck,
                vel: wreck.position.clone().sub(core).normalize().multiplyScalar(30 + randomFloat() * 40).add(randDir().multiplyScalar(12)),
                spin: new THREE.Vector3(randomFloat() - 0.5, randomFloat() - 0.5, randomFloat() - 0.5).multiplyScalar(1.6),
                life: 1.6 + randomFloat() * 2.4,
                size: 5,
                glow: spec.glow
            })
        }
    }

    const steps = harbinger ? 16 : 13
    const length = rt.model.radius * spec.scale
    let step = 0
    const chain = () => {
        // The run ended mid-chain: clean up quietly instead of exploding in the next sector.
        if (!engine.player || engine.scene !== scene || !e.group.parent) {
            disposeTree(e.group)
            return
        }
        const at = _a.set((randomFloat() - 0.5) * 0.5, (randomFloat() - 0.5) * 0.25, -0.85 + (step / steps) * 1.7).multiplyScalar(length).applyQuaternion(quat).add(origin).clone()
        explosion(engine.fx, at, _b.set(0, 0, 0), 3 + step * 0.35, step % 2 ? 0xffc070 : spec.glow)
        engine.audio.play('explosionLarge', { distance: at.distanceTo(engine.camera.position) * 0.5 })
        step++
        if (step <= steps) {
            setTimeout(chain, 140)
            return
        }
        if (!harbinger) {
            finalBlast(engine, e, origin, 1)
            return
        }
        // The hull folds into the core before the last flash.
        let k = 0
        const implode = () => {
            if (!engine.player || engine.scene !== scene || !e.group.parent) {
                disposeTree(e.group)
                return
            }
            k += 0.05
            const s = Math.max(0.02, 1 - k * k)
            e.group.position.lerpVectors(origin, core, 1 - s)
            e.group.scale.set(s, s, s)
            engine.particles.glow(core.x, core.y, core.z, _c.set(spec.glow).multiplyScalar(2 + k * 5), 40 + k * 60, 0.9)
            if (k < 1) setTimeout(implode, 33)
            else finalBlast(engine, e, core, 1.5)
        }
        engine.audio.play('charge', { pitch: 0.3, volume: 2 })
        implode()
    }
    chain()

    const ores = engine.config!.sector.ores as Record<string, number>
    const best = (['xenite', 'iridium', 'cobalt', 'ferrite'] as const).find(id => ores[id]) ?? 'ferrite'
    const rich = harbinger ? 2 : 1.2
    engine.dropLoot(best, 60 * rich, 100 * rich, origin)
    engine.dropLoot('alloy', 30 * rich, 50 * rich, origin)
    engine.dropLoot('scrap', 80 * rich, 120 * rich, origin)
    const cores = harbinger ? 2 + Math.ceil(tier / 2) : 1 + Math.floor(tier / 2)
    engine.dropLoot('core', cores, cores, origin)
    engine.dropRelic(origin)
    engine.dropGear(origin)
    engine.dropRelic(origin.clone().add(randDir().multiplyScalar(8)))
    if (harbinger) engine.dropFuel(origin.clone().add(randDir().multiplyScalar(12)))
}

function finalBlast(engine: VoidEngine, e: Enemy, at: THREE.Vector3, size: number) {
    explosion(engine.fx, at, _b.set(0, 0, 0), 14 * size, e.glow)
    engine.audio.play('explosionLarge', { volume: 1.6, pitch: 0.55 })
    engine.rings.spawn(at, 360 * size, e.glow, 1.8, 3)
    engine.rings.spawn(at, 220 * size, 0xffffff, 1.2, 2, undefined, 0.04)
    engine.flashes.flash(at, e.glow, 400, 900 * size, 1.4)
    engine.whiteFlash = Math.max(engine.whiteFlash, 0.4 * size)
    disposeTree(e.group)
}
