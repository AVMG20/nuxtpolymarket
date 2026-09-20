// Void Runner — what a zone past a jump gate looks and feels like.
//
// Every zone modifier is its own place: a sky, a murk, a light, its own dust,
// its own rock, and something moving in it. Ion storms arc between the rocks
// and flicker the sky, radiation belts glow a sickly green, nebulae roll fog
// banks past the canopy, rich veins glitter, graveyards hold hulks the size of
// a station, pirate space flashes with somebody else's fight, and quiet space
// is cold, clear and full of monoliths.
//
// Everything here draws through the engine's shared particle, line and ring
// batches, and nothing allocates per frame.

import * as THREE from 'three'
import { randomFloat } from '#shared/utils/random'
import { voidZone, type VoidZoneModifier } from '#shared/utils/gamelogic/void-pilot'
import type { Asteroid } from './asteroids'
import { threatDamageMult } from './data'
import { damageEnemy, spawnEnemy } from './enemies'
import { disposeTree, type VoidEngine } from './engine'
import type { ParticleOpts } from './fx'
import type { SkyOptions } from './sky'
import { buildBeacon } from './structures'
import type { Enemy } from './types'

export interface ZoneLook {
    /** Nebula palette: deep, mid, highlight. */
    palette: [number, number, number]
    sky: SkyOptions
    /** Colour and density; null keeps whatever the sector has. */
    fog: [number, number] | null
    sun: [number, number]
    fill: [number, number]
    /** Colour, opacity, grain size. */
    dust: [number, number, number]
    /** Rock tint and how hot the ore crystals burn. */
    rock: [number, number]
}

export const ZONE_LOOKS: Record<VoidZoneModifier, ZoneLook> = {
    calm: { palette: [0x02060f, 0x123a66, 0xa8dcff], sky: { clouds: 0.4, stars: 1.8 }, fog: null, sun: [0xdfeeff, 3.3], fill: [0x6fa8e0, 0.8], dust: [0xbfe0ff, 0.45, 0.24], rock: [0xa8bcd8, 1] },
    ion: { palette: [0x030a1a, 0x0f4f8f, 0x7fd4ff], sky: { clouds: 1.4, stars: 0.5, haze: [0x0a2440, 0.3] }, fog: [0x0c2a4a, 0.00055], sun: [0x9fd0ff, 2.3], fill: [0x3fa0ff, 1.1], dust: [0x9fe8ff, 0.7, 0.3], rock: [0x8fa6d0, 1.25] },
    radiation: { palette: [0x040c02, 0x245208, 0xa6f04e], sky: { clouds: 1.1, stars: 0.4, haze: [0x1c4410, 0.6] }, fog: [0x1c4410, 0.0009], sun: [0xd8ff9a, 2.1], fill: [0x6fd030, 1.2], dust: [0xb6ff5e, 0.85, 0.36], rock: [0x9ac070, 1.35] },
    pirates: { palette: [0x140403, 0x8a2a12, 0xff8a4f], sky: { clouds: 1.1, stars: 0.8, haze: [0x2a0a04, 0.2] }, fog: [0x2a0c06, 0.00035], sun: [0xffb080, 2.8], fill: [0xff6030, 0.95], dust: [0xffa070, 0.6, 0.3], rock: [0xc89a84, 1] },
    graveyard: { palette: [0x0a0806, 0x5a4a30, 0xc9b38a], sky: { clouds: 0.9, stars: 0.45, haze: [0x2a2418, 0.42] }, fog: [0x2a2418, 0.0007], sun: [0xffe2b0, 2], fill: [0x8a7850, 0.9], dust: [0xd8c8a0, 0.9, 0.46], rock: [0xb0a084, 0.8] },
    rich: { palette: [0x0c0802, 0x7a5410, 0xffd35e], sky: { clouds: 1, stars: 1.3, haze: [0x2a1c06, 0.15] }, fog: [0x2a1c06, 0.0003], sun: [0xffe0a0, 3.2], fill: [0xffc040, 1], dust: [0xffe08a, 0.85, 0.3], rock: [0xd0b484, 1.8] },
    nebula: { palette: [0x0a0414, 0x5a1a8a, 0xff7bd8], sky: { clouds: 1.6, stars: 0.2, haze: [0x4a1868, 0.78] }, fog: [0x4a1868, 0.0021], sun: [0xe0a0ff, 1.8], fill: [0xa050ff, 1.25], dust: [0xd8a0ff, 0.9, 0.5], rock: [0xa890c8, 1.2] }
}

const STRIKE_CHARGE = 1.6
const STRIKE_REACH = 95

const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _c = new THREE.Color()
const UP = new THREE.Vector3(0, 1, 0)

// Reused for every emit, so ambience costs no garbage.
const MOTE: ParticleOpts = { life: 3, size: 0.9, sizeEnd: 0.2, color: 0xb6ff5e, intensity: 1.6, drag: 0.1 }
const TWINKLE: ParticleOpts = { life: 0.4, size: 2, sizeEnd: 0, color: 0xffe08a, intensity: 4, drag: 0 }
const BANK: ParticleOpts = { life: 8, size: 70, sizeEnd: 120, color: 0x6a2a9a, alpha: 0.3, drag: 0.05 }
const FLAK: ParticleOpts = { life: 0.5, size: 26, sizeEnd: 4, color: 0xff8a4f, intensity: 2.2, drag: 0, shape: 'fire' }
const BANK_COLORS = [0xb070d8, 0xd088d0, 0x2a1040, 0x7a4ac0, 0x3a1858]

export class ZoneAtmosphere {
    readonly look: ZoneLook
    private color: number
    private near: Asteroid[] = []
    private nearT = 0
    private collect = (rock: Asteroid) => {
        if (this.near.length < 140) this.near.push(rock)
    }

    /** Hulks are solid: a sphere round the core of each. */
    private solids: { pos: THREE.Vector3, radius: number }[] = []
    private props: THREE.Object3D[] = []
    private buoys: THREE.Vector3[] = []
    private flash = 0
    private arcT = 0
    private emitT = 0
    private strikeRock: Asteroid | null = null
    private strikeT = 0
    private strikeCd = 7

    constructor(private engine: VoidEngine, readonly zone: VoidZoneModifier) {
        this.look = ZONE_LOOKS[zone]
        this.color = voidZone(zone).color
    }

    addSolid(pos: THREE.Vector3, radius: number) {
        this.solids.push({ pos: pos.clone(), radius })
    }

    /** Zone set dressing, placed once the rest of the sector exists. */
    populate() {
        const e = this.engine
        const field = e.asteroids!
        if (this.zone === 'calm') {
            // A handful of monoliths that dwarf the ship.
            for (let i = 0; i < 8; i++) {
                const r = 60 + randomFloat() * 60
                const pos = randDir(0.3).multiplyScalar(520 + randomFloat() * 1700)
                if (!this.clear(pos, r)) continue
                const crushed: Asteroid[] = []
                field.query(pos, r + 10, rock => crushed.push(rock))
                for (const rock of crushed) field.remove(rock)
                field.add(pos, r, null)
            }
        }
        if (this.zone === 'graveyard') {
            // Old minefields drift among the wrecks.
            for (let f = 0; f < 6; f++) {
                const center = randDir(0.3).multiplyScalar(500 + randomFloat() * 1600)
                for (let i = 0; i < 6; i++) {
                    const mine = spawnEnemy(e, 'mine', center.clone().add(randDir(0.8).multiplyScalar(20 + randomFloat() * 60)), { aggro: true })
                    mine.data.arm = 0
                    mine.data.field = 1
                }
            }
        }
        if (this.zone === 'pirates') {
            // Claim buoys: red lights blinking out in the dark.
            for (let i = 0; i < 9; i++) {
                const pos = randDir(0.25).multiplyScalar(450 + randomFloat() * 1700)
                if (!this.clear(pos, 20)) continue
                const buoy = buildBeacon(0xff4030)
                buoy.group.position.copy(pos)
                buoy.group.scale.setScalar(1.3)
                buoy.group.rotation.set(randomFloat() * 0.6, randomFloat() * 6, randomFloat() * 0.6)
                e.scene.add(buoy.group)
                this.props.push(buoy.group)
                this.buoys.push(pos)
            }
        }
    }

    /** Far enough from the arrival point, the gate and anything capital-sized. */
    private clear(pos: THREE.Vector3, radius: number) {
        const e = this.engine
        if (pos.length() < 320 + radius) return false
        if (e.gate && pos.distanceTo(e.gate.pos) < 160 + radius) return false
        if (pos.distanceTo(e.lair) < 300 + radius) return false
        for (const s of e.structures) if (pos.distanceTo(s.pos) < 120 + radius) return false
        for (const en of e.enemies) if (en.radius > 30 && pos.distanceTo(en.pos) < 460 + radius) return false
        return true
    }

    /** The burst that greets the ship as it drops out of the jump. */
    arrive() {
        const e = this.engine
        const p = e.player
        if (!p) return
        const at = p.pos
        e.rings.spawn(at, 60, this.color, 0.9, 3)
        e.rings.spawn(at, 140, this.color, 1.4, 2, UP)
        e.rings.spawn(at, 260, 0xffffff, 1.8, 0.8, UP, 0.04)
        e.flashes.flash(at, this.color, 60, 320, 0.7)
        for (let i = 0; i < 70; i++) {
            const d = randDir(1).multiplyScalar(30 + Math.random() * 90)
            e.particles.emit(at.x, at.y, at.z, d.x, d.y, d.z, { life: 1 + Math.random(), size: 1.6, sizeEnd: 0, color: this.color, intensity: 3, drag: 1.2 })
        }
        if (this.zone === 'ion') {
            this.flash = 1
            for (let i = 0; i < 7; i++) e.lightning(at.clone(), at.clone().add(randDir(0.8).multiplyScalar(90 + Math.random() * 80)), this.color)
        }
        if (this.zone === 'nebula') {
            for (let i = 0; i < 18; i++) {
                const d = randDir(0.8).multiplyScalar(14 + Math.random() * 20)
                BANK.color = BANK_COLORS[i % BANK_COLORS.length]!
                BANK.life = 5
                e.smoke.emit(at.x + d.x * 3, at.y + d.y * 3, at.z + d.z * 3, d.x, d.y, d.z, BANK)
            }
        }
        if (this.zone === 'graveyard') e.debris.spawn(at.clone().add(_v1.set(0, -30, -60)), _v2.set(0, 0, 0), 40, 3, 30, Math.random)
    }

    update(dt: number) {
        const e = this.engine
        const p = e.player
        if (!p || !e.asteroids) return
        this.nearT -= dt
        if (this.nearT <= 0) {
            this.nearT = 0.5
            this.near.length = 0
            e.asteroids.query(p.pos, 440, this.collect)
        }
        if (p.alive) {
            for (const s of this.solids) {
                const d = p.pos.distanceTo(s.pos)
                const minD = s.radius + p.radius
                if (d >= minD || d < 0.001) continue
                const n = _v1.subVectors(p.pos, s.pos).divideScalar(d)
                p.pos.addScaledVector(n, minD - d)
                const into = p.vel.dot(n)
                if (into < 0) p.vel.addScaledVector(n, -into * 1.2)
            }
        }
        const cam = e.camera.position
        this.emitT += dt
        switch (this.zone) {
            case 'ion':
                this.ion(dt)
                break
            case 'radiation': {
                // Every rock in sight breathes a sick green light.
                const n = Math.min(this.near.length, 80)
                for (let i = 0; i < n; i++) {
                    const rock = this.near[i]!
                    if (!rock.alive) continue
                    const pulse = 0.34 + 0.12 * Math.sin(e.time * 1.3 + rock.id)
                    e.particles.glow(rock.pos.x, rock.pos.y, rock.pos.z, _c.set(0x8dff3a).multiplyScalar(pulse), rock.radius * 2.6, 0.5)
                }
                for (; this.emitT > 0.04; this.emitT -= 0.04) {
                    e.particles.emit(cam.x + (Math.random() - 0.5) * 260, cam.y + (Math.random() - 0.5) * 140, cam.z + (Math.random() - 0.5) * 260, (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, MOTE)
                }
                // The burn shows on the hull for as long as the shield is down.
                if (p.alive && p.shield <= 0 && Math.random() < dt * 18) {
                    _v1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(p.radius * 2)
                    e.sparks.emit(p.pos.x + _v1.x, p.pos.y + _v1.y, p.pos.z + _v1.z, _v1.x * 6, _v1.y * 6 + 4, _v1.z * 6, 0.4, _c.set(0x9dff5e).multiplyScalar(3), 0.1)
                }
                break
            }
            case 'rich': {
                // Ore catches the light: the veins glitter from a long way off.
                for (; this.emitT > 0.025; this.emitT -= 0.025) {
                    const rock = this.near[Math.floor(Math.random() * this.near.length)]
                    if (!rock?.alive || !rock.ore) continue
                    _v1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(rock.radius * 0.95)
                    TWINKLE.size = 1.4 + rock.radius * 0.12
                    e.particles.emit(rock.pos.x + _v1.x, rock.pos.y + _v1.y, rock.pos.z + _v1.z, 0, 0, 0, TWINKLE)
                }
                break
            }
            case 'nebula': {
                // Fog banks roll past the canopy.
                for (; this.emitT > 0.2; this.emitT -= 0.2) {
                    _v1.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.5, Math.random() - 0.5).normalize()
                    // Mostly where the pilot is looking and heading, so a fast ship still flies through them.
                    if (_v1.dot(_v2.set(0, 0, -1).applyQuaternion(e.camera.quaternion)) < 0 && Math.random() < 0.7) _v1.negate()
                    _v1.multiplyScalar(130 + Math.random() * 200)
                    if (p.alive) _v1.addScaledVector(p.vel, 1.5)
                    BANK.color = BANK_COLORS[Math.floor(Math.random() * BANK_COLORS.length)]!
                    BANK.life = 6 + Math.random() * 4
                    e.smoke.emit(cam.x + _v1.x, cam.y + _v1.y, cam.z + _v1.z, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6, BANK)
                }
                break
            }
            case 'pirates': {
                // Somebody else's fight, far off: flak bursts on the horizon.
                for (; this.emitT > 0.5; this.emitT -= 0.5) {
                    if (Math.random() < 0.5) continue
                    _v1.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).normalize().multiplyScalar(700 + Math.random() * 500)
                    const bursts = 1 + Math.floor(Math.random() * 3)
                    for (let i = 0; i < bursts; i++) {
                        e.particles.emit(cam.x + _v1.x + (Math.random() - 0.5) * 80, cam.y + _v1.y + (Math.random() - 0.5) * 50, cam.z + _v1.z + (Math.random() - 0.5) * 80, 0, 0, 0, FLAK)
                    }
                }
                for (const b of this.buoys) {
                    if (Math.sin(e.time * 2.4 + b.x) > 0.6) e.particles.glow(b.x, b.y, b.z, _c.set(0xff3020).multiplyScalar(2.5), 26, 0.8)
                }
                break
            }
            case 'graveyard': {
                // Dead ships still spit the odd spark.
                for (; this.emitT > 0.35; this.emitT -= 0.35) {
                    const s = this.solids[Math.floor(Math.random() * this.solids.length)]
                    if (!s || s.pos.distanceToSquared(cam) > 900 * 900) continue
                    _v1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(s.radius * 0.9).add(s.pos)
                    for (let i = 0; i < 6; i++) {
                        e.sparks.emit(_v1.x, _v1.y, _v1.z, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, 0.5, _c.set(0xffc880).multiplyScalar(3), 0.12)
                    }
                    e.particles.glow(_v1.x, _v1.y, _v1.z, _c.set(0xffc880).multiplyScalar(2), 8, 0.8)
                }
                break
            }
            default:
                this.emitT = 0
        }
    }

    // ─── Ion storm ─────────────────────────────────────────────────────────

    private ion(dt: number) {
        const e = this.engine
        const p = e.player!
        // Sheet lightning in the clouds.
        this.flash = Math.max(0, this.flash - dt * 2.4)
        if (Math.random() < dt * 0.4) this.flash = 0.5 + Math.random() * 0.5
        e.sky?.setFlash(this.flash * (e.reduceFlashes ? 0.2 : 1))

        // Arcs jump between neighbouring rocks.
        this.arcT -= dt
        if (this.arcT <= 0 && this.near.length > 1) {
            this.arcT = 0.1 + Math.random() * 0.3
            const a = this.near[Math.floor(Math.random() * this.near.length)]!
            const b = this.neighbour(a, 190)
            if (a.alive && b) this.arc(a, b)
        }

        // Rock lightning: the rock nearest the pilot builds a charge, then lets go
        // at the closest ship inside its reach. Fly clear, or lead a raider into it.
        if (!this.strikeRock) {
            this.strikeCd -= dt
            if (this.strikeCd > 0 || !p.alive || e.phase !== 'flying') return
            let best: Asteroid | null = null
            let bestD = 150
            for (const rock of this.near) {
                const d = rock.pos.distanceTo(p.pos) - rock.radius
                if (rock.alive && d < bestD) {
                    bestD = d
                    best = rock
                }
            }
            this.strikeCd = best ? 0 : 1.5
            if (!best) return
            this.strikeRock = best
            this.strikeT = STRIKE_CHARGE
            e.audio.play('charge', { distance: bestD * 0.5, pan: e.panOf(best.pos), pitch: 1.5, volume: 0.9 })
            return
        }
        const rock = this.strikeRock
        this.strikeT -= dt
        if (!rock.alive) {
            this.strikeRock = null
            this.strikeCd = 4
            return
        }
        const k = 1 - Math.max(0, this.strikeT) / STRIKE_CHARGE
        e.particles.glow(rock.pos.x, rock.pos.y, rock.pos.z, _c.set(this.color).multiplyScalar(0.6 + k * 2.4), rock.radius * (2 + k * 1.6), 0.7)
        if (Math.random() < dt * (8 + k * 30)) {
            _v1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
            _v2.copy(_v1).multiplyScalar(rock.radius * (1.5 + Math.random())).add(rock.pos)
            _v1.multiplyScalar(rock.radius * 0.9).add(rock.pos)
            e.lightning(_v1, _v2, this.color)
        }
        if (this.strikeT > 0) return
        this.strikeRock = null
        this.strikeCd = 5 + randomFloat() * 5
        const reach = rock.radius + STRIKE_REACH
        let target: Enemy | null = null
        let targetD = p.alive && e.phase === 'flying' ? p.pos.distanceTo(rock.pos) : Infinity
        for (const en of e.enemies) {
            if (!en.alive || !en.hostile || en.kind === 'mine') continue
            const d = en.pos.distanceTo(rock.pos) - en.radius
            if (d < targetD) {
                targetD = d
                target = en
            }
        }
        const from = _v1.copy(rock.pos)
        const threat = e.config!.sector.threat
        if (targetD <= reach) {
            const at = target ? target.pos : p.pos
            from.addScaledVector(_v2.subVectors(at, rock.pos).normalize(), rock.radius * 0.9)
            e.lightning(from, at, this.color)
            if (target) damageEnemy(e, target, 90 * threat, target.pos, 'zone')
            else {
                e.damagePlayer(18 * threatDamageMult(threat), rock.pos, 'zone')
                e.trauma = Math.min(1, e.trauma + 0.35)
            }
        } else {
            const other = this.neighbour(rock, 260)
            if (other) this.arc(rock, other)
        }
        this.flash = 0.8
        // A thin shell at the edge of its reach: bright enough to read, never a whiteout.
        e.rings.spawn(rock.pos, reach, this.color, 0.5, 0.9, undefined, 0.035)
        e.flashes.flash(rock.pos, this.color, 35, 200)
        e.audio.play('tesla', { distance: rock.pos.distanceTo(e.camera.position) * 0.4, pan: e.panOf(rock.pos), volume: 1.4 })
    }

    private neighbour(a: Asteroid, range: number) {
        let best: Asteroid | null = null
        let bestD = range
        for (const b of this.near) {
            if (b === a || !b.alive) continue
            const d = b.pos.distanceTo(a.pos) - a.radius - b.radius
            if (d < bestD) {
                bestD = d
                best = b
            }
        }
        return best
    }

    private arc(a: Asteroid, b: Asteroid) {
        const dir = _v3.subVectors(b.pos, a.pos).normalize()
        const from = _v1.copy(a.pos).addScaledVector(dir, a.radius * 0.9)
        const to = _v2.copy(b.pos).addScaledVector(dir, -b.radius * 0.9)
        this.engine.lightning(from, to, this.color)
    }

    dispose() {
        for (const prop of this.props) disposeTree(prop)
        this.props = []
        this.solids = []
        this.buoys = []
        this.near = []
        this.strikeRock = null
        this.engine.sky?.setFlash(0)
    }
}

function randDir(flatten = 0.3) {
    return new THREE.Vector3(randomFloat() - 0.5, (randomFloat() - 0.5) * flatten, randomFloat() - 0.5).normalize()
}
