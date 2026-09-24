// Holdfast run metadata shared by the client sim and the run-tracking server.
// Pure and dependency-free: the server uses it to judge what a client reports.

export const HOLDFAST_DIFFICULTIES = ['easy', 'normal', 'hard'] as const
export type HoldfastDifficulty = typeof HOLDFAST_DIFFICULTIES[number]

export function holdfastIsDifficulty(v: unknown): v is HoldfastDifficulty {
    return typeof v === 'string' && (HOLDFAST_DIFFICULTIES as readonly string[]).includes(v)
}

/** Surviving this long wins the run. */
export const HOLDFAST_WIN_MS = 25 * 60 * 1000

/** Fastest the client may run the sim. There is no pause. */
export const HOLDFAST_MAX_SPEED = 2

/** Real-time allowance on top of the speed cap: request latency and clock skew. */
export const HOLDFAST_SURVIVAL_SLACK_MS = 5000

/** Ceiling on any single reported stat. */
export const HOLDFAST_STAT_MAX = 100_000

export interface HoldfastRunStats {
    kills: number
    packsDeployed: number
    buildingsBuilt: number
    wave: number
}

/** Longest survival a run could have reached after `realElapsedMs` of wall-clock time. */
export function holdfastMaxPlausibleSurvival(realElapsedMs: number): number {
    const elapsed = Number.isFinite(realElapsedMs) ? Math.max(0, realElapsedMs) : 0
    return Math.min(HOLDFAST_WIN_MS, Math.floor(elapsed * HOLDFAST_MAX_SPEED + HOLDFAST_SURVIVAL_SLACK_MS))
}

export function holdfastPlausibleSurvival(survivedMs: number, realElapsedMs: number): boolean {
    if (!Number.isFinite(survivedMs) || !Number.isFinite(realElapsedMs)) return false
    if (survivedMs < 0 || survivedMs > HOLDFAST_WIN_MS) return false
    return survivedMs <= realElapsedMs * HOLDFAST_MAX_SPEED + HOLDFAST_SURVIVAL_SLACK_MS
}

function sanitizeStat(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
    return Math.min(HOLDFAST_STAT_MAX, Math.floor(value))
}

export function holdfastSanitizeStats(input: unknown): HoldfastRunStats {
    const raw = (input !== null && typeof input === 'object' ? input : {}) as Record<string, unknown>
    return {
        kills: sanitizeStat(raw.kills),
        packsDeployed: sanitizeStat(raw.packsDeployed),
        buildingsBuilt: sanitizeStat(raw.buildingsBuilt),
        wave: sanitizeStat(raw.wave)
    }
}
