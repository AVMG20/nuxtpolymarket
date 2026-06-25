export type HackRarity = 'ghost' | 'operative' | 'specialist' | 'elite' | 'phantom'
export type AgentClass = 'infiltrator' | 'cryptographer' | 'social_engineer' | 'bruteforce'
export type ItemSlot = 'tool' | 'software' | 'hardware'
export type ModType = 'loot_percent' | 'speed_percent' | 'xp_flat' | 'gem_chance' | 'power_flat'

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
  // ── Tier 1: Beginner ──────────────────────────────────────────────────────────
  { id: 'port_scan',        name: 'Port Scan',              description: 'Quick recon against a local network.', flavor: 'Probe a small business subnet for open ports.', icon: 'i-lucide-scan',            minAgents: 1, maxAgents: 1, durationMs:  2 * 60 * 60 * 1000, minPower: 0,     baseCash: [500,       1_200],     baseXP: 15,  baseGemChance: 0,    baseGemCount: [0, 0],   itemDropChance: 0.10, itemDropRarity: 'ghost' },
  { id: 'wifi_crack',       name: 'Wi-Fi Crack',            description: 'Break WPA2 on a local network for access.', flavor: 'Crack the router password at a coffee chain.', icon: 'i-lucide-wifi',            minAgents: 1, maxAgents: 1, durationMs:  2 * 60 * 60 * 1000, minPower: 8,     baseCash: [800,       1_900],     baseXP: 15,  baseGemChance: 0,    baseGemCount: [0, 0],   itemDropChance: 0.12, itemDropRarity: 'ghost' },
  { id: 'phishing_run',     name: 'Phishing Run',           description: 'Send a targeted email campaign to harvest creds.', flavor: 'Spear-phish 50 employees at a logistics firm.', icon: 'i-lucide-mail',            minAgents: 1, maxAgents: 1, durationMs:  3 * 60 * 60 * 1000, minPower: 12,    baseCash: [1_300,     3_000],     baseXP: 18,  baseGemChance: 0,    baseGemCount: [0, 0],   itemDropChance: 0.13, itemDropRarity: 'ghost' },
  { id: 'corp_breach',      name: 'Corporate Breach',       description: 'Infiltrate a mid-tier corporate network.', flavor: 'Extract HR database credentials from a Fortune 500.', icon: 'i-lucide-building-2',     minAgents: 1, maxAgents: 1, durationMs:  4 * 60 * 60 * 1000, minPower: 18,    baseCash: [2_000,     4_800],     baseXP: 22,  baseGemChance: 0,    baseGemCount: [0, 0],   itemDropChance: 0.15, itemDropRarity: 'ghost' },
  // ── Tier 2: Early mid (-10%) ────────────────────────────────────────────────────
  { id: 'bank_skim',        name: 'Bank Skim',              description: 'Intercept transaction data from a financial institution.', flavor: 'Tap into interbank wire traffic.', icon: 'i-lucide-landmark',        minAgents: 1, maxAgents: 2, durationMs:  5 * 60 * 60 * 1000, minPower: 25,    baseCash: [3_000,     6_800],     baseXP: 28,  baseGemChance: 0.02, baseGemCount: [1, 1],   itemDropChance: 0.18, itemDropRarity: 'ghost' },
  { id: 'ransomware_drop',  name: 'Ransomware Drop',        description: 'Deploy ransomware and collect the payout.', flavor: 'Infect a regional hospital network and negotiate.', icon: 'i-lucide-virus',           minAgents: 1, maxAgents: 2, durationMs:  5 * 60 * 60 * 1000, minPower: 35,    baseCash: [4_700,     10_800],    baseXP: 30,  baseGemChance: 0.02, baseGemCount: [1, 1],   itemDropChance: 0.18, itemDropRarity: 'ghost' },
  { id: 'dark_web',         name: 'Dark Web Contract',      description: 'Anonymous contract from the underground market.', flavor: 'Deliver compromised creds to a Tor dead drop.', icon: 'i-lucide-shield-alert',    minAgents: 1, maxAgents: 2, durationMs:  7 * 60 * 60 * 1000, minPower: 50,    baseCash: [7_400,     17_000],    baseXP: 35,  baseGemChance: 0.05, baseGemCount: [1, 1],   itemDropChance: 0.22, itemDropRarity: 'operative' },
  { id: 'crypto_heist',     name: 'Crypto Heist',           description: 'Drain a hot wallet from an unprotected exchange.', flavor: 'Exploit a race condition in a DEX smart contract.', icon: 'i-lucide-bitcoin',         minAgents: 1, maxAgents: 2, durationMs:  7 * 60 * 60 * 1000, minPower: 70,    baseCash: [11_700,    27_000],    baseXP: 36,  baseGemChance: 0.04, baseGemCount: [1, 1],   itemDropChance: 0.20, itemDropRarity: 'operative' },
  // ── Tier 3: Mid (-20%) ────────────────────────────────────────────────────────
  { id: 'telecom_tap',      name: 'Telecom Tap',            description: "Tap a national carrier's backbone for intel.", flavor: 'Splice into fibre routing between two major exchanges.', icon: 'i-lucide-radio-tower',     minAgents: 2, maxAgents: 2, durationMs:  9 * 60 * 60 * 1000, minPower: 95,    baseCash: [17_000,    39_000],    baseXP: 42,  baseGemChance: 0.08, baseGemCount: [1, 2],   itemDropChance: 0.26, itemDropRarity: 'operative' },
  { id: 'supply_chain',     name: 'Supply Chain Inject',    description: 'Inject a backdoor into a popular software package.', flavor: 'Compromise the CI/CD pipeline of a major npm package.', icon: 'i-lucide-package-2',       minAgents: 2, maxAgents: 2, durationMs: 10 * 60 * 60 * 1000, minPower: 130,   baseCash: [26_000,    62_000],    baseXP: 44,  baseGemChance: 0.10, baseGemCount: [1, 2],   itemDropChance: 0.26, itemDropRarity: 'operative' },
  { id: 'mil_intel',        name: 'Military Intel Leak',    description: 'Exfiltrate classified comms from a military contractor.', flavor: 'Extract procurement docs from a defense subcontractor.', icon: 'i-lucide-crosshair',       minAgents: 2, maxAgents: 3, durationMs: 11 * 60 * 60 * 1000, minPower: 180,   baseCash: [42_000,    98_000],    baseXP: 47,  baseGemChance: 0.12, baseGemCount: [1, 2],   itemDropChance: 0.28, itemDropRarity: 'operative' },
  { id: 'gov_heist',        name: 'Government Heist',       description: 'High-risk exfiltration from a classified federal network.', flavor: 'Exfiltrate documents from a government server farm.', icon: 'i-lucide-shield',          minAgents: 2, maxAgents: 3, durationMs: 12 * 60 * 60 * 1000, minPower: 250,   baseCash: [67_000,    157_000],   baseXP: 50,  baseGemChance: 0.15, baseGemCount: [1, 2],   itemDropChance: 0.30, itemDropRarity: 'operative' },
  // ── Tier 4: Late mid (-30%) ─────────────────────────────────────────────────────
  { id: 'ai_theft',         name: 'AI Model Theft',         description: 'Steal proprietary model weights from a tech giant.', flavor: 'Exfiltrate 200GB of trained weights from a cloud storage bucket.', icon: 'i-lucide-brain',           minAgents: 2, maxAgents: 3, durationMs: 14 * 60 * 60 * 1000, minPower: 340,   baseCash: [93_000,    218_000],   baseXP: 56,  baseGemChance: 0.18, baseGemCount: [1, 3],   itemDropChance: 0.32, itemDropRarity: 'specialist' },
  { id: 'central_bank',     name: 'Central Bank Tap',       description: 'Intercept SWIFT messages from a central bank.', flavor: 'Eavesdrop on interbank settlements for 10 hours.', icon: 'i-lucide-coins',           minAgents: 2, maxAgents: 3, durationMs: 15 * 60 * 60 * 1000, minPower: 470,   baseCash: [148_000,   346_000],   baseXP: 58,  baseGemChance: 0.20, baseGemCount: [1, 3],   itemDropChance: 0.32, itemDropRarity: 'specialist' },
  { id: 'black_site',       name: 'Black Site Raid',        description: 'Breach an off-books intelligence facility.', flavor: 'Exfiltrate AI research from a black-site data center.', icon: 'i-lucide-skull',           minAgents: 2, maxAgents: 4, durationMs: 18 * 60 * 60 * 1000, minPower: 650,   baseCash: [236_000,   550_000],   baseXP: 65,  baseGemChance: 0.25, baseGemCount: [2, 3],   itemDropChance: 0.35, itemDropRarity: 'specialist' },
  // ── Tier 5: Endgame (-45%) ──────────────────────────────────────────────────────
  { id: 'nsa_breach',       name: 'NSA Breach',             description: 'Penetrate the most defended network on the planet.', flavor: 'Access a signals intelligence feed from Fort Meade.', icon: 'i-lucide-satellite',       minAgents: 3, maxAgents: 4, durationMs: 22 * 60 * 60 * 1000, minPower: 900,   baseCash: [295_000,   690_000],   baseXP: 72,  baseGemChance: 0.32, baseGemCount: [2, 4],   itemDropChance: 0.38, itemDropRarity: 'specialist' },
  { id: 'ghost_protocol',   name: 'Ghost Protocol',         description: 'The most dangerous op in existence.', flavor: 'Infiltrate and extract from a sovereign-level cyber fortress.', icon: 'i-lucide-ghost',           minAgents: 3, maxAgents: 4, durationMs: 30 * 60 * 60 * 1000, minPower: 1_250, baseCash: [470_000,   1_100_000], baseXP: 80,  baseGemChance: 0.40, baseGemCount: [2, 4],  itemDropChance: 0.45, itemDropRarity: 'specialist' },
  { id: 'quantum_heist',    name: 'Quantum Heist',          description: 'Exploit a quantum computing lab for unbreakable access.', flavor: 'Crack post-quantum encryption using a hijacked QPU.', icon: 'i-lucide-cpu',             minAgents: 3, maxAgents: 4, durationMs: 40 * 60 * 60 * 1000, minPower: 1_750, baseCash: [750_000,   1_750_000], baseXP: 90,  baseGemChance: 0.55, baseGemCount: [2, 5],  itemDropChance: 0.50, itemDropRarity: 'elite' },
  { id: 'project_zero',     name: 'Project Zero',           description: 'Mythic-tier op. Requires full squad of 4.', flavor: 'Achieve zero-day persistent access to a nation-state AI system.', icon: 'i-lucide-target',          minAgents: 4, maxAgents: 4, durationMs: 56 * 60 * 60 * 1000, minPower: 2_444, baseCash: [1_200_000, 2_750_000], baseXP: 100, baseGemChance: 0.70, baseGemCount: [3, 6],  itemDropChance: 0.55, itemDropRarity: 'elite' },
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

export const CLASS_LABEL: Record<AgentClass, string> = { infiltrator: 'Infiltrator', cryptographer: 'Cryptographer', social_engineer: 'Social Engineer', bruteforce: 'Bruteforce' }
export const CLASS_ICON: Record<AgentClass, string> = { infiltrator: 'i-lucide-ghost', cryptographer: 'i-lucide-key', social_engineer: 'i-lucide-message-circle', bruteforce: 'i-lucide-zap' }
export const CLASS_PASSIVE: Record<AgentClass, { type: ModType; value: number; label: string }> = {
  infiltrator:     { type: 'speed_percent',  value: 0.10, label: '+10% op speed' },
  cryptographer:   { type: 'loot_percent',   value: 0.06, label: '+6% cash loot' },
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

export function xpToNextLevel(level: number): number { return 100 * level }
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
  speed_percent: { min: 3,     max: 10,    decimals: 0 },
  loot_percent:  { min: 3,     max: 6,     decimals: 0 },
  xp_boost:      { min: 20,    max: 100,   decimals: 0 },
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
  return `+${Math.round(value)}%`
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

export const MOD_RANGES: Record<ModType, { min: number; max: number; decimals: number }> = {
  loot_percent:       { min: 3,     max: 6,     decimals: 0 },
  speed_percent:      { min: 3,     max: 10,    decimals: 0 },
  xp_flat:            { min: 1,     max: 5,     decimals: 0 },
  gem_chance:         { min: 0.002, max: 0.015, decimals: 3 },
  power_flat:         { min: 5,     max: 25,    decimals: 0 },
}
export const MOD_LABEL: Record<ModType, string> = {
  loot_percent: 'Loot', speed_percent: 'Speed', xp_flat: 'XP',
  gem_chance: 'Gem Chance', power_flat: 'Power',
}
export function formatModValue(type: ModType, value: number): string {
  if (type === 'gem_chance') return `+${(value * 100).toFixed(1)}%`
  if (type === 'xp_flat') return `+${value} XP`
  if (type === 'power_flat') return `+${Math.round(value)}`
  return `+${Math.round(value)}%`
}

export const RARITY_MOD_COUNT: Record<HackRarity, number> = { ghost: 1, operative: 2, specialist: 3, elite: 4, phantom: 5 }

const ITEM_SLOTS: ItemSlot[] = ['tool', 'software', 'hardware']
const ALL_MOD_TYPES: ModType[] = ['loot_percent', 'speed_percent', 'xp_flat', 'gem_chance', 'power_flat']
const TOOL_NAMES = ['USB Infiltrator', 'Signal Probe', 'Ghost Tap', 'Neural Sniffer', 'Quantum Spike', 'Black Tap', 'Phantom Drive', 'Cipher Key']
const SOFTWARE_NAMES = ['Zero Day Exploit', 'Polymorphic Shell', 'Ghost Suite', 'Darknet Relay', 'Neural Bypass', 'Stealth Daemon', 'AI Decryptor', 'Recursive Worm']
const HARDWARE_NAMES = ['Black Ice Rig', 'Signal Scrambler', 'Neural Implant', 'Optical Jammer', 'Dark Server', 'Void Terminal', 'Quantum Node', 'Stealth Array']
const RARITY_PREFIX: Record<HackRarity, string> = { ghost: '', operative: 'Improved ', specialist: 'Advanced ', elite: 'Military-Grade ', phantom: 'Mythic ' }

function pickRandom<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]! }

function generateItemName(slot: ItemSlot, rarity: HackRarity): string {
  const pool = slot === 'tool' ? TOOL_NAMES : slot === 'software' ? SOFTWARE_NAMES : HARDWARE_NAMES
  return RARITY_PREFIX[rarity] + pickRandom(pool)
}

export function generateItem(rarity: HackRarity, itemLevel: number, slot?: ItemSlot): HackItemDef {
  const s = slot ?? pickRandom(ITEM_SLOTS)
  const modCount = RARITY_MOD_COUNT[rarity]
  const available = [...ALL_MOD_TYPES]
  const mods: ItemMod[] = []
  for (let i = 0; i < modCount && available.length > 0; i++) {
    const idx = Math.floor(Math.random() * available.length)
    const type = available.splice(idx, 1)[0]!
    const range = MOD_RANGES[type]
    const raw = range.min + Math.random() * (range.max - range.min)
    const factor = Math.pow(10, range.decimals)
    mods.push({ type, value: Math.round(raw * factor) / factor })
  }
  return { name: generateItemName(s, rarity), slot: s, itemLevel, rarity, mods }
}

export const AGENT_CODENAMES = [
  'Cipher', 'Phantom', 'Ghost', 'Wraith', 'Viper', 'Shadow', 'Nexus', 'Static',
  'Hydra', 'Void', 'Specter', 'Rogue', 'Neon', 'Glitch', 'Byte', 'Root',
  'Kernel', 'Vector', 'Daemon', 'Proxy', 'Null', 'Hex', 'Zero', 'Stack',
]
const AGENT_CLASSES: AgentClass[] = ['infiltrator', 'cryptographer', 'social_engineer', 'bruteforce']

export function generateAgentDef(rarity: HackRarity, takenNames: string[] = []) {
  const available = AGENT_CODENAMES.filter(n => !takenNames.includes(n))
  let name: string
  if (available.length > 0) {
    name = pickRandom(available)
  } else {
    // All base names taken — add numeric suffix
    let base = pickRandom(AGENT_CODENAMES)
    let suffix = 2
    while (takenNames.includes(`${base}-${suffix}`)) suffix++
    name = `${base}-${suffix}`
  }
  return { name, class: pickRandom(AGENT_CLASSES), rarity, level: 1, xp: 0, traits: generateAgentTraits(rarity) }
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

export const AGENT_PULL_TIERS: AgentPullTier[] = [
  { id: 'basic',    name: 'Script Pull',    description: 'Forum talent. Mostly rookies, sometimes a gem.', currency: 'cash', cost: 12_000,     weights: { ghost: 60, operative: 35, specialist: 5, elite: 0, phantom: 0 } },
  { id: 'advanced', name: 'Dark Web Hire',  description: 'Underground operators. Better odds, real skill.', currency: 'cash', cost: 200_000,    weights: { ghost: 15, operative: 42, specialist: 32, elite: 9, phantom: 2 } },
  { id: 'elite',    name: 'Ghost Recruit',  description: 'No rookies. Elite operators only — worth every cent.', currency: 'cash', cost: 3_500_000,  weights: { ghost: 0, operative: 8, specialist: 32, elite: 42, phantom: 18 } },
]

// Backward-compat alias used by older API code
export const RECRUIT_TIERS = AGENT_PULL_TIERS
export type RecruitTier = AgentPullTier

// ─── Item pulls ───────────────────────────────────────────────────────────────
export interface ItemPullTier {
  id: string; name: string; description: string
  cost: number
  weights: Record<HackRarity, number>
  minItemLevel: number; maxItemLevel: number
}

export const ITEM_PULL_TIERS: ItemPullTier[] = [
  { id: 'junk',        name: 'Junk Cache',     description: 'Salvaged trash. Sometimes useful.',        cost: 5_000,     weights: { ghost: 65, operative: 30, specialist: 5, elite: 0, phantom: 0 }, minItemLevel: 1, maxItemLevel: 4 },
  { id: 'standard',    name: 'Standard Crate', description: 'Reliable mid-tier equipment.',             cost: 40_000,    weights: { ghost: 20, operative: 45, specialist: 30, elite: 4, phantom: 1 }, minItemLevel: 3, maxItemLevel: 8 },
  { id: 'premium',     name: 'Premium Stash',  description: 'High-end gear. Rare mods possible.',       cost: 300_000,   weights: { ghost: 0, operative: 18, specialist: 45, elite: 32, phantom: 5 }, minItemLevel: 6, maxItemLevel: 14 },
  { id: 'ghost_cache', name: 'Ghost Cache',    description: 'Ultra-rare haul. Elite or Phantom only.',  cost: 2_000_000, weights: { ghost: 0, operative: 0, specialist: 20, elite: 50, phantom: 30 }, minItemLevel: 12, maxItemLevel: 20 },
]

export function rollItemFromTier(tier: ItemPullTier, avgAgentLevel: number): HackItemDef {
  const rarity = rollRarity(tier.weights)
  const levelBonus = Math.floor(avgAgentLevel / 5)
  const rawLevel = tier.minItemLevel + Math.floor(Math.random() * (tier.maxItemLevel - tier.minItemLevel + 1))
  const itemLevel = Math.min(20, rawLevel + levelBonus)
  return generateItem(rarity, itemLevel)
}

// ─── Roster expansion ─────────────────────────────────────────────────────────
// Cost to expand roster from current size to next (index = currentSlots - 2).
// This is the main long-term cash sink — each extra agent slot multiplies how many
// ops you can run in parallel, so it scales hard against the op income ladder.
// 2→3: 150k · 3→4: 1.2M · 4→5: 10M · 5→6: 60M
export const ROSTER_EXPAND_COSTS = [150_000, 1_200_000, 10_000_000, 60_000_000]
export const MAX_ROSTER_SLOTS = 6
export const MAX_INVENTORY_SLOTS = 15

// ─── Power calculation ────────────────────────────────────────────────────────
export function agentPower(
  agent: { level: number; class: AgentClass },
  items: Array<{ itemLevel: number; mods: ItemMod[] }>,
  traits?: AgentTrait[],
): number {
  const passive = CLASS_PASSIVE[agent.class]
  const classPower = passive.type === 'power_flat' ? passive.value : 0
  const base = agent.level * 10 + classPower
  const itemPower = items.reduce((sum, item) => {
    return sum + item.itemLevel * 2 + item.mods.filter(m => m.type === 'power_flat').reduce((s, m) => s + m.value, 0)
  }, 0)
  const traitFlat = (traits ?? []).filter(t => t.type === 'power_flat').reduce((s, t) => s + t.value, 0)
  // Power % traits multiply the agent's whole flat power, so the bonus scales with
  // how invested the agent is — no fixed bonus you could exploit at low power.
  const traitPct = (traits ?? []).filter(t => t.type === 'power_percent').reduce((s, t) => s + t.value, 0) / 100
  return Math.round((base + itemPower + traitFlat) * (1 + traitPct))
}

// ─── Op speed ─────────────────────────────────────────────────────────────────
// There is no hard cap on a single agent's speed — instead the sources are tuned so
// ~50% is the natural ceiling a perfect agent can reach: a maxed infiltrator with
// three 10% speed items (30%) + the 10% class passive + a 10% speed trait = 50%.
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

export interface OpReward { success: boolean; cash: number; gems: number; item: HackItemDef | null; inventoryFull: boolean }

// ─── Loot ─────────────────────────────────────────────────────────────────────
// Loot is computed per agent (own gear loot mods + class passive + loot traits) and
// summed across the squad. There is no hard cap — the sources are tuned so ~30% is
// the natural ceiling a single agent can reach: three 6% loot items (18%) + the 6%
// cryptographer class passive + a 6% loot trait = 30%. A full 4-agent squad therefore
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
 * agent levels from its OWN xp_boost trait (capped at +100% by the trait range) and
 * its OWN equipped xp_flat gear. A failed op still grants a flat 30% of base XP.
 */
export function agentXpGain(
  template: OpTemplate,
  agent: { traits?: AgentTrait[]; items: Array<{ mods: ItemMod[] }> },
  success: boolean,
): number {
  if (!success) return Math.floor(template.baseXP * 0.3)
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
    // Flat extra gems from the Bonus Gems trait — only paid out when the op rolls gems.
    gemBonus:  allTraits.filter(t => t.type === 'gem_bonus').reduce((s, t) => s + t.value, 0),
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
    return { success: false, cash: 0, gems: 0, item: null, inventoryFull: false }
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
  const wouldDropItem = Math.random() < template.itemDropChance
  const item = wouldDropItem && !inventoryFull
    ? generateItem(template.itemDropRarity, Math.max(1, Math.round(agents.reduce((s, a) => s + a.level, 0) / agents.length)))
    : null
  return { success: true, cash, gems, item, inventoryFull: wouldDropItem && inventoryFull }
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

export function itemSellPrice(rarity: HackRarity, itemLevel: number): number {
  const mult: Record<HackRarity, number> = { ghost: 1, operative: 2.5, specialist: 8, elite: 25, phantom: 100 }
  return Math.round(300 * mult[rarity] * (1 + itemLevel * 0.25))
}

// Kept for any code that still calls generateShopItems (can be removed later)
export function generateShopItems(_count = 4): ShopItemDef[] { return [] }
