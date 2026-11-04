import { describe, expect, it } from 'vitest'
import { clampUtf8, RtBadData, RtReader, RtWriter } from '#shared/utils/rail-tycoon/bytes'

const MAX = Number.MAX_SAFE_INTEGER

function roundTrip(write: (w: RtWriter) => void, read: (r: RtReader) => unknown): unknown {
    const w = new RtWriter()
    write(w)
    const r = new RtReader(w.finish())
    const value = read(r)
    r.end()
    return value
}

describe('RtWriter and RtReader', () => {
    it('round-trips boundary values of every fixed-width method', () => {
        for (const v of [0, 1, 0xff]) expect(roundTrip(w => w.u8(v), r => r.u8())).toBe(v)
        for (const v of [0, 0xffff]) expect(roundTrip(w => w.u16(v), r => r.u16())).toBe(v)
        for (const v of [-0x8000, -1, 0, 0x7fff]) expect(roundTrip(w => w.i16(v), r => r.i16())).toBe(v)
        for (const v of [0, 0xffffffff]) expect(roundTrip(w => w.u32(v), r => r.u32())).toBe(v)
        for (const v of [-0x80000000, -1, 0, 0x7fffffff]) expect(roundTrip(w => w.i32(v), r => r.i32())).toBe(v)
    })

    it('round-trips varints up to 2^53 - 1', () => {
        for (const v of [0, 1, 127, 128, 16383, 16384, 0xffffffff, 2 ** 32, 2 ** 52, MAX]) {
            expect(roundTrip(w => w.varint(v), r => r.varint())).toBe(v)
        }
    })

    it('round-trips svarints across the whole safe range', () => {
        for (const v of [-MAX, -(2 ** 40), -64, -63, -1, 0, 1, 63, 64, 65, 2 ** 31, 2 ** 40, MAX]) {
            expect(roundTrip(w => w.svarint(v), r => r.svarint())).toBe(v)
        }
    })

    it('keeps svarints of small magnitude in one byte and the extremes within 8', () => {
        const small = new RtWriter()
        small.svarint(-63)
        small.svarint(63)
        expect(small.finish().length).toBe(2)
        const big = new RtWriter()
        big.svarint(-MAX)
        expect(big.finish().length).toBe(8)
    })

    it('round-trips bytes and strings', () => {
        const data = new Uint8Array([0, 1, 2, 250, 255])
        expect(Array.from(roundTrip(w => w.bytes(data), r => r.bytes(5)) as Uint8Array)).toEqual([0, 1, 2, 250, 255])
        expect(roundTrip(w => w.str(''), r => r.str(32))).toBe('')
        expect(roundTrip(w => w.str('Zürich Halt 🚂'), r => r.str(32))).toBe('Zürich Halt 🚂')
    })

    it('encodes little-endian', () => {
        const w = new RtWriter()
        w.u16(0x1234)
        expect(Array.from(w.finish())).toEqual([0x34, 0x12])
        const w32 = new RtWriter()
        w32.u32(0x12345678)
        expect(Array.from(w32.finish())).toEqual([0x78, 0x56, 0x34, 0x12])
    })

    it('grows past its initial buffer and reads everything back', () => {
        const w = new RtWriter()
        for (let i = 0; i < 300; i++) w.u8(i & 0xff)
        for (let i = 0; i < 10000; i++) w.u32(i * 7)
        const bytes = w.finish()
        expect(bytes.length).toBe(300 + 40000)
        const r = new RtReader(bytes)
        for (let i = 0; i < 300; i++) expect(r.u8()).toBe(i & 0xff)
        for (let i = 0; i < 10000; i++) expect(r.u32()).toBe(i * 7)
        r.end()
    })

    it('returns a trimmed copy from finish', () => {
        const w = new RtWriter()
        w.u8(9)
        const a = w.finish()
        w.u8(10)
        expect(Array.from(a)).toEqual([9])
        expect(Array.from(w.finish())).toEqual([9, 10])
    })

    it('throws RangeError for out-of-range and non-integer writes', () => {
        const w = new RtWriter()
        expect(() => w.u8(256)).toThrow(RangeError)
        expect(() => w.u8(-1)).toThrow(RangeError)
        expect(() => w.u16(0x10000)).toThrow(RangeError)
        expect(() => w.i16(0x8000)).toThrow(RangeError)
        expect(() => w.i16(-0x8001)).toThrow(RangeError)
        expect(() => w.u32(2 ** 32)).toThrow(RangeError)
        expect(() => w.i32(2 ** 31)).toThrow(RangeError)
        expect(() => w.u8(1.5)).toThrow(RangeError)
        expect(() => w.varint(2 ** 53)).toThrow(RangeError)
        expect(() => w.varint(-1)).toThrow(RangeError)
        expect(() => w.varint(0.5)).toThrow(RangeError)
        expect(() => w.svarint(2 ** 53)).toThrow(RangeError)
        expect(() => w.svarint(-(2 ** 53))).toThrow(RangeError)
        expect(() => w.svarint(1.5)).toThrow(RangeError)
        expect(() => w.svarint(Number.NaN)).toThrow(RangeError)
        expect(w.length).toBe(0)
    })

    it('throws RtBadData on a short read', () => {
        expect(() => new RtReader(new Uint8Array(3)).u32()).toThrow(RtBadData)
        expect(() => new RtReader(new Uint8Array(1)).u16()).toThrow(RtBadData)
        expect(() => new RtReader(new Uint8Array(0)).u8()).toThrow(RtBadData)
        expect(() => new RtReader(new Uint8Array(3)).i32()).toThrow(RtBadData)
        expect(() => new RtReader(new Uint8Array(2)).bytes(3)).toThrow(RtBadData)
    })

    it('throws RtBadData from end() while bytes remain', () => {
        const r = new RtReader(new Uint8Array([1, 2]))
        r.u8()
        expect(r.remaining()).toBe(1)
        expect(() => r.end()).toThrow(RtBadData)
        r.u8()
        expect(() => r.end()).not.toThrow()
    })

    it('throws RtBadData for a string over maxBytes or with invalid utf-8', () => {
        const w = new RtWriter()
        w.str('a'.repeat(33))
        expect(() => new RtReader(w.finish()).str(32)).toThrow(RtBadData)
        expect(() => new RtReader(new Uint8Array([2, 0xc3, 0x28])).str(32)).toThrow(RtBadData)
        expect(() => new RtReader(new Uint8Array([5, 0x41])).str(32)).toThrow(RtBadData)
    })

    it('throws RtBadData for truncated and over-long varints', () => {
        expect(() => new RtReader(new Uint8Array([0x80])).varint()).toThrow(RtBadData)
        expect(() => new RtReader(new Uint8Array(9).fill(0x80)).varint()).toThrow(RtBadData)
        // 8 bytes that decode past 2^53 - 1
        expect(() => new RtReader(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f])).varint()).toThrow(RtBadData)
    })

    it('throws RtBadData for truncated, over-long and out-of-range svarints', () => {
        expect(() => new RtReader(new Uint8Array([0x80])).svarint()).toThrow(RtBadData)
        expect(() => new RtReader(new Uint8Array([0xc0, 0x80, 0x80])).svarint()).toThrow(RtBadData)
        expect(() => new RtReader(new Uint8Array(9).fill(0xff)).svarint()).toThrow(RtBadData)
        expect(() => new RtReader(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f])).svarint()).toThrow(RtBadData)
        // negative zero is never written, so it is refused
        expect(() => new RtReader(new Uint8Array([0x40])).svarint()).toThrow(RtBadData)
        const w = new RtWriter()
        w.svarint(-MAX)
        const bytes = w.finish()
        expect(() => new RtReader(bytes.subarray(0, 7)).svarint()).toThrow(RtBadData)
    })
})

describe('clampUtf8', () => {
    const utf8 = (s: string) => new TextEncoder().encode(s).length

    it('keeps a long accented and emoji name within 32 bytes without breaking a code point', () => {
        const name = 'Ébèn Çà 🚂🚃 Zürich Straße Ñandú'
        expect([...name].length).toBe(30)
        const clamped = clampUtf8(name, 32)
        expect(utf8(clamped)).toBeLessThanOrEqual(32)
        expect(name.startsWith(clamped)).toBe(true)
        expect(clamped).not.toMatch(/[\uD800-\uDBFF]$/)
        // the next code point would not have fitted
        const next = [...name][[...clamped].length]!
        expect(utf8(clamped) + utf8(next)).toBeGreaterThan(32)
        const r = new RtReader((() => {
            const w = new RtWriter()
            w.str(clamped)
            return w.finish()
        })())
        expect(r.str(32)).toBe(clamped)
    })

    it('never cuts a surrogate pair', () => {
        expect(clampUtf8('ab🚂', 5)).toBe('ab')
        expect(clampUtf8('ab🚂', 6)).toBe('ab🚂')
        expect(clampUtf8('🚂🚂', 7)).toBe('🚂')
    })

    it('returns a name already within the limit unchanged', () => {
        const name = 'Northgate Junction'
        expect(clampUtf8(name, 32)).toBe(name)
        expect(clampUtf8('', 32)).toBe('')
        expect(clampUtf8('Ünïcödé', 32)).toBe('Ünïcödé')
    })
})
