import type { HackRarity } from '#shared/utils/hack-config'

// Single canonical source for every RELAY (and market-contact) VO line in
// HackOps — text, generation params, and the exact filename under
// public/hack/sound/voice/. Two consumers read this file:
//   1. The app, via the pick*/mission* helpers below, at playback time.
//   2. scripts/generate-hack-voice-lines.ts, via buildVoiceManifest(), which
//      diffs it against public/hack/sound/voice/ and generates whatever's
//      missing through ElevenLabs.
// Only #shared/utils/hack-config types are imported (never its values), so
// this file has zero runtime dependency on the Nuxt alias graph and can be
// imported directly by a standalone bun script.
//
// Bracket delivery tags ([grim], [quiet], [flat], ...) live inline in the
// text itself, same convention as mission-briefings.md — useAudio.ts strips
// them before rendering a caption. `speed` is the one thing that can't be a
// text tag (eleven_v3 has no <break>/rate control), so it's a separate field
// applied via the ElevenLabs generation request.

export interface VoiceVariant {
  text: string
  /** ElevenLabs generation `speed` (0.7-1.2) — a whole-line pacing shift. Rare; most lines omit it. */
  speed?: number
}

export interface VoiceEntry {
  /** Base id — variant files are named `${id}-1.mp3`, `${id}-2.mp3`, ... */
  id: string
  variants: VoiceVariant[]
}

export function voiceFile(entry: VoiceEntry, index: number): string {
  return `${entry.id}-${index + 1}`
}

// Remembers the last variant played per entry id so the same line never plays
// twice in a row — an immediate repeat is the single biggest thing that makes a
// small pool feel repetitive, far more than the pool size itself.
const lastVariantIndex = new Map<string, number>()

/** Random variant for playback — text and filename always come from the same picked index. */
export function pickVoiceLine(entry: VoiceEntry): { voice: string, text: string } {
  const n = entry.variants.length
  const last = lastVariantIndex.get(entry.id)
  let i: number
  if (n > 1 && last !== undefined) {
    // Uniform over the other n-1 variants: pick in [0, n-1) then skip past `last`.
    i = Math.floor(Math.random() * (n - 1))
    if (i >= last) i++
  } else {
    i = Math.floor(Math.random() * n)
  }
  lastVariantIndex.set(entry.id, i)
  return { voice: voiceFile(entry, i), text: entry.variants[i]!.text }
}

// ─── Mission briefings (mission-briefings.md) — one authored line per op,
// no variants: each only plays when that specific mission's briefing is
// opened, so it doesn't hit the same repetition problem as a general bark. ──

export const MISSION_VOICE: Record<string, string> = {
  port_scan: 'brief-port-scan', wifi_crack: 'brief-wifi-crack', phishing_run: 'brief-phishing-run', corp_breach: 'brief-corp-breach',
  bank_skim: 'brief-bank-skim', ransomware_drop: 'brief-ransomware-drop', dark_web: 'brief-dark-web', crypto_heist: 'brief-crypto-heist',
  telecom_tap: 'brief-telecom-tap', supply_chain: 'brief-supply-chain', mil_intel: 'brief-mil-intel', gov_heist: 'brief-gov-heist',
  ai_theft: 'brief-ai-theft', central_bank: 'brief-central-bank', black_site: 'brief-black-site',
  nsa_breach: 'brief-nsa-breach', ghost_protocol: 'brief-ghost-protocol', quantum_heist: 'brief-quantum-heist', project_zero: 'brief-project-zero'
}

export const MISSION_BRIEFING: Record<string, string> = {
  port_scan: 'Nice and easy for a first run. Some strip-mall business is sitting on a network nobody\'s patched since 2019. Poke around, see what ports answer back, don\'t touch anything that isn\'t yours yet. Consider it a warm-up.',
  wifi_crack: 'Coffee chain, one router, WPA2 that should\'ve been retired years ago. Crack it, sit on their bandwidth a while, see what\'s floating across it. Barely counts as work.',
  phishing_run: 'Fifty inboxes at a logistics company, one convincing email, and we own their credentials by lunch. People still click links, Handler. Every time.',
  corp_breach: 'Fortune 500 HR database — social security numbers, salaries, the works. Get in, get the credentials, get out clean. First real target on the board. Don\'t get comfortable.',
  bank_skim: 'Wire traffic between two regional banks, running mostly unencrypted where it shouldn\'t be. Sit on the line, skim what moves, and nobody notices a thing — assuming your people are as good as you say they are.',
  ransomware_drop: 'Regional hospital network, lousy backups, worse security. Drop the payload, lock what needs locking, and let me handle the ransom call. [grim] This one\'s going to test somebody\'s stomach.',
  dark_web: 'Anonymous buyer, anonymous drop point, credentials nobody asks where you got. Deliver clean, get paid in something that doesn\'t trace. Standard dead-drop rules apply — don\'t be curious about the client.',
  crypto_heist: 'Found a race condition in a decentralized exchange\'s contract — window\'s maybe ninety seconds before someone patches it. Drain the hot wallet, get out before the block confirms. Small window, big payday.',
  telecom_tap: 'We\'re splicing into backbone fibre between two national exchanges. This is real infrastructure, real stakes — carrier-grade security on the other end. I need a full team on this, not a solo run.',
  supply_chain: 'A popular npm package, millions of downloads, and a CI/CD pipeline held together with an expired API key. Slip a backdoor into the next release and half the internet ships it for us. Elegant, if it works.',
  mil_intel: 'We\'ve been hearing chatter. Troop movements, shipments, something big the government\'s not talking about publicly. A buyer reached out — serious money, serious connections. They want to know what the government\'s buying, what they\'re planning. The kind of intel that gets traded in rooms you don\'t go to. Defense subcontractor has the procurement docs — everything ordered, everything planned. Get in, get the files, get out clean. This one pays well if we don\'t screw it up.',
  gov_heist: 'The mil-intel job opened doors. Word got out we can move classified material. Now we\'ve got an offer from someone very serious — government connections, foreign money, or both. They want classified documents from a federal server farm. Not procurement. Actual intelligence. The kind of job that ends careers or starts wars. But the money... let\'s just say it changes everything. Security\'s going to be tight, but we\'ve got the skills. We just need to not get caught.',
  ai_theft: 'There\'s a company that built something nobody else has — an AI system that works. Real cutting-edge stuff. A buyer approached us, someone in the intelligence community, maybe a hedge fund, maybe a foreign actor. They want the model. Not to use it — to reverse-engineer it, understand how it works, sell it to the highest bidder. The weights are sitting in cloud storage, protected but not well. Get in, copy it all, get out. Twenty gigs of pure IP that cost millions to build. We move it and the buyer handles the rest. Our cut is enough to retire on.',
  central_bank: 'A buyer wants SWIFT traffic data from a central bank. Not the money moving through it — the patterns. Who sends money where, when, how much. The corridors of global finance laid bare. With that, you predict economic moves before they happen, or blackmail the people making them. We splice the line for ten hours, just sitting there, listening. Security won\'t even know we\'re here if we do this right. [quiet] Ten hours of patience, and we walk away with data worth more than any cash transfer. This is the information that changes markets.',
  black_site: '[grim] We\'ve been monitoring dark-web chatter for months. There\'s a black site somewhere — not on any map, not on satellite. But we\'ve got coordinates from a source that hasn\'t failed us yet. The government\'s running AI research there, research that breaks international law. A buyer wants proof it exists — documents, data, anything. If we get in and out with it, the money is enough to disappear to a country without extradition. But if we get caught, we don\'t get arrested. We just... don\'t come back. This is the one where we might not walk out.',
  nsa_breach: 'Fort Meade. I\'m going to say that again so it sinks in... Fort Meade. We\'re not hacking a company anymore — we\'re hacking the people who taught everyone else how to hack. A buyer, someone with more resources than most governments, wants NSA access. Not to steal data. To plant something. We get in, we give them a doorway, they take it from there. Fort Meade is defended like nothing else on Earth. Their security people wrote the book on network defense. But we\'ve got zero-days, exploits, people who\'ve been waiting their whole lives for this shot. This doesn\'t fail. Because if it does, the people who sent us in make us disappear. If your squad isn\'t ready, don\'t send them.',
  ghost_protocol: 'A foreign government wants us to crack a rival nation\'s cyber infrastructure. The kind of thing that starts wars. They\'ve built a fortress — network security designed by military strategists, encrypted with methods we don\'t have names for. But they need access, and they need it to look like someone else did it. We\'re the deniable option. If we succeed, we\'ve changed the balance of power between two countries. If we fail, nobody ever heard of us. The money comes through channels that don\'t exist officially. You don\'t talk about this job. You don\'t acknowledge it happened. You take the money, you disappear into the world, and you wait for the news headlines that show you what you actually did.',
  quantum_heist: 'A quantum computer just came online. First time. The research team thinks they\'re running isolated tests. But we\'re in. We hijack the processor for six hours — not steal it, just borrow it. Long enough to crack something that\'s supposed to be unbreakable for fifty years. The buyer wants proof that quantum computers can be weaponized in ways governments haven\'t admitted. We give them six hours of cryptographic evidence, they run with it. By the time the research team realizes what happened, the information\'s already out there. This job changes cyber warfare forever. And if we pull it off, we\'ve just changed the game.',
  project_zero: 'Project Zero. I\'ve been doing this a long time, and I\'ve never sent a full squad after something like this — a nation-state AI system, zero-day access, persistent. They say it coordinates military operations, predicts instability, guides weapons systems. A coalition of buyers put together the largest pool of money we\'ve ever seen. We don\'t know who they are. We don\'t want to know. They want control of Project Zero. Not steal it. Run it themselves. We crack it, give them the keys, then we disappear. [quiet] Everyone on this squad has already decided — after tonight, we\'re gone. Either rich and gone, or just gone. There\'s no middle ground. This is the one where even I\'m scared. But we\'ve come too far to stop now.'
}

// Whole-line pacing shift via the ElevenLabs `speed` generation param
// (PLAN.md / mission-briefings.md delivery notes) — not expressible as a
// text tag, so it lives here instead of inline in MISSION_BRIEFING.
export const MISSION_SPEED: Partial<Record<string, number>> = {
  crypto_heist: 1.1,
  central_bank: 0.9
}

export function missionVoice(id: string): string {
  return MISSION_VOICE[id] ?? ''
}
export function missionBriefing(id: string): string {
  return MISSION_BRIEFING[id] ?? ''
}

// ─── Reused end-of-briefing line — plays once per session, not per mission. ──
export const BRIEF_OUTRO: VoiceEntry = {
  id: 'brief-outro-generic',
  variants: [
    { text: 'Your call, Handler. Pick your people.' },
    { text: 'Squad\'s yours to build. Choose carefully.' },
    { text: 'Your people, your call. Don\'t waste the good ones.' }
  ]
}

// ─── Deploy — not wired into the UI yet, generated ahead of that work. ───────
export const DEPLOY_CONFIRM: VoiceEntry = {
  id: 'deploy-confirm',
  variants: [
    { text: 'They\'re moving. I\'ll let you know.' },
    { text: 'Squad\'s out the door. Sit tight.' },
    { text: 'They\'re in motion. I\'ll ping you when it matters.' }
  ]
}

// ─── Collect-outcome barks — live in app/pages/hack/index.vue. "Rare"
// success = a Specialist+ item dropped. ──────────────────────────────────────
export const COLLECT_SUCCESS: VoiceEntry = {
  id: 'collect-success',
  variants: [
    { text: 'Clean job. Money\'s already moving.' },
    { text: 'No surprises. That\'s how I like it.' },
    { text: 'In, out, paid. Textbook.' }
  ]
}
export const COLLECT_SUCCESS_RARE: VoiceEntry = {
  id: 'collect-success-rare',
  variants: [
    { text: 'Now THAT\'S a payday. Don\'t get used to it.' },
    { text: '...Well look at that. Don\'t spend it all in one place.' },
    { text: 'That\'s a number I like seeing. Enjoy it while it lasts.' }
  ]
}
export const COLLECT_FAILURE: VoiceEntry = {
  id: 'collect-failure',
  variants: [
    { text: 'We lost this one. Everyone\'s alive, that\'s the part that matters.' },
    { text: 'Didn\'t land. Nobody\'s hurt — we chalk it up and move on.' },
    { text: 'That one\'s a wash. Happens. Shake it off.' }
  ]
}
export const COLLECT_FAILURE_ROUGH: VoiceEntry = {
  id: 'collect-failure-rough',
  variants: [
    { text: 'Rough night. They\'ll shake it off.' },
    { text: 'Took some bruises on that one. They\'ll live.' },
    { text: 'Not our finest hour. They\'ll be fine by morning.' }
  ]
}

// ─── General barks — voice-lines.md "Voice — RELAY, general barks". Not
// wired into any UI yet (agents/loadout redesign is in progress); the data
// is authored ahead of that work so generation isn't blocking it later. ─────
export const AGENT_LEVELUP: VoiceEntry = {
  id: 'agent-levelup',
  variants: [
    { text: 'They\'re getting better. Good — they\'ll need to be.' },
    { text: 'Sharper than last week. Keep pushing them.' },
    { text: 'They\'re learning fast. I like that in a person.' }
  ]
}
export const AGENT_MAX_LEVEL_BARK: VoiceEntry = {
  id: 'agent-max-level',
  variants: [
    { text: 'That\'s as sharp as they get. Time to gear them up instead.' },
    { text: 'They\'ve hit their ceiling. Gear\'s the next lever to pull.' },
    { text: 'Nothing left to teach them. Better start arming them properly.' }
  ]
}
export const ROSTER_EXPAND: VoiceEntry = {
  id: 'roster-expand',
  variants: [
    { text: 'New seat at the table. Fill it wisely.' },
    { text: 'Room for one more. Don\'t waste it on a maybe.' },
    { text: 'Table just got bigger. Choose who sits at it.' }
  ]
}
export const AGENT_FIRED: VoiceEntry = {
  id: 'agent-fired',
  variants: [
    { text: 'Done. Didn\'t expect that one to last, honestly.' },
    { text: 'Cut loose. No hard feelings — probably.' },
    { text: 'Off the roster. I\'ll handle the paperwork, such as it is.' }
  ]
}
export const AGENT_ACTIVATE: VoiceEntry = {
  id: 'agent-activate',
  variants: [
    { text: 'Waking them up.' },
    { text: 'Pulling them back in.' },
    { text: 'They\'re back on the clock.' }
  ]
}
export const AGENT_DEACTIVATE: VoiceEntry = {
  id: 'agent-deactivate',
  variants: [
    { text: 'They\'ll get some rest.' },
    { text: 'Standing them down for now.' },
    { text: 'Off the clock. They earned it.' }
  ]
}
export const CRAFT_UPGRADE: VoiceEntry = {
  id: 'craft-upgrade',
  variants: [
    { text: 'Sharper. Costs gems, not miracles.' },
    { text: 'Better than it was. Gems well spent.' },
    { text: 'Upgraded. Wish everything improved that easily.' }
  ]
}
export const CRAFT_REROLL_GOOD: VoiceEntry = {
  id: 'craft-reroll-good',
  variants: [
    { text: 'That\'s better than what you had.' },
    { text: 'Nice. That\'s an upgrade, not a lateral move.' },
    { text: 'Better roll. I\'ll take it.' }
  ]
}
export const CRAFT_REROLL_BAD: VoiceEntry = {
  id: 'craft-reroll-bad',
  variants: [
    { text: '...Well. You paid for the roll, not the outcome.' },
    { text: '...That\'s worse. Gambling\'s gambling.' },
    { text: 'Not the direction we wanted. House always has an edge.' }
  ]
}
export const LOADOUT_SWAP: VoiceEntry = {
  id: 'loadout-swap',
  variants: [
    { text: 'Suits them.' },
    { text: 'Good fit. Looks natural on them.' },
    { text: 'That works better for the job ahead.' }
  ]
}
export const LOADOUT_UNEQUIP: VoiceEntry = {
  id: 'loadout-unequip',
  variants: [
    { text: 'Stripping it back down.' },
    { text: 'Pulling that back off them.' },
    { text: 'Back in the vault it goes.' }
  ]
}
export const DEPLOY_BLOCKED_POWER: VoiceEntry = {
  id: 'deploy-blocked-power',
  variants: [
    { text: 'Not with this squad. You\'ll get them killed — or worse, caught.' },
    { text: 'They\'re not ready for that. I\'m not sending them in underpowered.' },
    { text: 'Too light for this one. Gear up or pick someone else.' }
  ]
}
export const INSUFFICIENT_FUNDS: VoiceEntry = {
  id: 'insufficient-funds',
  variants: [
    { text: 'You\'re short. Come back when the number\'s real.' },
    { text: 'Not enough in the account. Try again when it clears.' },
    { text: 'You don\'t have that. Yet.' }
  ]
}
export const LEADERBOARD_TOP3: VoiceEntry = {
  id: 'leaderboard-top3',
  variants: [
    { text: 'People are starting to notice your work. Careful what that attracts.' },
    { text: 'You\'re on people\'s radar now. That cuts both ways.' },
    { text: 'Top of the board draws eyes you don\'t want. Stay sharp.' }
  ]
}

// One-shot, plays exactly once per account ever — no repetition problem, no variants.
export const ONBOARDING_INTRO: VoiceEntry = {
  id: 'onboarding-intro',
  variants: [
    { text: 'New operation, huh? Let\'s see what you\'ve got to work with. I\'m RELAY — I run logistics. You make the calls, I make them happen.' }
  ]
}

// ─── Black Market — Contacts (agent pulls) & Dead Drops (item crates) ────────
// crate-lore.md. Seller-specific narrative, not a repeated bark — one variant
// each, same as mission briefings.

export const AGENT_PULL_INTRO_VOICE: Record<string, string> = {
  basic: 'market-basic-intro', advanced: 'market-advanced-intro', elite: 'market-elite-intro'
}
export const AGENT_PULL_INTRO_TEXT: Record<string, string> = {
  basic: 'Forum talent. Cheap, plentiful, mostly rookies — but rookies still show up. Every specialist on your roster was a rookie once. Probably not the way to bet your whole operation, but a fine way to build one.',
  advanced: 'The Registry doesn\'t deal in rookies. Everyone on their books has done this before, for someone, somewhere. Costs more because you\'re not gambling on potential — you\'re paying for a track record.',
  elite: '[quiet] I\'m calling in a favor I\'ve been saving. Whoever comes back from this isn\'t auditioning — they\'re already the best in the business, and they know it. Don\'t waste them on the easy jobs.'
}
export const AGENT_PULL_CONFIRM_VOICE: Record<string, string> = {
  basic: 'market-basic-confirm', advanced: 'market-advanced-confirm', elite: 'market-elite-confirm'
}
export const AGENT_PULL_CONFIRM_TEXT: Record<string, string> = {
  basic: 'Posting the job. Give it a minute.',
  advanced: 'Registry\'s running the vetting now. They\'re thorough. That\'s the point.',
  elite: 'Made the call. Now we wait... and we don\'t ask what it cost me.'
}

export const ITEM_PULL_INTRO_VOICE: Record<string, string> = {
  junk: 'market-junk-intro', standard: 'market-standard-intro', premium: 'market-premium-intro', ghost_cache: 'market-ghost_cache-intro'
}
export const ITEM_PULL_INTRO_TEXT: Record<string, string> = {
  junk: 'Marsh found this in a storage unit and has no idea what he\'s holding. Might be nothing. Might be something nobody\'s noticed yet. That\'s the whole pitch on a Junk Cache — you\'re buying the maybe.',
  standard: 'Denny doesn\'t deal in mysteries. What\'s in the crate is what he says is in the crate, roughly — decent gear, no big surprises either way. Predictable is worth something.',
  premium: 'Cutter used to be one of us, a long time ago. This is their retirement fund, sold off a piece at a time. Whatever\'s still in their cache is field-grade — they never held onto anything that wasn\'t.',
  ghost_cache: 'I don\'t know who\'s selling this and I stopped asking after the second one. Whoever it is doesn\'t need cash — they need this off their hands, fast, quiet. Everything I\'ve seen come out of a Ghost Cache has been worth exactly what it should be worth. Draw your own conclusions.'
}
export const ITEM_PULL_CONFIRM_VOICE: Record<string, string> = {
  junk: 'market-junk-confirm', standard: 'market-standard-confirm', premium: 'market-premium-confirm', ghost_cache: 'market-ghost_cache-confirm'
}
export const ITEM_PULL_CONFIRM_TEXT: Record<string, string> = {
  junk: 'Paying Marsh before he changes his mind. Or finds someone else.',
  standard: 'Denny\'s got it wrapped and ready. He always does.',
  premium: 'Cutter said this is the last one for a while. Might want to take it.',
  ghost_cache: 'Funds are moving. However this crate got here, it\'s yours now.'
}

// ─── Reveal-cinematic rarity barks — shared by every crate + recruit reveal ──
// (agent-bios.md §2 / crate-lore.md). Every rarity has an item-flavored
// variant (not just Ghost — Elite/Phantom's agent lines read wrong on gear
// too, see the note this repo already carries in hack-content.ts); Specialist
// is the one rarity that reads fine for both, so it's shared on purpose.
export const RARITY_BARK: Record<HackRarity, VoiceEntry> = {
  ghost: {
    id: 'bark-rarity-ghost-agent',
    variants: [
      { text: 'Rookie. They\'ll do.' },
      { text: 'Green. Every roster needs a few.' },
      { text: 'Not much yet. Give them time.' }
    ]
  },
  operative: {
    id: 'bark-rarity-operative',
    variants: [
      { text: 'Solid. I\'ve built jobs around worse.' },
      { text: 'Dependable. That\'s worth more than flashy.' },
      { text: 'Good bones. I can work with this.' }
    ]
  },
  specialist: {
    id: 'bark-rarity-specialist',
    variants: [
      { text: 'Now we\'re talking.' },
      { text: 'That\'s a real pull.' },
      { text: '...Now that\'s worth the price.' }
    ]
  },
  elite: {
    id: 'bark-rarity-elite',
    variants: [
      { text: '...Huh. Didn\'t expect that out of this one.' },
      { text: 'That\'s better than the odds said it\'d be.' },
      { text: 'Now THAT\'S a name worth having on the roster.' }
    ]
  },
  phantom: {
    id: 'bark-rarity-phantom',
    variants: [
      { text: '[flat] Don\'t ask what they used to do before us. I didn\'t, and I still don\'t sleep great.' },
      { text: '[quiet] Whoever vetted this one undersold them. By a lot.' },
      { text: '[flat] I\'ve seen the file. I wish I hadn\'t.' }
    ]
  }
}

export const RARITY_BARK_ITEM: Partial<Record<HackRarity, VoiceEntry>> = {
  ghost: {
    id: 'bark-rarity-ghost-item',
    variants: [
      { text: 'Junk, mostly. Mostly.' },
      { text: 'Not much here. Might scrap it.' },
      { text: 'Bottom of the barrel. Every barrel has one.' }
    ]
  },
  operative: {
    id: 'bark-rarity-operative-item',
    variants: [
      { text: 'Solid pull. I\'ve built jobs around worse gear.' },
      { text: 'Decent kit. Nothing to complain about.' },
      { text: 'That\'ll hold up in the field.' }
    ]
  },
  elite: {
    id: 'bark-rarity-elite-item',
    variants: [
      { text: '...Huh. Didn\'t expect that out of a crate like this.' },
      { text: 'That\'s above what that crate usually pays out.' },
      { text: 'Now that\'s a piece worth keeping.' }
    ]
  },
  phantom: {
    id: 'bark-rarity-phantom-item',
    variants: [
      { text: 'Don\'t ask where this came from. I didn\'t, and I still don\'t sleep great.' },
      { text: '[quiet] I don\'t know what this is rated for. I don\'t think I want to.' },
      { text: 'That\'s not standard-issue anything. Handle it carefully.' }
    ]
  }
}

export function pickRarityBark(rarity: HackRarity, kind: 'agent' | 'item'): { voice: string, text: string } {
  const entry = (kind === 'item' ? RARITY_BARK_ITEM[rarity] : undefined) ?? RARITY_BARK[rarity]
  return pickVoiceLine(entry)
}

// ─── Generation manifest — every audio file that should exist under
// public/hack/sound/voice/, consumed by scripts/generate-hack-voice-lines.ts. ─

export interface VoiceLineSpec {
  file: string
  text: string
  speed?: number
}

const GENERAL_BARK_ENTRIES: VoiceEntry[] = [
  BRIEF_OUTRO, DEPLOY_CONFIRM,
  COLLECT_SUCCESS, COLLECT_SUCCESS_RARE, COLLECT_FAILURE, COLLECT_FAILURE_ROUGH,
  AGENT_LEVELUP, AGENT_MAX_LEVEL_BARK, ROSTER_EXPAND, AGENT_FIRED, AGENT_ACTIVATE, AGENT_DEACTIVATE,
  CRAFT_UPGRADE, CRAFT_REROLL_GOOD, CRAFT_REROLL_BAD,
  LOADOUT_SWAP, LOADOUT_UNEQUIP, DEPLOY_BLOCKED_POWER, INSUFFICIENT_FUNDS, LEADERBOARD_TOP3,
  ONBOARDING_INTRO,
  ...Object.values(RARITY_BARK), ...Object.values(RARITY_BARK_ITEM).filter((e): e is VoiceEntry => !!e)
]

export function buildVoiceManifest(): VoiceLineSpec[] {
  const specs: VoiceLineSpec[] = []

  for (const [id, file] of Object.entries(MISSION_VOICE)) {
    specs.push({ file, text: MISSION_BRIEFING[id] ?? '', speed: MISSION_SPEED[id] })
  }
  for (const [tier, file] of Object.entries(AGENT_PULL_INTRO_VOICE)) {
    specs.push({ file, text: AGENT_PULL_INTRO_TEXT[tier] ?? '' })
  }
  for (const [tier, file] of Object.entries(AGENT_PULL_CONFIRM_VOICE)) {
    specs.push({ file, text: AGENT_PULL_CONFIRM_TEXT[tier] ?? '' })
  }
  for (const [tier, file] of Object.entries(ITEM_PULL_INTRO_VOICE)) {
    specs.push({ file, text: ITEM_PULL_INTRO_TEXT[tier] ?? '' })
  }
  for (const [tier, file] of Object.entries(ITEM_PULL_CONFIRM_VOICE)) {
    specs.push({ file, text: ITEM_PULL_CONFIRM_TEXT[tier] ?? '' })
  }
  for (const entry of GENERAL_BARK_ENTRIES) {
    entry.variants.forEach((variant, i) => {
      specs.push({ file: voiceFile(entry, i), text: variant.text, speed: variant.speed })
    })
  }

  return specs
}
