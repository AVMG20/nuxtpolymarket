/** How much a course is raced, which the menu's POPULAR sort ranks by. */

/** Racers count towards a course's popularity for this long after their last lap. */
export const PLAY_WINDOW_DAYS = 30

/** Players with a lap in the window, and every lap ever. */
export interface TrackPlays {
    racers: number
    laps: number
}

export const NO_PLAYS: TrackPlays = { racers: 0, laps: 0 }

/** Players racing it lately first, so one player grinding laps can't carry a course; all-time laps break ties. */
export const byPlays = (a: TrackPlays, b: TrackPlays) => b.racers - a.racers || b.laps - a.laps
