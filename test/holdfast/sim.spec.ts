import { describe, expect, it } from 'vitest'
import { BUILDINGS, FIRST_WAVE_AT, TICK } from '#shared/utils/holdfast/config'
import { HoldfastBot, simulateRun } from '#shared/utils/holdfast/bot'
import { HOLDFAST_DIFFICULTIES, HOLDFAST_WIN_MS } from '#shared/utils/holdfast/meta'
import { ENEMY, HoldfastSim, PLAYER } from '#shared/utils/holdfast/sim'

function run(sim: HoldfastSim, seconds: number): void {
    for (let i = 0; i < seconds / TICK && !sim.over; i++) {
        sim.step()
        sim.events.length = 0
    }
}

function rich(sim: HoldfastSim): void {
    sim.resources = { gold: 1e6, wood: 1e6, stone: 1e6, crystal: 1e6 }
}

describe('holdfast sim', () => {
    it('is deterministic for a seed', () => {
        const a = new HoldfastSim('normal', 42)
        const b = new HoldfastSim('normal', 42)
        run(a, 200)
        run(b, 200)
        expect(a.units.map(u => [u.x, u.z, u.hp])).toEqual(b.units.map(u => [u.x, u.z, u.hp]))
        expect(a.keep.hp).toBe(b.keep.hp)
    })

    it('starts with a keep and one gold mine, and every lane reaches the keep', () => {
        for (const d of HOLDFAST_DIFFICULTIES) {
            const sim = new HoldfastSim(d, 7)
            expect(sim.buildings.filter(b => b.kind === 'keep' || b.kind === 'goldmine').map(b => b.kind).sort()).toEqual(['goldmine', 'keep'])
            // A starter wall ring, with gates where the roads cross it.
            expect(sim.count('wall')).toBeGreaterThan(15)
            expect(sim.count('gate')).toBeGreaterThan(0)
            for (const lane of sim.difficulty.lanes) {
                expect(sim.grid.flow[sim.grid.idx(lane.x, lane.z)]).toBeLessThan(Infinity)
            }
        }
    })

    it('makes each extra building of a kind cost more', () => {
        const sim = new HoldfastSim('easy', 1)
        rich(sim)
        const first = sim.buildCost('lumbercamp').gold!
        const spot = sim.findFreeSpot(2, sim.keepCenter.x + 5, sim.keepCenter.z - 4)!
        expect(sim.placeBuilding('lumbercamp', spot.cx, spot.cz).ok).toBe(true)
        expect(sim.buildCost('lumbercamp').gold!).toBeGreaterThan(first * 1.5)
        // The starting mine already counts.
        expect(sim.buildCost('goldmine').gold!).toBeGreaterThan(BUILDINGS.goldmine.cost.gold!)
    })

    it('rejects building outside the territory or on top of something', () => {
        const sim = new HoldfastSim('easy', 1)
        rich(sim)
        expect(sim.previewBuilding('lumbercamp', 5, 5).ok).toBe(false)
        expect(sim.previewBuilding('lumbercamp', sim.keep.cx, sim.keep.cz).ok).toBe(false)
    })

    it('deploys packs of six that grow with the drill upgrade', () => {
        const sim = new HoldfastSim('easy', 3)
        rich(sim)
        const k = sim.keepCenter
        const r = sim.deployPack('warrior', k.x, k.z - 5)
        expect(r.ok).toBe(true)
        expect(sim.units.filter(u => u.side === PLAYER)).toHaveLength(6)
        const spot = sim.findFreeSpot(3, k.x + 6, k.z - 2)!
        expect(sim.placeBuilding('barracks', spot.cx, spot.cz).ok).toBe(true)
        expect(sim.buyUpgrade('warriorDrill').ok).toBe(true)
        expect(sim.packSize('warrior')).toBe(8)
        const before = sim.resources.gold
        expect(sim.reinforcePack(r.packId!).ok).toBe(true)
        expect(sim.packs.get(r.packId!)!.unitIds).toHaveLength(8)
        expect(sim.resources.gold).toBeLessThan(before)
    })

    it('enforces the pack cap', () => {
        const sim = new HoldfastSim('easy', 3)
        rich(sim)
        const k = sim.keepCenter
        for (let i = 0; i < sim.packCap; i++) expect(sim.deployPack('archer', k.x - 4 + i * 2, k.z - 6).ok).toBe(true)
        expect(sim.deployPack('archer', k.x, k.z - 8).ok).toBe(false)
    })

    it('puts archers dropped on a wall on top of it, with extra range', () => {
        const sim = new HoldfastSim('easy', 5)
        rich(sim)
        const k = sim.keepCenter
        const z = Math.floor(k.z) - 10
        const cells = sim.lineCells(Math.floor(k.x) - 4, z, Math.floor(k.x) + 4, z)
        expect(sim.placeSegments('wall', cells).placed).toBe(9)
        const r = sim.deployPack('archer', Math.floor(k.x) + 0.5, z + 0.5)
        expect(r.ok).toBe(true)
        expect(sim.packs.get(r.packId!)!.wallBound).toBe(true)
        expect(sim.units.every(u => u.elevated)).toBe(true)
    })

    it('lets a gate replace a wall segment, keeping its tier', () => {
        const sim = new HoldfastSim('easy', 5)
        rich(sim)
        const k = sim.keepCenter
        const cx = Math.floor(k.x)
        const cz = Math.floor(k.z) - 10
        sim.placeSegments('wall', [sim.grid.idx(cx, cz)])
        const wall = sim.buildingAtCell(sim.grid.idx(cx, cz))!
        expect(sim.upgradeBuilding(wall.id).ok).toBe(true)
        expect(sim.placeSegments('gate', [sim.grid.idx(cx, cz)]).placed).toBe(1)
        const gate = sim.buildingAtCell(sim.grid.idx(cx, cz))!
        expect(gate.kind).toBe('gate')
        expect(gate.level).toBe(2)
    })

    it('upgrades a whole connected wall in one go', () => {
        const sim = new HoldfastSim('easy', 5)
        rich(sim)
        const k = sim.keepCenter
        const z = Math.floor(k.z) - 10
        sim.placeSegments('wall', sim.lineCells(Math.floor(k.x) - 3, z, Math.floor(k.x) + 3, z))
        const first = sim.buildingAtCell(sim.grid.idx(Math.floor(k.x), z))!
        const line = sim.connectedSegments(first.id)
        expect(line).toHaveLength(7)
        expect(sim.upgradeConnected(first.id)).toEqual({ upgraded: 7, total: 7 })
        expect(line.every(b => b.level === 2)).toBe(true)
    })

    it('refunds part of the cost when selling', () => {
        const sim = new HoldfastSim('easy', 1)
        const mine = sim.buildings.find(b => b.kind === 'goldmine')!
        const spot = sim.findFreeSpot(2, sim.keepCenter.x + 5, sim.keepCenter.z - 4)!
        const before = sim.resources.gold
        const placed = sim.placeBuilding('lumbercamp', spot.cx, spot.cz)
        const paid = before - sim.resources.gold
        expect(sim.sellBuilding(placed.id!).ok).toBe(true)
        expect(sim.resources.gold).toBeCloseTo(before - paid + Math.floor(paid / 2))
        expect(sim.sellBuilding(sim.keep.id).ok).toBe(false)
        expect(mine).toBeDefined()
    })

    it('sends the first wave after the warm-up and a do-nothing player falls', () => {
        const sim = new HoldfastSim('normal', 9)
        run(sim, FIRST_WAVE_AT - 1)
        expect(sim.units.some(u => u.side === ENEMY)).toBe(false)
        run(sim, 2)
        expect(sim.units.filter(u => u.side === ENEMY).length).toBeGreaterThanOrEqual(6)
        run(sim, 12 * 60)
        expect(sim.over).toBe('defeat')
        expect(sim.survivedMs).toBeLessThan(10 * 60 * 1000)
    })

    it('raiders break walls that fully block their path', () => {
        const sim = new HoldfastSim('easy', 11)
        rich(sim)
        const k = sim.keep
        // Box the keep in completely.
        const x0 = k.cx - 2
        const x1 = k.cx + k.size + 1
        const z0 = k.cz - 2
        const z1 = k.cz + k.size + 1
        const ring = [
            ...sim.lineCells(x0, z0, x1, z0),
            ...sim.lineCells(x1, z0, x1, z1),
            ...sim.lineCells(x1, z1, x0, z1),
            ...sim.lineCells(x0, z1, x0, z0)
        ]
        sim.placeSegments('wall', ring)
        sim.recomputeFlow()
        const lane = sim.difficulty.lanes[0]!
        // Still reachable, just through a wall.
        expect(sim.grid.flow[sim.grid.idx(lane.x, lane.z)]).toBeLessThan(Infinity)
        const walls = sim.buildings.filter(b => b.kind === 'wall').length
        run(sim, FIRST_WAVE_AT + 150)
        expect(sim.buildings.filter(b => b.kind === 'wall').length).toBeLessThan(walls)
    })

    it('ends in victory at 25 minutes', () => {
        const sim = new HoldfastSim('easy', 2)
        sim.time = HOLDFAST_WIN_MS / 1000 - TICK / 2
        sim.keep.hp = 1e9
        sim.step()
        expect(sim.over).toBe('victory')
        expect(sim.survivedMs).toBe(HOLDFAST_WIN_MS)
    })

    it('a scripted player outlasts an idle one', () => {
        const idle = new HoldfastSim('normal', 21)
        simulateRun(idle, null, 16 * 60)
        const played = new HoldfastSim('normal', 21)
        simulateRun(played, new HoldfastBot(played), 16 * 60)
        expect(played.time).toBeGreaterThan(idle.time + 60)
    })
})
