/**
 * The line a player drives through bends, using the road's width: outside, clip the inside, out wide again.
 * Solved as Rémi Coulom's K1999 bot does: each point slides across the road until its bend blends with its neighbours'.
 */

/** Metres kept clear of the road's edge: the car's half width and room for the bot to stray. */
export const RACING_MARGIN = 1.5
/** Coarsest spacing, in points, the smoothing starts at; halved down to 1. */
const COARSEST_STEP = 64
/** Smoothing passes at each spacing, times the root of the spacing. */
const PASSES = 12
/** Metres a point is moved to measure how its bend changes. */
const NUDGE = 1e-3
/** Below this, in radians per metre, the road runs straight. */
const STRAIGHT = 1e-4

/** The road a line is worked out along: a course's line, or the lines a route drives strung together. */
export interface RoadPlan {
    readonly n: number
    readonly closed: boolean
    readonly xs: ArrayLike<number>
    readonly zs: ArrayLike<number>
    /** Unit tangent at each point. */
    readonly txs: ArrayLike<number>
    readonly tzs: ArrayLike<number>
    /** How far the road reaches to the left and right of each point; short of half its width where it shares a deck with another. */
    readonly left: ArrayLike<number>
    readonly right: ArrayLike<number>
    /** 1 where the point is on rails. */
    readonly railed: ArrayLike<number>
}

export interface RacingLine {
    /** Per point: metres across from the centreline, + right. */
    offsets: Float64Array
    /** Per point: how sharply the line turns, in radians per metre; 0 on rails. */
    curvature: Float64Array
}

/** Signed curvature of the circle through three points. */
function curvatureOf(ax: number, az: number, bx: number, bz: number, cx: number, cz: number) {
    const x1 = cx - bx
    const z1 = cz - bz
    const x2 = ax - bx
    const z2 = az - bz
    const x3 = cx - ax
    const z3 = cz - az
    const norms = Math.sqrt((x1 * x1 + z1 * z1) * (x2 * x2 + z2 * z2) * (x3 * x3 + z3 * z3))
    return norms > 0 ? 2 * (x1 * z2 - x2 * z1) / norms : 0
}

/** One stretch of plan the line is worked out over, `m` points from `from`: a whole loop, or an open run that starts and ends on the centreline. */
class Stretch {
    readonly cx: Float64Array
    readonly cz: Float64Array
    /** The road's right at each point. */
    readonly rx: Float64Array
    readonly rz: Float64Array
    /** The centreline's bend at each point, + turning right. */
    readonly turn: Float64Array
    /** How far across each point may go, to the left (-) and right. */
    readonly lo: Float64Array
    readonly hi: Float64Array
    readonly lat: Float64Array
    readonly x: Float64Array
    readonly z: Float64Array

    constructor(line: RoadPlan, readonly from: number, readonly m: number, readonly loop: boolean) {
        this.cx = new Float64Array(m)
        this.cz = new Float64Array(m)
        this.rx = new Float64Array(m)
        this.rz = new Float64Array(m)
        this.turn = new Float64Array(m)
        this.lo = new Float64Array(m)
        this.hi = new Float64Array(m)
        this.lat = new Float64Array(m)
        this.x = new Float64Array(m)
        this.z = new Float64Array(m)
        for (let j = 0; j < m; j++) {
            const i = (from + j) % line.n
            this.cx[j] = line.xs[i]!
            this.cz[j] = line.zs[i]!
            this.rx[j] = -line.tzs[i]!
            this.rz[j] = line.txs[i]!
            this.lo[j] = -Math.max(0, line.left[i]! - RACING_MARGIN)
            this.hi[j] = Math.max(0, line.right[i]! - RACING_MARGIN)
        }
        for (let j = 1; j < m - 1 || (loop && j < m); j++) {
            const a = j - 1
            const c = (j + 1) % m
            this.turn[j] = curvatureOf(this.cx[a]!, this.cz[a]!, this.cx[j]!, this.cz[j]!, this.cx[c]!, this.cz[c]!)
        }
        if (loop) this.turn[0] = curvatureOf(this.cx[m - 1]!, this.cz[m - 1]!, this.cx[0]!, this.cz[0]!, this.cx[1]!, this.cz[1]!)
        else this.lo[0] = this.hi[0] = this.lo[m - 1] = this.hi[m - 1] = 0
    }

    private place(j: number, lat: number) {
        this.lat[j] = lat
        this.x[j] = this.cx[j]! + this.rx[j]! * lat
        this.z[j] = this.cz[j]! + this.rz[j]! * lat
    }

    curvatureAt(a: number, b: number, c: number) {
        return curvatureOf(this.x[a]!, this.z[a]!, this.x[b]!, this.z[b]!, this.x[c]!, this.z[c]!)
    }

    /** Slides point `j` across until the line through `a`, `j` and `c` bends by `target`, kept `slack` inside its room but never past the middle. */
    private adjust(a: number, j: number, c: number, target: number, slack: number) {
        const lo = Math.min(0, this.lo[j]! + slack)
        const hi = Math.max(0, this.hi[j]! - slack)
        const dx = this.x[c]! - this.x[a]!
        const dz = this.z[c]! - this.z[a]!
        const across = dx * this.rz[j]! - dz * this.rx[j]!
        // From the chord, where the line runs straight, a Newton step to the bend wanted.
        let lat = Math.abs(across) > 1e-9 ? -(dx * (this.cz[j]! - this.z[a]!) - dz * (this.cx[j]! - this.x[a]!)) / across : this.lat[j]!
        lat = Math.max(lo * 1.5, Math.min(hi * 1.5, lat))
        this.place(j, lat)
        const slope = curvatureOf(this.x[a]!, this.z[a]!, this.x[j]! + this.rx[j]! * NUDGE, this.z[j]! + this.rz[j]! * NUDGE, this.x[c]!, this.z[c]!) / NUDGE
        if (Math.abs(slope) > 1e-9) lat += target / slope
        this.place(j, Math.max(lo, Math.min(hi, lat)))
    }

    /** The points visited at spacing `step`: every step-th one, and an open stretch's last. */
    private nodes(step: number) {
        const out: number[] = []
        for (let j = 0; j < this.m; j += step) out.push(j)
        if (!this.loop && out[out.length - 1] !== this.m - 1) out.push(this.m - 1)
        return out
    }

    private smooth(nodes: readonly number[]) {
        const k = nodes.length
        const at = (q: number) => nodes[this.loop ? (q + k) % k : Math.max(0, Math.min(k - 1, q))]!
        for (let q = this.loop ? 0 : 1; q < (this.loop ? k : k - 1); q++) {
            const j = nodes[q]!
            const prev = at(q - 1)
            const next = at(q + 1)
            // Past an open stretch's end the road runs on straight.
            const before = !this.loop && q < 2 ? 0 : this.curvatureAt(at(q - 2), prev, j)
            const after = !this.loop && q > k - 3 ? 0 : this.curvatureAt(j, next, at(q + 2))
            const lp = Math.hypot(this.x[j]! - this.x[prev]!, this.z[j]! - this.z[prev]!)
            const ln = Math.hypot(this.x[j]! - this.x[next]!, this.z[j]! - this.z[next]!)
            // Long spans stay clear of the edges, for the finer passes to settle.
            this.adjust(prev, j, next, (ln * before + lp * after) / (ln + lp || 1), lp * ln / 800)
        }
    }

    /** Places the points between nodes, their bends blended from one node's to the next's. */
    private interpolate(nodes: readonly number[]) {
        const k = nodes.length
        for (let q = 0; q < (this.loop ? k : k - 1); q++) {
            const a = nodes[q]!
            const b = nodes[(q + 1) % k]!
            const gap = (b - a + this.m) % this.m || this.m
            if (gap < 2) continue
            const prev = nodes[this.loop ? (q - 1 + k) % k : Math.max(0, q - 1)]!
            const next = nodes[this.loop ? (q + 2) % k : Math.min(k - 1, q + 2)]!
            const from = prev === a ? 0 : this.curvatureAt(prev, a, b)
            const to = next === b ? 0 : this.curvatureAt(a, b, next)
            for (let g = 1; g < gap; g++) this.adjust(a, (a + g) % this.m, b, from + (to - from) * g / gap, 0)
        }
    }

    solve() {
        for (let j = 0; j < this.m; j++) this.place(j, 0)
        if (this.m < 3) return
        for (let step = COARSEST_STEP; step >= 1; step >>= 1) {
            const nodes = this.nodes(step)
            if (nodes.length < 3) continue
            for (let p = Math.round(PASSES * Math.sqrt(step)); p > 0; p--) this.smooth(nodes)
            if (step > 1) this.interpolate(nodes)
        }
    }

    /** How sharply the line turns at point `j`, over two points either side so the 2 m sampling doesn't show as jitter. */
    bendAt(j: number) {
        const a = this.loop ? (j - 2 + this.m) % this.m : Math.max(0, j - 2)
        const c = this.loop ? (j + 2) % this.m : Math.min(this.m - 1, j + 2)
        return a === j || c === j ? 0 : Math.abs(this.curvatureAt(a, j, c))
    }

    /** The centreline's bends: runs of points turning the same way, as [first, last]. */
    bends() {
        const out: [number, number][] = []
        let j = 0
        while (j < this.m) {
            const side = Math.sign(this.turn[j]!)
            if (Math.abs(this.turn[j]!) < STRAIGHT) {
                j++
                continue
            }
            const first = j
            while (j < this.m && Math.abs(this.turn[j]!) >= STRAIGHT && Math.sign(this.turn[j]!) === side) j++
            out.push([first, j - 1])
        }
        return out
    }

    /** Shuts the inside wherever the line bends tighter than the road and solves again: smoothing hugs a long bend's inside. */
    keepOffInsides() {
        let shut = false
        for (const [first, last] of this.bends()) {
            let road = 0
            let line = 0
            for (let j = first; j <= last; j++) {
                road = Math.max(road, Math.abs(this.turn[j]!))
                line = Math.max(line, this.bendAt(j))
            }
            if (line < road) continue
            shut = true
            for (let j = first; j <= last; j++) {
                if (this.turn[j]! > 0) this.hi[j] = 0
                else this.lo[j] = 0
            }
        }
        if (shut) this.solve()
    }
}

/** The racing line along `line`: each stretch between rails on its own, on the centreline where it meets them. */
export function racingLine(line: RoadPlan): RacingLine {
    const n = line.n
    const offsets = new Float64Array(n)
    const curvature = new Float64Array(n)
    const stretches: Stretch[] = []
    const railed = Array.from(line.railed, r => r === 1)
    if (line.closed && !railed.includes(true)) stretches.push(new Stretch(line, 0, n, true))
    else {
        // On a loop with rails, start just past one so no stretch wraps round its end.
        const first = line.closed ? railed.findIndex((r, i) => r && !railed[(i + 1) % n]) + 1 : 0
        let j = 0
        while (j < n) {
            while (j < n && railed[(first + j) % n]) j++
            const start = j
            while (j < n && !railed[(first + j) % n]) j++
            if (j > start) stretches.push(new Stretch(line, (first + start) % n, j - start, false))
        }
    }
    for (const s of stretches) {
        s.solve()
        s.keepOffInsides()
        for (let j = 0; j < s.m; j++) {
            const i = (s.from + j) % n
            offsets[i] = s.lat[j]!
            curvature[i] = s.bendAt(j)
        }
    }
    return { offsets, curvature }
}
