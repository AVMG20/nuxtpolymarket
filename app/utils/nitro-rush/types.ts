/** What the engine and the game's UI exchange: phases, controls, the HUD, popups and records. */

/** `finished` is the pause after an open course's finish line, before the run restarts on its own. */
export type Phase = 'attract' | 'countdown' | 'racing' | 'finished'

export type Control = 'throttle' | 'brake' | 'left' | 'right' | 'handbrake'

export interface HudState {
    /** 1-based lap of this session, or run on an open course. */
    lap: number
    /** False on an open course, where each run is one lap. */
    closed: boolean
    lapTime: number
    lastLap: number | null
    /** Quickest lap of this session. */
    sessionBest: number | null
    /** The personal best on this track. */
    bestLap: number | null
    speedKmh: number
    /** The meter while charging, the time left while burning. */
    nitro: number
    nitroActive: boolean
    drifting: boolean
    wrongWay: boolean
}

/** The best lap on a track and its sector splits (lap time last), for live deltas. */
export interface TrackRecord {
    bestLap: number | null
    bestSplits: number[] | null
}

export const EMPTY_RECORD: Readonly<TrackRecord> = { bestLap: null, bestSplits: null }

export type PopupTone = 'good' | 'bad' | 'best' | 'drift' | 'nitro' | 'count' | 'lap' | 'danger'

export interface Popup {
    text: string
    sub?: string
    tone: PopupTone
    big?: boolean
}

export interface EngineEvents {
    hud: (h: HudState) => void
    popup: (p: Popup) => void
    phase: (p: Phase) => void
    /** A new personal best lap; the component persists it and sends it to the leaderboard. */
    record: (trackId: string, r: TrackRecord) => void
}
