// Types for the vendored grading-model.ts (LOCKED 2026-08-03,
// kept byte-identical to the repo-root reference). Only the surface this
// slice uses — rollCondition — is typed precisely; the grading entry points
// are declared loosely so they can be imported later without edits here.

export interface TcgConditionSite {
    id: string
    category: number
    value: number
}

export interface TcgConditionSurface extends TcgConditionSite {
    x: number
    y: number
    angle: number
    type: string
}

export interface TcgCondition {
    sites: TcgConditionSite[]
    surface: TcgConditionSurface[]
    subs: number[]
}

export interface TcgConditionParams {
    floor: number
    centering: { shape: number, scale: number }
    site: { untouched: number, shape: number, scale: number }
    surface: { defectRate: number, shape: number, scale: number }
}
