// Every pixel drawn by Pixel Crusade comes from this palette. Sprites, scenery and
// particles reference colours by name (C.x) or by index into PALETTE (particles).

export const C = {
    ink: '#0d0a14',
    void: '#171326',
    night0: '#1f1a38',
    night1: '#2c2854',
    night2: '#433d7a',
    night3: '#6461a8',
    haze: '#9a93c9',

    white: '#ffffff',
    steel0: '#3a3f52',
    steel1: '#62697f',
    steel2: '#9aa4bb',
    steel3: '#d6deec',

    skin0: '#7d4430',
    skin1: '#c47a55',
    skin2: '#efb58c',

    red0: '#4a1220',
    red1: '#8f2233',
    red2: '#d8404a',
    red3: '#ff7b6b',
    orange: '#f07a2a',
    gold0: '#7a4f14',
    gold1: '#c98c26',
    gold2: '#f5c542',
    gold3: '#fff09a',

    green0: '#132b1d',
    green1: '#23532f',
    green2: '#3f8f3e',
    green3: '#7cc653',
    green4: '#c4f07a',

    brown0: '#28180f',
    brown1: '#4c2e1b',
    brown2: '#7a4d2c',
    brown3: '#ae7c4c',

    blue0: '#142654',
    blue1: '#2350a6',
    blue2: '#3f8ee6',
    cyan: '#7fe8ff',

    purple0: '#2e1446',
    purple1: '#5a2482',
    purple2: '#9848d0',
    pink: '#f08ad8',

    bone0: '#8f8570',
    bone1: '#d9ceb0',

    stone0: '#1f1e29',
    stone1: '#363447',
    stone2: '#55526a',
    stone3: '#7c7892',

    lava0: '#9c1e10',
    lava1: '#ff4d1a'
} as const

export type ColorName = keyof typeof C

export const PALETTE: string[] = Object.values(C)

const INDEX = new Map<string, number>(PALETTE.map((c, i) => [c, i]))
const RGB_INDEX = new Map<number, number>(PALETTE.map((c, i) => [parseInt(c.slice(1), 16), i]))

/** Palette index of a named colour (for particle colours). */
export function ci(name: ColorName): number {
    return INDEX.get(C[name])!
}

/** Palette index for a packed 0xRRGGBB value, or -1 when it isn't a palette colour. */
export function rgbIndex(rgb: number): number {
    return RGB_INDEX.get(rgb) ?? -1
}

// Particle colour ramps: a particle walks from the first entry to the last over its life.
function ramp(...names: ColorName[]): Uint8Array {
    return Uint8Array.from(names.map(ci))
}

export const RAMP = {
    spark: ramp('white', 'gold3', 'gold2', 'orange', 'red1', 'brown1'),
    steel: ramp('white', 'steel3', 'steel2', 'steel1', 'steel0'),
    fire: ramp('white', 'gold3', 'gold2', 'orange', 'lava1', 'red1', 'red0'),
    holy: ramp('white', 'gold3', 'gold2', 'gold1', 'gold0'),
    arcane: ramp('white', 'cyan', 'pink', 'purple2', 'purple1', 'purple0'),
    frost: ramp('white', 'cyan', 'blue2', 'blue1', 'blue0'),
    nature: ramp('white', 'green4', 'green3', 'green2', 'green1'),
    slime: ramp('green4', 'green3', 'green2', 'green1', 'green0'),
    bone: ramp('white', 'bone1', 'bone0', 'stone2', 'stone1'),
    blood: ramp('red3', 'red2', 'red1', 'red0'),
    dust: ramp('stone3', 'stone2', 'stone1', 'stone0'),
    ember: ramp('gold3', 'orange', 'lava1', 'lava0', 'stone1'),
    shadow: ramp('pink', 'purple2', 'purple1', 'purple0', 'void')
} as const

export type RampName = keyof typeof RAMP
export const RAMPS: Uint8Array[] = Object.values(RAMP)
export const RAMP_ID = Object.fromEntries(Object.keys(RAMP).map((k, i) => [k, i])) as Record<RampName, number>
