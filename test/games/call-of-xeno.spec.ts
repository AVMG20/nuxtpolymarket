import { describe, it, expect } from 'vitest'
import {
    CALL_OF_XENO_WEAPONS,
    CALL_OF_XENO_PERKS,
    CALL_OF_XENO_PACK_A_PUNCH_COST,
    packAPunch,
    ammoCost,
    zombieHealth,
    zombieCount,
    zombieSpeed,
    zombieSpawnInterval,
    zombieDamage,
    type CallOfXenoWeaponId
} from '../../shared/utils/gamelogic/call-of-xeno'
import {
    CALL_OF_XENO_WALLS,
    CALL_OF_XENO_CRATES,
    CALL_OF_XENO_ROOMS,
    CALL_OF_XENO_ROOM_THEMES,
    CALL_OF_XENO_DOORS,
    CALL_OF_XENO_NODES,
    CALL_OF_XENO_INTERACTABLES,
    CALL_OF_XENO_PLAYER_START,
    CALL_OF_XENO_WALL_HEIGHT,
    collisionSolids,
    rayBlockDistance,
    roomAt,
    nodeAt,
    reachableRooms,
    resolveCircle,
    zombieTarget
} from '../../shared/utils/gamelogic/call-of-xeno-map'

/** Every door open — the worst case for "can a zombie reach the player". */
const ALL_DOORS_OPEN = new Set(CALL_OF_XENO_DOORS.map(d => d.id))
const OPEN_BOXES = collisionSolids(ALL_DOORS_OPEN).map(s => s.box)

describe('call of xeno weapons', () => {
    it('ships five conventional weapons plus one wonder weapon', () => {
        const ids = Object.keys(CALL_OF_XENO_WEAPONS) as CallOfXenoWeaponId[]
        expect(ids).toHaveLength(6)
        expect(ids).toContain('xenoray')
        // The wonder weapon out-damages everything else by a wide margin.
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

    it('only hands out the pistol for free', () => {
        const free = Object.values(CALL_OF_XENO_WEAPONS).filter(w => w.cost === 0)
        expect(free.map(w => w.id)).toEqual(['m1911'])
    })

    it('charges half the wall price for an ammo refill', () => {
        expect(ammoCost(CALL_OF_XENO_WEAPONS.mp40)).toBe(500)
        expect(ammoCost(CALL_OF_XENO_WEAPONS.xenoray)).toBe(2250)
    })
})

describe('pack-a-punch', () => {
    it('raises damage, magazine, reserve and penetration', () => {
        const base = CALL_OF_XENO_WEAPONS.ak74
        const upgraded = packAPunch(base)
        expect(upgraded.damage).toBeGreaterThan(base.damage)
        expect(upgraded.magSize).toBeGreaterThan(base.magSize)
        expect(upgraded.reserveAmmo).toBe(base.reserveAmmo * 2)
        expect(upgraded.penetration).toBe(base.penetration + 1)
        expect(upgraded.name).toBe(base.upgradedName)
    })

    it('leaves the base weapon untouched', () => {
        const before = { ...CALL_OF_XENO_WEAPONS.mp40 }
        packAPunch(CALL_OF_XENO_WEAPONS.mp40)
        expect(CALL_OF_XENO_WEAPONS.mp40).toEqual(before)
    })

    it('costs more than any wall buy, so it is a late-run purchase', () => {
        const priciest = Math.max(...Object.values(CALL_OF_XENO_WEAPONS).map(w => w.cost))
        expect(CALL_OF_XENO_PACK_A_PUNCH_COST).toBeGreaterThan(priciest)
    })
})

describe('round scaling', () => {
    it('adds a flat 100 health a round through round nine', () => {
        expect(zombieHealth(1)).toBe(150)
        expect(zombieHealth(9)).toBe(950)
        expect(zombieHealth(2) - zombieHealth(1)).toBe(100)
    })

    it('compounds after round nine and never goes backwards', () => {
        expect(zombieHealth(10)).toBeGreaterThan(zombieHealth(9))
        for (let r = 1; r < 40; r++) {
            expect(zombieHealth(r + 1)).toBeGreaterThan(zombieHealth(r))
        }
    })

    it('caps spawn count, speed and floors the spawn interval', () => {
        expect(zombieCount(1)).toBe(8)
        expect(zombieCount(100)).toBe(48)
        expect(zombieSpeed(100)).toBeLessThanOrEqual(5.2)
        expect(zombieSpawnInterval(100)).toBeGreaterThanOrEqual(0.45)
        expect(zombieSpeed(1)).toBeLessThan(zombieSpeed(10))
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
    it('offers four machines, all of them power gated in the map', () => {
        expect(Object.keys(CALL_OF_XENO_PERKS)).toHaveLength(4)
        const machines = CALL_OF_XENO_INTERACTABLES.filter(i => i.kind === 'perk')
        expect(machines).toHaveLength(4)
        expect(machines.every(m => m.needsPower)).toBe(true)
    })
})

describe('map layout', () => {
    it('has three rooms joined by two doors', () => {
        expect(CALL_OF_XENO_ROOMS).toHaveLength(3)
        expect(CALL_OF_XENO_DOORS).toHaveLength(2)
    })

    it('puts the power lever and the pack-a-punch in the third room', () => {
        const lever = CALL_OF_XENO_INTERACTABLES.find(i => i.kind === 'power')!
        const pap = CALL_OF_XENO_INTERACTABLES.find(i => i.kind === 'papunch')!
        expect(lever.room).toBe(2)
        expect(pap.room).toBe(2)
        expect(pap.needsPower).toBe(true)
        // The lever itself must not require power, or the map is unwinnable.
        expect(lever.needsPower).toBe(false)
    })

    it('places every interactable inside the room it claims', () => {
        for (const item of CALL_OF_XENO_INTERACTABLES) {
            const bounds = CALL_OF_XENO_ROOMS[item.room]!.bounds
            expect(item.x).toBeGreaterThanOrEqual(bounds.minX - 0.6)
            expect(item.x).toBeLessThanOrEqual(bounds.maxX + 0.6)
            expect(item.z).toBeGreaterThanOrEqual(bounds.minZ - 0.6)
            expect(item.z).toBeLessThanOrEqual(bounds.maxZ + 0.6)
        }
    })

    it('does not start the player inside anything solid', () => {
        const start = CALL_OF_XENO_PLAYER_START
        const solved = resolveCircle(start.x, start.z, 0.35, OPEN_BOXES)
        expect(solved.x).toBeCloseTo(start.x, 6)
        expect(solved.z).toBeCloseTo(start.z, 6)
    })

    it('does not spawn zombies inside anything solid either', () => {
        for (const room of CALL_OF_XENO_ROOMS) {
            for (const spawn of room.spawns) {
                const solved = resolveCircle(spawn.x, spawn.z, 0.45, OPEN_BOXES)
                expect(solved.x).toBeCloseTo(spawn.x, 6)
                expect(solved.z).toBeCloseTo(spawn.z, 6)
            }
        }
    })

    it('keeps every navigation lane clear so zombies never wedge on cover', () => {
        for (let i = 0; i < CALL_OF_XENO_NODES.length - 1; i++) {
            const from = CALL_OF_XENO_NODES[i]!
            const to = CALL_OF_XENO_NODES[i + 1]!
            for (let t = 0; t <= 1; t += 0.02) {
                const x = from.x + (to.x - from.x) * t
                const z = from.z + (to.z - from.z) * t
                const solved = resolveCircle(x, z, 0.45, OPEN_BOXES)
                expect(Math.hypot(solved.x - x, solved.z - z)).toBeLessThan(1e-6)
            }
        }
    })

    it('gives each room its own palette', () => {
        expect(CALL_OF_XENO_ROOM_THEMES).toHaveLength(CALL_OF_XENO_ROOMS.length)
        const lights = CALL_OF_XENO_ROOM_THEMES.map(t => t.lightColor)
        expect(new Set(lights).size).toBe(lights.length)
    })

    it('leaves cover at waist height rather than sealing the rooms', () => {
        for (const crate of CALL_OF_XENO_CRATES) {
            expect(crate.height).toBeGreaterThan(0.8)
            expect(crate.height).toBeLessThan(CALL_OF_XENO_WALL_HEIGHT)
        }
    })

    it('maps positions to rooms and navigation nodes', () => {
        expect(roomAt(10, 10)).toBe(0)
        expect(roomAt(34, 10)).toBe(1)
        expect(roomAt(58, 10)).toBe(2)
        expect(roomAt(22, 10)).toBe(-1)
        expect(nodeAt(10)).toBe(0)
        expect(nodeAt(22)).toBe(1)
        expect(nodeAt(58)).toBe(4)
    })
})

describe('collision', () => {
    it('pushes a circle out of a box along the shallowest axis', () => {
        const box = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }
        const solved = resolveCircle(10.2, 5, 1, [box])
        expect(solved.x).toBeCloseTo(11, 6)
        expect(solved.z).toBeCloseTo(5, 6)
    })

    it('ejects a circle whose centre is inside the box', () => {
        const box = { minX: 0, maxX: 10, minZ: 0, maxZ: 4 }
        const solved = resolveCircle(5, 3.5, 0.5, [box])
        expect(solved.z).toBeCloseTo(4.5, 6)
    })

    it('leaves a circle clear of the box alone', () => {
        const box = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }
        const solved = resolveCircle(8, 8, 0.5, [box])
        expect(solved).toEqual({ x: 8, z: 8 })
    })

    it('keeps the player out of every wall from any starting overlap', () => {
        for (let x = -1; x < 70; x += 1.7) {
            for (let z = -1; z < 21; z += 1.7) {
                const solved = resolveCircle(x, z, 0.35, CALL_OF_XENO_WALLS)
                const again = resolveCircle(solved.x, solved.z, 0.35, CALL_OF_XENO_WALLS)
                // One resolve pass should already be stable for these boxes.
                expect(Math.hypot(again.x - solved.x, again.z - solved.z)).toBeLessThan(0.4)
            }
        }
    })
})

describe('zombie navigation', () => {
    it('walks toward the player once they share a stretch of the map', () => {
        const target = zombieTarget(4, 4, 12, 12)
        expect(target).toEqual({ x: 12, z: 12 })
    })

    it('steps toward the next waypoint when the player is rooms away', () => {
        const target = zombieTarget(4, 4, 58, 10)
        expect(target).toEqual({ x: 22, z: 10 })
    })

    it('steps backwards when the player is behind it', () => {
        const target = zombieTarget(58, 4, 10, 10)
        expect(target).toEqual({ x: 46, z: 10 })
    })
})

describe('reachable rooms', () => {
    it('is only the starting room while both doors are shut', () => {
        expect(reachableRooms(0, new Set())).toEqual([0])
        expect(reachableRooms(2, new Set())).toEqual([2])
    })

    it('opens up as doors are bought', () => {
        expect(reachableRooms(0, new Set(['door-bay-hall']))).toEqual([0, 1])
        expect(reachableRooms(0, new Set(['door-bay-hall', 'door-hall-deck']))).toEqual([0, 1, 2])
    })

    it('does not jump a closed door in the middle', () => {
        expect(reachableRooms(0, new Set(['door-hall-deck']))).toEqual([0])
    })

    it('falls back to the first room when the player is in a corridor', () => {
        expect(reachableRooms(-1, new Set())).toEqual([0])
    })
})


describe('collision solids', () => {
    it('includes shut doors and drops them once bought', () => {
        const shut = collisionSolids(new Set())
        const open = collisionSolids(ALL_DOORS_OPEN)
        expect(shut.length - open.length).toBe(CALL_OF_XENO_DOORS.length)
    })

    it('gives walls full height and crates their own', () => {
        const solids = collisionSolids(new Set())
        const heights = new Set(solids.map(s => s.height))
        expect(heights.has(CALL_OF_XENO_WALL_HEIGHT)).toBe(true)
        expect(solids.filter(s => s.height < CALL_OF_XENO_WALL_HEIGHT).length).toBeGreaterThan(0)
    })
})

describe('ray blocking', () => {
    const wall = [{ box: { minX: 4, maxX: 5, minZ: -5, maxZ: 5 }, height: 4 }]
    const crate = [{ box: { minX: 4, maxX: 5, minZ: -5, maxZ: 5 }, height: 1 }]

    it('stops at the near face and reports its normal', () => {
        const hit = rayBlockDistance(0, 1, 0, 1, 0, 0, wall, 50)
        expect(hit.distance).toBeCloseTo(4, 6)
        expect([hit.nx, hit.ny, hit.nz]).toEqual([-1, 0, 0])
    })

    it('returns the max range when nothing is in the way', () => {
        const hit = rayBlockDistance(0, 1, 0, -1, 0, 0, wall, 50)
        expect(hit.distance).toBe(50)
    })

    it('lets a level shot pass over waist-high cover', () => {
        const hit = rayBlockDistance(0, 1.7, 0, 1, 0, 0, crate, 50)
        expect(hit.distance).toBe(50)
    })

    it('still stops a shot aimed into that cover', () => {
        const hit = rayBlockDistance(0, 0.5, 0, 1, 0, 0, crate, 50)
        expect(hit.distance).toBeCloseTo(4, 6)
    })

    it('reports a floor-facing normal when a shot lands on top of cover', () => {
        const hit = rayBlockDistance(4.5, 3, 0, 0, -1, 0, crate, 50)
        expect(hit.distance).toBeCloseTo(2, 6)
        expect([hit.nx, hit.ny, hit.nz]).toEqual([0, 1, 0])
    })

    it('does not let a shot pass through a wall to reach the next room', () => {
        const solids = collisionSolids(new Set())
        // Standing in the Landing Bay, firing straight down the corridor lane
        // at a shut door: the door must stop the round well short of room two.
        const hit = rayBlockDistance(10, 1.6, 10, 1, 0, 0, solids, 60)
        expect(hit.distance).toBeLessThan(13)
    })
})
