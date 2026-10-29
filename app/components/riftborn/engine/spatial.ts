/*
 * Uniform grid for broad-phase collision. Rebuilt every frame from the live
 * enemy list. Anything bigger than half a cell lives in a separate list that
 * every query scans, so bosses don't need multi-cell insertion.
 */

export interface SpatialItem {
    x: number
    y: number
    radius: number
    dead: boolean
}

export class SpatialHash<T extends SpatialItem> {
    readonly cell: number
    readonly big: T[] = []
    private readonly map = new Map<number, T[]>()
    private readonly used: T[][] = []
    private readonly half: number

    constructor(cell = 80) {
        this.cell = cell
        this.half = cell / 2
    }

    private key(cx: number, cy: number): number {
        return (cx + 32768) * 65536 + (cy + 32768)
    }

    clear(): void {
        for (const arr of this.used) arr.length = 0
        this.used.length = 0
        this.big.length = 0
        // Infinite world: drop empty buckets now and then so the map can't grow forever
        if (this.map.size > 6000) this.map.clear()
    }

    insert(item: T): void {
        if (item.radius > this.half) {
            this.big.push(item)
            return
        }
        const k = this.key(Math.floor(item.x / this.cell), Math.floor(item.y / this.cell))
        let arr = this.map.get(k)
        if (!arr) {
            arr = []
            this.map.set(k, arr)
        }
        if (arr.length === 0) this.used.push(arr)
        arr.push(item)
    }

    /**
     * Calls fn for every live item whose circle may touch (x, y, r). Exact
     * overlap is up to the caller. Return true from fn to stop early.
     */
    query(x: number, y: number, r: number, fn: (item: T) => unknown): void {
        const pad = r + this.half
        const x0 = Math.floor((x - pad) / this.cell)
        const x1 = Math.floor((x + pad) / this.cell)
        const y0 = Math.floor((y - pad) / this.cell)
        const y1 = Math.floor((y + pad) / this.cell)
        for (let cx = x0; cx <= x1; cx++) {
            for (let cy = y0; cy <= y1; cy++) {
                const arr = this.map.get(this.key(cx, cy))
                if (!arr || arr.length === 0) continue
                for (let i = 0; i < arr.length; i++) {
                    const it = arr[i]!
                    if (it.dead) continue
                    if (fn(it) === true) return
                }
            }
        }
        for (let i = 0; i < this.big.length; i++) {
            const it = this.big[i]!
            if (it.dead) continue
            if (fn(it) === true) return
        }
    }
}
