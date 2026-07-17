import { vi } from 'vitest'
import { TWO_POW_26, TWO_POW_53 } from '../../shared/utils/random'

/**
 * Pin the value randomFloat() will return, by stubbing the entropy underneath it
 * rather than the helper itself — so the tests still exercise the real
 * randomFloat(). Inverts its 53-bit packing: hi 27 bits in buf[0], lo 26 in buf[1].
 * The packing constants are imported from the real implementation so this can't drift.
 */
export function stubRandomFloat(next: () => number) {
    return vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
        const buf = array as unknown as Uint32Array
        const target = Math.max(0, Math.min(TWO_POW_53 - 1, Math.floor(next() * TWO_POW_53)))
        buf[0] = (Math.floor(target / TWO_POW_26) << 5) >>> 0
        buf[1] = ((target % TWO_POW_26) << 6) >>> 0
        return array
    })
}
