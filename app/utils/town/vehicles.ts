// Polytown — road traffic. Cars and trucks are pure decoration: they drive the
// road network, are never picked, and never cast a shadow (the scene redraws
// its shadow map only when something changes, so a moving caster would smear).
// Everything is built in world scale — one road tile is 1 unit — from a couple
// of shared geometries, so spawning a vehicle costs a handful of cheap meshes
// and no new buffers.

import * as THREE from 'three'
import { townMaterial, shade } from './models'

const BOX = new THREE.BoxGeometry(1, 1, 1)
/** A wheel: the cylinder is baked lying on its side so its axle runs along x. */
const WHEEL = new THREE.CylinderGeometry(0.5, 0.5, 1, 8)
WHEEL.rotateZ(Math.PI / 2)

const TYRE = 0x1f2226
const HUB = 0x9aa3ab
const GLASS = 0x30414f
const CRATE = 0x9c6a3c
const CRATE_DARK = 0x6f4726
const LIGHT = 0xfff0c2

/** Paint jobs picked from at spawn. Bright enough to read at a distance. */
export const TOWN_VEHICLE_COLORS = [
    0xe74c3c, 0x3498db, 0xf1c40f, 0x9b59b6, 0x1abc9c,
    0xe67e22, 0x2ecc71, 0xecf0f1, 0x34495e, 0xff7fa5
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
    cap.scale.set(width * 0.25, radius * 0.9, radius * 0.9)
    g.add(cap)
}

/**
 * A small hatchback, nose pointing at +z. Finished size is 0.34 × 0.22 tiles,
 * so two fit abreast on a one-tile road with a clear gap down the middle.
 */
export function createCar(color: number): THREE.Group {
    const g = new THREE.Group()
    g.scale.setScalar(VEHICLE_SCALE)
    const trim = shade(color, -0.12)
    box(g, color, 0, 0.05, 0, 0.28, 0.10, 0.56)
    box(g, trim, 0, 0.04, 0, 0.30, 0.03, 0.50)
    box(g, color, 0, 0.15, -0.03, 0.24, 0.09, 0.28)
    box(g, GLASS, 0, 0.155, -0.03, 0.26, 0.06, 0.24)
    // Headlights and tail lights.
    for (const x of [-0.09, 0.09]) {
        box(g, LIGHT, x, 0.09, 0.275, 0.06, 0.03, 0.02)
        box(g, 0xd0453c, x, 0.09, -0.275, 0.06, 0.03, 0.02)
    }
    wheel(g, -0.145, 0.17, 0.05, 0.05)
    wheel(g, 0.145, 0.17, 0.05, 0.05)
    wheel(g, -0.145, -0.17, 0.05, 0.05)
    wheel(g, 0.145, -0.17, 0.05, 0.05)
    return g
}

/**
 * A cab-over lorry with an open bed and a stack of crates on it, nose pointing
 * at +z. Finished size is 0.53 × 0.22 tiles — half a tile of road.
 */
export function createTruck(color: number): THREE.Group {
    const g = new THREE.Group()
    g.scale.setScalar(VEHICLE_SCALE)
    const trim = shade(color, -0.14)
    // Chassis running the whole length, then the cab up front.
    box(g, trim, 0, 0.055, -0.02, 0.28, 0.05, 0.86)
    box(g, color, 0, 0.10, 0.28, 0.30, 0.20, 0.28)
    box(g, GLASS, 0, 0.18, 0.29, 0.32, 0.09, 0.26)
    box(g, trim, 0, 0.055, 0.28, 0.32, 0.05, 0.30)
    for (const x of [-0.10, 0.10]) box(g, LIGHT, x, 0.09, 0.425, 0.06, 0.04, 0.02)
    // Open cargo bed: floor, low side walls, tailgate.
    box(g, trim, 0, 0.105, -0.16, 0.30, 0.02, 0.52)
    for (const x of [-0.145, 0.145]) box(g, color, x, 0.105, -0.16, 0.02, 0.10, 0.52)
    box(g, color, 0, 0.105, -0.41, 0.30, 0.10, 0.02)
    // The load — a couple of crates so the bed is visibly carrying something.
    box(g, CRATE, -0.07, 0.125, -0.28, 0.13, 0.14, 0.15)
    box(g, CRATE_DARK, 0.07, 0.125, -0.26, 0.12, 0.11, 0.17)
    box(g, CRATE, 0.0, 0.125, -0.05, 0.16, 0.17, 0.16)
    wheel(g, -0.15, 0.28, 0.055, 0.055)
    wheel(g, 0.15, 0.28, 0.055, 0.055)
    wheel(g, -0.15, -0.10, 0.055, 0.055)
    wheel(g, 0.15, -0.10, 0.055, 0.055)
    wheel(g, -0.15, -0.30, 0.055, 0.055)
    wheel(g, 0.15, -0.30, 0.055, 0.055)
    return g
}
