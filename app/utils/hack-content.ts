import { AGENT_TRAIT_RANGES, type AgentClass, type AgentTrait, type AgentTraitType, type HackRarity } from '#shared/utils/hack-config'

// RELAY's approved narrative copy for the Ops screens, sourced verbatim from
// docs/games/hackops-redesign/content/mission-briefings.md and voice-lines.md.
// Presentational only — mechanics/pricing/tiers stay in shared/utils/hack-config.ts;
// tier is a client-side label derived from the 5 comment-delimited groups in
// OP_TEMPLATES, not a real field (PLAN.md §11.4).

export const MISSION_TIER: Record<string, string> = {
  port_scan: 'Beginner', wifi_crack: 'Beginner', phishing_run: 'Beginner', corp_breach: 'Beginner',
  bank_skim: 'Early Mid', ransomware_drop: 'Early Mid', dark_web: 'Early Mid', crypto_heist: 'Early Mid',
  telecom_tap: 'Mid', supply_chain: 'Mid', mil_intel: 'Mid', gov_heist: 'Mid',
  ai_theft: 'Late Mid', central_bank: 'Late Mid', black_site: 'Late Mid',
  nsa_breach: 'Endgame', ghost_protocol: 'Endgame', quantum_heist: 'Endgame', project_zero: 'Endgame'
}

// Rarity-ladder color reused for the tier badge (Beginner=ghost … Endgame=phantom) —
// purely a visual echo of the same 5-step ladder, not a real rarity on the op.
export const MISSION_TIER_RARITY: Record<string, HackRarity> = {
  port_scan: 'ghost', wifi_crack: 'ghost', phishing_run: 'ghost', corp_breach: 'ghost',
  bank_skim: 'operative', ransomware_drop: 'operative', dark_web: 'operative', crypto_heist: 'operative',
  telecom_tap: 'specialist', supply_chain: 'specialist', mil_intel: 'specialist', gov_heist: 'specialist',
  ai_theft: 'elite', central_bank: 'elite', black_site: 'elite',
  nsa_breach: 'phantom', ghost_protocol: 'phantom', quantum_heist: 'phantom', project_zero: 'phantom'
}

// Safe accessors — tsconfig's noUncheckedIndexedAccess means a raw MISSION_TIER[id]
// lookup types as `string | undefined`, which can't index RARITY_COLOR downstream.
export function missionTier(id: string): string {
  return MISSION_TIER[id] ?? 'Beginner'
}
export function missionTierRarity(id: string): HackRarity {
  return MISSION_TIER_RARITY[id] ?? 'ghost'
}
export function missionVoice(id: string): string {
  return MISSION_VOICE[id] ?? ''
}
export function missionBriefing(id: string): string {
  return MISSION_BRIEFING[id] ?? ''
}

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

// Reused end-of-briefing line — plays once per session, not per mission.
export const BRIEF_OUTRO_VOICE = 'brief-outro-generic'
export const BRIEF_OUTRO_TEXT = 'Your call, Handler. Pick your people.'

// Collect-outcome barks (voice-lines.md). "Rare" success = a Specialist+ item dropped.
export const COLLECT_LINES = {
  successVoice: 'collect-success-1',
  successText: 'Clean job. Money\'s already moving.',
  successRareVoice: 'collect-success-rare',
  successRareText: 'Now THAT\'S a payday. Don\'t get used to it.',
  failureVoice: 'collect-failure',
  failureText: 'We lost this one. Everyone\'s alive, that\'s the part that matters.'
}

// ─── Black Market — Contacts (agent pulls) & Dead Drops (item crates) ─────────
// Sourced verbatim from content/crate-lore.md §"Recruit tiers"/"Item crates".
// Filenames follow the brief-{opId} precedent (real tier.id, not a display-name
// slug) — crate-lore.md doesn't pin these down itself, so this is the
// convention to keep using for any future market copy.

export interface MarketSeller { handle: string, portrait: string }

export const AGENT_PULL_CONTACT: Record<string, MarketSeller> = {
  basic: { handle: '>_ghostwire', portrait: '/hack/img/contact/ghostwire.jpg' },
  advanced: { handle: 'The Registry', portrait: '/hack/img/contact/registry.jpg' },
  elite: { handle: 'unknown — "the old man"', portrait: '/hack/img/contact/old-man.jpg' }
}
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

export const ITEM_PULL_SELLER: Record<string, MarketSeller> = {
  junk: { handle: 'Marsh', portrait: '/hack/img/contact/marsh.jpg' },
  standard: { handle: 'Denny\'s Surplus', portrait: '/hack/img/contact/dennys.jpg' },
  premium: { handle: 'Cutter', portrait: '/hack/img/contact/cutter.jpg' },
  ghost_cache: { handle: 'unknown', portrait: '/hack/img/contact/unknown-seller.jpg' }
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

// ─── Reveal-cinematic rarity barks — shared by every crate + recruit reveal ───
// content/agent-bios.md §2 / content/crate-lore.md "Shared reveal-cinematic
// barks". The agent lines below are the base table (crate-lore.md's own note
// says items should reuse Operative+ verbatim, only special-casing Ghost) —
// but that read wrong in practice past Ghost too: Phantom's "what THEY used
// to do before us" is unambiguously about a person's history, and hearing it
// after a gear pull was the reported bug. Diverging from the doc: every
// rarity now has an item-flavored variant, not just Ghost. Specialist's line
// ("Now we're talking") doesn't reference a person, so it's kept identical
// on purpose, not an oversight.
export const RARITY_BARK_VOICE: Record<HackRarity, string> = {
  ghost: 'bark-rarity-ghost-agent', operative: 'bark-rarity-operative', specialist: 'bark-rarity-specialist',
  elite: 'bark-rarity-elite', phantom: 'bark-rarity-phantom'
}
export const RARITY_BARK_TEXT: Record<HackRarity, string> = {
  ghost: 'Rookie. They\'ll do.',
  operative: 'Solid. I\'ve built jobs around worse.',
  specialist: 'Now we\'re talking.',
  elite: '...Huh. Didn\'t expect that out of this one.',
  phantom: '[flat] Don\'t ask what they used to do before us. I didn\'t, and I still don\'t sleep great.'
}

const RARITY_BARK_VOICE_ITEM: Partial<Record<HackRarity, string>> = {
  ghost: 'bark-rarity-ghost-item',
  operative: 'bark-rarity-operative-item',
  elite: 'bark-rarity-elite-item',
  phantom: 'bark-rarity-phantom-item'
}
const RARITY_BARK_TEXT_ITEM: Partial<Record<HackRarity, string>> = {
  ghost: 'Junk, mostly. Mostly.',
  operative: 'Solid pull. I\'ve built jobs around worse gear.',
  elite: '...Huh. Didn\'t expect that out of a crate like this.',
  phantom: 'Don\'t ask where this came from. I didn\'t, and I still don\'t sleep great.'
}

export function rarityBarkVoice(rarity: HackRarity, kind: 'agent' | 'item'): string {
  if (kind === 'item') return RARITY_BARK_VOICE_ITEM[rarity] ?? RARITY_BARK_VOICE[rarity]
  return RARITY_BARK_VOICE[rarity]
}
export function rarityBarkText(rarity: HackRarity, kind: 'agent' | 'item'): string {
  if (kind === 'item') return RARITY_BARK_TEXT_ITEM[rarity] ?? RARITY_BARK_TEXT[rarity]
  return RARITY_BARK_TEXT[rarity]
}

// ─── Agent bio composer (agent-bios.md §1) ─────────────────────────────────────
// One sentence assembled from class + rarity + the agent's own highest-value
// trait, so every procedurally generated agent reads as individually written
// without any bespoke per-agent content. Needs nothing beyond the fields
// already on a hackAgents row (class, rarity, traits).
const CLASS_OPENER: Record<AgentClass, string> = {
  infiltrator: 'Gets in before anyone knows there\'s a door.',
  cryptographer: 'Sees the pattern in the noise faster than the system that hid it.',
  social_engineer: 'Doesn\'t hack the network — hacks the person holding the badge.',
  bruteforce: 'Doesn\'t finesse a lock. Removes it.'
}
const RARITY_CLAUSE: Record<HackRarity, string> = {
  ghost: 'Green, but hungry.',
  operative: 'Field-tested, no complaints on file.',
  specialist: 'The kind of resume that gets flagged, then buried.',
  elite: 'Three agencies have a file open. None of them have a face.',
  phantom: 'Doesn\'t officially exist. Neither do the people who\'ve tried to stop them.'
}
const TRAIT_CLOSER: Record<AgentTraitType, string> = {
  gem_chance: 'Has a nose for the job that pays out in more than cash.',
  speed_percent: 'In and out before the coffee\'s cold.',
  loot_percent: 'Never leaves a job with less than what\'s on the table.',
  xp_boost: 'Learns faster than the last op should\'ve allowed.',
  power_flat: 'Overqualified for half the jobs on the board, and it shows.',
  power_percent: 'Overqualified for half the jobs on the board, and it shows.',
  gem_bonus: 'Somehow always finds the safe behind the safe.'
}

/** The agent's dominant trait — highest value relative to its own range, so a small
 * roll on a wide-range trait doesn't outrank a strong roll on a narrow one. */
function dominantTrait(traits: AgentTrait[]): AgentTrait | null {
  if (!traits.length) return null
  return [...traits].sort((a, b) => {
    const ra = AGENT_TRAIT_RANGES[a.type], rb = AGENT_TRAIT_RANGES[b.type]
    const pa = (a.value - ra.min) / (ra.max - ra.min)
    const pb = (b.value - rb.min) / (rb.max - rb.min)
    return pb - pa
  })[0]!
}

export function agentBioLine(agent: { class: AgentClass, rarity: HackRarity, traits?: AgentTrait[] }): string {
  const trait = dominantTrait(agent.traits ?? [])
  const parts = [CLASS_OPENER[agent.class], RARITY_CLAUSE[agent.rarity]]
  if (trait) parts.push(TRAIT_CLOSER[trait.type])
  return parts.join(' ')
}

// One base template photo per class (PLAN.md §12.4) — every agent of a given
// class shows the identical unmodified photo regardless of rarity for now; a
// rarity color-grade layer on top is a planned follow-up, not built yet.
export const CLASS_PORTRAIT: Record<AgentClass, string> = {
  infiltrator: '/hack/img/agent/infiltrator.jpg',
  cryptographer: '/hack/img/agent/cryptographer.jpg',
  social_engineer: '/hack/img/agent/social-engineer.jpg',
  bruteforce: '/hack/img/agent/bruteforce.jpg'
}
