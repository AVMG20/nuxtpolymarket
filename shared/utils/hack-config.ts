export type HackRarity = 'ghost' | 'operative' | 'specialist' | 'elite' | 'phantom'
export type AgentClass = 'infiltrator' | 'cryptographer' | 'social_engineer' | 'bruteforce'
export type ItemSlot = 'tool' | 'software' | 'hardware'
export type ModType = 'loot_percent' | 'speed_percent' | 'xp_flat' | 'gem_chance' | 'power_flat' | 'item_chance' | 'gem_bonus'

export interface ItemMod { type: ModType; value: number }

export interface HackItemDef {
  name: string
  slot: ItemSlot
  itemLevel: number
  rarity: HackRarity
  mods: ItemMod[]
}

// ─── Deprecated alias kept for existing shop API (can be removed later) ──────
export interface ShopItemDef extends HackItemDef { shopId: string; cost: number }

export interface OpTemplate {
  id: string; name: string; description: string; flavor: string; icon: string
  minAgents: number; maxAgents: number; durationMs: number; minPower: number
  baseCash: [number, number]; baseXP: number
  baseGemChance: number; baseGemCount: [number, number]
  itemDropChance: number; itemDropRarity: HackRarity
}

// Cash rewards follow a geometric ladder (~1.59× per op) from ~850 avg up to a
// ~3.6M average (max ~5M) on the final op — comparable to the miner's endgame
// income, but gated behind longer durations, power requirements and failure risk
// so it stays the slower of the three money sources. Every op is always shown; you
// just need ≥1% success (see MIN_DEPLOY_SUCCESS) to deploy. Reward is the op base ×
// a modest level/loot bonus — no hidden multipliers, so the listed range is honest.
export const OP_TEMPLATES: OpTemplate[] = [
  // itemDropChance is intentionally modest (~×0.8 of the old values) — the Item Find gear
  // mod is now the main way to push drop rates up. Likewise baseGemCount maxes are trimmed
  // (−1 on any op that gave >1) so the Bonus Gems mod drives most gem income.
  // ── Tier 1: Beginner ──────────────────────────────────────────────────────────
  { id: 'port_scan',        name: 'Port Scan',              description: 'Quick recon against a local network.', flavor: 'Probe a small business subnet for open ports.', icon: 'i-lucide-scan',            minAgents: 1, maxAgents: 1, durationMs:  2 * 60 * 60 * 1000, minPower: 0,     baseCash: [500,       1_200],     baseXP: 15,  baseGemChance: 0,    baseGemCount: [0, 0],   itemDropChance: 0.08, itemDropRarity: 'ghost' },
  { id: 'wifi_crack',       name: 'Wi-Fi Crack',            description: 'Break WPA2 on a local network for access.', flavor: 'Crack the router password at a coffee chain.', icon: 'i-lucide-wifi',            minAgents: 1, maxAgents: 1, durationMs:  2 * 60 * 60 * 1000, minPower: 8,     baseCash: [800,       1_900],     baseXP: 15,  baseGemChance: 0,    baseGemCount: [0, 0],   itemDropChance: 0.10, itemDropRarity: 'ghost' },
  { id: 'phishing_run',     name: 'Phishing Run',           description: 'Send a targeted email campaign to harvest creds.', flavor: 'Spear-phish 50 employees at a logistics firm.', icon: 'i-lucide-mail',            minAgents: 1, maxAgents: 1, durationMs:  3 * 60 * 60 * 1000, minPower: 12,    baseCash: [1_300,     3_000],     baseXP: 18,  baseGemChance: 0,    baseGemCount: [0, 0],   itemDropChance: 0.10, itemDropRarity: 'ghost' },
  { id: 'corp_breach',      name: 'Corporate Breach',       description: 'Infiltrate a mid-tier corporate network.', flavor: 'Extract HR database credentials from a Fortune 500.', icon: 'i-lucide-building-2',     minAgents: 1, maxAgents: 1, durationMs:  4 * 60 * 60 * 1000, minPower: 18,    baseCash: [2_000,     4_800],     baseXP: 22,  baseGemChance: 0,    baseGemCount: [0, 0],   itemDropChance: 0.12, itemDropRarity: 'ghost' },
  // ── Tier 2: Early mid (-10%) ────────────────────────────────────────────────────
  { id: 'bank_skim',        name: 'Bank Skim',              description: 'Intercept transaction data from a financial institution.', flavor: 'Tap into interbank wire traffic.', icon: 'i-lucide-landmark',        minAgents: 1, maxAgents: 2, durationMs:  5 * 60 * 60 * 1000, minPower: 25,    baseCash: [3_000,     6_800],     baseXP: 28,  baseGemChance: 0.02, baseGemCount: [1, 1],   itemDropChance: 0.14, itemDropRarity: 'ghost' },
  { id: 'ransomware_drop',  name: 'Ransomware Drop',        description: 'Deploy ransomware and collect the payout.', flavor: 'Infect a regional hospital network and negotiate.', icon: 'i-lucide-virus',           minAgents: 1, maxAgents: 2, durationMs:  5 * 60 * 60 * 1000, minPower: 35,    baseCash: [4_700,     10_800],    baseXP: 30,  baseGemChance: 0.02, baseGemCount: [1, 1],   itemDropChance: 0.14, itemDropRarity: 'ghost' },
  { id: 'dark_web',         name: 'Dark Web Contract',      description: 'Anonymous contract from the underground market.', flavor: 'Deliver compromised creds to a Tor dead drop.', icon: 'i-lucide-shield-alert',    minAgents: 1, maxAgents: 2, durationMs:  7 * 60 * 60 * 1000, minPower: 50,    baseCash: [7_400,     17_000],    baseXP: 35,  baseGemChance: 0.05, baseGemCount: [1, 1],   itemDropChance: 0.18, itemDropRarity: 'operative' },
  { id: 'crypto_heist',     name: 'Crypto Heist',           description: 'Drain a hot wallet from an unprotected exchange.', flavor: 'Exploit a race condition in a DEX smart contract.', icon: 'i-lucide-bitcoin',         minAgents: 1, maxAgents: 2, durationMs:  7 * 60 * 60 * 1000, minPower: 70,    baseCash: [11_700,    27_000],    baseXP: 36,  baseGemChance: 0.04, baseGemCount: [1, 1],   itemDropChance: 0.16, itemDropRarity: 'operative' },
  // ── Tier 3: Mid (-20%) ────────────────────────────────────────────────────────
  { id: 'telecom_tap',      name: 'Telecom Tap',            description: "Tap a national carrier's backbone for intel.", flavor: 'Splice into fibre routing between two major exchanges.', icon: 'i-lucide-radio-tower',     minAgents: 2, maxAgents: 2, durationMs:  9 * 60 * 60 * 1000, minPower: 95,    baseCash: [17_000,    39_000],    baseXP: 42,  baseGemChance: 0.08, baseGemCount: [1, 1],   itemDropChance: 0.20, itemDropRarity: 'operative' },
  { id: 'supply_chain',     name: 'Supply Chain Inject',    description: 'Inject a backdoor into a popular software package.', flavor: 'Compromise the CI/CD pipeline of a major npm package.', icon: 'i-lucide-package-2',       minAgents: 2, maxAgents: 2, durationMs: 10 * 60 * 60 * 1000, minPower: 130,   baseCash: [26_000,    62_000],    baseXP: 44,  baseGemChance: 0.10, baseGemCount: [1, 1],   itemDropChance: 0.20, itemDropRarity: 'operative' },
  { id: 'mil_intel',        name: 'Military Intel Leak',    description: 'Exfiltrate classified comms from a military contractor.', flavor: 'Extract procurement docs from a defense subcontractor.', icon: 'i-lucide-crosshair',       minAgents: 2, maxAgents: 3, durationMs: 11 * 60 * 60 * 1000, minPower: 180,   baseCash: [42_000,    98_000],    baseXP: 47,  baseGemChance: 0.12, baseGemCount: [1, 1],   itemDropChance: 0.22, itemDropRarity: 'operative' },
  { id: 'gov_heist',        name: 'Government Heist',       description: 'High-risk exfiltration from a classified federal network.', flavor: 'Exfiltrate documents from a government server farm.', icon: 'i-lucide-shield',          minAgents: 2, maxAgents: 3, durationMs: 12 * 60 * 60 * 1000, minPower: 250,   baseCash: [67_000,    157_000],   baseXP: 50,  baseGemChance: 0.15, baseGemCount: [1, 1],   itemDropChance: 0.24, itemDropRarity: 'operative' },
  // ── Tier 4: Late mid (-30%) ─────────────────────────────────────────────────────
  { id: 'ai_theft',         name: 'AI Model Theft',         description: 'Steal proprietary model weights from a tech giant.', flavor: 'Exfiltrate 200GB of trained weights from a cloud storage bucket.', icon: 'i-lucide-brain',           minAgents: 2, maxAgents: 3, durationMs: 14 * 60 * 60 * 1000, minPower: 340,   baseCash: [93_000,    218_000],   baseXP: 56,  baseGemChance: 0.18, baseGemCount: [1, 2],   itemDropChance: 0.26, itemDropRarity: 'specialist' },
  { id: 'central_bank',     name: 'Central Bank Tap',       description: 'Intercept SWIFT messages from a central bank.', flavor: 'Eavesdrop on interbank settlements for 10 hours.', icon: 'i-lucide-coins',           minAgents: 2, maxAgents: 3, durationMs: 15 * 60 * 60 * 1000, minPower: 470,   baseCash: [148_000,   346_000],   baseXP: 58,  baseGemChance: 0.20, baseGemCount: [1, 2],   itemDropChance: 0.26, itemDropRarity: 'specialist' },
  { id: 'black_site',       name: 'Black Site Raid',        description: 'Breach an off-books intelligence facility.', flavor: 'Exfiltrate AI research from a black-site data center.', icon: 'i-lucide-skull',           minAgents: 2, maxAgents: 4, durationMs: 18 * 60 * 60 * 1000, minPower: 650,   baseCash: [236_000,   550_000],   baseXP: 65,  baseGemChance: 0.25, baseGemCount: [2, 2],   itemDropChance: 0.28, itemDropRarity: 'specialist' },
  // ── Tier 5: Endgame (-45%) ──────────────────────────────────────────────────────
  { id: 'nsa_breach',       name: 'NSA Breach',             description: 'Penetrate the most defended network on the planet.', flavor: 'Access a signals intelligence feed from Fort Meade.', icon: 'i-lucide-satellite',       minAgents: 3, maxAgents: 4, durationMs: 22 * 60 * 60 * 1000, minPower: 900,   baseCash: [295_000,   690_000],   baseXP: 72,  baseGemChance: 0.32, baseGemCount: [2, 3],   itemDropChance: 0.30, itemDropRarity: 'specialist' },
  { id: 'ghost_protocol',   name: 'Ghost Protocol',         description: 'The most dangerous op in existence.', flavor: 'Infiltrate and extract from a sovereign-level cyber fortress.', icon: 'i-lucide-ghost',           minAgents: 3, maxAgents: 4, durationMs: 30 * 60 * 60 * 1000, minPower: 1_250, baseCash: [470_000,   1_100_000], baseXP: 80,  baseGemChance: 0.40, baseGemCount: [2, 3],  itemDropChance: 0.36, itemDropRarity: 'specialist' },
  { id: 'quantum_heist',    name: 'Quantum Heist',          description: 'Exploit a quantum computing lab for unbreakable access.', flavor: 'Crack post-quantum encryption using a hijacked QPU.', icon: 'i-lucide-cpu',             minAgents: 3, maxAgents: 4, durationMs: 40 * 60 * 60 * 1000, minPower: 1_750, baseCash: [750_000,   1_750_000], baseXP: 90,  baseGemChance: 0.55, baseGemCount: [2, 4],  itemDropChance: 0.40, itemDropRarity: 'elite' },
  { id: 'project_zero',     name: 'Project Zero',           description: 'Mythic-tier op. Requires full squad of 4.', flavor: 'Achieve zero-day persistent access to a nation-state AI system.', icon: 'i-lucide-target',          minAgents: 4, maxAgents: 4, durationMs: 56 * 60 * 60 * 1000, minPower: 2_444, baseCash: [1_200_000, 2_750_000], baseXP: 100, baseGemChance: 0.70, baseGemCount: [3, 5],  itemDropChance: 0.44, itemDropRarity: 'elite' },
]

export const RARITY_ORDER: HackRarity[] = ['ghost', 'operative', 'specialist', 'elite', 'phantom']
export type NuxtColor = 'neutral' | 'success' | 'info' | 'warning' | 'error' | 'primary'
export const RARITY_LABEL: Record<HackRarity, string> = { ghost: 'Ghost', operative: 'Operative', specialist: 'Specialist', elite: 'Elite', phantom: 'Phantom' }
export const RARITY_COLOR: Record<HackRarity, NuxtColor> = { ghost: 'neutral', operative: 'success', specialist: 'info', elite: 'warning', phantom: 'error' }
// Solid accent for rarity strips/dots. Static palette strings (Nuxt UI has no solid
// `bg-neutral`), mirroring the semantic intent so every rarity renders a visible bar.
export const RARITY_ACCENT: Record<HackRarity, string> = {
  ghost: 'bg-zinc-400', operative: 'bg-green-500', specialist: 'bg-sky-500', elite: 'bg-amber-500', phantom: 'bg-rose-500',
}
// Only 3 stamp SFX exist so far (public/hack/sound/sfx/stamp-*.mp3) — the two lower
// tiers share the "common" stamp until dedicated sounds are sourced for them.
export const RARITY_STAMP_SFX: Record<HackRarity, string> = {
  ghost: 'stamp-common', operative: 'stamp-common', specialist: 'stamp-common', elite: 'stamp-elite', phantom: 'stamp-phantom',
}

// ─── Unified rarity tint ──────────────────────────────────────────────────────
// Rarity is the ONE color language across the hack UI: avatars, item icons and frames
// are tinted by rarity, while agent class and item type are conveyed by ICON only (and
// a neutral label) so the palette stays calm. Full static strings so Tailwind's JIT
// emits them (shared/ is registered as a @source).
export interface RarityStyle { text: string; bg: string; border: string; ring: string }
export const RARITY_STYLE: Record<HackRarity, RarityStyle> = {
  ghost:      { text: 'text-zinc-300',  bg: 'bg-zinc-500/10',  border: 'border-zinc-500/30',  ring: 'ring-zinc-400/40'  },
  operative:  { text: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30', ring: 'ring-green-500/40' },
  specialist: { text: 'text-sky-400',   bg: 'bg-sky-500/10',   border: 'border-sky-500/30',   ring: 'ring-sky-500/40'   },
  elite:      { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', ring: 'ring-amber-500/40' },
  phantom:    { text: 'text-rose-400',  bg: 'bg-rose-500/10',  border: 'border-rose-500/30',  ring: 'ring-rose-500/40'  },
}

export const CLASS_LABEL: Record<AgentClass, string> = { infiltrator: 'Infiltrator', cryptographer: 'Cryptographer', social_engineer: 'Social Engineer', bruteforce: 'Bruteforce' }
export const CLASS_ICON: Record<AgentClass, string> = { infiltrator: 'i-lucide-ghost', cryptographer: 'i-lucide-key', social_engineer: 'i-lucide-message-circle', bruteforce: 'i-lucide-zap' }
export const CLASS_PASSIVE: Record<AgentClass, { type: ModType; value: number; label: string }> = {
  infiltrator:     { type: 'speed_percent',  value: 0.10, label: '+10% op speed' },
  cryptographer:   { type: 'loot_percent',   value: 0.06, label: '+6% loot' },
  social_engineer: { type: 'gem_chance',     value: 0.01, label: '+1% gem chance' },
  bruteforce:      { type: 'power_flat',     value: 15,   label: '+15 power rating' },
}

// ─── Class (spec) accent colors ───────────────────────────────────────────────
// Each agent class gets a distinct accent so specs are instantly recognizable at a
// glance — rarity stays on the badge, the spec owns the color. Full static class
// strings (not interpolated) so Tailwind's JIT always emits them.
export interface ClassColor { text: string; bg: string; border: string; ring: string; dot: string }
export const CLASS_COLOR: Record<AgentClass, ClassColor> = {
  infiltrator:     { text: 'text-sky-400',    bg: 'bg-sky-500/10',    border: 'border-sky-500/30',    ring: 'ring-sky-500/30',    dot: 'bg-sky-400' },
  cryptographer:   { text: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/30',  ring: 'ring-amber-500/30',  dot: 'bg-amber-400' },
  social_engineer: { text: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/30', ring: 'ring-fuchsia-500/30', dot: 'bg-fuchsia-400' },
  bruteforce:      { text: 'text-rose-400',   bg: 'bg-rose-500/10',   border: 'border-rose-500/30',   ring: 'ring-rose-500/30',   dot: 'bg-rose-400' },
}

// ─── Item slot presentation (shared across pages) ─────────────────────────────
export const SLOT_LABEL: Record<ItemSlot, string> = { tool: 'Tool', software: 'Software', hardware: 'Hardware' }
export const SLOT_ICON: Record<ItemSlot, string> = { tool: 'i-lucide-usb', software: 'i-lucide-terminal', hardware: 'i-lucide-cpu' }
export const SLOT_COLOR: Record<ItemSlot, ClassColor> = {
  tool:     { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', ring: 'ring-emerald-500/30', dot: 'bg-emerald-400' },
  software: { text: 'text-indigo-400',  bg: 'bg-indigo-500/10',  border: 'border-indigo-500/30',  ring: 'ring-indigo-500/30',  dot: 'bg-indigo-400' },
  hardware: { text: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/30',  ring: 'ring-orange-500/30',  dot: 'bg-orange-400' },
}

// Exponential curve — early levels are quick, each tier costs ~17.8% more than the
// last, reaching ~1900 XP for the final level (matches the old level*100 cap at Lv20).
export function xpToNextLevel(level: number): number { return Math.round(100 * Math.pow(1.1777, level - 1)) }
export const AGENT_MAX_LEVEL = 20

// ─── Agent traits (randomized per agent, like item mods) ──────────────────────
export type AgentTraitType =
  | 'gem_chance'      // +X% gem drop chance per op
  | 'speed_percent'   // +X% faster op completion
  | 'loot_percent'    // +X% more cash per op
  | 'xp_boost'        // +X% more XP per op
  | 'power_flat'      // +X flat power rating
  | 'power_percent'   // +X% multiplier on this agent's power
  | 'gem_bonus'       // +N extra gems per op — only when the op already rolls gems

export interface AgentTrait { type: AgentTraitType; value: number }

export const AGENT_TRAIT_RANGES: Record<AgentTraitType, { min: number; max: number; decimals: number }> = {
  gem_chance:    { min: 0.005, max: 0.05,  decimals: 3 },
  speed_percent: { min: 3,     max: 10,    decimals: 1 },
  loot_percent:  { min: 3,     max: 6,     decimals: 1 },
  xp_boost:      { min: 5,     max: 50,    decimals: 0 },
  power_flat:    { min: 10,    max: 60,    decimals: 0 },
  power_percent: { min: 5,     max: 30,    decimals: 0 },
  gem_bonus:     { min: 1,     max: 3,     decimals: 0 },
}

export const AGENT_TRAIT_LABEL: Record<AgentTraitType, string> = {
  gem_chance:    'Gem Chance',
  speed_percent: 'Op Speed',
  loot_percent:  'Loot',
  xp_boost:      'XP Gain',
  power_flat:    'Power',
  power_percent: 'Power %',
  gem_bonus:     'Bonus Gems',
}

export const AGENT_TRAIT_COUNT: Record<HackRarity, number> = {
  ghost: 1, operative: 2, specialist: 3, elite: 4, phantom: 5,
}

const ALL_TRAIT_TYPES: AgentTraitType[] = ['gem_chance', 'speed_percent', 'loot_percent', 'xp_boost', 'power_flat', 'power_percent', 'gem_bonus']

export function formatTraitValue(type: AgentTraitType, value: number): string {
  if (type === 'gem_chance') return `+${(value * 100).toFixed(1)}%`
  if (type === 'gem_bonus') return `+${Math.round(value)} gems`
  if (type === 'power_flat') return `+${Math.round(value)} power`
  if (type === 'power_percent') return `+${Math.round(value)}% power`
  if (type === 'xp_boost') return `+${Math.round(value)}% XP`
  return `+${formatPct(value)}%`
}

// ─── Agent upgrade artifacts (PLAN.md §4) ───────────────────────────────────
// Each rarity applies a fixed fraction of the trait's gap. Values are stored as
// exact decimals and clamped at the trait max on apply.
//
// gem_chance is the one trait stored as a raw 0-1 fraction (AGENT_TRAIT_RANGES:
// 0.005-0.05) rather than a plain percentage number like the other percent traits
// (e.g. power_percent stores "5" for 5%) — its adds must be /100 of the PLAN.md
// percentage-point table (Ghost +0.1% == 0.001, Phantom +0.9% == 0.009), or a
// single artifact overshoots the entire 0.005-0.05 range and always maxes the trait.
export const ARTIFACT_VALUE: Record<AgentTraitType, Record<HackRarity, number>> = {
  power_flat:    { ghost: 1,     operative: 2,    specialist: 3,    elite: 6,     phantom: 10 },
  power_percent: { ghost: 0.5,   operative: 1,    specialist: 2,    elite: 3,     phantom: 5 },
  xp_boost:      { ghost: 1,     operative: 2,    specialist: 3,    elite: 5,     phantom: 9 },
  speed_percent: { ghost: 0.1,   operative: 0.3,  specialist: 0.4,  elite: 0.8,   phantom: 1.4 },
  gem_chance:    { ghost: 0.001, operative: 0.002, specialist: 0.003, elite: 0.005, phantom: 0.009 },
  loot_percent:  { ghost: 0.1,   operative: 0.1,  specialist: 0.2,  elite: 0.3,   phantom: 0.6 },
  gem_bonus:     { ghost: 0.05,  operative: 0.1,  specialist: 0.15, elite: 0.25,  phantom: 0.4 },
}

// Formats a raw artifact "add" amount for preview/inventory text. Unlike
// formatTraitValue (which rounds trait values to whole numbers for the on-agent
// display), this must never collapse a genuine nonzero add — like gem_bonus's
// 0.05 Ghost stack — down to a misleading "+0".
export function formatArtifactAdd(type: AgentTraitType, value: number): string {
  const trimmed = (v: number) => (Math.round(v * 100) / 100).toString()
  if (type === 'gem_chance') return `+${trimmed(value * 100)}%`
  if (type === 'gem_bonus') return `+${trimmed(value)} gems`
  if (type === 'power_flat') return `+${trimmed(value)} power`
  if (type === 'power_percent') return `+${trimmed(value)}% power`
  if (type === 'xp_boost') return `+${trimmed(value)}% XP`
  return `+${trimmed(value)}%`
}

export interface ArtifactRoll { type: AgentTraitType; rarity: HackRarity; count: number }

// Per-tier rarity table (PLAN.md §5). Trait type is uniform-random across all 7.
export function artifactRarityTable(templateId: string): Record<HackRarity, number> | null {
  // Tier is keyed by the op's position in the money ladder.
  const idx = OP_TEMPLATES.findIndex(t => t.id === templateId)
  if (idx === -1) return null
  if (idx <= 3) return { ghost: 60, operative: 30, specialist: 10, elite: 0, phantom: 0 }
  if (idx <= 7) return { ghost: 0, operative: 60, specialist: 30, elite: 10, phantom: 0 }
  if (idx <= 11) return { ghost: 0, operative: 0, specialist: 60, elite: 30, phantom: 10 }
  if (idx <= 15) return { ghost: 0, operative: 0, specialist: 60, elite: 30, phantom: 10 }
  return { ghost: 0, operative: 0, specialist: 0, elite: 60, phantom: 40 }
}

function generateAgentTraits(rarity: HackRarity): AgentTrait[] {
  const count = AGENT_TRAIT_COUNT[rarity]
  const available = [...ALL_TRAIT_TYPES]
  const traits: AgentTrait[] = []
  for (let i = 0; i < count && available.length > 0; i++) {
    const idx = Math.floor(Math.random() * available.length)
    const type = available.splice(idx, 1)[0]!
    const range = AGENT_TRAIT_RANGES[type]
    const raw = range.min + Math.random() * (range.max - range.min)
    const factor = Math.pow(10, range.decimals)
    traits.push({ type, value: Math.round(raw * factor) / factor })
  }
  return traits
}

// Mod ranges are GLOBAL: every item — crate-bought or op-dropped — rolls the same band
// for a given mod type. A Ghost item from the Junk Cache can hit the same max Power
// roll a Phantom from the Ghost Cache can. Rarity only decides how MANY mods an item
// has, never how good each roll is. (Gear also always provides itemLevel × 2 power —
// see itemPower — which is why the Power mod ceiling stays modest.)
export const MOD_RANGES: Record<ModType, { min: number; max: number; decimals: number }> = {
  loot_percent:       { min: 1,     max: 12,    decimals: 1 },
  speed_percent:      { min: 1,     max: 12,    decimals: 1 },
  xp_flat:            { min: 1,     max: 7,     decimals: 0 },
  gem_chance:         { min: 0.001, max: 0.02,  decimals: 3 },
  power_flat:         { min: 4,     max: 28,    decimals: 0 },
  item_chance:        { min: 0.01,  max: 0.10,  decimals: 3 },
  gem_bonus:          { min: 1,     max: 3,     decimals: 0 },
}
export const MOD_LABEL: Record<ModType, string> = {
  loot_percent: 'Loot', speed_percent: 'Speed', xp_flat: 'XP',
  gem_chance: 'Gem Chance', power_flat: 'Power', item_chance: 'Item Find', gem_bonus: 'Bonus Gems',
}

// Where a rolled value lands within its full range, as 0–100. The single source
// of truth for "how good is this roll" — used by both HackRangeBar and the fill
// baked into HackModChip so a floor roll and a god roll read the same everywhere.
export function rollPct(range: { min: number; max: number }, value: number): number {
    if (range.max === range.min) return 100
    return Math.min(100, Math.max(0, Math.round((value - range.min) / (range.max - range.min) * 100)))
}

// Global stat display priority order - enforced across all agents and items
export const STAT_PRIORITY: ModType[] = [
  'power_flat',      // Power (Calculated as item level + power_flat mod)
  'speed_percent',   // Op speed %
  'loot_percent',    // Loot %
  'item_chance',     // Item find %
  'gem_chance',      // Gem chance %
  'gem_bonus',       // Bonus gems (flat)
]

export function sortModsByPriority(mods: ItemMod[]): ItemMod[] {
  return [...mods].sort((a, b) => {
    const aIndex = STAT_PRIORITY.indexOf(a.type)
    const bIndex = STAT_PRIORITY.indexOf(b.type)
    // If both types are in the priority list, sort by that
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex
    // If only one is in the priority list, it comes first
    if (aIndex !== -1) return -1
    if (bIndex !== -1) return 1
    // If neither is in the priority list, maintain original order
    return 0
  })
}

// Loot & Speed roll to one decimal (e.g. 6.2%), so format up to 1 decimal but trim a
// trailing ".0" so whole values stay clean (6% not 6.0%).
export function formatPct(value: number): string { return `${parseFloat(value.toFixed(1))}` }

export function formatModValue(type: ModType, value: number): string {
  if (type === 'gem_chance' || type === 'item_chance') return `+${(value * 100).toFixed(1)}%`
  if (type === 'xp_flat') return `+${value} XP`
  if (type === 'gem_bonus') return `+${Math.round(value)} gems`
  if (type === 'power_flat') return `+${Math.round(value)}`
  return `+${formatPct(value)}%`
}

/**
 * The complete set of bonuses an agent (or squad) provides, summed by display category
 * across class passives + traits + equipped gear. This is the single source of truth
 * behind both the agent card's "Total Bonuses" and the dispatch modal's "Agent
 * Modifiers", so the two always agree (and agree with the reward engine).
 *
 * Note on scale: speed/loot class passives are stored as fractions (0.10) while the
 * matching traits and gear mods are whole percents (10), so passives are normalized
 * ×100. Gem-chance and power-flat use the same scale across all three sources.
 */
export function agentBonusStats(
  agents: Array<{
    class: AgentClass
    traits?: AgentTrait[]
    gear?: Partial<Record<ItemSlot, { mods: ItemMod[] } | null>>
  }>,
): Array<{ label: string; value: number; fmt: (v: number) => string }> {
  type Stat = { label: string; value: number; fmt: (v: number) => string }
  const map = new Map<string, Stat>()
  const add = (key: string, label: string, value: number, fmt: (v: number) => string) => {
    const s = map.get(key)
    if (s) s.value += value
    else map.set(key, { label, value, fmt })
  }

  for (const agent of agents) {
    // Class passive — a real, always-on bonus.
    const passive = CLASS_PASSIVE[agent.class]
    if (passive.type === 'speed_percent') add('speed', 'Op Speed',   passive.value * 100, v => `+${formatPct(v)}%`)
    if (passive.type === 'loot_percent')  add('loot',  'Loot',       passive.value * 100, v => `+${formatPct(v)}%`)
    if (passive.type === 'gem_chance')    add('gem',   'Gem Chance', passive.value,       v => `+${(v * 100).toFixed(1)}%`)
    if (passive.type === 'power_flat')    add('power', 'Power',      passive.value,       v => `+${Math.round(v)}`)

    for (const t of (agent.traits ?? [])) {
      if (t.type === 'speed_percent')  add('speed',   'Op Speed',    t.value, v => `+${formatPct(v)}%`)
      if (t.type === 'loot_percent')   add('loot',    'Loot',        t.value, v => `+${formatPct(v)}%`)
      if (t.type === 'gem_chance')     add('gem',     'Gem Chance',  t.value, v => `+${(v * 100).toFixed(1)}%`)
      if (t.type === 'xp_boost')       add('xp',      'XP Gain',     t.value, v => `+${Math.round(v)}%`)
      if (t.type === 'power_flat')     add('power',   'Power',       t.value, v => `+${Math.round(v)}`)
      if (t.type === 'power_percent')  add('powerpct','Power %',     t.value, v => `+${Math.round(v)}%`)
      if (t.type === 'gem_bonus')      add('gembonus','Bonus Gems',  t.value, v => `+${Math.round(v)} gems`)
    }

    for (const slot of ITEM_SLOTS) {
      const item = agent.gear?.[slot]
      if (!item) continue
      for (const m of (item.mods ?? [])) {
        if (m.type === 'speed_percent')  add('speed',   'Op Speed',   m.value, v => `+${formatPct(v)}%`)
        if (m.type === 'loot_percent')   add('loot',    'Loot',       m.value, v => `+${formatPct(v)}%`)
        if (m.type === 'gem_chance')     add('gem',     'Gem Chance', m.value, v => `+${(v * 100).toFixed(1)}%`)
        if (m.type === 'xp_flat')        add('xpflat',  'XP per Op',  m.value, v => `+${Math.round(v)} XP`)
        if (m.type === 'power_flat')     add('power',   'Power',      m.value, v => `+${Math.round(v)}`)
        if (m.type === 'item_chance')    add('itemfind','Item Find',  m.value, v => `+${(v * 100).toFixed(1)}%`)
        if (m.type === 'gem_bonus')      add('gembonus','Bonus Gems', m.value, v => `+${Math.round(v)} gems`)
      }
    }
  }

  // Sort by global stat priority, keyed off the internal accumulator key (not the
  // display label) so every stat lands where intended.
  const keyToPriority: Record<string, number> = {
    power: 0,
    speed: 1,
    loot: 2,
    itemfind: 3,
    gem: 4,
    gembonus: 5,
    xpflat: 6,
    xp: 7,
    powerpct: 8,
  }
  return Array.from(map.entries())
    .filter(([, s]) => s.value > 0)
    .sort(([aKey], [bKey]) => (keyToPriority[aKey] ?? 99) - (keyToPriority[bKey] ?? 99))
    .map(([, s]) => s)
}

export const RARITY_MOD_COUNT: Record<HackRarity, number> = { ghost: 1, operative: 2, specialist: 3, elite: 4, phantom: 5 }

const ITEM_SLOTS: ItemSlot[] = ['tool', 'software', 'hardware']
const ALL_MOD_TYPES: ModType[] = ['loot_percent', 'speed_percent', 'xp_flat', 'gem_chance', 'power_flat', 'item_chance', 'gem_bonus']
const TOOL_NAMES = ['USB Infiltrator', 'Signal Probe', 'Ghost Tap', 'Neural Sniffer', 'Quantum Spike', 'Black Tap', 'Phantom Drive', 'Cipher Key']
const SOFTWARE_NAMES = ['Zero Day Exploit', 'Polymorphic Shell', 'Ghost Suite', 'Darknet Relay', 'Neural Bypass', 'Stealth Daemon', 'AI Decryptor', 'Recursive Worm']
const HARDWARE_NAMES = ['Black Ice Rig', 'Signal Scrambler', 'Neural Implant', 'Optical Jammer', 'Dark Server', 'Void Terminal', 'Quantum Node', 'Stealth Array']
const RARITY_PREFIX: Record<HackRarity, string> = { ghost: '', operative: 'Improved ', specialist: 'Advanced ', elite: 'Military-Grade ', phantom: 'Mythic ' }

function pickRandom<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]! }

function generateItemName(slot: ItemSlot, rarity: HackRarity): string {
  const pool = slot === 'tool' ? TOOL_NAMES : slot === 'software' ? SOFTWARE_NAMES : HARDWARE_NAMES
  return RARITY_PREFIX[rarity] + pickRandom(pool)
}

/** Roll a single mod's value uniformly across its full range. */
export function rollMod(type: ModType): ItemMod {
  const range = MOD_RANGES[type]
  const raw = range.min + Math.random() * (range.max - range.min)
  const factor = Math.pow(10, range.decimals)
  return { type, value: Math.round(raw * factor) / factor }
}

export function generateItem(rarity: HackRarity, slot?: ItemSlot): HackItemDef {
  const s = slot ?? pickRandom(ITEM_SLOTS)
  const modCount = RARITY_MOD_COUNT[rarity]
  const available = [...ALL_MOD_TYPES]
  const mods: ItemMod[] = []
  for (let i = 0; i < modCount && available.length > 0; i++) {
    const idx = Math.floor(Math.random() * available.length)
    const type = available.splice(idx, 1)[0]!
    mods.push(rollMod(type))
  }
  // Every item drops at level 1, no matter the source — leveling is a deliberate gem
  // sink at the Crafting Bench (see itemUpgradeCost), never automatic.
  return { name: generateItemName(s, rarity), slot: s, itemLevel: 1, rarity, mods }
}

// ─── Item leveling ────────────────────────────────────────────────────────────
// Items never level on their own. Upgrading at the Crafting Bench costs gems and adds
// +2 power per level (see itemPower). Cost grows ~13% per level: 1 gem for level 2,
// 9 gems for the final level — ~70 gems total to take one item from 1 to 20.
export const ITEM_MAX_LEVEL = 20
export function itemUpgradeCost(currentLevel: number): number {
    return Math.round(Math.pow(1.13, currentLevel - 1))
}

// Bulk upgrade buys up to this many levels in one go (fewer if that would cross
// ITEM_MAX_LEVEL) — the Crafting Bench's "big" upgrade button.
export const ITEM_BULK_UPGRADE_LEVELS = 5

/** How many levels a bulk upgrade actually applies, capped at the level ceiling. */
export function itemBulkUpgradeLevels(currentLevel: number): number {
    return Math.max(0, Math.min(ITEM_BULK_UPGRADE_LEVELS, ITEM_MAX_LEVEL - currentLevel))
}

/** Total gem cost to upgrade `levels` levels starting from currentLevel. */
export function itemUpgradeCostForLevels(currentLevel: number, levels: number): number {
    let cost = 0
    for (let lvl = currentLevel; lvl < currentLevel + levels; lvl++) cost += itemUpgradeCost(lvl)
    return cost
}

// ─── Item re-rolling ────────────────────────────────────────────────────────────
// Re-roll gem cost: 1 gem per mod on the item, plus an escalating surcharge per
// locked mod — 1 locked = +1, 2 = +3, 3 = +5, … (i.e. 2·locked − 1). Locking more
// specs you want to keep gets steeply pricier.
export function rerollCost(modCount: number, lockedCount: number): number {
  const lockSurcharge = lockedCount <= 0 ? 0 : 2 * lockedCount - 1
  return modCount + lockSurcharge
}

/**
 * Re-roll an item's mods. Locked mod types keep their exact value; every other slot is
 * replaced by a fresh random mod (new type + value, rolled across the FULL range). New
 * types are drawn so the item keeps unique mod types, but a re-rolled slot can come back
 * as the same type it had before — there's no guaranteed improvement. Original slot order
 * is preserved so the UI stays stable.
 */
export function rerollItemMods(mods: ItemMod[], lockedTypes: ModType[]): ItemMod[] {
  const lockedSet = new Set(mods.filter(m => lockedTypes.includes(m.type)).map(m => m.type))
  const pool = ALL_MOD_TYPES.filter(t => !lockedSet.has(t))
  const rerollCount = mods.length - lockedSet.size
  const rolled: ItemMod[] = []
  for (let i = 0; i < rerollCount && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length)
    const type = pool.splice(idx, 1)[0]!
    rolled.push(rollMod(type))
  }
  let r = 0
  return mods.map(m => (lockedSet.has(m.type) ? m : rolled[r++]!))
}

// Each class draws from its own flavored codename pool, so a name reinforces the
// agent's role: ghosts for infiltrators, math/crypto for cryptographers, con-artist
// handles for social engineers, and blunt-force names for bruteforcers.
export const AGENT_CODENAMES: Record<AgentClass, string[]> = {
  infiltrator: [
    'Wraith', 'Specter', 'Shade', 'Ghost', 'Phantom', 'Mirage',
    'Veil', 'Hollow', 'Umbra', 'Drift', 'Vanish', 'Whisper',
  ],
  cryptographer: [
    'Cipher', 'Hash', 'Enigma', 'Vector', 'Prime', 'Lattice',
    'Rune', 'Glyph', 'Sigma', 'Axiom', 'Quanta', 'Kernel',
  ],
  social_engineer: [
    'Guile', 'Grift', 'Persona', 'Chameleon', 'Vox', 'Muse',
    'Envoy', 'Fable', 'Charm', 'Mimic', 'Halo', 'Silvertongue',
  ],
  bruteforce: [
    'Havoc', 'Titan', 'Hammer', 'Brute', 'Breaker', 'Anvil',
    'Maul', 'Siege', 'Onyx', 'Blitz', 'Fury', 'Rampart',
  ],
}
const AGENT_CLASSES: AgentClass[] = ['infiltrator', 'cryptographer', 'social_engineer', 'bruteforce']

export function generateAgentDef(rarity: HackRarity, takenNames: string[] = []) {
  const cls = pickRandom(AGENT_CLASSES)
  const pool = AGENT_CODENAMES[cls]
  const available = pool.filter(n => !takenNames.includes(n))
  let name: string
  if (available.length > 0) {
    name = pickRandom(available)
  } else {
    // Whole class pool taken — add a numeric suffix to one of its codenames
    const base = pickRandom(pool)
    let suffix = 2
    while (takenNames.includes(`${base}-${suffix}`)) suffix++
    name = `${base}-${suffix}`
  }
  return { name, class: cls, rarity, level: 1, xp: 0, traits: generateAgentTraits(rarity) }
}

// ─── Fixed pull pricing ───────────────────────────────────────────────────────
// Pull prices are fixed per tier — predictable and never jumping around as your
// power, equipped gear or inventory changes. Progression is instead driven by the
// op ladder (bigger ops need more power and pay more) and the slot expansions
// below. Roster (6) and inventory (15) caps stop cheap late-game pulls from being
// abused: you pull, equip your best roll, and sell the rest.

// ─── Agent pulls ──────────────────────────────────────────────────────────────
export interface AgentPullTier {
  id: string; name: string; description: string
  currency: 'cash' | 'gems'
  cost: number
  weights: Record<HackRarity, number>
}

// Same rarity-floor ladder as item crates: each tier removes the previous tier's lowest
// rarity (Dark Web drops Ghost, Ghost Recruit drops Operative), so pricier pulls always
// guarantee a better minimum. Trait ranges are identical in every tier.
export const AGENT_PULL_TIERS: AgentPullTier[] = [
  { id: 'basic',    name: 'Script Pull',    description: 'Forum talent. Mostly rookies, sometimes a gem.', currency: 'cash', cost: 12_000,     weights: { ghost: 60, operative: 35, specialist: 5, elite: 0, phantom: 0 } },
  { id: 'advanced', name: 'Dark Web Hire',  description: 'Underground operators. Operative or better.',    currency: 'cash', cost: 200_000,    weights: { ghost: 0, operative: 50, specialist: 38, elite: 10, phantom: 2 } },
  { id: 'elite',    name: 'Ghost Recruit',  description: 'Top-shelf talent. Specialist or better.',        currency: 'cash', cost: 3_500_000,  weights: { ghost: 0, operative: 0, specialist: 36, elite: 44, phantom: 20 } },
]

// Backward-compat alias used by older API code
export const RECRUIT_TIERS = AGENT_PULL_TIERS
export type RecruitTier = AgentPullTier

// ─── Item pulls ───────────────────────────────────────────────────────────────
export interface ItemPullTier {
  id: string; name: string; description: string
  cost: number
  weights: Record<HackRarity, number>
}

// Rarity-floor ladder: each crate tier removes the previous tier's lowest rarity
// (Standard drops Ghost, Premium drops Operative, Ghost Cache drops Specialist), so a
// pricier crate always guarantees at least the tier the cheaper one could floor at.
// Rarity (= mod count) is the ONLY thing a crate buys — every mod rolls the same full
// range everywhere, so a lucky Junk Cache pull can match a Ghost Cache roll.
export const ITEM_PULL_TIERS: ItemPullTier[] = [
  { id: 'junk',        name: 'Junk Cache',     description: 'Salvaged trash. Sometimes useful.',       cost: 5_000,     weights: { ghost: 65, operative: 30, specialist: 5, elite: 0, phantom: 0 } },
  { id: 'standard',    name: 'Standard Crate', description: 'Reliable gear. Operative or better.',     cost: 40_000,    weights: { ghost: 0, operative: 55, specialist: 38, elite: 5, phantom: 2 } },
  { id: 'premium',     name: 'Premium Stash',  description: 'High-end gear. Specialist or better.',    cost: 300_000,   weights: { ghost: 0, operative: 0, specialist: 55, elite: 38, phantom: 7 } },
  { id: 'ghost_cache', name: 'Ghost Cache',    description: 'Ultra-rare haul. Elite or Phantom only.', cost: 2_000_000, weights: { ghost: 0, operative: 0, specialist: 0, elite: 65, phantom: 35 } },
]

export function rollItemFromTier(tier: ItemPullTier): HackItemDef {
  return generateItem(rollRarity(tier.weights))
}

// ─── Roster expansion ─────────────────────────────────────────────────────────
// Cost to expand roster from current size to next (index = currentSlots - 2).
// This is the main long-term cash sink — each extra agent slot multiplies how many
// ops you can run in parallel, so it scales hard against the op income ladder.
// 2→3: 150k · 3→4: 1.2M · 4→5: 10M · 5→6: 60M
export const ROSTER_EXPAND_COSTS = [150_000, 1_200_000, 10_000_000, 60_000_000]
export const MAX_ROSTER_SLOTS = 6
export const MAX_INVENTORY_SLOTS = 30
// Total agents a player can own (active roster + storage combined). Only up to
// `rosterSlots` of them may be active at once.
export const MAX_AGENTS = 15

// ─── Power calculation ────────────────────────────────────────────────────────
/**
 * Power a single piece of gear provides: +2 per item level (every item contributes,
 * even without a Power spec) plus any Power mods on top. This is THE number shown as
 * "power benefit" on item cards, so the UI always agrees with the engine.
 */
export function itemPower(item: { itemLevel: number; mods: ItemMod[] }): number {
  return item.itemLevel * 2 + item.mods.filter(m => m.type === 'power_flat').reduce((s, m) => s + m.value, 0)
}

export function agentPower(
  agent: { level: number; class: AgentClass },
  items: Array<{ itemLevel: number; mods: ItemMod[] }>,
  traits?: AgentTrait[],
): number {
  const passive = CLASS_PASSIVE[agent.class]
  const classPower = passive.type === 'power_flat' ? passive.value : 0
  const base = agent.level * 10 + classPower
  const gearPower = items.reduce((sum, item) => sum + itemPower(item), 0)
  const traitFlat = (traits ?? []).filter(t => t.type === 'power_flat').reduce((s, t) => s + t.value, 0)
  // Power % traits multiply the agent's whole flat power, so the bonus scales with
  // how invested the agent is — no fixed bonus you could exploit at low power.
  const traitPct = (traits ?? []).filter(t => t.type === 'power_percent').reduce((s, t) => s + t.value, 0) / 100
  return Math.round((base + gearPower + traitFlat) * (1 + traitPct))
}

// ─── Op speed ─────────────────────────────────────────────────────────────────
// There is no hard cap on a single agent's speed — instead the sources are tuned so
// ~56% is the natural ceiling a perfect agent can reach: a maxed infiltrator with
// three 12% speed items (36%) + the 10% class passive + a 10% speed trait = 56%.
// Squad-wide floor on the remaining time: even a perfect 4-agent team can't drop an
// op below (1 - this) of its base duration, keeping long endgame ops meaningful.
export const MAX_TOTAL_SPEED = 0.65

export interface AgentLoadout {
  class: AgentClass
  traits?: AgentTrait[]
  items: Array<{ mods: ItemMod[] }>
}

/** This agent's own speed reduction (gear + class passive + traits). */
export function agentSpeedPercent(agent: AgentLoadout): number {
  const itemSpeed = agent.items.flatMap(i => i.mods)
    .filter(m => m.type === 'speed_percent').reduce((s, m) => s + m.value, 0) / 100
  const classSpeed = CLASS_PASSIVE[agent.class].type === 'speed_percent' ? CLASS_PASSIVE[agent.class].value : 0
  const traitSpeed = (agent.traits ?? [])
    .filter(t => t.type === 'speed_percent').reduce((s, t) => s + t.value, 0) / 100
  return itemSpeed + classSpeed + traitSpeed
}

export function effectiveDurationMs(template: OpTemplate, agents: AgentLoadout[]): number {
  // Speed is NOT summed across agents into one big number. Each agent's speed is
  // applied one after another on the *remaining* time: agent 1 shaves its % off the
  // base, agent 2 shaves its % off what's left, and so on. This gives diminishing
  // returns, so stacking agents can't trivialise long ops.
  let factor = 1
  for (const agent of agents) factor *= (1 - agentSpeedPercent(agent))
  // Never go below 35% of the base duration, no matter how stacked the squad is.
  return Math.round(template.durationMs * Math.max(factor, 1 - MAX_TOTAL_SPEED))
}

export function opSuccessChance(totalPower: number, minPower: number): number {
  if (minPower === 0) return 1.0
  const ratio = totalPower / minPower
  return Math.min(1.0, Math.max(0, (ratio - 0.1) / 1.3))
}

/** Ops below this success chance can't be deployed (but are still shown). */
export const MIN_DEPLOY_SUCCESS = 0.01

export interface OpReward { success: boolean; cash: number; gems: number; item: HackItemDef | null; inventoryFull: boolean; artifacts: ArtifactRoll[] }

// ─── Loot ─────────────────────────────────────────────────────────────────────
// Loot is computed per agent (own gear loot mods + class passive + loot traits) and
// summed across the squad. There is no hard cap — the sources are tuned so ~30% is
// the natural ceiling a single agent can reach: three 12% loot items (36%) + the 6%
// cryptographer class passive + a 6% loot trait = 48%. A full 4-agent squad therefore
// tops out around 4× that rather than the old uncapped multiplier that exploded.
export interface RewardAgent {
  level: number
  class: AgentClass
  traits?: AgentTrait[]
  items: Array<{ mods: ItemMod[] }>
}

/** This agent's own loot bonus (gear + class passive + traits). */
export function agentLootPercent(agent: { class: AgentClass; traits?: AgentTrait[]; items: Array<{ mods: ItemMod[] }> }): number {
  const itemLoot = agent.items.flatMap(i => i.mods)
    .filter(m => m.type === 'loot_percent').reduce((s, m) => s + m.value, 0) / 100
  const classLoot = CLASS_PASSIVE[agent.class].type === 'loot_percent' ? CLASS_PASSIVE[agent.class].value : 0
  const traitLoot = (agent.traits ?? [])
    .filter(t => t.type === 'loot_percent').reduce((s, t) => s + t.value, 0) / 100
  return itemLoot + classLoot + traitLoot
}

/**
 * XP earned by a single agent from an op. XP is never pooled across the squad — each
 * agent levels from its OWN xp_boost trait (capped at +50% by the trait range) and
 * its OWN equipped xp_flat gear. A failed op still grants a flat 30% of base XP.
 */
export function agentXpGain(
  template: OpTemplate,
  agent: { traits?: AgentTrait[]; items: Array<{ mods: ItemMod[] }> },
  success: boolean,
): number {
  // Failed ops still grant some XP, but at half the success-floor rate (15% of base)
  // so dispatching deliberately over-difficult ops can't be used to farm XP.
  if (!success) return Math.floor(template.baseXP * 0.15)
  const xpBoost = (agent.traits ?? []).filter(t => t.type === 'xp_boost').reduce((s, t) => s + t.value, 0) / 100
  const xpFlat = agent.items.flatMap(i => i.mods).filter(m => m.type === 'xp_flat').reduce((s, m) => s + m.value, 0)
  return Math.round(template.baseXP * (1 + xpBoost) + xpFlat)
}

export function collectBonuses(agents: RewardAgent[]) {
  const allItemMods = agents.flatMap(a => a.items.flatMap(i => i.mods))
  const allTraits = agents.flatMap(a => a.traits ?? [])
  return {
    // Per-agent loot (each agent tops out ~30% by source design), summed across the squad.
    lootPct:   agents.reduce((s, a) => s + agentLootPercent(a), 0),
    // Gem drop chance: item mods + traits + the social-engineer class passive.
    gemChance: allItemMods.filter(m => m.type === 'gem_chance').reduce((s, m) => s + m.value, 0)
             + allTraits.filter(t => t.type === 'gem_chance').reduce((s, t) => s + t.value, 0)
             + agents.reduce((s, a) => s + (CLASS_PASSIVE[a.class].type === 'gem_chance' ? CLASS_PASSIVE[a.class].value : 0), 0),
    // Flat extra gems from the Bonus Gems trait + Bonus Gems gear mod — only paid out
    // when the op rolls gems (never creates gems on a gem-less op). Rounded here, the
    // one place every consumer (payout + preview) reads from: gear mods always roll
    // whole, but a Bonus Gems Artifact accumulates in fractional steps (PLAN.md §4) and
    // gems are never fractional anywhere else in the game.
    gemBonus:  Math.round(
      allTraits.filter(t => t.type === 'gem_bonus').reduce((s, t) => s + t.value, 0)
      + allItemMods.filter(m => m.type === 'gem_bonus').reduce((s, m) => s + m.value, 0)
    ),
    // Extra item-drop chance from Item Find gear mods, added on top of the op's base.
    itemChance: allItemMods.filter(m => m.type === 'item_chance').reduce((s, m) => s + m.value, 0),
    // Modest reward bonus for leveling agents — endgame full squad ≈ +32%.
    levelBonus: agents.reduce((s, a) => s + a.level, 0) * 0.004,
  }
}

/**
 * Effective cash range shown in UI. The op's baseCash ladder is the reward; per-agent
 * loot and agent levels apply a modest multiplier on top. No hidden progression
 * multiplier — the listed range is what you actually earn.
 */
export function effectiveCashRange(
  template: OpTemplate,
  bonuses: ReturnType<typeof collectBonuses>,
): [number, number] {
  const mult = (1 + bonuses.levelBonus) * (1 + bonuses.lootPct)
  return [Math.round(template.baseCash[0] * mult), Math.round(template.baseCash[1] * mult)]
}

export function effectiveGemChance(template: OpTemplate, bonuses: ReturnType<typeof collectBonuses>): number {
  return Math.min(0.95, template.baseGemChance + bonuses.gemChance)
}

export function effectiveItemDropChance(template: OpTemplate, bonuses: ReturnType<typeof collectBonuses>): number {
  return Math.min(0.9, template.itemDropChance + bonuses.itemChance)
}

export function rollOpReward(
  template: OpTemplate,
  agents: RewardAgent[],
  totalPower: number,
  inventoryFull: boolean,
): OpReward {
  // Success depends purely on the power ratio — agents raise it via Power / Power %
  // traits and gear, which scale with investment (no flat success bonus to exploit).
  const success = Math.random() < opSuccessChance(totalPower, template.minPower)

  const bonuses = collectBonuses(agents)

  if (!success) {
    return { success: false, cash: 0, gems: 0, item: null, inventoryFull: false, artifacts: [] }
  }
  const [minCash, maxCash] = effectiveCashRange(template, bonuses)
  const cash = Math.round(minCash + Math.random() * (maxCash - minCash))
  const gemChance = effectiveGemChance(template, bonuses)
  let gems = 0
  // Gems only ever drop on ops that already award them, and only when the chance roll
  // succeeds. The Bonus Gems trait adds on top — it can never create gems on an op
  // that has none.
  if (template.baseGemChance > 0 && Math.random() < gemChance) {
    const [gMin, gMax] = template.baseGemCount
    gems = gMin + Math.floor(Math.random() * (gMax - gMin + 1)) + bonuses.gemBonus
  }
  // Item Find gear mods raise the op's base drop chance (capped so it can't be a guarantee).
  const wouldDropItem = Math.random() < effectiveItemDropChance(template, bonuses)
  // Op drops roll the same full mod ranges as crates — rarity is fixed per op.
  const item = wouldDropItem && !inventoryFull
    ? generateItem(template.itemDropRarity)
    : null

  // Artifact drops scale with base op duration (PLAN.md §5). Project Zero drops none.
  const artifacts: ArtifactRoll[] = []
  if (template.id !== 'project_zero') {
    const baseHours = template.durationMs / 3_600_000
    const expected = 0.25 * baseHours
    const count = Math.max(0, Math.floor(expected + Math.random()))
    const rarityWeights = artifactRarityTable(template.id)
    if (count > 0 && rarityWeights) {
      for (let i = 0; i < count; i++) {
        const rarity = rollRarity(rarityWeights)
        const type = ALL_TRAIT_TYPES[Math.floor(Math.random() * ALL_TRAIT_TYPES.length)]!
        const existing = artifacts.find(a => a.type === type && a.rarity === rarity)
        if (existing) existing.count += 1
        else artifacts.push({ type, rarity, count: 1 })
      }
    }
  }

  return { success: true, cash, gems, item, inventoryFull: wouldDropItem && inventoryFull, artifacts }
}

export function rollRarity(weights: Record<HackRarity, number>): HackRarity {
  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  let roll = Math.random() * total
  for (const rarity of RARITY_ORDER) {
    roll -= weights[rarity]
    if (roll <= 0) return rarity
  }
  return 'ghost'
}

// Flat per rarity — rarity (mod count) is an item's only intrinsic worth. Item levels
// are a gem investment and deliberately do NOT refund as cash on sale, so upgrading
// can never become a gems→cash conversion.
export function itemSellPrice(rarity: HackRarity): number {
  const prices: Record<HackRarity, number> = { ghost: 500, operative: 1_500, specialist: 7_500, elite: 30_000, phantom: 150_000 }
  return prices[rarity]
}

// Kept for any code that still calls generateShopItems (can be removed later)
export function generateShopItems(_count = 4): ShopItemDef[] { return [] }
