import { describe, it, expect } from 'vitest'
import {
    CALL_OF_XENO_WEAPONS,
    CALL_OF_XENO_WALL_WEAPONS,
    CALL_OF_XENO_PERKS,
    CALL_OF_XENO_PAP_TIERS,
    CALL_OF_XENO_MAX_PAP_TIER,
    CALL_OF_XENO_BOX_POOL,
    CALL_OF_XENO_ENEMIES,
    CALL_OF_XENO_POWERUPS,
    CALL_OF_XENO_MODIFIERS,
    packAPunch,
    packAPunchCost,
    ammoCost,
    roundComposition,
    isSpecialRound,
    specialRoundEnemy,
    roundModifier,
    streakMultiplier,
    multiKillBonus,
    zombieHealth,
    zombieCount,
    zombieSpeed,
    zombieSpawnInterval,
    zombieDamage,
    maxAlive,
    type CallOfXenoEnemyId,
    type CallOfXenoWeaponId
} from '../../shared/utils/gamelogic/call-of-xeno'
import {
    CALL_OF_XENO_WALLS,
    CALL_OF_XENO_CRATES,
    CALL_OF_XENO_PLATFORMS,
    CALL_OF_XENO_RAMPS,
    CALL_OF_XENO_REGIONS,
    CALL_OF_XENO_ROOM_THEMES,
    CALL_OF_XENO_DOORS,
    CALL_OF_XENO_NODES,
    CALL_OF_XENO_EDGES,
    CALL_OF_XENO_SPAWNS,
    CALL_OF_XENO_INTERACTABLES,
    CALL_OF_XENO_PLAYER_START,
    CALL_OF_XENO_CATWALK_Y,
    buildNavTable,
    nextHop,
    nearestNode,
    reachableNodes,
    collisionSolids,
    solidsInBand,
    groundHeight,
    rayBlockDistance,
    regionAt,
    resolveCircle,
    zombieTarget
} from '../../shared/utils/gamelogic/call-of-xeno-map'

const ALL_DOORS_OPEN = new Set(CALL_OF_XENO_DOORS.map(d => d.id))
const NO_DOORS = new Set<string>()
const OPEN_SOLIDS = collisionSolids(ALL_DOORS_OPEN)
const OPEN_TABLE = buildNavTable(ALL_DOORS_OPEN)
const SHUT_TABLE = buildNavTable(NO_DOORS)

const PLAYER_RADIUS = 0.35
const ACTOR_HEIGHT = 1.8

/** Boxes an actor standing at (x, z) would collide with, at its own foot height. */
function boxesAt(x: number, z: number, feetY: number) {
    return solidsInBand(OPEN_SOLIDS, feetY, ACTOR_HEIGHT)
}

describe('call of xeno weapons', () => {
    it('ships five conventional weapons plus one wonder weapon', () => {
        const ids = Object.keys(CALL_OF_XENO_WEAPONS) as CallOfXenoWeaponId[]
        expect(ids).toHaveLength(6)
        const conventional = ids.filter(id => id !== 'xenoray')
        const best = Math.max(...conventional.map(id => CALL_OF_XENO_WEAPONS[id].damage))
        expect(CALL_OF_XENO_WEAPONS.xenoray.damage).toBeGreaterThan(best * 3)
    })

    it('gives every weapon a self-consistent stat block', () => {
        for (const weapon of Object.values(CALL_OF_XENO_WEAPONS)) {
            expect(weapon.damage).toBeGreaterThan(0)
            expect(weapon.magSize).toBeGreaterThan(0)
            expect(weapon.pellets).toBeGreaterThanOrEqual(1)
            expect(weapon.fireDelay).toBeGreaterThan(0)
            expect(weapon.reserveAmmo).toBeGreaterThanOrEqual(weapon.magSize)
            expect(weapon.penetration).toBeGreaterThanOrEqual(1)
        }
    })

    it('keeps the wonder weapon off the walls, box only', () => {
        expect(CALL_OF_XENO_WALL_WEAPONS).not.toContain('xenoray')
        expect(CALL_OF_XENO_WEAPONS.xenoray.cost).toBe(0)
        expect(CALL_OF_XENO_BOX_POOL.map(e => e.weapon)).toContain('xenoray')
    })

    it('sells exactly the wall weapons the map places', () => {
        const placed = CALL_OF_XENO_INTERACTABLES
            .filter(i => i.kind === 'wallbuy')
            .map(i => i.weapon)
        expect(new Set(placed)).toEqual(new Set(CALL_OF_XENO_WALL_WEAPONS))
    })

    it('charges half the wall price for an ammo refill', () => {
        expect(ammoCost(CALL_OF_XENO_WEAPONS.mp40)).toBe(500)
    })
})

describe('pack-a-punch ladder', () => {
    it('has three tiers priced 5k, 15k and 30k', () => {
        expect(CALL_OF_XENO_PAP_TIERS.map(t => t.cost)).toEqual([5000, 15000, 30000])
        expect(CALL_OF_XENO_MAX_PAP_TIER).toBe(3)
    })

    it('quotes the next tier and stops quoting once maxed', () => {
        expect(packAPunchCost(0)).toBe(5000)
        expect(packAPunchCost(1)).toBe(15000)
        expect(packAPunchCost(2)).toBe(30000)
        expect(packAPunchCost(3)).toBeNull()
    })

    it('raises every stat monotonically up the ladder', () => {
        const base = CALL_OF_XENO_WEAPONS.ak74
        const tiers = [0, 1, 2, 3].map(t => packAPunch(base, t))
        for (let i = 1; i < tiers.length; i++) {
            expect(tiers[i]!.damage).toBeGreaterThan(tiers[i - 1]!.damage)
            expect(tiers[i]!.reserveAmmo).toBeGreaterThan(tiers[i - 1]!.reserveAmmo)
            expect(tiers[i]!.penetration).toBeGreaterThan(tiers[i - 1]!.penetration)
            expect(tiers[i]!.magSize).toBeGreaterThanOrEqual(tiers[i - 1]!.magSize)
        }
    })

    it('names each tier distinctly and never mutates the base weapon', () => {
        const before = { ...CALL_OF_XENO_WEAPONS.mp40 }
        const names = [1, 2, 3].map(t => packAPunch(CALL_OF_XENO_WEAPONS.mp40, t).name)
        expect(new Set(names).size).toBe(3)
        expect(names[0]).toBe(CALL_OF_XENO_WEAPONS.mp40.upgradedName)
        expect(CALL_OF_XENO_WEAPONS.mp40).toEqual(before)
    })

    it('treats tier 0 and out-of-range tiers safely', () => {
        expect(packAPunch(CALL_OF_XENO_WEAPONS.rpk, 0)).toEqual(CALL_OF_XENO_WEAPONS.rpk)
        expect(packAPunch(CALL_OF_XENO_WEAPONS.rpk, 9)).toEqual(packAPunch(CALL_OF_XENO_WEAPONS.rpk, 3))
    })
})

describe('enemy roster', () => {
    it('unlocks five types in escalating order', () => {
        const ids = Object.keys(CALL_OF_XENO_ENEMIES) as CallOfXenoEnemyId[]
        expect(ids).toHaveLength(5)
        expect(CALL_OF_XENO_ENEMIES.shambler.minRound).toBe(1)
        const unlocks = ids.map(id => CALL_OF_XENO_ENEMIES[id].minRound)
        expect(Math.max(...unlocks)).toBeGreaterThan(9)
    })

    it('gives the ranged type a standoff inside its firing range', () => {
        const drone = CALL_OF_XENO_ENEMIES.drone
        expect(drone.ranged).toBeDefined()
        expect(drone.ranged!.standoff).toBeLessThan(drone.ranged!.range)
        expect(drone.ranged!.projectileSpeed).toBeGreaterThan(0)
    })

    it('pays more for the types that are harder to kill', () => {
        expect(CALL_OF_XENO_ENEMIES.brute.reward).toBeGreaterThan(CALL_OF_XENO_ENEMIES.shambler.reward)
        expect(CALL_OF_XENO_ENEMIES.brute.weakPoint).toBeGreaterThan(1)
        expect(CALL_OF_XENO_ENEMIES.crawler.reward).toBeLessThan(CALL_OF_XENO_ENEMIES.shambler.reward)
    })

    it('only offers unlocked types in a round composition', () => {
        expect(roundComposition(1).map(e => e.enemy)).toEqual(['shambler'])
        expect(roundComposition(4).map(e => e.enemy)).toContain('crawler')
        expect(roundComposition(9).map(e => e.enemy)).not.toContain('brute')
        expect(roundComposition(12).map(e => e.enemy)).toContain('brute')
        for (const entry of roundComposition(30)) expect(entry.weight).toBeGreaterThan(0)
    })
})

describe('special rounds and modifiers', () => {
    it('fires a special every fifth round and never before round five', () => {
        expect(isSpecialRound(4)).toBe(false)
        expect(isSpecialRound(5)).toBe(true)
        expect(isSpecialRound(10)).toBe(true)
        expect(isSpecialRound(11)).toBe(false)
    })

    it('cycles the special type and only ever names an unlocked one', () => {
        expect(specialRoundEnemy(5)).toBe('crawler')
        expect(specialRoundEnemy(10)).toBe('husk')
        expect(specialRoundEnemy(15)).toBe('drone')
        expect(specialRoundEnemy(20)).toBe('brute')
        for (const round of [5, 10, 15, 20, 25, 40]) {
            const id = specialRoundEnemy(round)
            expect(CALL_OF_XENO_ENEMIES[id].minRound).toBeLessThanOrEqual(round)
        }
    })

    it('holds modifiers back until round eight and keeps specials clean', () => {
        for (let r = 1; r < 8; r++) expect(roundModifier(r)).toBe('none')
        const seen = new Set<string>()
        for (let r = 8; r < 40; r++) {
            const modifier = roundModifier(r)
            if (isSpecialRound(r)) expect(modifier).toBe('none')
            if (modifier !== 'none') seen.add(modifier)
            expect(CALL_OF_XENO_MODIFIERS[modifier]).toBeDefined()
        }
        expect(seen.size).toBeGreaterThanOrEqual(3)
    })

    it('leaves most rounds unmodified so the modifier still reads as an event', () => {
        let modified = 0
        for (let r = 8; r < 38; r++) if (roundModifier(r) !== 'none') modified++
        expect(modified).toBeLessThan(15)
    })
})

describe('point economy', () => {
    it('ramps the streak multiplier and caps it at 3x', () => {
        expect(streakMultiplier(0)).toBe(1)
        expect(streakMultiplier(2)).toBe(1)
        expect(streakMultiplier(3)).toBeGreaterThan(1)
        let previous = 0
        for (let s = 0; s < 60; s++) {
            const value = streakMultiplier(s)
            expect(value).toBeGreaterThanOrEqual(previous)
            expect(value).toBeLessThanOrEqual(3)
            previous = value
        }
        expect(streakMultiplier(100)).toBe(3)
    })

    it('only pays a multi-kill bonus from three up', () => {
        expect(multiKillBonus(1)).toBe(0)
        expect(multiKillBonus(2)).toBe(0)
        expect(multiKillBonus(3)).toBeGreaterThan(0)
        expect(multiKillBonus(5)).toBeGreaterThan(multiKillBonus(4))
    })

    it('weights every power-up so one is always drawable', () => {
        const total = Object.values(CALL_OF_XENO_POWERUPS).reduce((sum, p) => sum + p.weight, 0)
        expect(total).toBeGreaterThan(0)
        expect(CALL_OF_XENO_POWERUPS.maxammo.duration).toBe(0)
        expect(CALL_OF_XENO_POWERUPS.instakill.duration).toBeGreaterThan(0)
    })
})

describe('round scaling', () => {
    it('adds a flat 100 health a round through round nine, then compounds', () => {
        expect(zombieHealth(1)).toBe(150)
        expect(zombieHealth(9)).toBe(950)
        for (let r = 1; r < 40; r++) expect(zombieHealth(r + 1)).toBeGreaterThan(zombieHealth(r))
    })

    it('caps count, speed and the spawn interval', () => {
        expect(zombieCount(100)).toBeLessThanOrEqual(64)
        expect(zombieSpeed(100)).toBeLessThanOrEqual(5.2)
        expect(zombieSpawnInterval(100)).toBeGreaterThanOrEqual(0.22)
        expect(zombieSpeed(1)).toBeLessThan(zombieSpeed(10))
    })

    it('ramps how many can be on the field at once', () => {
        expect(maxAlive(1)).toBeLessThan(maxAlive(10))
        expect(maxAlive(10)).toBeLessThan(maxAlive(20))
        expect(maxAlive(100)).toBe(34)
    })

    it('sends more bodies on a special round than the round before it', () => {
        expect(zombieCount(10)).toBeGreaterThan(zombieCount(9))
    })

    it('hits harder once the early rounds are over', () => {
        expect(zombieDamage(9)).toBeLessThan(zombieDamage(10))
    })

    it('treats fractional and sub-one rounds as round one', () => {
        expect(zombieHealth(0)).toBe(zombieHealth(1))
        expect(zombieCount(-5)).toBe(zombieCount(1))
    })
})

describe('perks', () => {
    it('offers four machines, all power gated, spread across the map', () => {
        expect(Object.keys(CALL_OF_XENO_PERKS)).toHaveLength(4)
        const machines = CALL_OF_XENO_INTERACTABLES.filter(i => i.kind === 'perk')
        expect(machines).toHaveLength(4)
        expect(machines.every(m => m.needsPower)).toBe(true)
        expect(new Set(machines.map(m => m.region)).size).toBe(4)
    })

    it('puts one perk up on the catwalk and one out in the tunnel', () => {
        const elevated = CALL_OF_XENO_INTERACTABLES.filter(i => i.y >= CALL_OF_XENO_CATWALK_Y)
        expect(elevated.length).toBeGreaterThan(0)
        const tunnel = CALL_OF_XENO_INTERACTABLES.filter(i => i.region === 7)
        expect(tunnel.length).toBeGreaterThan(0)
    })
})

describe('map layout', () => {
    it('has four buyable doors, one per link in the ring', () => {
        expect(CALL_OF_XENO_DOORS).toHaveLength(4)
        expect(new Set(CALL_OF_XENO_DOORS.map(d => d.cost)).size).toBe(4)
    })

    it('puts the power lever and the pack-a-punch on the Power Deck', () => {
        const lever = CALL_OF_XENO_INTERACTABLES.find(i => i.kind === 'power')!
        const pap = CALL_OF_XENO_INTERACTABLES.find(i => i.kind === 'papunch')!
        expect(lever.region).toBe(2)
        expect(pap.region).toBe(2)
        expect(pap.needsPower).toBe(true)
        expect(lever.needsPower).toBe(false)
    })

    it('places every interactable inside the region it claims', () => {
        for (const item of CALL_OF_XENO_INTERACTABLES) {
            const bounds = CALL_OF_XENO_REGIONS[item.region]!.bounds
            expect(item.x).toBeGreaterThanOrEqual(bounds.minX - 0.6)
            expect(item.x).toBeLessThanOrEqual(bounds.maxX + 0.6)
            expect(item.z).toBeGreaterThanOrEqual(bounds.minZ - 0.6)
            expect(item.z).toBeLessThanOrEqual(bounds.maxZ + 0.6)
        }
    })

    it('gives every region a palette', () => {
        for (const region of CALL_OF_XENO_REGIONS) {
            expect(CALL_OF_XENO_ROOM_THEMES[region.theme]).toBeDefined()
        }
    })

    it('does not start the player inside anything solid', () => {
        const start = CALL_OF_XENO_PLAYER_START
        const solved = resolveCircle(start.x, start.z, PLAYER_RADIUS, boxesAt(start.x, start.z, 0))
        expect(solved.x).toBeCloseTo(start.x, 6)
        expect(solved.z).toBeCloseTo(start.z, 6)
    })

    it('does not spawn enemies inside anything solid', () => {
        for (const spawn of CALL_OF_XENO_SPAWNS) {
            const solved = resolveCircle(spawn.x, spawn.z, 0.45, boxesAt(spawn.x, spawn.z, 0))
            expect(solved.x).toBeCloseTo(spawn.x, 6)
            expect(solved.z).toBeCloseTo(spawn.z, 6)
            expect(regionAt(spawn.x, spawn.z)).not.toBe(-1)
        }
    })

    it('never spawns anything straight onto the catwalk', () => {
        for (const spawn of CALL_OF_XENO_SPAWNS) {
            expect(groundHeight(spawn.x, spawn.z, 0)).toBe(0)
        }
    })
})

describe('vertical geometry', () => {
    it('stands an actor on the catwalk deck', () => {
        expect(groundHeight(25.5, 10, CALL_OF_XENO_CATWALK_Y)).toBeCloseTo(CALL_OF_XENO_CATWALK_Y, 6)
        expect(groundHeight(34, 1.75, CALL_OF_XENO_CATWALK_Y)).toBeCloseTo(CALL_OF_XENO_CATWALK_Y, 6)
    })

    it('leaves the floor under the catwalk at ground level', () => {
        expect(groundHeight(25.5, 10, 0)).toBe(0)
        expect(groundHeight(34, 12, 0)).toBe(0)
    })

    it('climbs a ramp linearly from bottom to top', () => {
        const ramp = CALL_OF_XENO_RAMPS[0]!
        let feet = 0
        let previous = -1
        for (let t = 0; t <= 1.0001; t += 0.05) {
            const x = ramp.lowAt + (ramp.highAt - ramp.lowAt) * t
            feet = groundHeight(x, 18.5, feet)
            expect(feet).toBeGreaterThanOrEqual(previous)
            previous = feet
        }
        expect(feet).toBeCloseTo(CALL_OF_XENO_CATWALK_Y, 6)
    })

    it('drops an actor that walks off the catwalk edge', () => {
        // Standing on the deck, one step out over the open middle of the hall.
        expect(groundHeight(34, 10, CALL_OF_XENO_CATWALK_Y)).toBe(0)
    })

    it('ignores ground clutter for an actor up on the deck', () => {
        const onDeck = solidsInBand(OPEN_SOLIDS, CALL_OF_XENO_CATWALK_Y, ACTOR_HEIGHT)
        const onFloor = solidsInBand(OPEN_SOLIDS, 0, ACTOR_HEIGHT)
        expect(onDeck.length).toBeLessThan(onFloor.length)
    })

    it('lets an actor walk under the catwalk without colliding with it', () => {
        const platform = CALL_OF_XENO_PLATFORMS[0]!
        const x = (platform.box.minX + platform.box.maxX) / 2
        const solved = resolveCircle(x, 10, PLAYER_RADIUS, boxesAt(x, 10, 0))
        expect(solved.x).toBeCloseTo(x, 6)
        expect(solved.z).toBeCloseTo(10, 6)
    })
})

describe('navigation', () => {
    it('links every node into one graph once the ring is open', () => {
        for (let i = 0; i < CALL_OF_XENO_NODES.length; i++) {
            for (let j = 0; j < CALL_OF_XENO_NODES.length; j++) {
                expect(nextHop(OPEN_TABLE, i, j)).not.toBe(-1)
            }
        }
    })

    it('routes the short way round the ring', () => {
        // Landing Bay to Power Deck is fewer hops through the service tunnel
        // than back through the Reactor Hall, so the first step goes south.
        expect(nextHop(OPEN_TABLE, 0, 6)).toBe(10)
        expect(nextHop(OPEN_TABLE, 0, 3)).toBe(1)
    })

    it('strands the far side of the map while the doors are shut', () => {
        const reached = reachableNodes(SHUT_TABLE, 0)
        expect(reached.has(0)).toBe(true)
        expect(reached.has(1)).toBe(true)
        expect(reached.has(6)).toBe(false)
        expect(reached.has(14)).toBe(false)
    })

    it('opens the map up door by door', () => {
        const one = buildNavTable(new Set(['door-bay-hall']))
        const reached = reachableNodes(one, 0)
        expect(reached.has(3)).toBe(true)
        // The catwalk hangs off the Reactor Hall, so it comes with that door.
        expect(reached.has(16)).toBe(true)
        expect(reached.has(6)).toBe(false)
    })

    it('only reaches the catwalk through a ramp', () => {
        // Nothing on the deck neighbours a ground node except the two ramps.
        const deckNodes = CALL_OF_XENO_NODES
            .map((node, i) => ({ node, i }))
            .filter(entry => entry.node.y > 0)
            .map(entry => entry.i)
        const bridges = CALL_OF_XENO_EDGES.filter(([a, b]) =>
            deckNodes.includes(a) !== deckNodes.includes(b)
        )
        expect(bridges).toHaveLength(2)
    })

    it('sends a zombie toward the player once they share a node', () => {
        const target = zombieTarget(OPEN_TABLE, 10.5, 10.5, 0, 12, 12, 0)
        expect(target).toEqual({ x: 12, z: 12 })
    })

    it('sends a zombie along the route when the player is rooms away', () => {
        const target = zombieTarget(OPEN_TABLE, 10, 10, 0, 34, 10, 0)
        expect(target).toEqual({ x: CALL_OF_XENO_NODES[1]!.x, z: CALL_OF_XENO_NODES[1]!.z })
    })

    it('does not latch a ground actor onto a node above its head', () => {
        // Directly under the west catwalk leg.
        expect(CALL_OF_XENO_NODES[nearestNode(25.5, 10, 0)]!.y).toBe(0)
        expect(CALL_OF_XENO_NODES[nearestNode(25.5, 10, CALL_OF_XENO_CATWALK_Y)]!.y).toBe(CALL_OF_XENO_CATWALK_Y)
    })

    it('keeps every navigation lane walkable, ramps included', () => {
        for (const [a, b] of CALL_OF_XENO_EDGES) {
            const from = CALL_OF_XENO_NODES[a]!
            const to = CALL_OF_XENO_NODES[b]!
            let feet = from.y
            for (let t = 0; t <= 1.0001; t += 0.02) {
                const x = from.x + (to.x - from.x) * t
                const z = from.z + (to.z - from.z) * t
                feet = groundHeight(x, z, feet)
                const solved = resolveCircle(x, z, 0.45, solidsInBand(OPEN_SOLIDS, feet, ACTOR_HEIGHT))
                const drift = Math.hypot(solved.x - x, solved.z - z)
                expect(drift, `edge ${a}-${b} blocked at ${x.toFixed(1)},${z.toFixed(1)}`).toBeLessThan(1e-6)
            }
            expect(feet, `edge ${a}-${b} ends at the wrong height`).toBeCloseTo(to.y, 4)
        }
    })
})

describe('collision solids', () => {
    it('includes shut doors and drops them once bought', () => {
        expect(collisionSolids(NO_DOORS).length - OPEN_SOLIDS.length).toBe(CALL_OF_XENO_DOORS.length)
    })

    it('gives walls full height and crates their own', () => {
        expect(CALL_OF_XENO_WALLS.every(w => w.height >= 4)).toBe(true)
        expect(CALL_OF_XENO_CRATES.every(c => c.height < 2)).toBe(true)
    })
})

describe('ray blocking', () => {
    const wall = [{ box: { minX: 4, maxX: 5, minZ: -5, maxZ: 5 }, baseY: 0, height: 4 }]
    const crate = [{ box: { minX: 4, maxX: 5, minZ: -5, maxZ: 5 }, baseY: 0, height: 1 }]
    const deck = [{ box: { minX: 4, maxX: 9, minZ: -5, maxZ: 5 }, baseY: 3.3, height: 0.3 }]

    it('stops at the near face and reports its normal', () => {
        const hit = rayBlockDistance(0, 1, 0, 1, 0, 0, wall, 50)
        expect(hit.distance).toBeCloseTo(4, 6)
        expect([hit.nx, hit.ny, hit.nz]).toEqual([-1, 0, 0])
    })

    it('returns the max range when nothing is in the way', () => {
        expect(rayBlockDistance(0, 1, 0, -1, 0, 0, wall, 50).distance).toBe(50)
    })

    it('lets a level shot pass over waist-high cover', () => {
        expect(rayBlockDistance(0, 1.7, 0, 1, 0, 0, crate, 50).distance).toBe(50)
    })

    it('still stops a shot aimed into that cover', () => {
        expect(rayBlockDistance(0, 0.5, 0, 1, 0, 0, crate, 50).distance).toBeCloseTo(4, 6)
    })

    it('lets a shot pass beneath a raised deck', () => {
        expect(rayBlockDistance(0, 1.4, 0, 1, 0, 0, deck, 50).distance).toBe(50)
    })

    it('stops a shot fired up into that deck', () => {
        const hit = rayBlockDistance(6, 1.4, 0, 0, 1, 0, deck, 50)
        expect(hit.distance).toBeCloseTo(1.9, 6)
        expect([hit.nx, hit.ny, hit.nz]).toEqual([0, -1, 0])
    })

    it('does not let a shot reach the next room through a shut door', () => {
        const hit = rayBlockDistance(10, 1.6, 10, 1, 0, 0, collisionSolids(NO_DOORS), 60)
        expect(hit.distance).toBeLessThan(13)
    })
})
