import type { DfTrap } from './specials'
import type { Vec3 } from './types'

// The electric traps of Sainte-Croix: the two gateways the horde funnels
// through once the ring is open. Each passage is a 3 m gap in a 1 m wall
// (the Churchyard rubble between the farm and the chapel, the Cemetery Gate
// between the ramparts and the graves). The lever hangs on the wall beside
// the gap on the side you reach first; coils sit on the wall faces either
// side of the opening, so the arcs leap across the whole passage.

function v(x: number, y: number, z: number): Vec3 {
    return { x, y, z }
}

export function dfMapTraps(): DfTrap[] {
    return [
        {
            id: 'trap-churchyard',
            label: 'Churchyard Passage',
            zone: 'farm',
            door: 'door-chapel',
            // farm side of the wall (z = -9..-8), west of the gap (x = -28..-25)
            lever: { pos: v(-30, 0, -8), yaw: 0 },
            area: { min: v(-28, 0, -10.4), max: v(-25, 2.6, -6.6) },
            coils: [
                [v(-28.3, 1.35, -7.86), v(-24.7, 1.35, -7.86)],
                [v(-28.3, 1.35, -9.14), v(-24.7, 1.35, -9.14)]
            ]
        },
        {
            id: 'trap-cemetery',
            label: 'Cemetery Gate',
            zone: 'ramparts',
            door: 'door-cemetery',
            // rampart side of the wall (z = -9..-8), west of the gate pillars (x = 26.5..27)
            lever: { pos: v(25.2, 0, -8), yaw: 0 },
            area: { min: v(27, 0, -10.4), max: v(30, 2.6, -6.6) },
            coils: [
                [v(26.75, 1.35, -7.36), v(30.25, 1.35, -7.36)],
                [v(26.75, 1.35, -9.64), v(30.25, 1.35, -9.64)]
            ]
        }
    ]
}
