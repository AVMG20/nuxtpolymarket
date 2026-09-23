// Aether Gates sound events and their mix settings. Every effect is
// synthesized at play time (app/utils/slots/aethergates-synth.ts) and played
// through app/composables/aethergates-sound.ts; there are no sample files.

export type AetherSoundEvent =
    | 'click'
    | 'bet-up'
    | 'bet-down'
    | 'bet-max'
    | 'toggle'
    | 'spin'
    | 'reel-land'
    | 'scatter-land'
    | 'anticipation'
    | 'win-cluster'
    | 'shatter'
    | 'tumble'
    | 'orb-land'
    | 'orb-charge'
    | 'orb-zap'
    | 'meter-hit'
    | 'tick'
    | 'win-small'
    | 'win-medium'
    | 'win-big'
    | 'win-mega'
    | 'win-epic'
    | 'tier-up'
    | 'bonus-trigger'
    | 'bonus-start'
    | 'retrigger'
    | 'free-spin'
    | 'bonus-end'
    | 'buy-bonus'

export interface AetherSoundOptions {
    /** Recipe-specific hint: chain depth, orb value, scatter count, tier... */
    intensity?: number
    /** Stereo position, -1 (left) to 1 (right). */
    pan?: number
}

/** Per-event mix levels relative to the player's volume setting. */
export const AETHER_SOUND_LEVELS: Record<AetherSoundEvent, number> = {
    'click': 0.22,
    'bet-up': 0.24,
    'bet-down': 0.22,
    'bet-max': 0.3,
    'toggle': 0.22,
    'spin': 0.34,
    'reel-land': 0.26,
    'scatter-land': 0.42,
    'anticipation': 0.34,
    'win-cluster': 0.34,
    'shatter': 0.3,
    'tumble': 0.2,
    'orb-land': 0.3,
    'orb-charge': 0.26,
    'orb-zap': 0.34,
    'meter-hit': 0.42,
    'tick': 0.1,
    'win-small': 0.36,
    'win-medium': 0.42,
    'win-big': 0.5,
    'win-mega': 0.55,
    'win-epic': 0.6,
    'tier-up': 0.45,
    'bonus-trigger': 0.58,
    'bonus-start': 0.5,
    'retrigger': 0.5,
    'free-spin': 0.22,
    'bonus-end': 0.55,
    'buy-bonus': 0.45
}

/** Minimum ms between plays of the same event. */
export const AETHER_SOUND_COOLDOWNS: Record<AetherSoundEvent, number> = {
    'click': 40,
    'bet-up': 40,
    'bet-down': 40,
    'bet-max': 120,
    'toggle': 60,
    'spin': 150,
    'reel-land': 35,
    'scatter-land': 60,
    'anticipation': 400,
    'win-cluster': 60,
    'shatter': 50,
    'tumble': 60,
    'orb-land': 60,
    'orb-charge': 40,
    'orb-zap': 45,
    'meter-hit': 60,
    'tick': 55,
    'win-small': 300,
    'win-medium': 300,
    'win-big': 600,
    'win-mega': 600,
    'win-epic': 600,
    'tier-up': 250,
    'bonus-trigger': 1000,
    'bonus-start': 800,
    'retrigger': 800,
    'free-spin': 200,
    'bonus-end': 1000,
    'buy-bonus': 600
}

/**
 * Most voices of one event allowed to ring at once; a new play past the cap
 * steals the oldest. Events not listed get AETHER_SOUND_DEFAULT_VOICE_CAP.
 */
export const AETHER_SOUND_VOICE_CAPS: Partial<Record<AetherSoundEvent, number>> = {
    'reel-land': 4,
    'orb-zap': 4,
    'orb-charge': 4,
    'meter-hit': 3,
    'tick': 2,
    'shatter': 3,
    'bonus-trigger': 1,
    'bonus-end': 1,
    'win-epic': 1,
    'win-mega': 1,
    'win-big': 1,
    'anticipation': 1
}

export const AETHER_SOUND_DEFAULT_VOICE_CAP = 2

/** Most voices of all events ringing at once. */
export const AETHER_SOUND_MAX_VOICES = 32

/** Per-play random pitch spread; melodic cues stay on the scale. */
export const AETHER_SOUND_JITTER: Partial<Record<AetherSoundEvent, number>> = {
    'reel-land': 0.05,
    'shatter': 0.06,
    'tumble': 0.05,
    'orb-zap': 0.06,
    'click': 0.02
}
