import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { FACADE_TILE, facadeTextures, type FacadeKind } from './textures'
import type { WorldKit } from './world-kit'
import { newProjection } from '#shared/utils/nitro-rush/track'

/** A building's walls (facade texture tiled at a fixed scale) and its roof, as separate geometries for merging. */
function buildingParts(w: number, h: number, d: number) {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(0, h / 2, 0)
    const uv = g.attributes.uv!
    // Box faces in order: +x, -x, +y, -y, +z, -z; four vertices each.
    const faceW = [d, d, w, w, w, w]
    for (let f = 0; f < 6; f++) {
        if (f === 2 || f === 3) continue
        for (let v = 0; v < 4; v++) {
            const i = f * 4 + v
            uv.setXY(i, uv.getX(i) * faceW[f]! / FACADE_TILE, uv.getY(i) * h / FACADE_TILE)
        }
    }
    const pick = (faces: number[]) => {
        const part = new THREE.BufferGeometry()
        for (const name of ['position', 'normal', 'uv']) part.setAttribute(name, g.attributes[name]!.clone())
        const src = g.index!.array
        const idx: number[] = []
        for (const f of faces) {
            for (let k = 0; k < 6; k++) idx.push(src[f * 6 + k]!)
        }
        part.setIndex(idx)
        return part
    }
    const parts = { walls: pick([0, 1, 4, 5]), roof: pick([2]) }
    g.dispose()
    return parts
}

/** City blocks on a loose grid, clear of the circuit and of ground `covered` claims; returns the rooftop beacons' material. */
export function buildCity({ track, own, add, instanced }: WorldKit, covered: (x: number, z: number) => boolean) {
    const wall = track.wallOffset
    const kinds: FacadeKind[] = ['office', 'glass', 'residential', 'brick']
    const facadeMats = kinds.map((kind) => {
        const t = facadeTextures(kind)
        own(t.map)
        own(t.emissiveMap)
        own(t.roughnessMap)
        return own(new THREE.MeshStandardMaterial({
            map: t.map, emissiveMap: t.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.1, roughnessMap: t.roughnessMap,
            roughness: 1, metalness: kind === 'glass' ? 0.7 : 0.1, envMapIntensity: kind === 'glass' ? 1.2 : 0.5
        }))
    })
    const wallsByKind: THREE.BufferGeometry[][] = kinds.map(() => [])
    const roofs: THREE.BufferGeometry[] = []
    const beaconSpots: THREE.Vector3[] = []
    const proj = newProjection()
    const CELL = 36
    for (let gx = -12; gx <= 12; gx++) {
        for (let gz = -16; gz <= 16; gz++) {
            const x = gx * CELL + (Math.random() - 0.5) * 10
            const z = gz * CELL + (Math.random() - 0.5) * 10
            const away = Math.abs(track.project(x, z, -1, proj).lateral)
            if (away < wall + 42 || away > 340) continue
            if (covered(x, z)) continue
            const w = 14 + Math.random() * 14
            const d = 14 + Math.random() * 14
            const h = 12 + Math.random() * Math.random() * 110
            const kind = Math.floor(Math.random() * kinds.length)
            const parts = buildingParts(w, h, d)
            const m = new THREE.Matrix4().makeRotationY(Math.floor(Math.random() * 4) * Math.PI / 2).setPosition(x, 0, z)
            wallsByKind[kind]!.push(parts.walls.applyMatrix4(m))
            roofs.push(parts.roof.applyMatrix4(m))
            if (h > 60) beaconSpots.push(new THREE.Vector3(x, h + 0.3, z))
        }
    }
    wallsByKind.forEach((geos, k) => {
        if (!geos.length) return
        add(mergeGeometries(geos)!, facadeMats[k]!)
        for (const g of geos) g.dispose()
    })
    if (roofs.length) {
        add(mergeGeometries(roofs)!, own(new THREE.MeshStandardMaterial({ color: 0x24252a, roughness: 0.9 })))
        for (const g of roofs) g.dispose()
    }
    const beaconMat = own(new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 4 }))
    if (beaconSpots.length) {
        const beacons = instanced(new THREE.SphereGeometry(0.4, 8, 6), beaconMat, beaconSpots.length)
        const dummy = new THREE.Object3D()
        beaconSpots.forEach((p, i) => {
            dummy.position.copy(p)
            dummy.rotation.set(0, 0, 0)
            dummy.updateMatrix()
            beacons.setMatrixAt(i, dummy.matrix)
        })
    }
    return beaconMat
}

/**
 * A night-street reflection environment for paint and glass: a dark street
 * canyon with rows of sodium and LED lamps overhead, lit windows and signage
 * along the sides, and a dim sky above. Baked once into a PMREM map.
 */
export function buildCityEnvironment(renderer: THREE.WebGLRenderer) {
    const scene = new THREE.Scene()
    const disposables: { dispose(): void }[] = []
    const own = <T extends { dispose(): void }>(x: T) => {
        disposables.push(x)
        return x
    }
    const room = new THREE.Mesh(own(new THREE.BoxGeometry(60, 30, 60)), own(new THREE.MeshBasicMaterial({ color: 0x07080c, side: THREE.BackSide })))
    room.position.y = 12
    scene.add(room)
    const panel = (color: number, intensity: number, w: number, h: number, x: number, y: number, z: number, ry = 0, rx = 0) => {
        const m = new THREE.Mesh(own(new THREE.PlaneGeometry(w, h)), own(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })))
        m.position.set(x, y, z)
        m.rotation.set(rx, ry, 0)
        scene.add(m)
    }
    // Sky glow overhead.
    panel(0x1a2238, 1, 60, 60, 0, 26.9, 0, 0, Math.PI / 2)
    // Rows of floodlights overhead.
    for (let z = -26; z <= 26; z += 6.5) {
        panel(0xffd2a0, 6, 1.6, 0.5, -5, 14, z, 0, Math.PI / 2)
        panel(0xdfe9ff, 5, 1.6, 0.5, 5, 14, z + 3, 0, Math.PI / 2)
    }
    // Lit windows and signs on the canyon walls.
    const colors = [0xffd9a0, 0xcfe6ff, 0xffc77a, 0xff3db8, 0x33f0ff, 0xffffff]
    for (let i = 0; i < 70; i++) {
        const side = i % 2 === 0 ? -1 : 1
        const c = colors[Math.floor(Math.random() * colors.length)]!
        const neon = c === 0xff3db8 || c === 0x33f0ff
        panel(c, neon ? 3 : 1.2 + Math.random(), 1 + Math.random() * (neon ? 4 : 2), 0.6 + Math.random() * 1.5, side * 29.8, 2 + Math.random() * 20, -28 + Math.random() * 56, side * Math.PI / 2)
    }
    // A bright horizon strip ahead and behind, where the road meets the city glow.
    panel(0x3a2a40, 2, 60, 6, 0, 3, -29.8)
    panel(0x2a2030, 1.5, 60, 6, 0, 3, 29.8, Math.PI)
    const pmrem = new THREE.PMREMGenerator(renderer)
    const target = pmrem.fromScene(scene, 0.02)
    pmrem.dispose()
    for (const d of disposables) d.dispose()
    return target
}
