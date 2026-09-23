// Spiñata Slots sound catalogue. Most effects are the game's own samples in
// public/slots/spinata/sound; a few moments that never had a sample (payline
// plucks, confetti poppers, fly-to-meter whooshes) are synthesized in
// app/utils/spinata-synth.ts. Playback, mixing and persistence live in
// app/composables/spinata-sound.ts.

export const SPINATA_SOUND_BASE = '/slots/spinata/sound'

export interface SpinataSample {
    /** File name without extension. */
    file: string
    /** Mix level relative to the effects volume. */
    level: number
    /** Minimum ms between two plays. */
    cooldown?: number
    /** Most copies ringing at once; a new play past the cap cuts the oldest. */
    cap?: number
}

export const SPINATA_SAMPLES = {
    // UI
    click: { file: 'sfx_generic_all_other_clicks', level: 0.45, cooldown: 40, cap: 2 },
    press: { file: 'Press', level: 0.5, cooldown: 40, cap: 2 },
    spinButton: { file: 'play_button_v1', level: 0.42, cooldown: 80, cap: 1 },
    betChange: { file: 'sfx_generic_click_coin', level: 0.34, cooldown: 60, cap: 2 },
    betMax: { file: 'sfx_generic_bet_max', level: 0.5, cooldown: 200, cap: 1 },
    buyFeature: { file: 'sfx_buy_feature_click', level: 0.55, cooldown: 200, cap: 1 },
    notEnough: { file: 'sfx_notEnoughCredits', level: 0.55, cooldown: 400, cap: 1 },
    balance: { file: 'sfx_BalanceUpdate', level: 0.3, cooldown: 600, cap: 1 },

    // Reels
    spinStart: { file: 'sfx_generic_start_spin', level: 0.5, cooldown: 80, cap: 1 },
    reelSpin: { file: 'sp_sfx_reel_spin', level: 0.26, cap: 1 },
    reelStop: { file: 'sp_sfx_reel_stop', level: 0.55, cooldown: 25, cap: 5 },
    scatterStop1: { file: 'sp_sfx_scatter_stop_1', level: 0.6, cap: 1 },
    scatterStop2: { file: 'sp_sfx_scatter_stop_2', level: 0.62, cap: 1 },
    scatterStop3: { file: 'sp_sfx_scatter_stop_3', level: 0.66, cap: 1 },
    scatterStop4: { file: 'sp_sfx_scatter_stop_4', level: 0.68, cap: 1 },
    scatterStop5: { file: 'sp_sfx_scatter_stop_5', level: 0.7, cap: 1 },
    bonusLand: { file: 'sp_sfx_bonus_symbol', level: 0.5, cooldown: 60, cap: 2 },
    wildLand: { file: 'sp_sfx_wild', level: 0.42, cooldown: 120, cap: 1 },
    anticipation: { file: 'sp_sfx_anticipation', level: 0.4, cap: 1 },

    // Wins
    winLow: { file: 'sp_sfx_low_symbol_win', level: 0.42, cooldown: 120, cap: 1 },
    winMid: { file: 'sp_sfx_medium_symbol_win', level: 0.48, cooldown: 120, cap: 1 },
    maracas: { file: 'sp_sfx_maracas', level: 0.5, cooldown: 200, cap: 1 },
    accordion: { file: 'sp_sfx_accordion', level: 0.5, cooldown: 200, cap: 1 },
    ukulele: { file: 'sp_sfx_uculele', level: 0.5, cooldown: 200, cap: 1 },
    cocktail: { file: 'sp_sfx_cocktail', level: 0.45, cooldown: 200, cap: 1 },
    cheer: { file: 'sp_sfx_woman', level: 0.42, cooldown: 400, cap: 1 },
    scatterWin: { file: 'sp_sfx_scatter_win', level: 0.6, cooldown: 300, cap: 1 },
    meterCount: { file: 'sp_sfx_meter_count', level: 0.32, cooldown: 90, cap: 2 },
    counter: { file: 'generic_counter', level: 0.26, cap: 1 },
    bell: { file: 'sfx_bellRing', level: 0.36, cooldown: 120, cap: 2 },

    // Piñatas
    pinataBurst: { file: 'sp_sfx_particle_release', level: 0.5, cooldown: 70, cap: 3 },
    potFill: { file: 'sp_sfx_particle_release2_from_metercount', level: 0.46, cooldown: 90, cap: 2 },
    bonusPrize: { file: 'sp_sfx_bonus_stop', level: 0.6, cooldown: 400, cap: 1 },
    youWon: { file: 'sp_sfx_you_won_popup', level: 0.55, cooldown: 400, cap: 1 },

    // Free spins
    freeSpinsPopup: { file: 'sp_sfx_free_spins_popup', level: 0.6, cooldown: 400, cap: 1 },
    spinataVoice: { file: 'sp_sfx_spinata_spin_voice', level: 0.62, cooldown: 400, cap: 1 },
    totalWin: { file: 'sp_sfx_total_win_music', level: 0.5, cap: 1 },
    sorry: { file: 'sp_sfx_sorry_popup', level: 0.5, cap: 1 },

    // Big win tiers: transition sting, intro, loop and end per tier.
    intoBig: { file: 'sp_sfx_into_bigwin_transition', level: 0.6, cap: 1 },
    intoMega: { file: 'sp_sfx_into_megawin_transition', level: 0.62, cap: 1 },
    intoInsane: { file: 'sp_sfx_into_insanewin_transition', level: 0.66, cap: 1 },
    bigIntro: { file: 'sp_sfx_big_win_intro', level: 0.55, cap: 1 },
    bigLoop: { file: 'sp_sfx_big_win_loop', level: 0.5, cap: 1 },
    bigEnd: { file: 'sp_sfx_big_win_end', level: 0.55, cap: 1 },
    megaLoop: { file: 'sp_mega_win_loop', level: 0.52, cap: 1 },
    megaEnd: { file: 'sp_mega_win_end', level: 0.56, cap: 1 },
    insaneIntro: { file: 'sp_insane_win_intro', level: 0.58, cap: 1 },
    insaneLoop: { file: 'sp_insane_win_loop', level: 0.55, cap: 1 },
    insaneEnd: { file: 'sp_insane_win_end', level: 0.6, cap: 1 }
} as const satisfies Record<string, SpinataSample>

export type SpinataSampleName = keyof typeof SPINATA_SAMPLES

export const SPINATA_MUSIC = {
    main: `${SPINATA_SOUND_BASE}/sp_main_music.mp3`,
    free: `${SPINATA_SOUND_BASE}/sp_free_spins_music.mp3`
} as const

export type SpinataMusicTrack = keyof typeof SPINATA_MUSIC

/** Music sits under the effects: this is its level at 100% music volume. */
export const SPINATA_MUSIC_LEVEL = 0.42

/** Most effect voices (samples and synth) ringing at once. */
export const SPINATA_MAX_VOICES = 28

/** Synthesized moments that have no sample. */
export type SpinataSynthEvent = 'line' | 'pop' | 'whoosh' | 'sparkle' | 'thud'

export const SPINATA_SYNTH_LEVELS: Record<SpinataSynthEvent, number> = {
    line: 0.2,
    pop: 0.32,
    whoosh: 0.18,
    sparkle: 0.16,
    thud: 0.3
}

export const SPINATA_SYNTH_COOLDOWNS: Record<SpinataSynthEvent, number> = {
    line: 60,
    pop: 45,
    whoosh: 50,
    sparkle: 70,
    thud: 60
}

export const SPINATA_SYNTH_CAPS: Record<SpinataSynthEvent, number> = {
    line: 3,
    pop: 5,
    whoosh: 4,
    sparkle: 3,
    thud: 2
}
