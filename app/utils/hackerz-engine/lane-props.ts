import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { FIELD_DEPTH, FIELD_HALF_WIDTH, FIELD_SCALE } from './constants'
import { hdr } from './models'
import { randRange } from './math'

/**
 * The hardware either side of the lane: circuit chips and capacitors whose
 * markings say who owns the ground they sit on. Held ground shows the
 * hackerz's own marks; contested ground turns them into warnings; ground the
 * intrusion has taken is tagged with its skulls. Every lit edge on them uses
 * the territory shader, so the colour follows the frontline continuously and
 * only the emblem has to be swapped.
 */

export type Zone = 'held' | 'contested' | 'theirs'

const ZONE_HEX: Record<Zone, number> = { held: 0x1a6bff, contested: 0xff7314, theirs: 0xff1412 }

/** A per-column line's depth at lateral position `u`. */
function lineAt(line: number[], u: number) {
    const columns = line.length
    const t = Math.min(1, Math.max(0, (u / FIELD_HALF_WIDTH) * 0.5 + 0.5)) * (columns - 1)
    const i = Math.floor(t)
    const j = Math.min(i + 1, columns - 1)
    return line[i]! + (line[j]! - line[i]!) * (t - i)
}

/**
 * Which side holds a field point. Matches the floor shader's `zoneColour`:
 * the midpoints of its two blends are the boundaries here.
 */
export function zoneAt(red: number[], orange: number[], u: number, d: number): Zone {
    if (d < 0) return 'held'
    if (d > lineAt(red, u)) return 'theirs'
    if (d > lineAt(orange, u) - 20) return 'contested'
    return 'held'
}

// ─── Emblems ────────────────────────────────────────────────────────────────

type Draw = (ctx: CanvasRenderingContext2D) => void

const S = 128

const line = (ctx: CanvasRenderingContext2D, points: [number, number][], close = false) => {
    ctx.beginPath()
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
    if (close) ctx.closePath()
    ctx.stroke()
}

/** The hackerz's own marks: a shield, a closed lock, the core hexagon. */
const HELD: Draw[] = [
    (ctx) => {
        line(ctx, [[64, 14], [108, 30], [104, 72], [64, 114], [24, 72], [20, 30]], true)
        line(ctx, [[44, 64], [58, 80], [86, 46]])
    },
    (ctx) => {
        ctx.strokeRect(32, 58, 64, 50)
        ctx.beginPath()
        ctx.arc(64, 58, 20, Math.PI, 0)
        ctx.stroke()
        line(ctx, [[64, 76], [64, 92]])
    },
    (ctx) => {
        const hex = (r: number) => Array.from({ length: 6 }, (_, i) => {
            const a = i * Math.PI / 3 + Math.PI / 6
            return [64 + Math.cos(a) * r, 64 + Math.sin(a) * r] as [number, number]
        })
        line(ctx, hex(48), true)
        line(ctx, hex(24), true)
        ctx.fillRect(58, 58, 12, 12)
    }
]

/** Contested ground: warnings, a broken lock, crosshairs. */
const CONTESTED: Draw[] = [
    (ctx) => {
        line(ctx, [[64, 14], [116, 106], [12, 106]], true)
        line(ctx, [[64, 44], [64, 78]])
        ctx.fillRect(59, 88, 10, 10)
    },
    (ctx) => {
        ctx.strokeRect(32, 58, 64, 50)
        ctx.beginPath()
        ctx.arc(64, 50, 20, Math.PI, -0.4)
        ctx.stroke()
        line(ctx, [[54, 70], [70, 84], [58, 92], [74, 104]])
    },
    (ctx) => {
        ctx.beginPath()
        ctx.arc(64, 64, 40, 0, Math.PI * 2)
        ctx.stroke()
        line(ctx, [[64, 10], [64, 44]])
        line(ctx, [[64, 84], [64, 118]])
        line(ctx, [[10, 64], [44, 64]])
        line(ctx, [[84, 64], [118, 64]])
    }
]

const skull = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => {
    ctx.beginPath()
    ctx.arc(x, y - 6 * s, 30 * s, Math.PI * 0.85, Math.PI * 2.15)
    ctx.lineTo(x + 20 * s, y + 26 * s)
    ctx.lineTo(x - 20 * s, y + 26 * s)
    ctx.closePath()
    ctx.stroke()
    ctx.fillRect(x - 18 * s, y - 10 * s, 13 * s, 13 * s)
    ctx.fillRect(x + 5 * s, y - 10 * s, 13 * s, 13 * s)
    line(ctx, [[x, y + 6 * s], [x - 5 * s, y + 14 * s], [x + 5 * s, y + 14 * s]], true)
    for (let i = -1; i <= 1; i++) line(ctx, [[x + i * 8 * s, y + 18 * s], [x + i * 8 * s, y + 26 * s]])
}

/** Taken ground: the intrusion's own tags. */
const THEIRS: Draw[] = [
    (ctx) => skull(ctx, 64, 60, 1.25),
    (ctx) => {
        line(ctx, [[18, 22], [110, 106]])
        line(ctx, [[110, 22], [18, 106]])
        ctx.fillStyle = '#000'
        ctx.fillRect(30, 26, 68, 70)
        ctx.fillStyle = '#fff'
        skull(ctx, 64, 58, 1.0)
    },
    (ctx) => {
        ctx.font = '900 30px ui-monospace, Menlo, monospace'
        ctx.textAlign = 'center'
        ctx.fillText('0xDEAD', 64, 50)
        // Glitch bars, so the tag reads as something that was written in.
        for (const [y, w] of [[62, 90], [72, 50], [84, 76]] as const) ctx.fillRect(64 - w / 2 + (y % 7) - 3, y, w, 4)
        ctx.fillText('PWNED', 64, 112)
    }
]

let textures: Record<Zone, THREE.CanvasTexture[]> | null = null

/** The emblem glyphs per zone, drawn once; the spawn portal borrows the hostile ones. */
export function emblemTextures() {
    if (textures) return textures
    const make = (draw: Draw) => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = S
        const ctx = canvas.getContext('2d')!
        ctx.strokeStyle = '#fff'
        ctx.fillStyle = '#fff'
        ctx.lineWidth = 7
        ctx.lineJoin = 'miter'
        draw(ctx)
        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 4
        return texture
    }
    textures = {
        held: HELD.map(make),
        contested: CONTESTED.map(make),
        theirs: THEIRS.map(make)
    }
    return textures
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface Prop {
    u: number
    d: number
    variant: number
    zone: Zone | null
    emblem: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
    /** Seconds left on the flare that plays when a prop changes hands. */
    glitch: number
    /**
     * A zone the ground has been reading for `pendingFor` seconds. A prop only
     * changes hands once that settles, so a frontline wobbling across it cannot
     * flicker its emblem back and forth.
     */
    pending: Zone | null
    pendingFor: number
}

export class LaneProps {
    readonly group = new THREE.Group()
    private props: Prop[] = []
    private time = 0

    constructor(zoneMaterial: (intensity: number, packets: number) => THREE.Material) {
        const body = new THREE.MeshBasicMaterial({ color: 0x03060c })
        const edge = zoneMaterial(1.1, 0)
        const pins = zoneMaterial(0.7, 0)
        const band = zoneMaterial(1.6, 0)

        for (const side of [-1, 1]) {
            let d = 30
            let index = 0
            while (d < FIELD_DEPTH + 120) {
                const u = side * (FIELD_HALF_WIDTH + randRange(70, 230))
                const chip = index % 3 !== 2
                const root = chip
                    ? this.buildChip(body, edge, pins)
                    : this.buildCapacitor(body, edge, band)
                root.group.position.set(u * FIELD_SCALE, 0, -d * FIELD_SCALE)
                root.group.rotation.y = chip ? (randRange(0, 1) < 0.5 ? 0 : Math.PI / 2) : 0
                this.group.add(root.group)
                this.props.push({ u, d, variant: index % 3, zone: null, emblem: root.emblem, glitch: 0, pending: null, pendingFor: 0 })
                d += randRange(80, 130)
                index++
            }
        }
    }

    private emblemMesh(size: number) {
        return new THREE.Mesh(
            new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                toneMapped: false
            })
        )
    }

    /** A chip: a flat package, pins down both long sides, its emblem on top. */
    private buildChip(body: THREE.Material, edge: THREE.Material, pinMaterial: THREE.Material) {
        const group = new THREE.Group()
        const w = randRange(2.6, 4.2)
        const h = randRange(2.2, 3.2)
        const packageGeometry = new THREE.BoxGeometry(w, 0.32, h)
        const chip = new THREE.Mesh(packageGeometry, body)
        chip.position.y = 0.2
        chip.add(new THREE.LineSegments(new THREE.EdgesGeometry(packageGeometry), edge))
        group.add(chip)

        const pins: THREE.BufferGeometry[] = []
        const count = Math.max(4, Math.floor(w / 0.42))
        for (let i = 0; i < count; i++) {
            const x = -w / 2 + 0.3 + i * ((w - 0.6) / Math.max(1, count - 1))
            for (const z of [-h / 2 - 0.22, h / 2 + 0.22]) {
                pins.push(new THREE.BoxGeometry(0.12, 0.06, 0.44).translate(x, 0.05, z))
            }
        }
        group.add(new THREE.Mesh(mergeGeometries(pins), pinMaterial))

        const emblem = this.emblemMesh(Math.min(w, h) * 0.78)
        emblem.position.y = 0.38
        group.add(emblem)
        return { group, emblem }
    }

    /** A capacitor: a dark can banded in light, its rating stamped on the lid. */
    private buildCapacitor(body: THREE.Material, edge: THREE.Material, band: THREE.Material) {
        const group = new THREE.Group()
        const r = randRange(0.6, 0.95)
        const height = randRange(1.2, 2.2)
        const canGeometry = new THREE.CylinderGeometry(r, r, height, 12)
        const can = new THREE.Mesh(canGeometry, body)
        can.position.y = height / 2
        can.add(new THREE.LineSegments(new THREE.EdgesGeometry(canGeometry, 40), edge))
        group.add(can)
        for (const y of [height * 0.25, height * 0.8]) {
            const ring = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.09, 12, 1, true), band)
            ring.position.y = y
            group.add(ring)
        }
        const emblem = this.emblemMesh(r * 1.6)
        emblem.position.y = height + 0.02
        group.add(emblem)
        return { group, emblem }
    }

    /**
     * Re-tags any prop whose ground has settled into new hands. The change is
     * marked by one bright flare that decays and a small jitter — never a
     * strobe, which is a photosensitivity hazard rather than an effect.
     */
    update(dt: number, red: number[], orange: number[]) {
        this.time += dt
        const sets = emblemTextures()
        for (const prop of this.props) {
            const reading = zoneAt(red, orange, prop.u, prop.d)
            if (reading === prop.pending) prop.pendingFor += dt
            else {
                prop.pending = reading
                prop.pendingFor = 0
            }
            const material = prop.emblem.material
            const settled = prop.zone === null || prop.pendingFor >= 0.6
            if (reading !== prop.zone && settled) {
                prop.glitch = prop.zone === null ? 0 : 0.5
                prop.zone = reading
                material.map = sets[reading][prop.variant]!
                material.needsUpdate = true
            }
            const zone = prop.zone!
            const base = hdr(ZONE_HEX[zone], zone === 'theirs' ? 2.2 : 1.6)
            // Hostile tags breathe slowly; the hackerz's own marks hold steady.
            const breathe = zone === 'held' ? 1 : 0.8 + 0.2 * Math.sin(this.time * (zone === 'theirs' ? 2.4 : 1.4) + prop.u)
            if (prop.glitch > 0) {
                prop.glitch = Math.max(0, prop.glitch - dt)
                const flare = prop.glitch / 0.5
                material.color.copy(base).multiplyScalar(breathe + flare * 1.2)
                prop.emblem.position.x = Math.sin(prop.glitch * 40) * 0.08 * flare
            } else {
                material.color.copy(base).multiplyScalar(breathe)
                prop.emblem.position.x = 0
            }
        }
    }
}
