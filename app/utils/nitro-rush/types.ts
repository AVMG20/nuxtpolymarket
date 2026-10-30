/** What the engine and the game's UI exchange: phases, controls, the HUD, popups and records. */

import type { CustomTrack } from '#shared/utils/nitro-rush/custom'
import type { TrackDef } from '#shared/utils/nitro-rush/track'
import type { StoredGhost } from './ghost'

/** `finished` is the pause after an open course's finish line, before the run restarts on its own. */
export type Phase = 'attract' | 'countdown' | 'racing' | 'finished'

export type Control = 'throttle' | 'brake' | 'left' | 'right' | 'drift'

export interface HudState {
    /** 1-based lap of this session, or run on an open course. */
    lap: number
    /** False on an open course, where each run is one lap. */
    closed: boolean
    lapTime: number
    /** This session's last few laps, newest first. */
    recentLaps: readonly LapEntry[]
    /** The personal best on this track. */
    bestLap: number | null
    speedKmh: number
    /** The meter while charging, the time left while burning. */
    nitro: number
    nitroActive: boolean
    drifting: boolean
    wrongWay: boolean
    /** The car on the plan, for the minimap; heading as `headingOf` gives it. */
    car: { x: number, z: number, heading: number }
    /** Every ghost drawn this frame, on the plan. */
    ghosts: readonly MapGhost[]
}

export interface LapEntry {
    /** The lap's number, or the run's on an open course. */
    lap: number
    time: number
}

export interface MapGhost {
    x: number
    z: number
    /** Body colour, as a hex number. */
    color: number
}

/** The best lap on a track and its sector splits (lap time last), for live deltas. */
export interface TrackRecord {
    bestLap: number | null
    bestSplits: number[] | null
    /** The ghost to race, kept in this browser only: the fastest lap driven here (on a loop, flying); records from before ghosts have none. */
    ghost?: StoredGhost
    /** The ghost is a loop's standing first lap, kept only until a flying lap is driven. */
    ghostStanding?: true
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
    /** A new personal best lap or ghost; the component persists it and sends a new best to the leaderboard. */
    record: (trackId: string, r: TrackRecord) => void
}

/** Where a car sits in the world: its model's position and orientation. Full 3D, so it holds through loopings and corkscrews. */
export interface CarPose {
    x: number
    y: number
    z: number
    qx: number
    qy: number
    qz: number
    qw: number
}

/** A ghost car to draw this frame: the player's best lap, or another player live on the same course. */
export interface GhostFrame {
    /** Stable per ghost, so its model is reused frame to frame. */
    id: string
    pose: CarPose
    /** A name tag over the car; left out for the player's own ghost. */
    label?: string
    /** Body colour, as a hex number. */
    color?: number
}

/**
 * Supplies ghosts each rendered frame. `now` is `performance.now()`; `lapTime` is
 * the running lap clock in seconds, or null while no lap is being timed.
 */
export type GhostSource = (now: number, lapTime: number | null) => GhostFrame[]

/** A player's own course on the track menu, with its drivable form once it's finished. */
export interface CustomTrackEntry {
    track: CustomTrack
    def: TrackDef | null
}
