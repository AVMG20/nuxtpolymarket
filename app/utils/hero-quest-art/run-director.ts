// The game's side of the battle stage: when bodies drop and what the numbers on them say.
//
// The stage only animates. Where the run is comes from the projected run (`useHqLiveRun`), and
// this turns it into a schedule the stage plays: the front body of the pack dies when
// `killsFloat` crosses its kill, never earlier and never by a hit count of the stage's own.
//
// The numbers are the real per-enemy HP, split over the hits the stage happens to land. Idle
// farming averages crit rather than rolling it (`combat.ts`), so a crit here is a presentation
// roll at the Hero's real crit chance, worth the real crit multiplier against a normal hit: the
// split keeps that ratio, and each body's numbers add up to exactly its HP.
//
// Pure: no DOM, no drawing. The stage asks, this answers.

import { D, ZERO, type Decimal } from '../../../shared/utils/hero-quest/numbers'

/** What the stage needs of the projected run, re-sent every frame. */
export interface RunFeed {
    prestige: number
    world: number
    stage: number
    archetype: 'wave' | 'elite' | 'boss' | 'super_boss'
    /** Kills into the current stage attempt, fractional. */
    killsFloat: number
    /** Kills that clear the stage; 0 at a boss gate. */
    killsRequired: number
    packSize: number
    atBossGate: boolean
    /**
     * Parked at the gate of a boss that beat the party, and shown farming the stage before it until
     * the player challenges the boss. The run's count stands still there, so the stage paces the
     * farm itself, at `secondsPerKill`.
     */
    farming: boolean
    walled: boolean
    /** Seconds the wiped party has left to recover (`WIPE_RECOVERY_SECONDS`); 0 when it is fighting. */
    recoverySeconds: number
    /** One body's HP, a Decimal string. */
    enemyHp: string
    /** `null` when the party cannot kill anything. */
    secondsPerKill: number | null
    critChance: number
    /** A Decimal string. */
    critMultiplier: string
    /** 0–100: the party's one HP pool, from `battleReadout`. */
    heroHpPct: number
    /** For the Hero's frame. */
    heroLevel: number
    /** The Global Power Number, a Decimal string, for the profile badge; null before the payload has one. */
    gpn: string | null
}

/** How the run moved since the last feed, which decides what the stage does about it. */
export type FeedChange =
    /** Same attempt: bodies drop on schedule. */
    | 'same'
    /** The stage cleared into the next one in the same world: the pack still up goes down, then the next arrives. */
    | 'advance'
    /** A walled attempt restarted: the party falls and comes back to a fresh pack. */
    | 'wipe'
    /** A new world, a prestige, a hidden tab coming back far ahead: rebuild rather than replay it. */
    | 'reset'

/** Hits the stage lands on one body before the director has measured any: a guess it corrects within a pack. */
const FIRST_HITS_PER_SECOND = 2
/** How fast the measured hit rate follows the stage (share per second). */
const RATE_FOLLOW = 0.3
/** A body is never brought below this share of its HP before its kill: the last blow has to have something to take. */
const LAST_BLOW_SHARE = 0.1

/**
 * A damage figure the way the stage prints it: 128, 1.24K, 8.6M, 3.1T, then 4.20E15. The
 * number fonts carry digits, K/M/B/T and E only, so the game's longer suffixes are not used.
 */
export function stageNumber(value: Decimal): string {
    if (value.lt(1)) return '1'
    if (value.lt(999.5)) return String(Math.round(value.toNumber()))
    // three significant figures, rounded before the tier is chosen so 999.9K reads 1.00M
    let exponent = value.log10().floor().toNumber()
    let mantissa = Number(value.div(D(10).pow(exponent)).toNumber().toPrecision(3))
    if (mantissa >= 10) {
        mantissa /= 10
        exponent++
    }
    if (exponent >= 15) return `${mantissa.toFixed(2)}E${exponent}`
    const tier = Math.floor(exponent / 3)
    const scaled = mantissa * 10 ** (exponent - tier * 3)
    return `${scaled.toFixed(2 - (exponent - tier * 3))}${'KMBT'[tier - 1]}`
}

export class RunDirector {
    feed: RunFeed | null = null
    /** Bodies the stage has dropped in this attempt. */
    shown = 0
    /** Bodies of a stage already cleared that are still to go down before the next pack. */
    carry = 0
    /** One carried body's HP, or null when they were a boss and its escort, whose fight already showed its numbers. */
    private carryHp: string | null = null
    /** The kill requirement of the stage the carried bodies belong to. */
    private carryRequired = 0
    /** Kills the stage has paced for itself while farming in front of a lost boss. */
    private farmed = 0
    /** Damage the numbers have shown on the front body so far. */
    private dealt: Decimal = ZERO
    /** What the last hit or blow showed, for a skill's total. */
    last: Decimal = ZERO
    private hitsPerSecond = FIRST_HITS_PER_SECOND
    private hitsThisSecond = 0
    private second = 0

    /** Take a new feed and say how the run moved. `standing` is how many of the pack are up. */
    sync(feed: RunFeed, standing: number): FeedChange {
        const was = this.feed
        if (feed.farming) {
            // the run stands at the gate; the farm before it runs on the stage's own clock, on from where it was
            if (!was?.farming) this.farmed = was && was.stage === feed.stage ? was.killsFloat : feed.killsFloat
            feed = { ...feed, killsFloat: this.farmed }
        }
        this.feed = feed
        const kills = Math.floor(feed.killsFloat)
        if (!was || was.world !== feed.world || was.prestige !== feed.prestige) return this.restart(kills, 'reset')
        if (was.stage !== feed.stage) {
            // one stage on is the run clearing it; anything further is a jump to rebuild from
            if (feed.stage !== was.stage + 1) return this.restart(kills, 'reset')
            // the last body of a stage drops as the counter rolls over, so it goes down under the new one
            this.carry = standing
            this.carryHp = was.atBossGate ? null : was.enemyHp
            this.carryRequired = was.killsRequired
            this.shown = 0
            return 'advance'
        }
        // a walled attempt restarts from zero; a payload settling a little behind the projection is not one
        const back = was.killsFloat - feed.killsFloat
        if (feed.walled && back > 0.5) return this.restart(kills, 'wipe')
        if (back > 1) return this.restart(kills, 'reset')
        // far ahead of the stage, as after a tab sat hidden: no point dropping a whole pack at once
        if (kills - this.shown > Math.max(1, feed.packSize)) return this.restart(kills, 'reset')
        return 'same'
    }

    private restart(kills: number, change: FeedChange): FeedChange {
        this.shown = kills
        this.carry = 0
        this.dealt = ZERO
        return change
    }

    /**
     * How far the stage on screen has got, which is not where the run is: the bodies the stage has
     * dropped, plus the share of the front one its hits have taken. While a cleared stage's last
     * bodies are still going down, it is still that stage.
     */
    visible(): { kills: number, required: number } {
        const f = this.feed
        if (!f) return { kills: 0, required: 0 }
        if (this.carry > 0) return { kills: Math.max(0, this.carryRequired - this.carry), required: this.carryRequired }
        const hp = D(f.enemyHp)
        const part = hp.gt(0) ? Math.min(0.99, this.dealt.div(hp).toNumber()) : 0
        return { kills: Math.min(f.killsRequired, this.shown + part), required: f.killsRequired }
    }

    /** The share of the front body's HP its hits have not yet taken, 0 → 1: its overhead bar. */
    frontLeft(): number {
        const f = this.feed
        const hp = D(this.carry > 0 ? this.carryHp ?? '0' : f?.enemyHp ?? '0')
        if (hp.lte(0)) return 1
        return Math.max(0.02, 1 - Math.min(1, this.dealt.div(hp).toNumber()))
    }

    /** Bodies that should already be down. */
    due(): number {
        const f = this.feed
        if (!f || f.atBossGate) return this.carry
        return this.carry + Math.max(0, Math.floor(f.killsFloat) - this.shown)
    }

    /** Count a landed hit toward the measured hit rate. */
    tick(dt: number): void {
        const spk = this.feed?.farming ? this.feed.secondsPerKill : null
        if (spk !== null && spk > 0) this.farmed += dt / spk
        this.second += dt
        if (this.second < 1) return
        const rate = this.hitsThisSecond / this.second
        this.hitsPerSecond += (rate - this.hitsPerSecond) * Math.min(1, RATE_FOLLOW * this.second)
        this.hitsPerSecond = Math.max(0.25, this.hitsPerSecond)
        this.hitsThisSecond = 0
        this.second = 0
    }

    /**
     * A hit on the front body that does not kill it: what it shows, or null to show nothing.
     * Sized so a body's hits come to its HP over the time it takes to die, crits at the real
     * multiplier.
     */
    hit(crit: boolean): string | null {
        const f = this.feed
        this.hitsThisSecond++
        if (!f) return null
        const carried = this.carry > 0
        if (carried && this.carryHp === null) return null
        const hp = D(carried ? this.carryHp! : f.enemyHp)
        const spk = f.secondsPerKill
        if (spk === null || spk <= 0 || hp.lte(0)) return null
        const mult = D(f.critMultiplier)
        // the crit-averaged factor `combat.ts` uses, so normal and crit hits keep their real ratio
        const factor = D(1).add(mult.sub(1).mul(Math.min(1, Math.max(0, f.critChance))))
        const hits = Math.max(1, spk * this.hitsPerSecond)
        const base = hp.div(factor.mul(hits))
        const want = crit ? base.mul(mult) : base
        const room = hp.sub(this.dealt).sub(hp.mul(LAST_BLOW_SHARE))
        if (room.lte(0)) return null
        const shown = want.lt(room) ? want : room
        this.dealt = this.dealt.add(shown)
        this.last = shown
        return stageNumber(shown)
    }

    /** The killing blow on the front body: the HP it had left, or null for a boss or escort whose fight already showed its numbers. */
    finish(): string | null {
        const f = this.feed
        let hp: string | null = f?.enemyHp ?? null
        if (this.carry > 0) {
            this.carry--
            hp = this.carryHp
        } else {
            this.shown++
        }
        if (hp === null) {
            this.dealt = ZERO
            return null
        }
        const left = D(hp).sub(this.dealt)
        this.dealt = ZERO
        this.last = left.gt(0) ? left : D(1)
        return stageNumber(this.last)
    }
}
