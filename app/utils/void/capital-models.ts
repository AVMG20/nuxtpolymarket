// Void Runner — capital boss hulls. Each hull lives in its own file; this is
// what the fight needs to know about one: where things mount, what spins,
// and what shape a shot has to hit.

import type * as THREE from 'three'
import { buildTyrant } from './capital-tyrant'
import { buildHarbinger } from './capital-harbinger'

export interface CapitalMount {
    position: THREE.Vector3
    /** Outward direction: a turret's up, a silo's launch line, a hangar's way out. */
    normal: THREE.Vector3
}

/** Everything is in unscaled model units: nose down -Z, +Y up, mirrored across X. */
export interface CapitalModel {
    group: THREE.Group
    radius: number
    engines: { position: THREE.Vector3, radius: number }[]
    /** Open tubs for the gun batteries a pilot can destroy. */
    batteries: CapitalMount[]
    /** Armoured barbettes for the guns that never go quiet. */
    citadels: CapitalMount[]
    /** Sockets for shield pylons; empty on a hull with no shield. */
    pylons: CapitalMount[]
    /** Storm rocket silo mouths. */
    silos: CapitalMount[]
    hangars: CapitalMount[]
    /** The Tyrant's stern furnace or the Harbinger's singularity core. */
    core: THREE.Vector3
    /** Parts that turn around their own local Z, in radians per second. */
    rotors: { object: THREE.Object3D, speed: number }[]
    /** Pieces the death sequence throws clear of the hull. */
    debris: THREE.Object3D[]
    /** Is a point inside the hull? Shots are marched against this. */
    inside: (x: number, y: number, z: number) => boolean
    /** Spheres that keep the pilot out of the hull: x, y, z, radius. */
    keepOut: [number, number, number, number][]
}

export type CapitalId = 'tyrant' | 'harbinger'

export function buildCapital(id: CapitalId, glow: number): CapitalModel {
    return id === 'tyrant' ? buildTyrant(glow) : buildHarbinger(glow)
}
