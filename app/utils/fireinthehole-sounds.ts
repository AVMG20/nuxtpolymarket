// Fire in the Hole sound effect events and their mix settings. Every effect is
// synthesized at play time (app/utils/fireinthehole-synth.ts) and played
// through app/composables/fireinthehole-sound.ts; there are no sample files.

export type FithSoundEvent
    = | 'click'
        | 'toggle'
        | 'bet-up'
        | 'bet-down'
        | 'bet-max'
        | 'spin'
        | 'land'
        | 'crumble'
        | 'gem-win'
        | 'fuse'
        | 'explosion'
        | 'row-unlock'
        | 'scatter'
        | 'anticipation'
        | 'bonus-trigger'
        | 'bonus-spin'
        | 'coin'
        | 'boost'
        | 'double'
        | 'collector'
        | 'transfer'
        | 'tick'
        | 'win-small'
        | 'win-big'
        | 'win-mega'
        | 'win-epic'
        | 'win-motherlode'
        | 'bonus-end'
        | 'buy-bonus'

export interface FithSoundOptions {
    /** Recipe-specific hint: cascade chain, scatter count, tick progress 0..1. */
    intensity?: number
    /** Column 0..5, used to pan the sound across the reel window. */
    col?: number
}

/** Per-event mix levels relative to the player's volume setting. */
export const FITH_SOUND_LEVELS: Record<FithSoundEvent, number> = {
    'click': 0.18,
    'toggle': 0.2,
    'bet-up': 0.2,
    'bet-down': 0.2,
    'bet-max': 0.26,
    'spin': 0.34,
    'land': 0.3,
    'crumble': 0.34,
    'gem-win': 0.3,
    'fuse': 0.24,
    'explosion': 0.62,
    'row-unlock': 0.55,
    'scatter': 0.4,
    'anticipation': 0.34,
    'bonus-trigger': 0.5,
    'bonus-spin': 0.26,
    'coin': 0.3,
    'boost': 0.34,
    'double': 0.4,
    'collector': 0.42,
    'transfer': 0.18,
    'tick': 0.1,
    'win-small': 0.3,
    'win-big': 0.42,
    'win-mega': 0.48,
    'win-epic': 0.52,
    'win-motherlode': 0.56,
    'bonus-end': 0.46,
    'buy-bonus': 0.4
}

/** Minimum ms between plays of the same event. */
export const FITH_SOUND_COOLDOWNS: Record<FithSoundEvent, number> = {
    'click': 40,
    'toggle': 60,
    'bet-up': 45,
    'bet-down': 45,
    'bet-max': 120,
    'spin': 150,
    'land': 35,
    'crumble': 60,
    'gem-win': 90,
    'fuse': 120,
    'explosion': 70,
    'row-unlock': 300,
    'scatter': 90,
    'anticipation': 800,
    'bonus-trigger': 1500,
    'bonus-spin': 150,
    'coin': 45,
    'boost': 90,
    'double': 120,
    'collector': 200,
    'transfer': 40,
    'tick': 45,
    'win-small': 300,
    'win-big': 1000,
    'win-mega': 1000,
    'win-epic': 1000,
    'win-motherlode': 1000,
    'bonus-end': 1200,
    'buy-bonus': 400
}

/**
 * Most voices of one event allowed to ring at once; a new play past the cap
 * steals the oldest. Events not listed get FITH_SOUND_DEFAULT_VOICE_CAP.
 */
export const FITH_SOUND_VOICE_CAPS: Partial<Record<FithSoundEvent, number>> = {
    'land': 6,
    'crumble': 3,
    'explosion': 4,
    'coin': 5,
    'transfer': 4,
    'tick': 2,
    'anticipation': 1,
    'bonus-trigger': 1,
    'bonus-end': 1,
    'win-big': 1,
    'win-mega': 1,
    'win-epic': 1,
    'win-motherlode': 1
}

export const FITH_SOUND_DEFAULT_VOICE_CAP = 3

/** Most voices of all events ringing at once. */
export const FITH_SOUND_MAX_VOICES = 36
