/**
 * Rail Tycoon route-search timing: the hostile-client spec's junction maze (a 64 map gridded with
 * full junctions, 100 trains ordered to a station they cannot reach, the maze cut into islands), stepped
 * for a number of ticks. Prints the step time against the room's per-step budget, the pathfinder nodes
 * used, and the world hash, so a faster pathfinder can be shown to route exactly as before.
 *
 *   bun scripts/rail-tycoon/pathfinder-bench.ts [ticks=600]
 */
import { RT_CATALOG } from '../../shared/utils/rail-tycoon/catalog'
import { applyCommand, RtCommandKind as K, type RtCommand } from '../../shared/utils/rail-tycoon/commands'
import { RtDir } from '../../shared/utils/rail-tycoon/map'
import { RtAxis } from '../../shared/utils/rail-tycoon/stations-build'
import { RtTrack, rtTrackdirOf } from '../../shared/utils/rail-tycoon/track'
import { RtOrderKind, RtVehicleKind } from '../../shared/utils/rail-tycoon/types'
import { RtWorld, rtNewCompany } from '../../shared/utils/rail-tycoon/world'

const SIDE = 64
const OWNER = 1
const ENGINE = RT_CATALOG.vehicles.models.expressEngine.index
const EAST = rtTrackdirOf(RtTrack.x, true)
const at = (x: number, y: number) => y * SIDE + x

function must(world: RtWorld, command: RtCommand) {
    const result = applyCommand(world, OWNER, command, true)
    if (!result.ok) throw new Error(`setup command ${command.kind} refused (${result.error})`)
    return result
}

function mazeWorld(): RtWorld {
    const world = RtWorld.empty({ side: SIDE, maxCompanies: 8, sharing: false }, {
        rngState: 7,
        companies: [rtNewCompany(0, 'Honest', 0, 0), rtNewCompany(OWNER, 'Maze', 1, 0)]
    })
    world.company(OWNER)!.money = 100_000_000
    for (let y = 6; y <= 58; y += 4) must(world, { kind: K.buildRailLine, tile: at(4, y), endTile: at(60, y), trackdir: EAST })
    for (let x = 6; x <= 58; x += 4) {
        for (let y = 4; y <= 60; y++) applyCommand(world, OWNER, { kind: K.buildRail, tile: at(x, y), piece: RtTrack.y }, true)
    }
    for (let y = 6; y <= 58; y += 4) {
        for (let x = 6; x <= 58; x += 4) {
            for (const piece of [2, 3, 4, 5]) applyCommand(world, OWNER, { kind: K.buildRail, tile: at(x, y), piece }, true)
        }
    }
    const station = must(world, { kind: K.buildRailStation, tile: at(30, 62), axis: RtAxis.x, tracks: 1, length: 3 }).id!
    const trains: number[] = []
    for (let y = 6; y <= 58 && trains.length < 100; y += 4) {
        must(world, { kind: K.buildDepot, tile: at(3, y), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
        for (let k = 0; k < 8 && trains.length < 100; k++) {
            trains.push(must(world, { kind: K.buyVehicle, depot: at(3, y), model: ENGINE, wagons: [] }).id!)
        }
    }
    for (const id of trains) {
        must(world, { kind: K.setOrders, vehicle: id, orders: [{ kind: RtOrderKind.gotoStation, target: station, flags: 0 }] })
        must(world, { kind: K.startStop, vehicle: id, stopped: false })
    }
    for (let x = 8; x <= 56; x += 8) must(world, { kind: K.removeRail, tile: at(x, 30), piece: RtTrack.x })
    return world
}

const ticks = Number(process.argv[2] ?? 600)
const world = mazeWorld()
const times: number[] = []
const used: number[] = []
let nodes = 0
let maxNodes = 0
for (let k = 0; k < ticks; k++) {
    const started = performance.now()
    world.step()
    times.push(performance.now() - started)
    used.push(world.pathNodesPerTick - world.pathNodesLeft)
    nodes += used[k]!
    maxNodes = Math.max(maxNodes, used[k]!)
}
const slowest = times.map((ms, k) => ({ ms, k })).sort((a, b) => b.ms - a.ms).slice(0, 5)
console.log(`slowest steps: ${slowest.map(s => `#${s.k} ${s.ms.toFixed(1)} ms ${used[s.k]} nodes`).join(', ')}`)
console.log(`steps over 10 ms: ${times.filter(ms => ms > 10).length}`)
const sorted = [...times].sort((a, b) => a - b)
const total = times.reduce((a, b) => a + b, 0)
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!.toFixed(2)
console.log(`${ticks} steps, budget ${RT_CATALOG.pathfinder.pathNodesPerTick} nodes and ${RT_CATALOG.time.tickMs} ms per step`)
console.log(`step ms: mean ${(total / ticks).toFixed(2)}, p50 ${pct(0.5)}, p95 ${pct(0.95)}, max ${sorted[sorted.length - 1]!.toFixed(2)}`)
console.log(`nodes: ${nodes} total, max ${maxNodes} in one step, ${((total * 1000) / Math.max(1, nodes)).toFixed(2)} us per node`)
console.log(`hash ${world.hash()} at tick ${world.tick}`)
