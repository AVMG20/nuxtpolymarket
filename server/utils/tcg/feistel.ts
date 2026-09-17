import { createHmac } from 'node:crypto'

export function deriveKey(secretHex: string, label: string): Buffer {
    return createHmac('sha256', Buffer.from(secretHex, 'hex')).update(label).digest()
}

// F(round, half) = first b bits of HMAC-SHA256(key, roundByte || halfAsUInt32BE)
function roundF(key: Buffer, round: number, half: number, b: number): number {
    const input = Buffer.alloc(5)
    input.writeUInt8(round, 0)
    input.writeUInt32BE(half, 1)
    const digest = createHmac('sha256', key).update(input).digest()
    const bytes = Math.ceil(b / 8)
    let value = 0
    for (let i = 0; i < bytes; i++) {
        value = value * 256 + digest[i]!
    }
    return value >>> (bytes * 8 - b)
}

// Keyed bijection [0, domainSize) -> [0, domainSize): balanced 4-round Feistel
// over 2^(2b) with cycle-walking (design doc §3.3).
export function feistelPermute(index: number, domainSize: number, key: Buffer): number {
    if (!Number.isInteger(index) || !Number.isInteger(domainSize)) {
        throw new TypeError('feistelPermute: index and domainSize must be integers')
    }
    if (index < 0 || index >= Math.max(domainSize, 1)) {
        throw new RangeError(`feistelPermute: index ${index} out of range for domain ${domainSize}`)
    }
    if (domainSize <= 1) return index

    const b = Math.max(1, Math.ceil(Math.ceil(Math.log2(domainSize)) / 2))
    const halfSize = 2 ** b
    const mask = halfSize - 1

    let value = index
    do {
        let left = Math.floor(value / halfSize)
        let right = value & mask
        for (let round = 0; round < 4; round++) {
            const next = left ^ roundF(key, round, right, b)
            left = right
            right = next
        }
        value = left * halfSize + right
    } while (value >= domainSize)
    return value
}
