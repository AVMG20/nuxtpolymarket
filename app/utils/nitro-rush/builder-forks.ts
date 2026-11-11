import { pieceAt } from '#shared/utils/nitro-rush/custom'
import type { LayoutWalk } from '#shared/utils/nitro-rush/layout'
import type { Track } from '#shared/utils/nitro-rush/track'

/** Which checkpoints every route of a forked course drives. */

/** How far a checkpoint's line may be from its section's in the compiled course and still be the one it lays. */
const SAME_LINE = 2

/** Each checkpoint section on line `line`, by section index: driven on every route, or one of several a lap can count. */
export function checkpointRoles(track: Track, walk: LayoutWalk, line: number): Map<number, 'required' | 'optional'> {
    const required = new Set(track.routes[0]?.checkpoints.filter(id => track.routes.every(r => r.checkpoints.includes(id))))
    const ours = track.lapLines.filter(l => l.kind === 'checkpoint' && l.branch === line)
    const roles = new Map<number, 'required' | 'optional'>()
    for (const block of walk.lines) {
        if (block.type !== 'checkpoint') continue
        const [x, z] = walk.pts[block.at] ?? [walk.end.x, walk.end.z]
        const lap = ours.find(l => Math.hypot(l.x - x, l.z - z) < SAME_LINE)
        if (lap) roles.set(pieceAt(walk, block.at), required.has(lap.id) ? 'required' : 'optional')
    }
    return roles
}
