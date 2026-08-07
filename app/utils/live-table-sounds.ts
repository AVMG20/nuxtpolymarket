// Single source of truth for live table game sound effects — consumed by both
// in-game playback (app/composables/live-table-sound.ts) and the generation
// script (scripts/generate-live-table-sounds.ts).
//
// Every event owns a folder public/live-table/sound/<event>/ holding numbered
// variants 1.wav .. LT_SOUND_VARIANTS.wav — playback picks one at random so
// rapid repeats don't sound like a stuck sample. Missing variants are skipped
// gracefully, so a table with no generated audio yet is silent rather than
// broken.
//
// `prompt`, `trim` and `cut` are generation-time only. `cut` picks how the
// one-shot is extracted: 'peak' anchors on the loudest transient (right for
// card snaps and chip clacks), 'onset' anchors on the first audible sample
// (right for shuffles and jingles whose loudest moment lands mid-phrase),
// 'energy' slides the window over the clip for sustained sounds.

export type LtSoundEvent =
    | 'card-deal'
    | 'card-flip'
    | 'shuffle'
    | 'chip-place'
    | 'chip-undo'
    | 'chip-payout'
    | 'chip-collect'
    | 'win'
    | 'lose'
    | 'push'
    | 'fold'
    | 'call'
    | 'timer-warning'
    | 'button-press'
    | 'player-join'
    | 'player-leave'
    | 'roulette-spin'
    | 'roulette-ball-drop'
    | 'roulette-no-bets'
    | 'roulette-result'
    | 'ambient-slot'
    | 'ambient-coins'
    | 'ambient-crowd'
    | 'ambient-clatter'

export interface LtSoundSpec {
    /** Text prompt sent to the sound-effects model. */
    prompt: string
    /** Seconds of audio kept in the final one-shot. */
    trim: number
    /** How the one-shot is anchored inside the generated clip (default 'peak'). */
    cut?: 'peak' | 'onset' | 'energy'
}

/** Variants generated (and considered by playback) per event. */
export const LT_SOUND_VARIANTS = 3

export const LT_SOUND_MANIFEST: Record<LtSoundEvent, LtSoundSpec> = {
    'card-deal': {
        prompt: 'Single playing card sliding out of a dealing shoe and skidding onto green baize, crisp short paper whisk with a soft landing tap, close-miked casino table, dry and clean, no music',
        trim: 0.34
    },
    'card-flip': {
        prompt: 'Single playing card being turned face up on a felt table, quick cardboard snap and flick, close-miked, dry, no music',
        trim: 0.3
    },
    'shuffle': {
        prompt: 'Card shuffling',
        trim: 0.9,
        cut: 'energy'
    },
    'chip-place': {
        prompt: 'Single clay casino chip set down firmly onto a small stack on felt, sharp click with a short woody rattle, close-miked, dry, no music',
        trim: 0.28
    },
    'chip-undo': {
        prompt: 'Single clay casino chip lifted off a stack and set aside, soft muted click with a very short tail, close-miked, dry, no music',
        trim: 0.24
    },
    'chip-payout': {
        prompt: 'Handful of clay casino chips pushed across felt and cascading into a stack, continuous warm clatter with no gaps, close-miked casino table, dry, no music',
        trim: 0.8,
        cut: 'energy'
    },
    'chip-collect': {
        prompt: 'Dealer sweeping losing casino chips across felt into the tray, continuous scraping and tumbling with no gaps, close-miked, dry, no music',
        trim: 0.7,
        cut: 'energy'
    },
    'win': {
        prompt: 'Short bright reward chime for a winning hand, warm two-note ascending bell with a clean tail, tasteful casino game jingle, no drums',
        trim: 1,
        cut: 'onset'
    },
    'lose': {
        prompt: 'Short muted losing tone for a lost hand, soft descending two-note wooden thud, understated and low, casino game jingle, not harsh',
        trim: 0.8,
        cut: 'onset'
    },
    'push': {
        prompt: 'Short neutral tie tone, single soft mid-range wooden knock with a gentle bell overtone, understated casino game cue',
        trim: 0.6,
        cut: 'onset'
    },
    'fold': {
        prompt: 'Short deflating fold sound for folding a hand, low muted descending cardboard sweep, dry and clipped, casino game cue, not comedic',
        trim: 0.5,
        cut: 'onset'
    },
    'call': {
        prompt: 'Short confident call sound for placing a call bet, crisp metallic chip tap with a bright ascending ping, casino game action cue',
        trim: 0.4,
        cut: 'peak'
    },
    'timer-warning': {
        prompt: 'Single soft clock tick for a countdown running low, dry muted wooden tick with almost no tail, quiet interface cue',
        trim: 0.22
    },
    'button-press': {
        prompt: 'Tiny soft interface button press, dry muted click with no tail, quiet and subtle, casino game UI',
        trim: 0.14
    },
    'player-join': {
        prompt: 'Short friendly two-note arrival chime for a player sitting down at the table, warm soft bells, quiet and welcoming, casino game interface cue',
        trim: 0.6,
        cut: 'onset'
    },
    'player-leave': {
        prompt: 'Short soft departure tone for a player leaving the table, gentle descending two-note bell, quiet and neutral, casino game interface cue',
        trim: 0.5,
        cut: 'onset'
    },
    'roulette-spin': {
        prompt: 'Roulette wheel spinning, continuous smooth mechanical whir of a large wooden wheel turning, soft rhythmic clicking of the ball bouncing along the rim, casino atmosphere, no music',
        trim: 2.5,
        cut: 'energy'
    },
    'roulette-ball-drop': {
        prompt: 'Roulette ball losing momentum and dropping into a numbered pocket on a wooden wheel, sharp clack followed by a brief rattle as it settles, close-miked casino table, no music',
        trim: 0.6,
        cut: 'peak'
    },
    'roulette-no-bets': {
        prompt: 'Double brass bell strike signaling betting is closed at a casino table, firm clean ring with a short decay, no speech, no music',
        trim: 0.5,
        cut: 'peak'
    },
    'roulette-result': {
        prompt: 'Short bright notification chime for a roulette result, warm single bell strike with a clean decay, casino game interface cue',
        trim: 0.8,
        cut: 'onset'
    },

    // Ambience stings — played on a random timer under the murmur bed (see
    // LT_AMBIENT_STING_EVENTS below), not by a game event. Written and mixed
    // as distant background, not the close-miked table-adjacent cues above.
    'ambient-slot': {
        prompt: 'Distant slot machine across a casino floor, muffled reel spin and a faint jackpot chime, far away and roomy, no music, background atmosphere not close-miked',
        trim: 1.6,
        cut: 'energy'
    },
    'ambient-coins': {
        prompt: 'Distant coin and chip cascade spilling from a slot machine tray across a casino floor, muffled metallic clatter, far away and roomy, no music, background atmosphere not close-miked',
        trim: 1.2,
        cut: 'energy'
    },
    'ambient-crowd': {
        prompt: 'Distant casino crowd reaction, a few people cheering and laughing together far across the room, muffled and roomy, no music, no distinct words, background atmosphere not close-miked',
        trim: 1.8,
        cut: 'energy'
    },
    'ambient-clatter': {
        prompt: 'Distant neighboring casino table, muffled chip clatter and a faint card shuffle across the room, far away and roomy, no music, background atmosphere not close-miked',
        trim: 1.4,
        cut: 'energy'
    }
}

/** The pool live-table-sound.ts's ambience scheduler drops in under the
 *  murmur loop, at random and on a timer — distinct from the events above,
 *  which are triggered by an actual game action. */
export const LT_AMBIENT_STING_EVENTS: LtSoundEvent[] = ['ambient-slot', 'ambient-coins', 'ambient-crowd', 'ambient-clatter']

/** Per-event mix levels relative to the player's volume setting. */
export const LT_SOUND_LEVELS: Record<LtSoundEvent, number> = {
    'card-deal': 0.4,
    'card-flip': 0.35,
    'shuffle': 0.3,
    'chip-place': 0.4,
    'chip-undo': 0.3,
    'chip-payout': 0.5,
    'chip-collect': 0.4,
    'win': 0.55,
    'lose': 0.45,
    'push': 0.35,
    'fold': 0.35,
    'call': 0.4,
    'timer-warning': 0.3,
    'button-press': 0.2,
    'player-join': 0.4,
    'player-leave': 0.3,
    'roulette-spin': 0.35,
    'roulette-ball-drop': 0.5,
    'roulette-no-bets': 0.5,
    'roulette-result': 0.5,
    // Distant, but audible over the murmur bed rather than lost under it —
    // 0.18-0.22 turned out inaudible in practice. Slot pulled back down a
    // touch from its first pass at 0.5, which came in louder than the rest.
    'ambient-slot': 0.38,
    'ambient-coins': 0.45,
    'ambient-crowd': 0.5,
    'ambient-clatter': 0.4
}

/** Minimum ms between plays of the same event to prevent sound choking/stacking. */
export const LT_SOUND_COOLDOWNS: Record<LtSoundEvent, number> = {
    'card-deal': 60,
    'card-flip': 50,
    'shuffle': 500,
    'chip-place': 60,
    'chip-undo': 60,
    'chip-payout': 300,
    'chip-collect': 300,
    'win': 500,
    'lose': 500,
    'push': 500,
    'fold': 300,
    'call': 300,
    'timer-warning': 200,
    'button-press': 50,
    'player-join': 500,
    'player-leave': 500,
    'roulette-spin': 1000,
    'roulette-ball-drop': 1000,
    'roulette-no-bets': 1000,
    'roulette-result': 1000,
    // The scheduler already spaces these out over tens of seconds — this is
    // just a floor against two firing back to back.
    'ambient-slot': 4000,
    'ambient-coins': 4000,
    'ambient-crowd': 4000,
    'ambient-clatter': 4000
}

/** The looping base ambience bed — a real seamless loop, not a one-shot, so
 *  it lives in its own manifest: generation needs trimForLoop()'s crossfade
 *  rather than trimToOneShot(), see scripts/generate-live-table-ambience.ts.
 *  Multiple variants exist purely for session-to-session variety; playback
 *  picks one at random the way it does for one-shot variants. */
export interface LtMurmurSpec {
    prompt: string
    /** Seconds requested from the model before the loop crossfade is cut. */
    duration: number
}

export const LT_MURMUR_VARIANTS = 2

export const LT_MURMUR_MANIFEST: LtMurmurSpec[] = [
    {
        prompt: 'Busy casino floor room tone, dozens of distant overlapping conversations and a low steady murmur, occasional muffled laughter, no distinct words, no music, no slot machines, continuous and even with no sudden peaks',
        duration: 20
    },
    {
        prompt: 'Crowded casino lounge background murmur, warm low chatter, distant footsteps and glasses, muffled and steady, no distinct words, no music, continuous and even with no sudden peaks',
        duration: 20
    }
]
