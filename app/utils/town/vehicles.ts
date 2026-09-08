// Polytown — road traffic. Cars and trucks are pure decoration: they drive the
// road network, are never picked, and never cast a shadow (the scene redraws
// its shadow map only when something changes, so a moving caster would smear).
// Everything is built in world scale — one road tile is 1 unit — from a couple
// of shared geometries, so spawning a vehicle costs a handful of cheap meshes
// and no new buffers.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { townMaterial, shade } from './models'

const BOX = new THREE.BoxGeometry(1, 1, 1)
/** A wheel: the cylinder is baked lying on its side so its axle runs along x. */
const WHEEL = new THREE.CylinderGeometry(0.5, 0.5, 1, 12)
WHEEL.rotateZ(Math.PI / 2)

const TYRE = 0x1f2226
const HUB = 0x9aa3ab
const GLASS = 0x30414f
const CRATE = 0x9c6a3c
const CRATE_DARK = 0x6f4726
const LIGHT = 0xfff0c2

/** Paint jobs picked from at spawn. Bright enough to read at a distance. */
export const TOWN_VEHICLE_COLORS = [
    0xb95046, 0x5f8e9d, 0xd4b75d, 0x947b91, 0x5e9c88,
    0xc78550, 0x728959, 0xe4dcc6, 0x4d6064, 0xc58e8c
]

/**
 * Parts below are modelled at a comfortable-to-read scale and the finished
 * group is shrunk by this factor, so two vehicles fit abreast on a one-tile
 * road with clearance either side and still read as a car and a lorry.
 */
const VEHICLE_SCALE = 0.6

/**
 * Finished world footprint, wing mirrors — well, wheel hubs — included. The
 * scene spaces queueing traffic on these lengths and picks its lane offset so
 * two widths plus a gap fit inside one tile.
 */
export const TOWN_VEHICLE_SIZE = {
    car: { length: 0.57 * VEHICLE_SCALE, width: 0.36 * VEHICLE_SCALE },
    truck: { length: 0.89 * VEHICLE_SCALE, width: 0.37 * VEHICLE_SCALE }
} as const

const prototypes = new Map<string, THREE.Group>()
function finishVehicle(key: string, group: THREE.Group): THREE.Group {
    const batches = new Map<THREE.Material, THREE.BufferGeometry[]>()
    for (const child of group.children) {
        if (!(child instanceof THREE.Mesh)) continue
        child.updateMatrix()
        const material = child.material as THREE.Material
        const pieces = batches.get(material) ?? []
        pieces.push(child.geometry.clone().applyMatrix4(child.matrix))
        batches.set(material, pieces)
    }
    group.clear()
    for (const [material, pieces] of batches) {
        const merged = mergeGeometries(pieces)!
        pieces.forEach(piece => piece.dispose())
        group.add(new THREE.Mesh(merged, material))
    }
    prototypes.set(key, group)
    return group.clone(true)
}

/** A box part. `y` is the bottom of the part, so shapes stack naturally. */
function box(g: THREE.Group, color: number, x: number, y: number, z: number, w: number, h: number, d: number) {
    const mesh = new THREE.Mesh(BOX, townMaterial(color))
    mesh.position.set(x, y + h / 2, z)
    mesh.scale.set(w, h, d)
    g.add(mesh)
}

/** A wheel resting on the ground at (x, z). */
function wheel(g: THREE.Group, x: number, z: number, radius: number, width: number) {
    const tyre = new THREE.Mesh(WHEEL, townMaterial(TYRE))
    tyre.position.set(x, radius, z)
    tyre.scale.set(width, radius * 2, radius * 2)
    g.add(tyre)
    const cap = new THREE.Mesh(WHEEL, townMaterial(HUB))
    cap.position.set(x + Math.sign(x) * width * 0.55, radius, z)
    cap.scale.set(width * 0.16, radius * 0.9, radius * 0.9)
    g.add(cap)
}

/**
 * A small hatchback, nose pointing at +z. Finished size is 0.34 × 0.22 tiles,
 * so two fit abreast on a one-tile road with a clear gap down the middle.
 */
export function createCar(color: number): THREE.Group {
    const key = `car:${color}`
    if (prototypes.has(key)) return prototypes.get(key)!.clone(true)
    const g = new THREE.Group()
    g.scale.setScalar(VEHICLE_SCALE)
    const trim = shade(color, -0.12)
    box(g, color, 0, 0.05, 0, 0.28, 0.10, 0.56)
    box(g, trim, 0, 0.04, 0, 0.30, 0.03, 0.50)
    box(g, color, 0, 0.15, -0.03, 0.24, 0.09, 0.28)
    box(g, GLASS, 0, 0.155, -0.03, 0.26, 0.06, 0.24)
    // Contrasting roof, window pillars, door handles and chrome bumpers.
    box(g, 0xe0dac7, 0, 0.222, -0.03, 0.245, 0.024, 0.265)
    box(g, HUB, 0, 0.069, 0.277, 0.27, 0.019, 0.014)
    box(g, HUB, 0, 0.069, -0.277, 0.27, 0.019, 0.014)
    box(g, TYRE, 0, 0.10, 0.280, 0.075, 0.032, 0.008)
    for (const side of [-1, 1]) {
        for (const z of [-0.14, -0.025, 0.075]) box(g, color, side * 0.132, 0.15, z, 0.012, 0.073, 0.013)
        box(g, HUB, side * 0.143, 0.127, -0.015, 0.008, 0.009, 0.039)
        box(g, color, side * 0.161, 0.156, 0.075, 0.026, 0.025, 0.035)
        box(g, HUB, side * 0.15, 0.063, 0, 0.014, 0.012, 0.41)
    }
    // Headlights and tail lights.
    for (const x of [-0.09, 0.09]) {
        box(g, LIGHT, x, 0.09, 0.274, 0.06, 0.03, 0.02)
        box(g, 0xd0453c, x, 0.09, -0.274, 0.06, 0.03, 0.02)
    }
    wheel(g, -0.145, 0.17, 0.05, 0.05)
    wheel(g, 0.145, 0.17, 0.05, 0.05)
    wheel(g, -0.145, -0.17, 0.05, 0.05)
    wheel(g, 0.145, -0.17, 0.05, 0.05)
    return finishVehicle(key, g)
}

/**
 * A cab-over lorry with an open bed and a stack of crates on it, nose pointing
 * at +z. Finished size is 0.53 × 0.22 tiles — half a tile of road.
 */
export function createTruck(color: number): THREE.Group {
    const key = `truck:${color}`
    if (prototypes.has(key)) return prototypes.get(key)!.clone(true)
    const g = new THREE.Group()
    g.scale.setScalar(VEHICLE_SCALE)
    const trim = shade(color, -0.14)
    // Chassis running the whole length, then the cab up front.
    box(g, trim, 0, 0.055, -0.02, 0.28, 0.05, 0.86)
    box(g, color, 0, 0.10, 0.28, 0.30, 0.20, 0.28)
    box(g, GLASS, 0, 0.18, 0.29, 0.32, 0.09, 0.26)
    box(g, trim, 0, 0.055, 0.28, 0.32, 0.05, 0.30)
    for (const x of [-0.10, 0.10]) box(g, LIGHT, x, 0.09, 0.425, 0.06, 0.04, 0.02)
    box(g, 0xe0dac7, 0, 0.273, 0.28, 0.32, 0.026, 0.28)
    box(g, color, 0, 0.18, 0.425, 0.017, 0.09, 0.011)
    box(g, TYRE, 0, 0.113, 0.43, 0.14, 0.056, 0.012)
    for (let i = 0; i < 4; i++) box(g, HUB, 0, 0.12 + i * 0.012, 0.437, 0.13, 0.004, 0.005)
    for (const side of [-1, 1]) {
        box(g, color, side * 0.16, 0.18, 0.29, 0.016, 0.09, 0.014)
        box(g, HUB, side * 0.173, 0.20, 0.36, 0.02, 0.046, 0.037)
        box(g, HUB, side * 0.16, 0.15, 0.27, 0.008, 0.01, 0.055)
    }
    // Open cargo bed: floor, low side walls, tailgate.
    box(g, trim, 0, 0.105, -0.16, 0.30, 0.02, 0.52)
    for (const x of [-0.145, 0.145]) box(g, color, x, 0.105, -0.16, 0.02, 0.10, 0.52)
    box(g, color, 0, 0.105, -0.41, 0.30, 0.10, 0.02)
    // The load — a couple of crates so the bed is visibly carrying something.
    box(g, CRATE, -0.07, 0.125, -0.28, 0.13, 0.14, 0.15)
    box(g, CRATE_DARK, 0.07, 0.125, -0.26, 0.12, 0.11, 0.17)
    box(g, CRATE, 0.0, 0.125, -0.05, 0.16, 0.17, 0.16)
    for (const side of [-1, 1]) {
        for (const z of [-0.36, -0.19, -0.02]) box(g, HUB, side * 0.158, 0.11, z, 0.012, 0.09, 0.014)
        box(g, 0xb74e3f, side * 0.11, 0.09, -0.445, 0.05, 0.025, 0.01)
    }
    for (const [x, y, z, w, d] of [[-0.07, 0.125, -0.28, 0.13, 0.15], [0.07, 0.125, -0.26, 0.12, 0.17], [0, 0.125, -0.05, 0.16, 0.16]]) {
        for (const side of [-1, 1]) box(g, CRATE_DARK, x! + side * w! * 0.3, y!, z!, 0.014, 0.16, d! + 0.005)
    }
    wheel(g, -0.15, 0.28, 0.055, 0.055)
    wheel(g, 0.15, 0.28, 0.055, 0.055)
    wheel(g, -0.15, -0.10, 0.055, 0.055)
    wheel(g, 0.15, -0.10, 0.055, 0.055)
    wheel(g, -0.15, -0.30, 0.055, 0.055)
    wheel(g, 0.15, -0.30, 0.055, 0.055)
    return finishVehicle(key, g)
}
