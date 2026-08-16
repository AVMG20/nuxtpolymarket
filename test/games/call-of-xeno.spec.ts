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
    CALL_OF_XENO_WINDOWS,
    CALL_OF_XENO_WINDOW_SILL,
    CALL_OF_XENO_WINDOW_HEAD,
    CALL_OF_XENO_WINDOW_WIDTH,
    CALL_OF_XENO_WINDOW_BOARDS,
    CALL_OF_XENO_SHELL,
    CALL_OF_XENO_SHELL_WALLS,
    CALL_OF_XENO_DECOR,
    CALL_OF_XENO_BARREL_SPOTS,
    CALL_OF_XENO_INTERACTABLES,
    CALL_OF_XENO_PLAYER_START,
    CALL_OF_XENO_UPPER_Y,
    CALL_OF_XENO_WALL_HEIGHT,
    CALL_OF_XENO_ATRIUM_HEIGHT,
    buildNavTable,
    nextHop,
    nearestNode,
    reachableNodes,
    reachableWindows,
    collisionSolids,
    solidsInBand,
    groundHeight,
    rayBlockDistance,
    regionAt,
    resolveCircle,
    bannedNodesFor,
    zombieTarget
} from '../../shared/utils/gamelogic/call-of-xeno-map'
import {
    buildNavGrid,
    findNavPath,
    navLineClear,
    navCellPassable,
    navLevelOf
} from '../../shared/utils/gamelogic/call-of-xeno-nav'

const ALL_DOORS_OPEN = new Set(CALL_OF_XENO_DOORS.map(d => d.id))
const NO_DOORS = new Set<string>()
const OPEN_SOLIDS = collisionSolids(ALL_DOORS_OPEN)
const OPEN_TABLE = buildNavTable(ALL_DOORS_OPEN)
const SHUT_TABLE = buildNavTable(NO_DOORS)
const OPEN_GRID = buildNavGrid(ALL_DOORS_OPEN)
const SHUT_GRID = buildNavGrid(NO_DOORS)

const PLAYER_RADIUS = 0.35
const ACTOR_HEIGHT = 1.8

/** Boxes an actor standing at (x, z) would collide with, at its own foot height. */
function boxesAt(feetY: number) {
    return solidsInBand(OPEN_SOLIDS, feetY, ACTOR_HEIGHT)
}

/** How far a standing actor gets shoved when it is dropped at (x, z). */
function penetration(x: number, z: number, feetY = groundHeight(x, z, 0)) {
    const solved = resolveCircle(x, z, PLAYER_RADIUS, boxesAt(feetY))
    return Math.hypot(solved.x - x, solved.z - z)
}

describe('call of xeno weapons', () => {
    it('ships eight conventional weapons plus one wonder weapon', () => {
        const ids = Object.keys(CALL_OF_XENO_WEAPONS) as CallOfXenoWeaponId[]
        expect(ids).toHaveLength(9)
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

    it('puts every box weapon somewhere buyable', () => {
        const obtainable = new Set<CallOfXenoWeaponId>([
            ...CALL_OF_XENO_WALL_WEAPONS,
            ...CALL_OF_XENO_BOX_POOL.map(e => e.weapon),
            'm1911'
        ])
        for (const id of Object.keys(CALL_OF_XENO_WEAPONS) as CallOfXenoWeaponId[]) {
            expect(obtainable.has(id), `${id} is unobtainable`).toBe(true)
        }
    })

    it('charges half the wall price for an ammo refill', () => {
        expect(ammoCost(CALL_OF_XENO_WEAPONS.skorpion)).toBe(500)
    })

    it('keeps the walls down to three guns and quotes no wall price for the rest', () => {
        expect(CALL_OF_XENO_WALL_WEAPONS).toHaveLength(3)
        for (const weapon of Object.values(CALL_OF_XENO_WEAPONS)) {
            const onWall = (CALL_OF_XENO_WALL_WEAPONS as CallOfXenoWeaponId[]).includes(weapon.id)
            if (onWall) expect(weapon.cost, weapon.id).toBeGreaterThan(0)
            else expect(weapon.cost, weapon.id).toBe(0)
        }
    })

    it('routes everything that is not on a wall through the box', () => {
        const boxed = new Set(CALL_OF_XENO_BOX_POOL.map(e => e.weapon))
        for (const id of Object.keys(CALL_OF_XENO_WEAPONS) as CallOfXenoWeaponId[]) {
            if (id === 'm1911') continue
            if ((CALL_OF_XENO_WALL_WEAPONS as CallOfXenoWeaponId[]).includes(id)) continue
            expect(boxed.has(id), `${id} has no way of being obtained`).toBe(true)
        }
        // The wall guns stay in the pool too, so an early spin is never a dud.
        for (const id of CALL_OF_XENO_WALL_WEAPONS) expect(boxed.has(id)).toBe(true)
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

    it('puts a perk up on the second floor and one out in the Lab', () => {
        const elevated = CALL_OF_XENO_INTERACTABLES.filter(i => i.kind === 'perk' && i.y >= CALL_OF_XENO_UPPER_Y)
        expect(elevated).toHaveLength(1)
        expect(elevated[0]!.perk).toBe('juggernog')
        const lab = CALL_OF_XENO_INTERACTABLES.filter(i => i.kind === 'perk' && i.region === 5)
        expect(lab).toHaveLength(1)
    })
})



describe('map layout', () => {
    it('has six buyable doors at non-decreasing prices', () => {
        expect(CALL_OF_XENO_DOORS).toHaveLength(6)
        const costs = CALL_OF_XENO_DOORS.map(d => d.cost)
        expect(costs).toEqual([...costs].sort((a, b) => a - b))
        expect(Math.min(...costs)).toBeGreaterThan(0)
        expect(new Set(CALL_OF_XENO_DOORS.map(d => d.id)).size).toBe(6)
    })

    it('puts the power lever and the pack-a-punch in the Reactor Hall', () => {
        const reactor = CALL_OF_XENO_REGIONS.find(r => r.name === 'Reactor Hall')!
        for (const kind of ['power', 'papunch'] as const) {
            const item = CALL_OF_XENO_INTERACTABLES.find(i => i.kind === kind)!
            expect(item.region).toBe(reactor.id)
        }
        expect(CALL_OF_XENO_INTERACTABLES.find(i => i.kind === 'papunch')!.needsPower).toBe(true)
        expect(CALL_OF_XENO_INTERACTABLES.find(i => i.kind === 'power')!.needsPower).toBe(false)
    })

    it('places every interactable inside the region it claims', () => {
        for (const item of CALL_OF_XENO_INTERACTABLES) {
            const region = CALL_OF_XENO_REGIONS.find(r => r.id === item.region)!
            const b = region.bounds
            expect(item.x, item.id).toBeGreaterThanOrEqual(b.minX - 0.7)
            expect(item.x, item.id).toBeLessThanOrEqual(b.maxX + 0.7)
            expect(item.z, item.id).toBeGreaterThanOrEqual(b.minZ - 0.7)
            expect(item.z, item.id).toBeLessThanOrEqual(b.maxZ + 0.7)
            expect(item.y, item.id).toBe(region.floorY)
        }
    })

    it('gives every region a palette and a storey it sits on', () => {
        for (const region of CALL_OF_XENO_REGIONS) {
            expect(CALL_OF_XENO_ROOM_THEMES[region.theme], region.name).toBeDefined()
            expect(region.ceiling, region.name).toBeGreaterThan(region.floorY)
            expect([0, CALL_OF_XENO_UPPER_Y]).toContain(region.floorY)
        }
    })

    it('stacks a second storey over the south half of the building', () => {
        const upper = CALL_OF_XENO_REGIONS.filter(r => r.floorY === CALL_OF_XENO_UPPER_Y)
        expect(upper.length).toBeGreaterThanOrEqual(3)
        // Every upper region has to be carried by the deck, or you would walk
        // off into the void the moment you left the stairs.
        for (const region of upper) {
            const deck = CALL_OF_XENO_PLATFORMS.find(p =>
                p.y === region.floorY
                && p.box.minX <= region.bounds.minX && p.box.maxX >= region.bounds.maxX
                && p.box.minZ <= region.bounds.minZ && p.box.maxZ >= region.bounds.maxZ)
            expect(deck, `${region.name} has no deck under it`).toBeDefined()
        }
    })

    it('resolves the storey a point belongs to by height', () => {
        expect(regionAt(9, 8, 0)).toBe(0)
        expect(regionAt(9, 8, CALL_OF_XENO_UPPER_Y)).toBe(7)
        expect(regionAt(27, 8, CALL_OF_XENO_UPPER_Y)).toBe(8)
        expect(regionAt(-40, -40, 0)).toBe(-1)
    })

    it('dresses every decor box as a wall solid too', () => {
        for (const decor of CALL_OF_XENO_DECOR) {
            expect(CALL_OF_XENO_WALLS.some(w => w.box === decor.box), JSON.stringify(decor.box)).toBe(true)
        }
    })

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

    it('drops every explosive barrel on clear floor', () => {
        for (const spot of CALL_OF_XENO_BARREL_SPOTS) {
            expect(penetration(spot.x, spot.z), `${spot.x},${spot.z}`).toBeLessThan(1e-9)
            expect(groundHeight(spot.x, spot.z, 0), `${spot.x},${spot.z}`).toBe(0)
        }
    })
})

describe('windows', () => {
    it('cuts every window into the outer shell', () => {
        expect(CALL_OF_XENO_WINDOWS.length).toBeGreaterThanOrEqual(10)
        for (const window of CALL_OF_XENO_WINDOWS) {
            const face = window.axis === 'x'
                ? [CALL_OF_XENO_SHELL.minZ, CALL_OF_XENO_SHELL.maxZ]
                : [CALL_OF_XENO_SHELL.minX, CALL_OF_XENO_SHELL.maxX]
            expect(face, window.id).toContain(window.at)
            expect(window.to - window.from).toBe(CALL_OF_XENO_WINDOW_WIDTH)
        }
        expect(new Set(CALL_OF_XENO_WINDOWS.map(w => w.id)).size).toBe(CALL_OF_XENO_WINDOWS.length)
    })

    it('never overlaps two windows on the same run of wall', () => {
        for (const a of CALL_OF_XENO_WINDOWS) {
            for (const b of CALL_OF_XENO_WINDOWS) {
                if (a === b || a.axis !== b.axis || a.at !== b.at) continue
                const gap = Math.max(a.from, b.from) < Math.min(a.to, b.to)
                expect(gap, `${a.id} overlaps ${b.id}`).toBe(false)
            }
        }
    })

    it('lands enemies on clear floor inside the room the window belongs to', () => {
        for (const window of CALL_OF_XENO_WINDOWS) {
            expect(regionAt(window.inside.x, window.inside.z, 0), window.id).toBe(window.region)
            expect(penetration(window.inside.x, window.inside.z), window.id).toBeLessThan(1e-9)
            // And the queue outside has to be standing on the dirt, not inside
            // the shell it is about to break into.
            expect(regionAt(window.outside.x, window.outside.z, 0), window.id).toBe(-1)
            expect(penetration(window.outside.x, window.outside.z), window.id).toBeLessThan(1e-9)
        }
    })

    it('names the navigation node an enemy actually arrives next to', () => {
        for (const window of CALL_OF_XENO_WINDOWS) {
            const nearest = nearestNode(window.inside.x, window.inside.z, 0)
            expect(nearest, window.id).toBe(window.node)
        }
    })

    it('gives every ground-floor room at least one way in', () => {
        const ground = CALL_OF_XENO_REGIONS.filter(r => r.floorY === 0)
        for (const region of ground) {
            const mine = CALL_OF_XENO_WINDOWS.filter(w => w.region === region.id)
            expect(mine.length, `${region.name} has no window`).toBeGreaterThan(0)
        }
    })

    it('still walls the player in at every window', () => {
        for (const window of CALL_OF_XENO_WINDOWS) {
            // A sill below the opening and a lintel above it means a standing
            // actor is stopped even though the hole is see-through.
            const pushed = penetration(window.centre.x, window.centre.z)
            expect(pushed, window.id).toBeGreaterThan(0)
            // Nothing to climb up onto, either.
            expect(groundHeight(window.centre.x, window.centre.z, 0), window.id).toBe(0)
        }
    })

    it('lets a shot through the opening but not through the sill', () => {
        const window = CALL_OF_XENO_WINDOWS.find(w => w.id === 'win-barracks-s1')!
        const dz = window.outward
        const eye = (CALL_OF_XENO_WINDOW_SILL + CALL_OF_XENO_WINDOW_HEAD) / 2
        const through = rayBlockDistance(window.inside.x, eye, window.inside.z, 0, 0, dz, OPEN_SOLIDS, 12)
        expect(through.distance).toBe(12)

        const low = rayBlockDistance(window.inside.x, 0.4, window.inside.z, 0, 0, dz, OPEN_SOLIDS, 12)
        expect(low.distance).toBeLessThan(4)

        const high = rayBlockDistance(window.inside.x, 3.4, window.inside.z, 0, 0, dz, OPEN_SOLIDS, 12)
        expect(high.distance).toBeLessThan(4)
    })

    it('boards up to a repairable count', () => {
        expect(CALL_OF_XENO_WINDOW_BOARDS).toBeGreaterThanOrEqual(4)
        expect(CALL_OF_XENO_WINDOW_SILL).toBeLessThan(CALL_OF_XENO_WINDOW_HEAD)
        expect(CALL_OF_XENO_WINDOW_HEAD).toBeLessThan(CALL_OF_XENO_WALL_HEIGHT)
    })

    it('only offers the windows of rooms the player can be reached from', () => {
        const shutOff = reachableWindows(SHUT_TABLE, 0)
        expect(shutOff.length).toBeGreaterThan(0)
        expect(new Set(shutOff.map(w => w.region))).toEqual(new Set([0]))

        const wideOpen = reachableWindows(OPEN_TABLE, 0)
        expect(wideOpen).toHaveLength(CALL_OF_XENO_WINDOWS.length)
    })
})

describe('vertical geometry', () => {
    it('stands an actor on the second floor', () => {
        expect(groundHeight(9, 9, CALL_OF_XENO_UPPER_Y)).toBeCloseTo(CALL_OF_XENO_UPPER_Y, 6)
        expect(groundHeight(27, 9, CALL_OF_XENO_UPPER_Y)).toBeCloseTo(CALL_OF_XENO_UPPER_Y, 6)
        expect(groundHeight(18, 19, CALL_OF_XENO_UPPER_Y)).toBeCloseTo(CALL_OF_XENO_UPPER_Y, 6)
    })

    it('leaves the floor under the deck at ground level', () => {
        expect(groundHeight(9, 9, 0)).toBe(0)
        expect(groundHeight(18, 19, 0)).toBe(0)
    })

    it('climbs each flight linearly from bottom to top', () => {
        for (const ramp of CALL_OF_XENO_RAMPS) {
            const x = (ramp.box.minX + ramp.box.maxX) / 2
            expect(ramp.axis).toBe('z')
            expect(groundHeight(x, ramp.lowAt, 0)).toBeCloseTo(ramp.lowY, 6)
            const mid = (ramp.lowAt + ramp.highAt) / 2
            expect(groundHeight(x, mid, 2.5)).toBeCloseTo((ramp.lowY + ramp.highY) / 2, 6)
            expect(groundHeight(x, ramp.highAt, CALL_OF_XENO_UPPER_Y)).toBeCloseTo(ramp.highY, 6)
        }
    })

    it('walks the whole way up a flight without ever needing more than a step', () => {
        for (const ramp of CALL_OF_XENO_RAMPS) {
            const x = (ramp.box.minX + ramp.box.maxX) / 2
            let feet = ramp.lowY
            for (let i = 0; i <= 40; i++) {
                const z = ramp.lowAt + (ramp.highAt - ramp.lowAt) * (i / 40)
                const ground = groundHeight(x, z, feet)
                expect(ground - feet, `${z}`).toBeLessThanOrEqual(0.65 + 1e-9)
                feet = ground
                expect(penetration(x, z, feet)).toBeLessThan(1e-9)
            }
            expect(feet).toBeCloseTo(CALL_OF_XENO_UPPER_Y, 6)
        }
    })

    it('drops an actor that steps off the catwalk edge', () => {
        // Just south of the deck edge, over the open Atrium floor.
        expect(groundHeight(24, 25, CALL_OF_XENO_UPPER_Y)).toBe(0)
    })

    it('ignores ground clutter for an actor up on the deck', () => {
        // A crate on the Barracks floor must not hold up someone overhead.
        expect(groundHeight(15, 4, CALL_OF_XENO_UPPER_Y)).toBeCloseTo(CALL_OF_XENO_UPPER_Y, 6)
    })

    it('lets an actor walk under the deck without colliding with it', () => {
        const under = solidsInBand(OPEN_SOLIDS, 0, ACTOR_HEIGHT)
        const deck = CALL_OF_XENO_PLATFORMS[0]!
        expect(under.some(box => box === deck.box)).toBe(false)
        const onTop = solidsInBand(OPEN_SOLIDS, CALL_OF_XENO_UPPER_Y, ACTOR_HEIGHT)
        expect(onTop.some(box => box === deck.box)).toBe(false)
    })

    it('roofs the tall halls above the second floor', () => {
        for (const region of CALL_OF_XENO_REGIONS) {
            expect(region.ceiling, region.name).toBeLessThanOrEqual(CALL_OF_XENO_ATRIUM_HEIGHT)
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
            for (let i = 0; i <= 24; i++) {
                const t = i / 24
                const x = from.x + (to.x - from.x) * t
                const z = from.z + (to.z - from.z) * t
                const y = from.y + (to.y - from.y) * t
                const feet = groundHeight(x, z, y + 0.3)
                expect(Math.abs(feet - y), `edge ${a}-${b} at t=${t.toFixed(2)} floats`).toBeLessThan(0.7)
                expect(penetration(x, z, feet), `edge ${a}-${b} at t=${t.toFixed(2)} is blocked`).toBeLessThan(1e-9)
            }
        }
    })

    it('puts every node on solid, unobstructed floor', () => {
        CALL_OF_XENO_NODES.forEach((node, i) => {
            const feet = groundHeight(node.x, node.z, node.y + 0.3)
            expect(feet, `node ${i}`).toBeCloseTo(node.y, 1)
            expect(penetration(node.x, node.z, feet), `node ${i}`).toBeLessThan(1e-9)
        })
    })

    it('strands everything but the Barracks while every door is shut', () => {
        const reached = reachableNodes(SHUT_TABLE, 0)
        // The spawn room and nothing else: two nodes, both inside the Barracks.
        for (const id of reached) {
            const node = CALL_OF_XENO_NODES[id]!
            expect(node.x, `node ${id}`).toBeLessThan(18)
            expect(node.z, `node ${id}`).toBeLessThan(16)
            expect(node.y, `node ${id}`).toBe(0)
        }
        expect(reached.size).toBeLessThan(CALL_OF_XENO_NODES.length)
    })

    it('opens the map up door by door', () => {
        const open = new Set<string>()
        let previous = reachableNodes(buildNavTable(open), 0).size
        for (const door of CALL_OF_XENO_DOORS) {
            open.add(door.id)
            const now = reachableNodes(buildNavTable(open), 0).size
            expect(now, `after ${door.id}`).toBeGreaterThanOrEqual(previous)
            previous = now
        }
        expect(previous).toBe(CALL_OF_XENO_NODES.length)
    })

    it('only reaches the second floor through a flight of stairs', () => {
        // Snip both stair chains and the upper nodes fall off the graph.
        const stairFeet = new Set([24, 31])
        const upper = CALL_OF_XENO_NODES
            .map((node, i) => ({ node, i }))
            .filter(entry => entry.node.y > 0)
            .map(entry => entry.i)
        expect(upper.length).toBeGreaterThan(4)
        for (const id of upper) {
            const links = CALL_OF_XENO_EDGES.filter(([a, b]) => a === id || b === id)
            expect(links.length, `node ${id} is orphaned`).toBeGreaterThan(0)
        }
        for (const foot of stairFeet) {
            expect(CALL_OF_XENO_NODES[foot]!.y).toBe(0)
        }
    })

    it('sends a zombie toward the player once they share a node', () => {
        const target = zombieTarget(OPEN_TABLE, 9, 9, 0, 10, 10, 0)
        expect(target).toEqual({ x: 10, z: 10 })
    })

    it('sends a zombie along the route when the player is rooms away', () => {
        const target = zombieTarget(OPEN_TABLE, 9, 8, 0, 47, 26, 0)
        expect(target.x === 47 && target.z === 26).toBe(false)
    })

    it('never lets a zombie path through a shut door', () => {
        const banned = bannedNodesFor(new Set())
        for (const id of banned) {
            const node = CALL_OF_XENO_NODES[id]!
            const inside = CALL_OF_XENO_DOORS.some(door =>
                node.x >= door.box.minX && node.x <= door.box.maxX
                && node.z >= door.box.minZ && node.z <= door.box.maxZ)
            expect(inside).toBe(true)
        }
        expect(bannedNodesFor(ALL_DOORS_OPEN).size).toBe(0)
    })

    it('does not latch a ground actor onto a node above its head', () => {
        // Standing under the catwalk, the nearest node has to be a ground one.
        const node = CALL_OF_XENO_NODES[nearestNode(7, 19, 0)]!
        expect(node.y).toBe(0)
        const above = CALL_OF_XENO_NODES[nearestNode(7, 19, CALL_OF_XENO_UPPER_Y)]!
        expect(above.y).toBe(CALL_OF_XENO_UPPER_Y)
    })
})

describe('collision solids', () => {
    it('includes shut doors and drops them once bought', () => {
        const shut = collisionSolids(NO_DOORS)
        expect(shut.length - OPEN_SOLIDS.length).toBe(CALL_OF_XENO_DOORS.length)
    })

    it('appends extra solids such as live barrels', () => {
        const extra = { box: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, baseY: 0, height: 1 }
        expect(collisionSolids(ALL_DOORS_OPEN, [extra])).toContain(extra)
    })

    it('gives interior walls a storey and the shell the full two', () => {
        const shellHeights = CALL_OF_XENO_WALLS
            .filter(w => w.box.minX < 0 || w.box.maxX > CALL_OF_XENO_SHELL.maxX
                || w.box.minZ < 0 || w.box.maxZ > CALL_OF_XENO_SHELL.maxZ)
            .map(w => w.baseY + w.height)
        expect(Math.max(...shellHeights)).toBe(CALL_OF_XENO_ATRIUM_HEIGHT)
        for (const crate of CALL_OF_XENO_CRATES) {
            expect(crate.height).toBeLessThan(CALL_OF_XENO_WALL_HEIGHT)
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
                // Only the segments on this face, and only ones tall enough to
                // stop a walker rather than be stepped over.
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
})

describe('ray blocking', () => {
    const eye = 1.6

    it('stops at the near face and reports its normal', () => {
        // Fired west out of the Barracks into the shell.
        const hit = rayBlockDistance(9, eye, 8, -1, 0, 0, OPEN_SOLIDS, 40)
        expect(hit.distance).toBeLessThan(10)
        expect(hit.nx).toBe(1)
    })

    it('returns the max range when nothing is in the way', () => {
        const hit = rayBlockDistance(9, eye, 8, 0, 1, 0, OPEN_SOLIDS, 2)
        expect(hit.distance).toBe(2)
    })

    // A waist-high barrier out in the open Atrium, with clear floor either side.
    const cover = { x: 22.5, z: 19.5, height: 1.1 }

    it('lets a level shot pass over waist-high cover', () => {
        const hit = rayBlockDistance(cover.x - 3, 1.6, cover.z, 1, 0, 0, OPEN_SOLIDS, 6)
        expect(hit.distance).toBe(6)
    })

    it('still stops a shot aimed into that cover', () => {
        const hit = rayBlockDistance(cover.x - 3, 0.5, cover.z, 1, 0, 0, OPEN_SOLIDS, 6)
        expect(hit.distance).toBeLessThan(6)
    })

    it('lets a shot pass beneath the second floor', () => {
        const hit = rayBlockDistance(2, 2, 9, 1, 0, 0, OPEN_SOLIDS, 8)
        expect(hit.distance).toBe(8)
    })

    it('stops a shot fired up into the deck', () => {
        const hit = rayBlockDistance(9, 2, 9, 0, 1, 0, OPEN_SOLIDS, 8)
        expect(hit.distance).toBeLessThan(3)
    })

    it('does not let a shot reach the Mess Hall through a shut door', () => {
        const shut = collisionSolids(NO_DOORS)
        const door = CALL_OF_XENO_DOORS.find(d => d.id === 'door-barracks-mess')!
        const hit = rayBlockDistance(14, eye, door.prompt.z, 1, 0, 0, shut, 12)
        expect(hit.distance).toBeLessThan(6)
    })
})

describe('nav grid', () => {
    const SHAMBLER = 0.45
    const BRUTE = 0.45 * CALL_OF_XENO_ENEMIES.brute.scale

    const insideBox = (point: { x: number, z: number }, box: { minX: number, maxX: number, minZ: number, maxZ: number }) =>
        point.x > box.minX && point.x < box.maxX && point.z > box.minZ && point.z < box.maxZ

    it('keeps open floor passable and cover impassable', () => {
        // Barracks centre, a good way from every wall and crate.
        expect(navCellPassable(OPEN_GRID, 0, 18, 16, SHAMBLER)).toBe(true)
        // Inside the crate against the Barracks north-east corner.
        expect(navCellPassable(OPEN_GRID, 0, 31, 7, SHAMBLER)).toBe(false)
    })

    it('only exists upstairs where the deck and ramps are', () => {
        // Atrium floor, under the catwalk — no upper storey there.
        expect(navCellPassable(OPEN_GRID, 1, 36, 52, SHAMBLER)).toBe(false)
        // Signals, out in the open upstairs.
        expect(navCellPassable(OPEN_GRID, 1, 54, 18, SHAMBLER)).toBe(true)
    })

    it('routes around cover instead of through it', () => {
        // West of the Garage flatbed to south of it — the straight line
        // crosses the truck box (38.5-42.5 × 11.5-17).
        const path = findNavPath(OPEN_GRID, 37, 14, 0, 44, 10, 0, SHAMBLER)
        expect(path).not.toBeNull()
        for (const point of path!) {
            for (const solid of [...CALL_OF_XENO_CRATES, ...CALL_OF_XENO_DECOR.map(d => ({ box: d.box }))]) {
                expect(insideBox(point, solid.box), `waypoint inside cover at ${point.x.toFixed(1)},${point.z.toFixed(1)}`).toBe(false)
            }
        }
        const walked = path!.reduce((sum, point, i) =>
            sum + (i === 0 ? 0 : Math.hypot(point.x - path![i - 1]!.x, point.z - path![i - 1]!.z)), 0)
        expect(walked).toBeGreaterThan(Math.hypot(44 - 37, 10 - 14) + 1)
    })

    it('finds no route through a shut door and one once it is bought', () => {
        expect(findNavPath(SHUT_GRID, 17, 8, 0, 19, 8, 0, SHAMBLER)).toBeNull()
        const path = findNavPath(OPEN_GRID, 17, 8, 0, 19, 8, 0, SHAMBLER)
        expect(path).not.toBeNull()
        const last = path![path!.length - 1]!
        expect(Math.hypot(last.x - 19, last.z - 8)).toBeLessThan(1.5)
    })

    it('changes storey only on a ramp', () => {
        const path = findNavPath(OPEN_GRID, 18, 26, 0, 9, 9, CALL_OF_XENO_UPPER_Y, SHAMBLER)
        expect(path).not.toBeNull()
        expect(navLevelOf(CALL_OF_XENO_UPPER_Y - 0.1)).toBe(1)
        expect(navLevelOf(1)).toBe(0)
        const onRamp = path!.some(point => point.level === 1
            && CALL_OF_XENO_RAMPS.some(ramp => insideBox(point, ramp.box)))
        expect(onRamp).toBe(true)
        // Once upstairs the route stays on deck or ramp cells.
        for (const point of path!) {
            if (point.level !== 1) continue
            const legal = CALL_OF_XENO_PLATFORMS.some(platform => insideBox(point, platform.box))
                || CALL_OF_XENO_RAMPS.some(ramp => insideBox(point, ramp.box))
            expect(legal, `upper waypoint off the deck at ${point.x.toFixed(1)},${point.z.toFixed(1)}`).toBe(true)
        }
    })

    it('does not offer a line of sight through cover', () => {
        // Straight through the Atrium barrier at 21-24 × 18.5-20.5.
        expect(navLineClear(OPEN_GRID, 0, 19.5, 19.5, 25.5, 19.5, SHAMBLER)).toBe(false)
        // Open Atrium floor.
        expect(navLineClear(OPEN_GRID, 0, 12, 26, 16, 26, SHAMBLER)).toBe(true)
    })

    it('refuses a gap too tight for the body and takes it for a smaller one', () => {
        // Between the Barracks crates (gap z 10.5-12.5 around x 3.5-4.5):
        // 2 m wide, plenty for a shambler, a squeeze too far for a brute.
        const small = findNavPath(OPEN_GRID, 5, 13.5, 0, 3.5, 9.5, 0, SHAMBLER)
        const big = findNavPath(OPEN_GRID, 5, 13.5, 0, 3.5, 9.5, 0, BRUTE)
        expect(small).not.toBeNull()
        expect(big).not.toBeNull()
        const length = (path: NonNullable<typeof small>) => path.reduce((sum, point, i) =>
            sum + (i === 0 ? 0 : Math.hypot(point.x - path[i - 1]!.x, point.z - path[i - 1]!.z)), 0)
        expect(length(small!)).toBeLessThan(length(big!))
    })

    it('lands a route next to a goal no body fits in', () => {
        // The goal sits inside the crate at 14-17.5 × 3-5.
        const path = findNavPath(OPEN_GRID, 9, 8, 0, 15.5, 4, 0, SHAMBLER)
        expect(path).not.toBeNull()
        const last = path![path!.length - 1]!
        expect(Math.hypot(last.x - 15.5, last.z - 4)).toBeLessThan(2.5)
        for (const crate of CALL_OF_XENO_CRATES) {
            expect(insideBox(last, crate.box)).toBe(false)
        }
    })
})
