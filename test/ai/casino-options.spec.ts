import { describe, expect, it } from 'vitest'
import { invalidCasinoOptions, normalizeCasinoOptions, requireOnlyOptionKeys } from '#server/utils/ai/casino'

describe('invalidCasinoOptions', () => {
  it('throws a 400 with the given message', () => {
    expect(() => invalidCasinoOptions('bad thing')).toThrow('bad thing')
    try {
      invalidCasinoOptions('bad thing')
    } catch (error) {
      expect((error as { statusCode: number }).statusCode).toBe(400)
    }
  })
})

describe('requireOnlyOptionKeys', () => {
  it('accepts an options object containing only allowed keys', () => {
    expect(() => requireOnlyOptionKeys({ winChance: 50 }, ['winChance'])).not.toThrow()
  })

  it('rejects an unexpected key', () => {
    expect(() => requireOnlyOptionKeys({ winChance: 50, target: 2 }, ['winChance'])).toThrow(/target/)
  })
})

describe('normalizeCasinoOptions — shared behavior', () => {
  it('returns undefined when no options are given', () => {
    expect(normalizeCasinoOptions('dice', null, 100)).toBeUndefined()
    expect(normalizeCasinoOptions('dice', undefined, 100)).toBeUndefined()
  })

  it('rejects a non-object options payload', () => {
    expect(() => normalizeCasinoOptions('dice', 'winChance', 100)).toThrow()
    expect(() => normalizeCasinoOptions('dice', [1, 2], 100)).toThrow()
  })

  it('rejects an unsupported game', () => {
    expect(() => normalizeCasinoOptions('roulette', {}, 100)).toThrow()
  })
})

describe('normalizeCasinoOptions — dice', () => {
  it('passes through a valid winChance', () => {
    expect(normalizeCasinoOptions('dice', { winChance: 40 }, 100)).toEqual({ winChance: 40 })
  })

  it('rejects a winChance outside 2 to 96', () => {
    expect(() => normalizeCasinoOptions('dice', { winChance: 1 }, 100)).toThrow()
    expect(() => normalizeCasinoOptions('dice', { winChance: 97 }, 100)).toThrow()
  })

  it('rejects an unknown option key', () => {
    expect(() => normalizeCasinoOptions('dice', { target: 2 }, 100)).toThrow()
  })
})

describe('normalizeCasinoOptions — limbo', () => {
  it('passes through a valid target', () => {
    expect(normalizeCasinoOptions('limbo', { target: 2.5 }, 100)).toEqual({ target: 2.5 })
  })

  it('rejects a target below 1.1', () => {
    expect(() => normalizeCasinoOptions('limbo', { target: 1 }, 100)).toThrow()
  })

  it('rejects a target above 1,000,000', () => {
    expect(() => normalizeCasinoOptions('limbo', { target: 1_000_001 }, 100)).toThrow()
  })
})

describe('normalizeCasinoOptions — wheel', () => {
  it('accepts each known difficulty', () => {
    for (const difficulty of ['easy', 'medium', 'hard']) {
      expect(normalizeCasinoOptions('wheel', { difficulty }, 100)).toEqual({ difficulty })
    }
  })

  it('rejects an unknown difficulty', () => {
    expect(() => normalizeCasinoOptions('wheel', { difficulty: 'extreme' }, 100)).toThrow()
  })
})

describe('normalizeCasinoOptions — magichands', () => {
  it('accepts a handValue and placements whose product matches the bet', () => {
    const result = normalizeCasinoOptions('magichands', { handValue: 10, placements: [0, 5, 39] }, 30)
    expect(result).toEqual({ handValue: 10, placements: [0, 5, 39] })
  })

  it('rejects a bet that does not equal handValue times placement count', () => {
    expect(() => normalizeCasinoOptions('magichands', { handValue: 10, placements: [0, 1] }, 100)).toThrow()
  })

  it('rejects duplicate placements', () => {
    expect(() => normalizeCasinoOptions('magichands', { handValue: 10, placements: [1, 1] }, 20)).toThrow()
  })

  it('rejects placements outside 0 to 39', () => {
    expect(() => normalizeCasinoOptions('magichands', { handValue: 10, placements: [40] }, 10)).toThrow()
    expect(() => normalizeCasinoOptions('magichands', { handValue: 10, placements: [-1] }, 10)).toThrow()
  })

  it('rejects a non-positive handValue', () => {
    expect(() => normalizeCasinoOptions('magichands', { handValue: 0, placements: [0] }, 0)).toThrow()
  })

  it('rejects more than 40 placements', () => {
    const placements = Array.from({ length: 41 }, (_, i) => i % 40)
    expect(() => normalizeCasinoOptions('magichands', { handValue: 1, placements }, 41)).toThrow()
  })
})

describe('normalizeCasinoOptions — buyBonus games', () => {
  for (const game of ['xenoslot', 'fireinthehole', 'bookofshadows']) {
    it(`accepts a boolean buyBonus for ${game}`, () => {
      expect(normalizeCasinoOptions(game, { buyBonus: true }, 100)).toEqual({ buyBonus: true })
      expect(normalizeCasinoOptions(game, { buyBonus: false }, 100)).toEqual({ buyBonus: false })
    })

    it(`rejects a non-boolean buyBonus for ${game}`, () => {
      expect(() => normalizeCasinoOptions(game, { buyBonus: 'yes' }, 100)).toThrow()
    })
  }
})

describe('normalizeCasinoOptions — candymadness', () => {
  it('accepts buyFreeSpins and bonusHunt', () => {
    expect(normalizeCasinoOptions('candymadness', { feature: 'buyFreeSpins' }, 100)).toEqual({ feature: 'buyFreeSpins' })
    expect(normalizeCasinoOptions('candymadness', { feature: 'bonusHunt' }, 100)).toEqual({ feature: 'bonusHunt' })
  })

  it('rejects an unknown feature', () => {
    expect(() => normalizeCasinoOptions('candymadness', { feature: 'superBonus' }, 100)).toThrow()
  })
})

describe('normalizeCasinoOptions — aethergates', () => {
  it('accepts each known feature', () => {
    for (const feature of ['buyFreeSpins', 'superBonus', 'bonusChance']) {
      expect(normalizeCasinoOptions('aethergates', { feature }, 100)).toEqual({ feature })
    }
  })

  it('rejects an unknown feature', () => {
    expect(() => normalizeCasinoOptions('aethergates', { feature: 'bonusHunt' }, 100)).toThrow()
  })
})

describe('normalizeCasinoOptions — spinata', () => {
  it('accepts only buyBonus', () => {
    expect(normalizeCasinoOptions('spinata', { feature: 'buyBonus' }, 100)).toEqual({ feature: 'buyBonus' })
  })

  it('rejects any other feature value', () => {
    expect(() => normalizeCasinoOptions('spinata', { feature: 'bonusHunt' }, 100)).toThrow()
  })
})
