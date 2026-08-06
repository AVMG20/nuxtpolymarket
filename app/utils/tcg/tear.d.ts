// Hand-written types for the vendored tear.js (byte-identical to upstream).
export type TearPoint = [number, number]

export interface TearSplit {
    a: TearPoint[]
    b: TearPoint[]
    cut: TearPoint[]
}

export declare function roughen(
    path: TearPoint[],
    step: number,
    amount: number,
    rand?: () => number
): TearPoint[]

export declare function splitRect(path: TearPoint[], w: number, h: number): TearSplit | null

export declare function area(poly: TearPoint[]): number
