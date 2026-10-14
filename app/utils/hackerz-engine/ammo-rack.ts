import * as THREE from 'three'
import { hdr } from './models'

/**
 * The magazine, on the deck: one crystal capacitor per round, seated on a
 * small circuit board behind the rail and cabled into it, so the ammo count
 * sits where the player is already looking rather than in a corner of the HUD.
 *
 * Each capacitor is a glass tube between two metal caps with a crystal rod
 * inside; the rod's glow is the charge. Firing drains one, and a spark runs
 * from it along its printed trace, down the bus and up the cable into the gun.
 * Reloading sends a maintenance drone down the rack, swapping capacitors at
 * the reload's own pace — the drone's position *is* the reload bar.
 */

const CELL_R = 0.19
const CELL_H = 1.0
const CAP_H = 0.13
const PITCH = 0.62
const PER_ROW = 12
const MAX_CELLS = 64
/** Board surface height, and the height the printed traces sit at just above it. */
const BOARD_TOP = 0.16
const TRACE_Y = BOARD_TOP + 0.012
const SOCKET_TOP = BOARD_TOP + 0.08

/** How fast a spark travels from capacitor to gun, in world units per second. */
const SPARK_SPEED = 26
const SPARK_TRAIL = 4
const MAX_SPARKS = 10
const ARC_LIFE = 0.16

const SPENT = new THREE.Color(0.03, 0.05, 0.08)
const _m = new THREE.Matrix4()
const _c = new THREE.Color()
const _v = new THREE.Vector3()

interface Spark {
    path: THREE.Vector3[]
    /** Cumulative length at each path point. */
    lengths: number[]
    travelled: number
    heads: THREE.Mesh[]
}

export class AmmoRack {
    readonly group = new THREE.Group()
    private board: THREE.Mesh
    private boardEdges: THREE.LineSegments
    private sockets: THREE.InstancedMesh
    private caps: THREE.InstancedMesh
    private glass: THREE.InstancedMesh
    private cores: THREE.InstancedMesh
    private outlines: THREE.LineSegments[] = []
    private outlineMaterial: THREE.LineBasicMaterial
    private glassMaterial: THREE.MeshBasicMaterial
    private traces: THREE.LineSegments
    private traceMaterial: THREE.LineBasicMaterial
    private cable: THREE.Mesh
    private cableMaterial: THREE.MeshBasicMaterial
    private cablePoints: THREE.Vector3[] = []
    private sparks: Spark[] = []
    private sparkMaterial: THREE.MeshBasicMaterial
    private drone = new THREE.Group()
    private droneRing: THREE.Mesh
    private beam: THREE.Line
    private beamMaterial: THREE.LineBasicMaterial
    private lit: THREE.Color
    private magSize = 0
    private shown = 0
    private flash = new Float32Array(MAX_CELLS)
    private busZ = 0
    private dock = new THREE.Vector3()
    private time = 0
    private firePulse = 0
    /** Idle crackle on charged capacitors. */
    private arcs: { line: THREE.Line, life: number, cell: number }[] = []
    private nextArc = 0.6

    constructor(private gunAnchor: THREE.Vector3, hex: number) {
        this.lit = hdr(hex, 1.6)
        const dark = new THREE.MeshBasicMaterial({ color: 0x0a1220 })

        // The board: a dark substrate, outlined, with its traces printed on top.
        const boardGeometry = new THREE.BoxGeometry(1, BOARD_TOP, 1)
        this.board = new THREE.Mesh(boardGeometry, new THREE.MeshBasicMaterial({ color: 0x03101a }))
        this.board.position.y = BOARD_TOP / 2
        this.boardEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(boardGeometry),
            new THREE.LineBasicMaterial({ color: hdr(hex, 0.9), toneMapped: false })
        )
        this.board.add(this.boardEdges)
        this.traceMaterial = new THREE.LineBasicMaterial({ color: hdr(hex, 1.0), toneMapped: false })
        this.traces = new THREE.LineSegments(new THREE.BufferGeometry(), this.traceMaterial)

        // The capacitors, instanced part by part.
        const glassH = CELL_H - CAP_H * 2
        this.sockets = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL_R * 2.6, 0.08, CELL_R * 2.6), dark, MAX_CELLS)
        this.caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(CELL_R * 1.12, CELL_R * 1.12, CAP_H, 10), dark, MAX_CELLS * 2)
        this.glassMaterial = new THREE.MeshBasicMaterial({
            color: hdr(hex, 0.14),
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        })
        this.glass = new THREE.InstancedMesh(new THREE.CylinderGeometry(CELL_R, CELL_R, glassH, 10, 1, true), this.glassMaterial, MAX_CELLS)
        this.cores = new THREE.InstancedMesh(
            new THREE.CylinderGeometry(CELL_R * 0.5, CELL_R * 0.5, glassH - 0.06, 6),
            new THREE.MeshBasicMaterial({ toneMapped: false }),
            MAX_CELLS
        )
        for (const mesh of [this.sockets, this.caps, this.glass, this.cores]) {
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
            mesh.count = 0
        }

        // Each capacitor's rims, in the weapon colour, lit or spent — the rack's
        // capacity always reads, and the outline never blooms into a blob.
        this.outlineMaterial = new THREE.LineBasicMaterial({ color: hdr(hex, 1.2), toneMapped: false })
        const rim = capacitorOutline()
        for (let i = 0; i < MAX_CELLS; i++) {
            const outline = new THREE.LineSegments(rim, this.outlineMaterial)
            outline.visible = false
            this.outlines.push(outline)
            this.group.add(outline)
        }

        this.cableMaterial = new THREE.MeshBasicMaterial({ color: hdr(hex, 1.2), toneMapped: false })
        this.cable = new THREE.Mesh(new THREE.BufferGeometry(), this.cableMaterial)

        this.sparkMaterial = new THREE.MeshBasicMaterial({ color: hdr(hex, 3), toneMapped: false })
        const sparkGeometry = new THREE.BoxGeometry(0.22, 0.22, 0.22)
        for (let s = 0; s < MAX_SPARKS; s++) {
            const heads = Array.from({ length: SPARK_TRAIL }, (_, k) => {
                const head = new THREE.Mesh(sparkGeometry, this.sparkMaterial)
                head.scale.setScalar(1 - k * 0.2)
                head.visible = false
                this.group.add(head)
                return head
            })
            this.sparks.push({ path: [], lengths: [], travelled: -1, heads })
        }

        const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshBasicMaterial({ color: 0x05080f }))
        body.scale.set(1, 0.7, 1)
        body.add(new THREE.LineSegments(
            new THREE.EdgesGeometry(body.geometry),
            new THREE.LineBasicMaterial({ color: hdr(0xfbbf24, 1.6), toneMapped: false })
        ))
        this.droneRing = new THREE.Mesh(
            new THREE.TorusGeometry(0.42, 0.03, 4, 16).rotateX(Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: hdr(0xfbbf24, 2), toneMapped: false })
        )
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: hdr(0xffffff, 2.4), toneMapped: false }))
        eye.position.set(0, -0.05, -0.24)
        this.drone.add(body, this.droneRing, eye)
        this.drone.scale.setScalar(1.8)

        this.beamMaterial = new THREE.LineBasicMaterial({ color: hdr(0xfbbf24, 2.6), toneMapped: false, transparent: true })
        this.beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), this.beamMaterial)
        this.beam.frustumCulled = false

        for (let a = 0; a < 3; a++) {
            const line = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(Array.from({ length: 6 }, () => new THREE.Vector3())),
                new THREE.LineBasicMaterial({ color: hdr(0xe0f7ff, 3), toneMapped: false, transparent: true })
            )
            line.visible = false
            line.frustumCulled = false
            this.arcs.push({ line, life: 0, cell: -1 })
            this.group.add(line)
        }

        this.group.add(this.board, this.traces, this.sockets, this.caps, this.glass, this.cores, this.cable, this.drone, this.beam)
    }

    /** Lays the rack out for a magazine size. Rebuilt only when the size changes. */
    private layout(magSize: number) {
        this.magSize = Math.min(MAX_CELLS, Math.max(1, magSize))
        const rows = Math.ceil(this.magSize / PER_ROW)
        const cols = Math.min(PER_ROW, this.magSize)
        const width = cols * PITCH + 0.5
        const depth = rows * PITCH + 0.7
        this.board.scale.set(width, 1, depth)
        // The bus runs along the board's front edge, where the cable leaves for the gun.
        this.busZ = -depth / 2 + 0.2

        const glassH = CELL_H - CAP_H * 2
        for (const mesh of [this.sockets, this.glass, this.cores]) mesh.count = this.magSize
        this.caps.count = this.magSize * 2
        const traceVerts: number[] = []
        for (let i = 0; i < this.magSize; i++) {
            const x = this.cellX(i)
            const z = this.cellZ(i)
            const base = SOCKET_TOP
            this.sockets.setMatrixAt(i, _m.makeTranslation(x, BOARD_TOP + 0.04, z))
            this.caps.setMatrixAt(i * 2, _m.makeTranslation(x, base + CAP_H / 2, z))
            this.caps.setMatrixAt(i * 2 + 1, _m.makeTranslation(x, base + CELL_H - CAP_H / 2, z))
            this.glass.setMatrixAt(i, _m.makeTranslation(x, base + CAP_H + glassH / 2, z))
            this.cores.setMatrixAt(i, _m.makeTranslation(x, base + CAP_H + glassH / 2, z))
            this.outlines[i]!.position.set(x, base, z)

            const path = this.tracePath(i)
            for (let p = 0; p + 1 < path.length; p++) {
                traceVerts.push(path[p]!.x, path[p]!.y, path[p]!.z, path[p + 1]!.x, path[p + 1]!.y, path[p + 1]!.z)
            }
        }
        this.outlines.forEach((outline, i) => { outline.visible = i < this.magSize })
        for (const mesh of [this.sockets, this.caps, this.glass, this.cores]) mesh.instanceMatrix.needsUpdate = true
        // The bus itself, edge to edge.
        traceVerts.push(-width / 2 + 0.15, TRACE_Y, this.busZ, width / 2 - 0.15, TRACE_Y, this.busZ)
        this.traces.geometry.dispose()
        this.traces.geometry = new THREE.BufferGeometry()
        this.traces.geometry.setAttribute('position', new THREE.Float32BufferAttribute(traceVerts, 3))

        // The cable runs from the bus's centre, off the front edge, into the gun.
        this.group.updateMatrixWorld(true)
        const local = this.group.worldToLocal(this.gunAnchor.clone())
        const start = new THREE.Vector3(0, TRACE_Y, -depth / 2)
        const mid = start.clone().lerp(local, 0.5).setY(0.05)
        const curve = new THREE.CatmullRomCurve3([start, mid, local])
        this.cablePoints = curve.getPoints(16)
        this.cable.geometry.dispose()
        this.cable.geometry = new THREE.TubeGeometry(curve, 16, 0.07, 5, false)

        this.dock.set(width / 2 + 1.2, 1.4, 0)
        this.drone.position.copy(this.dock)
        this.shown = -1
    }

    /**
     * A capacitor's printed trace: out from its socket, sideways into the gap
     * beside it when a row stands between it and the bus, down to the bus,
     * along the bus to the centre. Manhattan only — it is a circuit board.
     */
    private tracePath(i: number) {
        const x = this.cellX(i)
        const z = this.cellZ(i)
        const row = Math.floor(i / PER_ROW)
        const lane = row === 0 ? x : x + PITCH * 0.5
        const points = [new THREE.Vector3(x, TRACE_Y, z), new THREE.Vector3(lane, TRACE_Y, z)]
        points.push(new THREE.Vector3(lane, TRACE_Y, this.busZ), new THREE.Vector3(0, TRACE_Y, this.busZ))
        return points
    }

    /** Capacitors fill row by row, front row first, left to right. */
    private cellX(i: number) {
        const cols = Math.min(PER_ROW, this.magSize)
        const col = i % PER_ROW
        return (col - (cols - 1) / 2) * PITCH
    }

    private cellZ(i: number) {
        const rows = Math.ceil(this.magSize / PER_ROW)
        const row = Math.floor(i / PER_ROW)
        return (row - (rows - 1) / 2) * PITCH
    }

    setColour(hex: number) {
        this.lit = hdr(hex, 1.6)
        this.outlineMaterial.color.copy(hdr(hex, 1.2))
        this.glassMaterial.color.copy(hdr(hex, 0.14))
        this.traceMaterial.color.copy(hdr(hex, 1.0))
        this.sparkMaterial.color.copy(hdr(hex, 3))
        ;(this.boardEdges.material as THREE.LineBasicMaterial).color.copy(hdr(hex, 0.9))
        this.cableMaterial.color.copy(hdr(hex, 1.2))
        this.shown = -1
    }

    /** Sends a spark from capacitor `i` along its trace and the cable into the gun. */
    private fire(i: number) {
        const spark = this.sparks.find(s => s.travelled < 0) ?? this.sparks[0]!
        const top = new THREE.Vector3(this.cellX(i), SOCKET_TOP + CELL_H, this.cellZ(i))
        spark.path = [top, ...this.tracePath(i), ...this.cablePoints]
        spark.lengths = [0]
        for (let p = 1; p < spark.path.length; p++) {
            spark.lengths.push(spark.lengths[p - 1]! + spark.path[p]!.distanceTo(spark.path[p - 1]!))
        }
        spark.travelled = 0
    }

    private pointAlong(spark: Spark, distance: number, out: THREE.Vector3) {
        const lengths = spark.lengths
        const d = Math.max(0, Math.min(distance, lengths[lengths.length - 1]!))
        let p = 1
        while (p < lengths.length - 1 && lengths[p]! < d) p++
        const span = lengths[p]! - lengths[p - 1]!
        const t = span > 0 ? (d - lengths[p - 1]!) / span : 0
        return out.copy(spark.path[p - 1]!).lerp(spark.path[p]!, t)
    }

    private updateSparks(dt: number) {
        for (const spark of this.sparks) {
            if (spark.travelled < 0) continue
            spark.travelled += dt * SPARK_SPEED
            const total = spark.lengths[spark.lengths.length - 1]!
            const done = spark.travelled - (SPARK_TRAIL - 1) * 0.18 > total
            spark.heads.forEach((head, k) => {
                const d = spark.travelled - k * 0.18
                head.visible = !done && d >= 0 && d <= total
                if (head.visible) this.pointAlong(spark, d, head.position)
            })
            if (done) spark.travelled = -1
        }
    }

    /**
     * `progress` is the reload's 0→1, or 1 when not reloading. Capacitors are
     * drained from the back of the magazine, so the charged block shrinks
     * toward the cable.
     */
    update(dt: number, mag: number, magSize: number, progress: number) {
        this.time += dt
        if (magSize !== this.magSize) this.layout(magSize)

        const reloading = progress < 1
        const loaded = reloading ? Math.floor(progress * this.magSize) : mag
        if (!reloading && loaded < this.shown && this.shown >= 0) {
            for (let i = loaded; i < this.shown; i++) {
                this.flash[i] = 1
                this.fire(i)
            }
            this.firePulse = 1
        }
        if (reloading && loaded > this.shown && this.shown >= 0) {
            for (let i = Math.max(0, this.shown); i < loaded; i++) this.flash[i] = 0.8
        }
        this.shown = loaded

        for (let i = 0; i < this.magSize; i++) {
            const f = this.flash[i]!
            if (f > 0) this.flash[i] = Math.max(0, f - dt * 6)
            if (i < loaded) _c.copy(this.lit).multiplyScalar(1 + this.arcBoost(i) * 0.35)
            else _c.copy(SPENT)
            if (f > 0) _c.lerp(hdr(0xffffff, 2.2), f)
            this.cores.setColorAt(i, _c)
        }
        if (this.cores.instanceColor) this.cores.instanceColor.needsUpdate = true

        this.firePulse = Math.max(0, this.firePulse - dt * 5)
        this.cableMaterial.color.copy(this.lit).multiplyScalar(0.6 + this.firePulse * 0.8)

        this.updateSparks(dt)
        this.updateArcs(dt, loaded)
        this.updateDrone(dt, reloading, progress)
    }

    /**
     * Now and then a charged capacitor crackles: a short jagged arc from its cap
     * down the glass, and a brief lift in its glow. Small and occasional by
     * design — a sign of stored charge, not a light show.
     */
    private updateArcs(dt: number, loaded: number) {
        this.nextArc -= dt
        if (this.nextArc <= 0 && loaded > 0) {
            this.nextArc = 0.35 + Math.random() * 0.9
            const arc = this.arcs.find(a => a.life <= 0) ?? this.arcs[0]!
            const cell = Math.floor(Math.random() * loaded)
            const x = this.cellX(cell)
            const z = this.cellZ(cell)
            const r = CELL_R * 1.05
            const a0 = Math.random() * Math.PI * 2
            const a1 = a0 + (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.8)
            const yTop = SOCKET_TOP + CELL_H - CAP_H * 0.5
            const yEnd = SOCKET_TOP + CAP_H + (CELL_H - CAP_H * 2) * (0.25 + Math.random() * 0.5)
            const positions = arc.line.geometry.getAttribute('position') as THREE.BufferAttribute
            const steps = positions.count - 1
            for (let p = 0; p <= steps; p++) {
                const t = p / steps
                const a = a0 + (a1 - a0) * t
                const out = p === 0 || p === steps ? 0 : (Math.random() - 0.3) * 0.12
                positions.setXYZ(p, x + Math.cos(a) * (r + out), yTop + (yEnd - yTop) * t, z + Math.sin(a) * (r + out))
            }
            positions.needsUpdate = true
            arc.cell = cell
            arc.life = ARC_LIFE
        }
        for (const arc of this.arcs) {
            if (arc.life <= 0) {
                arc.line.visible = false
                continue
            }
            arc.life = Math.max(0, arc.life - dt)
            arc.line.visible = true
            ;(arc.line.material as THREE.LineBasicMaterial).opacity = arc.life / ARC_LIFE
        }
    }

    /** How much an arc is lifting capacitor `i`'s glow right now, 0–1. */
    private arcBoost(i: number) {
        let boost = 0
        for (const arc of this.arcs) if (arc.cell === i && arc.life > 0) boost = Math.max(boost, arc.life / ARC_LIFE)
        return boost
    }

    /** The drone shuttles along the rack while the reload runs, then goes home. */    private updateDrone(dt: number, reloading: boolean, progress: number) {
        const target = _v
        if (reloading) {
            const index = Math.min(this.magSize - 1, Math.floor(progress * this.magSize))
            target.set(this.cellX(index), 2.0 + Math.sin(this.time * 9) * 0.06, this.cellZ(index))
        } else {
            target.copy(this.dock).setY(this.dock.y + Math.sin(this.time * 2) * 0.1)
        }
        this.drone.position.lerp(target, Math.min(1, dt * (reloading ? 14 : 5)))
        this.droneRing.rotation.y += dt * (reloading ? 14 : 3)

        this.beam.visible = reloading
        if (reloading) {
            const positions = this.beam.geometry.getAttribute('position') as THREE.BufferAttribute
            positions.setXYZ(0, this.drone.position.x, this.drone.position.y - 0.15, this.drone.position.z)
            positions.setXYZ(1, this.drone.position.x, SOCKET_TOP + CELL_H, this.drone.position.z)
            positions.needsUpdate = true
            // A steady working beam with a gentle pulse; never a strobe.
            this.beamMaterial.opacity = 0.75 + Math.sin(this.time * 6) * 0.15
        }
    }
}

/** The rims of a capacitor: both caps' top and bottom edges, as rings, from its base up. */
function capacitorOutline() {
    const r = CELL_R * 1.12
    const segments = 10
    const verts: number[] = []
    for (const y of [0, CAP_H, CELL_H - CAP_H, CELL_H]) {
        for (let s = 0; s < segments; s++) {
            const a0 = (s / segments) * Math.PI * 2
            const a1 = ((s + 1) / segments) * Math.PI * 2
            verts.push(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r)
        }
    }
    // Two seams down the glass, so the tube reads as a tube from above.
    for (const a of [Math.PI * 0.25, Math.PI * 1.25]) {
        verts.push(Math.cos(a) * CELL_R, CAP_H, Math.sin(a) * CELL_R, Math.cos(a) * CELL_R, CELL_H - CAP_H, Math.sin(a) * CELL_R)
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
}
