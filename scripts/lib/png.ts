// Minimal indexed-colour PNG writer for the Hero Quest art exporter.
//
// Surfaces already hold palette indices, so they're written as colour type 3 with the game
// palette as PLTE and index 0 transparent via tRNS — the exported file can only contain
// palette colours, and it stays tiny.

import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        t[n] = c >>> 0
    }
    return t
})()

function crc32(buf: Uint8Array): number {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
}

/**
 * Encode an index grid as PNG. `rgb` is the palette as packed 0xRRGGBB (index 0 is written
 * transparent). `scale` > 1 nearest-neighbour upscales, for review sheets.
 */
export function encodeIndexedPng(w: number, h: number, data: Uint8Array, rgb: Uint32Array, scale = 1): Uint8Array {
    const W = w * scale
    const H = h * scale
    const raw = new Uint8Array((W + 1) * H)
    for (let y = 0; y < H; y++) {
        raw[y * (W + 1)] = 0
        const sy = Math.floor(y / scale)
        for (let x = 0; x < W; x++) raw[y * (W + 1) + 1 + x] = data[sy * w + Math.floor(x / scale)]!
    }
    const ihdr = new Uint8Array(13)
    const dv = new DataView(ihdr.buffer)
    dv.setUint32(0, W)
    dv.setUint32(4, H)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 3 // indexed
    const plte = new Uint8Array(rgb.length * 3)
    for (let i = 0; i < rgb.length; i++) {
        plte[i * 3] = (rgb[i]! >> 16) & 255
        plte[i * 3 + 1] = (rgb[i]! >> 8) & 255
        plte[i * 3 + 2] = rgb[i]! & 255
    }
    const trns = new Uint8Array(rgb.length).fill(255)
    trns[0] = 0
    const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
    const parts = [sig, chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('tRNS', trns), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]
    const len = parts.reduce((a, p) => a + p.length, 0)
    const out = new Uint8Array(len)
    let o = 0
    for (const p of parts) { out.set(p, o); o += p.length }
    return out
}
