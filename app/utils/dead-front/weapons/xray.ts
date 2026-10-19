// The X-Ray's colour schemes: the base gun is brass with a green core; every
// Pack-a-Punch tier gives it a new striking look (electric blue on nickel,
// crimson on black lacquer and rose gold, radiant gold on gold and ivory).
// The model, the muzzle flash, the bolt, its trail, the impact and its light
// all read their colours from here.

export interface DfXrayScheme {
    /** The glowing core: tubes, chamber, bolt shell, trail and light. */
    core: number
    /** White-hot centre of the emitter, the bolt core and the impact. */
    hot: number
    /** Glass envelopes (tubes, capsule, chamber windows). */
    glass: number
    /** Body metal replacing the brass. */
    body: number
    /** Trim replacing the copper bands, barrel and fins' accents. */
    trim: number
    /** Grip colour. */
    grip: number
}

export const DF_XRAY_SCHEMES: [DfXrayScheme, DfXrayScheme, DfXrayScheme, DfXrayScheme] = [
    { core: 0x2fd855, hot: 0xd8ffe0, glass: 0x3fae62, body: 0xc0953f, trim: 0xa65f2c, grip: 0x6a2c1c },
    { core: 0x2a8cff, hot: 0xdcefff, glass: 0x3f86c8, body: 0xaab4c0, trim: 0xc0953f, grip: 0x2a2c34 },
    { core: 0xff1e5a, hot: 0xffd6e2, glass: 0xc0406a, body: 0x2c2228, trim: 0xd6876a, grip: 0x161216 },
    { core: 0xffae0a, hot: 0xfff6d8, glass: 0xd8a040, body: 0xe2b448, trim: 0xf2ead2, grip: 0xe8dcc0 }
]

export function dfXrayScheme(tier: number): DfXrayScheme {
    return DF_XRAY_SCHEMES[Math.max(0, Math.min(3, Math.floor(tier) || 0))]!
}
