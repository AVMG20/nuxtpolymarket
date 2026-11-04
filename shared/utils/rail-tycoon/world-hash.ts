/**
 * The desync hash: 32-bit FNV-1a over exactly what a save holds, written by save-write.ts into a
 * hashing sink instead of bytes. A world decoded from a snapshot therefore hashes equal to the live
 * world it was taken from, and a field added to the save is hashed with no second edit.
 */

import { rtWriteSavedState, type RtSaveSink } from './save-write'
import type { RtWorld } from './world'

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const TWO_32 = 0x100000000

/** Scratch for hashing a number that is not a safe integer by its float64 bits (state should never hold one). */
const scratchF64 = new Float64Array(1)
const scratchU32 = new Uint32Array(scratchF64.buffer)

/**
 * A number is hashed as its 64-bit two's complement (low word, then high word, little-endian), so
 * -0 and 0 hash alike as they encode alike; bytes one by one; a string as its length and UTF-16 code
 * units. Every number field is hashed the same way, whatever width the save gives it.
 */
class RtHashSink implements RtSaveSink {
    h = FNV_OFFSET

    private word(w: number): void {
        let h = this.h
        h = Math.imul(h ^ (w & 0xff), FNV_PRIME)
        h = Math.imul(h ^ ((w >>> 8) & 0xff), FNV_PRIME)
        h = Math.imul(h ^ ((w >>> 16) & 0xff), FNV_PRIME)
        h = Math.imul(h ^ (w >>> 24), FNV_PRIME)
        this.h = h
    }

    private num(value: number): void {
        if (Number.isSafeInteger(value)) {
            this.word(value >>> 0)
            this.word(Math.floor(value / TWO_32) | 0)
        } else {
            scratchF64[0] = value
            this.word(scratchU32[0]!)
            this.word(scratchU32[1]!)
        }
    }

    u8(value: number): void {
        this.num(value)
    }

    u16(value: number): void {
        this.num(value)
    }

    u32(value: number): void {
        this.num(value)
    }

    varint(value: number): void {
        this.num(value)
    }

    svarint(value: number): void {
        this.num(value)
    }

    bytes(data: Uint8Array): void {
        let h = this.h
        for (let k = 0; k < data.length; k++) h = Math.imul(h ^ data[k]!, FNV_PRIME)
        this.h = h
    }

    str(text: string): void {
        this.num(text.length)
        let h = this.h
        for (let k = 0; k < text.length; k++) {
            const unit = text.charCodeAt(k)
            h = Math.imul(h ^ (unit & 0xff), FNV_PRIME)
            h = Math.imul(h ^ (unit >>> 8), FNV_PRIME)
        }
        this.h = h
    }
}

/** One sink, reset per hash; hashing is synchronous, so it is never shared between two calls. */
const hashSink = new RtHashSink()

/**
 * The world's desync hash (u32). Call it at a tick boundary. Throws RangeError when the world breaks a
 * save bound, exactly as encodeWorld would.
 */
export function rtWorldHash(world: RtWorld): number {
    hashSink.h = FNV_OFFSET
    rtWriteSavedState(hashSink, world)
    return hashSink.h >>> 0
}
