// Void Runner — ship systems in flight: secondary weapons (E), devices (G),
// the scan pulse (T) with its points of interest and lore logs, subsystem
// damage, and the decoy, cloak and time-dilation effects enemies respond to.

import * as THREE from 'three'
import { randomFloat } from '#shared/utils/random'
import { voidShip } from '#shared/utils/gamelogic/void'
import { VOID_DEVICES, VOID_SECONDARIES, type VoidWeaponFit } from '#shared/utils/gamelogic/void-items'
import { VOID_LORE, voidLoreForSector } from '#shared/utils/gamelogic/void-pilot'
import { damageEnemy, spawnEnemy } from './enemies'
import { explosion } from './fx'
import { buildBeacon, buildShip } from './ships'
import { disposeTree, type VoidEngine } from './engine'
import type { Enemy } from './types'

const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _c1 = new THREE.Color()
const FORWARD = new THREE.Vector3(0, 0, -1)

export type Subsystem = 'engines' | 'weapons' | 'shields'

/** What enemy AI aims at: the player, or a decoy standing in for them. */
export interface AiTarget {
    pos: THREE.Vector3
    vel: THREE.Vector3
    radius: number
    quat: THREE.Quaternion
    isPlayer: boolean
}

interface Poi {
    kind: 'log' | 'cache'
    pos: THREE.Vector3
    group: THREE.Object3D | null
    loreId: string | null
    enemy: Enemy | null
    revealed: number
    progress: number
    done: boolean
}

interface Mine {
    pos: THREE.Vector3
    arm: number
    life: number
    damage: number
    splash: number
}

interface Sentry {
    group: THREE.Group
    pos: THREE.Vector3
    life: number
    cooldown: number
    damage: number
}

export interface SystemsHud {
    subsystems: { id: Subsystem, left: number }[]
    secondary: null | { name: string, ammo: number, max: number, lock: number, locked: boolean, ready: number }
    device: null | { name: string, ready: number, active: boolean }
    scan: number
    fuel: number
    depth: number
    zone: string
    cloaked: boolean
    dilated: boolean
}

export class ShipSystems {
    disabled: Record<Subsystem, number> = { engines: 0, weapons: 0, shields: 0 }
    // Secondary
    private secondary: VoidWeaponFit | null
    private ammo = 0
    private maxAmmo = 0
    private reload = 0
    private secondaryHeld = false
    private lockT = 0
    private lockTarget: Enemy | null = null
    private mines: Mine[] = []
    // Device
    private device: VoidWeaponFit | null
    private deviceCd = 0
    private deviceCdMax = 1
    private boostT = 0
    private decoyT = 0
    private decoyTarget: AiTarget | null = null
    private decoyGroup: THREE.Group | null = null
    cloakT = 0
    dilateT = 0
    private sentries: Sentry[] = []
    // Scanner
    private scanCd = 2
    private scanCdMax = 10
    private scanRange = 900
    pois: Poi[] = []
    loreFound = new Set<string>()
    carrierHint: { pos: THREE.Vector3, life: number } | null = null
    carrierKilled = false

    constructor(private engine: VoidEngine) {
        const cfg = engine.config!
        this.secondary = cfg.secondary ?? null
        this.device = cfg.device ?? null
        if (this.secondary) {
            const def = VOID_SECONDARIES[this.secondary.type]!
            this.maxAmmo = this.ammo = Math.round(def.ammo * this.secondary.extra)
        }
        if (this.device) this.deviceCdMax = VOID_DEVICES[this.device.type]!.cooldown * this.device.cycle
        const deep = (cfg.perks?.scanner ?? 0) > 0
        this.scanCdMax = deep ? 7 : 10
        this.scanRange = deep ? 1350 : 900
    }

    private get p() {
        return this.engine.player!
    }

    private get stats() {
        return this.engine.config!.stats
    }

    // ─── Queries used by the engine and enemy AI ───────────────────────────

    get weaponRate() {
        return this.disabled.weapons > 0 ? 0.5 : 1
    }

    get speedMult() {
        return this.disabled.engines > 0 ? 0.55 : 1
    }

    get shieldRegenMult() {
        return this.disabled.shields > 0 ? 0 : 1
    }

    /** Enemy clock multiplier while the Time Dilator runs. */
    get enemyTimeScale() {
        return this.dilateT > 0 ? 0.4 : 1
    }

    /**
     * Who an enemy should chase: null while cloaked, the decoy while it stands
     * and the enemy is near it, otherwise the player.
     */
    targetFor(e: Enemy, player: AiTarget): AiTarget | null {
        // Bosses see through cloaks and decoys.
        if (e.kind === 'warden' || e.kind === 'mothership' || e.kind === 'battery') return player
        if (this.cloakT > 0) return null
        if (this.decoyT > 0 && this.decoyTarget && e.pos.distanceTo(this.decoyTarget.pos) < 520) return this.decoyTarget
        return player
    }

    // ─── Subsystems ────────────────────────────────────────────────────────

    /** A heavy hull hit can knock a subsystem offline for a few seconds. */
    onHullHit(amount: number) {
        if (amount < this.stats.hull * 0.06 || randomFloat() > 0.35) return
        const options = (['engines', 'weapons', 'shields'] as Subsystem[]).filter(s => this.disabled[s] <= 0)
        if (!options.length) return
        const pick = options[Math.floor(randomFloat() * options.length)]!
        this.disabled[pick] = pick === 'engines' ? 4 : pick === 'weapons' ? 3 : 5
        const label = pick === 'engines' ? 'Engines damaged' : pick === 'weapons' ? 'Weapons control damaged' : 'Shield emitter damaged'
        this.engine.events.toast(label, 'bad')
        this.engine.audio.play('warning', { volume: 0.7, pitch: 0.8 })
    }

    get subsystemsDown() {
        return this.disabled.engines > 0 || this.disabled.weapons > 0 || this.disabled.shields > 0
    }

    repairSubsystems() {
        this.disabled = { engines: 0, weapons: 0, shields: 0 }
    }

    breakCloak() {
        if (this.cloakT > 0) {
            this.cloakT = 0
            this.p.root.visible = !this.engine.cockpit
            this.engine.audio.play('blink', { pitch: 1.4, volume: 0.6 })
        }
    }

    // ─── Input ─────────────────────────────────────────────────────────────

    secondaryDown() {
        this.secondaryHeld = true
        if (!this.secondary) return
        const def = VOID_SECONDARIES[this.secondary.type]!
        if (!def.lock) this.fireSecondary(null)
    }

    secondaryUp() {
        if (!this.secondaryHeld) return
        this.secondaryHeld = false
        if (!this.secondary || !this.p.alive) return
        const def = VOID_SECONDARIES[this.secondary.type]!
        if (def.lock) {
            // Seekers still fire unguided without a lock; torpedoes need one.
            if (this.lockTarget?.alive || def.id === 'seekers') this.fireSecondary(this.lockTarget?.alive ? this.lockTarget : null)
            else if (this.lockT > 0) this.engine.audio.play('uiError', { volume: 0.4 })
        }
        this.lockT = 0
        this.lockTarget = null
    }

    useDevice() {
        const e = this.engine
        const p = this.p
        if (!this.device || !p.alive) return
        const def = VOID_DEVICES[this.device.type]!
        if (this.deviceCd > 0 || p.energy < def.energy) {
            e.audio.play('uiError', { volume: 0.5 })
            return
        }
        p.energy -= def.energy
        this.deviceCd = this.deviceCdMax
        e.objectives?.onDevice()
        const duration = def.duration * this.device.extra
        const size = voidShip(e.config!.shipId).size
        switch (def.id) {
            case 'booster':
                this.boostT = duration
                p.shieldBubble.setColor(0x6fd8ff, 2.4)
                e.rings.spawn(p.pos, size * 2.4, 0x6fd8ff, 0.5, 3)
                e.audio.play('shieldHit', { pitch: 0.6, volume: 1.1 })
                break
            case 'decoy': {
                this.decoyT = duration
                const model = buildShip(e.config!.shipId)
                const holo = new THREE.MeshBasicMaterial({ color: 0x9fffd9, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
                model.group.traverse((o) => {
                    const m = o as THREE.Mesh
                    if (m.isMesh) m.material = holo
                })
                const group = new THREE.Group()
                group.add(model.group)
                group.position.copy(p.pos).addScaledVector(_v1.copy(FORWARD).applyQuaternion(p.quat), -size * 3)
                group.quaternion.copy(p.quat)
                e.scene.add(group)
                this.decoyGroup = group
                this.decoyTarget = { pos: group.position, vel: new THREE.Vector3(), radius: p.radius, quat: group.quaternion, isPlayer: false }
                e.rings.spawn(group.position, size * 2, 0x9fffd9, 0.5, 2.5)
                e.audio.play('blink', { pitch: 1.3 })
                break
            }
            case 'sentry': {
                const group = new THREE.Group()
                const beacon = buildBeacon(0xffd35e)
                beacon.group.scale.setScalar(0.5)
                group.add(beacon.group)
                group.position.copy(p.pos).add(_v1.set(0, size, 0))
                e.scene.add(group)
                this.sentries.push({ group, pos: group.position, life: duration, cooldown: 0.3, damage: 6 * this.device.power })
                e.rings.spawn(group.position, 10, 0xffd35e, 0.5, 2.5)
                e.audio.play('undock', { pitch: 1.5, volume: 0.6 })
                break
            }
            case 'cloak':
                this.cloakT = duration
                for (const en of e.enemies) if (en.hostile && en.kind !== 'warden') en.aggro = false
                e.rings.spawn(p.pos, size * 3, 0xc49bff, 0.6, 2)
                e.audio.play('blink', { pitch: 0.7, volume: 1 })
                break
            case 'dilator':
                this.dilateT = duration
                e.rings.spawn(p.pos, 260, 0x7fd4ff, 1, 2.5)
                e.flashes.flash(p.pos, 0x7fd4ff, 80, 260)
                e.audio.play('charge', { pitch: 0.4, volume: 1.2 })
                break
        }
    }

    scan() {
        const e = this.engine
        const p = this.p
        if (!p.alive || this.scanCd > 0 || p.energy < 0.15) {
            e.audio.play('uiError', { volume: 0.4 })
            return
        }
        p.energy -= 0.15
        this.scanCd = this.scanCdMax
        e.objectives?.onScan()
        const range = this.scanRange * (e.zone === 'nebula' ? 0.5 : 1)
        e.rings.spawn(p.pos, range * 0.25, 0x5ec8ff, 1.2, 1.2, undefined, 0.03)
        e.rings.spawn(p.pos, range * 0.12, 0x9fe8ff, 0.8, 2)
        e.audio.play('blink', { pitch: 0.5, volume: 0.8 })
        let found = 0
        for (const poi of this.pois) {
            if (poi.done || poi.pos.distanceTo(p.pos) > range) continue
            if (poi.revealed <= 0) found++
            poi.revealed = 45
            if (poi.enemy) poi.enemy.group.visible = true
        }
        // Ore veins nearby flash so they are easy to spot.
        e.asteroids?.query(p.pos, Math.min(range, 600), (rock) => {
            if (rock.ore) e.particles.glow(rock.pos.x, rock.pos.y, rock.pos.z, _c1.set(0x9fe8ff).multiplyScalar(2), rock.radius * 2.2, 0.7)
        })
        const carrier = e.enemies.find(en => en.alive && en.kind === 'mothership')
        let msg = found ? `Scan: ${found} signal${found === 1 ? '' : 's'} marked` : 'Scan: nothing new in range'
        if (carrier && !carrier.data.seen && carrier.pos.distanceTo(p.pos) < range * 2.8) {
            // A vague bearing only: the carrier is found by looking.
            this.carrierHint = { pos: carrier.pos.clone().add(_v1.set(randomFloat() - 0.5, 0, randomFloat() - 0.5).multiplyScalar(500)), life: 10 }
            msg = 'Scan: a massive signature, somewhere out there'
        }
        e.events.toast(msg, carrier && this.carrierHint?.life === 10 ? 'warn' : 'info')
    }

    // ─── Sector setup ──────────────────────────────────────────────────────

    /** Places data logs and hidden caches for a freshly generated zone. */
    seedZone(graveyard: boolean) {
        const e = this.engine
        this.disposePois()
        const tier = e.config!.sector.tier
        const known = new Set([...(e.config!.loreKnown ?? []), ...this.loreFound])
        const lore = voidLoreForSector(tier).filter(id => !known.has(id))
        const logs = Math.min(lore.length, graveyard ? 2 : 1)
        for (let i = 0; i < logs; i++) {
            const pos = this.randomSpot(500, 2200)
            const beacon = buildBeacon(0xc9b38a)
            beacon.group.scale.setScalar(0.9)
            beacon.group.position.copy(pos)
            e.scene.add(beacon.group)
            const pick = lore.splice(Math.floor(randomFloat() * lore.length), 1)[0]!
            this.pois.push({ kind: 'log', pos, group: beacon.group, loreId: pick, enemy: null, revealed: 0, progress: 0, done: false })
        }
        const caches = graveyard ? 8 : 4
        for (let i = 0; i < caches; i++) {
            const pos = this.randomSpot(400, 2300)
            const crate = spawnEnemy(e, 'crate', pos, {})
            crate.data.cache = 1
            crate.maxHp = crate.hp = crate.hp * 1.5
            crate.group.visible = false
            this.pois.push({ kind: 'cache', pos: crate.pos, group: null, loreId: null, enemy: crate, revealed: 0, progress: 0, done: false })
        }
    }

    private randomSpot(min: number, max: number) {
        const a = randomFloat() * Math.PI * 2
        const d = min + randomFloat() * (max - min)
        return new THREE.Vector3(Math.cos(a) * d, (randomFloat() - 0.5) * 160, Math.sin(a) * d)
    }

    // ─── Frame update ──────────────────────────────────────────────────────

    update(dt: number) {
        const e = this.engine
        const p = e.player
        if (!p) return
        for (const k of Object.keys(this.disabled) as Subsystem[]) this.disabled[k] = Math.max(0, this.disabled[k] - dt)
        this.scanCd = Math.max(0, this.scanCd - dt)
        this.deviceCd = Math.max(0, this.deviceCd - dt)
        this.reload = Math.max(0, this.reload - dt)
        if (this.carrierHint && (this.carrierHint.life -= dt) <= 0) this.carrierHint = null

        this.updateLock(dt)
        this.updateMines(dt)
        this.updateSentries(dt)
        this.updatePois(dt)

        if (this.boostT > 0) {
            this.boostT -= dt
            const cap = Math.max(this.stats.shield, e.skills?.shieldCap ?? 0)
            const rate = this.stats.shield * Math.min(0.8, 0.3 + (this.device?.power ?? 1) * 0.05) / Math.max(0.5, VOID_DEVICES.booster!.duration)
            p.shield = Math.min(cap, p.shield + rate * dt)
            p.shieldDelay = 0
            if (this.boostT <= 0) p.shieldBubble.setColor(0x6fd8ff, 1.6)
        }
        if (this.decoyT > 0) {
            this.decoyT -= dt
            if (this.decoyGroup) {
                this.decoyGroup.rotation.z = Math.sin(e.time * 3) * 0.1
                if (Math.random() < dt * 12) e.particles.glow(this.decoyGroup.position.x, this.decoyGroup.position.y, this.decoyGroup.position.z, _c1.set(0x9fffd9).multiplyScalar(1.5), p.radius * 3, 0.5)
            }
            if (this.decoyT <= 0) this.removeDecoy()
        }
        if (this.cloakT > 0) {
            this.cloakT -= dt
            // A shimmer rather than invisibility so the pilot can still fly.
            p.root.visible = !e.cockpit && Math.sin(e.time * 40) > 0.6
            if (this.cloakT <= 0) this.breakCloak()
        }
        if (this.dilateT > 0) {
            this.dilateT -= dt
            if (Math.random() < dt * 10) e.rings.spawn(p.pos, 60 + Math.random() * 120, 0x7fd4ff, 0.8, 0.8, undefined, 0.02)
        }
    }

    private updateLock(dt: number) {
        if (!this.secondary || !this.secondaryHeld) return
        const def = VOID_SECONDARIES[this.secondary.type]!
        if (!def.lock || this.ammo <= 0 || this.reload > 0) return
        const focus = this.engine.focus
        if (!focus?.alive || !focus.hostile || focus.pos.distanceTo(this.p.pos) > 650) {
            this.lockT = 0
            this.lockTarget = null
            return
        }
        if (this.lockTarget && this.lockTarget !== focus) this.lockT = 0
        const need = def.id === 'torpedo' ? 1.2 : 0.7
        const before = this.lockT
        this.lockT = Math.min(need, this.lockT + dt)
        if (this.lockT >= need && before < need) {
            this.lockTarget = focus
            this.engine.audio.play('ui', { pitch: 2, volume: 0.8 })
        } else if (Math.floor(this.lockT * 8) !== Math.floor(before * 8)) {
            this.engine.audio.play('ui', { pitch: 1.2 + this.lockT, volume: 0.25 })
        }
    }

    get lockProgress() {
        if (!this.secondary) return 0
        const need = this.secondary.type === 'torpedo' ? 1.2 : 0.7
        return this.lockT / need
    }

    get lockedTarget() {
        return this.lockTarget?.alive ? this.lockTarget : null
    }

    private fireSecondary(target: Enemy | null) {
        const e = this.engine
        const p = this.p
        const fit = this.secondary!
        const def = VOID_SECONDARIES[fit.type]!
        if (this.ammo <= 0 || this.reload > 0) {
            e.audio.play('uiError', { volume: 0.4 })
            return
        }
        this.breakCloak()
        this.ammo--
        e.objectives?.onSecondary()
        this.reload = def.reload * fit.cycle / this.weaponRate
        const damage = def.damage * fit.power
        const size = voidShip(e.config!.shipId).size
        const fwd = _v1.copy(FORWARD).applyQuaternion(e.aimQuat).normalize()
        if (def.id === 'mines') {
            const pos = p.pos.clone().addScaledVector(_v2.copy(FORWARD).applyQuaternion(p.quat), -size * 1.4)
            this.mines.push({ pos, arm: 0.8, life: 40, damage, splash: def.splash })
            e.audio.play('mineArm', { volume: 0.8 })
            return
        }
        for (let i = 0; i < def.volley; i++) {
            const spread = def.id === 'rockets' ? 0.06 : 0.35
            const dir = fwd.clone().add(_v2.set(randomFloat() - 0.5, randomFloat() - 0.5, randomFloat() - 0.5).multiplyScalar(spread)).normalize()
            const side = i % 2 ? 1 : -1
            const start = p.pos.clone().add(_v2.set(side * size * 0.35, -size * 0.1, 0).applyQuaternion(p.quat))
            e.projectiles.push({
                pos: start,
                vel: dir.multiplyScalar(def.speed).add(p.vel),
                life: def.id === 'torpedo' ? 9 : 4,
                damage,
                hostile: false,
                color: new THREE.Color(def.id === 'torpedo' ? 0xff4fa8 : def.id === 'rockets' ? 0xffa23d : 0xff6b4f).multiplyScalar(3),
                width: def.id === 'torpedo' ? 1.4 : 0.45,
                length: def.id === 'torpedo' ? 4 : 2,
                splash: def.splash,
                homing: target,
                kind: 'missile',
                mining: 1,
                source: 'secondary',
                turn: def.id === 'torpedo' ? 0.35 : def.id === 'rockets' ? 0 : 1,
                dtype: 'explosive'
            })
        }
        e.audio.play('missile', { volume: def.id === 'torpedo' ? 1.6 : 1.2, pitch: def.id === 'torpedo' ? 0.5 : 1.1 })
        e.trauma = Math.min(1, e.trauma + (def.id === 'torpedo' ? 0.25 : 0.08))
    }

    private updateMines(dt: number) {
        const e = this.engine
        this.mines = this.mines.filter((m) => {
            m.life -= dt
            m.arm -= dt
            const blink = m.arm > 0 ? Math.sin(e.time * 10) > 0 : Math.sin(e.time * 4) > 0.5
            e.particles.glow(m.pos.x, m.pos.y, m.pos.z, _c1.set(0xffd23f).multiplyScalar(blink ? 3 : 1), 3)
            if (m.arm > 0) return m.life > 0
            let trip = false
            for (const en of e.enemies) {
                if (en.alive && en.hostile && en.kind !== 'mine' && en.pos.distanceTo(m.pos) < 14 + en.radius) {
                    trip = true
                    break
                }
            }
            if (!trip && m.life > 0) return true
            explosion(e.fx, m.pos, _v1.set(0, 0, 0), 1.8, 0xffd23f)
            e.audio.play('explosionSmall', { distance: m.pos.distanceTo(e.camera.position), pan: e.panOf(m.pos) })
            if (trip) {
                for (const en of e.enemies) {
                    if (!en.alive || !en.hostile) continue
                    const d = en.pos.distanceTo(m.pos)
                    if (d < m.splash + en.radius) damageEnemy(e, en, m.damage * (1 - 0.4 * d / (m.splash + en.radius)), en.pos, 'secondary', { dtype: 'explosive' })
                }
            }
            return false
        })
    }

    private updateSentries(dt: number) {
        const e = this.engine
        this.sentries = this.sentries.filter((s) => {
            s.life -= dt
            s.group.rotation.y += dt * 2
            if (s.life <= 0) {
                explosion(e.fx, s.pos, _v1.set(0, 0, 0), 0.8, 0xffd35e, false)
                disposeTree(s.group)
                return false
            }
            s.cooldown -= dt
            if (s.cooldown <= 0) {
                const target = e.nearestHostile(s.pos, 240)
                if (target) {
                    s.cooldown = 0.33
                    const dir = _v1.subVectors(target.pos, s.pos).addScaledVector(target.vel, s.pos.distanceTo(target.pos) / 420).normalize()
                    e.projectiles.push({
                        pos: s.pos.clone(), vel: dir.multiplyScalar(420), life: 0.8, damage: s.damage, hostile: false,
                        color: new THREE.Color(0xffd35e).multiplyScalar(3), width: 0.22, length: 4, splash: 0, homing: null, kind: 'bolt', mining: 1, source: 'sentry', dtype: 'kinetic'
                    })
                    if (Math.random() < 0.4) e.audio.play('gatling', { distance: s.pos.distanceTo(e.camera.position) * 0.5, volume: 0.35 })
                }
            }
            return true
        })
    }

    private updatePois(dt: number) {
        const e = this.engine
        const p = this.p
        for (const poi of this.pois) {
            if (poi.done) continue
            poi.revealed = Math.max(0, poi.revealed - dt)
            if (poi.kind === 'cache') {
                if (!poi.enemy?.alive) poi.done = true
                continue
            }
            // Data logs download while you hover close to them.
            if (p.alive && poi.pos.distanceTo(p.pos) < 40) {
                poi.progress += dt
                if (Math.random() < dt * 20) e.lines.pushV(poi.pos, p.pos, _c1.set(0xc9b38a).multiplyScalar(2), 0.6, 0.2, 0.1)
                if (poi.progress >= 2) {
                    poi.done = true
                    const entry = VOID_LORE.find(l => l.id === poi.loreId)
                    if (entry) {
                        this.loreFound.add(entry.id)
                        e.objectives?.onLog()
                        e.events.banner('Data log recovered', entry.title, 'info')
                        e.audio.play('levelUp', { volume: 0.5, pitch: 1.3 })
                    }
                    if (poi.group) disposeTree(poi.group)
                }
            } else {
                poi.progress = Math.max(0, poi.progress - dt)
            }
        }
    }

    /** Markers the overlay shows: revealed signals and the carrier hint. */
    markers() {
        const out: { pos: THREE.Vector3, label: string, color: string }[] = []
        for (const poi of this.pois) {
            if (poi.done || poi.revealed <= 0) continue
            out.push({ pos: poi.pos, label: poi.kind === 'log' ? 'DATA LOG' : 'CACHE', color: poi.kind === 'log' ? '#e0cc9a' : '#ffb45e' })
        }
        if (this.carrierHint) out.push({ pos: this.carrierHint.pos, label: '???', color: '#ff6b6b' })
        return out
    }

    hud(): SystemsHud {
        const e = this.engine
        const sec = this.secondary
        const dev = this.device
        return {
            subsystems: (Object.keys(this.disabled) as Subsystem[]).filter(k => this.disabled[k] > 0).map(id => ({ id, left: this.disabled[id] })),
            secondary: sec
                ? {
                        name: e.itemName(sec.type),
                        ammo: this.ammo,
                        max: this.maxAmmo,
                        lock: Math.min(1, this.lockProgress),
                        locked: !!this.lockedTarget,
                        ready: this.reload > 0 ? Math.max(0, 1 - this.reload * this.weaponRate / (VOID_SECONDARIES[sec.type]!.reload * sec.cycle)) : 1
                    }
                : null,
            device: dev ? { name: e.itemName(dev.type), ready: this.deviceCd > 0 ? 1 - this.deviceCd / this.deviceCdMax : 1, active: this.boostT > 0 || this.decoyT > 0 || this.cloakT > 0 || this.dilateT > 0 || this.sentries.length > 0 } : null,
            scan: this.scanCd > 0 ? 1 - this.scanCd / this.scanCdMax : 1,
            fuel: e.fuel,
            depth: e.depth,
            zone: e.zoneName,
            cloaked: this.cloakT > 0,
            dilated: this.dilateT > 0
        }
    }

    private removeDecoy() {
        if (this.decoyGroup) {
            explosion(this.engine.fx, this.decoyGroup.position, _v1.set(0, 0, 0), 0.8, 0x9fffd9, false)
            disposeTree(this.decoyGroup)
        }
        this.decoyGroup = null
        this.decoyTarget = null
        this.decoyT = 0
    }

    private disposePois() {
        for (const poi of this.pois) if (poi.group) disposeTree(poi.group)
        this.pois = []
    }

    /** Clears zone-bound objects before a jump; keeps ammo, cooldowns and lore. */
    clearZone() {
        this.disposePois()
        this.mines = []
        for (const s of this.sentries) disposeTree(s.group)
        this.sentries = []
        this.removeDecoy()
        this.carrierHint = null
        this.lockTarget = null
        this.lockT = 0
    }

    dispose() {
        this.clearZone()
    }
}
