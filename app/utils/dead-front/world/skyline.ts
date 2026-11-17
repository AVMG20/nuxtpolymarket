import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { dfHash3 } from '#shared/utils/dead-front/voxel'
import type { DfWorldKit, DfWorldPart } from './kit'

// The land beyond the walls, in flat-shaded silhouettes: rows of poplars,
// shelled farmhouses with the odd lit window, two church steeples, a factory
// chimney and a pair of tethered observation balloons. All of it is one static
// mesh (plus one for the balloons) on the shared toon material; the fog does
// the rest, so a ring of it 60-90 m out reads as distance from the ramparts
// and over the walls without a single extra draw call per object.

class Builder {
    readonly parts: THREE.BufferGeometry[] = []
    private readonly m = new THREE.Matrix4()
    private readonly q = new THREE.Quaternion()
    private readonly up = new THREE.Vector3(0, 1, 0)

    /** Adds a geometry (unit-sized, base at y = 0) scaled, turned about +y and moved. */
    add(src: THREE.BufferGeometry, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, glow = 0): void {
        const g = src.index ? src.toNonIndexed() : src.clone()
        this.q.setFromAxisAngle(this.up, yaw)
        g.applyMatrix4(this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(sx, sy, sz)))
        g.deleteAttribute('uv')
        const n = g.getAttribute('position').count
        const c = new THREE.Color(color)
        const col = new Float32Array(n * 3)
        for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3)
        g.setAttribute('color', new THREE.BufferAttribute(col, 3))
        g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1))
        this.parts.push(g)
    }

    build(): THREE.BufferGeometry | null {
        const geo = mergeGeometries(this.parts)
        for (const p of this.parts) p.dispose()
        this.parts.length = 0
        geo?.computeBoundingSphere()
        return geo
    }
}

/** Unit shapes with the base at y = 0. */
function unitBox(): THREE.BufferGeometry {
    return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
}

function unitCone(seg: number): THREE.BufferGeometry {
    return new THREE.ConeGeometry(1, 1, seg).translate(0, 0.5, 0)
}

function unitCyl(seg: number): THREE.BufferGeometry {
    return new THREE.CylinderGeometry(1, 1, 1, seg).translate(0, 0.5, 0)
}

/** A gable roof prism 1 wide (x), 1 long (z), 1 high, ridge along z. */
function unitGable(): THREE.BufferGeometry {
    const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0, 1, -0.5], D = [-0.5, 0, 0.5], E = [0.5, 0, 0.5], F = [0, 1, 0.5]
    const centre = [0, 0.33, 0]
    const pos: number[] = []
    const tri = (a: number[], b: number[], c: number[]) => {
        const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
        const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
        const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!]
        const out = n[0]! * (a[0]! - centre[0]!) + n[1]! * (a[1]! - centre[1]!) + n[2]! * (a[2]! - centre[2]!)
        pos.push(...a, ...(out >= 0 ? [...b, ...c] : [...c, ...b]))
    }
    tri(A, B, C)
    tri(D, E, F)
    for (const [a, b, c, d] of [[A, D, F, C], [B, C, F, E], [A, B, E, D]] as const) {
        tri(a, b, c)
        tri(a, c, d)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.computeVertexNormals()
    return g
}

/** A point on the square ring `d` metres (Chebyshev) from the map centre at angle `a`. */
function ring(a: number, d: number): [number, number] {
    const c = Math.cos(a)
    const s = Math.sin(a)
    const k = d / Math.max(Math.abs(c), Math.abs(s))
    return [c * k, s * k]
}

export function createDfSkyline(kit: DfWorldKit): DfWorldPart {
    const box = unitBox()
    const cone6 = unitCone(6)
    const cone4 = unitCone(4)
    const cyl = unitCyl(10)
    const gable = unitGable()
    const sphere = new THREE.SphereGeometry(1, 14, 8)
    const b = new Builder()
    const h = (i: number, k: number, seed: number) => dfHash3(i, k, 0, 900 + seed)

    // Poplar rows: 3 to 7 trees along a line, in a few shades of dark green.
    const SHADES = [0x1b2a22, 0x213328, 0x17241e]
    for (let r = 0; r < 14; r++) {
        const [cx, cz] = ring((r + h(r, 1, 1) * 0.6) / 14 * Math.PI * 2, 62 + h(r, 2, 1) * 26)
        const along = h(r, 3, 1) * Math.PI
        const n = 3 + Math.floor(h(r, 4, 1) * 5)
        for (let t = 0; t < n; t++) {
            const x = cx + Math.cos(along) * t * 4.6
            const z = cz + Math.sin(along) * t * 4.6
            const ht = 13 + h(t, r, 2) * 8
            b.add(cone6, SHADES[(t + r) % 3]!, x, 0, z, 1.5 + h(t, r, 3) * 0.5, ht, 1.5 + h(t, r, 4) * 0.5, h(t, r, 5) * 3)
            b.add(cyl, 0x14181a, x, 0, z, 0.25, 2.2, 0.25)
        }
    }

    // Shelled farmhouses, some with a lit window or a smoulder at a broken roof.
    for (let i = 0; i < 16; i++) {
        const [x, z] = ring((i + h(i, 1, 6) * 0.7) / 16 * Math.PI * 2, 60 + h(i, 2, 6) * 30)
        const w = 7 + h(i, 3, 6) * 6
        const l = 10 + h(i, 4, 6) * 8
        const ht = 5 + h(i, 5, 6) * 2.5
        const yaw = Math.floor(h(i, 6, 6) * 4) * Math.PI / 2 + (h(i, 7, 6) - 0.5) * 0.5
        const wall = 0x242a35
        b.add(box, wall, x, 0, z, w, ht, l, yaw)
        const broken = h(i, 8, 6) < 0.45
        // A whole roof, or one slope and a blown-out gable end.
        b.add(gable, 0x1d2129, x, ht, z, w + 0.8, 3 + h(i, 9, 6) * 1.6, broken ? l * 0.55 : l + 0.8, yaw)
        b.add(box, wall, x + Math.cos(yaw) * w * 0.3, ht, z - Math.sin(yaw) * w * 0.3, 1, 3.2, 1, yaw)
        if (h(i, 10, 6) < 0.55) {
            const lx = x + Math.sin(yaw) * (l / 2 + 0.05)
            const lz = z + Math.cos(yaw) * (l / 2 + 0.05)
            b.add(box, 0xffb45c, lx, 2.2, lz, 1.1, 1.3, 0.1, yaw, 0.85)
        }
        if (broken && h(i, 11, 6) < 0.5) b.add(cone4, 0xff7a2e, x, ht + 1, z, 1.6, 1.4, 1.6, yaw, 0.9)
    }

    // Two steeples, one with its spire shot away, and a factory chimney.
    for (const [a, d, snapped] of [[0.9, 78, false], [3.9, 84, true]] as const) {
        const [x, z] = ring(a, d)
        b.add(box, 0x262c38, x, 0, z, 6, 17, 6)
        b.add(box, 0x1d2129, x, 17, z, 6.6, 0.7, 6.6)
        if (snapped) b.add(cone4, 0x1d2129, x, 17.7, z, 2.2, 5, 2.2, Math.PI / 4)
        else b.add(cone4, 0x1d2129, x, 17.7, z, 4.4, 13, 4.4, Math.PI / 4)
        b.add(box, 0x0d1015, x + 0.0, 12, z + 3.05, 1.2, 3, 0.1) // a dark belfry opening
        b.add(box, 0x262c38, x - 5.5, 0, z + 1, 8, 8, 12)
    }
    for (const [a, d] of [[2.4, 88], [5.3, 94]] as const) {
        const [x, z] = ring(a, d)
        b.add(cyl, 0x232933, x, 0, z, 1.7, 30, 1.7)
        b.add(cyl, 0x232933, x, 30, z, 1.25, 3, 1.25)
        b.add(box, 0x232933, x + 6, 0, z, 9, 7, 7)
    }
    const geo = b.build()
    let skyline: THREE.Mesh | null = null
    if (geo) {
        skyline = new THREE.Mesh(geo, kit.mat)
        skyline.name = 'df-skyline'
        skyline.matrixAutoUpdate = false
        skyline.frustumCulled = false
        kit.root.add(skyline)
    }

    // Tethered observation balloons high over the lines, bobbing on their cables.
    const balloons: { mesh: THREE.Mesh, phase: number }[] = []
    for (const [bx, bz, by, phase] of [[-74, -62, 44, 0], [84, 38, 38, 2]] as const) {
        const bb = new Builder()
        bb.add(sphere, 0x59604a, 0, by, 0, 6.8, 2.5, 2.5)
        bb.add(box, 0x3d4334, -5.6, by - 0.1, 0, 2.6, 0.2, 4.4)
        bb.add(box, 0x3d4334, -5.6, by - 1.3, 0, 2.6, 2.6, 0.2)
        bb.add(box, 0x2a2118, 0, by - 3.6, 0, 1.1, 0.9, 1.1)
        bb.add(cyl, 0x14181a, 0, 0, 0, 0.07, by - 3.6, 0.07)
        const bg = bb.build()
        if (!bg) continue
        const mesh = new THREE.Mesh(bg, kit.mat)
        mesh.name = 'df-balloon'
        mesh.position.set(bx, 0, bz)
        mesh.rotation.y = phase * 0.7 + 0.5
        mesh.frustumCulled = false
        kit.root.add(mesh)
        balloons.push({ mesh, phase })
    }

    return {
        update(_dt, _world, time) {
            for (const bl of balloons) {
                bl.mesh.rotation.x = Math.sin(time * 0.35 + bl.phase) * 0.018
                bl.mesh.rotation.z = Math.cos(time * 0.27 + bl.phase) * 0.018
            }
        },
        dispose() {
            skyline?.removeFromParent()
            skyline?.geometry.dispose()
            for (const bl of balloons) {
                bl.mesh.removeFromParent()
                bl.mesh.geometry.dispose()
            }
            for (const g of [box, cone6, cone4, cyl, gable, sphere]) g.dispose()
        }
    }
}
