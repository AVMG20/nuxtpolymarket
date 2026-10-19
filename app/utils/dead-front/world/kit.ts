import type * as THREE from 'three'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import type { DfMapWorld } from '#shared/utils/dead-front/map-world'
import type { DfCollisionWorld } from '#shared/utils/dead-front/physics'
import type { DfEvent, DfWorldSnap } from '#shared/utils/dead-front/protocol'
import type { Vec3 } from '#shared/utils/dead-front/types'
import type { DfRenderContext } from '../context'
import type { DfVoxMaterial } from '../voxel/material'

// What every world view part gets: the render context, the map (and its
// voxel source), the shared voxel material and a little shared state.

export interface DfWorldState {
    /** Power is on (server state). */
    powerOn: boolean
    /** Visual power level 0..1, ramps with a flickering surge after the switch is thrown. */
    power: number
    /** Seconds since the power came on (0 before). */
    powerAge: number
    time: number
}

export interface DfWorldKit {
    ctx: DfRenderContext
    map: DfMapDef
    world: DfMapWorld
    /** Everything the world view adds goes under this group. */
    root: THREE.Group
    /** The shared voxel material (static props, machines). */
    mat: DfVoxMaterial
    /** Collision with every door closed, for placement queries (box beam height, fuse glow). */
    collision: DfCollisionWorld
    quality: 'low' | 'high'
    /** Props cast shadows (high quality only). */
    shadows: boolean
    state: DfWorldState
    /**
     * Seconds after the switch is thrown before the power reaches (x, z): the
     * surge spreads out from the power switch, zone by zone.
     */
    powerDelay(x: number, z: number): number
    /** Spatial sound helper. */
    play(name: string, pos?: Vec3 | THREE.Vector3, volume?: number, rate?: number): void
}

export interface DfWorldPart {
    update(dt: number, world: DfWorldSnap, time: number): void
    onEvent?(ev: DfEvent): void
    dispose(): void
}
