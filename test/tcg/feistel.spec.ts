import { describe, expect, it } from 'vitest'
import { deriveKey, feistelPermute } from '#server/utils/tcg/feistel'

const SECRET_A = 'aa'.repeat(32)
const SECRET_B = 'bb'.repeat(32)

const DOMAINS = [1, 2, 3, 7, 121, 2500, 2683]
const KEYS = [deriveKey(SECRET_A, 'sheet:one'), deriveKey(SECRET_B, 'god')]

function fullMapping(domainSize: number, key: Buffer): number[] {
    const out: number[] = []
    for (let i = 0; i < domainSize; i++) {
        out.push(feistelPermute(i, domainSize, key))
    }
    return out
}

describe('feistelPermute', () => {
    it('is a bijection over the full domain (cycle-walk terminates)', () => {
        for (const domainSize of DOMAINS) {
            for (const key of KEYS) {
                const sorted = [...fullMapping(domainSize, key)].sort((a, b) => a - b)
                expect(sorted).toEqual(Array.from({ length: domainSize }, (_, i) => i))
            }
        }
    })

    it('is deterministic across calls', () => {
        for (const domainSize of DOMAINS) {
            for (const key of KEYS) {
                expect(fullMapping(domainSize, key)).toEqual(fullMapping(domainSize, key))
            }
        }
    })

    it('different keys give different permutations', () => {
        for (const domainSize of DOMAINS.filter(d => d >= 121)) {
            expect(fullMapping(domainSize, KEYS[0]!)).not.toEqual(fullMapping(domainSize, KEYS[1]!))
        }
    })

    it('different labels from the same secret give different permutations', () => {
        const keyA = deriveKey(SECRET_A, 'sheet:one')
        const keyB = deriveKey(SECRET_A, 'sheet:two')
        expect(keyA.equals(keyB)).toBe(false)
        for (const domainSize of DOMAINS.filter(d => d >= 121)) {
            expect(fullMapping(domainSize, keyA)).not.toEqual(fullMapping(domainSize, keyB))
        }
    })

    it('returns index unchanged for domainSize <= 1', () => {
        expect(feistelPermute(0, 1, KEYS[0]!)).toBe(0)
        expect(feistelPermute(0, 0, KEYS[0]!)).toBe(0)
    })

    it('throws on out-of-range or non-integer inputs', () => {
        const key = KEYS[0]!
        expect(() => feistelPermute(-1, 10, key)).toThrow(RangeError)
        expect(() => feistelPermute(10, 10, key)).toThrow(RangeError)
        expect(() => feistelPermute(1.5, 10, key)).toThrow(TypeError)
        expect(() => feistelPermute(0, 10.5, key)).toThrow(TypeError)
    })
})

describe('deriveKey', () => {
    it('is deterministic and 32 bytes', () => {
        const key = deriveKey(SECRET_A, 'god')
        expect(key.length).toBe(32)
        expect(key.equals(deriveKey(SECRET_A, 'god'))).toBe(true)
    })
})
