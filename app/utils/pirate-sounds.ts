// Pirate Raid sound effect events and their mix settings. Every effect is
// synthesized at play time (app/utils/pirate-synth.ts) and played through
// app/composables/pirate-sound.ts; there are no sample files.

import type { PirateSoundEvent, SoundOptions } from '~/utils/pirates-engine/types'

export type { PirateSoundEvent, SoundOptions }

/** Per-event mix levels relative to the player's volume setting. */
export const PIRATE_SOUND_LEVELS: Record<PirateSoundEvent, number> = {
    'cannon': 0.3,
    'cannon-heavy': 0.4,
    'cannon-gem': 0.32,
    'enemy-cannon': 0.2,
    'titan-fire': 0.6,
    'impact': 0.2,
    'impact-crit': 0.3,
    'miss-splash': 0.16,
    'ship-hit': 0.46,
    'shield-hit': 0.3,
    'enemy-sunk': 0.36,
    'boss-sunk': 0.68,
    'player-sunk': 0.6,
    'crate-spawn': 0.3,
    'crate-pickup': 0.4,
    'repair-pickup': 0.38,
    'mine-explode': 0.55,
    'explosion': 0.42,
    'keg-throw': 0.32,
    'keg-explode': 0.58,
    'warhead-launch': 0.26,
    'warhead-hit': 0.4,
    'consort-summon': 0.38,
    'maelstrom-open': 0.45,
    'maelstrom-loop-start': 0.3,
    'maelstrom-loop-stop': 0.32,
    'hellfire-call': 0.42,
    'hellfire-impact': 0.46,
    'wave-roll': 0.5,
    'lightning': 0.3,
    'ability-ready': 0.24,
    'sniper-charge': 0.28,
    'sniper-fire': 0.4,
    'harpoon-fire': 0.34,
    'harpoon-hit': 0.42,
    'mortar-launch': 0.3,
    'bomb-throw': 0.26,
    'skiff-launch': 0.22,
    'ward-cast': 0.3,
    'fireship-ignite': 0.4,
    'boss-horn': 0.6,
    'kraken-roar': 0.58,
    'tentacle-slam': 0.5,
    'kraken-dive': 0.45,
    'ink-splash': 0.4,
    'phantom-blink': 0.38,
    'phantom-spiral': 0.32,
    'phantom-summon': 0.4,
    'low-hull': 0.34,
    'voyage-start': 0.4,
    'voyage-complete': 0.48,
    'defeat': 0.45,
    'menu': 0.22
}

/** Minimum ms between plays of the same event; eight gun ports fire in quick succession. */
export const PIRATE_SOUND_COOLDOWNS: Record<PirateSoundEvent, number> = {
    'cannon': 55,
    'cannon-heavy': 80,
    'cannon-gem': 70,
    'enemy-cannon': 90,
    'titan-fire': 200,
    'impact': 45,
    'impact-crit': 70,
    'miss-splash': 60,
    'ship-hit': 160,
    'shield-hit': 120,
    'enemy-sunk': 90,
    'boss-sunk': 1000,
    'player-sunk': 1000,
    'crate-spawn': 400,
    'crate-pickup': 150,
    'repair-pickup': 200,
    'mine-explode': 150,
    'explosion': 80,
    'keg-throw': 200,
    'keg-explode': 200,
    'warhead-launch': 120,
    'warhead-hit': 100,
    'consort-summon': 500,
    'maelstrom-open': 500,
    'maelstrom-loop-start': 300,
    'maelstrom-loop-stop': 300,
    'hellfire-call': 500,
    'hellfire-impact': 90,
    'wave-roll': 400,
    'lightning': 90,
    'ability-ready': 400,
    'sniper-charge': 250,
    'sniper-fire': 120,
    'harpoon-fire': 150,
    'harpoon-hit': 200,
    'mortar-launch': 150,
    'bomb-throw': 150,
    'skiff-launch': 150,
    'ward-cast': 300,
    'fireship-ignite': 200,
    'boss-horn': 1500,
    'kraken-roar': 800,
    'tentacle-slam': 150,
    'kraken-dive': 600,
    'ink-splash': 200,
    'phantom-blink': 300,
    'phantom-spiral': 300,
    'phantom-summon': 600,
    'low-hull': 2500,
    'voyage-start': 1000,
    'voyage-complete': 1000,
    'defeat': 1000,
    'menu': 60
}

/**
 * Most voices of one event allowed to ring at once; a new play past the cap
 * steals the oldest. Events not listed get PIRATE_SOUND_DEFAULT_VOICE_CAP.
 */
export const PIRATE_SOUND_VOICE_CAPS: Partial<Record<PirateSoundEvent, number>> = {
    'cannon': 5,
    'cannon-heavy': 4,
    'cannon-gem': 4,
    'enemy-cannon': 4,
    'impact': 4,
    'impact-crit': 3,
    'miss-splash': 3,
    'enemy-sunk': 4,
    'explosion': 4,
    'hellfire-impact': 4,
    'lightning': 3,
    'boss-sunk': 1,
    'player-sunk': 1,
    'boss-horn': 1,
    'voyage-start': 1,
    'voyage-complete': 1,
    'defeat': 1,
    'maelstrom-open': 1
}

export const PIRATE_SOUND_DEFAULT_VOICE_CAP = 3

/** Most voices of all events ringing at once. */
export const PIRATE_SOUND_MAX_VOICES = 44
