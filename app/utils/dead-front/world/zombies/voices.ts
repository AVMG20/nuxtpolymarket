// A vocal budget for the horde: a few voices at a time, nearest first, long
// randomised gaps per zombie and short global gaps per kind, so a room of
// zombies reads as occasional groans that build tension instead of a drone.
// (The audio layer also limits zombie voices; this keeps the view from even
// asking most of the time.)

export type DfVoiceKind = 'groan' | 'attack' | 'tear' | 'rise' | 'death' | 'stagger' | 'spit'

const VOICE_SECONDS: Record<DfVoiceKind, number> = { groan: 1.8, attack: 0.9, tear: 0.8, rise: 1.4, death: 1.2, stagger: 0.9, spit: 0.8 }
/** Minimum seconds between two sounds of the same kind, map-wide. */
const KIND_GAP: Record<DfVoiceKind, number> = { groan: 1.1, attack: 0.35, tear: 0.6, rise: 0.7, death: 0.15, stagger: 0.8, spit: 0.4 }
/** Beyond this distance a kind is not voiced at all. */
const KIND_RANGE: Record<DfVoiceKind, number> = { groan: 26, attack: 22, tear: 18, rise: 30, death: 30, stagger: 16, spit: 30 }

export const DF_MAX_ZOMBIE_VOICES = 3

export class DfZombieVoices {
    private ends: number[] = []
    private last: Partial<Record<DfVoiceKind, number>> = {}

    /** True (and the voice is booked) if this sound may play now. */
    take(kind: DfVoiceKind, now: number, dist: number): boolean {
        if (dist > KIND_RANGE[kind]) return false
        if (now - (this.last[kind] ?? -99) < KIND_GAP[kind]) return false
        this.ends = this.ends.filter(t => t > now)
        // Deaths and attacks may borrow one extra voice; groans never crowd them out.
        const cap = kind === 'death' || kind === 'attack' ? DF_MAX_ZOMBIE_VOICES + 1 : kind === 'groan' ? DF_MAX_ZOMBIE_VOICES - 1 : DF_MAX_ZOMBIE_VOICES
        if (this.ends.length >= cap) return false
        this.ends.push(now + VOICE_SECONDS[kind])
        this.last[kind] = now
        return true
    }

    get active(): number {
        return this.ends.length
    }
}
