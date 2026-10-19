import * as THREE from 'three'
import { randomFloat } from './rng'
import { FIELD_HALF_WIDTH, FIELD_SCALE } from './constants'
import { emblemTextures } from './lane-props'
import { hdr } from './models'

/**
 * Hackable nodes on the lane itself, and what the territory is fought over.
 *
 * The intrusion takes them in order, outermost first: hackers converge on the
 * next node in their path, park in a row behind it, and hack it with pulses
 * from their terminals — the more of them, the faster it falls. A node only raises the
 * alarm when the first pulse lands. A hacked node turns into a red skull,
 * buffs every hostile near it, and pushes their ground up to it. Shooting a
 * hacked node reclaims it in a few hits, which pays credits and turns it into
 * the firewall's own — each one the player holds speeds up the rail.
 *
 * Positions decide gameplay, so they roll through `./rng` (the secure RNG, or
 * the seeded one on a Database demo board).
 */

export type ChipState = 'neutral' | 'hacked' | 'ours'

/** Hostiles this close to a hacked node are buffed by it. */
export const CHIP_AURA_RADIUS = 170
/** A player round passing this close to a hacked node counts as a hit on it. */
export const CHIP_HIT_RADIUS = 42
/** How many nodes a run lays down, and the stretch of the approach they spread over. */
export const PATH_NODE_COUNT = 8
const NODE_NEAR_D = 200
const NODE_FAR_D = 950
/** Rounds it takes to reclaim a hacked node: they are fragile on purpose. */
const RECLAIM_HITS = 3
/** Hacked nodes, counted from the wall, the ICE pulse washes back toward us. */
const ICE_PULSE_ROWS = 3
/** Seconds without a pulse before a half-hacked node starts to recover. */
const RECOVER_AFTER = 2.5
const RECOVER_RATE = 0.06

const STATE_HEX: Record<ChipState, number> = { neutral: 0x94a3b8, hacked: 0xff2a2a, ours: 0x22d3ee }
const ALERT_HEX = 0xff7314
const RING_SEGMENTS = 40

export interface PathChip {
    id: number
    u: number
    d: number
    state: ChipState
    /** Hostile progress toward taking the node, 0–1. */
    hack: number
    /** Under attack: set by the first pulse that lands, cleared once it recovers. */
    alert: boolean
    /** Seconds since the last pulse landed. */
    sincePulse: number
    /** Player hits landed on a hacked node since it was taken. */
    reclaimHits: number
    group: THREE.Group
    edge: THREE.LineBasicMaterial
    emblem: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
    ring: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
    /** Seconds left on the flare that marks a change of hands or a hit. */
    flare: number
}

export class PathChips {
    readonly group = new THREE.Group()
    chips: PathChip[] = []
    /** The same nodes, outermost first: the order the intrusion takes them in. */
    ordered: PathChip[] = []
    private time = 0
    private body = new THREE.MeshBasicMaterial({ color: 0x050a12 })
    private packageGeometry = new THREE.BoxGeometry(2.8, 0.34, 2.8)
    private packageEdges = new THREE.EdgesGeometry(this.packageGeometry)
    private ringPositions: Float32Array

    constructor() {
        const verts: number[] = []
        for (let s = 0; s < RING_SEGMENTS; s++) {
            const a0 = (s / RING_SEGMENTS) * Math.PI * 2 - Math.PI / 2
            const a1 = ((s + 1) / RING_SEGMENTS) * Math.PI * 2 - Math.PI / 2
            verts.push(Math.cos(a0) * 2.4, 0, Math.sin(a0) * 2.4, Math.cos(a1) * 2.4, 0, Math.sin(a1) * 2.4)
        }
        this.ringPositions = new Float32Array(verts)
    }

    /** Lays out a fresh set of neutral nodes down the lane — once per run. */
    reset(count = PATH_NODE_COUNT) {
        for (const chip of this.chips) {
            chip.group.removeFromParent()
            chip.ring.geometry.dispose()
        }
        this.chips = []
        const placed: { u: number, d: number }[] = []
        for (let i = 0; i < count; i++) {
            let u = 0
            let d = 0
            // One node per depth band down the whole approach, scattered across
            // the full breadth of the lane: of a dozen tries, keep the spot
            // furthest from every node already down. The data network is laid
            // around wherever they land.
            const band = (NODE_FAR_D - NODE_NEAR_D) / count
            let best = -1
            for (let attempt = 0; attempt < 12; attempt++) {
                const cu = Math.round((randomFloat() * 2 - 1) * (FIELD_HALF_WIDTH - 50) / 10) * 10
                const cd = Math.round((NODE_NEAR_D + (i + 0.15 + randomFloat() * 0.7) * band) / 10) * 10
                const room = placed.length ? Math.min(...placed.map(p => Math.hypot(p.u - cu, p.d - cd))) : Infinity
                if (room > best) {
                    best = room
                    u = cu
                    d = cd
                }
            }
            placed.push({ u, d })
            this.chips.push(this.build(i, u, d))
        }
        this.ordered = [...this.chips].sort((a, b) => b.d - a.d)
    }

    private build(id: number, u: number, d: number): PathChip {
        const group = new THREE.Group()
        group.position.set(u * FIELD_SCALE, 0, -d * FIELD_SCALE)
        const chip = new THREE.Mesh(this.packageGeometry, this.body)
        chip.position.y = 0.2
        const edge = new THREE.LineBasicMaterial({ color: hdr(STATE_HEX.neutral, 1.2), toneMapped: false })
        chip.add(new THREE.LineSegments(this.packageEdges, edge))
        const emblem = new THREE.Mesh(
            new THREE.PlaneGeometry(2.1, 2.1).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
        )
        emblem.position.y = 0.4
        // Each node draws its own share of the ring, so it needs its own geometry.
        const ringGeometry = new THREE.BufferGeometry()
        ringGeometry.setAttribute('position', new THREE.BufferAttribute(this.ringPositions, 3))
        const ring = new THREE.LineSegments(
            ringGeometry,
            new THREE.LineBasicMaterial({ color: hdr(STATE_HEX.hacked, 2.2), toneMapped: false })
        )
        ring.position.y = 0.06
        ring.geometry.setDrawRange(0, 0)
        group.add(chip, emblem, ring)
        this.group.add(group)
        const record: PathChip = {
            id, u, d, state: 'neutral', hack: 0, alert: false, sincePulse: 99, reclaimHits: 0, group, edge, emblem, ring, flare: 0
        }
        this.paint(record)
        return record
    }

    /** Emblem and edge colour for a node's owner, or the warning it shows under attack. */
    private paint(chip: PathChip) {
        const sets = emblemTextures()
        chip.emblem.material.map = chip.state === 'hacked'
            ? sets.theirs[0]!
            : chip.alert
                ? sets.contested[0]!
                : chip.state === 'ours' ? sets.held[0]! : sets.held[2]!
        chip.emblem.material.needsUpdate = true
        chip.edge.color.copy(hdr(this.hex(chip), chip.state === 'neutral' && !chip.alert ? 0.9 : 1.6))
    }

    private hex(chip: PathChip) {
        return chip.state !== 'hacked' && chip.alert ? ALERT_HEX : STATE_HEX[chip.state]
    }

    /** How many nodes the intrusion holds in an unbroken run from the far end. */
    get conquered() {
        let count = 0
        for (const chip of this.ordered) {
            if (chip.state !== 'hacked') break
            count++
        }
        return count
    }

    /**
     * A hack pulse lands on a node. The first one raises its alarm. Returns
     * true when this pulse took it.
     */
    landPulse(chip: PathChip, amount: number) {
        if (chip.state === 'hacked') return false
        chip.sincePulse = 0
        chip.flare = Math.max(chip.flare, 0.18)
        if (!chip.alert) {
            chip.alert = true
            chip.flare = 0.5
            this.paint(chip)
        }
        chip.hack = Math.min(1, chip.hack + amount)
        if (chip.hack < 1) return false
        chip.state = 'hacked'
        chip.hack = 0
        chip.alert = false
        chip.reclaimHits = 0
        chip.flare = 0.7
        this.paint(chip)
        return true
    }

    /** Recovers nodes nobody is hacking any more, and animates the rest. */
    update(dt: number) {
        this.time += dt
        for (const chip of this.chips) {
            chip.sincePulse += dt
            if (chip.state !== 'hacked' && chip.alert && chip.sincePulse > RECOVER_AFTER) {
                chip.hack = Math.max(0, chip.hack - RECOVER_RATE * dt)
                if (chip.hack === 0) {
                    chip.alert = false
                    this.paint(chip)
                }
            }
            // The ring shows whichever bar is filling: the hack, or the reclaim.
            const progress = chip.state === 'hacked' ? chip.reclaimHits / RECLAIM_HITS : chip.hack
            chip.ring.geometry.setDrawRange(0, Math.round(progress * RING_SEGMENTS) * 2)
            chip.ring.material.color.copy(hdr(chip.state === 'hacked' ? STATE_HEX.ours : STATE_HEX.hacked, 2.2))

            chip.flare = Math.max(0, chip.flare - dt)
            // A node under attack breathes faster the closer it is to falling.
            const breathe = chip.state === 'hacked'
                ? 0.85 + 0.15 * Math.sin(this.time * 2.4 + chip.id)
                : chip.alert ? 0.8 + 0.2 * Math.sin(this.time * (2 + chip.hack * 4) + chip.id) : 1
            const lit = chip.state === 'neutral' && !chip.alert ? 0.9 : 1.7
            chip.emblem.material.color.copy(hdr(this.hex(chip), lit * breathe + chip.flare * 2))
        }
    }

    /** A player round passed through a hacked node. Returns true when that hit reclaimed it. */
    hit(chip: PathChip) {
        if (chip.state !== 'hacked' || this.locked) return false
        chip.reclaimHits++
        chip.flare = Math.max(chip.flare, 0.2)
        if (chip.reclaimHits < RECLAIM_HITS) return false
        chip.state = 'ours'
        chip.reclaimHits = 0
        chip.flare = 0.7
        this.paint(chip)
        return true
    }

    /** Reclaims a hacked node outright (a Cosmic Blip). False when it cannot be had back. */
    reclaim(chip: PathChip) {
        if (chip.state !== 'hacked' || this.locked) return false
        chip.state = 'ours'
        chip.reclaimHits = 0
        chip.flare = 0.9
        this.paint(chip)
        return true
    }

    /**
     * The ICE pulse washes back over the hacked nodes, counted from the one
     * nearest the wall: that one turns ours, the next gets two thirds of the
     * way back, the one after that a third. A defended node stops the wash
     * cold — `defended` says which are, and the node it broke on is returned
     * so its defender can pay for it.
     */
    icePulse(defended: (chip: PathChip) => boolean) {
        const reclaimed: PathChip[] = []
        if (this.locked) return { reclaimed, brokeOn: null }
        const hacked = this.ordered.filter(chip => chip.state === 'hacked').reverse()
        for (let row = 0; row < ICE_PULSE_ROWS && row < hacked.length; row++) {
            const chip = hacked[row]!
            if (defended(chip)) return { reclaimed, brokeOn: chip }
            const share = (ICE_PULSE_ROWS - row) / ICE_PULSE_ROWS
            chip.flare = Math.max(chip.flare, 0.5 * share)
            chip.reclaimHits = Math.max(chip.reclaimHits, Math.round(share * RECLAIM_HITS))
            if (chip.reclaimHits < RECLAIM_HITS) continue
            chip.state = 'ours'
            chip.reclaimHits = 0
            chip.flare = 0.9
            this.paint(chip)
            reclaimed.push(chip)
        }
        return { reclaimed, brokeOn: null }
    }

    /** Locked nodes cannot be reclaimed: the DDoS flood holds the whole board. */
    locked = false

    /** Hands every node to the intrusion, as a DDoS flood starts. */
    takeAll() {
        for (const chip of this.chips) {
            chip.state = 'hacked'
            chip.hack = 0
            chip.reclaimHits = 0
            chip.alert = false
            chip.flare = 0.6
            this.paint(chip)
        }
    }

    /** Every node's state, for putting the board back after a bonus round. */
    snapshot() {
        return this.chips.map(chip => ({ state: chip.state, hack: chip.hack, reclaimHits: chip.reclaimHits }))
    }

    /** Puts every node back as `snapshot` found it, or clears them all to neutral with none. */
    restore(snap: ReturnType<PathChips['snapshot']> | null) {
        this.chips.forEach((chip, i) => {
            const saved = snap?.[i]
            chip.state = saved?.state ?? 'neutral'
            chip.hack = saved?.hack ?? 0
            chip.reclaimHits = saved?.reclaimHits ?? 0
            chip.alert = false
            chip.sincePulse = 99
            chip.flare = 0.4
            this.paint(chip)
        })
    }

    /** Whether a hostile at (u, d) is inside a hacked node's aura. */
    buffedAt(u: number, d: number) {
        for (const chip of this.chips) {
            if (chip.state !== 'hacked') continue
            if (Math.hypot(u - chip.u, d - chip.d) <= CHIP_AURA_RADIUS) return true
        }
        return false
    }

    get owned() {
        return this.chips.filter(c => c.state === 'ours').length
    }
}
