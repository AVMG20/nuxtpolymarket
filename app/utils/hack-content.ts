import { AGENT_TRAIT_RANGES, type AgentClass, type AgentTrait, type AgentTraitType, type HackRarity } from '#shared/utils/hack-config'

// RELAY's approved narrative copy for the Ops screens, sourced verbatim from
// docs/games/hackops-redesign/content/mission-briefings.md and voice-lines.md.
// Presentational only — mechanics/pricing/tiers stay in shared/utils/hack-config.ts;
// tier is a client-side label derived from the 5 comment-delimited groups in
// OP_TEMPLATES, not a real field (PLAN.md §11.4).
//
// All actual voice-line text/filenames/variants (including missionVoice/
// missionBriefing, auto-imported the same way as everything in this file)
// live in hack-voice-lines.ts — the single source of truth for both
// playback and ElevenLabs generation (scripts/generate-hack-voice-lines.ts).

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

// Filename convention matches hack-image-prompts.ts's buildImageManifest()
// (op id's underscores become hyphens). Not every mission has a generated
// thumbnail yet — callers should fall back to the mission icon on 404.
export function missionThumbnail(id: string): string {
  return `/hack/img/mission/${id.replace(/_/g, '-')}.jpg`
}

// ─── Black Market — Contacts (agent pulls) & Dead Drops (item crates) ─────────
// Seller identity/portrait only — the actual intro/confirm voice lines live
// in hack-voice-lines.ts alongside every other VO line.
export interface MarketSeller { handle: string, portrait: string }

export const AGENT_PULL_CONTACT: Record<string, MarketSeller> = {
  basic: { handle: '>_ghostwire', portrait: '/hack/img/contact/ghostwire.jpg' },
  advanced: { handle: 'The Registry', portrait: '/hack/img/contact/registry.jpg' },
  elite: { handle: 'unknown — "the old man"', portrait: '/hack/img/contact/old-man.jpg' }
}

export const ITEM_PULL_SELLER: Record<string, MarketSeller> = {
  junk: { handle: 'Marsh', portrait: '/hack/img/contact/marsh.jpg' },
  standard: { handle: 'Denny\'s Surplus', portrait: '/hack/img/contact/dennys.jpg' },
  premium: { handle: 'Cutter', portrait: '/hack/img/contact/cutter.jpg' },
  ghost_cache: { handle: 'unknown', portrait: '/hack/img/contact/unknown-seller.jpg' }
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

// Agent sigil icons — a name maps deterministically to one emblem, tinted per
// rarity by an SVG duotone (HackAgentAvatar + HackRarityDuotone). Two tiers:
// ghost/operative/specialist share the common pool; elite/phantom draw fancier
// crests so higher rarities feel more special. Pools can grow over time; a name
// always resolves to the same icon within whichever pool its rarity uses.
export const AGENT_ICON_COMMON = [
  'wraith', 'dagger', 'cipher', 'sigil', 'mask', 'fox', 'hammer', 'skull',
  'viper', 'raven', 'neural', 'padlock', 'knight', 'crown', 'bolt', 'hydra'
]
export const AGENT_ICON_ELITE = ['phoenix', 'dragon', 'seraph', 'warcrown', 'kraken', 'demon']

function hashName(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function agentIcon(name: string, rarity: HackRarity): string {
  const elite = rarity === 'elite' || rarity === 'phantom'
  const pool = elite ? AGENT_ICON_ELITE : AGENT_ICON_COMMON
  const dir = elite ? 'agent-icons-elite' : 'agent-icons'
  return `/hack/img/${dir}/${pool[hashName(name) % pool.length]}.png`
}
