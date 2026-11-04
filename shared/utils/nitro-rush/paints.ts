/** The car's paint jobs: picked in the menu, and sent with each live pose so other players see the same colour. */
export const PAINTS = [
    { id: 'hotpink', label: 'Rosso', color: 0xc40a2c },
    { id: 'cyan', label: 'Estoril Blue', color: 0x0b5fc4 },
    { id: 'lime', label: 'Verde Mantis', color: 0x6fb80c },
    { id: 'gold', label: 'Giallo', color: 0xf0a800 },
    { id: 'violet', label: 'Viola', color: 0x4e2380 },
    { id: 'white', label: 'Bianco', color: 0xeeeeee }
] as const

export type PaintId = typeof PAINTS[number]['id']

export const isPaintId = (id: unknown): id is PaintId => PAINTS.some(p => p.id === id)

/** An unknown id (a stale stored choice) falls back to the first paint. */
export const findPaint = (id: string) => PAINTS.find(p => p.id === id) ?? PAINTS[0]
