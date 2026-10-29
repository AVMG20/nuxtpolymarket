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

// The engine draws every pack's cuts and god flag through this permutation:
// a collision would hand two packs the same cut and mint duplicate copies.
describe('feistelPermute', () => {
    it('is a bijection over the full domain (cycle-walk terminates)', () => {
        for (const domainSize of DOMAINS) {
            for (const key of KEYS) {
                const sorted = [...fullMapping(domainSize, key)].sort((a, b) => a - b)
                expect(sorted).toEqual(Array.from({ length: domainSize }, (_, i) => i))
            }
        }
    })

    it('throws on out-of-range or non-integer inputs', () => {
        const key = KEYS[0]!
        expect(() => feistelPermute(-1, 10, key)).toThrow(RangeError)
        expect(() => feistelPermute(10, 10, key)).toThrow(RangeError)
        expect(() => feistelPermute(1.5, 10, key)).toThrow(TypeError)
        expect(() => feistelPermute(0, 10.5, key)).toThrow(TypeError)
    })
})
