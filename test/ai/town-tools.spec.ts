import { describe, expect, it } from 'vitest'
import { planTownSale, townUpgradeCandidates } from '#server/utils/ai/town'
import { parseToolArguments } from '#server/utils/ai/executors'
import { townLevelCost, getTownBuilding } from '#shared/utils/gamelogic/town'

const building = (id: string, type: string, level: number, extra: Partial<{ upgradingTo: number | null, connected: boolean }> = {}) => ({
  id, type, level, upgradingTo: null, connected: true, ...extra
})

describe('townUpgradeCandidates', () => {
  it('skips roads, unbuilt, upgrading, disconnected and maxed buildings', () => {
    const candidates = townUpgradeCandidates([
      building('road', 'road', 1),
      building('site', 'farm', 0),
      building('busy', 'farm', 2, { upgradingTo: 3 }),
      building('island', 'farm', 1, { connected: false }),
      building('maxed', 'house', 999),
      building('ok', 'farm', 1)
    ])
    expect(candidates.map(candidate => candidate.buildingId)).toEqual(['ok'])
  })

  it('orders lowest level first, then cheapest coins, and reports the next level cost', () => {
    const candidates = townUpgradeCandidates([
      building('quarry', 'quarry', 3),
      building('house', 'house', 1),
      building('farm', 'farm', 1)
    ])
    expect(candidates.map(candidate => candidate.buildingId)).toEqual(['house', 'farm', 'quarry'])
    expect(candidates[0]).toMatchObject({ level: 1, nextLevel: 2, cost: townLevelCost(getTownBuilding('house')!, 2) })
  })

  it('puts preferred types first and honours the limit', () => {
    const candidates = townUpgradeCandidates([
      building('house', 'house', 1),
      building('farm', 'farm', 4),
      building('mill', 'mill', 2)
    ], { preferTypes: ['farm'], limit: 2 })
    expect(candidates.map(candidate => candidate.buildingId)).toEqual(['farm', 'house'])
  })
})

describe('planTownSale', () => {
  const inventory = { wheat: 1000, wood: 3, stone: 0, bricks: 41 }

  it('sells the rounded-down share of every stocked resource', () => {
    const lines = planTownSale(inventory, { percent: 50 })
    expect(lines.map(line => [line.resource, line.quantity])).toEqual([['wheat', 500], ['wood', 1], ['bricks', 20]])
    expect(lines[0]).toMatchObject({ stock: 1000, floorPrice: 30, floorValue: 15_000 })
  })

  it('limits the sale to the requested resources', () => {
    expect(planTownSale(inventory, { percent: 100, resources: ['bricks'] })).toHaveLength(1)
  })

  it('keeps the reserve when it is larger than the remainder', () => {
    const [line] = planTownSale(inventory, { percent: 90, resources: ['wheat'], keepQuantity: 800 })
    expect(line?.quantity).toBe(200)
  })

  it('leaves out resources with nothing to sell', () => {
    expect(planTownSale({ wood: 1 }, { percent: 50 })).toEqual([])
  })

  it('rejects a bad percentage, reserve or resource', () => {
    expect(() => planTownSale(inventory, { percent: 0 })).toThrow()
    expect(() => planTownSale(inventory, { percent: 101 })).toThrow()
    expect(() => planTownSale(inventory, { percent: 50, keepQuantity: -1 })).toThrow()
    expect(() => planTownSale(inventory, { percent: 50, resources: ['gold'] })).toThrow(/gold/)
  })
})

describe('parseToolArguments', () => {
  it('treats an empty string as no arguments', () => {
    expect(parseToolArguments('')).toEqual({})
    expect(parseToolArguments('  ')).toEqual({})
  })

  it('parses an object and rejects anything else that is not an object', () => {
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 })
    expect(parseToolArguments('[1]')).toEqual({})
    expect(() => parseToolArguments('{oops')).toThrow()
  })
})
