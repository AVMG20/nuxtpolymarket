/**
 * Rail Tycoon's little-endian binary codec for saves and wire messages.
 * RtWriter grows as it writes; RtReader never reads past its end and turns any malformed
 * input into RtBadData, so a decoder can map bad bytes to null or a socket close.
 */

const MAX_SAFE = Number.MAX_SAFE_INTEGER

// a varint carries at most 53 bits: 8 bytes of 7 bits each
const VARINT_MAX_BYTES = 8
// an svarint's first byte holds 6 magnitude bits, its LEB128 tail at most 7 more bytes
const SVARINT_TAIL_MAX_BYTES = 7

const encoder = new TextEncoder()
// ignoreBOM keeps a leading U+FEFF, so a name round-trips and a decoded world hashes like the live one
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function checkInt(value: number, min: number, max: number, what: string): void {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`${what} out of range: ${value}`)
    }
}

/** Thrown by RtReader on a short read, an over-long or out-of-range number, or a bad string. */
export class RtBadData extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'RtBadData'
    }
}

/** UTF-8 byte length of one code point, as TextEncoder writes it (a lone surrogate becomes U+FFFD). */
function utf8Length(codePoint: number): number {
    if (codePoint < 0x80) return 1
    if (codePoint < 0x800) return 2
    if (codePoint < 0x10000) return 3
    return 4
}

/** The longest prefix of text whose UTF-8 encoding fits maxBytes, never splitting a code point. */
export function clampUtf8(text: string, maxBytes: number): string {
    checkInt(maxBytes, 0, MAX_SAFE, 'maxBytes')
    let bytes = 0
    let end = 0
    for (const char of text) {
        const size = utf8Length(char.codePointAt(0)!)
        if (bytes + size > maxBytes) break
        bytes += size
        end += char.length
    }
    return end === text.length ? text : text.slice(0, end)
}

export class RtWriter {
    private buf = new Uint8Array(256)
    private view = new DataView(this.buf.buffer)
    private pos = 0

    /** Bytes written so far. */
    get length(): number {
        return this.pos
    }

    private ensure(extra: number): void {
        const need = this.pos + extra
        if (need <= this.buf.length) return
        let size = this.buf.length
        while (size < need) size *= 2
        const next = new Uint8Array(size)
        next.set(this.buf.subarray(0, this.pos))
        this.buf = next
        this.view = new DataView(next.buffer)
    }

    u8(value: number): void {
        checkInt(value, 0, 0xff, 'u8')
        this.ensure(1)
        this.buf[this.pos++] = value
    }

    u16(value: number): void {
        checkInt(value, 0, 0xffff, 'u16')
        this.ensure(2)
        this.view.setUint16(this.pos, value, true)
        this.pos += 2
    }

    i16(value: number): void {
        checkInt(value, -0x8000, 0x7fff, 'i16')
        this.ensure(2)
        this.view.setInt16(this.pos, value, true)
        this.pos += 2
    }

    u32(value: number): void {
        checkInt(value, 0, 0xffffffff, 'u32')
        this.ensure(4)
        this.view.setUint32(this.pos, value, true)
        this.pos += 4
    }

    i32(value: number): void {
        checkInt(value, -0x80000000, 0x7fffffff, 'i32')
        this.ensure(4)
        this.view.setInt32(this.pos, value, true)
        this.pos += 4
    }

    /** Unsigned LEB128 for 0 to 2^53 - 1, written with division so it never wraps at 32 bits. */
    varint(value: number): void {
        checkInt(value, 0, MAX_SAFE, 'varint')
        this.writeLeb(value)
    }

    /** Signed: first byte is continuation, sign and six magnitude bits; the rest of the magnitude follows as LEB128. */
    svarint(value: number): void {
        checkInt(value, -MAX_SAFE, MAX_SAFE, 'svarint')
        const negative = value < 0
        const magnitude = negative ? -value : value
        const low = magnitude % 64
        const rest = Math.floor(magnitude / 64)
        this.ensure(1)
        this.buf[this.pos++] = (rest > 0 ? 0x80 : 0) | (negative ? 0x40 : 0) | low
        if (rest > 0) this.writeLeb(rest)
    }

    private writeLeb(value: number): void {
        let rest = value
        while (rest >= 0x80) {
            this.ensure(1)
            this.buf[this.pos++] = 0x80 | rest % 0x80
            rest = Math.floor(rest / 0x80)
        }
        this.ensure(1)
        this.buf[this.pos++] = rest
    }

    /** Raw bytes with no length prefix; the reader must know the count. */
    bytes(data: Uint8Array): void {
        this.ensure(data.length)
        this.buf.set(data, this.pos)
        this.pos += data.length
    }

    /** UTF-8 text with its byte length as a varint. */
    str(text: string): void {
        const data = encoder.encode(text)
        this.varint(data.length)
        this.bytes(data)
    }

    /** A trimmed copy of everything written. */
    finish(): Uint8Array {
        return this.buf.slice(0, this.pos)
    }
}

export class RtReader {
    private readonly buf: Uint8Array
    private readonly view: DataView
    private pos = 0

    constructor(data: Uint8Array) {
        this.buf = data
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    }

    /** Bytes not yet read. */
    remaining(): number {
        return this.buf.length - this.pos
    }

    /** Throws RtBadData unless every byte was consumed. */
    end(): void {
        if (this.pos !== this.buf.length) throw new RtBadData(`${this.remaining()} trailing bytes`)
    }

    private need(count: number): void {
        if (this.buf.length - this.pos < count) throw new RtBadData(`short read: need ${count}, have ${this.remaining()}`)
    }

    u8(): number {
        this.need(1)
        return this.buf[this.pos++]!
    }

    u16(): number {
        this.need(2)
        const value = this.view.getUint16(this.pos, true)
        this.pos += 2
        return value
    }

    i16(): number {
        this.need(2)
        const value = this.view.getInt16(this.pos, true)
        this.pos += 2
        return value
    }

    u32(): number {
        this.need(4)
        const value = this.view.getUint32(this.pos, true)
        this.pos += 4
        return value
    }

    i32(): number {
        this.need(4)
        const value = this.view.getInt32(this.pos, true)
        this.pos += 4
        return value
    }

    varint(): number {
        return this.readLeb(VARINT_MAX_BYTES)
    }

    svarint(): number {
        const first = this.u8()
        const negative = (first & 0x40) !== 0
        let magnitude = first & 0x3f
        if (first & 0x80) {
            const rest = this.readLeb(SVARINT_TAIL_MAX_BYTES)
            if (rest === 0) throw new RtBadData('svarint continuation without magnitude')
            magnitude += rest * 64
            if (magnitude > MAX_SAFE) throw new RtBadData('svarint beyond the safe-integer range')
        }
        if (negative && magnitude === 0) throw new RtBadData('svarint negative zero')
        return negative ? -magnitude : magnitude
    }

    private readLeb(maxBytes: number): number {
        let value = 0
        let scale = 1
        for (let i = 0; i < maxBytes; i++) {
            const byte = this.u8()
            value += (byte & 0x7f) * scale
            if ((byte & 0x80) === 0) {
                if (value > MAX_SAFE) throw new RtBadData('varint beyond the safe-integer range')
                return value
            }
            scale *= 0x80
        }
        throw new RtBadData(`varint longer than ${maxBytes} bytes`)
    }

    /** The next n bytes as a view into the source (no copy). */
    bytes(count: number): Uint8Array {
        if (!Number.isInteger(count) || count < 0) throw new RtBadData(`bad byte count ${count}`)
        this.need(count)
        const out = this.buf.subarray(this.pos, this.pos + count)
        this.pos += count
        return out
    }

    /** A length-prefixed UTF-8 string of at most maxBytes; invalid UTF-8 is refused. */
    str(maxBytes: number): string {
        const length = this.varint()
        if (length > maxBytes) throw new RtBadData(`string of ${length} bytes exceeds ${maxBytes}`)
        const data = this.bytes(length)
        try {
            return decoder.decode(data)
        } catch {
            throw new RtBadData('invalid utf-8')
        }
    }
}
