import { describe, it, expect } from 'vitest'
import {
    CALL_OF_XENO_MODIFIERS,
    callOfXenoPowerLive,
    roundModifier,
    type CallOfXenoModifier
} from '../../shared/utils/gamelogic/call-of-xeno'
import {
    CALL_OF_XENO_DOORS,
    CALL_OF_XENO_NODES,
    CALL_OF_XENO_EDGES,
    CALL_OF_XENO_RAMPS,
    CALL_OF_XENO_WINDOWS,
    CALL_OF_XENO_WINDOW_BARRIERS,
    CALL_OF_XENO_WINDOW_SLOT_RADIUS,
    windowApproachSlot,
    CALL_OF_XENO_SHELL,
    CALL_OF_XENO_SHELL_WALLS,
    CALL_OF_XENO_INTERACTABLES,
    CALL_OF_XENO_PLAYER_START,
    CALL_OF_XENO_UPPER_Y,
    CALL_OF_XENO_ATRIUM_HEIGHT,
    buildNavTable,
    nextHop,
    reachableNodes,
    collisionSolids,
    solidsInBand,
    groundHeight,
    resolveCircle,
    rampSurfaceAt,
    waypointFootingOk,
    CALL_OF_XENO_STEP_UP
} from '../../shared/utils/gamelogic/call-of-xeno-map'
import {
    buildNavGrid,
    findNavPath,
    CALL_OF_XENO_RAMP_LEVEL_BAND
} from '../../shared/utils/gamelogic/call-of-xeno-nav'
import {
    CALL_OF_XENO_DIFFICULTIES,
    callOfXenoBeatsBestRun,
    CALL_OF_XENO_ELAPSED_GRACE_MS,
    CALL_OF_XENO_MAX_GROSS,
    CALL_OF_XENO_MAX_PAYOUT,
    CALL_OF_XENO_MAX_PAYOUT_BASE,
    CALL_OF_XENO_RUN_COOLDOWN_MS,
    CALL_OF_XENO_UPGRADES,
    callOfXenoDifficulty,
    callOfXenoDifficultyUnlocked,
    callOfXenoMaxGrossForElapsedMs,
    callOfXenoPayoutForRun,
    callOfXenoRunCooldownRemainingMs,
    callOfXenoUpgradeCost,
    type CallOfXenoBestRounds
} from '../../shared/utils/gamelogic/call-of-xeno-meta'

const ALL_DOORS_OPEN = new Set(CALL_OF_XENO_DOORS.map(d => d.id))
const NO_DOORS = new Set<string>()
const OPEN_SOLIDS = collisionSolids(ALL_DOORS_OPEN)
const OPEN_TABLE = buildNavTable(ALL_DOORS_OPEN)
const OPEN_GRID = buildNavGrid(ALL_DOORS_OPEN)
const SHUT_GRID = buildNavGrid(NO_DOORS)

const PLAYER_RADIUS = 0.35
const ACTOR_HEIGHT = 1.8

/** How far a standing actor gets shoved when it is dropped at (x, z). */
function penetration(x: number, z: number, feetY = groundHeight(x, z, 0)) {
    const solved = resolveCircle(x, z, PLAYER_RADIUS, solidsInBand(OPEN_SOLIDS, feetY, ACTOR_HEIGHT))
    return Math.hypot(solved.x - x, solved.z - z)
}

describe('round modifiers', () => {
    it('takes the machines away for the round a blackout runs', () => {
        // The regression: blackout was wired to the lighting and nothing
        // else, so the perk machines and the Pack-a-Punch stood dark and
        // still sold all round — the one event meant to take them away left
        // them working.
        expect(callOfXenoPowerLive(true, 'blackout')).toBe(false)
        // Every other round the thrown switch is all that matters.
        expect(callOfXenoPowerLive(true, 'none')).toBe(true)
        expect(callOfXenoPowerLive(true, 'fog')).toBe(true)
        expect(callOfXenoPowerLive(true, 'frenzy')).toBe(true)
        // And before the switch is thrown nothing is live, blackout or not.
        for (const modifier of Object.keys(CALL_OF_XENO_MODIFIERS) as CallOfXenoModifier[]) {
            expect(callOfXenoPowerLive(false, modifier)).toBe(false)
        }
        // The schedule really does hand out blackout rounds.
        let seen = 0
        for (let round = 1; round <= 120; round++) if (roundModifier(round) === 'blackout') seen++
        expect(seen).toBeGreaterThan(0)
    })
})

describe('map', () => {
    it('does not start the player inside anything solid', () => {
        expect(penetration(CALL_OF_XENO_PLAYER_START.x, CALL_OF_XENO_PLAYER_START.z)).toBeLessThan(1e-9)
        expect(groundHeight(CALL_OF_XENO_PLAYER_START.x, CALL_OF_XENO_PLAYER_START.z, 0)).toBe(0)
    })

    it('keeps every prop reachable rather than buried in a wall', () => {
        for (const item of CALL_OF_XENO_INTERACTABLES) {
            // Stand a couple of metres out along the prop's facing — clear of
            // even the widest cabinet — and check there is floor to stand on.
            const x = item.x + Math.sin(item.facing) * 2.2
            const z = item.z + Math.cos(item.facing) * 2.2
            expect(penetration(x, z, item.y), item.id).toBeLessThan(1e-9)
        }
    })

    it('seals the building against anything trying to walk out of it', () => {
        // The window openings are see-through, so the shell can only be proved
        // solid at knee height: merge every shell segment that a walking actor
        // would collide with and check the four faces are covered end to end.
        const faces = [
            { axis: 'x' as const, at: CALL_OF_XENO_SHELL.minZ },
            { axis: 'x' as const, at: CALL_OF_XENO_SHELL.maxZ },
            { axis: 'z' as const, at: CALL_OF_XENO_SHELL.minX },
            { axis: 'z' as const, at: CALL_OF_XENO_SHELL.maxX }
        ]

        for (const face of faces) {
            const along = face.axis === 'x'
            const spans = CALL_OF_XENO_SHELL_WALLS
                .filter(w => (along
                    ? w.box.minZ <= face.at && w.box.maxZ >= face.at
                    : w.box.minX <= face.at && w.box.maxX >= face.at))
                .filter(w => w.baseY < 1.8 && w.baseY + w.height > 0.65)
                .map(w => along ? [w.box.minX, w.box.maxX] : [w.box.minZ, w.box.maxZ])
                .sort((a, b) => a[0]! - b[0]!)

            const from = along ? CALL_OF_XENO_SHELL.minX : CALL_OF_XENO_SHELL.minZ
            const to = along ? CALL_OF_XENO_SHELL.maxX : CALL_OF_XENO_SHELL.maxZ
            let covered = from
            for (const [lo, hi] of spans) {
                if (lo! > covered + 1e-9) break
                covered = Math.max(covered, hi!)
            }
            expect(covered, `face ${face.axis}=${face.at} has a hole at ${covered}`).toBeGreaterThanOrEqual(to)
        }
    })

    it('plugs every opening with a player-only barrier that blocks a jump through', () => {
        // One pane per window, spanning the full wall height: an
        // opening-sized pane drops out of the collision band the moment a
        // jump from nearby cover lifts the feet past its top, and the player
        // sails through the gap — the map-leak this replaced.
        expect(CALL_OF_XENO_WINDOW_BARRIERS).toHaveLength(CALL_OF_XENO_WINDOWS.length)
        for (const barrier of CALL_OF_XENO_WINDOW_BARRIERS) {
            expect(barrier.baseY).toBe(0)
            expect(barrier.height).toBe(CALL_OF_XENO_ATRIUM_HEIGHT)
            // Player-only: it never leaks into the set bullets and enemies use.
            expect(OPEN_SOLIDS.includes(barrier)).toBe(false)
        }
        // Mid-jump feet (~1.27) and crate-launched feet (~2.5) still collide.
        const panesAt = (feetY: number) => solidsInBand(CALL_OF_XENO_WINDOW_BARRIERS, feetY, ACTOR_HEIGHT)
        for (const feetY of [0, 1.27, 2.5, CALL_OF_XENO_UPPER_Y]) {
            expect(panesAt(feetY).length, `feetY ${feetY}`).toBe(CALL_OF_XENO_WINDOWS.length)
        }
    })

    it('gives every body queued at a window its own place to stand', () => {
        // The regression this guards: one shared approach point meant a
        // second arrival landed on top of the first, the separation pass
        // shoved both off it, and the barricade never got torn open.
        for (const window of CALL_OF_XENO_WINDOWS) {
            const slots = Array.from({ length: 8 }, (_, rank) => windowApproachSlot(window, rank))
            expect(slots[0]).toEqual({ x: window.outside.x, z: window.outside.z })
            for (let i = 0; i < slots.length; i++) {
                for (let j = i + 1; j < slots.length; j++) {
                    const gap = Math.hypot(slots[i]!.x - slots[j]!.x, slots[i]!.z - slots[j]!.z)
                    // Wider than the 1.35 the sim pushes two bodies apart by,
                    // and wider than two arrival discs.
                    expect(gap).toBeGreaterThan(0.9 * 1.5)
                    expect(gap).toBeGreaterThan(CALL_OF_XENO_WINDOW_SLOT_RADIUS * 2)
                }
            }
        }
    })
})

describe('navigation', () => {
    it('links every node into one graph once the loop is open', () => {
        for (let i = 0; i < CALL_OF_XENO_NODES.length; i++) {
            for (let j = 0; j < CALL_OF_XENO_NODES.length; j++) {
                expect(nextHop(OPEN_TABLE, i, j), `${i} -> ${j}`).not.toBe(-1)
            }
        }
    })

    it('keeps every navigation lane walkable, stairs included', () => {
        for (const [a, b] of CALL_OF_XENO_EDGES) {
            const from = CALL_OF_XENO_NODES[a]!
            const to = CALL_OF_XENO_NODES[b]!
            for (let i = 0; i <= 12; i++) {
                const t = i / 12
                const x = from.x + (to.x - from.x) * t
                const z = from.z + (to.z - from.z) * t
                const y = from.y + (to.y - from.y) * t
                const feet = groundHeight(x, z, y + 0.3)
                expect(Math.abs(feet - y), `edge ${a}-${b} at t=${t.toFixed(2)} floats`).toBeLessThan(0.7)
                expect(penetration(x, z, feet), `edge ${a}-${b} at t=${t.toFixed(2)} is blocked`).toBeLessThan(1e-9)
            }
        }
    })

    it('opens the map up door by door', () => {
        const open = new Set<string>()
        let previous = reachableNodes(buildNavTable(open), 0).size
        expect(previous).toBeLessThan(CALL_OF_XENO_NODES.length)
        for (const door of CALL_OF_XENO_DOORS) {
            open.add(door.id)
            const now = reachableNodes(buildNavTable(open), 0).size
            expect(now, `after ${door.id}`).toBeGreaterThanOrEqual(previous)
            previous = now
        }
        expect(previous).toBe(CALL_OF_XENO_NODES.length)
    })

    it('finds no route through a shut door and one once it is bought', () => {
        expect(findNavPath(SHUT_GRID, 17, 8, 0, 19, 8, 0, 0.45)).toBeNull()
        const path = findNavPath(OPEN_GRID, 17, 8, 0, 19, 8, 0, 0.45)
        expect(path).not.toBeNull()
        const last = path![path!.length - 1]!
        expect(Math.hypot(last.x - 19, last.z - 8)).toBeLessThan(1.5)
    })

    it('walks round to the foot of the stairs instead of climbing where it stands', () => {
        // The regression: every ramp cell used to stand in for both storeys,
        // so a route changed floor directly under the top of the flight — a
        // 4.5m step the body can never make. The pack pressed into the spot
        // below the landing and stalled there for the rest of the round.
        const starts: [string, number, number][] = [
            ['under the catwalk', 18, 20],
            ['mid atrium', 18, 26],
            ['beside the east flight', 30, 27],
            ['under the east flight', 32.3, 23.5],
            ['under the west flight', 3, 23.5]
        ]
        for (const [name, sx, sz] of starts) {
            const path = findNavPath(OPEN_GRID, sx, sz, 0, 18, 19, CALL_OF_XENO_UPPER_Y, 0.45)
            expect(path, `${name}: no route upstairs`).not.toBeNull()
            for (let i = 1; i < path!.length; i++) {
                const from = path![i - 1]!
                const to = path![i]!
                if (from.level === to.level) continue
                const surface = rampSurfaceAt(from.x, from.z)
                expect(surface, `${name}: changed storey off a flight`).not.toBeNull()
                expect(
                    Math.abs(surface! - CALL_OF_XENO_UPPER_Y / 2),
                    `${name}: changed storey ${surface!.toFixed(2)}m up, not at the crossover`
                ).toBeLessThanOrEqual(CALL_OF_XENO_RAMP_LEVEL_BAND)
            }
        }
    })

    it('only ticks off a step of the stairs once it is standing on them', () => {
        // The regression: waypoints retire at arm's length, but a body
        // walking to the foot of a flight is still out on the floor at that
        // range, where the steps are already too high to mount. It ticked the
        // waypoint off anyway, walked into the dead ground under the stairs,
        // got sent back by the next replan, and shuttled there forever.
        const ramp = CALL_OF_XENO_RAMPS[0]!
        const midX = (ramp.box.minX + ramp.box.maxX) / 2
        const mouthZ = ramp.lowAt - 0.6
        expect(rampSurfaceAt(midX, mouthZ)!).toBeLessThanOrEqual(CALL_OF_XENO_STEP_UP)

        const shortZ = mouthZ - 0.7
        expect(rampSurfaceAt(midX, shortZ)!).toBeGreaterThan(CALL_OF_XENO_STEP_UP)
        expect(waypointFootingOk(midX, shortZ, 0, midX, mouthZ)).toBe(false)

        const onStep = rampSurfaceAt(midX, mouthZ)!
        expect(waypointFootingOk(midX, mouthZ, onStep, midX, mouthZ)).toBe(true)
        // Waypoints off a flight are unaffected.
        expect(waypointFootingOk(18, 26, 0, 18, 26)).toBe(true)
    })
})

describe('meta progression', () => {
    const MIN = 60_000
    const noBest: CallOfXenoBestRounds = { recruit: 0, veteran: 0, survivor: 0, nightmare: 0 }
    const marathon = CALL_OF_XENO_ELAPSED_GRACE_MS + 10 * 60 * MIN

    it('charges an escalating price per level and nothing at max', () => {
        for (const def of CALL_OF_XENO_UPGRADES) {
            expect(callOfXenoUpgradeCost(def, 1)!).toBeGreaterThan(callOfXenoUpgradeCost(def, 0)!)
            expect(callOfXenoUpgradeCost(def, def.max)).toBeNull()
        }
    })

    it('ranks best runs by difficulty tier first, then depth', () => {
        expect(callOfXenoBeatsBestRun(3, 'recruit', 0, null)).toBe(true)
        expect(callOfXenoBeatsBestRun(0, 'recruit', 0, null)).toBe(false)
        expect(callOfXenoBeatsBestRun(15, 'veteran', 14, 'veteran')).toBe(true)
        expect(callOfXenoBeatsBestRun(14, 'veteran', 14, 'veteran')).toBe(false)
        expect(callOfXenoBeatsBestRun(5, 'survivor', 40, 'recruit')).toBe(true)
        expect(callOfXenoBeatsBestRun(40, 'recruit', 5, 'survivor')).toBe(false)
    })

    it('chains difficulty unlocks off the previous tier only', () => {
        expect(callOfXenoDifficultyUnlocked(CALL_OF_XENO_DIFFICULTIES[0]!, noBest)).toBe(true)
        expect(callOfXenoDifficultyUnlocked(CALL_OF_XENO_DIFFICULTIES[1]!, noBest)).toBe(false)
        const best = { ...noBest, recruit: 12 }
        expect(callOfXenoDifficultyUnlocked(CALL_OF_XENO_DIFFICULTIES[1]!, best)).toBe(true)
        expect(callOfXenoDifficultyUnlocked(CALL_OF_XENO_DIFFICULTIES[2]!, best)).toBe(false)
    })

    it('falls back to recruit for an unknown difficulty id', () => {
        expect(callOfXenoDifficulty('what').id).toBe('recruit')
    })

    it('clamps an absurd claim to the wall-clock ceiling', () => {
        const recruit = callOfXenoDifficulty('recruit')
        expect(callOfXenoMaxGrossForElapsedMs(0, recruit)).toBe(0)
        // Ten minutes of play (grace aside) cannot be worth 600k points.
        const quick = callOfXenoPayoutForRun(1_000_000_000, CALL_OF_XENO_ELAPSED_GRACE_MS + 10 * MIN, recruit, 3.25)
        expect(quick.counted).toBeLessThan(CALL_OF_XENO_MAX_GROSS)
        expect(quick.capped).toBe(true)
        expect(quick.awarded).toBeLessThanOrEqual(CALL_OF_XENO_MAX_PAYOUT)
    })

    it('gates the payout ceiling behind the Payout Contract and never passes the hard cap', () => {
        const nightmare = callOfXenoDifficulty('nightmare')
        expect(callOfXenoPayoutForRun(CALL_OF_XENO_MAX_GROSS, marathon, nightmare, 1).awarded).toBe(CALL_OF_XENO_MAX_PAYOUT_BASE)
        expect(callOfXenoPayoutForRun(CALL_OF_XENO_MAX_GROSS, marathon, nightmare, 2).awarded).toBe(CALL_OF_XENO_MAX_PAYOUT_BASE * 2)
        expect(callOfXenoPayoutForRun(CALL_OF_XENO_MAX_GROSS, marathon, nightmare, 3.25).awarded).toBe(CALL_OF_XENO_MAX_PAYOUT)
    })

    it('runs the cooldown off the last finish', () => {
        expect(callOfXenoRunCooldownRemainingMs(null, Date.now())).toBe(0)
        const finished = new Date(Date.now() - CALL_OF_XENO_RUN_COOLDOWN_MS + 5 * MIN)
        expect(callOfXenoRunCooldownRemainingMs(finished, Date.now())).toBeGreaterThan(4 * MIN)
        const done = new Date(Date.now() - CALL_OF_XENO_RUN_COOLDOWN_MS - 1)
        expect(callOfXenoRunCooldownRemainingMs(done, Date.now())).toBe(0)
    })
})
