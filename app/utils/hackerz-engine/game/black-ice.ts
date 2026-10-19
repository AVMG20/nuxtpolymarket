import * as THREE from 'three'
import { randomBetween, randomInt } from '../rng'
import { FIELD_HALF_WIDTH, FIELD_SCALE } from '../constants'
import { clamp } from '../math'
import { IceWall, disposeIceGlob, makeIceGlob } from '../ice-wall'
import { hdr } from '../models'
import { muzzleOf } from '../rig-motion'
import { fieldToWorld } from '../scene'
import type { EnemyEntity } from '../types'
import { PER_WORLD, _v, _w } from './tuning'
import { bodyPoint, placeEnemy } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/**
 * BLACK ICE: how often it spits, how its globs fall (field units/s²), and the
 * walls they build — how wide and tall at full growth, how much of a wall one
 * glob makes, the nearest to the fence one may stand, and how long it lasts
 * after its last glob.
 */
const BLACK_ICE_SPIT_MS = 2500
const BLACK_ICE_GRAVITY = 900
const BLACK_ICE_WALL_WIDTH = 150
const BLACK_ICE_WALL_HEIGHT = 130
const BLACK_ICE_DEPOSIT = 0.3
const BLACK_ICE_WALL_MIN_D = 140
const BLACK_ICE_WALL_LIFE_MS = 14_000

/**
 * The slab BLACK ICE throws at the rail: a third of the field wide, aimed at
 * where the gun stood. A gun clear of it by more than its own half width
 * when it lands is missed.
 */
const BLACK_ICE_RAIL_CHUNK = FIELD_HALF_WIDTH * 2 / 3
const RAIL_GUN_HALF = 24

/**
 * BLACK ICE: globs that freeze into walls slowing every round through
 * them, slabs thrown at the rail, and turrets frozen solid.
 */
export class BlackIce {
    constructor(private readonly game: HackerzGame) {}

    /** BLACK ICE's globs in flight (a field position and velocity; `left` seconds to landing), and the walls they have built. */
    private iceGlobs: { mesh: THREE.Mesh, u: number, d: number, y: number, vu: number, vd: number, vy: number, left: number, atRail: boolean, width: number }[] = []

    iceWalls: { u: number, d: number, wall: IceWall, ageMs: number }[] = []

    /**
     * BLACK ICE spits black ice: globs that land ahead of it and freeze into
     * walls that shield what is behind them, slowing every round through them,
     * and every third spit at your rail, where a hit lags the whole board.
     */
    private spitBlackIce(enemy: EnemyEntity, dtMs: number) {
        if (!this.game.running || this.game.purging || enemy.decoy) return
        enemy.broodMs -= dtMs
        if (enemy.broodMs > 0) return
        enemy.broodMs = BLACK_ICE_SPIT_MS
        enemy.burstLeft = (enemy.burstLeft + 1) % 3
        const atRail = enemy.burstLeft === 0 && !!this.game.rail.railRig
        placeEnemy(enemy)
        const mouth = muzzleOf(enemy.rig, new THREE.Vector3())
        const from = { u: mouth.x * PER_WORLD, d: -mouth.z * PER_WORLD, y: mouth.y * PER_WORLD }
        let to: { u: number, d: number, y: number }
        // At the rail it throws a slab a third of the field wide, at where the
        // gun stands now: a gun that can glide (the Longbore) can get out from under it.
        const width = atRail ? BLACK_ICE_RAIL_CHUNK : 0
        if (atRail) {
            const rail = this.game.rail.railRig!.root.position
            const u = clamp(this.game.rail.railU, -FIELD_HALF_WIDTH + width / 2, FIELD_HALF_WIDTH - width / 2)
            to = { u, d: -rail.z * PER_WORLD, y: (rail.y + 1) * PER_WORLD }
        } else {
            // Ahead of it, between it and the fence: where its wall will stand.
            to = { u: clamp(enemy.u + randomBetween(-70, 70), -FIELD_HALF_WIDTH + 60, FIELD_HALF_WIDTH - 60), d: Math.max(BLACK_ICE_WALL_MIN_D, enemy.d * randomBetween(0.45, 0.65)), y: 0 }
        }
        const flight = atRail ? 1.1 : 0.9
        const gravity = BLACK_ICE_GRAVITY
        const mesh = makeIceGlob(enemy.rig.height * (atRail ? 0.22 : 0.12))
        if (width) {
            // Stretched across the lane to the slab's full width.
            const box = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox!)
            mesh.scale.x = width * FIELD_SCALE / Math.max(0.01, box.max.x - box.min.x)
        }
        mesh.position.copy(mouth)
        this.game.fieldRoot.add(mesh)
        this.iceGlobs.push({
            mesh,
            ...from,
            vu: (to.u - from.u) / flight,
            vd: (to.d - from.d) / flight,
            vy: (to.y - from.y) / flight + 0.5 * gravity * flight,
            left: flight,
            atRail,
            width
        })
        this.game.transient?.flash(mouth, 0xa5b4fc, 0.9)
        this.game.particles.burst(mouth, 0xa5b4fc, 10, 6, { size: 0.24, life: 0.35 })
    }

    /** Black ice in flight, landing, and the walls it builds; called every frame. */
    updateIce(dt: number) {
        for (let i = this.iceGlobs.length - 1; i >= 0; i--) {
            const glob = this.iceGlobs[i]!
            glob.left -= dt
            glob.vy -= BLACK_ICE_GRAVITY * dt
            glob.u += glob.vu * dt
            glob.d += glob.vd * dt
            glob.y += glob.vy * dt
            fieldToWorld(glob.u, glob.d, glob.y * FIELD_SCALE, glob.mesh.position)
            // A slab tumbles end over end along its length; a glob spins every way.
            glob.mesh.rotation.x += dt * 4
            if (!glob.width) glob.mesh.rotation.y += dt * 3
            if (Math.random() < dt * 30) this.game.particles.emit(glob.mesh.position, _w.set(0, 0.3, 0), 0xa5b4fc, { size: 0.18, life: 0.35, gravity: 0 })
            if (glob.left > 0) continue
            const at = glob.mesh.position.clone()
            disposeIceGlob(glob.mesh)
            this.iceGlobs.splice(i, 1)
            this.game.particles.burst(at, 0xa5b4fc, 18, 7, { size: 0.26, life: 0.5 })
            if (glob.atRail) {
                // It shatters along its whole length on the rail.
                for (let k = -2; k <= 2; k++) {
                    const shard = fieldToWorld(glob.u + k * glob.width / 5, glob.d, at.y, new THREE.Vector3())
                    this.game.particles.burst(shard, 0xa5b4fc, 10, 6, { size: 0.24, life: 0.45 })
                }
                // Clear of the gun: it smashes on the rail and does nothing.
                if (Math.abs(this.game.rail.railU - glob.u) > glob.width / 2 + RAIL_GUN_HALF) {
                    this.game.addShake(2)
                    continue
                }
                // On the gun: the frame freezes, as in PACKET LOSS.
                this.game.transient?.ring(at, 0xa5b4fc, 3, 0.4)
                this.game.view?.flash(0xa5b4fc, 0.12)
                this.game.lag.lagSpike()
                continue
            }
            this.depositIce(glob.u, glob.d)
        }
        for (let i = this.iceWalls.length - 1; i >= 0; i--) {
            const wall = this.iceWalls[i]!
            wall.ageMs += dt * 1000
            if (wall.ageMs > BLACK_ICE_WALL_LIFE_MS) wall.wall.thaw()
            wall.wall.update(dt)
            if (!wall.wall.gone) continue
            wall.wall.dispose()
            this.iceWalls.splice(i, 1)
        }
    }

    /** A glob lands: it freezes onto the wall here, or starts a new one. */
    private depositIce(u: number, d: number) {
        let wall = this.iceWalls.find(w => Math.abs(w.u - u) < BLACK_ICE_WALL_WIDTH * 0.6 && Math.abs(w.d - d) < 60)
        if (!wall) {
            const iceWall = new IceWall(this.game.fieldRoot, fieldToWorld(u, d, 0, new THREE.Vector3()),
                BLACK_ICE_WALL_WIDTH * FIELD_SCALE, BLACK_ICE_WALL_HEIGHT * FIELD_SCALE)
            wall = { u, d, wall: iceWall, ageMs: 0 }
            this.iceWalls.push(wall)
        }
        wall.ageMs = 0
        wall.wall.deposit(BLACK_ICE_DEPOSIT)
        this.game.transient?.ring(fieldToWorld(u, d, 0.1, _v), 0xa5b4fc, 2.4, 0.35)
    }

    /** True when a round crossing from (u0, d0) to (u1, d1) passes through a wall of black ice. */
    throughIce(u0: number, d0: number, u1: number, d1: number) {
        for (const wall of this.iceWalls) {
            if (wall.wall.fill < 0.2) continue
            const half = BLACK_ICE_WALL_WIDTH * 0.5 * Math.min(1, 0.4 + wall.wall.fill)
            if (Math.min(u0, u1) > wall.u + half || Math.max(u0, u1) < wall.u - half) continue
            if (Math.min(d0, d1) > wall.d + 8 || Math.max(d0, d1) < wall.d - 8) continue
            return wall
        }
        return null
    }

    clearIce() {
        for (const glob of this.iceGlobs) disposeIceGlob(glob.mesh)
        this.iceGlobs = []
        for (const wall of this.iceWalls) wall.wall.dispose()
        this.iceWalls = []
    }

    /** BLACK ICE freezes one of your turrets at a time; a click on it thaws it. */
    updateBlackIce(enemy: EnemyEntity, dtMs: number) {
        this.spitBlackIce(enemy, dtMs)
        enemy.bossTimer -= dtMs
        if (enemy.bossTimer > 0) return
        enemy.bossTimer = 7000
        const warm = this.game.battery.turrets.filter(m => m.frozenMs <= 0)
        if (!warm.length) return
        const mount = warm[randomInt(0, warm.length - 1)]!
        mount.frozenMs = 12_000
        if (!mount.ice) {
            mount.ice = new THREE.Mesh(
                new THREE.OctahedronGeometry(1.05, 0),
                new THREE.MeshBasicMaterial({ color: hdr(0xbfe9ff, 1.2), transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false })
            )
            mount.ice.scale.set(1, 1.3, 1)
            mount.ice.position.y = 0.9
            mount.rig.root.add(mount.ice)
        }
        mount.ice.visible = true
        const from = bodyPoint(enemy, 0.7, new THREE.Vector3())
        const to = mount.rig.root.position.clone().add(_w.set(0, 1, 0))
        this.game.transient?.bolt(from, to, 0xbfe9ff)
        this.game.transient?.beam(from, to, 0xbfe9ff, 0.35)
        this.game.particles.burst(to, 0xbfe9ff, 24, 6, { size: 0.26, life: 0.6 })
        this.game.callbacks.onNotice('BLACK ICE froze a turret — click it to thaw.', 'bad')
    }
}
