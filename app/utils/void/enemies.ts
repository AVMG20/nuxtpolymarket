// Void Runner — hostile behaviour, spawning and the sector warden.

import * as THREE from 'three'
import { randomFloat } from '#shared/utils/random'
import { voidShip } from '#shared/utils/gamelogic/void'
import { ENEMIES, ENEMY_KINDS, WARDEN_BASE_HP, WARDEN_GLOW, threatDamageMult, threatHpMult, type EnemyKind } from './data'
import { ShieldBubble, Trail, createFlame, explosion, hitSpark } from './fx'
import { buildCrate, buildEnemy, buildWarden } from './models'
import { buildHostile } from './ships'
import { raySphere } from './asteroids'
import { disposeTree, segmentSphere, type VoidEngine } from './engine'
import type { Enemy, HostileKind } from './types'
import { eventLoot, updateEventEntity } from './events'

export const WARDEN_TRIGGER_RANGE = 380

const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _lead = new THREE.Vector3()
const _lead2 = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const _c = new THREE.Color()
const UP = new THREE.Vector3(0, 1, 0)
const WARDEN_SHOT = new THREE.Color(0xff3d6e)

let groupCounter = 1

function randDir(flatten = 1) {
    return new THREE.Vector3(randomFloat() - 0.5, (randomFloat() - 0.5) * flatten, randomFloat() - 0.5).normalize()
}

// ─── Spawning ──────────────────────────────────────────────────────────────

export function spawnEnemy(engine: VoidEngine, kind: HostileKind, pos: THREE.Vector3, opts: { aggro?: boolean, group?: number, warpIn?: boolean, elite?: boolean } = {}): Enemy {
    const cfg = engine.config!
    const threat = cfg.sector.threat
    const def = kind in ENEMIES ? ENEMIES[kind as EnemyKind] : null
    let group: THREE.Group
    let radius: number
    let hp: number
    let glow: number
    let engines: THREE.Vector3[] = []
    let engineRadii: number[] = []
    let name: string

    if (kind === 'crate') {
        const built = buildCrate(0xffa640)
        group = built.group
        radius = 2.2
        hp = 40 * (1 + (cfg.sector.tier - 1) * 0.5)
        glow = 0xffa640
        name = 'Salvage crate'
        group.rotation.set(randomFloat() * 6, randomFloat() * 6, randomFloat() * 6)
    } else if (kind === 'mine') {
        const built = buildEnemy('mine', 0xffd23f, 1.4)
        group = built.group
        radius = 1.6
        hp = 14 * threatHpMult(threat)
        glow = 0xffd23f
        name = 'Mine'
    } else if (kind === 'freighter' || kind === 'meteor' || kind === 'vault') {
        glow = kind === 'freighter' ? 0xffc44d : kind === 'meteor' ? 0xff7a2e : 0x49e6ff
        const built = buildEnemy(kind, glow, kind === 'freighter' ? 1.6 : kind === 'vault' ? 1.5 : 1 + randomFloat() * 1.2)
        group = built.group
        radius = kind === 'freighter' ? 8 : kind === 'vault' ? 4.5 : built.radius * 0.8
        hp = 100
        name = kind === 'freighter' ? 'Smuggler Freighter' : kind === 'meteor' ? 'Meteor' : 'Derelict Vault'
        engines = built.engines.map(en => en.position.clone())
        engineRadii = built.engines.map(en => en.radius)
    } else if (kind === 'warden') {
        glow = WARDEN_GLOW[cfg.sector.tier - 1] ?? 0xff3b7a
        const built = buildWarden(cfg.sector.tier, glow)
        group = built.group
        radius = 7.5
        hp = WARDEN_BASE_HP * threatHpMult(threat)
        name = cfg.sector.warden
        group.userData.ring = built.ring
        group.userData.emitters = built.emitters
    } else {
        const built = buildHostile(kind, def!.glow, def!.scale) ?? buildEnemy(kind, def!.glow, def!.scale)
        group = built.group
        radius = def!.radius
        hp = def!.hp * threatHpMult(threat)
        glow = def!.glow
        name = def!.name
        engines = built.engines.map(e => e.position.clone())
        engineRadii = built.engines.map(e => e.radius)
    }

    // The model keeps its own scale; the root carries position, rotation and the hit pulse.
    const model = group
    group = new THREE.Group()
    group.add(model)
    group.userData = model.userData
    group.position.copy(pos)
    engine.scene.add(group)
    const enemy: Enemy = {
        id: engine.nextId(),
        kind,
        def,
        name,
        group,
        pos: group.position,
        vel: new THREE.Vector3(),
        radius,
        hp,
        maxHp: hp,
        alive: true,
        hostile: kind !== 'crate' && kind !== 'vault',
        aggro: !!opts.aggro,
        elite: !!def?.elite || kind === 'warden' || kind === 'freighter',
        anchor: pos.clone(),
        wander: pos.clone(),
        cooldown: (def?.cooldown ?? 2) * (0.5 + randomFloat()),
        state: 'idle',
        stateTime: 0,
        aim: new THREE.Vector3(0, 0, -1),
        orbitSign: randomFloat() < 0.5 ? -1 : 1,
        flash: 0,
        glow: new THREE.Color(glow),
        damageMult: threatDamageMult(threat),
        shield: null,
        flames: [],
        trail: null,
        engines,
        hitMeshes: [],
        data: { group: opts.group ?? 0, dmgAcc: 0, dmgTimer: 0, burst: 0, burstTimer: 0 }
    }
    // A white additive shell over the hull that lights up on every hit.
    group.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh && mesh.name === 'hull') {
            const shell = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
            shell.visible = false
            mesh.parent!.add(shell)
            enemy.hitMeshes.push(shell)
        }
    })
    for (const [i, e] of engines.entries()) {
        const flame = createFlame(engineRadii[i] ?? 0.2, glow)
        flame.mesh.position.copy(e)
        model.add(flame.mesh)
        enemy.flames.push(flame)
    }
    if (kind === 'raider' || kind === 'mite' || kind === 'leech' || kind === 'lancer') {
        enemy.trail = new Trail(12, glow, kind === 'mite' ? 0.25 : 0.4, 0.03)
        enemy.trail.reset(pos)
    }
    if (kind === 'bulwark') {
        enemy.shield = new ShieldBubble(radius * 1.35, glow)
        group.add(enemy.shield.mesh)
    }
    if (kind === 'warden') {
        enemy.shield = new ShieldBubble(radius * 2, glow)
        group.add(enemy.shield.mesh)
    }
    if (opts.elite && def && !def.elite) {
        // Elite variant: bigger, tougher, gold-trimmed, better loot.
        enemy.elite = true
        enemy.name = `Elite ${def.name}`
        enemy.hp = enemy.maxHp = enemy.maxHp * 2.6
        enemy.damageMult *= 1.35
        enemy.radius *= 1.25
        enemy.data.elite = 1
        model.scale.multiplyScalar(1.25)
        const halo = new ShieldBubble(enemy.radius * 1.25, 0xffc44d)
        halo.strength = 0.12
        group.add(halo.mesh)
        enemy.shield = enemy.shield ?? halo
    }
    if (opts.warpIn) warpFlash(engine, pos, glow, radius)
    if (kind !== 'crate' && kind !== 'mine' && kind !== 'sentinel' && kind !== 'warden') {
        const dir = randDir(0.3)
        group.quaternion.setFromRotationMatrix(_m.lookAt(pos, _v1.copy(pos).add(dir), UP))
    }
    engine.enemies.push(enemy)
    return enemy
}

function warpFlash(engine: VoidEngine, pos: THREE.Vector3, glow: number, radius: number) {
    engine.rings.spawn(pos, radius * 5, glow, 0.5, 2.5)
    engine.particles.emit(pos.x, pos.y, pos.z, 0, 0, 0, { life: 0.3, size: radius * 6, sizeEnd: 0, color: 0xffffff, intensity: 2.5, drag: 0 })
    for (let i = 0; i < 14; i++) {
        const d = randDir().multiplyScalar(30 + Math.random() * 40)
        engine.sparks.emit(pos.x, pos.y, pos.z, d.x, d.y, d.z, 0.35, _c.set(glow).multiplyScalar(3), 0.15)
    }
}

export function spawnPatrol(engine: VoidEngine, center: THREE.Vector3, hunting: boolean, extraGroups = 0) {
    const tier = engine.config!.sector.tier
    const pool = ENEMY_KINDS.filter(k => ENEMIES[k].weights[tier - 1]! > 0)
    const groups = 1 + extraGroups
    for (let g = 0; g < groups; g++) {
        const total = pool.reduce((s, k) => s + ENEMIES[k].weights[tier - 1]!, 0)
        let roll = randomFloat() * total
        let kind: EnemyKind = pool[0]!
        for (const k of pool) {
            roll -= ENEMIES[k].weights[tier - 1]!
            if (roll < 0) {
                kind = k
                break
            }
        }
        const def = ENEMIES[kind]
        const count = def.group[0] + Math.floor(randomFloat() * (def.group[1] - def.group[0] + 1))
        const groupId = groupCounter++
        const base = center.clone().add(randDir(0.4).multiplyScalar(g * 40))
        // One ship in a wing may be an elite, more often in the deep sectors.
        const eliteIndex = kind !== 'mite' && randomFloat() < 0.08 + tier * 0.04 ? Math.floor(randomFloat() * count) : -1
        for (let i = 0; i < count; i++) {
            spawnEnemy(engine, kind, base.clone().add(randDir(0.6).multiplyScalar(8 + i * 5)), { aggro: hunting, group: groupId, warpIn: hunting, elite: i === eliteIndex })
        }
    }
    if (hunting) engine.audio.play('blink', { distance: center.distanceTo(engine.camera.position) * 0.4, pan: engine.panOf(center) })
}

export function spawnWarden(engine: VoidEngine) {
    const w = spawnEnemy(engine, 'warden', engine.lair.clone(), { aggro: true })
    w.state = 'rise'
    w.stateTime = 0
    w.data.volley = 3
    w.data.burst = 1.5
    w.data.beamTimer = 6
    w.data.summon = 10
    w.data.beamAngle = 0
    engine.warden = w
    engine.rings.spawn(w.pos, 120, w.glow, 1.2, 3)
    engine.rings.spawn(w.pos, 70, 0xffffff, 0.8, 1.5)
    engine.flashes.flash(w.pos, w.glow, 120, 300, 0.8)
    engine.trauma = Math.max(engine.trauma, 0.5)
    engine.audio.play('wardenAlert')
    engine.events.banner(engine.config!.sector.warden, 'Sector warden awakened', 'bad')
}

// ─── Damage and death ─────────────────────────────────────────────────────

export interface HitExtra {
    crit?: number
    mod?: string | null
}

/** Non-burst sources never crit, spark or trigger mods. */
const STEADY_SOURCES = new Set(['beam', 'lance', 'station', 'enemy', 'burn', 'chain'])

export function damageEnemy(engine: VoidEngine, e: Enemy, amount: number, point: THREE.Vector3, source: string, extra?: HitExtra) {
    if (!e.alive || amount <= 0) return
    // Berserker and friends scale every player weapon.
    if (source !== 'station' && source !== 'enemy' && source !== 'skill' && source !== 'burn' && source !== 'chain' && engine.skills) amount *= engine.skills.outgoingMult
    // A Bulwark's front dome eats everything but the heavy hitters.
    if (e.kind === 'bulwark' && source !== 'nova' && source !== 'lance' && source !== 'skill') {
        const fwd = _v1.set(0, 0, -1).applyQuaternion(e.group.quaternion)
        const to = _v2.subVectors(point, e.pos).normalize()
        if (fwd.dot(to) > 0.3) {
            amount *= source === 'rail' ? 0.5 : 0.1
            if (e.shield) {
                _q.copy(e.group.quaternion).invert()
                e.shield.impact(to.applyQuaternion(_q))
            }
            if (Math.random() < 0.3) hitSpark(engine.fx, point, _v2.subVectors(point, e.pos).normalize(), e.glow, 0.8)
        }
    }
    if (e.kind === 'warden' && e.state === 'rise') amount *= 0.2
    // Player hits can crit for double, shown as a big gold number.
    const burst = !STEADY_SOURCES.has(source)
    if (burst && e.hostile && randomFloat() < 0.12 + (extra?.crit ?? 0)) {
        amount *= extra?.mod === 'prism' ? 3 : 2
        engine.addFloat(_v1.copy(point).add(_v2.set(0, e.radius * 0.6, 0)), `${Math.round(amount)}!`, '#ffcf4d', 20)
        engine.audio.play('hit', { pitch: 1.6, volume: 0.8 })
    } else {
        e.data.dmgAcc = (e.data.dmgAcc ?? 0) + amount
    }
    e.hp -= amount
    e.flash = source === 'beam' || source === 'lance' ? Math.max(e.flash, 0.3) : 1
    if (e.hostile && source !== 'station') engine.hitMarker = Math.max(engine.hitMarker, source === 'beam' ? 0.08 : 0.18)
    if (e.hostile && !e.aggro) alertGroup(engine, e)
    if (e.hostile && extra?.mod) applyHitMod(engine, e, amount, extra.mod)
    if (!STEADY_SOURCES.has(source)) {
        if (Math.random() < 0.6) hitSpark(engine.fx, point, _v1.subVectors(point, e.pos).normalize(), e.hostile ? 0xffd08a : 0xffa640, 0.7)
        engine.audio.play('hit', { distance: point.distanceTo(engine.camera.position), pan: engine.panOf(point), volume: 0.5 })
    }
    if (e.hp <= 0) killEnemy(engine, e)
}

/** Relic mod effects on a landed hit. */
function applyHitMod(engine: VoidEngine, e: Enemy, amount: number, mod: string) {
    if (mod === 'chain') {
        let best: Enemy | null = null
        let bestD = 55 * 55
        for (const o of engine.enemies) {
            if (o === e || !o.alive || !o.hostile) continue
            const d = o.pos.distanceToSquared(e.pos)
            if (d < bestD) {
                bestD = d
                best = o
            }
        }
        if (best) {
            engine.lightning(e.pos, best.pos, 0x8fb8ff)
            damageEnemy(engine, best, amount * 0.35, best.pos, 'chain')
        }
    } else if (mod === 'burn') {
        // Each hit re-lights the burn at 40% of that hit over 2s; old burns fade instead of stacking.
        e.data.burnDps = Math.max(amount * 0.2, (e.data.burnDps ?? 0) * 0.5)
        e.data.burnT = 2
    } else if (mod === 'frost') {
        e.data.slowT = 1.5
    }
}

function alertGroup(engine: VoidEngine, e: Enemy) {
    e.aggro = true
    for (const other of engine.enemies) {
        if (!other.alive || other.aggro || !other.hostile) continue
        if ((e.data.group && other.data.group === e.data.group) || other.pos.distanceToSquared(e.pos) < 160 * 160) other.aggro = true
    }
}

export function killEnemy(engine: VoidEngine, e: Enemy, silent = false) {
    if (!e.alive) return
    e.alive = false
    e.hp = 0
    const distance = e.pos.distanceTo(engine.camera.position)
    if (!silent) {
        if (e.kind === 'warden') {
            wardenDeath(engine, e)
        } else {
            const size = e.kind === 'crate' ? 1.2 : Math.max(0.8, e.radius * 0.55)
            const hulk = e.def !== null && e.kind !== 'mite' && e.radius >= 2.5
            explosion(engine.fx, e.pos, e.vel, hulk ? size * 0.6 : size, e.kind === 'crate' ? 0xffa640 : e.glow, !hulk)
            engine.audio.play(e.radius > 5 ? 'explosionLarge' : 'explosionSmall', { distance, pan: engine.panOf(e.pos) })
            if (distance < 120) engine.trauma = Math.min(1, engine.trauma + 0.15 * size)
        }
    }
    if (e.hostile && e.kind !== 'mine') {
        engine.killMarker = 0.35
        engine.streak = engine.streakTimer > 0 ? engine.streak + 1 : 1
        engine.streakTimer = 3
        if (e.elite) engine.audio.play('levelUp', { volume: 0.4 })
        engine.kills++
        engine.objectives?.onKill(e)
        engine.skills?.onKill(e)
    }
    if (!silent && e.hostile) {
        // Relic caches: rare from elites and carriers, guaranteed from a warden.
        const chance = e.kind === 'warden' ? 1 : e.data.elite ? 0.07 : e.def?.elite ? 0.12 : 0
        if (chance > 0 && randomFloat() < chance) engine.dropRelic(e.pos)
    }
    if (!silent && eventLoot(engine, e)) {
        // handled by the event
    } else if (e.kind === 'crate') {
        engine.dropLoot('scrap', 5, 10, e.pos)
        engine.dropLoot('alloy', 1, 3, e.pos, 0.45)
    } else if (e.def && !silent) {
        const lootMult = e.data.elite ? 2.5 : 1
        for (const drop of e.def.drops) engine.dropLoot(drop.resource, Math.round(drop.min * lootMult), Math.round(drop.max * lootMult), e.pos, Math.min(1, (drop.chance ?? 1) * lootMult))
        if (e.data.elite) engine.dropLoot('alloy', 2, 5, e.pos)
    }
    if (e.kind === 'mine' && !silent) mineBlast(engine, e)
    if (engine.focus === e) engine.focus = null
    if (!silent && e.def && e.kind !== 'mite' && e.radius >= 2.5) {
        // The hull tumbles away burning, then goes up a moment later.
        for (const shell of e.hitMeshes) shell.visible = false
        engine.corpses.push({
            group: e.group,
            vel: e.vel.clone().multiplyScalar(0.5).add(_v1.set(randomFloat() - 0.5, randomFloat() - 0.5, randomFloat() - 0.5).multiplyScalar(12)),
            spin: new THREE.Vector3(randomFloat() - 0.5, randomFloat() - 0.5, randomFloat() - 0.5).multiplyScalar(3),
            life: 0.6 + randomFloat() * 0.7,
            size: Math.max(0.8, e.radius * 0.55),
            glow: e.glow.getHex()
        })
        return
    }
    if (e.kind !== 'warden' || silent) disposeTree(e.group)
}

/** Burning hulks left behind by kills. */
export function updateCorpses(engine: VoidEngine, dt: number) {
    engine.corpses = engine.corpses.filter((c) => {
        c.life -= dt
        c.group.position.addScaledVector(c.vel, dt)
        c.group.rotation.x += c.spin.x * dt
        c.group.rotation.y += c.spin.y * dt
        c.group.rotation.z += c.spin.z * dt
        const p = c.group.position
        if (Math.random() < 0.8) {
            const j = _v2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(c.size * 2)
            engine.particles.emit(p.x + j.x, p.y + j.y, p.z + j.z, 0, 0, 0, { life: 0.5, size: c.size * 1.8, sizeEnd: c.size * 0.4, color: 0xffa040, colorEnd: 0x551000, intensity: 2.2, drag: 0 })
            engine.smoke.emit(p.x + j.x, p.y + j.y, p.z + j.z, 0, 0, 0, { life: 1.4, size: c.size * 1.5, sizeEnd: c.size * 5, color: 0x1e1a18, alpha: 0.5, drag: 0.4 })
        }
        if (c.life > 0) return true
        explosion(engine.fx, p, c.vel, c.size * 1.1, c.glow)
        engine.audio.play('explosionSmall', { distance: p.distanceTo(engine.camera.position), pan: engine.panOf(p), pitch: 0.8 })
        disposeTree(c.group)
        return false
    })
}

function mineBlast(engine: VoidEngine, e: Enemy) {
    const p = engine.player
    const radius = 24
    engine.rings.spawn(e.pos, radius * 1.6, 0xffd23f, 0.5, 2.5)
    if (p?.alive && p.pos.distanceTo(e.pos) < radius + p.radius) engine.damagePlayer(30 * e.damageMult, e.pos)
}

function wardenDeath(engine: VoidEngine, e: Enemy) {
    const cfg = engine.config!
    engine.wardenKilled = true
    engine.warden = null
    engine.events.banner(`${cfg.sector.warden} destroyed`, 'Dock at the station or a beacon to claim the sector', 'good')
    engine.audio.play('explosionLarge', { volume: 2 })
    engine.trauma = 1
    engine.whiteFlash = 0.6
    const pos = e.pos.clone()
    let step = 0
    const chain = () => {
        if (!engine.player || step > 8) return
        const at = pos.clone().add(randDir().multiplyScalar(4 + step * 2))
        explosion(engine.fx, at, _v1.set(0, 0, 0), 2.5 + step * 0.4, step % 2 ? 0xffc070 : e.glow)
        engine.audio.play('explosionLarge', { distance: at.distanceTo(engine.camera.position) * 0.5 })
        step++
        if (step <= 8) setTimeout(chain, 160)
        else {
            explosion(engine.fx, pos, _v1.set(0, 0, 0), 9, e.glow)
            engine.rings.spawn(pos, 260, e.glow, 1.6, 3)
            engine.rings.spawn(pos, 160, 0xffffff, 1.1, 2, undefined, 0.04)
            engine.flashes.flash(pos, e.glow, 300, 600, 1.2)
            disposeTree(e.group)
        }
    }
    chain()
    engine.dropLoot('core', 1 + Math.ceil(cfg.sector.tier / 2), 1 + Math.ceil(cfg.sector.tier / 2), pos)
    engine.dropLoot('alloy', 10, 18, pos)
    engine.dropLoot('scrap', 25, 40, pos)
}

// ─── Behaviour ─────────────────────────────────────────────────────────────

function faceTowards(e: Enemy, dir: THREE.Vector3, turn: number, dt: number) {
    if (dir.lengthSq() < 1e-6) return
    _m.lookAt(_v3.set(0, 0, 0), _v2.copy(dir), UP)
    _q.setFromRotationMatrix(_m)
    e.group.quaternion.rotateTowards(_q, turn * dt)
}

function steer(e: Enemy, desired: THREE.Vector3, accel: number, dt: number) {
    e.vel.lerp(desired, 1 - Math.exp(-accel * dt))
}

function fireOrb(engine: VoidEngine, from: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, color: THREE.ColorRepresentation, size = 1) {
    engine.projectiles.push({
        pos: from.clone(),
        vel: dir.clone().normalize().multiplyScalar(speed),
        life: 5,
        damage,
        hostile: true,
        color: new THREE.Color(color).multiplyScalar(3),
        width: 1.2 * size,
        length: 3,
        splash: 0,
        homing: null,
        kind: 'orb',
        mining: 0,
        source: 'enemy'
    })
}

function fireBolt(engine: VoidEngine, from: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, color: THREE.ColorRepresentation) {
    engine.projectiles.push({
        pos: from.clone(),
        vel: dir.clone().normalize().multiplyScalar(speed),
        life: 2.5,
        damage,
        hostile: true,
        color: new THREE.Color(color).multiplyScalar(3.5),
        width: 0.45,
        length: 6,
        splash: 0,
        homing: null,
        kind: 'bolt',
        mining: 0,
        source: 'enemy'
    })
}

function lead(from: THREE.Vector3, target: THREE.Vector3, targetVel: THREE.Vector3, speed: number) {
    const t = from.distanceTo(target) / Math.max(1, speed)
    // Enemies lead imperfectly, so a pilot who keeps changing direction gets missed.
    return _lead.copy(target).addScaledVector(targetVel, t * 0.75).sub(from).normalize()
        .add(_lead2.set(randomFloat() - 0.5, randomFloat() - 0.5, randomFloat() - 0.5).multiplyScalar(0.09)).normalize()
}

export function updateEnemies(engine: VoidEngine, dt: number) {
    const p = engine.player
    const playerAlive = !!p?.alive && engine.phase === 'flying'
    const enemies = engine.enemies
    for (const e of enemies) {
        if (!e.alive) continue
        e.stateTime += dt
        e.flash = Math.max(0, e.flash - dt * 6)
        if ((e.data.burnT ?? 0) > 0) {
            e.data.burnT! -= dt
            damageEnemy(engine, e, (e.data.burnDps ?? 0) * dt, e.pos, 'burn')
            if (Math.random() < dt * 20) engine.particles.emit(e.pos.x + (Math.random() - 0.5) * e.radius, e.pos.y + (Math.random() - 0.5) * e.radius, e.pos.z + (Math.random() - 0.5) * e.radius, 0, 4, 0, { life: 0.5, size: 1.4, sizeEnd: 0, color: 0xff7a2e, colorEnd: 0xff2a0a, intensity: 2, drag: 0.5 })
            if (e.data.burnT! <= 0) e.data.burnDps = 0
            if (!e.alive) continue
        }
        if ((e.data.slowT ?? 0) > 0) {
            e.data.slowT! -= dt
            if (Math.random() < dt * 12) engine.sparks.emit(e.pos.x, e.pos.y, e.pos.z, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, 0.4, _c.set(0x9fe8ff).multiplyScalar(2.5), 0.08)
        }
        if ((e.data.stunT ?? 0) > 0) e.data.stunT! -= dt
        const toPlayer = p ? _v3.subVectors(p.pos, e.pos) : _v3.set(0, 0, 0)
        const dist = toPlayer.length()

        if (e.hostile && e.kind !== 'warden' && p) {
            const vision = e.kind === 'sentinel' ? 290 : e.kind === 'mite' ? 260 : 340
            if (!e.aggro && playerAlive && dist < vision) alertGroup(engine, e)
            if (e.aggro && dist > 1100 && e.kind !== 'sentinel') e.aggro = false
            // The station's guns keep the dock clear.
            if (e.pos.length() < 230 && e.kind !== 'mine') {
                damageEnemy(engine, e, 60 * dt * engine.config!.sector.threat, e.pos, 'station')
                if (Math.random() < dt * 8) engine.lines.push(0, 20, 0, e.pos.x, e.pos.y, e.pos.z, _c.set(0x5ec8ff).multiplyScalar(3), 0.9, 0.3)
            }
        }

        switch (e.kind) {
            case 'crate':
                e.group.rotation.x += dt * 0.2
                e.group.rotation.y += dt * 0.15
                break
            case 'mine':
                updateMine(engine, e, dt, dist)
                break
            case 'warden':
                updateWarden(engine, e, dt, dist)
                break
            case 'freighter':
            case 'vault':
                break
            case 'meteor':
                updateEventEntity(engine, e, dt)
                break
            default:
                if (!e.aggro || !playerAlive || (e.data.stunT ?? 0) > 0) idle(e, dt)
                else attack(engine, e, dt, dist)
        }
        if (!e.alive) continue

        if (e.kind !== 'sentinel' && e.kind !== 'warden' && e.kind !== 'crate' && e.kind !== 'freighter' && e.kind !== 'vault' && e.kind !== 'meteor') {
            // Keep clear of rocks and of each other.
            engine.asteroids?.query(e.pos, e.radius + 12, (rock) => {
                const away = _v1.subVectors(e.pos, rock.pos)
                const d = away.length()
                const minD = rock.radius + e.radius + 6
                if (d < minD && d > 0.01) e.vel.addScaledVector(away.divideScalar(d), (minD - d) * 6 * dt * 10)
                if (d < rock.radius * 0.9 + e.radius) e.pos.addScaledVector(away, (rock.radius * 0.9 + e.radius - d))
            })
            if (e.kind !== 'mine') {
                for (const o of enemies) {
                    if (o === e || !o.alive || o.kind === 'crate' || o.kind === 'mine') continue
                    const dx = e.pos.x - o.pos.x
                    const dy = e.pos.y - o.pos.y
                    const dz = e.pos.z - o.pos.z
                    const minD = e.radius + o.radius + 3
                    const d2 = dx * dx + dy * dy + dz * dz
                    if (d2 < minD * minD && d2 > 0.0001) {
                        const d = Math.sqrt(d2)
                        const push = (minD - d) * 4 * dt
                        e.vel.x += (dx / d) * push * 10
                        e.vel.y += (dy / d) * push * 10
                        e.vel.z += (dz / d) * push * 10
                    }
                }
            }
            e.pos.addScaledVector(e.vel, dt * ((e.data.slowT ?? 0) > 0 ? 0.7 : 1))
        }

        // Visuals
        const scale = 1 + e.flash * 0.05
        e.group.scale.setScalar(scale)
        for (const shell of e.hitMeshes) {
            shell.visible = e.flash > 0.02
            ;(shell.material as THREE.MeshBasicMaterial).opacity = e.flash * 0.55
        }
        const speedFrac = e.def && e.def.speed > 0 ? Math.min(1.4, e.vel.length() / e.def.speed) : 0.4
        for (const f of e.flames) {
            f.material.uniforms.uTime!.value = engine.time
            f.material.uniforms.uPower!.value = 0.4 + speedFrac * 0.7
        }
        if (e.trail) {
            e.trail.update(dt, e.pos)
            e.trail.draw(engine.lines, e.pos, 0.5)
        }
        if (e.shield) e.shield.update(dt, engine.time, e.data.elite && e.kind !== 'bulwark' ? 0.1 : 0)
        if (e.hostile && e.kind !== 'mine') {
            const camD = e.pos.distanceTo(engine.camera.position)
            if (camD > 140) engine.particles.glow(e.pos.x, e.pos.y, e.pos.z, _c.copy(e.glow).multiplyScalar(0.7), e.radius * 1.4 + camD * 0.01, Math.min(0.5, (camD - 140) / 300))
        }

        // Damage numbers, batched so beams don't spam them.
        e.data.dmgTimer = (e.data.dmgTimer ?? 0) - dt
        if ((e.data.dmgAcc ?? 0) > 0 && e.data.dmgTimer! <= 0) {
            e.data.dmgTimer = 0.22
            const n = Math.round(e.data.dmgAcc!)
            if (n > 0) engine.addFloat(_v1.copy(e.pos).add(_v2.set((Math.random() - 0.5) * e.radius, e.radius, 0)), `${n}`, e.elite ? '#ffb070' : '#ffffff', Math.min(22, 11 + Math.log2(1 + n) * 1.5))
            e.data.dmgAcc = 0
        }
    }
    engine.enemies = enemies.filter(e => e.alive)
}

function idle(e: Enemy, dt: number) {
    if (!e.def || e.def.stationary) {
        if (e.kind === 'sentinel') e.group.rotation.y += dt * 0.3
        return
    }
    if (e.wander.distanceToSquared(e.pos) < 400 || e.stateTime > 12) {
        e.wander.copy(e.anchor).add(randDir(0.4).multiplyScalar(40 + randomFloat() * 110))
        e.stateTime = 0
    }
    const desired = _v1.subVectors(e.wander, e.pos).normalize().multiplyScalar(e.def.speed * 0.35)
    steer(e, desired, 1, dt)
    faceTowards(e, e.vel, e.def.turn * 0.6, dt)
}

function attack(engine: VoidEngine, e: Enemy, dt: number, dist: number) {
    const p = engine.player!
    const def = e.def!
    const dmg = def.damage * e.damageMult
    const toPlayer = _v2.subVectors(p.pos, e.pos)
    const dirToPlayer = toPlayer.clone().normalize()
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(e.group.quaternion)
    e.cooldown -= dt

    switch (e.kind as EnemyKind) {
        case 'mite': {
            const weave = new THREE.Vector3(Math.sin(engine.time * 4 + e.id), Math.cos(engine.time * 3 + e.id * 2), 0).multiplyScalar(0.35)
            const desired = dirToPlayer.clone().add(weave.applyQuaternion(e.group.quaternion)).normalize().multiplyScalar(def.speed * (dist < 60 ? 1.4 : 1))
            steer(e, desired, 3, dt)
            faceTowards(e, e.vel, def.turn, dt)
            e.group.rotateZ(dt * 8)
            if (dist < p.radius + e.radius + 1.5) {
                engine.damagePlayer(dmg, e.pos)
                killEnemy(engine, e)
            }
            break
        }
        case 'raider': {
            const orbitR = 105
            const tangent = _v1.crossVectors(dirToPlayer, UP).normalize().multiplyScalar(e.orbitSign * 0.55)
            const radial = dirToPlayer.clone().multiplyScalar((dist - orbitR) / orbitR)
            const desired = tangent.add(radial).normalize().multiplyScalar(def.speed).addScaledVector(p.vel, 0.5)
            steer(e, desired, 1.6, dt)
            faceTowards(e, dirToPlayer, def.turn, dt)
            if (e.cooldown <= 0 && dist < def.range && fwd.dot(dirToPlayer) > 0.85) {
                e.cooldown = def.cooldown
                e.data.burst = 3
                e.data.burstTimer = 0
            }
            if ((e.data.burst ?? 0) > 0) {
                e.data.burstTimer = (e.data.burstTimer ?? 0) - dt
                if (e.data.burstTimer! <= 0) {
                    e.data.burst!--
                    e.data.burstTimer = 0.12
                    const muzzle = _v1.copy(e.pos).addScaledVector(fwd, 2)
                    fireBolt(engine, muzzle, lead(muzzle, p.pos, p.vel, def.projectileSpeed), def.projectileSpeed, dmg, e.glow)
                    engine.audio.play('enemyShot', { distance: dist, pan: engine.panOf(e.pos) })
                }
            }
            if (randomFloat() < dt * 0.2) e.orbitSign *= -1
            break
        }
        case 'lancer': {
            if (e.state !== 'charge') {
                const want = 230
                const tangent = _v1.crossVectors(dirToPlayer, UP).normalize().multiplyScalar(e.orbitSign * 0.6)
                const radial = dirToPlayer.clone().multiplyScalar(THREE.MathUtils.clamp((dist - want) / 60, -1, 1))
                steer(e, tangent.add(radial).multiplyScalar(def.speed), 1.2, dt)
                faceTowards(e, dirToPlayer, def.turn, dt)
                if (e.cooldown <= 0 && dist < def.range) {
                    e.state = 'charge'
                    e.stateTime = 0
                    engine.audio.play('charge', { distance: dist * 0.5, pan: engine.panOf(e.pos) })
                }
            } else {
                steer(e, _v1.set(0, 0, 0), 2, dt)
                const lockAt = 1.15
                if (e.stateTime < lockAt) {
                    e.aim.copy(lead(e.pos, p.pos, p.vel, 900))
                    faceTowards(e, e.aim, def.turn * 2, dt)
                }
                const muzzle = _v1.copy(e.pos).addScaledVector(fwd, 3.5)
                const end = _v2.copy(muzzle).addScaledVector(e.aim, 420)
                const k = Math.min(1, e.stateTime / 1.5)
                const locked = e.stateTime >= lockAt
                engine.lines.pushV(muzzle, end, _c.set(locked ? 0xff2244 : 0xff6680).multiplyScalar(locked ? 3 : 1.5), locked ? 0.9 : 0.25 + k * 0.4, locked ? 0.35 : 0.12)
                engine.particles.glow(muzzle.x, muzzle.y, muzzle.z, _c.set(0xff2d55).multiplyScalar(2 + k * 2), 2 + k * 5)
                if (e.stateTime >= 1.5) {
                    e.state = 'reposition'
                    e.cooldown = def.cooldown * (0.8 + randomFloat() * 0.4)
                    const rock = engine.asteroids?.raycast(muzzle, end, 0)
                    if (rock) end.copy(muzzle).addScaledVector(e.aim, rock.t)
                    if (segmentSphere(muzzle, end, p.pos, p.radius + 2.5)) engine.damagePlayer(dmg, muzzle)
                    engine.tracers.push({ a: muzzle.clone(), b: end.clone(), color: new THREE.Color(0xff2d55).multiplyScalar(4), life: 0.4, maxLife: 0.4, width: 1.3 })
                    engine.tracers.push({ a: muzzle.clone(), b: end.clone(), color: new THREE.Color(3, 3, 3), life: 0.15, maxLife: 0.15, width: 0.4 })
                    engine.audio.play('rail', { distance: dist * 0.4, pan: engine.panOf(e.pos), pitch: 0.7 })
                    e.orbitSign *= -1
                }
            }
            break
        }
        case 'bulwark': {
            const want = 80
            const desired = dirToPlayer.clone().multiplyScalar(THREE.MathUtils.clamp((dist - want) / 40, -0.5, 1) * def.speed)
            steer(e, desired, 0.8, dt)
            faceTowards(e, dirToPlayer, def.turn, dt)
            if (e.shield) e.shield.strength = 0.08
            if (e.cooldown <= 0 && dist < def.range) {
                e.cooldown = def.cooldown
                const muzzle = _v1.copy(e.pos).addScaledVector(fwd, e.radius)
                const aim = lead(muzzle, p.pos, p.vel, def.projectileSpeed).clone()
                for (let i = 0; i < 6; i++) {
                    const d = aim.clone().add(randDir().multiplyScalar(0.22)).normalize()
                    fireOrb(engine, muzzle, d, def.projectileSpeed * (0.85 + randomFloat() * 0.3), dmg, 0xffa436, 0.9)
                }
                engine.audio.play('flak', { distance: dist, pan: engine.panOf(e.pos), pitch: 0.7 })
            }
            break
        }
        case 'minelayer': {
            const want = 170
            const flee = dist < want ? -1 : dist > want + 60 ? 1 : 0
            const tangent = _v1.crossVectors(dirToPlayer, UP).normalize().multiplyScalar(e.orbitSign * 0.7)
            const desired = tangent.addScaledVector(dirToPlayer, flee).normalize().multiplyScalar(def.speed)
            steer(e, desired, 1, dt)
            faceTowards(e, e.vel, def.turn, dt)
            if (e.cooldown <= 0) {
                e.cooldown = def.cooldown
                const mine = spawnEnemy(engine, 'mine', _v1.copy(e.pos).addScaledVector(fwd, -e.radius - 3), { aggro: true })
                mine.vel.copy(fwd).multiplyScalar(-8)
                mine.damageMult = e.damageMult
                mine.data.arm = 1.2
                engine.audio.play('mineArm', { distance: dist, pan: engine.panOf(e.pos) })
            }
            break
        }
        case 'leech': {
            if (e.state !== 'latched') {
                steer(e, dirToPlayer.clone().multiplyScalar(def.speed + p.vel.length() * 0.5), 2.5, dt)
                faceTowards(e, dirToPlayer, def.turn, dt)
                if (dist < def.range + p.radius) {
                    e.state = 'latched'
                    e.stateTime = 0
                    e.data.latchAngle = randomFloat() * Math.PI * 2
                    engine.events.toast('A Leech latched on — shoot it off', 'warn')
                }
            } else {
                if (dist > 70) {
                    e.state = 'chase'
                    break
                }
                const a = e.data.latchAngle! + engine.time * 1.3
                const size = voidShip(engine.config!.shipId).size
                const offset = _v1.set(Math.cos(a) * (size + 4), size * 0.4 + 2, Math.sin(a) * (size + 4)).applyQuaternion(p.quat)
                const goal = _v2.copy(p.pos).add(offset)
                e.vel.copy(goal).sub(e.pos).multiplyScalar(6)
                faceTowards(e, _v1.subVectors(p.pos, e.pos), 6, dt)
                p.tethered = 0.25
                engine.damagePlayer(dmg * dt, e.pos)
                const pulse = 0.5 + Math.sin(engine.time * 20) * 0.3
                engine.lines.pushV(e.pos, p.pos, _c.set(0xb3ff3b).multiplyScalar(2.5), pulse, 0.35, 0.15)
            }
            break
        }
        case 'blinker': {
            if (e.state === 'charge') {
                steer(e, _v1.set(0, 0, 0), 3, dt)
                const dest = e.wander
                const k = e.stateTime / 0.8
                for (let i = 0; i < 2; i++) {
                    const d = randDir().multiplyScalar(6 * (1 - k))
                    engine.particles.emit(dest.x + d.x, dest.y + d.y, dest.z + d.z, -d.x, -d.y, -d.z, { life: 0.3, size: 1.2, sizeEnd: 0, color: e.glow, intensity: 3 })
                }
                engine.particles.glow(dest.x, dest.y, dest.z, _c.copy(e.glow).multiplyScalar(1 + k * 2), 3 + k * 6, 0.7)
                if (e.stateTime >= 0.8) {
                    warpFlash(engine, e.pos, e.glow.getHex(), e.radius)
                    e.pos.copy(dest)
                    e.trail?.reset(dest)
                    warpFlash(engine, dest, e.glow.getHex(), e.radius)
                    engine.audio.play('blink', { distance: dist * 0.5, pan: engine.panOf(dest), volume: 0.7 })
                    e.state = 'fire'
                    e.stateTime = 0
                }
            } else if (e.state === 'fire') {
                faceTowards(e, dirToPlayer, 12, dt)
                if (e.stateTime > 0.25 && !e.data.fired) {
                    e.data.fired = 1
                    const aim = dirToPlayer.clone()
                    for (let i = 0; i < 9; i++) {
                        fireOrb(engine, e.pos, aim.clone().add(randDir().multiplyScalar(0.3)).normalize(), def.projectileSpeed * (0.9 + randomFloat() * 0.2), dmg, e.glow, 0.8)
                    }
                    engine.audio.play('flak', { distance: dist, pan: engine.panOf(e.pos), pitch: 1.3 })
                }
                if (e.stateTime > 1.3) {
                    e.state = 'strafe'
                    e.data.fired = 0
                    e.cooldown = def.cooldown
                }
            } else {
                const tangent = _v1.crossVectors(dirToPlayer, UP).normalize().multiplyScalar(e.orbitSign)
                const radial = dirToPlayer.clone().multiplyScalar((dist - 140) / 140)
                steer(e, tangent.add(radial).normalize().multiplyScalar(def.speed), 1.2, dt)
                faceTowards(e, dirToPlayer, def.turn, dt)
                if (e.cooldown <= 0 && dist < 320) {
                    e.state = 'charge'
                    e.stateTime = 0
                    const side = randDir(0.6)
                    if (side.dot(dirToPlayer) > 0) side.negate()
                    e.wander.copy(p.pos).addScaledVector(side, 34).addScaledVector(p.vel, 0.5)
                }
            }
            break
        }
        case 'carrier': {
            const desired = dirToPlayer.clone().multiplyScalar(THREE.MathUtils.clamp((dist - 200) / 80, -0.5, 1) * def.speed)
            steer(e, desired, 0.5, dt)
            faceTowards(e, dirToPlayer, def.turn, dt)
            if (e.cooldown <= 0) {
                e.cooldown = def.cooldown
                for (let i = 0; i < 4; i++) {
                    const side = i % 2 ? 1 : -1
                    const at = _v1.set(side * 4, -0.5, 1 + i).applyQuaternion(e.group.quaternion).multiplyScalar(def.scale).add(e.pos)
                    const mite = spawnEnemy(engine, 'mite', at, { aggro: true, warpIn: false })
                    mite.vel.set(side * 40, 0, 0).applyQuaternion(e.group.quaternion)
                    engine.particles.emit(at.x, at.y, at.z, 0, 0, 0, { life: 0.3, size: 4, sizeEnd: 0, color: e.glow, intensity: 3, drag: 0 })
                }
                engine.audio.play('mineArm', { distance: dist * 0.5, pan: engine.panOf(e.pos) })
            }
            e.data.burstTimer = (e.data.burstTimer ?? 2) - dt
            if (e.data.burstTimer! <= 0 && dist < def.range) {
                e.data.burstTimer = 2.6
                const muzzle = _v1.copy(e.pos).addScaledVector(fwd, e.radius)
                const aim = lead(muzzle, p.pos, p.vel, def.projectileSpeed).clone()
                for (let i = 0; i < 5; i++) fireOrb(engine, muzzle, aim.clone().add(randDir().multiplyScalar(0.12)), def.projectileSpeed, dmg, e.glow, 1)
                engine.audio.play('enemyShot', { distance: dist, pan: engine.panOf(e.pos), pitch: 0.6 })
            }
            break
        }
        case 'sentinel': {
            faceTowards(e, dirToPlayer, def.turn, dt)
            e.vel.set(0, 0, 0)
            if (e.cooldown <= 0 && dist < def.range) {
                e.cooldown = def.cooldown
                const muzzle = _v1.copy(e.pos).addScaledVector(fwd, 3.5 * def.scale)
                engine.projectiles.push({
                    pos: muzzle.clone(),
                    vel: fwd.clone().multiplyScalar(def.projectileSpeed),
                    life: 6,
                    damage: dmg,
                    hostile: true,
                    color: new THREE.Color(e.glow).multiplyScalar(3),
                    width: 1.2,
                    length: 2,
                    splash: 10,
                    homing: null,
                    kind: 'missile',
                    mining: 0,
                    source: 'enemy'
                })
                engine.audio.play('missile', { distance: dist, pan: engine.panOf(e.pos), pitch: 0.7 })
            }
            break
        }
    }
}

function updateMine(engine: VoidEngine, e: Enemy, dt: number, dist: number) {
    const p = engine.player
    e.vel.multiplyScalar(Math.exp(-0.8 * dt))
    e.group.rotation.y += dt
    e.data.arm = (e.data.arm ?? 0) - dt
    const blink = e.state === 'trigger' ? Math.sin(engine.time * 30) > 0 : Math.sin(engine.time * 4 + e.id) > 0.7
    if (blink) engine.particles.glow(e.pos.x, e.pos.y, e.pos.z, _c.set(0xffd23f).multiplyScalar(3), 5, 0.9)
    if (e.data.arm! > 0 || !p?.alive) return
    if (e.state !== 'trigger' && dist < 16 + p.radius) {
        e.state = 'trigger'
        e.stateTime = 0
        engine.audio.play('mineArm', { distance: dist })
    }
    if (e.state === 'trigger' && e.stateTime > 0.55) killEnemy(engine, e)
    if (!e.data.field && e.stateTime > 60 && e.state !== 'trigger') killEnemy(engine, e, true)
}

// ─── Warden ────────────────────────────────────────────────────────────────

function updateWarden(engine: VoidEngine, e: Enemy, dt: number, dist: number) {
    const p = engine.player
    const ring = e.group.userData.ring as THREE.Object3D
    const emitters = e.group.userData.emitters as THREE.Vector3[]
    const frac = e.hp / e.maxHp
    const phase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3
    ring.rotation.z += dt * (0.3 + phase * 0.25)

    if (e.state === 'rise') {
        e.shield!.strength = 0.25 * (1 - e.stateTime / 2.2)
        if (e.stateTime > 2.2) {
            e.state = 'fight'
            e.shield!.strength = 0
        }
        return
    }
    if (!p?.alive) return
    const toPlayer = _v2.subVectors(p.pos, e.pos)
    const dirToPlayer = toPlayer.clone().normalize()
    faceTowards(e, dirToPlayer, 0.6, dt)
    // Drift to keep the fight at a readable distance, tethered to the lair.
    const want = 130
    const desired = dirToPlayer.clone().multiplyScalar(THREE.MathUtils.clamp((dist - want) / 80, -1, 1) * 18)
    if (e.pos.distanceTo(engine.lair) > 260) desired.add(_v1.subVectors(engine.lair, e.pos).normalize().multiplyScalar(20))
    steer(e, desired, 0.6, dt)
    e.pos.addScaledVector(e.vel, dt)

    e.group.updateMatrixWorld(true)
    const dmg = 12 * e.damageMult
    // Boss fire is always hot pink so it reads against every nebula.
    const color = WARDEN_SHOT

    // Radial bursts from every blade tip.
    e.data.burst = (e.data.burst ?? 2) - dt
    if (e.data.burst! <= 0 && dist < 520) {
        e.data.burst = phase === 3 ? 1.5 : 2.4
        for (const local of emitters) {
            const world = _v1.copy(local).applyMatrix4(ring.matrixWorld)
            const out = _v3.subVectors(world, e.pos).normalize()
            const count = 3 + phase
            for (let i = 0; i < count; i++) {
                const spread = (i - (count - 1) / 2) * 0.18
                const d = out.clone().lerp(dirToPlayer, 0.35).add(_v2.set(spread, spread * 0.5, -spread).applyQuaternion(e.group.quaternion)).normalize()
                fireOrb(engine, world, d, 55 + phase * 10, dmg, color, 1.3)
            }
            engine.particles.emit(world.x, world.y, world.z, 0, 0, 0, { life: 0.25, size: 6, sizeEnd: 0, color, intensity: 3, drag: 0 })
        }
        engine.audio.play('enemyBeam', { distance: dist * 0.3, pan: engine.panOf(e.pos), volume: 0.6 })
    }
    // Homing missiles.
    e.data.volley = (e.data.volley ?? 3) - dt
    if (e.data.volley! <= 0 && dist < 600) {
        e.data.volley = phase === 3 ? 2.6 : 4
        for (let i = 0; i < 2 + phase; i++) {
            const d = randDir().add(dirToPlayer).normalize()
            engine.projectiles.push({
                pos: e.pos.clone().addScaledVector(d, e.radius + 2),
                vel: d.multiplyScalar(40),
                life: 7,
                damage: dmg * 1.4,
                hostile: true,
                color: new THREE.Color(color).multiplyScalar(3),
                width: 1.4,
                length: 2,
                splash: 12,
                homing: null,
                kind: 'missile',
                mining: 0,
                source: 'enemy'
            })
        }
        engine.audio.play('missile', { distance: dist * 0.4, pan: engine.panOf(e.pos), pitch: 0.6 })
    }
    // Sweeping beams from phase 2.
    if (phase >= 2) {
        e.data.beamTimer = (e.data.beamTimer ?? 4) - dt
        const cycle = e.data.beamTimer!
        if (cycle <= 0) {
            e.data.beamTimer = 9
            e.data.beamAngle = Math.atan2(dirToPlayer.x, dirToPlayer.z) - 1.2
        }
        const active = cycle > 4.5 && cycle <= 8
        const telegraph = cycle > 8
        if (active || telegraph) {
            e.data.beamAngle = e.data.beamAngle! + dt * (active ? 0.55 : 0)
            for (let k = 0; k < (phase === 3 ? 3 : 2); k++) {
                const a = e.data.beamAngle! + (k * Math.PI * 2) / (phase === 3 ? 3 : 2)
                const dir = _v1.set(Math.sin(a), (p.pos.y - e.pos.y) / Math.max(60, dist), Math.cos(a)).normalize()
                const start = _v2.copy(e.pos).addScaledVector(dir, e.radius + 2)
                const end = _v3.copy(e.pos).addScaledVector(dir, 480)
                if (telegraph) {
                    engine.lines.pushV(start, end, _c.copy(color).multiplyScalar(1.5), 0.25 + Math.sin(engine.time * 20) * 0.1, 0.25)
                } else {
                    const w = 2.6 + Math.sin(engine.time * 40) * 0.3
                    engine.lines.pushV(start, end, _c.copy(color).multiplyScalar(3), 1, w * 1.4, w)
                    engine.lines.pushV(start, end, _c.setRGB(3, 3, 3), 1, w * 0.35, w * 0.3)
                    const t = raySphere(start, dir, p.pos, p.radius + 2.5)
                    if (t !== null && t < 480) engine.damagePlayer(50 * e.damageMult * dt, p.pos)
                }
            }
        }
    }
    // Summons.
    e.data.summon = (e.data.summon ?? 10) - dt
    if (e.data.summon! <= 0) {
        e.data.summon = phase === 3 ? 10 : phase === 2 ? 14 : 20
        for (let i = 0; i < 2 + phase * 2; i++) {
            spawnEnemy(engine, 'mite', e.pos.clone().add(randDir().multiplyScalar(e.radius + 8)), { aggro: true, warpIn: true })
        }
    }
    e.shield!.strength = phase === 3 ? 0.06 + Math.sin(engine.time * 6) * 0.03 : 0
    engine.particles.glow(e.pos.x, e.pos.y, e.pos.z, _c.copy(color).multiplyScalar(0.8), 30, 0.25)
}
