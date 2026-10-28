// First-match coaching (pure, tested): short contextual hints that teach the
// loop the first time it matters ("Hold F to rebuild", "Buy a weapon off the
// wall", "Open doors with points", "Find the power"), one at a time with a
// breather in between, each shown once per browser. Situational hints (a
// teammate is down) repeat whenever they apply. Also the ammo line under the
// crosshair (reload / low / empty).

export type DfHintId = 'rebuild' | 'knife' | 'wallbuy' | 'doors' | 'power' | 'perks' | 'revive' | 'salvage' | 'bench' | 'deploy' | 'callin'

export interface DfHint {
    id: DfHintId
    /** "Hold F at a broken window to rebuild it": the HUD turns a leading "Hold/Press X" into a keycap. */
    text: string
    sub: string
    /** Bumps for every hint shown (drives the HUD's enter animation). */
    key: number
}

/** What the engine knows this tick, in plain facts. */
export interface DfHintFacts {
    /** Seconds since the match started (the engine clock). */
    time: number
    /** Alive and standing (not downed, not dead). */
    alive: boolean
    round: number
    phase: 'intermission' | 'active'
    points: number
    /** A barricade within a few metres is missing boards. */
    brokenWindowNear: boolean
    /** A zombie is within knife reach. */
    zombieClose: boolean
    /** A wall-buy you don't own and can afford is close by. */
    wallbuyNear: boolean
    /** Cheapest door still closed (Infinity when none). */
    cheapestDoor: number
    doorsOpen: number
    power: boolean
    /** A perk machine is close by while the power is off. */
    perkNear: boolean
    /** A downed teammate's name, or null. */
    downedMate: string | null
    /** You are already reviving someone. */
    reviving: boolean
    /** Your salvage (scrap + parts). */
    salvage?: number
    /** A workbench is close by, and your salvage pays for something on it. */
    benchNear?: boolean
    canCraft?: boolean
    /** The deployable gear in hand (Q), if any. */
    gear?: string | null
    /** The support ready to call in (X), if any. */
    reward?: string | null
}

/** Seconds a hint stays up (unless the player does the thing first). */
export const DF_HINT_SECONDS = 5.5
/** Quiet seconds between two hints. */
export const DF_HINT_GAP = 2.5
/** No coaching in the first seconds (the round banner owns the screen). */
export const DF_HINT_START = 5

interface HintRule {
    id: DfHintId
    once: boolean
    when(f: DfHintFacts, seen: ReadonlySet<DfHintId>): boolean
    text(f: DfHintFacts): string
    sub(f: DfHintFacts): string
}

/** In priority order: the first rule that applies is shown. */
const RULES: HintRule[] = [
    {
        id: 'revive',
        once: false,
        when: f => f.alive && f.downedMate !== null && !f.reviving,
        text: f => `Hold F next to ${f.downedMate} to revive`,
        sub: () => 'Reach them before they bleed out'
    },
    {
        id: 'rebuild',
        once: true,
        when: f => f.alive && f.brokenWindowNear,
        text: () => 'Hold F at a broken window to rebuild it',
        sub: () => 'Every board pays 10 points'
    },
    {
        id: 'knife',
        once: true,
        when: f => f.alive && f.zombieClose && f.round <= 3,
        text: () => 'Press V to knife',
        sub: () => 'Saves ammo and pays more on the early rounds'
    },
    {
        id: 'wallbuy',
        once: true,
        when: f => f.alive && (f.wallbuyNear || (f.round >= 2 && f.points >= 1000 && f.time > 90)),
        text: () => 'Buy a weapon off the wall',
        sub: () => 'Chalk outlines are guns for sale: hold F at one'
    },
    {
        id: 'doors',
        once: true,
        when: f => f.alive && f.doorsOpen === 0 && Number.isFinite(f.cheapestDoor) && f.points >= f.cheapestDoor && (f.round >= 2 || f.phase === 'intermission'),
        text: () => 'Open doors with points',
        sub: () => 'Rubble and gates show their price: hold F to clear them'
    },
    {
        id: 'power',
        once: true,
        when: (f, seen) => f.alive && !f.power && (f.doorsOpen >= 1 || f.round >= 4) && (seen.has('doors') || f.doorsOpen >= 1),
        text: () => 'Find the power',
        sub: () => 'It runs the perk machines and the Pack-a-Punch: follow your orders, top left'
    },
    {
        id: 'perks',
        once: true,
        when: f => f.alive && !f.power && f.perkNear,
        text: () => 'Perk machines need the power',
        sub: () => 'Turn it on, then come back with points'
    },
    {
        id: 'callin',
        once: true,
        when: f => f.alive && !!f.reward,
        text: f => `Hold X to call in the ${f.reward}`,
        sub: () => 'Mark the spot you look at, release to call it in'
    },
    {
        id: 'deploy',
        once: true,
        when: f => f.alive && !!f.gear,
        text: () => 'Hold Q to place your gear',
        sub: () => 'Aim at the floor and let go'
    },
    {
        id: 'bench',
        once: true,
        when: f => f.alive && f.benchNear === true && f.canCraft === true,
        text: () => 'Hold F at the workbench to craft',
        sub: () => 'Scroll or use ↑/↓ to pick, hold F to make it'
    },
    {
        id: 'salvage',
        once: true,
        when: f => f.alive && (f.salvage ?? 0) > 0,
        text: () => 'Salvage builds gear at a workbench',
        sub: () => 'Your kills drop scrap and rare parts only you can pick up'
    }
]

export class DfHintTracker {
    readonly seen: Set<DfHintId>
    current: DfHint | null = null
    private shownAt = -100
    private quietUntil = 0
    private key = 0
    /** A situational hint isn't repeated for the same subject until it changes. */
    private lastSituation = ''
    /** Called when a once-only hint is first shown (persist it). */
    onSeen: ((id: DfHintId) => void) | null = null

    constructor(seen: Iterable<string> = []) {
        this.seen = new Set([...seen].filter((x): x is DfHintId => RULES.some(r => r.id === x)))
    }

    /** The player did what a hint asks: take it down now. */
    done(id: DfHintId): void {
        if (this.current?.id === id) this.hide(this.shownAt + DF_HINT_SECONDS)
        if (RULES.find(r => r.id === id)?.once && !this.seen.has(id)) this.markSeen(id)
    }

    /** Runs the coaching for this tick; returns the hint to show (or null). */
    update(f: DfHintFacts): DfHint | null {
        const t = f.time
        const cur = this.current
        if (cur) {
            const rule = RULES.find(r => r.id === cur.id)!
            // situational hints last as long as they apply; coaching for its time
            const over = rule.once ? t - this.shownAt >= DF_HINT_SECONDS : !rule.when(f, this.seen)
            if (over || !f.alive) this.hide(t)
            else return cur
        }
        if (t < DF_HINT_START || t < this.quietUntil) return null
        for (const r of RULES) {
            if (r.once && this.seen.has(r.id)) continue
            if (!r.when(f, this.seen)) continue
            if (!r.once) {
                const subject = `${r.id}:${r.text(f)}`
                if (subject === this.lastSituation) continue
                this.lastSituation = subject
            }
            this.current = { id: r.id, text: r.text(f), sub: r.sub(f), key: ++this.key }
            this.shownAt = t
            if (r.once) this.markSeen(r.id)
            return this.current
        }
        // the situation passed: the same one may come back later
        if (!RULES.some(r => !r.once && r.when(f, this.seen))) this.lastSituation = ''
        return null
    }

    private hide(t: number): void {
        this.current = null
        this.quietUntil = t + DF_HINT_GAP
    }

    private markSeen(id: DfHintId): void {
        this.seen.add(id)
        this.onSeen?.(id)
    }
}

/** The line under the crosshair about the magazine, or null when there's nothing to say. */
export function dfAmmoHint(mag: number, magSize: number, reserve: number, reloading: boolean): string | null {
    if (magSize <= 0 || reloading) return null
    if (mag <= 0 && reserve <= 0) return 'No ammo'
    if (mag <= Math.max(1, Math.floor(magSize * 0.25)) && reserve > 0) return 'Press R to reload'
    if (mag + reserve <= magSize) return 'Low ammo'
    return null
}

const STORE = 'df-hints-v1'

/** Hints this browser has already seen (empty when storage is unavailable). */
export function dfLoadHintsSeen(): string[] {
    try {
        const raw = localStorage.getItem(STORE)
        const v = raw ? JSON.parse(raw) as unknown : []
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    } catch {
        return []
    }
}

export function dfSaveHintsSeen(seen: Iterable<string>): void {
    try {
        localStorage.setItem(STORE, JSON.stringify([...seen]))
    } catch {
        // private mode or blocked storage: the hints just come back next time
    }
}
