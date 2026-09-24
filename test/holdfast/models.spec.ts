import { afterAll, describe, expect, it } from 'vitest'
import type * as THREE from 'three'
import { BUILDINGS } from '../../shared/utils/holdfast/config'
import type { BuildingKind } from '../../shared/utils/holdfast/config'
import {
    DECOR_VARIANTS,
    KNIGHT_ANCHORS,
    ROCK_VARIANTS,
    TREE_VARIANTS,
    UNIT_ANCHORS,
    UNIT_PARTS,
    arrowGeometry,
    blobGeometry,
    boltGeometry,
    boulderGeometry,
    buildingGeometry,
    catapultCloth,
    catapultGeometry,
    crystalGeometry,
    debrisGeometry,
    decorGeometry,
    disposeHoldfastModels,
    flagGeometry,
    gateGeometry,
    ramGeometry,
    ringGeometry,
    rockGeometry,
    siegeTowerGeometry,
    treeGeometry,
    wallGeometry
} from '../../app/utils/holdfast/models'

const tris = (g: THREE.BufferGeometry) => g.getAttribute('position').count / 3

function expectValid(g: THREE.BufferGeometry, maxTris: number, label: string): void {
    expect(g.index, label).toBeNull()
    for (const name of ['position', 'normal', 'color']) {
        const attr = g.getAttribute(name)
        expect(attr, `${label} ${name}`).toBeDefined()
        expect(attr.itemSize, `${label} ${name}`).toBe(3)
        expect(attr.count, `${label} ${name}`).toBe(g.getAttribute('position').count)
    }
    expect(g.getAttribute('uv'), `${label} uv`).toBeUndefined()
    expect(tris(g), label).toBeGreaterThan(0)
    expect(tris(g), label).toBeLessThan(maxTris)
    const pos = g.getAttribute('position').array
    expect(Array.from(pos).every(Number.isFinite), label).toBe(true)
}

function bounds(g: THREE.BufferGeometry): THREE.Box3 {
    g.computeBoundingBox()
    const box = g.boundingBox
    if (!box) throw new Error('no bounding box')
    return box
}

const kinds = (Object.keys(BUILDINGS) as BuildingKind[]).filter(k => k !== 'wall' && k !== 'gate')

describe('holdfast models', () => {
    afterAll(() => disposeHoldfastModels())

    it('builds every building level within budget and footprint', () => {
        for (const kind of kinds) {
            const def = BUILDINGS[kind]
            for (let lv = 1; lv <= def.hp.length; lv++) {
                const g = buildingGeometry(kind, lv)
                const label = `${kind} L${lv}`
                expectValid(g, 6500, label)
                const box = bounds(g)
                const half = def.size / 2
                expect(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z), label).toBeLessThanOrEqual(half - 0.05)
                expect(box.min.y, label).toBeGreaterThanOrEqual(-0.4)
            }
        }
    })

    it('caches by kind and level', () => {
        expect(buildingGeometry('keep', 2)).toBe(buildingGeometry('keep', 2))
        expect(buildingGeometry('tower', 1)).not.toBe(buildingGeometry('tower', 2))
    })

    it('clamps out-of-range levels', () => {
        expect(buildingGeometry('tower', 99)).toBe(buildingGeometry('tower', BUILDINGS.tower.hp.length))
        expect(buildingGeometry('goldmine', 0)).toBe(buildingGeometry('goldmine', 1))
    })

    it('builds walls and gates that fill one cell', () => {
        for (let tier = 1; tier <= 3; tier++) {
            const wall = wallGeometry(tier)
            expectValid(wall, 250, `wall ${tier}`)
            const box = bounds(wall)
            expect(box.min.x).toBeCloseTo(-0.5, 2)
            expect(box.max.x).toBeCloseTo(0.5, 2)
            expect(box.min.z).toBeCloseTo(-0.5, 2)
            expect(box.max.z).toBeCloseTo(0.5, 2)

            const gate = gateGeometry(tier)
            expectValid(gate, 800, `gate ${tier}`)
            const gb = bounds(gate)
            expect(Math.max(-gb.min.x, gb.max.x, -gb.min.z, gb.max.z)).toBeLessThanOrEqual(0.5 + 1e-4)
        }
    })

    it('builds nature within one tile', () => {
        const sets: [string, number, (v: number) => THREE.BufferGeometry, number][] = [
            ['tree', TREE_VARIANTS, treeGeometry, 400],
            ['rock', ROCK_VARIANTS, rockGeometry, 200],
            ['decor', DECOR_VARIANTS, decorGeometry, 200]
        ]
        for (const [name, count, fn, max] of sets) {
            expect(count).toBeGreaterThan(0)
            for (let v = 0; v < count; v++) {
                const g = fn(v)
                expectValid(g, max, `${name} ${v}`)
                const box = bounds(g)
                expect(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z), `${name} ${v}`).toBeLessThanOrEqual(0.5)
            }
        }
        expect(treeGeometry(TREE_VARIANTS + 1)).toBe(treeGeometry(1))
    })

    it('builds unit parts within budget', () => {
        const names = ['body', 'bodyTrim', 'head', 'helmet', 'hood', 'sword', 'shield', 'shieldEmblem', 'bow'] as const
        for (const name of names) expectValid(UNIT_PARTS[name], 200, name)
        expect(UNIT_ANCHORS.headTop).toBeGreaterThan(0.5)
        expect(UNIT_ANCHORS.rightHand[0]).toBeLessThan(0)
        // A soldier stands about 0.64 tall with its head near the top.
        const head = bounds(UNIT_PARTS.head)
        expect(head.max.y).toBeGreaterThan(0.58)
        expect(head.max.y).toBeLessThan(0.66)
        expect(bounds(UNIT_PARTS.bodyTrim).min.y).toBeCloseTo(0, 2)
    })

    it('builds knight parts within budget', () => {
        const names = ['knightBody', 'knightTrim', 'knightHelm', 'knightSword', 'knightShield', 'knightEmblem'] as const
        for (const name of names) expectValid(UNIT_PARTS[name], 400, name)
        expect(KNIGHT_ANCHORS.rightHand[0]).toBeLessThan(0)
        expect(KNIGHT_ANCHORS.leftHand[0]).toBeGreaterThan(0)
        expect(bounds(UNIT_PARTS.knightHelm).max.y).toBeGreaterThan(KNIGHT_ANCHORS.headTop - 0.05)
    })

    it('builds siege engines', () => {
        const cat = catapultGeometry()
        expectValid(cat.frame, 900, 'catapult frame')
        expectValid(cat.arm, 400, 'catapult arm')
        expectValid(cat.wheels, 900, 'catapult wheels')
        expectValid(cat.cloth, 400, 'catapult cloth')
        expect(catapultCloth()).toBe(cat.cloth)
        expect(cat.armPivot).toHaveLength(3)
        const frame = bounds(cat.frame)
        expect(frame.max.z - frame.min.z).toBeLessThan(1.3)
        expect(Math.max(-bounds(cat.wheels).min.x, bounds(cat.wheels).max.x)).toBeLessThanOrEqual(0.46)
        // At rest the arm points back (-Z) from its pivot.
        expect(bounds(cat.arm).min.z).toBeLessThan(-0.4)

        const ram = ramGeometry()
        expectValid(ram.body, 1400, 'ram body')
        expectValid(ram.log, 1200, 'ram log')
        expectValid(ram.cloth, 1200, 'ram cloth')
        // The log pokes out of the front of the shed.
        expect(bounds(ram.log).max.z + ram.logPivot[2]).toBeGreaterThan(bounds(ram.body).max.z)

        const tower = siegeTowerGeometry()
        expectValid(tower.body, 1400, 'siege tower body')
        expectValid(tower.bridge, 1200, 'siege tower bridge')
        expectValid(tower.cloth, 1200, 'siege tower cloth')
        const tb = bounds(tower.body)
        expect(tb.max.y).toBeGreaterThan(2)
        expect(Math.max(-tb.min.x, tb.max.x, -tb.min.z, tb.max.z)).toBeLessThanOrEqual(0.46)
        // The closed drawbridge stands up from its hinge.
        expect(bounds(tower.bridge).min.y).toBeGreaterThanOrEqual(-0.05)
        expect(bounds(tower.bridge).max.y).toBeGreaterThan(0.4)
    })

    it('builds effects and props', () => {
        const misc: [string, () => THREE.BufferGeometry][] = [
            ['arrow', arrowGeometry],
            ['ring', ringGeometry],
            ['blob', blobGeometry],
            ['flag', flagGeometry],
            ['crystal', crystalGeometry],
            ['debris', debrisGeometry],
            ['bolt', boltGeometry],
            ['boulder', boulderGeometry]
        ]
        for (const [name, fn] of misc) expectValid(fn(), 300, name)
        const arrow = bounds(arrowGeometry())
        expect(arrow.min.z).toBeCloseTo(0, 2)
        expect(arrow.max.z).toBeCloseTo(1, 2)
        const bolt = bounds(boltGeometry())
        expect(bolt.min.z).toBeCloseTo(0, 2)
        expect(bolt.max.z).toBeCloseTo(1, 2)
        const ring = ringGeometry().getAttribute('normal')
        expect(ring.getY(0)).toBeCloseTo(1, 5)
    })

    it('rebuilds after dispose', () => {
        const before = UNIT_PARTS.head
        disposeHoldfastModels()
        const after = UNIT_PARTS.head
        expect(after).not.toBe(before)
        expect(tris(after)).toBe(tris(before))
    })
})
