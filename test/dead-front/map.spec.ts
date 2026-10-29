import { describe, expect, it } from 'vitest'
import { DF_MAP, DF_UPPER_Y, dfInteractables } from '../../shared/utils/dead-front/map'
import type { DfNavNode } from '../../shared/utils/dead-front/map'
import { dfBodyFits, dfBuildCollision, dfGroundHeight, dfMoveBody, dfRaycast } from '../../shared/utils/dead-front/physics'
import { DF_PERK_IDS } from '../../shared/utils/dead-front/perks'
import { DF_MAX_PLAYERS, DF_PLAYER } from '../../shared/utils/dead-front/constants'
import type { Vec3 } from '../../shared/utils/dead-front/types'

const map = DF_MAP
const allOpen = new Set(map.doors.map(d => d.id))
const openWorld = dfBuildCollision(map, allOpen)
const closedWorld = dfBuildCollision(map, new Set())
const zoneIds = new Set(map.zones.map(z => z.id))
const nodes = map.nav.nodes

function reachable(from: number, opts: { doors: boolean, windows: boolean }): Set<number> {
    const adj = new Map<number, number[]>()
    for (const l of map.nav.links) {
        if (l.door && !opts.doors) continue
        if (l.barricade && !opts.windows) continue
        if (!adj.has(l.a)) adj.set(l.a, [])
        if (!adj.has(l.b)) adj.set(l.b, [])
        adj.get(l.a)!.push(l.b)
        adj.get(l.b)!.push(l.a)
    }
    const seen = new Set([from])
    const queue = [from]
    while (queue.length) {
        const c = queue.shift()!
        for (const n of adj.get(c) ?? []) {
            if (!seen.has(n)) {
                seen.add(n)
                queue.push(n)
            }
        }
    }
    return seen
}

function nearestNode(p: Vec3, filter: (n: DfNavNode) => boolean = () => true): DfNavNode {
    let best = nodes[0]!
    let bd = Infinity
    for (const n of nodes) {
        if (!filter(n)) continue
        const d = Math.hypot(n.pos.x - p.x, (n.pos.y - p.y) * 2, n.pos.z - p.z)
        if (d < bd) {
            bd = d
            best = n
        }
    }
    return best
}

const startNode = nearestNode(map.playerSpawns[0]!, n => !n.outside)

describe('Sainte-Croix layout', () => {
    it('has unique ids and known zones everywhere', () => {
        const ids = dfInteractables(map).map(i => i.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const i of dfInteractables(map)) expect(zoneIds.has(i.zone)).toBe(true)
        for (const n of nodes) expect(zoneIds.has(n.zone)).toBe(true)
        for (const s of map.riserSpawns) expect(zoneIds.has(s.zone)).toBe(true)
        expect(zoneIds.has(map.startZone)).toBe(true)
    })

    it('has buyable doors with collision that opens', () => {
        for (const d of map.doors) {
            expect(d.zones[0]).not.toBe(d.zones[1])
            for (const z of d.zones) expect(zoneIds.has(z)).toBe(true)
            const own = map.solids.filter(s => s.door === d.id)
            expect(own.length).toBeGreaterThan(0)
            const lo = { x: Math.min(...own.map(s => s.min.x)), y: Math.min(...own.map(s => s.min.y)), z: Math.min(...own.map(s => s.min.z)) }
            const hi = { x: Math.max(...own.map(s => s.max.x)), y: Math.max(...own.map(s => s.max.y)), z: Math.max(...own.map(s => s.max.z)) }
            expect(d.pos.x).toBeGreaterThanOrEqual(lo.x)
            expect(d.pos.x).toBeLessThanOrEqual(hi.x)
            expect(d.pos.z).toBeGreaterThanOrEqual(lo.z)
            expect(d.pos.z).toBeLessThanOrEqual(hi.z)
            expect(Math.abs(d.pos.y - lo.y)).toBeLessThan(0.05)
            expect(openWorld.solids.some(s => s.door === d.id)).toBe(false)
            expect(map.nav.links.some(l => l.door === d.id)).toBe(true)
        }
    })

    it('has boarded windows with an unreachable approach outside', () => {
        const inside = reachable(startNode.id, { doors: true, windows: false })
        const zonesWithWindows = new Set(map.barricades.map(b => b.zone))
        for (const z of zoneIds) expect(zonesWithWindows.has(z)).toBe(true)
        for (const b of map.barricades) {
            expect(Math.hypot(b.inward.x, b.inward.y, b.inward.z)).toBeCloseTo(1, 6)
            expect(b.pos.y).toBe(0)
            const back = (b.outside.x - b.pos.x) * b.inward.x + (b.outside.z - b.pos.z) * b.inward.z
            expect(back).toBeLessThan(-0.8)
            // Players are stopped by the window, zombies are not.
            const frame = map.solids.filter(s => s.barricade === b.id)
            expect(frame.length).toBeGreaterThan(0)
            for (const s of frame) expect(s.playerOnly).toBe(true)
            const out = { ...b.outside }
            expect(dfBodyFits(closedWorld, out, { radius: 0.35, height: 1.8, zombie: true })).toBe(true)
            // A nav link crosses the window from an outside node.
            const links = map.nav.links.filter(l => l.barricade === b.id)
            expect(links.length).toBeGreaterThan(0)
            for (const l of links) expect(!!nodes[l.a]!.outside !== !!nodes[l.b]!.outside).toBe(true)
            const outsideNode = nearestNode(b.outside)
            expect(outsideNode.outside).toBe(true)
            expect(inside.has(outsideNode.id)).toBe(false)
            // With the window passable it leads in.
            expect(reachable(outsideNode.id, { doors: true, windows: true }).has(startNode.id)).toBe(true)
        }
    })

    it('has one machine per perk', () => {
        expect(map.perks.map(p => p.perk).sort()).toEqual([...DF_PERK_IDS].sort())
    })

    it('places the box, PaP, power and egg parts on solid ground', () => {
        // The box never starts in the start zone: it needs spots elsewhere.
        expect(map.boxSpots.some(s => s.zone !== map.startZone)).toBe(true)
        const floorSpots = [...map.boxSpots, map.pap, map.power, map.egg.generator, map.egg.pedestal, ...map.egg.rods]
        for (const s of floorSpots) {
            expect(dfGroundHeight(closedWorld, s.pos.x + Math.sin(s.yaw) * 0.9, s.pos.z + Math.cos(s.yaw) * 0.9, s.pos.y + 0.1), s.id).toBeCloseTo(s.pos.y, 2)
        }
        for (const f of map.egg.fuses) {
            // Lies on something, not floating.
            expect(dfGroundHeight(closedWorld, f.pos.x, f.pos.z, f.pos.y + 0.05), f.id).toBeCloseTo(f.pos.y, 2)
        }
    })

    it('spawns players in the start zone and risers in every zone', () => {
        expect(map.playerSpawns.length).toBe(DF_MAX_PLAYERS)
        for (const p of map.playerSpawns) {
            expect(dfBodyFits(closedWorld, p, { radius: DF_PLAYER.radius, height: DF_PLAYER.height })).toBe(true)
            expect(dfGroundHeight(closedWorld, p.x, p.z, p.y + 0.1)).toBeCloseTo(p.y, 3)
            expect(nearestNode(p, n => !n.outside).zone).toBe(map.startZone)
        }
        for (const z of zoneIds) expect(map.riserSpawns.some(s => s.zone === z)).toBe(true)
        for (const s of map.riserSpawns) {
            expect(dfBodyFits(closedWorld, s.pos, { radius: 0.55, height: 2.3, zombie: true })).toBe(true)
            expect(dfGroundHeight(closedWorld, s.pos.x, s.pos.z, s.pos.y + 0.1)).toBeCloseTo(s.pos.y, 3)
            expect(nearestNode(s.pos, n => !n.outside).zone).toBe(s.zone)
        }
    })
})

describe('Sainte-Croix nav graph', () => {
    it('puts every node on walkable ground with room for a zombie', () => {
        for (const n of nodes) {
            expect(dfGroundHeight(openWorld, n.pos.x, n.pos.z, n.pos.y + 0.3, true)).toBeCloseTo(n.pos.y, 2)
            expect(dfBodyFits(openWorld, { x: n.pos.x, y: n.pos.y + DF_PLAYER.stepHeight + 0.01, z: n.pos.z }, { radius: 0.35, height: 1.2, zombie: true })).toBe(true)
        }
        for (const l of map.nav.links) {
            expect(nodes[l.a]).toBeDefined()
            expect(nodes[l.b]).toBeDefined()
            expect(l.a).not.toBe(l.b)
        }
    })

    it('reaches every zone and both levels from the start once the doors are open', () => {
        const seen = reachable(startNode.id, { doors: true, windows: false })
        const missing = nodes.filter(n => !n.outside && !seen.has(n.id))
        expect(missing.map(n => n.id)).toEqual([])
        for (const z of zoneIds) expect(nodes.some(n => n.zone === z && seen.has(n.id))).toBe(true)
        expect(nodes.some(n => n.pos.y > DF_UPPER_Y - 0.01 && seen.has(n.id))).toBe(true)
    })

    it('reaches every lightning rod from the start once the doors are open', () => {
        const seen = reachable(startNode.id, { doors: true, windows: false })
        for (const r of map.egg.rods) {
            const near = nodes.filter(n => seen.has(n.id) && Math.hypot(n.pos.x - r.pos.x, n.pos.z - r.pos.z) <= DF_PLAYER.useRange && Math.abs(n.pos.y - r.pos.y) < 0.5)
            expect(near.length, r.id).toBeGreaterThan(0)
        }
    })

    it('keeps the start zone sealed while the doors are closed', () => {
        const seen = reachable(startNode.id, { doors: false, windows: false })
        for (const id of seen) expect(nodes[id]!.zone).toBe(map.startZone)
    })

    it('puts every interactable within reach of a nav node', () => {
        for (const it of dfInteractables(map)) {
            const candidates = nodes.filter((n) => {
                if (n.outside) return false
                const h = Math.hypot(n.pos.x - it.pos.x, n.pos.z - it.pos.z)
                const eye = n.pos.y + DF_PLAYER.eyeHeight
                return h <= DF_PLAYER.useRange && it.pos.y > n.pos.y - 0.5 && it.pos.y < eye + 0.3
            })
            expect(candidates.length, it.id).toBeGreaterThan(0)
            // Nothing solid between that node's eye and the thing (except the thing itself).
            const visible = candidates.some((n) => {
                const eye = { x: n.pos.x, y: n.pos.y + DF_PLAYER.eyeHeight, z: n.pos.z }
                const target = { x: it.pos.x, y: Math.max(it.pos.y, n.pos.y) + 0.5, z: it.pos.z }
                const d = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z)
                const hit = dfRaycast(closedWorld, eye, { x: (target.x - eye.x) / d, y: (target.y - eye.y) / d, z: (target.z - eye.z) / d }, d)
                return !hit || hit.dist > d - 1.0
            })
            expect(visible, it.id).toBe(true)
        }
        // Doors can be bought from both sides.
        for (const d of map.doors) {
            for (const z of d.zones) {
                expect(nodes.some(n => n.zone === z && Math.hypot(n.pos.x - d.pos.x, n.pos.z - d.pos.z) < 2.6 && Math.abs(n.pos.y - d.pos.y) < 0.5), `${d.id} ${z}`).toBe(true)
            }
        }
    })
})

describe('Sainte-Croix traversal', () => {
    function walk(from: Vec3, to: Vec3, seconds: number): Vec3 {
        let pos = { ...from }
        let vel = { x: 0, y: 0, z: 0 }
        const dt = 1 / 30
        for (let t = 0; t < seconds; t += dt) {
            const dx = to.x - pos.x
            const dz = to.z - pos.z
            const d = Math.hypot(dx, dz)
            const speed = Math.min(DF_PLAYER.walkSpeed, d / dt)
            vel = { x: d > 1e-3 ? dx / d * speed : 0, y: vel.y - DF_PLAYER.gravity * dt, z: d > 1e-3 ? dz / d * speed : 0 }
            const r = dfMoveBody(openWorld, pos, vel, dt, { radius: DF_PLAYER.radius, height: DF_PLAYER.height, stepHeight: DF_PLAYER.stepHeight })
            pos = r.pos
            vel = r.vel
        }
        return pos
    }

    it('walks up and down every staircase', () => {
        const stairs: [Vec3, Vec3][] = [
            [{ x: 27.5, y: 0, z: 2 }, { x: 37, y: DF_UPPER_Y, z: 2 }],
            [{ x: 27.5, y: 0, z: 26 }, { x: 37, y: DF_UPPER_Y, z: 26 }]
        ]
        for (const [bottom, top] of stairs) {
            const up = walk(bottom, top, 4)
            expect(up.y).toBeCloseTo(DF_UPPER_Y, 2)
            expect(Math.hypot(up.x - top.x, up.z - top.z)).toBeLessThan(0.2)
            const down = walk(top, bottom, 4)
            expect(down.y).toBeCloseTo(0, 2)
            expect(Math.hypot(down.x - bottom.x, down.z - bottom.z)).toBeLessThan(0.2)
        }
    })

    it('stops players at boarded windows', () => {
        for (const b of map.barricades) {
            const inside = { x: b.pos.x + b.inward.x * 1.2, y: 0, z: b.pos.z + b.inward.z * 1.2 }
            const end = walk(inside, b.outside, 3)
            const past = (end.x - b.pos.x) * b.inward.x + (end.z - b.pos.z) * b.inward.z
            expect(past, b.id).toBeGreaterThan(0)
        }
    })
})
