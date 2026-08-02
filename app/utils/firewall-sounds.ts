// Single source of truth for FIREWALL sound effects — consumed by both
// in-game playback (app/composables/firewall-sound.ts) and the generation
// script (scripts/generate-firewall-sounds.ts).
//
// Every event owns a folder public/firewall/sound/<event>/ holding numbered
// variants 1.wav .. FIREWALL_SOUND_VARIANTS.wav — playback picks one at
// random so rapid repeats don't sound like a stuck sample.

export type FirewallSoundEvent =
  | 'shoot-rail'
  | 'shoot-flak'
  | 'shoot-arc'
  | 'shoot-missile'
  | 'shoot-sniper'
  | 'turret-gun'
  | 'turret-needler'
  | 'turret-warhead'
  | 'turret-lance'
  | 'ability-pulse'
  | 'ability-overclock'
  | 'weapon-reload'
  | 'weapon-swap'
  | 'hit-enemy'
  | 'enemy-death'
  | 'boss-spawn'
  | 'boss-death'
  | 'wall-hurt'
  | 'coin-pickup'
  | 'wave-start'
  | 'wave-win'
  | 'game-over'

export interface FirewallSoundSpec {
  /** Text prompt sent to the sound-effects model. */
  prompt: string
  /** Seconds of audio kept in the final one-shot. */
  trim: number
  /** How the one-shot is anchored inside the generated clip (default 'peak'). */
  cut?: 'peak' | 'onset'
}

/** Variants generated (and considered by playback) per event. */
export const FIREWALL_SOUND_VARIANTS = 4

export const FIREWALL_SOUND_MANIFEST: Record<FirewallSoundEvent, FirewallSoundSpec> = {
  'shoot-rail': {
    prompt: 'Single punchy sci-fi energy railgun shot, sharp electronic laser zap with a crisp decay, futuristic arcade weapon one-shot',
    trim: 0.35,
    cut: 'peak'
  },
  'shoot-flak': {
    prompt: 'Single heavy futuristic plasma shotgun blast, wide energetic scatter with a crunchy metallic impact, arcade video game weapon one-shot',
    trim: 0.5,
    cut: 'peak'
  },
  'shoot-arc': {
    prompt: 'Single high-voltage tesla electric arc discharge, crackling plasma shock zapping through air, sci-fi energy weapon',
    trim: 0.4,
    cut: 'peak'
  },
  'shoot-missile': {
    prompt: 'Single seeker missile launch, heavy whooshing rocket ignition with a low bass trail, sci-fi weapon one-shot',
    trim: 0.75,
    cut: 'peak'
  },
  'shoot-sniper': {
    prompt: 'Single massive high-caliber energy sniper rail shell firing, deep booming power shockwave with trailing metallic hiss, powerful weapon one-shot',
    trim: 0.8,
    cut: 'peak'
  },
  'turret-gun': {
    prompt: 'Single sentry turret automated energy pulse shot, tight rapid light laser burst, arcade game defense turret',
    trim: 0.25,
    cut: 'peak'
  },
  'turret-needler': {
    prompt: 'Single rapid plasma needle dart firing, sharp high-frequency electronic micro-zap',
    trim: 0.2,
    cut: 'peak'
  },
  'turret-warhead': {
    prompt: 'Single turret rocket pod launching, compact explosive mortar thud',
    trim: 0.6,
    cut: 'peak'
  },
  'turret-lance': {
    prompt: 'Single heavy defense rail lance laser discharge, intense focused energy beam hum and burst',
    trim: 0.7,
    cut: 'peak'
  },
  'ability-pulse': {
    prompt: 'Powerful EMP shockwave blast clearing the battlefield, deep resonant bass thrum with expanding energy sweep, sci-fi arcade ability',
    trim: 1.2,
    cut: 'onset'
  },
  'ability-overclock': {
    prompt: 'System overclock activation, surging high-tech electric power rise with bright energetic chime',
    trim: 0.9,
    cut: 'onset'
  },
  'weapon-reload': {
    prompt: 'High-tech weapon magazine ejection and lock-in, crisp mechanical metallic click with quick electronic servo hum',
    trim: 0.5,
    cut: 'onset'
  },
  'weapon-swap': {
    prompt: 'Sci-fi weapon switcher click, light synthetic tick and pitch rise',
    trim: 0.25,
    cut: 'onset'
  },
  'hit-enemy': {
    prompt: 'Bullet impact on cybernetic malware target, crisp energy crack hit marker one-shot',
    trim: 0.2,
    cut: 'peak'
  },
  'enemy-death': {
    prompt: 'Cybernetic malware unit exploding, energetic synth pop with sparkling digital glitch decay',
    trim: 0.45,
    cut: 'peak'
  },
  'boss-spawn': {
    prompt: 'Threat warning alarm in sci-fi mainframe, deep sinister horn synth swell, intimidating boss entry',
    trim: 1.5,
    cut: 'onset'
  },
  'boss-death': {
    prompt: 'Massive boss virus core destruction, multi-stage heavy explosion with falling energy pitch sweep',
    trim: 1.8,
    cut: 'onset'
  },
  'wall-hurt': {
    prompt: 'Cyber firewall barrier taking heavy damage, energetic glass impact crunch with low alarm glitch',
    trim: 0.5,
    cut: 'peak'
  },
  'coin-pickup': {
    prompt: 'Single site credit coin collected, bright digital pickup chime, rewarding electronic ding',
    trim: 0.3,
    cut: 'onset'
  },
  'wave-start': {
    prompt: 'Wave breach starting, energetic sci-fi system boot sweep and low action pulse',
    trim: 1.0,
    cut: 'onset'
  },
  'wave-win': {
    prompt: 'Wave successfully defended, bright victorious ascending synth jingle',
    trim: 1.3,
    cut: 'onset'
  },
  'game-over': {
    prompt: 'Firewall main core shutdown, tragic descending power failure pitch sweep with deep heavy thud',
    trim: 1.6,
    cut: 'onset'
  }
}

/** Per-event mix levels relative to the player's volume setting. */
export const FIREWALL_SOUND_LEVELS: Record<FirewallSoundEvent, number> = {
  'shoot-rail': 0.35,
  'shoot-flak': 0.65,
  'shoot-arc': 0.6,
  'shoot-missile': 0.75,
  'shoot-sniper': 0.85,
  'turret-gun': 0.45,
  'turret-needler': 0.35,
  'turret-warhead': 0.65,
  'turret-lance': 0.7,
  'ability-pulse': 0.85,
  'ability-overclock': 0.8,
  'weapon-reload': 0.55,
  'weapon-swap': 0.45,
  'hit-enemy': 0.45,
  'enemy-death': 0.55,
  'boss-spawn': 0.85,
  'boss-death': 0.9,
  'wall-hurt': 0.75,
  'coin-pickup': 0.45,
  'wave-start': 0.7,
  'wave-win': 0.8,
  'game-over': 0.85
}

/** Minimum ms between plays of the same event to prevent sound choking/stacking. */
export const FIREWALL_SOUND_COOLDOWNS: Record<FirewallSoundEvent, number> = {
  'shoot-rail': 60,
  'shoot-flak': 100,
  'shoot-arc': 80,
  'shoot-missile': 120,
  'shoot-sniper': 200,
  'turret-gun': 70,
  'turret-needler': 50,
  'turret-warhead': 150,
  'turret-lance': 150,
  'ability-pulse': 500,
  'ability-overclock': 500,
  'weapon-reload': 200,
  'weapon-swap': 100,
  'hit-enemy': 50,
  'enemy-death': 60,
  'boss-spawn': 1000,
  'boss-death': 1000,
  'wall-hurt': 150,
  'coin-pickup': 50,
  'wave-start': 1000,
  'wave-win': 1000,
  'game-over': 1000
}
