// Single source of truth for Void Runner sound effects — consumed by both
// in-game playback (app/composables/void-sound.ts) and the generation script
// (scripts/generate-void-sounds.ts).
//
// Every event owns a folder public/void/sound/<event>/ holding numbered
// variants 1.wav .. VOID_SOUND_VARIANTS.wav — playback picks one at random so
// rapid repeats don't sound like a stuck sample. Variants deleted during audit
// are skipped gracefully; regenerate missing ones with the script.
//
// `prompt`, `trim` and `cut` are generation-time only. `cut` picks how the
// one-shot is extracted from the generated clip: 'peak' anchors on the loudest
// transient (right for percussive shots and impacts), 'onset' anchors on the
// first audible sample (right for chimes/jingles/swells/alarms whose loudest
// moment lands mid-phrase).

export type VoidSoundEvent =
    | 'player-shoot'
    | 'turret-shoot'
    | 'drone-shoot'
    | 'enemy-shoot'
    | 'hit-enemy'
    | 'enemy-explode'
    | 'boss-explode'
    | 'boss-spawn'
    | 'shockwave'
    | 'railbeam'
    | 'mine-explode'
    | 'singularity'
    | 'player-hurt'
    | 'shield-hit'
    | 'player-death'
    | 'boost'
    | 'mine-cut'
    | 'mine-complete'
    | 'pickup'
    | 'cargo-full'
    | 'undock'
    | 'extract-success'
    | 'storm-warning'

export interface VoidSoundSpec {
    /** Text prompt sent to the sound-effects model. */
    prompt: string
    /** Seconds of audio kept in the final one-shot. */
    trim: number
    /** How the one-shot is anchored inside the generated clip (default 'peak'). */
    cut?: 'peak' | 'onset'
}

/** Variants generated (and considered by playback) per event. */
export const VOID_SOUND_VARIANTS = 4

export const VOID_SOUND_MANIFEST: Record<VoidSoundEvent, VoidSoundSpec> = {
    'player-shoot': {
        prompt: 'Single punchy sci-fi plasma cannon shot from a spaceship, bright energetic synthetic pulse blast with a quick tail, arcade space shooter weapon one-shot',
        trim: 0.32
    },
    'turret-shoot': {
        prompt: 'Single compact auto-turret energy shot, quick mechanical synthetic pew with a short metallic click, secondary weapon in a space video game',
        trim: 0.26
    },
    'drone-shoot': {
        prompt: 'Single tiny robotic drone laser pip, small light electronic zap with instant decay, quiet swarm drone weapon in a space arcade game',
        trim: 0.22
    },
    'enemy-shoot': {
        prompt: 'Single hostile alien fighter plasma bolt, dull menacing synthetic thud with a low tail, enemy projectile in a space video game',
        trim: 0.4
    },
    'hit-enemy': {
        prompt: 'Single short energy bolt impact on a metal hull, tight percussive synthetic tick, space shooter hit marker one-shot',
        trim: 0.2
    },
    'enemy-explode': {
        prompt: 'Single small spaceship exploding, punchy synthetic burst with crackling debris and a short rumble tail, arcade space video game kill sound',
        trim: 0.6
    },
    'boss-explode': {
        prompt: 'Huge capital warship destruction, massive layered explosion with shattering metal debris and a long deep rumble, climactic space video game boss kill',
        trim: 1.8
    },
    'boss-spawn': {
        prompt: 'Ominous capital warship arrival alarm in a space arcade game, low menacing horn blast with a rising distorted synth swell, threatening and short',
        trim: 1.5,
        cut: 'onset'
    },
    'shockwave': {
        prompt: 'Expanding energy shockwave blast in space, deep whooshing bass boom with a resonant sweep outward, sci-fi enemy attack one-shot',
        trim: 0.9
    },
    'railbeam': {
        prompt: 'Charging sci-fi railgun beam firing, rising electric whine snapping into a sharp piercing laser blast, enemy heavy weapon one-shot',
        trim: 1,
        cut: 'onset'
    },
    'mine-explode': {
        prompt: 'Single proximity space mine detonating, sharp cracking explosion with a metallic ring and short scattering debris, video game trap one-shot',
        trim: 0.7
    },
    'singularity': {
        prompt: 'Small black hole vortex forming in space, deep sucking bass whoomp with a swirling reversed air texture, sci-fi gravity weapon one-shot',
        trim: 1.2,
        cut: 'onset'
    },
    'player-hurt': {
        prompt: 'Player spaceship taking a hit in a space arcade game, sharp distorted metallic impact with a brief alarm undertone, urgent one-shot',
        trim: 0.4
    },
    'shield-hit': {
        prompt: 'Energy shield absorbing a hit, bright electric shimmer with a quick crystalline ring, sci-fi force field deflect one-shot',
        trim: 0.4
    },
    'player-death': {
        prompt: 'Player spaceship destroyed, deep sad explosion with a descending power-down synth pitch fall, game over moment in a space arcade game',
        trim: 1.6,
        cut: 'onset'
    },
    'boost': {
        prompt: 'Quick sci-fi engine boost whoosh, short airy futuristic thruster swish with an energy shimmer, spaceship afterburner one-shot',
        trim: 0.45,
        cut: 'onset'
    },
    'mine-cut': {
        prompt: 'Single short crunchy mining laser cutting into rock, gritty sizzling energy scrape with a quick crackle, space mining game texture one-shot',
        trim: 0.18
    },
    'mine-complete': {
        prompt: 'Rock shattering into ore chunks with a bright collect chime, glassy crystalline break followed by a short rewarding ding, space mining game one-shot',
        trim: 0.6,
        cut: 'onset'
    },
    'pickup': {
        prompt: 'Single bright metallic pickup blip, short satisfying digital chirp collecting salvage, space arcade game one-shot',
        trim: 0.25,
        cut: 'onset'
    },
    'cargo-full': {
        prompt: 'Short warning alert chirp, two quick descending electronic beeps signalling a full cargo hold, sci-fi video game notification',
        trim: 0.5,
        cut: 'onset'
    },
    'undock': {
        prompt: 'Spaceship undocking and launching, short energetic sci-fi power-on sweep of engines igniting into a confident thrust, space arcade launch signal',
        trim: 1.1,
        cut: 'onset'
    },
    'extract-success': {
        prompt: 'Successful docking payout in a space arcade game, triumphant short jingle with a bright victorious synth chord and a confirming chime, rewarding',
        trim: 1.5,
        cut: 'onset'
    },
    'storm-warning': {
        prompt: 'Ominous storm warning klaxon in a space game, low alarm siren pulse with a tense rising synth drone, urgent danger alert, short',
        trim: 1.2,
        cut: 'onset'
    }
}

/** Per-event mix levels relative to the player's volume setting. */
export const VOID_SOUND_LEVELS: Record<VoidSoundEvent, number> = {
    'player-shoot': 0.3,
    'turret-shoot': 0.2,
    'drone-shoot': 0.16,
    'enemy-shoot': 0.2,
    'hit-enemy': 0.22,
    'enemy-explode': 0.4,
    'boss-explode': 0.75,
    'boss-spawn': 0.65,
    'shockwave': 0.4,
    'railbeam': 0.4,
    'mine-explode': 0.5,
    'singularity': 0.4,
    'player-hurt': 0.5,
    'shield-hit': 0.35,
    'player-death': 0.75,
    'boost': 0.28,
    'mine-cut': 0.18,
    'mine-complete': 0.4,
    'pickup': 0.25,
    'cargo-full': 0.45,
    'undock': 0.5,
    'extract-success': 0.6,
    'storm-warning': 0.5
}

/** Minimum ms between plays of the same event — the primary cannon fires fast. */
export const VOID_SOUND_COOLDOWNS: Record<VoidSoundEvent, number> = {
    'player-shoot': 60,
    'turret-shoot': 70,
    'drone-shoot': 60,
    'enemy-shoot': 90,
    'hit-enemy': 45,
    'enemy-explode': 70,
    'boss-explode': 800,
    'boss-spawn': 1000,
    'shockwave': 260,
    'railbeam': 320,
    'mine-explode': 180,
    'singularity': 350,
    'player-hurt': 240,
    'shield-hit': 160,
    'player-death': 1000,
    'boost': 480,
    'mine-cut': 130,
    'mine-complete': 90,
    'pickup': 55,
    'cargo-full': 1500,
    'undock': 1000,
    'extract-success': 1000,
    'storm-warning': 2000
}
