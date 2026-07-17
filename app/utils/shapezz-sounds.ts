// Single source of truth for SHAPEZZ sound effects — consumed by both
// in-game playback (app/composables/shapezz-sound.ts) and the generation
// script (scripts/generate-shapezz-sounds.ts).
//
// Every event owns a folder public/shapezz/sound/<event>/ holding numbered
// variants 1.wav .. SHAPEZZ_SOUND_VARIANTS.wav — playback picks one at
// random so rapid repeats don't sound like a stuck sample. Variants that get
// deleted during audit are skipped gracefully; regenerate missing ones with
// the script.
//
// `prompt`, `trim` and `cut` are generation-time only. `cut` picks how the
// one-shot is extracted from the generated clip: 'peak' anchors on the
// loudest transient (right for percussive shots and impacts), 'onset'
// anchors on the first audible sample (right for chimes/jingles/swells whose
// loudest moment is mid-phrase).

export type ShapezzSoundEvent =
    | 'shoot-blaster'
    | 'shoot-launcher'
    | 'shoot-shotgun'
    | 'drone-shoot'
    | 'enemy-shoot'
    | 'hit-enemy'
    | 'explosion'
    | 'enemy-death'
    | 'boss-spawn'
    | 'boss-death'
    | 'player-hurt'
    | 'player-death'
    | 'dash'
    | 'pickup-coin'
    | 'pickup-health'
    | 'singularity'
    | 'checkpoint'
    | 'upgrade'
    | 'run-start'
    | 'cash-out'

export interface ShapezzSoundSpec {
    /** Text prompt sent to the sound-effects model. */
    prompt: string
    /** Seconds of audio kept in the final one-shot. */
    trim: number
    /** How the one-shot is anchored inside the generated clip (default 'peak'). */
    cut?: 'peak' | 'onset'
}

/** Variants generated (and considered by playback) per event. */
export const SHAPEZZ_SOUND_VARIANTS = 4

export const SHAPEZZ_SOUND_MANIFEST: Record<ShapezzSoundEvent, ShapezzSoundSpec> = {
    'shoot-blaster': {
        prompt: 'Single short sci-fi laser blaster shot, punchy synthetic zap with a bright quick tail, retro arcade video game weapon one-shot',
        trim: 0.35
    },
    'shoot-launcher': {
        prompt: 'Single heavy sci-fi grenade launcher firing, deep whooshing thump of a large plasma shell, low and powerful with a short rumbling tail, video game weapon one-shot',
        trim: 0.9
    },
    'shoot-shotgun': {
        prompt: 'Single futuristic energy shotgun blast, wide aggressive burst with crunchy attack and short scattering tail, video game weapon one-shot',
        trim: 0.55
    },
    'drone-shoot': {
        prompt: 'Single tiny robotic drone laser shot, small light electronic pip with instant decay, quiet secondary weapon in an arcade video game',
        trim: 0.25
    },
    'enemy-shoot': {
        prompt: 'Single hostile alien turret plasma shot, dull menacing synthetic thud with a low tail, enemy projectile in a video game',
        trim: 0.4
    },
    'hit-enemy': {
        prompt: 'Single short bullet impact on a hard crystalline shell, tight percussive crack, video game hit marker one-shot',
        trim: 0.25
    },
    'explosion': {
        prompt: 'Single medium sci-fi plasma explosion, punchy boom with crackling energy debris and a short rumble tail, video game explosion one-shot',
        trim: 1
    },
    'enemy-death': {
        prompt: 'Single small geometric enemy shattering into pieces, glassy synthetic pop burst with brief sparkling debris, arcade video game kill sound',
        trim: 0.5
    },
    'boss-spawn': {
        prompt: 'Ominous boss arrival alarm in a sci-fi arcade game, low menacing horn blast with a rising distorted synth swell, threatening and short',
        trim: 1.5,
        cut: 'onset'
    },
    'boss-death': {
        prompt: 'Huge sci-fi boss destruction, massive layered explosion with shattering crystal debris and a long deep rumble, climactic video game kill',
        trim: 1.8
    },
    'player-hurt': {
        prompt: 'Player taking damage in a sci-fi arcade game, sharp distorted electric shock hit with a brief alarm undertone, urgent one-shot',
        trim: 0.45
    },
    'player-death': {
        prompt: 'Player ship destroyed, deep sad explosion with a descending power-down synth pitch fall, game over moment in an arcade video game',
        trim: 1.6,
        cut: 'onset'
    },
    'dash': {
        prompt: 'Quick sci-fi dash whoosh, short airy futuristic swish with a subtle energy shimmer, player movement one-shot in a video game',
        trim: 0.4
    },
    'pickup-coin': {
        prompt: 'Single bright coin pickup chime, short cheerful metallic ding, classic arcade video game collectible one-shot',
        trim: 0.3
    },
    'pickup-health': {
        prompt: 'Health pickup in a video game, soft warm ascending two-note healing chime with a gentle glow, positive one-shot',
        trim: 0.5,
        cut: 'onset'
    },
    'singularity': {
        prompt: 'Small black hole vortex forming, deep sucking bass whoomp with a swirling reversed air texture, sci-fi video game gravity weapon',
        trim: 1.2,
        cut: 'onset'
    },
    'checkpoint': {
        prompt: 'Level up checkpoint reached in an arcade game, short triumphant ascending synth arpeggio chime, bright and rewarding',
        trim: 1,
        cut: 'onset'
    },
    'upgrade': {
        prompt: 'Powerful upgrade activating, satisfying electric power-up surge with a rising energized charge and solid click, video game one-shot',
        trim: 0.8,
        cut: 'onset'
    },
    'run-start': {
        prompt: 'Game round starting, short energetic sci-fi power-on sweep ending in a confident synth stab, arcade video game start signal',
        trim: 1,
        cut: 'onset'
    },
    'cash-out': {
        prompt: 'Big win payout in an arcade game, triumphant short jingle of cascading coins with a bright victorious synth chord, rewarding',
        trim: 1.5,
        cut: 'onset'
    }
}

/** Per-event mix levels relative to the player's volume setting. */
export const SHAPEZZ_SOUND_LEVELS: Record<ShapezzSoundEvent, number> = {
    'shoot-blaster': 0.3,
    'shoot-launcher': 0.45,
    'shoot-shotgun': 0.4,
    'drone-shoot': 0.18,
    'enemy-shoot': 0.22,
    'hit-enemy': 0.25,
    'explosion': 0.5,
    'enemy-death': 0.35,
    'boss-spawn': 0.6,
    'boss-death': 0.7,
    'player-hurt': 0.55,
    'player-death': 0.7,
    'dash': 0.35,
    'pickup-coin': 0.3,
    'pickup-health': 0.4,
    'singularity': 0.45,
    'checkpoint': 0.5,
    'upgrade': 0.5,
    'run-start': 0.5,
    'cash-out': 0.6
}

/** Minimum ms between plays of the same event — the blaster fires up to 18/s. */
export const SHAPEZZ_SOUND_COOLDOWNS: Record<ShapezzSoundEvent, number> = {
    'shoot-blaster': 70,
    'shoot-launcher': 120,
    'shoot-shotgun': 110,
    'drone-shoot': 60,
    'enemy-shoot': 90,
    'hit-enemy': 50,
    'explosion': 90,
    'enemy-death': 70,
    'boss-spawn': 1000,
    'boss-death': 1000,
    'player-hurt': 250,
    'player-death': 1000,
    'dash': 150,
    'pickup-coin': 60,
    'pickup-health': 200,
    'singularity': 400,
    'checkpoint': 500,
    'upgrade': 300,
    'run-start': 1000,
    'cash-out': 1000
}
