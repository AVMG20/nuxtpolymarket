import type { DfSpot } from './map'

// The workbenches of Sainte-Croix: a trestle bench against the north wall of
// the Square (in reach from the start, between the Quickhand machine and the
// east corner) and one against the town wall in the Ramparts bailey, by the
// Arc Generator. `pos` is the bench's footprint centre on the floor, `yaw`
// faces the side it is worked from (forward = sin yaw, cos yaw).

/** Footprint of a bench: along the wall, out from it, height. */
export const DF_BENCH_SIZE = { along: 1.9, depth: 0.8, height: 0.95 } as const

export function dfMapBenches(): DfSpot[] {
    return [
        { id: 'bench-square', pos: { x: 16.5, y: 0, z: 2.4 }, yaw: 0, zone: 'square' },
        { id: 'bench-ramparts', pos: { x: 21.4, y: 0, z: 10 }, yaw: Math.PI / 2, zone: 'ramparts' }
    ]
}

/** Where a player stands to work a bench (in front of it, for the use check and prompts). */
export function dfBenchUsePoint(b: DfSpot): { x: number, y: number, z: number } {
    const f = DF_BENCH_SIZE.depth / 2 + 0.55
    return { x: b.pos.x + Math.sin(b.yaw) * f, y: b.pos.y, z: b.pos.z + Math.cos(b.yaw) * f }
}
