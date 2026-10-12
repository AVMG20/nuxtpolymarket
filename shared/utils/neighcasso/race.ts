import { randomFloat } from '#shared/utils/random'
import type { NcRaceEvent, NcRaceEventKind, NcRaceLane } from '#shared/utils/neighcasso/types'

export const NC_RACE_DURATION = 22
export const NC_RACE_STEP = 0.25

interface EventShape {
    duration: number
    /** Speed multiplier while the event runs. Negative runs backwards. */
    speed: number
}

const EVENTS: Record<NcRaceEventKind, EventShape> = {
    stumble: { duration: 1, speed: -0.25 },
    zoomies: { duration: 1.75, speed: 2.5 },
    nap: { duration: 1.5, speed: 0 },
    moonwalk: { duration: 1.25, speed: -0.8 },
    spin: { duration: 1, speed: 0.2 }
}
const EVENT_KINDS = Object.keys(EVENTS) as NcRaceEventKind[]

/** How late in the race the winner can still be clowning around, in seconds. */
const WINNER_CLEAN_FINISH = 2.5
const MIN_LEAD_CHANGES = 3
const ATTEMPTS = 40

export interface NcRacePlan {
    lanes: NcRaceLane[]
    events: NcRaceEvent[]
}

/**
 * Write the show for a race whose winner is already decided. Every other horse
 * is scaled to stop short of the post, so nobody but `winnerSeat` can cross it,
 * and plans with too few lead changes are thrown away so the crowd gets its
 * back-and-forth. Pure presentation: the outcome was settled before this ran.
 */
export function planRace(seats: number[], winnerSeat: number, rng: () => number = randomFloat): NcRacePlan {
    if (!seats.includes(winnerSeat)) throw new Error('Winner is not in the race')
    let best: NcRacePlan | null = null
    let bestChanges = -1
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const plan = draft(seats, winnerSeat, rng)
        const changes = leadChanges(plan.lanes)
        if (changes > bestChanges) {
            best = plan
            bestChanges = changes
        }
        if (changes >= MIN_LEAD_CHANGES) break
    }
    return best!
}

function draft(seats: number[], winnerSeat: number, rng: () => number): NcRacePlan {
    const frames = Math.round(NC_RACE_DURATION / NC_RACE_STEP)
    const events: NcRaceEvent[] = []
    const others = seats.filter(s => s !== winnerSeat)
    const decoy = others.length ? others[Math.floor(rng() * others.length)]! : null
    const photoFinisher = others.length ? others[Math.floor(rng() * others.length)]! : null

    const lanes = seats.map((seat) => {
        const isWinner = seat === winnerSeat
        const laneEvents = pickEvents(seat, isWinner, seat === decoy, rng)
        events.push(...laneEvents)

        const base = 0.85 + rng() * 0.3
        let mood = 1
        const distance = [0]
        for (let i = 0; i < frames; i++) {
            const t = i * NC_RACE_STEP
            // A mean-reverting wander, so each horse has spells of form rather
            // than white noise that averages out to a dead heat.
            mood = mood * 0.9 + 0.1 + (rng() - 0.5) * 0.3
            mood = Math.min(1.5, Math.max(0.5, mood))
            let speed = base * mood
            if (t < 1.5) speed *= 0.35 + (t / 1.5) * 0.65
            if (isWinner && t > NC_RACE_DURATION - WINNER_CLEAN_FINISH) speed = Math.max(speed, base * 0.9)
            const active = laneEvents.find(e => t >= e.at && t < e.at + e.duration)
            if (active) speed = EVENTS[active.kind].speed * (active.kind === 'zoomies' ? base : 1)
            distance.push(Math.max(0, distance[i]! + speed * NC_RACE_STEP))
        }

        const last = distance[frames]!
        const peak = Math.max(...distance)
        let scaled: number[]
        if (isWinner) {
            scaled = distance.map((d, i) => (i === frames ? 1 : Math.min(0.995, d / last)))
        } else {
            const target = seat === photoFinisher ? 0.955 + rng() * 0.035 : 0.8 + rng() * 0.17
            scaled = distance.map(d => (peak > 0 ? (d / peak) * target : 0))
        }
        return { seat, frames: scaled.map(v => Math.round(v * 10_000) / 10_000) }
    })

    return { lanes, events: events.sort((a, b) => a.at - b.at) }
}

function pickEvents(seat: number, isWinner: boolean, isDecoy: boolean, rng: () => number): NcRaceEvent[] {
    const picked: NcRaceEvent[] = []
    const latest = NC_RACE_DURATION - (isWinner ? WINNER_CLEAN_FINISH + 2 : 1.5)
    const add = (kind: NcRaceEventKind, at: number) => {
        const shape = EVENTS[kind]
        if (at < 2 || at + shape.duration > latest + (isWinner ? 0 : 1)) return
        if (picked.some(e => at < e.at + e.duration + 0.5 && e.at < at + shape.duration + 0.5)) return
        picked.push({ seat, kind, at: round2(at), duration: shape.duration })
    }

    if (isDecoy) {
        // Surges to the front late, then falls apart in sight of the post.
        add('zoomies', NC_RACE_DURATION * (0.55 + rng() * 0.12))
        add(rng() < 0.5 ? 'nap' : 'stumble', NC_RACE_DURATION * (0.84 + rng() * 0.05))
    }
    const count = 1 + Math.floor(rng() * 2)
    for (let i = 0; i < count; i++) {
        add(EVENT_KINDS[Math.floor(rng() * EVENT_KINDS.length)]!, 2 + rng() * (latest - 2))
    }
    return picked
}

/** How many times the leader changes after the gates, ignoring photo-close swaps. */
export function leadChanges(lanes: NcRaceLane[]): number {
    if (lanes.length < 2) return 0
    const frames = lanes[0]!.frames.length
    let leader = -1
    let changes = 0
    for (let i = Math.round(2 / NC_RACE_STEP); i < frames; i++) {
        let best = lanes[0]!
        for (const lane of lanes) if (lane.frames[i]! > best.frames[i]!) best = lane
        const margin = Math.min(...lanes.filter(l => l !== best).map(l => best.frames[i]! - l.frames[i]!))
        if (best.seat !== leader && margin > 0.005) {
            if (leader !== -1) changes++
            leader = best.seat
        }
    }
    return changes
}

function round2(value: number) {
    return Math.round(value * 100) / 100
}
