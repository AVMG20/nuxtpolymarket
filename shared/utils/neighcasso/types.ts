/**
 * Neighcasso Derby: players doodle a horse, stake any amount, and the whole pot
 * goes to the one horse the server picks. The race the clients play back is a
 * scripted show the server writes after the winner is already decided.
 */

/** Drawing space every stroke lives in. Horses face right. */
export const NC_CANVAS_W = 600
export const NC_CANVAS_H = 400

export const NC_LANES = 6
export const NC_MAX_HORSES_PER_USER = 60
export const NC_NAME_MAX = 32
/**
 * The house's cut of the pot whenever a bot runs. Without it a bot race is a
 * fair coin, which would beat every other game on the site; with it every
 * human bet returns 99%, however many bots race.
 */
export const NC_BOT_FEE = 0.01

/** What a stroke animates as on the track. */
export type NcStrokeKind = 'body' | 'leg' | 'tail' | 'head'

export interface NcStroke {
    k: NcStrokeKind
    /** `#rrggbb` */
    c: string
    /** Line width in drawing units. */
    w: number
    /** Flat integer points `[x0, y0, x1, y1, …]` inside the canvas. One point is a dot. */
    p: number[]
}

export interface NcDrawing {
    v: 1
    strokes: NcStroke[]
}

/** A saved horse as the owner's stable lists it. */
export interface NcHorse {
    id: string
    name: string
    drawing: NcDrawing
    wins: number
    races: number
    /** Epoch ms of the last edit. Doubles as a cache key for the drawing. */
    rev: number
}

/** A horse opened from someone else's share link. */
export interface NcSharedHorse extends NcHorse {
    ownerName: string
    mine: boolean
}

/** Per-seat state that reaches every client. */
export interface NcSeatState {
    horseId: string | null
    horseName: string
    horseRev: number
    /** Career record of the horse in this gate, for its win rate. */
    horseWins: number
    horseRaces: number
    /**
     * The most this seat will race for. Taken only when the gates close, and
     * only up to the smallest bet in the gates.
     */
    bet: number
    /** Staked and running this round. */
    racing: boolean
}

/**
 * A goofy moment in the scripted race. The speed change is already baked into
 * the keyframes; this only tells the client what to draw over it.
 */
export type NcRaceEventKind = 'stumble' | 'zoomies' | 'nap' | 'moonwalk' | 'spin'

export interface NcRaceEvent {
    seat: number
    kind: NcRaceEventKind
    /** Seconds from the start of the race. */
    at: number
    duration: number
}

export interface NcRaceLane {
    seat: number
    /**
     * Progress along the track at every `step` seconds, from 0 at the gate to 1
     * at the post. Only the winner ever reaches 1, and it does so on the last
     * frame, so any interpolation that stays within neighbouring frames keeps
     * the finish honest.
     */
    frames: number[]
}

export interface NcRaceScript {
    /** Epoch ms (server clock) the gates open. */
    startsAt: number
    /** Seconds from the gates opening to the winner crossing the line. */
    duration: number
    /** Seconds between keyframes. */
    step: number
    lanes: NcRaceLane[]
    events: NcRaceEvent[]
    winnerSeat: number
}

/** A house horse filling an empty gate. It always bets the matched stake. */
export interface NcBot {
    seat: number
    name: string
    /** Picks the bot's doodle; see `botDrawing`. */
    seed: number
    bet: number
}

export interface NcResult {
    roundId: number
    winnerSeat: number
    winnerName: string
    horseName: string
    horseId: string | null
    /** A bot won, so the pot stays with the house. */
    botWon: boolean
    pot: number
    /** What the winner was paid: the pot, less the fee when bots ran. */
    payout: number
    /** The winner's share of the pot, as a chance, when the race started. */
    odds: number
}

export interface NcSharedState {
    /**
     * What every horse races for: the smallest bet in the gates. A bigger bet is
     * only taken up to this, so every horse has the same odds.
     */
    matched: number
    /** The matched stake times every horse in the gates (or racing). */
    pot: number
    race: NcRaceScript | null
    result: NcResult | null
    history: NcResult[]
    /** Horses needed before the race can run, bots included. */
    minHorses: number
    /** Bots in the gates right now (or running, once the race is on). */
    bots: NcBot[]
    /** How many bots the lobby asked for. */
    botsWanted: number
    /** Fraction of the pot the house keeps when bots run. */
    fee: number
}

export type NcAction =
    | { type: 'horse', horseId: string }
    | { type: 'bet', amount: number }
    | { type: 'unready' }
    | { type: 'bots', count: number }
    /** Put a bot in (or take one out of) a specific empty gate. */
    | { type: 'bot', seat: number, on: boolean }

/** One-shot events broadcast as `{ t: 'event', kind: 'game', payload }`. */
export type NcGameEvent =
    | { type: 'gates', race: NcRaceScript }
    | { type: 'result', result: NcResult }
    | { type: 'scratched', name: string, reason: string }
