import * as THREE from 'three'
import { hackerzDeployable, hackerzDeployableStats, type HackerzDeployableId } from '#shared/utils/gamelogic/hackerz'
import { FIELD_SCALE } from './constants'
import { hdr } from './models'
import { fieldToWorld } from './scene'

/**
 * Field hardware the player drops mid-wave:
 *
 * - **Honeypot**: a fake core. Hostiles in its lure radius turn and attack it
 *   instead of the wall; when it is broken or its timer runs out it detonates
 *   on whoever it drew in.
 * - **Logic bomb**: arms after a beat, then blows when a ground hostile steps
 *   into it. Dropped on a node that is still ours or still contested it wires
 *   onto it: hackers no longer set it off, and it blows when the node falls.
 * - **Proxy wall**: a barrier across part of the lane. Ground walkers stop at it
 *   and have to break it; ranged units and flyers ignore it.
 *
 * This module owns the state and the look; the engine decides who is held and
 * applies the blasts it reports.
 */

export interface Deployed {
    kind: HackerzDeployableId
    u: number
    d: number
    hp: number
    maxHp: number
    /** Ms left before it expires (a honeypot detonates, a proxy wall fades). */
    lifeMs: number
    /** Ms until a logic bomb is live. */
    armMs: number
    halfWidth: number
    lureRadius: number
    triggerRadius: number
    blastRadius: number
    blastDamage: number
    hex: number
    group: THREE.Group
    edge: THREE.LineBasicMaterial
    glow: THREE.MeshBasicMaterial
    spin: THREE.Object3D | null
    /** Seconds since placed, for the drop-in. */
    age: number
    /** Seconds of hit flash left. */
    hit: number
    /**
     * The path node a logic bomb is wired onto, or null. A wired bomb lets the
     * hackers work the node unbothered and goes off when they take it.
     */
    chipId: number | null
}

/** A detonation for the engine to apply. */
export interface Blast {
    kind: HackerzDeployableId
    u: number
    d: number
    radius: number
    damage: number
    hex: number
}

/** Where an enemy has to stop, and what it is attacking when it gets there. */
export interface Hold {
    target: Deployed
    stopD: number
    /** A honeypot pulls its victims sideways toward it; null once they are close enough. */
    steerU: number | null
}

export interface DeployEvents {
    blasts: Blast[]
    broken: Deployed[]
}

const RING_SEGMENTS = 64
/** Lured units gather within this far either side of a honeypot, in field units. */
const LURE_BAND = 70
/** World height of a path node's package top, where a wired bomb sits. */
const CHIP_TOP = 0.34

function circle(radius: number) {
    const points: THREE.Vector3[] = []
    for (let s = 0; s <= RING_SEGMENTS; s++) {
        const a = s / RING_SEGMENTS * Math.PI * 2
        points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius))
    }
    return new THREE.BufferGeometry().setFromPoints(points)
}

export class Deployables {
    readonly group = new THREE.Group()
    items: Deployed[] = []
    private body = new THREE.MeshBasicMaterial({ color: 0x03060c })
    private ghost: THREE.Group | null = null
    private ghostKind: HackerzDeployableId | null = null
    private time = 0

    /** Drops one onto the field at a ground point. */
    place(kind: HackerzDeployableId, u: number, d: number, wave: number, chipId: number | null = null) {
        const stats = hackerzDeployableStats(wave)
        const def = hackerzDeployable(kind)
        const group = new THREE.Group()
        fieldToWorld(u, d, 0, group.position)
        const edge = new THREE.LineBasicMaterial({ color: hdr(def.hex, 1.6), toneMapped: false, transparent: true })
        const glow = new THREE.MeshBasicMaterial({ color: hdr(def.hex, 2), toneMapped: false, transparent: true })
        let spin: THREE.Object3D | null = null

        const item: Deployed = {
            kind,
            u,
            d,
            hp: 1,
            maxHp: 1,
            lifeMs: Infinity,
            armMs: 0,
            halfWidth: 0,
            lureRadius: 0,
            triggerRadius: 0,
            blastRadius: 0,
            blastDamage: 0,
            hex: def.hex,
            group,
            edge,
            glow,
            spin,
            age: 0,
            hit: 0,
            chipId: kind === 'bomb' ? chipId : null
        }
        // Wired onto a node, it sits on top of the node's package.
        if (item.chipId !== null) group.position.y += CHIP_TOP

        if (kind === 'honeypot') {
            const s = stats.honeypot
            Object.assign(item, { hp: s.hp, maxHp: s.hp, lifeMs: s.lifeMs, lureRadius: s.lureRadius, blastRadius: s.blastRadius, blastDamage: s.blastDamage })
            const shell = new THREE.CylinderGeometry(1.1, 1.3, 1.8, 6)
            const mesh = new THREE.Mesh(shell, this.body)
            mesh.position.y = 0.9
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(shell), edge))
            const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), glow)
            core.position.y = 2.4
            const halo = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.TorusGeometry(1.5, 0.05, 3, 6)), edge)
            halo.rotation.x = Math.PI / 2
            halo.position.y = 2.4
            spin = new THREE.Group()
            spin.add(core, halo)
            const lure = new THREE.Line(circle(s.lureRadius * FIELD_SCALE), new THREE.LineBasicMaterial({
                color: hdr(def.hex, 0.9), toneMapped: false, transparent: true, opacity: 0.35
            }))
            lure.position.y = 0.06
            group.add(mesh, spin, lure)
        } else if (kind === 'bomb') {
            const s = stats.bomb
            Object.assign(item, { armMs: s.armMs, triggerRadius: s.triggerRadius, blastRadius: s.blastRadius, blastDamage: s.damage })
            const disc = new THREE.CylinderGeometry(0.95, 1.05, 0.3, 8)
            const mesh = new THREE.Mesh(disc, this.body)
            mesh.position.y = 0.15
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(disc), edge))
            const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), glow)
            core.position.y = 0.6
            spin = core
            const trigger = new THREE.Line(circle(s.triggerRadius * FIELD_SCALE), new THREE.LineBasicMaterial({
                color: hdr(def.hex, 0.9), toneMapped: false, transparent: true, opacity: 0.45
            }))
            trigger.position.y = 0.06
            group.add(mesh, core, trigger)
        } else {
            const s = stats.proxy
            Object.assign(item, { hp: s.hp, maxHp: s.hp, lifeMs: s.lifeMs, halfWidth: s.halfWidth })
            const width = s.halfWidth * 2 * FIELD_SCALE
            const panel = new THREE.BoxGeometry(width, 2.4, 0.3)
            const fill = new THREE.Mesh(panel, new THREE.MeshBasicMaterial({
                color: hdr(def.hex, 0.6), toneMapped: false, transparent: true, opacity: 0.16, depthWrite: false
            }))
            fill.position.y = 1.2
            fill.add(new THREE.LineSegments(new THREE.EdgesGeometry(panel), edge))
            // Vertical struts every metre or so: reads as a fence, not a slab.
            const struts = Math.max(2, Math.round(width / 1.6))
            const strutGeometry = new THREE.BoxGeometry(0.12, 2.4, 0.12)
            for (let i = 0; i <= struts; i++) {
                const strut = new THREE.Mesh(strutGeometry, glow)
                strut.position.set(-width / 2 + i / struts * width, 1.2, 0)
                group.add(strut)
            }
            // A scan bar that rides up and down the panel.
            const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 0.32), glow)
            bar.position.y = 1.2
            spin = bar
            group.add(fill, bar)
        }
        item.spin = spin
        group.scale.setScalar(0.01)
        this.group.add(group)
        this.items.push(item)
        return item
    }

    /**
     * The deployable an enemy at (u, d) runs into first, if any. Ranged units
     * that stop further out than a barrier never reach it, and flyers pass
     * over proxy walls — but a honeypot draws in anything.
     */
    holdFor(u: number, d: number, standoff: number, airborne: boolean): Hold | null {
        let best: Hold | null = null
        for (const item of this.items) {
            if (item.hp <= 0) continue
            if (item.kind === 'honeypot') {
                const stopD = item.d + 30
                if (d < item.d - 10 || standoff >= stopD) continue
                if (Math.hypot(u - item.u, d - item.d) > item.lureRadius) continue
                // Pulled into a band either side of it, not onto one point: the
                // crowd spreads into a ring around the pot instead of stacking
                // inside its model.
                const offset = u - item.u
                const steerU = Math.abs(offset) > LURE_BAND ? item.u + Math.sign(offset) * LURE_BAND : null
                if (!best || stopD > best.stopD) best = { target: item, stopD, steerU }
            } else if (item.kind === 'proxy') {
                if (airborne) continue
                const stopD = item.d + 20
                if (d < item.d - 4 || standoff >= stopD) continue
                if (Math.abs(u - item.u) > item.halfWidth) continue
                if (!best || stopD > best.stopD) best = { target: item, stopD, steerU: null }
            }
        }
        return best
    }

    /** An enemy's blow lands on a deployable. */
    strike(target: Deployed, damage: number) {
        target.hp = Math.max(0, target.hp - damage)
        target.hit = 0.25
    }

    /**
     * Ages everything, fires bombs whose trigger a ground unit stepped into, and
     * retires what is spent. `ground` is every ground hostile's position.
     */
    update(dt: number, ground: { u: number, d: number, hacker: boolean }[]): DeployEvents {
        this.time += dt
        const events: DeployEvents = { blasts: [], broken: [] }
        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i]!
            item.age += dt
            item.hit = Math.max(0, item.hit - dt)
            item.lifeMs -= dt * 1000
            const drop = Math.min(1, item.age / 0.25)
            item.group.scale.set(1, drop, 1)
            item.group.scale.x = item.group.scale.z = 0.4 + drop * 0.6

            let spent = false
            if (item.kind === 'honeypot') {
                if (item.spin) {
                    item.spin.rotation.y += dt * 2.4
                    item.spin.position.y = Math.sin(this.time * 2) * 0.15
                }
                // It cracks as it is beaten on: brighter edges, a rising core glow.
                const damage = 1 - item.hp / item.maxHp
                item.glow.color.copy(hdr(item.hex, 1.6 + damage * 2.5 + item.hit * 6))
                if (item.hp <= 0 || item.lifeMs <= 0) {
                    events.blasts.push({ kind: 'honeypot', u: item.u, d: item.d, radius: item.blastRadius, damage: item.blastDamage, hex: item.hex })
                    spent = true
                }
            } else if (item.kind === 'bomb') {
                item.armMs -= dt * 1000
                const live = item.armMs <= 0
                if (item.spin) item.spin.rotation.y += dt * (live ? 3 : 0.8)
                // A slow breath once armed — never a blink.
                const breath = live ? 0.5 + 0.5 * Math.sin(this.time * 4) : 0
                item.glow.color.copy(hdr(item.hex, live ? 1.8 + breath * 1.4 : 0.7))
                // Wired onto a node, it lets the hackers work: they set it off
                // by taking the node (see `detonateOnChip`), not by walking up.
                const trips = ground.some(p => (item.chipId === null || !p.hacker)
                    && Math.hypot(p.u - item.u, p.d - item.d) <= item.triggerRadius)
                if (live && trips) {
                    events.blasts.push({ kind: 'bomb', u: item.u, d: item.d, radius: item.blastRadius, damage: item.blastDamage, hex: item.hex })
                    spent = true
                }
            } else {
                if (item.spin) item.spin.position.y = 1.2 + Math.sin(this.time * 1.6) * 1.05
                const integrity = item.hp / item.maxHp
                const fading = Math.min(1, item.lifeMs / 1500)
                item.edge.opacity = (0.35 + integrity * 0.65) * fading
                item.glow.color.copy(hdr(item.hex, 0.8 + integrity * 1.2 + item.hit * 5))
                item.glow.opacity = fading
                if (item.hp <= 0 || item.lifeMs <= 0) {
                    events.broken.push(item)
                    spent = true
                }
            }
            if (spent) {
                item.hp = 0
                this.dispose(item)
                this.items.splice(i, 1)
            }
        }
        return events
    }

    /** A node just fell: every bomb wired onto it goes off, armed or not. */
    detonateOnChip(chipId: number): Blast[] {
        const blasts: Blast[] = []
        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i]!
            if (item.kind !== 'bomb' || item.chipId !== chipId) continue
            blasts.push({ kind: 'bomb', u: item.u, d: item.d, radius: item.blastRadius, damage: item.blastDamage, hex: item.hex })
            item.hp = 0
            this.dispose(item)
            this.items.splice(i, 1)
        }
        return blasts
    }

    /** A placement preview under the cursor while one is armed. */
    setGhost(kind: HackerzDeployableId | null, u = 0, d = 0, wave = 1) {
        if (kind !== this.ghostKind) {
            this.ghost?.removeFromParent()
            this.ghost = null
            this.ghostKind = kind
            if (kind) this.ghost = this.buildGhost(kind, wave)
        }
        if (this.ghost) fieldToWorld(u, d, 0.08, this.ghost.position)
    }

    private buildGhost(kind: HackerzDeployableId, wave: number) {
        const stats = hackerzDeployableStats(wave)
        const def = hackerzDeployable(kind)
        const material = new THREE.LineBasicMaterial({ color: hdr(def.hex, 1.2), toneMapped: false, transparent: true, opacity: 0.6 })
        const group = new THREE.Group()
        if (kind === 'proxy') {
            const half = stats.proxy.halfWidth * FIELD_SCALE
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(-half, 0, -0.3), new THREE.Vector3(half, 0, -0.3),
                new THREE.Vector3(half, 0, 0.3), new THREE.Vector3(-half, 0, 0.3), new THREE.Vector3(-half, 0, -0.3)
            ]), material))
        } else {
            const radius = kind === 'honeypot' ? stats.honeypot.lureRadius : stats.bomb.blastRadius
            group.add(new THREE.Line(circle(radius * FIELD_SCALE), material))
            group.add(new THREE.Line(circle(1.2), material))
        }
        this.group.add(group)
        return group
    }

    clear() {
        for (const item of this.items) this.dispose(item)
        this.items = []
        this.setGhost(null)
    }

    private dispose(item: Deployed) {
        item.group.removeFromParent()
        const materials = new Set<THREE.Material>()
        item.group.traverse((node) => {
            const mesh = node as THREE.Mesh
            if (mesh.geometry) mesh.geometry.dispose()
            if (mesh.material && mesh.material !== this.body) materials.add(mesh.material as THREE.Material)
        })
        for (const material of materials) material.dispose()
    }
}
