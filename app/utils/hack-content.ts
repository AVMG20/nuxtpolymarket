import type { HackRarity } from '#shared/utils/hack-config'

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
  mil_intel: 'Defense subcontractor, procurement documents, the kind of paperwork that tells you what the government\'s buying before anyone else knows. High value, high heat. Move fast, leave nothing behind.',
  gov_heist: 'A federal server farm, classified documents, and a security team that actually knows what they\'re doing. This is the real thing now. I don\'t send a squad in light on this one.',
  ai_theft: 'Two hundred gigs of proprietary model weights sitting in a misconfigured storage bucket at a company that should know better. Whoever trained that model spent millions. We take it for the price of a data transfer.',
  central_bank: 'Ten hours, sitting quietly on SWIFT traffic out of a central bank... No smash and grab here — just patience, and the kind of intelligence that\'s worth more than the cash we\'ll skim off it.',
  black_site: '[grim] There\'s a facility that doesn\'t officially exist, running AI research that officially doesn\'t happen either. We\'re going in anyway. If this goes sideways, nobody\'s coming to explain it to the press.',
  nsa_breach: 'Fort Meade. I\'m going to say that again so it sinks in... Fort Meade. We\'re not hacking a company anymore — we\'re hacking the people who taught everyone else how to hack. If your squad isn\'t ready, don\'t send them.',
  ghost_protocol: 'Sovereign-level cyber fortress — that\'s diplomatic language for \'a nation-state built this to be unbreakable.\' Ghost Protocol means exactly what it sounds like: you\'re not there, you were never there, and if this goes wrong, I never heard of you.',
  quantum_heist: 'Somebody\'s quantum processor, hijacked for about six hours, cracking encryption that\'s supposed to be unbreakable for the next fifty years. We might be looking at the last heist of its kind before this stuff becomes standard. Make it count.',
  project_zero: 'Project Zero. I\'ve been doing this a long time, and I\'ve never sent a full squad after something like this — a nation-state AI system, zero-day access, persistent. [quiet] Whatever happens after tonight... the board looks different. Everyone goes. No exceptions.'
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
