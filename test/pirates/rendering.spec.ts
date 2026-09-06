import { describe, expect, it } from 'vitest'
import { Container } from 'pixi.js'
import { createShipVisual, fireShipCannon, updateShipCannons } from '../../app/utils/pirates-engine/sprite-fx'
import type { PirateCannonRuntime } from '../../app/utils/pirates-engine/types'

const loadout: PirateCannonRuntime[] = [1, 5, 7].map(slotIndex => ({
    slotIndex, tierId: 'longgun', attackRating: 45, maxDamage: 36,
    reloadMs: 1600, range: 320, shotColor: 0x38bdf8, shotTrail: false
}))

describe('procedural pirate cannon mounts', () => {
    it.each([0, Math.PI / 2, Math.PI, -Math.PI / 3])('aims the equipped slot through rotated and scaled transforms (%s)', (heading) => {
        const stage = new Container()
        stage.scale.set(0.65)
        const world = new Container()
        stage.addChild(world)
        const ship = createShipVisual(0xe8bc63, true, 1.3, undefined, 'starter', loadout)
        world.addChild(ship.root)
        ship.root.position.set(400, 300)
        ship.hull.rotation = heading
        ship.body.rotation = 0.025
        const target = { x: 650, y: 420 }
        const muzzle = fireShipCannon(ship, target.x, target.y, 5)
        const gun = ship.cannons.find(gun => gun.slotIndex === 5)!
        const origin = world.toLocal(gun.mount.toGlobal({ x: 0, y: 0 }))
        expect(Math.atan2(muzzle.y - origin.y, muzzle.x - origin.x))
            .toBeCloseTo(Math.atan2(target.y - origin.y, target.x - origin.x), 5)
        expect(Math.hypot(muzzle.x - origin.x, muzzle.y - origin.y)).toBeCloseTo(16 * 1.3)
        updateShipCannons(ship, 0.05)
        expect(gun.barrel.x).toBeLessThan(0)
        expect(ship.cannons.filter(other => other !== gun).every(other => other.barrel.x === 0)).toBe(true)
        updateShipCannons(ship, 0.3)
        expect(gun.barrel.x).toBeCloseTo(0)
        stage.destroy({ children: true })
    })

    it('preserves sparse equipped slot identifiers without inventing player guns', () => {
        const ship = createShipVisual(0xe8bc63, true, 1, undefined, 'starter', loadout)
        expect(ship.cannons.map(gun => gun.slotIndex)).toEqual([1, 5, 7])
        ship.root.destroy({ children: true })
        const unarmed = createShipVisual(0xe8bc63, true, 1)
        expect(unarmed.cannons).toHaveLength(0)
        unarmed.root.destroy({ children: true })
    })
})
