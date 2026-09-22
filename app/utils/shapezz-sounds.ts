// SHAPEZZ sound effect events and their mix settings. Every effect is
// synthesized at play time (app/utils/shapezz-synth.ts) and played through
// app/composables/shapezz-sound.ts; there are no sample files.

export type ShapezzSoundEvent =
    | 'shoot-blaster' | 'shoot-launcher' | 'shoot-shotgun' | 'shoot-arc'
    | 'drone-shoot' | 'enemy-shoot' | 'enemy-shoot-heavy' | 'sniper-charge' | 'sniper-fire'
    | 'hit-enemy' | 'hit-crit' | 'hit-armor' | 'explosion' | 'explosion-big' | 'enemy-death' | 'elite-death'
    | 'enemy-split' | 'bomber-fuse' | 'enemy-spawn-elite'
    | 'boss-spawn' | 'boss-attack' | 'boss-laser' | 'boss-phase' | 'boss-death'
    | 'player-hurt' | 'player-death' | 'shield-gain' | 'shield-hit' | 'dash' | 'land'
    | 'pickup-coin' | 'pickup-health' | 'singularity' | 'chain-lightning' | 'execute' | 'lance'
    | 'combo-milestone' | 'checkpoint' | 'upgrade' | 'run-start' | 'cash-out'

export interface ShapezzSoundOptions {
    /** Stereo position, -1 (left) .. 1 (right). */
    pan?: number
    /** Pitch multiplier, 1 = normal. */
    pitch?: number
    /** Extra gain multiplier, 1 = normal. */
    volume?: number
}

/** Per-event mix levels relative to the player's volume setting. */
export const SHAPEZZ_SOUND_LEVELS: Record<ShapezzSoundEvent, number> = {
    'shoot-blaster': 0.22,
    'shoot-launcher': 0.45,
    'shoot-shotgun': 0.38,
    'shoot-arc': 0.3,
    'drone-shoot': 0.12,
    'enemy-shoot': 0.2,
    'enemy-shoot-heavy': 0.32,
    'sniper-charge': 0.3,
    'sniper-fire': 0.42,
    'hit-enemy': 0.16,
    'hit-crit': 0.24,
    'hit-armor': 0.24,
    'explosion': 0.48,
    'explosion-big': 0.62,
    'enemy-death': 0.3,
    'elite-death': 0.45,
    'enemy-split': 0.3,
    'bomber-fuse': 0.22,
    'enemy-spawn-elite': 0.34,
    'boss-spawn': 0.6,
    'boss-attack': 0.5,
    'boss-laser': 0.28,
    'boss-phase': 0.55,
    'boss-death': 0.7,
    'player-hurt': 0.5,
    'player-death': 0.65,
    'shield-gain': 0.36,
    'shield-hit': 0.34,
    'dash': 0.34,
    'land': 0.3,
    'pickup-coin': 0.22,
    'pickup-health': 0.36,
    'singularity': 0.5,
    'chain-lightning': 0.32,
    'execute': 0.45,
    'lance': 0.5,
    'combo-milestone': 0.34,
    'checkpoint': 0.42,
    'upgrade': 0.42,
    'run-start': 0.45,
    'cash-out': 0.5
}

/** Minimum ms between plays of the same event; the blaster fires up to 18/s. */
export const SHAPEZZ_SOUND_COOLDOWNS: Record<ShapezzSoundEvent, number> = {
    'shoot-blaster': 50,
    'shoot-launcher': 120,
    'shoot-shotgun': 110,
    'shoot-arc': 80,
    'drone-shoot': 60,
    'enemy-shoot': 80,
    'enemy-shoot-heavy': 140,
    'sniper-charge': 250,
    'sniper-fire': 120,
    'hit-enemy': 40,
    'hit-crit': 60,
    'hit-armor': 60,
    'explosion': 80,
    'explosion-big': 200,
    'enemy-death': 50,
    'elite-death': 200,
    'enemy-split': 80,
    'bomber-fuse': 240,
    'enemy-spawn-elite': 400,
    'boss-spawn': 1000,
    'boss-attack': 300,
    'boss-laser': 600,
    'boss-phase': 1000,
    'boss-death': 1000,
    'player-hurt': 250,
    'player-death': 1000,
    'shield-gain': 300,
    'shield-hit': 120,
    'dash': 150,
    'land': 150,
    'pickup-coin': 45,
    'pickup-health': 200,
    'singularity': 400,
    'chain-lightning': 100,
    'execute': 120,
    'lance': 300,
    'combo-milestone': 300,
    'checkpoint': 500,
    'upgrade': 300,
    'run-start': 1000,
    'cash-out': 1000
}

/**
 * Most voices of one event allowed to ring at once; a new play past the cap
 * steals the oldest. Events not listed get SHAPEZZ_SOUND_DEFAULT_VOICE_CAP.
 */
export const SHAPEZZ_SOUND_VOICE_CAPS: Partial<Record<ShapezzSoundEvent, number>> = {
    'shoot-blaster': 4,
    'drone-shoot': 3,
    'hit-enemy': 4,
    'hit-crit': 3,
    'hit-armor': 3,
    'pickup-coin': 5,
    'enemy-shoot': 5,
    'enemy-death': 6,
    'explosion': 5,
    'boss-laser': 2,
    'boss-death': 1,
    'boss-spawn': 1,
    'player-death': 1,
    'cash-out': 1,
    'run-start': 1
}

export const SHAPEZZ_SOUND_DEFAULT_VOICE_CAP = 3

/** Most voices of all events ringing at once. */
export const SHAPEZZ_SOUND_MAX_VOICES = 48
