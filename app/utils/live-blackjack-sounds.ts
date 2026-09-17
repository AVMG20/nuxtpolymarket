// Single source of truth for live blackjack sound effects — consumed by both
// in-game playback (app/composables/live-blackjack-sound.ts) and the generation
// script (scripts/generate-live-blackjack-sounds.ts).
//
// Every event owns a folder public/live-blackjack/sound/<event>/ holding
// numbered variants 1.wav .. LB_SOUND_VARIANTS.wav — playback picks one at
// random so a five-card draw doesn't sound like one sample on repeat. Missing
// variants are skipped gracefully, so the table stays silent rather than
// broken until the clips are generated.
//
// `prompt`, `trim` and `cut` are generation-time only. `cut` picks how the
// one-shot is extracted: 'peak' anchors on the loudest transient (right for
// card snaps and chip clacks), 'onset' anchors on the first audible sample
// (right for shuffles and jingles whose loudest moment lands mid-phrase).

export type LbSoundEvent =
    | 'card-deal'
    | 'card-flip'
    | 'shuffle'
    | 'chip-place'
    | 'chip-undo'
    | 'chip-payout'
    | 'chip-collect'
    | 'win'
    | 'blackjack'
    | 'lose'
    | 'push'
    | 'bust'
    | 'turn-start'
    | 'timer-warning'
    | 'button-press'
    | 'player-join'

export interface LbSoundSpec {
    /** Text prompt sent to the sound-effects model. */
    prompt: string
    /** Seconds of audio kept in the final one-shot. */
    trim: number
    /** How the one-shot is anchored inside the generated clip (default 'peak'). */
    cut?: 'peak' | 'onset' | 'energy'
}

/** Variants generated (and considered by playback) per event. */
export const LB_SOUND_VARIANTS = 3

export const LB_SOUND_MANIFEST: Record<LbSoundEvent, LbSoundSpec> = {
    'card-deal': {
        prompt: 'Single playing card sliding out of a dealing shoe and skidding onto green baize, crisp short paper whisk with a soft landing tap, close-miked casino table, dry and clean, no music',
        trim: 0.34
    },
    'card-flip': {
        prompt: 'Single playing card being turned face up on a felt table, quick cardboard snap and flick, close-miked, dry, no music',
        trim: 0.3
    },
    // Terse on purpose. Every descriptive variant of this prompt came back as
    // a few isolated snaps in a field of silence; the short one is the only
    // phrasing that renders at full scale.
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
    'blackjack': {
        prompt: 'Triumphant short fanfare for hitting a natural blackjack, bright ascending sparkle with warm bell chimes and a satisfying golden shimmer tail, celebratory casino game jingle',
        trim: 1.7,
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
    'bust': {
        prompt: 'Short deflating bust sound for going over twenty-one, low descending buzz with a dull thud, dry and clipped, casino game cue, not comedic',
        trim: 0.75,
        cut: 'onset'
    },
    'turn-start': {
        prompt: 'Soft single notification ping marking a player turn beginning, warm clean bell with a short bloom, quiet and polite, casino game interface cue',
        trim: 0.55,
        cut: 'onset'
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
    }
}

/**
 * Per-event mix level. Card and chip sounds fire constantly and sit low;
 * outcome jingles are the only things allowed to be prominent.
 */
export const LB_SOUND_LEVELS: Record<LbSoundEvent, number> = {
    'card-deal': 0.3,
    'card-flip': 0.32,
    'shuffle': 0.4,
    'chip-place': 0.35,
    'chip-undo': 0.25,
    'chip-payout': 0.45,
    'chip-collect': 0.3,
    'win': 0.5,
    'blackjack': 0.6,
    'lose': 0.35,
    'push': 0.35,
    'bust': 0.45,
    'turn-start': 0.4,
    'timer-warning': 0.25,
    'button-press': 0.2,
    'player-join': 0.3
}

/**
 * Minimum ms between plays of the same event. Cards deal in a fast cascade, so
 * card-deal has to stay short enough to fire per card while still collapsing a
 * burst of state updates into one sound.
 */
export const LB_SOUND_COOLDOWNS: Record<LbSoundEvent, number> = {
    'card-deal': 90,
    'card-flip': 120,
    'shuffle': 1500,
    'chip-place': 60,
    'chip-undo': 60,
    'chip-payout': 400,
    'chip-collect': 400,
    'win': 600,
    'blackjack': 600,
    'lose': 600,
    'push': 600,
    'bust': 400,
    'turn-start': 400,
    'timer-warning': 700,
    'button-press': 50,
    'player-join': 400
}
