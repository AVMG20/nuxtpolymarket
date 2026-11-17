import { CARS } from '#shared/utils/nitro-rush/cars'
import { PAINTS } from '#shared/utils/nitro-rush/paints'
import { newTrackFrame, Track } from '#shared/utils/nitro-rush/track'
import { TRACKS } from '#shared/utils/nitro-rush/tracks'
import { randomChance, randomFloat, randomInt, randomPick } from '#shared/utils/random'
import { nrFakeLapS, nrFakePoseAt, nrFakeSpeedAt } from '#server/utils/nitro-rush-fake-drive'
import { NR_LIVE_FAKE_ROOM_MAX, useNrLiveHub, type NrLiveFake, type NrLiveHub } from '#server/utils/nitro-rush-live'

// Dev only: fake drivers on the built-in courses, so the racing-now counts and live ghosts
// show without a second player. Only `server/api/nitro-rush/dev/fake-players.post.ts` starts them.

export const NR_FAKE_DEFAULT = 12
export const NR_FAKE_MAX = 40
/** About as often as a real client sends a pose. */
const STEP_MS = 100
const CHURN_MIN_MS = 20_000
const CHURN_MAX_MS = 40_000
const ACCEL = 18
const BRAKE = 40
const NAMES = [
    'Bot Turbo', 'Bot Drift', 'Bot Nitro', 'Bot Sprocket', 'Bot Vroom', 'Bot Skid', 'Bot Piston', 'Bot Apex',
    'Bot Burnout', 'Bot Chicane', 'Bot Throttle', 'Bot Slipstream', 'Bot Donut', 'Bot Clutch', 'Bot Zoomer', 'Bot Gearbox'
]

interface FakeDriver extends NrLiveFake {
    track: string
    line: Track
    d: number
    speed: number
    top: number
    /** Metres off the racing line it keeps, so two fakes don't drive on top of each other. */
    bias: number
    bornAt: number
}

const lines = new Map<string, Track>()

function lineOf(id: string): Track {
    let line = lines.get(id)
    if (!line) lines.set(id, line = new Track(TRACKS.find(t => t.id === id)!))
    return line
}

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places

export class NrFakeCrew {
    private drivers = new Map<string, FakeDriver>()
    private courses: string[] = []
    private target = 0
    private serial = 0
    private lastStep = 0
    private nextChurn = 0
    private timer: ReturnType<typeof setInterval> | null = null
    private readonly frame = newTrackFrame()

    /** `ticking` off leaves the stepping to the caller (tests). */
    constructor(private readonly hub: NrLiveHub, private readonly ticking = true) {}

    get size(): number {
        return this.drivers.size
    }

    /** Fakes on each course. */
    get counts(): Record<string, number> {
        const counts: Record<string, number> = {}
        for (const f of this.drivers.values()) counts[f.track] = (counts[f.track] ?? 0) + 1
        return counts
    }

    /** Replaces the crew with `count` fakes over 3 to 5 random courses; 0 just stops it. Returns how many started. */
    start(count: number, now = Date.now()): number {
        this.stop()
        const n = Math.min(NR_FAKE_MAX, Math.max(0, Math.floor(count)))
        if (!n) return 0
        const ids = TRACKS.map(t => t.id)
        for (let i = ids.length - 1; i > 0; i--) {
            const j = randomInt(0, i)
            const swap = ids[i]!
            ids[i] = ids[j]!
            ids[j] = swap
        }
        const want = Math.min(ids.length, n, Math.max(randomInt(3, 5), Math.ceil(n / NR_LIVE_FAKE_ROOM_MAX)))
        this.courses = ids.slice(0, want)
        const per = new Map(this.courses.map(id => [id, 1]))
        for (let left = n - want; left > 0; left--) {
            const open = this.courses.filter(id => per.get(id)! < NR_LIVE_FAKE_ROOM_MAX)
            if (!open.length) break
            const id = randomPick(open)
            per.set(id, per.get(id)! + 1)
        }
        for (const [id, k] of per) for (let i = 0; i < k; i++) this.spawn(id, now)
        this.target = this.drivers.size
        this.lastStep = now
        this.nextChurn = now + randomInt(CHURN_MIN_MS, CHURN_MAX_MS)
        this.step(now)
        if (this.ticking && this.drivers.size) {
            const timer = this.timer = setInterval(() => this.step(Date.now()), STEP_MS)
            const held = timer as { unref?: () => void }
            held.unref?.()
        }
        return this.drivers.size
    }

    /** Takes every fake off its course; the hub tells the players there, and the counts drop on its next tick. */
    stop(): void {
        if (this.timer) clearInterval(this.timer)
        this.timer = null
        for (const id of this.drivers.keys()) this.hub.fakeGone(id)
        this.drivers.clear()
        this.courses = []
        this.target = 0
    }

    /** Moves every fake on by the time since the last step and sends its pose. */
    step(now: number): void {
        const dt = Math.min(0.5, Math.max(0, now - this.lastStep) / 1000)
        this.lastStep = now
        if (now >= this.nextChurn) {
            this.nextChurn = now + randomInt(CHURN_MIN_MS, CHURN_MAX_MS)
            this.churn(now)
        }
        for (const f of [...this.drivers.values()]) {
            const want = nrFakeSpeedAt(f.line, f.d, f.top)
            f.speed = f.speed < want ? Math.min(want, f.speed + ACCEL * dt) : Math.max(want, f.speed - BRAKE * dt)
            const s = f.d = nrFakeLapS(f.line, f.d + f.speed * dt)
            const reach = Math.max(0, f.line.halfWidthAt(s) - 2)
            const lateral = Math.max(-reach, Math.min(reach, f.line.racingOffsetAt(s) + f.bias))
            const p = nrFakePoseAt(f.line, f.d, lateral, this.frame)
            const pose = {
                x: round(p.x, 2), y: round(p.y, 2), z: round(p.z, 2),
                qx: round(p.qx, 4), qy: round(p.qy, 4), qz: round(p.qz, 4), qw: round(p.qw, 4)
            }
            // A course real players filled up since: this fake gives its slot back.
            if (!this.hub.fakePose(f, f.track, now - f.bornAt, pose, now)) this.drivers.delete(f.id)
        }
    }

    /** One fake leaves or a new one joins, keeping the crew within a few of the size asked for. */
    private churn(now: number): void {
        const size = this.drivers.size
        const leave = size > Math.max(1, this.target - 3) && (size >= this.target + 3 || randomChance(0.5))
        if (leave) {
            const f = randomPick([...this.drivers.values()])
            this.drivers.delete(f.id)
            this.hub.fakeGone(f.id)
            return
        }
        // Now and then a course nobody was on, so the busiest list moves too.
        const pool = randomChance(0.25) ? TRACKS.map(t => t.id) : this.courses
        const open = pool.filter(id => this.hub.fakeFits(id))
        if (!open.length) return
        const id = randomPick(open)
        if (!this.courses.includes(id)) this.courses.push(id)
        this.spawn(id, now)
    }

    private spawn(track: string, now: number): void {
        const line = lineOf(track)
        const n = this.serial++
        const taken = new Set([...this.drivers.values()].map(f => f.name))
        const free = NAMES.filter(name => !taken.has(name))
        const name = free.length ? randomPick(free) : `${randomPick(NAMES)} ${n}`
        const top = 52 + randomFloat() * 22
        const d = nrFakeLapS(line, randomFloat() * line.length)
        const f: FakeDriver = {
            id: `fake-${n}`,
            name,
            paint: randomPick(PAINTS).id,
            car: randomPick(CARS).id,
            track,
            line,
            d,
            speed: nrFakeSpeedAt(line, d, top),
            top,
            bias: (randomFloat() - 0.5) * 3,
            bornAt: now
        }
        this.drivers.set(f.id, f)
    }
}

let crew: NrFakeCrew | null = null

/** The process's one crew, on the live hub; refuses outside dev so nothing else can wake it. */
export function useNrFakeCrew(): NrFakeCrew {
    if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    return crew ??= new NrFakeCrew(useNrLiveHub())
}
