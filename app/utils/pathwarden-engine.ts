import {
  PATHWARDEN_DEFENSE_BLUEPRINTS,
  type PathwardenDefenseArchetype,
  type PathwardenDefenseBlueprint,
  type PathwardenDefenseFamily
} from '#shared/utils/gamelogic/pathwarden'
import {
  createPathwardenMapPlan,
  hashPathwardenMapPlan
} from '#shared/utils/gamelogic/pathwarden-map'
import { pathwardenRouteHealthMultiplier } from '#shared/utils/gamelogic/pathwarden-simulator'
import { validatePathwardenMapPlan } from '#shared/utils/gamelogic/pathwarden-map-validation'
import type {
  PathwardenFeatureKind,
  PathwardenGameState,
  PathwardenMapPlan
} from '#shared/types/pathwarden-save'

const WIDTH = 1200
const HEIGHT = 760
const COLS = 161
const ROWS = 161
const TILE_WIDTH = 108
const TILE_HEIGHT = 58
const WORLD_CELL = 80
const ORIGIN_X = WIDTH / 2
const ORIGIN_Y = HEIGHT * 0.55 - Math.floor(ROWS / 2) * TILE_HEIGHT
const DEFAULT_WORLD_SCALE = 1.42
const WORLD_VIEW_CENTER = { x: WIDTH / 2, y: HEIGHT * 0.49 }
const EXPANSION_DEPTH = 13

export type PathwardenTowerType = string
export type PathwardenUpgrade = 'damage' | 'range' | 'interest' | 'fortify' | 'haste' | 'bounty'
export type PathwardenRelicRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'mythic'
export type PathwardenRelicFamily =
  | 'fire' | 'frost' | 'storm' | 'venom' | 'blast'
  | 'leech' | 'pierce' | 'chain' | 'gale' | 'radiant'
  | 'heart' | 'repair' | 'bounty' | 'haste' | 'range'
export type PathwardenRelicElement = 'fire' | 'frost' | 'lightning' | 'poison' | 'sun' | 'arcane'
type PathwardenGlobalRelicFamily = 'heart' | 'repair' | 'bounty' | 'haste' | 'range'
export type PathwardenPhase = 'planning' | 'wave' | 'checkpoint' | 'path' | 'upgrade' | 'cashout' | 'victory' | 'defeat'
export type PathwardenTargeting = 'first' | 'strong' | 'fast'

export interface PathwardenRelicEffects {
  directDamagePct: number
  burnPct: number
  burnDuration: number
  slowPct: number
  slowDuration: number
  chainCount: number
  chainRetentionPct: number
  impactRadius: number
  impactDamagePct: number
  repairPct: number
  armorPiercePct: number
  echoEveryShots: number
  echoPowerPct: number
  attackSpeedPct: number
  rangePct: number
  aetherBonusPct: number
  keepHealPct: number
}

export interface PathwardenRelic {
  id: string
  family: PathwardenRelicFamily
  element: PathwardenRelicElement
  rarity: PathwardenRelicRarity
  name: string
  description: string
  towerSpecific: boolean
  iconIndex: number
  power: number
  sellValue: number
  color: string
  effects: PathwardenRelicEffects
}

export interface PathwardenInventoryRelic extends PathwardenRelic {
  instanceId: number
  variationSeed: number
  damageFactor: number
  baseEffects: PathwardenRelicEffects
}

export interface PathwardenRelicProfile {
  family: PathwardenRelicFamily
  name: string
  description: string
  iconIndex: number
}

const RELIC_RARITIES: Array<{ id: PathwardenRelicRarity, label: string, power: number, sell: number }> = [
  { id: 'common', label: 'Worn', power: 1, sell: 15 },
  { id: 'uncommon', label: 'Runed', power: 1.45, sell: 25 },
  { id: 'rare', label: 'Royal', power: 2.1, sell: 45 },
  { id: 'epic', label: 'Elder', power: 3.1, sell: 80 },
  { id: 'mythic', label: 'Mythic', power: 4.6, sell: 140 }
]

const RELIC_FAMILIES: Array<{
  id: PathwardenRelicFamily
  element: PathwardenRelicElement
  name: string
  towerSpecific: boolean
  description: (power: number) => string
}> = [
  { id: 'fire', element: 'fire', name: 'Flame Arrows', towerSpecific: true, description: power => `Burns for ${Math.round(18 * power)}% base damage over 3s · +${Math.round(6 * power)}% direct damage.` },
  { id: 'frost', element: 'frost', name: 'Rime Arrows', towerSpecific: true, description: power => `Slows by ${Math.round(22 + 4 * power)}% for 2s · +${Math.round(4 * power)}% direct damage.` },
  { id: 'storm', element: 'lightning', name: 'Lightning Arc Arrows', towerSpecific: true, description: power => `Jumps to ${Math.min(5, 1 + Math.floor(power))} nearby foes; each jump retains ${Math.round(58 - power * 2)}% power.` },
  { id: 'venom', element: 'poison', name: 'Venom Heads', towerSpecific: true, description: power => `Poisons for ${Math.round(24 * power)}% base damage over 4s · +${Math.round(3 * power)}% direct damage.` },
  { id: 'blast', element: 'fire', name: 'Explosive Arrows', towerSpecific: true, description: power => `${Math.round(46 + power * 8)} feet impact burst · +${Math.round(6 * power)}% direct damage.` },
  { id: 'leech', element: 'arcane', name: 'Sanguine Tips', towerSpecific: true, description: power => `Each hit repairs ${(0.12 * power).toFixed(2)}% keep health · +${Math.round(4 * power)}% damage.` },
  { id: 'pierce', element: 'arcane', name: 'Kingsbane Heads', towerSpecific: true, description: power => `Ignores armor and deals +${Math.round(10 * power)}% damage; double bonus against brutes and bosses.` },
  { id: 'chain', element: 'lightning', name: 'Lightning Paralysis Arrows', towerSpecific: true, description: power => `Every fourth shot echoes at ${Math.round(42 + power * 6)}% power.` },
  { id: 'gale', element: 'arcane', name: 'Gale Fletching', towerSpecific: true, description: power => `This defense attacks ${Math.round(7 * power)}% faster and deals +${Math.round(2 * power)}% damage.` },
  { id: 'radiant', element: 'sun', name: 'Sun Ray Arrows', towerSpecific: true, description: power => `Radiant hit bursts for ${Math.round(28 * power)}% damage to foes within ${Math.round(52 + power * 7)} feet.` },
  { id: 'heart', element: 'arcane', name: 'Keepheart', towerSpecific: false, description: power => `Immediately restore ${Math.round(3 * power)} keep hearts.` },
  { id: 'repair', element: 'arcane', name: 'Restorer’s Oath', towerSpecific: false, description: power => `Kills permanently restore ${(0.1 * power).toFixed(2)}% keep health.` },
  { id: 'bounty', element: 'arcane', name: 'Verdant Bounty', towerSpecific: false, description: power => `Gain +${Math.round(12 * power)}% Aether from defeated enemies.` },
  { id: 'haste', element: 'arcane', name: 'Hourglass Sigil', towerSpecific: false, description: power => `All defenses attack ${Math.round(8 * power)}% faster.` },
  { id: 'range', element: 'arcane', name: 'Mistglass Lens', towerSpecific: false, description: power => `All defenses gain ${Math.round(7 * power)}% range.` }
]

export const PATHWARDEN_RARITY_COLORS: Record<PathwardenRelicRarity, string> = {
  common: '#94a3b8',
  uncommon: '#60a5fa',
  rare: '#c084fc',
  epic: '#f59e0b',
  mythic: '#fef08a'
}

const emptyRelicEffects = (): PathwardenRelicEffects => ({
  directDamagePct: 0,
  burnPct: 0,
  burnDuration: 0,
  slowPct: 0,
  slowDuration: 0,
  chainCount: 0,
  chainRetentionPct: 0,
  impactRadius: 0,
  impactDamagePct: 0,
  repairPct: 0,
  armorPiercePct: 0,
  echoEveryShots: 0,
  echoPowerPct: 0,
  attackSpeedPct: 0,
  rangePct: 0,
  aetherBonusPct: 0,
  keepHealPct: 0
})

function relicEffectsFor(family: PathwardenRelicFamily, power: number, variation = 1): PathwardenRelicEffects {
  const effects = emptyRelicEffects()
  const directDamageRates: Partial<Record<PathwardenRelicFamily, number>> = { fire: 6, frost: 4, storm: 3, venom: 3, blast: 6, leech: 4, pierce: 10, chain: 2, gale: 2, radiant: 4 }
  effects.directDamagePct = (directDamageRates[family] ?? 0) * power * variation
  if (family === 'fire') {
    effects.burnPct = 18 * power * variation
    effects.burnDuration = 3 * variation
  } else if (family === 'frost') {
    effects.slowPct = (22 + 4 * power) * variation
    effects.slowDuration = 2 * variation
  } else if (family === 'storm') {
    effects.chainCount = Math.min(5, 1 + Math.floor(power * variation))
    effects.chainRetentionPct = (58 - power * 2) * variation
  } else if (family === 'venom') {
    effects.burnPct = 24 * power * variation
    effects.burnDuration = 4 * variation
  } else if (family === 'blast') {
    effects.impactRadius = 46 + power * 8 * variation
    effects.impactDamagePct = 6 * power * variation
  } else if (family === 'leech') {
    effects.repairPct = 0.12 * power * variation
  } else if (family === 'pierce') {
    effects.armorPiercePct = 100 * variation
  } else if (family === 'chain') {
    effects.echoEveryShots = 4
    effects.echoPowerPct = (42 + power * 6) * variation
  } else if (family === 'gale') {
    effects.attackSpeedPct = 7 * power * variation
  } else if (family === 'radiant') {
    effects.impactDamagePct = 28 * power * variation
    effects.impactRadius = 52 + power * 7 * variation
  } else if (family === 'heart') {
    effects.keepHealPct = 3 * power * variation
  } else if (family === 'repair') {
    effects.repairPct = 0.1 * power * variation
  } else if (family === 'bounty') {
    effects.aetherBonusPct = 12 * power * variation
  } else if (family === 'haste') {
    effects.attackSpeedPct = 8 * power * variation
  } else if (family === 'range') {
    effects.rangePct = 7 * power * variation
  }
  return effects
}

function relicColorFor(family: PathwardenRelicFamily, rarity: PathwardenRelicRarity) {
  const familyColor: Partial<Record<PathwardenRelicFamily, string>> = {
    fire: '#fb7185',
    frost: '#a5f3fc',
    storm: '#fde047',
    venom: '#86efac',
    blast: '#fb923c',
    leech: '#f0abfc',
    pierce: '#c4b5fd',
    chain: '#facc15',
    gale: '#99f6e4',
    radiant: '#fef3c7',
    heart: '#fda4af',
    repair: '#86efac',
    bounty: '#bef264',
    haste: '#93c5fd',
    range: '#c4b5fd'
  }
  const base = familyColor[family] ?? PATHWARDEN_RARITY_COLORS[rarity]
  return base
}

function cloneRelicEffects(effects: PathwardenRelicEffects): PathwardenRelicEffects {
  return { ...effects }
}

function scaleRelicEffects(effects: PathwardenRelicEffects, factor: number): PathwardenRelicEffects {
  return Object.fromEntries(Object.entries(effects).map(([key, value]) => [key, value * factor])) as unknown as PathwardenRelicEffects
}

function addRelicEffects(target: PathwardenRelicEffects, source: PathwardenRelicEffects) {
  for (const key of Object.keys(target) as Array<keyof PathwardenRelicEffects>) {
    target[key] += source[key]
  }
  return target
}

function variedRelicEffects(template: PathwardenRelic, variationSeed: number) {
  const variation = 0.94 + (Math.abs(Math.sin(variationSeed * 12.9898)) % 0.12)
  return relicEffectsFor(template.family, template.power, variation)
}

export function describeRelicEffects(effects: PathwardenRelicEffects) {
  const parts: string[] = []
  const pct = (value: number) => `${value.toFixed(1)}%`
  if (effects.directDamagePct) parts.push(`+${pct(effects.directDamagePct)} direct damage`)
  if (effects.burnPct) parts.push(`+${pct(effects.burnPct)} burn for ${effects.burnDuration.toFixed(1)}s`)
  if (effects.slowPct) parts.push(`-${pct(effects.slowPct)} speed for ${effects.slowDuration.toFixed(1)}s`)
  if (effects.chainCount) parts.push(`${Math.round(effects.chainCount)} chain target${effects.chainCount === 1 ? '' : 's'}`)
  if (effects.chainRetentionPct) parts.push(`${pct(effects.chainRetentionPct)} chain retention`)
  if (effects.impactRadius) parts.push(`${Math.round(effects.impactRadius)} impact radius`)
  if (effects.impactDamagePct) parts.push(`+${pct(effects.impactDamagePct)} impact damage`)
  if (effects.repairPct) parts.push(`+${pct(effects.repairPct)} repair`)
  if (effects.armorPiercePct) parts.push(`${pct(effects.armorPiercePct)} armor pierce`)
  if (effects.echoEveryShots) parts.push(`echo every ${Math.round(effects.echoEveryShots)} shots at ${pct(effects.echoPowerPct)}`)
  if (effects.attackSpeedPct) parts.push(`+${pct(effects.attackSpeedPct)} attack speed`)
  if (effects.rangePct) parts.push(`+${pct(effects.rangePct)} range`)
  if (effects.aetherBonusPct) parts.push(`+${pct(effects.aetherBonusPct)} Aether`)
  if (effects.keepHealPct) parts.push(`+${pct(effects.keepHealPct)} keep healing`)
  return parts.join(' · ')
}

export const PATHWARDEN_RELICS: PathwardenRelic[] = RELIC_FAMILIES.flatMap((family, iconIndex) =>
  RELIC_RARITIES.map(rarity => ({
    id: `${family.id}-${rarity.id}`,
    family: family.id,
    element: family.element,
    rarity: rarity.id,
    name: `${rarity.label} ${family.name}`,
    description: family.description(rarity.power),
    towerSpecific: family.towerSpecific,
    iconIndex,
    power: rarity.power,
    sellValue: rarity.sell,
    color: relicColorFor(family.id, rarity.id),
    effects: relicEffectsFor(family.id, rarity.power)
  })))

export function pathwardenRelicProfile(family: PathwardenRelicFamily, power: number): PathwardenRelicProfile {
  const familyIndex = RELIC_FAMILIES.findIndex(candidate => candidate.id === family)
  const definition = RELIC_FAMILIES[familyIndex] ?? RELIC_FAMILIES[0]!
  return {
    family,
    name: definition.name,
    description: definition.description(power),
    iconIndex: familyIndex >= 0 ? familyIndex : 0
  }
}

interface Point { x: number, y: number }
interface GridPoint { col: number, row: number }
interface PathChoice {
  id: string
  terminal?: boolean
  parentId: string | null
  depth: number
  source: GridPoint
  anchor: GridPoint
  cells: GridPoint[]
  links?: RoadLink[]
  revealCells?: GridPoint[]
  roomId?: string
  exitCells?: GridPoint[]
  previewCells?: GridPoint[]
}
export type PathwardenGalleryCategory = 'environment' | 'scene' | 'defense' | 'enemy' | 'idle'
interface RoadLink { from: GridPoint, to: GridPoint }
interface Tower extends GridPoint {
  id: number
  type: PathwardenTowerType
  invested: number
  cooldown: number
  angle: number
  level: number
  merges: number
  recoil: number
  targeting: PathwardenTargeting
  relicFamily?: PathwardenRelicFamily
  relicId?: string
  relicStacks: number
  relicPower: number
  relicShots: number
  relicEntity?: PathwardenInventoryRelic
  relicEntities?: PathwardenInventoryRelic[]
}
type EnemyType = 'raider' | 'runner' | 'brute' | 'shaman' | 'boss'
interface Enemy {
  id: number
  type: EnemyType
  route: GridPoint[]
  exitKey: string
  progress: number
  hp: number
  maxHp: number
  speed: number
  reward: number
  radius: number
  slow: number
  slowTimer: number
  healTimer: number
  color: string
  hitFlash: number
  attackTimer: number
  dotDamage: number
  dotTimer: number
  dotTick: number
  debugWorldPosition?: Point
  debugScreenPosition?: Point
}
interface Projectile extends Point {
  type: PathwardenTowerType
  targetPosition?: Point
  relicFamily?: PathwardenRelicFamily
  relicPower: number
  relicEffects?: PathwardenRelicEffects
  echo: boolean
  targetId: number
  damage: number
  speed: number
  splash: number
  splashFactor: number
  slow: number
  color: string
  size: number
  trail: Point[]
  origin: Point
  age: number
  duration: number
  arcHeight: number
}
interface TowerGeometry {
  screen: Point
  foot: Point
  weaponPivot: Point
  muzzle: Point
  width: number
  height: number
}
interface Particle extends Point {
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  gravity: number
}
interface FloatingText extends Point {
  text: string
  life: number
  maxLife: number
  color: string
  size: number
  screenSpace?: boolean
}
interface Shockwave extends Point {
  radius: number
  maxRadius: number
  life: number
  color: string
}
interface Ashflake {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  maxLife: number
  rotation: number
  spin: number
}
interface TowerDrag {
  towerId: number
  startX: number
  startY: number
  active: boolean
}
interface FailedPlacement {
  cell: GridPoint
  type: PathwardenTowerType
  shortfall: number
  life: number
  maxLife: number
}
type AmbientKind =
  | 'crew'
  | 'patrol'
  | 'peddler'
  | 'bird'
  | 'cat'
  | 'market'
  | 'picnic'
  | 'hunt'
  | 'musician'
  | 'children'
  | 'shepherd'
interface AmbientActor {
  id: number
  storyId: number
  blockKey: string
  kind: AmbientKind
  age: number
  duration: number
  seed: number
  countsForProgress: boolean
}

const AMBIENT_FAMILIES: Array<{ name: string, kind: AmbientKind }> = [
  { name: 'Market day', kind: 'market' },
  { name: 'Hunter and deer', kind: 'hunt' },
  { name: 'Lovers’ picnic', kind: 'picnic' },
  { name: 'Travelling musician', kind: 'musician' },
  { name: 'Children at play', kind: 'children' },
  { name: 'Shepherd’s crossing', kind: 'shepherd' },
  { name: 'Guard patrol', kind: 'patrol' },
  { name: 'Peddler', kind: 'peddler' },
  { name: 'Construction crew', kind: 'crew' },
  { name: 'Cat business', kind: 'cat' },
  { name: 'Bird life', kind: 'bird' },
  { name: 'Dog and courier', kind: 'peddler' },
  { name: 'Bakers’ delivery', kind: 'market' },
  { name: 'Fisher’s tale', kind: 'peddler' },
  { name: 'Lost chicken', kind: 'children' },
  { name: 'Knight training', kind: 'patrol' },
  { name: 'Herbalist', kind: 'crew' },
  { name: 'Pilgrim procession', kind: 'shepherd' },
  { name: 'Rainy scramble', kind: 'market' },
  { name: 'Festival rehearsal', kind: 'musician' },
  { name: 'Scholar and apprentice', kind: 'crew' },
  { name: 'Beekeeper', kind: 'market' },
  { name: 'Tiny creatures', kind: 'cat' },
  { name: 'Royal inspection', kind: 'patrol' },
  { name: 'Midnight oddities', kind: 'bird' }
]

const AMBIENT_STORY_COUNT = AMBIENT_FAMILIES.length * 10

export interface PathwardenSnapshot {
  phase: PathwardenPhase
  introStoryActive: boolean
  introStoryIndex: number
  introStoryOpacity: number
  activeRunScene: boolean
  activeRunSceneProgress: number
  openingCinematic: boolean
  openingCinematicProgress: number
  wave: number
  lives: number
  aether: number
  coinsEarned: number
  realm: number
  flawlessWaves: number
  score: number
  enemies: number
  towers: number
  streak: number
  selectedTower: PathwardenTowerType
  towerCosts: Record<PathwardenTowerType, number>
  paused: boolean
  relicRanks: Record<Exclude<PathwardenUpgrade, 'fortify'>, number>
  nextWave: {
    number: number
    enemies: number
    exits: number
    checkpoint: boolean
    threats: string[]
  }
  message: string
  selectedBuilding: PathwardenBuilding | null
  relicInventory: PathwardenInventoryRelic[]
  canSellRelics: boolean
}

export interface PathwardenBuilding {
  id: number
  type: PathwardenTowerType
  name: string
  level: number
  merges: number
  invested: number
  archetype: PathwardenDefenseArchetype
  family: PathwardenDefenseFamily
  tier: number
  elevation: number
  damage: number
  range: number
  rate: number
  salvage: number
  targeting: PathwardenTargeting
  relicFamily?: PathwardenRelicFamily
  relicId?: string
  relicStacks: number
  relicPower: number
  relicName: string
  relicDescription: string
  relicIconIndex: number
  relicEntity?: PathwardenInventoryRelic
  relicEntities?: PathwardenInventoryRelic[]
  relicEffects: PathwardenRelicEffects
  relicColor: string
  globalRelics: Array<{
    family: PathwardenRelicFamily
    name: string
    description: string
    level: number
    power: number
    iconIndex: number
    effects: PathwardenRelicEffects
    color: string
  }>
}

export interface PathwardenRelicSwapPreview {
  towerId: number
  relicInstanceId: number
  towerLevel: number
  existingFamily: PathwardenRelicFamily
  incomingFamily: PathwardenRelicFamily
  existingElement: PathwardenRelicElement
  incomingElement: PathwardenRelicElement
  existingName: string
  incomingName: string
  existingPower: number
  incomingPower: number
  existingIconIndex: number
  incomingIconIndex: number
  existingStacks: number
  bindChance: number
  preserveChance: number
  stackedLossChance: number
  availableAether: number
}

export interface PathwardenRelicSwapResult {
  success: boolean
  bindingSucceeded: boolean
  incomingName: string
  oldRelicName: string
  oldStacks: number
  recoveredStacks: number
  recoveredRelicPower: number
  preservedRelicIndices: number[]
  preserved: boolean
  message: string
  aetherSpent: number
  bindingChance: number
  preserveChance: number
}

export type PathwardenRelicSwapFocus = 'binding' | 'preservation' | 'both'

export interface PathwardenRelicSwapInvestment {
  amount: number
  focus: PathwardenRelicSwapFocus
  bonus: number
}

export interface PathwardenRelicSwapDebugScenario {
  existingRelicId: string
  incomingRelicId: string
  towerLevel: number
  stacks: number
}

export interface PathwardenCallbacks {
  onState: (state: PathwardenSnapshot) => void
  onUpgrade: (choices: PathwardenRelic[]) => void
  onGameOver: (won: boolean, state: PathwardenSnapshot) => void
  onAmbientStoryComplete?: (storyId: number) => void
  onOpenBuildingInventory?: () => void
  onOpenArcanistWorkbench?: (preview: PathwardenRelicSwapPreview) => void
}

export interface PathwardenEngineRestore {
  mapPlan: PathwardenMapPlan
  gameState: PathwardenGameState
}

export interface PathwardenBoostEffects {
  startingLives: number
  startingAether: number
  damageMultiplier: number
  rangeMultiplier: number
  rateMultiplier: number
  bountyMultiplier: number
  arcanistLevel: number
}

interface PathwardenTowerStats {
  name: string
  cost: number
  damage: number
  range: number
  rate: number
  projectileSpeed: number
  splash: number
  slow: number
  color: string
}

function defenseTowerStats(defense: PathwardenDefenseBlueprint): PathwardenTowerStats {
  return {
    name: defense.name,
    cost: defense.aetherCost,
    damage: defense.damage,
    range: defense.range,
    rate: defense.rate,
    projectileSpeed: defense.projectileSpeed,
    splash: defense.splash,
    slow: defense.slow,
    color: defense.color
  }
}

export const PATHWARDEN_TOWERS: Record<PathwardenTowerType, PathwardenTowerStats> = Object.fromEntries(
  PATHWARDEN_DEFENSE_BLUEPRINTS.map(defense => [defense.id, defenseTowerStats(defense)])
)

function towerStats(type: PathwardenTowerType) {
  return PATHWARDEN_TOWERS[type] ?? PATHWARDEN_TOWERS.bolt!
}

export const PATHWARDEN_UPGRADE_NAMES: Record<PathwardenUpgrade, string> = {
  damage: 'Sharpened Stars',
  range: 'Far-Seer Runes',
  interest: 'Aether Crucible',
  fortify: 'Stoneheart Oath',
  haste: 'Clockwork Winches',
  bounty: 'Hunter’s Brand'
}

const ASSET_ROOT = '/games/pathwarden/kenney'

function cellKey(point: GridPoint) {
  return `${point.col}:${point.row}`
}

function worldCenter(point: GridPoint): Point {
  return { x: point.col * WORLD_CELL + WORLD_CELL / 2, y: point.row * WORLD_CELL + WORLD_CELL / 2 }
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function colorMix(base: string, accent: string, amount: number) {
  const channel = (color: string, offset: number) => Number.parseInt(color.slice(offset, offset + 2), 16)
  const mixed = [1, 3, 5].map(offset =>
    Math.round(channel(base, offset) * (1 - amount) + channel(accent, offset) * amount)
      .toString(16)
      .padStart(2, '0'))
  return `#${mixed.join('')}`
}

function towerLevelPower(level: number) {
  return level === 3 ? 3.35 : level === 2 ? 1.85 : 1
}

function shuffle<T>(values: T[]) {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1))
    const current = copy[index]!
    copy[index] = copy[swap]!
    copy[swap] = current
  }
  return copy
}

export class PathwardenEngine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private callbacks: PathwardenCallbacks
  private assets: Record<string, HTMLImageElement> = {}
  private animationFrame = 0
  private lastFrame = 0
  private running = false
  private destroyed = false
  private paused = false
  private phase: PathwardenPhase = 'planning'
  private wave = 0
  private lives = 20
  private maxLives = 20
  private aether = 205
  private coinsEarned = 0
  private realm = 1
  private flawlessWaves = 0
  private waveStartingLives = 20
  private score = 0
  private streak = 0
  private streakTimer = 0
  private selectedTower: PathwardenTowerType = 'bolt'
  private towerPurchases: Record<PathwardenTowerType, number> = Object.fromEntries(
    PATHWARDEN_DEFENSE_BLUEPRINTS.map(defense => [defense.id, 0])
  )

  private relicRanks: Record<Exclude<PathwardenUpgrade, 'fortify'>, number> = {
    damage: 0,
    range: 0,
    interest: 0,
    haste: 0,
    bounty: 0
  }

  private globalRelics: Partial<Record<PathwardenGlobalRelicFamily, { level: number, power: number, effects: PathwardenRelicEffects, color: string }>> = {}

  private message = 'Raise your first defenses, then summon the horde.'
  private towerId = 1
  private enemyId = 1
  private spawnLeft = 0
  private spawnTotal = 0
  private spawnTimer = 0
  private damageMultiplier = 1
  private rangeMultiplier = 1
  private rateMultiplier = 1
  private interest = 0
  private bountyMultiplier = 1
  private arcanistLevel = 0
  private shake = 0
  private redFlash = 0
  private waveBanner = 0
  private mapSeed = globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ?? Date.now()
  private mapRandomState = this.mapSeed
  private mapPlan: PathwardenMapPlan = createPathwardenMapPlan({
    seed: this.mapSeed,
    realm: 1,
    maxDepth: EXPANSION_DEPTH
  })

  private elevations = this.createElevations()

  private path: GridPoint[] = this.castlePath()

  private initialPath = this.path.map(point => ({ ...point }))

  private branchRoads: GridPoint[] = []
  private branchLinks: RoadLink[] = []

  private revealed = new Set<string>()
  private pathChoices: PathChoice[] = []
  private plannedSections: PathChoice[] = []
  private claimedSections = new Set<PathChoice>()
  private towers: Tower[] = []
  private enemies: Enemy[] = []
  private projectiles: Projectile[] = []
  private particles: Particle[] = []
  private floatingTexts: FloatingText[] = []
  private failedPlacement: FailedPlacement | null = null
  private shockwaves: Shockwave[] = []
  private hoverCell: GridPoint | null = null
  private hoverPathChoice: PathChoice | null = null
  private selectedTowerId: number | null = null
  private placementMode = false
  private towerDrag: TowerDrag | null = null
  private suppressClick = false
  private idleTime = 0
  private ambientSpawnTimer = 35 + Math.random() * 55
  private ambientId = 1
  private ambientActors: AmbientActor[] = []
  private ambientEvacuation = 0
  private pendingWaveStart = false
  private introStoryActive = false
  private introStoryIndex = 0
  private introStoryTime = 0
  private introStoryPaused = false
  private readonly introStorySlideDuration = 5
  private readonly introStorySlideCount = 4
  private activeRunSceneTime = 0
  private readonly activeRunSceneDuration = 5.5
  private openingCinematicActive = false
  private openingCinematicPlayed = false
  private openingCinematicTime = 0
  private readonly openingCinematicDuration = 8.8
  private camera = { x: 0, y: 0 }
  private zoom = DEFAULT_WORLD_SCALE
  private pointerCanvas: Point | null = null
  private debugVisuals = false
  private debugTimeScale = 1
  private debugSandbox = false
  private skinId = 'warden-stone'
  private debugDefenseTier = 1
  private debugIdleVariation = 0
  private debugDefenseTarget: Point | null = null
  private debugDefenseShot: Projectile & { startedAt: number } | null = null
  private debugDefenseNextShotAt = 0
  private relicInventory: PathwardenInventoryRelic[] = []
  private ashPiles: Array<{
    id: number
    sourceRelicId: string
    sourceFamily: PathwardenRelicFamily
    sourceRarity: PathwardenRelicRarity
    sourceName: string
    createdWave: number
    flakesGenerated: number
  }> = []

  private ashPileId = 1
  private ashflakeAccumulator = 0
  private ashflakes: Ashflake[] = []
  private relicInstanceId = 1
  private killRepairPercent = 0
  private canSellRelics = false
  private debugGallery: { category: PathwardenGalleryCategory, index: number } | null = null
  private debugRelicSwapTowerId: number | null = null
  private debugForceRelicSwap = false

  constructor(
    canvas: HTMLCanvasElement,
    callbacks: PathwardenCallbacks,
    boosts?: PathwardenBoostEffects,
    realm = 1,
    skinId = 'warden-stone',
    restore?: PathwardenEngineRestore,
    skipIntro = false
  ) {
    this.canvas = canvas
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    this.ctx = context
    this.callbacks = callbacks
    this.introStoryActive = !restore && !skipIntro
    this.openingCinematicPlayed = skipIntro
    this.realm = clamp(Math.floor(restore?.mapPlan.realm ?? realm), 1, 5)
    this.skinId = skinId
    if (!restore) {
      this.mapPlan = createPathwardenMapPlan({
        seed: this.mapSeed,
        realm: this.realm,
        maxDepth: EXPANSION_DEPTH
      })
      this.elevations = this.createElevations()
      this.path = this.castlePath()
      this.initialPath = this.path.map(point => ({ ...point }))
    }
    if (boosts) {
      this.lives = boosts.startingLives
      this.maxLives = boosts.startingLives
      this.aether = boosts.startingAether
      this.damageMultiplier = boosts.damageMultiplier
      this.rangeMultiplier = boosts.rangeMultiplier
      this.rateMultiplier = boosts.rateMultiplier
      this.bountyMultiplier = boosts.bountyMultiplier
      this.arcanistLevel = boosts.arcanistLevel
    }
    if (restore) {
      this.activeRunSceneTime = this.activeRunSceneDuration
      this.mapSeed = restore.mapPlan.seed
      this.mapRandomState = restore.gameState.combatRandomState
      this.mapPlan = restore.mapPlan
      this.elevations = this.createElevations()
      this.path = this.castlePath()
      this.initialPath = this.path.map(point => ({ ...point }))
    }
    this.canvas.width = WIDTH
    this.canvas.height = HEIGHT
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerCancel)
    this.canvas.addEventListener('pointerleave', this.onPointerLeave)
    this.canvas.addEventListener('click', this.onClick)
    this.canvas.addEventListener('contextmenu', this.onContextMenu)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.loadAssets()
    this.precalculateExpansionPlan(EXPANSION_DEPTH)
    if (restore) this.restoreGameState(restore.gameState)
    else {
      this.activatePlannedChoices(this.mapPlan.castleRoomId)
      this.revealAround(this.initialRevealCells())
    }
    this.seedCastleCrossroads()
    this.refreshChoiceAnchors()
    if (this.phase === 'planning') {
      this.placementMode = true
      this.hoverCell = this.placementPreviewCell()
    }
    this.emitState()
    this.render()
  }

  private createElevations() {
    return Array.from({ length: ROWS }, (_, row) =>
      Array.from({ length: COLS }, (_, col) => {
        const seedX = (this.mapSeed % 997) / 997 * Math.PI * 2
        const seedY = (this.mapSeed % 613) / 613 * Math.PI * 2
        const broadHill = Math.sin(col * 0.48 + seedX)
          + Math.cos(row * 0.44 + seedY)
          + Math.sin((col - row) * 0.26 + seedX * 0.5)
        const center = Math.floor(COLS / 2)
        const centerRise = Math.max(0, 1 - Math.hypot(col - center, row - center) / 18)
        return clamp(Math.round(1.55 + broadHill * 0.3 + centerRise * 0.55), 1, 3)
      }))
  }

  private castlePath() {
    const castle = this.mapPlan.rooms.find(room => room.id === this.mapPlan.castleRoomId)!
    const mainExit = this.castleMainExit()
    const aligned = castle.roadCells.filter(cell =>
      mainExit.direction === 'north' || mainExit.direction === 'south'
        ? cell.col === castle.origin.col
        : cell.row === castle.origin.row)
    const firstStep = aligned.find(cell =>
      Math.abs(cell.col - castle.origin.col) + Math.abs(cell.row - castle.origin.row) === 1)
    const route = firstStep
      ? [firstStep, ...aligned.filter(cell => cell !== firstStep)]
      : aligned
    return [{ ...castle.origin }, ...route.map(cell => ({ ...cell }))]
  }

  private castleMainExit() {
    const castle = this.mapPlan.rooms.find(room => room.id === this.mapPlan.castleRoomId)!
    return castle.ports.find(port => port.id === 'port-castle-main')!
  }

  private initialRevealCells() {
    const castle = this.mapPlan.rooms.find(room => room.id === this.mapPlan.castleRoomId)!
    return [{ ...castle.origin }, ...castle.revealCells.map(cell => ({ ...cell }))]
  }

  private seedCastleCrossroads() {
    const castleLinks = this.mapPlan.roadLinks.filter(link => link.roomId === this.mapPlan.castleRoomId)
    for (const link of castleLinks) {
      this.addCommittedRoadLink(link.from, link.to)
      for (const cell of [link.from, link.to]) {
        if (!this.branchRoads.some(road => cellKey(road) === cellKey(cell))) {
          this.branchRoads.push({ ...cell })
        }
      }
    }
  }

  exportGameState(): PathwardenGameState {
    return {
      phase: this.phase,
      paused: this.paused,
      wave: this.wave,
      lives: this.lives,
      maxLives: this.maxLives,
      aether: this.aether,
      score: this.score,
      streak: this.streak,
      flawlessWaves: this.flawlessWaves,
      spawnLeft: this.spawnLeft,
      spawnTotal: this.spawnTotal,
      spawnTimer: this.spawnTimer,
      combatRandomState: this.mapRandomState,
      path: this.path.map(point => ({ ...point })),
      claimedRoomIds: [...this.claimedSections].map(choice => choice.roomId ?? choice.id),
      activeRoomIds: this.pathChoices.map(choice => choice.roomId ?? choice.id),
      selectedTower: this.selectedTower,
      towerPurchases: { ...this.towerPurchases },
      relicRanks: { ...this.relicRanks },
      globalRelics: { ...this.globalRelics },
      relicInventory: this.relicInventory.map(relic => ({ ...relic })),
      ashPiles: this.ashPiles.map(pile => ({ ...pile })),
      interest: this.interest,
      canSellRelics: this.canSellRelics,
      towers: this.towers.map(({ recoil: _recoil, ...tower }) => ({ ...tower })),
      enemies: this.enemies.map(({
        radius: _radius,
        color: _color,
        hitFlash: _hitFlash,
        ...enemy
      }) => ({ ...enemy, route: enemy.route.map(point => ({ ...point })) })),
      projectiles: this.projectiles.map(projectile => ({
        type: projectile.type,
        relicFamily: projectile.relicFamily,
        relicPower: projectile.relicPower,
        relicEffects: projectile.relicEffects,
        echo: projectile.echo,
        targetId: projectile.targetId,
        x: projectile.x,
        y: projectile.y,
        damage: projectile.damage,
        speed: projectile.speed,
        splash: projectile.splash,
        splashFactor: projectile.splashFactor,
        slow: projectile.slow,
        color: projectile.color,
        size: projectile.size,
        trail: projectile.trail.map(point => ({ col: point.x, row: point.y })),
        origin: { col: projectile.origin.x, row: projectile.origin.y },
        age: projectile.age,
        duration: projectile.duration,
        arcHeight: projectile.arcHeight
      })),
      towerId: this.towerId,
      enemyId: this.enemyId,
      relicInstanceId: this.relicInstanceId
    }
  }

  exportMapPlan() {
    return this.mapPlan
  }

  private restoreGameState(state: PathwardenGameState) {
    const claimed = new Set(state.claimedRoomIds)
    const active = new Set(state.activeRoomIds)
    this.claimedSections = new Set(this.plannedSections.filter(choice =>
      claimed.has(choice.roomId ?? choice.id)))
    this.pathChoices = this.plannedSections.filter(choice =>
      active.has(choice.roomId ?? choice.id))
    this.branchRoads = []
    this.branchLinks = []
    this.revealed.clear()
    this.revealAround(this.initialRevealCells())
    for (const choice of this.claimedSections) {
      for (const link of choice.links ?? []) this.addCommittedRoadLink(link.from, link.to)
      for (const cell of choice.cells) {
        if (!this.branchRoads.some(road => cellKey(road) === cellKey(cell))) this.branchRoads.push({ ...cell })
      }
      this.revealAround(choice.revealCells ?? choice.cells)
    }
    this.path = state.path.map(point => ({ ...point }))
    this.phase = state.phase as PathwardenPhase
    this.paused = state.paused
    this.wave = state.wave
    this.lives = state.lives
    this.maxLives = state.maxLives
    this.aether = state.aether
    this.score = state.score
    this.streak = state.streak
    this.flawlessWaves = state.flawlessWaves
    this.spawnLeft = state.spawnLeft
    this.spawnTotal = state.spawnTotal
    this.spawnTimer = state.spawnTimer
    this.selectedTower = state.selectedTower
    this.towerPurchases = { ...state.towerPurchases }
    this.relicRanks = { ...this.relicRanks, ...state.relicRanks }
    this.globalRelics = Object.fromEntries(Object.entries(state.globalRelics ?? {}).map(([family, global]) => [family, {
      ...global,
      effects: (global as { effects?: PathwardenRelicEffects }).effects ?? relicEffectsFor(family as PathwardenGlobalRelicFamily, global.power),
      color: (global as { color?: string }).color ?? this.relicColor(family as PathwardenGlobalRelicFamily)
    }])) as typeof this.globalRelics
    this.relicInventory = (state.relicInventory ?? []).map(relic => this.hydrateRelic(relic))
    this.ashPiles = (state.ashPiles ?? []).map(pile => ({
      id: pile.id,
      sourceRelicId: pile.sourceRelicId,
      sourceFamily: pile.sourceFamily as PathwardenRelicFamily,
      sourceRarity: pile.sourceRarity as PathwardenRelicRarity,
      sourceName: pile.sourceName,
      createdWave: pile.createdWave,
      flakesGenerated: pile.flakesGenerated
    }))
    this.ashPileId = Math.max(1, ...this.ashPiles.map(pile => pile.id + 1))
    this.ashflakes = []
    this.ashflakeAccumulator = 0
    this.interest = state.interest
    this.canSellRelics = state.canSellRelics
    this.towerId = state.towerId
    this.enemyId = state.enemyId
    this.relicInstanceId = state.relicInstanceId
    this.towers = state.towers.map(tower => {
      const template = PATHWARDEN_RELICS.find(candidate => candidate.id === tower.relicId)
        ?? PATHWARDEN_RELICS.find(candidate => candidate.family === tower.relicFamily)
      const relicEntities = tower.relicEntities?.map(relic => this.hydrateRelic(relic))
        ?? (template && tower.relicStacks > 0
          ? Array.from({ length: tower.relicStacks }, (_, index) => this.materializeRelic(
            template,
            state.combatRandomState + tower.id * 53 + index,
            tower.relicPower / Math.max(0.01, template.power * Math.max(1, tower.relicStacks))
          ))
          : undefined)
      const relicEntity = tower.relicEntity
        ? this.hydrateRelic(tower.relicEntity)
        : relicEntities?.[0]
      return {
        ...tower,
        type: tower.type,
        merges: tower.merges ?? 0,
        recoil: 0,
        relicFamily: tower.relicFamily as PathwardenRelicFamily | undefined,
        relicId: tower.relicId ?? (tower.relicFamily ? `${tower.relicFamily}-common` : undefined),
        relicEntity,
        relicEntities
      }
    })
    const enemyVisual = {
      raider: { radius: 13, color: '#fb923c' },
      runner: { radius: 10, color: '#c4b5fd' },
      brute: { radius: 18, color: '#fb7185' },
      shaman: { radius: 15, color: '#4ade80' },
      boss: { radius: 29, color: '#facc15' }
    }
    this.enemies = state.enemies.map((enemy) => {
      const type = enemy.type as EnemyType
      return { ...enemy, type, ...enemyVisual[type], hitFlash: 0 }
    })
    this.projectiles = state.projectiles.map(projectile => ({
      ...projectile,
      type: projectile.type,
      relicFamily: projectile.relicFamily as PathwardenRelicFamily | undefined,
      relicEffects: projectile.relicEffects,
      trail: projectile.trail.map(point => ({ x: point.col, y: point.row })),
      origin: { x: projectile.origin.col, y: projectile.origin.row }
    }))
  }

  start() {
    if (this.running || this.destroyed) return
    this.running = true
    this.lastFrame = performance.now()
    this.animationFrame = requestAnimationFrame(this.frame)
  }

  destroy() {
    this.destroyed = true
    this.running = false
    cancelAnimationFrame(this.animationFrame)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas.removeEventListener('click', this.onClick)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    this.canvas.removeEventListener('wheel', this.onWheel)
  }

  togglePause() {
    if (this.phase === 'defeat' || this.phase === 'victory') return
    this.paused = !this.paused
    this.noteActivity()
    this.message = this.paused ? 'Time is held by the Warden.' : 'The horde moves once more.'
    this.emitState()
  }

  setPaused(paused: boolean) {
    if (this.phase === 'defeat' || this.phase === 'victory' || this.phase === 'cashout' || this.paused === paused) return
    this.paused = paused
    this.noteActivity()
    this.message = paused ? 'Time is held by the Warden.' : 'The horde moves once more.'
    this.emitState()
  }

  selectTower(type: PathwardenTowerType) {
    this.noteActivity()
    this.selectedTowerId = null
    this.selectedTower = type
    this.placementMode = true
    this.hoverCell = this.placementPreviewCell()
    this.message = `${towerStats(type).name} selected · ${this.towerCost(type)} Aether`
    this.emitState()
  }

  enterPlacementMode() {
    if (this.phase !== 'planning') return
    this.selectedTowerId = null
    this.placementMode = true
    this.hoverCell = this.placementPreviewCell()
    this.emitState()
  }

  startWave() {
    if (this.phase !== 'planning' || this.pendingWaveStart) return
    if (this.introStoryActive || this.openingCinematicActive) return
    if (this.wave === 0 && !this.openingCinematicPlayed) {
      this.startOpeningCinematic()
      return
    }
    if (this.ambientActors.some(actor => actor.kind !== 'bird')) {
      this.pendingWaveStart = true
      this.ambientEvacuation = 1.35
      this.message = 'The warning bell rings — villagers scatter for shelter!'
      this.emitState()
      return
    }
    this.beginWave()
  }

  defileTemple() {
    if (!this.introStoryActive || this.phase !== 'planning') return
    this.introStoryActive = false
    this.startOpeningCinematic()
  }

  skipIntro() {
    if (!this.introStoryActive || this.phase !== 'planning') return
    this.introStoryActive = false
    this.openingCinematicPlayed = true
    this.message = 'The keep is ready. Raise your defenses before the horde arrives.'
    this.emitState()
  }

  nextIntroStory() {
    if (!this.introStoryActive) return
    this.introStoryPaused = false
    this.introStoryIndex = Math.min(this.introStorySlideCount - 1, this.introStoryIndex + 1)
    this.introStoryTime = 0
    this.emitState()
  }

  previousIntroStory() {
    if (!this.introStoryActive) return
    this.introStoryPaused = false
    this.introStoryIndex = Math.max(0, this.introStoryIndex - 1)
    this.introStoryTime = 0
    this.emitState()
  }

  continueDefense() {
    this.activeRunSceneTime = 0
    this.emitState()
  }

  private startOpeningCinematic() {
    // Mark the one-shot sequence as consumed when it starts. Wave 1 may be
    // called again after the overlay closes, and must transition directly to
    // combat instead of re-entering the god animation.
    this.openingCinematicPlayed = true
    this.openingCinematicActive = true
    this.openingCinematicTime = 0
    this.message = 'The old god descends. Hold fast while the mist is summoned.'
    this.emitState()
  }

  private beginWave() {
    this.noteActivity(true)
    this.wave++
    this.waveStartingLives = this.lives
    this.phase = 'wave'
    this.placementMode = false
    this.canSellRelics = false
    this.spawnTotal = this.waveEnemyCount(this.wave)
    this.spawnLeft = this.spawnTotal
    this.spawnTimer = 0
    this.waveBanner = 1.4
    this.message = this.wave % 4 === 0 ? `Checkpoint guardian incoming!` : `Wave ${this.wave} surges from the mist.`
    this.emitState()
  }

  continueCheckpoint() {
    if (this.phase !== 'checkpoint') return
    this.noteActivity()
    if (this.wave >= 12) {
      this.phase = 'victory'
      this.message = 'The final horde is broken. The realm stands.'
      this.emitState()
      this.callbacks.onGameOver(true, this.getSnapshot())
      return
    }
    this.phase = this.pathChoices.length ? 'path' : 'upgrade'
    this.canSellRelics = true
    this.message = this.pathChoices.length
      ? 'Venture onward. Choose a frontier road.'
      : 'The frontier holds. Claim a relic.'
    this.emitState()
    if (this.phase === 'upgrade') this.offerUpgrades()
  }

  settleRun(coins: number, message?: string, cashedOut = false) {
    this.coinsEarned = Math.max(0, Math.floor(coins))
    if (cashedOut) this.phase = 'cashout'
    if (message) this.message = message
    this.emitState()
  }

  debugOpenFrontier() {
    if (!import.meta.dev || this.phase !== 'planning') return
    this.phase = 'path'
    this.message = 'Development frontier inspection.'
    this.focusFrontierChoices()
    this.emitState()
  }

  debugSpawnCrew() {
    if (!import.meta.dev || !this.towers.length) return
    this.ambientActors = this.ambientActors.filter(actor => actor.kind !== 'crew')
    this.ambientActors.push({
      id: this.ambientId++,
      storyId: 81,
      blockKey: this.ambientBlockKey(0),
      kind: 'crew',
      age: 0,
      duration: 10,
      seed: 0,
      countsForProgress: false
    })
  }

  debugPopulateVillage() {
    if (!import.meta.dev || this.phase !== 'planning') return
    const kinds: AmbientKind[] = ['market', 'picnic', 'hunt', 'musician', 'children', 'shepherd', 'patrol', 'peddler', 'crew', 'cat', 'bird']
    this.ambientActors = kinds.map((kind, index) => ({
      id: this.ambientId++,
      storyId: index * 10 + 1,
      blockKey: this.ambientBlockKey(index),
      kind,
      age: 1.5 + index * 0.37,
      duration: kind === 'bird' ? 12 : 22,
      seed: 11 + index * 17,
      countsForProgress: false
    }))
    this.idleTime = 12
    this.ambientSpawnTimer = 2
  }

  debugPrepareShowcase() {
    if (!import.meta.dev) return
    this.debugRevealFullMap()
    this.aether = Math.max(this.aether, 5_000)
    this.debugBuildLoadout()
    this.debugPopulateVillage()
    this.wave = 7
    this.beginWave()
    this.message = 'Development showcase active · structures, villagers, defenses, and a guardian wave are visible.'
    this.emitState()
  }

  debugPreviewAmbient(kind: 'market' | 'hunt', progress: number, success = true) {
    if (!import.meta.dev || this.phase !== 'planning') return
    const duration = kind === 'market' ? 150 : 125
    this.ambientActors = [{
      id: this.ambientId++,
      storyId: kind === 'market' ? 1 : 11,
      blockKey: this.ambientBlockKey(0),
      kind,
      age: clamp(progress, 0, 0.99) * duration,
      duration,
      seed: kind === 'hunt' ? (success ? 0 : 0.05) : 37,
      countsForProgress: false
    }]
    this.idleTime = 30
    this.ambientSpawnTimer = 300
  }

  debugTriggerAmbient(storyId = 0) {
    if (!import.meta.dev || this.phase === 'wave') return
    const normalized = storyId > 0
      ? clamp(Math.floor(storyId), 1, AMBIENT_STORY_COUNT)
      : Math.floor(Math.random() * AMBIENT_STORY_COUNT) + 1
    const family = AMBIENT_FAMILIES[Math.floor((normalized - 1) / 10)]!
    const blockKey = this.ambientBlockKey(normalized)
    const blockCount = this.ambientActors.filter(actor => actor.blockKey === blockKey).length
    if (blockCount >= 2) {
      const existing = this.ambientActors.find(actor => actor.blockKey === blockKey)
      if (existing) this.ambientActors.splice(this.ambientActors.indexOf(existing), 1)
    } else if (this.ambientActors.length >= 4) {
      this.ambientActors.shift()
    }
    this.ambientActors.push({
      id: this.ambientId++,
      storyId: normalized,
      blockKey,
      kind: family.kind,
      age: 8,
      duration: this.ambientDuration(family.kind, normalized),
      seed: normalized * 13.71,
      countsForProgress: false
    })
    this.idleTime = 30
    this.ambientSpawnTimer = 300
    this.message = `Ambient story ${normalized}/250 · ${family.name} · variant ${(normalized - 1) % 10 + 1}`
    const [col, row] = blockKey.split(':').map(Number)
    const focus = this.gridToScreen({ col: col!, row: row! })
    const bounds = this.cameraBounds()
    this.camera.x = clamp(focus.x - WORLD_VIEW_CENTER.x, bounds.minX, bounds.maxX)
    this.camera.y = clamp(focus.y - WORLD_VIEW_CENTER.y, bounds.minY, bounds.maxY)
    this.emitState()
  }

  debugPreviewAmbientStory(storyId: number, progress: number) {
    if (!import.meta.dev || this.phase === 'wave') return
    const normalized = clamp(Math.floor(storyId), 1, AMBIENT_STORY_COUNT)
    const family = AMBIENT_FAMILIES[Math.floor((normalized - 1) / 10)]!
    const duration = this.ambientDuration(family.kind, normalized)
    this.ambientActors = [{
      id: this.ambientId++,
      storyId: normalized,
      blockKey: this.ambientBlockKey(normalized),
      kind: family.kind,
      age: clamp(progress, 0.01, 0.99) * duration,
      duration,
      seed: normalized * 13.71,
      countsForProgress: false
    }]
    this.idleTime = 30
    this.ambientSpawnTimer = 300
    this.message = `Ambient preview · ${family.name} · ${Math.round(progress * 100)}%`
    const [col, row] = this.ambientBlockKey(normalized).split(':').map(Number)
    const focus = this.gridToScreen({ col: col!, row: row! })
    const bounds = this.cameraBounds()
    this.camera.x = clamp(focus.x - WORLD_VIEW_CENTER.x, bounds.minX, bounds.maxX)
    this.camera.y = clamp(focus.y - WORLD_VIEW_CENTER.y, bounds.minY, bounds.maxY)
    this.emitState()
  }

  debugClaimFrontier(index = 0) {
    if (!import.meta.dev || (this.phase !== 'planning' && this.phase !== 'path')) return
    const choice = this.pathChoices[index]
    if (!choice) return
    this.phase = 'path'
    this.extendPath(choice)
  }

  debugRevealFullMap() {
    if (!import.meta.dev || this.phase === 'wave') return
    this.persistCurrentPathLinks()
    const orderedSections = [...this.plannedSections].sort((left, right) => left.depth - right.depth)
    for (const choice of orderedSections) {
      const links = choice.links ?? choice.cells.map((cell, index) => ({
        from: index === 0 ? choice.source : choice.cells[index - 1]!,
        to: cell
      }))
      for (const link of links) {
        this.addCommittedRoadLink(link.from, link.to)
        for (const cell of [link.from, link.to]) {
          if (!this.branchRoads.some(road => cellKey(road) === cellKey(cell))) this.branchRoads.push({ ...cell })
        }
      }
      this.claimedSections.add(choice)
      this.revealAround(choice.revealCells ?? choice.cells)
    }
    this.pathChoices = []
    this.phase = 'planning'
    this.message = 'Development atlas revealed · the full march is visible.'
    this.zoom = this.minimumZoom()
    const bounds = this.cameraBounds()
    this.camera.x = clamp((bounds.minX + bounds.maxX) / 2, bounds.minX, bounds.maxX)
    this.camera.y = clamp((bounds.minY + bounds.maxY) / 2, bounds.minY, bounds.maxY)
    this.emitState()
  }

  debugToggleSandbox() {
    if (!import.meta.dev) return
    this.debugSandbox = !this.debugSandbox
    if (this.debugSandbox) {
      this.aether = 1_000_000_000
      this.phase = 'path'
      this.message = 'Road laboratory active · unlimited Aether and frontier claims.'
    } else {
      this.phase = 'planning'
      this.message = 'Road laboratory closed.'
    }
    this.emitState()
  }

  debugSetGallery(category: PathwardenGalleryCategory, index = 0) {
    if (!import.meta.dev) return
    if (category === 'defense') this.debugClearDefenseTarget()
    if (category === 'scene' && this.pathChoices.length) this.debugRevealFullMap()
    this.debugGallery = { category, index: Math.max(0, Math.floor(index)) }
    this.render()
  }

  debugSetDefenseGalleryOptions(tier = 1, skinId = 'warden-stone') {
    if (!import.meta.dev) return
    this.debugClearDefenseTarget()
    this.debugDefenseTier = clamp(Math.floor(tier), 1, 5)
    this.skinId = skinId
    if (this.debugGallery?.category === 'defense') this.render()
  }

  private debugClearDefenseTarget() {
    this.phase = 'planning'
    this.towers = []
    this.enemies = []
    this.projectiles = []
    this.debugDefenseTarget = null
    this.debugDefenseShot = null
  }

  debugSetIdleGalleryVariation(variation = 0) {
    if (!import.meta.dev) return
    this.debugIdleVariation = Math.max(0, Math.floor(variation))
    if (this.debugGallery?.category === 'idle') this.render()
  }

  private debugFireDefenseAt(event: MouseEvent) {
    const bounds = this.canvas.getBoundingClientRect()
    const canvasPoint = {
      x: (event.clientX - bounds.left) / bounds.width * WIDTH,
      y: (event.clientY - bounds.top) / bounds.height * HEIGHT
    }
    const galleryAnchor = this.gridToScreen({ col: this.path[3]!.col, row: this.path[3]!.row + 2 })
    const galleryCenter = { x: WIDTH / 2, y: HEIGHT / 2 + 34 }
    const target = {
      x: galleryAnchor.x + (canvasPoint.x - galleryCenter.x) / 2.4,
      y: galleryAnchor.y + (canvasPoint.y - galleryCenter.y) / 2.4
    }
    const inverseX = (target.x - ORIGIN_X) / (TILE_WIDTH / 2)
    const inverseY = (target.y - ORIGIN_Y) / (TILE_HEIGHT / 2)
    const targetCell = {
      col: clamp(Math.round((inverseX + inverseY) / 2), 0, COLS - 1),
      row: clamp(Math.round((inverseY - inverseX) / 2), 0, ROWS - 1)
    }
    const targetWorld = {
      x: (targetCell.col + 0.5) * WORLD_CELL,
      y: (targetCell.row + 0.5) * WORLD_CELL
    }
    this.revealed.add(cellKey(targetCell))
    this.debugDefenseTarget = target
    this.debugDefenseNextShotAt = 0
    this.debugDefenseShot = null
    this.projectiles = []
    this.phase = 'wave'
    this.spawnLeft = 0
    const families: PathwardenDefenseFamily[] = ['star', 'sun', 'winter', 'ember', 'storm', 'dawn']
    const family = families[(this.debugGallery?.index ?? 0) % families.length]!
    const blueprint = PATHWARDEN_DEFENSE_BLUEPRINTS.find(defense =>
      defense.family === family && defense.tier === this.debugDefenseTier
    ) ?? PATHWARDEN_DEFENSE_BLUEPRINTS.find(defense => defense.family === family)!
    this.towers = [{
      id: -1,
      col: this.path[3]!.col,
      row: this.path[3]!.row + 2,
      type: blueprint.id,
      invested: 0,
      cooldown: 0,
      angle: 0,
      level: 1,
      merges: 0,
      recoil: 0,
      targeting: 'first',
      relicStacks: 0,
      relicPower: 0,
      relicShots: 0
    }]
    this.enemies = [{
      id: -1,
      type: 'raider',
      exitKey: 'debug',
      route: [targetCell, targetCell],
      progress: 2,
      hp: 1000,
      maxHp: 1000,
      speed: 0,
      reward: 0,
      radius: 13,
      slow: 0,
      slowTimer: 0,
      healTimer: 0,
      color: '#fb923c',
      hitFlash: 0,
      attackTimer: 0,
      dotDamage: 0,
      dotTimer: 0,
      dotTick: 0,
      debugWorldPosition: targetWorld,
      debugScreenPosition: target
    }]
    this.render()
  }

  private debugStartDefenseShot(target: Point) {
    const point = { col: this.path[3]!.col, row: this.path[3]!.row + 2 }
    const families: PathwardenDefenseFamily[] = ['star', 'sun', 'winter', 'ember', 'storm', 'dawn']
    const family = families[(this.debugGallery?.index ?? 0) % families.length]!
    const blueprint = PATHWARDEN_DEFENSE_BLUEPRINTS.find(defense =>
      defense.family === family && defense.tier === this.debugDefenseTier
    ) ?? PATHWARDEN_DEFENSE_BLUEPRINTS.find(defense => defense.family === family)!
    const tower: Tower = {
      id: -1,
      ...point,
      type: blueprint.id,
      invested: 0,
      cooldown: 0,
      angle: this.debugDefenseAimAngle(point, target),
      level: 1,
      merges: 0,
      recoil: 0,
      targeting: 'first',
      relicStacks: 0,
      relicPower: 0,
      relicShots: 0
    }
    const geometry = this.towerGeometry(tower, point)
    const stats = towerStats(blueprint.id)
    const flightDistance = distance(geometry.muzzle, target)
    const archetype = this.towerArchetype(blueprint.id)
    this.debugDefenseShot = {
      x: geometry.muzzle.x,
      y: geometry.muzzle.y - 42 - (this.elevations[point.row]![point.col]! - 1) * 11,
      type: blueprint.id,
      targetPosition: target,
      relicPower: 0,
      echo: false,
      targetId: -1,
      damage: stats.damage,
      speed: stats.projectileSpeed,
      splash: stats.splash,
      splashFactor: 1,
      slow: stats.slow,
      color: stats.color,
      size: archetype === 'mortar' ? 8 : 5,
      trail: [],
      origin: { x: geometry.muzzle.x, y: geometry.muzzle.y - 42 - (this.elevations[point.row]![point.col]! - 1) * 11 },
      age: 0,
      duration: archetype === 'mortar'
        ? clamp(flightDistance / 260, 0.55, 1.15)
        : Math.max(0.08, flightDistance / stats.projectileSpeed),
      arcHeight: archetype === 'mortar' ? clamp(70 + flightDistance * 0.18, 78, 150) : 0,
      startedAt: performance.now()
    }
  }

  private debugDefenseAimAngle(point: GridPoint, target: Point) {
    const origin = this.gridToScreen(point)
    const screenAngle = Math.atan2(target.y - origin.y, target.x - origin.x)
    const vertical = Math.sin(screenAngle) / (TILE_HEIGHT / TILE_WIDTH)
    const horizontal = Math.cos(screenAngle)
    return Math.atan2(vertical - horizontal, horizontal + vertical)
  }

  debugToggleVisuals() {
    if (!import.meta.dev) return
    this.debugVisuals = !this.debugVisuals
    this.message = this.debugVisuals ? 'Visual guides enabled.' : 'Visual guides hidden.'
    this.emitState()
  }

  debugGrantAether(amount = 1000) {
    if (!import.meta.dev) return
    this.aether += clamp(Math.floor(amount), 0, 10000)
    this.message = 'Development treasury opened.'
    this.emitState()
  }

  debugSetAether(amount = 0) {
    if (!import.meta.dev) return
    this.aether = clamp(Math.floor(amount), 0, 10000)
    this.message = `Development Aether set to ${this.aether}.`
    this.emitState()
  }

  debugBuildLoadout() {
    if (!import.meta.dev || this.phase !== 'planning') return
    this.aether = Math.max(this.aether, 5_000)
    const types: PathwardenTowerType[] = ['bolt', 'mortar', 'frost', 'ember', 'storm', 'radiant']
    for (const type of types) {
      const cell = [...this.revealed]
        .map(key => {
          const [col, row] = key.split(':').map(Number)
          return { col: col!, row: row! }
        })
        .filter(point => this.placementStatus(point).allowed)
        .filter(point => !this.towers.some(tower => tower.col === point.col && tower.row === point.row))
        .sort((a, b) => {
          const keep = this.path[0]!
          return Math.hypot(a.col - keep.col, a.row - keep.row) - Math.hypot(b.col - keep.col, b.row - keep.row)
        })[0]
      if (!cell) break
      const cost = this.towerCost(type)
      this.aether -= cost
      this.towerPurchases[type] = (this.towerPurchases[type] ?? 0) + 1
      this.towers.push({
        id: this.towerId++,
        ...cell,
        type,
        invested: cost,
        cooldown: 0,
        angle: 0,
        level: 1,
        merges: 0,
        recoil: 0,
        targeting: type === 'mortar' ? 'strong' : type === 'frost' ? 'fast' : 'first',
        relicStacks: 0,
        relicPower: 0,
        relicShots: 0
      })
    }
    this.message = 'Development loadout raised for wave simulation.'
    this.emitState()
  }

  debugSpendEconomically() {
    if (!import.meta.dev || this.phase !== 'planning') return
    const types: PathwardenTowerType[] = ['bolt', 'frost', 'mortar']
    let attempts = 0
    while (this.towers.length < 7 && attempts++ < 12) {
      const affordable = types
        .map(type => ({ type, cost: this.towerCost(type) }))
        .filter(entry => entry.cost <= this.aether)
        .sort((a, b) => {
          const countA = this.towers.filter(tower => tower.type === a.type).length
          const countB = this.towers.filter(tower => tower.type === b.type).length
          return countA - countB || a.cost - b.cost
        })[0]
      if (!affordable) break
      const cell = [...this.revealed]
        .map(key => {
          const [col, row] = key.split(':').map(Number)
          return { col: col!, row: row! }
        })
        .filter(point => this.placementStatus(point).allowed)
        .filter(point => !this.towers.some(tower => tower.col === point.col && tower.row === point.row))
        .sort((a, b) => {
          const roadDistance = (point: GridPoint) => Math.min(...this.allRoadCells()
            .map(road => Math.abs(point.col - road.col) + Math.abs(point.row - road.row)))
          return roadDistance(a) - roadDistance(b)
        })[0]
      if (!cell) break
      this.aether -= affordable.cost
      this.towerPurchases[affordable.type] = (this.towerPurchases[affordable.type] ?? 0) + 1
      this.towers.push({
        id: this.towerId++,
        ...cell,
        type: affordable.type,
        invested: affordable.cost,
        cooldown: 0,
        angle: 0,
        level: 1,
        merges: 0,
        recoil: 0,
        targeting: affordable.type === 'mortar' ? 'strong' : affordable.type === 'frost' ? 'fast' : 'first',
        relicStacks: 0,
        relicPower: 0,
        relicShots: 0
      })
    }
    this.message = 'Development Warden invested available Aether conservatively.'
    this.emitState()
  }

  debugSetTimeScale(scale = 1) {
    if (!import.meta.dev) return
    this.debugTimeScale = clamp(scale, 1, 10)
  }

  debugPreviewLateWave() {
    if (!import.meta.dev || this.phase !== 'planning') return
    this.wave = 7
    this.message = 'Development preview prepared for the second guardian wave.'
    this.emitState()
  }

  debugOfferRelics() {
    if (!import.meta.dev || this.phase === 'wave') return
    this.phase = 'upgrade'
    this.callbacks.onUpgrade([
      this.materializeRelic(PATHWARDEN_RELICS.find(relic => relic.id === 'fire-common')!, 101, 1),
      this.materializeRelic(PATHWARDEN_RELICS.find(relic => relic.id === 'frost-rare')!, 202, 1),
      this.materializeRelic(PATHWARDEN_RELICS.find(relic => relic.id === 'repair-epic')!, 303, 1)
    ])
    this.message = 'Development relic draft opened.'
    this.emitState()
  }

  debugSetArcanistLevel(level: number) {
    if (!import.meta.dev) return
    this.arcanistLevel = clamp(Math.floor(level), 0, 20)
    this.emitState()
  }

  debugPrepareRelicSwapScenario(scenario: PathwardenRelicSwapDebugScenario) {
    if (!import.meta.dev) return null
    this.phase = 'planning'
    this.revealed.clear()
    this.revealAround(this.initialPath.slice(0, 4))
    this.pathChoices = []
    this.zoom = DEFAULT_WORLD_SCALE
    this.camera = { x: 0, y: 0 }
    const existing = PATHWARDEN_RELICS.find(relic => relic.id === scenario.existingRelicId)
    const incoming = PATHWARDEN_RELICS.find(relic => relic.id === scenario.incomingRelicId)
    if (!existing || !incoming) return null
    const cell = [...this.revealed]
      .map(key => {
        const [col, row] = key.split(':').map(Number)
        return { col: col!, row: row! }
      })
      .filter(point => this.placementStatus(point).allowed)
      .sort((a, b) => a.row - b.row || a.col - b.col)[0]
    if (!cell) return null
    const towerLevel = clamp(Math.floor(scenario.towerLevel), 1, 5)
    const stacks = clamp(Math.floor(scenario.stacks), 1, 5)
    const existingEntities = Array.from({ length: stacks }, (_, index) =>
      this.materializeRelic(existing, this.relicInstanceId * 37 + index + 1, 1))
    const tower: Tower = {
      id: this.towerId++,
      ...cell,
      type: 'bolt',
      invested: 100,
      cooldown: 0,
      angle: 0,
      level: towerLevel,
      merges: towerLevel - 1,
      recoil: 0,
      targeting: 'first',
      relicFamily: existing.family,
      relicId: existing.id,
      relicStacks: stacks,
      relicPower: existing.power * stacks,
      relicShots: 0,
      relicEntity: existingEntities[0],
      relicEntities: existingEntities
    }
    this.towers = [tower]
    this.selectedTowerId = tower.id
    this.debugRelicSwapTowerId = tower.id
    this.debugForceRelicSwap = true
    this.relicInventory = [this.materializeRelic(incoming, this.relicInstanceId * 31 + scenario.stacks, 1)]
    this.canSellRelics = true
    this.message = `Debug scenario ready · ${existing.name} on a level ${towerLevel} tower.`
    this.emitState()
    return this.relicSwapPreview(tower, this.relicInventory[0]!)
  }

  debugOpenRelicSwapWorkbench() {
    if (!import.meta.dev || this.debugRelicSwapTowerId === null) return null
    const tower = this.towers.find(candidate => candidate.id === this.debugRelicSwapTowerId)
    const relic = this.relicInventory[0]
    if (!tower || !relic || !tower.relicFamily || (tower.relicId === relic.id && !this.debugForceRelicSwap)) return null
    const preview = this.relicSwapPreview(tower, relic)
    this.callbacks.onOpenArcanistWorkbench?.(preview)
    return preview
  }

  setSelectedTargeting(targeting: PathwardenTargeting) {
    if (this.phase !== 'planning') return
    const tower = this.towers.find(candidate => candidate.id === this.selectedTowerId)
    if (!tower) return
    tower.targeting = targeting
    const label = targeting === 'first' ? 'the closest invader' : targeting === 'strong' ? 'the strongest invader' : 'the fastest invader'
    this.message = `${towerStats(tower.type).name} now targets ${label}.`
    this.emitState()
  }

  private relicSwapPreview(tower: Tower, relic: PathwardenInventoryRelic): PathwardenRelicSwapPreview {
    const existingFamily = tower.relicFamily!
    const existingRelic = PATHWARDEN_RELICS.find(candidate => candidate.id === tower.relicId)
      ?? PATHWARDEN_RELICS.find(candidate => candidate.family === existingFamily)!
    const sameElement = existingRelic.element === relic.element
    const stackPenalty = Math.max(0, tower.relicStacks - 1)
    const bindChance = clamp(
      (sameElement ? 0.78 : 0.34)
        + (tower.level - 1) * (sameElement ? 0.045 : 0.08)
        + this.arcanistLevel * (sameElement ? 0.035 : 0.045)
        - stackPenalty * (sameElement ? 0.045 : 0.08),
      0.08,
      0.96
    )
    const preserveChance = clamp(
      (sameElement ? 0.82 : 0.38)
        + (tower.level - 1) * (sameElement ? 0.04 : 0.07)
        + this.arcanistLevel * (sameElement ? 0.04 : 0.05)
        - stackPenalty * (sameElement ? 0.08 : 0.12),
      0.05,
      0.94
    )
    const stackedLossChance = clamp(0.16 + stackPenalty * 0.08 - this.arcanistLevel * 0.02, 0.04, 0.6)
    return {
      towerId: tower.id,
      relicInstanceId: relic.instanceId,
      towerLevel: tower.level,
      existingFamily,
      incomingFamily: relic.family,
      existingElement: existingRelic.element,
      incomingElement: relic.element,
      existingName: `${existingRelic.name}`,
      incomingName: relic.name,
      existingPower: tower.relicPower,
      incomingPower: relic.power,
      existingIconIndex: existingRelic.iconIndex,
      incomingIconIndex: relic.iconIndex,
      existingStacks: tower.relicStacks,
      bindChance,
      preserveChance,
      stackedLossChance,
      availableAether: Math.max(0, this.aether)
    }
  }

  private recoverRelic(family: PathwardenRelicFamily, power: number, relicId?: string) {
    const candidates = PATHWARDEN_RELICS.filter(relic => relic.id === relicId || relic.family === family)
    const template = candidates.reduce((closest, candidate) =>
      Math.abs(candidate.power - power) < Math.abs(closest.power - power) ? candidate : closest
    )
    return this.materializeRelic(template, this.relicInstanceId * 17 + Math.round(power * 100), power / Math.max(0.01, template.power), true)
  }

  private recoverRelicEntity(source: PathwardenInventoryRelic, damageFactor: number) {
    const factor = clamp(damageFactor, 0.05, 1)
    return {
      ...source,
      instanceId: this.relicInstanceId++,
      name: `Recovered ${source.name}`,
      power: Number((source.power * factor).toFixed(2)),
      damageFactor: source.damageFactor * factor,
      effects: scaleRelicEffects(source.effects, factor),
      baseEffects: cloneRelicEffects(source.baseEffects),
      sellValue: Math.max(1, Math.round(source.sellValue * factor)),
      description: describeRelicEffects(scaleRelicEffects(source.effects, factor))
    }
  }

  private materializeRelic(template: PathwardenRelic, variationSeed: number, damageFactor = 1, recovered = false): PathwardenInventoryRelic {
    const baseEffects = variedRelicEffects(template, variationSeed)
    const currentEffects = scaleRelicEffects(baseEffects, clamp(damageFactor, 0.05, 1))
    const power = Number((template.power * clamp(damageFactor, 0.05, 1)).toFixed(2))
    return {
      ...template,
      instanceId: this.relicInstanceId++,
      variationSeed,
      damageFactor: clamp(damageFactor, 0.05, 1),
      baseEffects: cloneRelicEffects(baseEffects),
      effects: currentEffects,
      name: recovered ? `Recovered ${template.name}` : template.name,
      description: describeRelicEffects(currentEffects),
      power,
      sellValue: Math.max(1, Math.round(template.sellValue * clamp(damageFactor, 0.05, 1)))
    }
  }

  private hydrateRelic(saved: Omit<Partial<PathwardenInventoryRelic>, 'family' | 'rarity'> & { id: string, family: string, rarity: string, power: number }): PathwardenInventoryRelic {
    const family = saved.family as PathwardenRelicFamily
    const rarity = saved.rarity as PathwardenRelicRarity
    const template = PATHWARDEN_RELICS.find(candidate => candidate.id === saved.id)
      ?? PATHWARDEN_RELICS.find(candidate => candidate.family === family && candidate.rarity === rarity)
      ?? PATHWARDEN_RELICS.find(candidate => candidate.family === family)
      ?? PATHWARDEN_RELICS[0]!
    const variationSeed = saved.variationSeed ?? saved.instanceId ?? 1
    const generated = this.materializeRelic(template, variationSeed, 1)
    const baseEffects = saved.baseEffects ?? generated.baseEffects
    const effects = saved.effects ?? scaleRelicEffects(baseEffects, saved.damageFactor ?? (saved.power / Math.max(0.01, template.power)))
    return {
      ...generated,
      ...saved,
      family,
      rarity,
      instanceId: saved.instanceId ?? generated.instanceId,
      color: saved.color ?? generated.color,
      variationSeed,
      damageFactor: saved.damageFactor ?? (saved.power / Math.max(0.01, template.power)),
      baseEffects: cloneRelicEffects(baseEffects),
      effects,
      power: saved.power ?? generated.power,
      sellValue: saved.sellValue ?? generated.sellValue
    }
  }

  applyRelicToTowerAt(instanceId: number, clientX: number, clientY: number) {
    if (this.phase !== 'planning') return
    const relic = this.relicInventory.find(candidate => candidate.instanceId === instanceId)
    if (!relic) return
    const bounds = this.canvas.getBoundingClientRect()
    const pointer = {
      x: (clientX - bounds.left) / bounds.width * WIDTH,
      y: (clientY - bounds.top) / bounds.height * HEIGHT
    }
    const worldPointer = {
      x: WORLD_VIEW_CENTER.x + this.camera.x + (pointer.x - WORLD_VIEW_CENTER.x) / this.zoom,
      y: WORLD_VIEW_CENTER.y + this.camera.y + (pointer.y - WORLD_VIEW_CENTER.y) / this.zoom
    }
    const tower = [...this.towers].reverse().find((candidate) => {
      const geometry = this.towerGeometry(candidate)
      return worldPointer.x >= geometry.screen.x - geometry.width / 2
        && worldPointer.x <= geometry.screen.x + geometry.width / 2
        && worldPointer.y >= geometry.foot.y - geometry.height
        && worldPointer.y <= geometry.foot.y + 8
    })
    if (!tower) {
      this.message = 'Drop the relic directly onto a defense.'
      this.emitState()
      return
    }
    if (tower.relicFamily && (tower.relicId !== relic.id || (this.debugForceRelicSwap && tower.id === this.debugRelicSwapTowerId))) {
      this.callbacks.onOpenArcanistWorkbench?.(this.relicSwapPreview(tower, relic))
      return
    }
    tower.relicFamily = relic.family
    tower.relicId = relic.id
    tower.relicStacks++
    tower.relicPower += relic.power
    tower.relicEntity = relic
    tower.relicEntities = [...(tower.relicEntities ?? []), relic]
    this.relicInventory.splice(this.relicInventory.indexOf(relic), 1)
    const position = this.gridToScreen(tower)
    this.burst(position, this.relicColor(relic.family), 24, 190)
    this.shockwaves.push({ ...position, radius: 6, maxRadius: 62, life: 0.65, color: this.relicColor(relic.family) })
    this.message = `${relic.name} bound to ${towerStats(tower.type).name} · stack ${tower.relicStacks}.`
    this.emitState()
  }

  resolveRelicSwap(towerId: number, relicInstanceId: number, investment: PathwardenRelicSwapInvestment = { amount: 0, focus: 'both', bonus: 0 }): PathwardenRelicSwapResult | null {
    if (this.phase !== 'planning') return null
    const tower = this.towers.find(candidate => candidate.id === towerId)
    const relic = this.relicInventory.find(candidate => candidate.instanceId === relicInstanceId)
    if (!tower || !relic || !tower.relicFamily || (tower.relicId === relic.id && !this.debugForceRelicSwap)) return null
    const preview = this.relicSwapPreview(tower, relic)
    const requestedAether = Number.isFinite(investment.amount) ? investment.amount : 0
    const aetherSpent = clamp(Math.floor(requestedAether), 0, Math.max(0, this.aether))
    const investmentBonus = clamp(investment.bonus, 0, 0.2)
    const bindingChance = clamp(
      preview.bindChance + (investment.focus === 'preservation' ? 0 : investmentBonus * (investment.focus === 'both' ? 0.5 : 1)),
      0.08,
      0.98
    )
    const preserveChance = clamp(
      preview.preserveChance + (investment.focus === 'binding' ? 0 : investmentBonus * (investment.focus === 'both' ? 0.5 : 1)),
      0.05,
      0.98
    )
    const oldFamily = tower.relicFamily
    const oldRelicId = tower.relicId
    const oldPower = tower.relicPower
    const oldStacks = tower.relicStacks
    const oldEntities = tower.relicEntities?.length
      ? tower.relicEntities
      : Array.from({ length: oldStacks }, (_, index) => this.materializeRelic(
        PATHWARDEN_RELICS.find(candidate => candidate.id === oldRelicId)
          ?? PATHWARDEN_RELICS.find(candidate => candidate.family === oldFamily)!,
        this.relicInstanceId * 41 + index,
        1
      ))
    const preservedRelicIndices: number[] = []
    for (let stack = 0; stack < oldStacks; stack++) {
      if (this.planRandom() <= preserveChance) preservedRelicIndices.push(stack)
    }
    const recovered = preservedRelicIndices.length
    const recoveredRelicPower = recovered
      ? oldPower / Math.max(1, oldStacks) * (recovered === oldStacks ? 1 : 0.7 + 0.3 * recovered / Math.max(1, oldStacks))
      : 0
    this.aether -= aetherSpent
    if (this.planRandom() > bindingChance) {
      this.relicInventory.splice(this.relicInventory.indexOf(relic), 1)
      this.createAshPile(relic)
      for (let index = 0; index < oldStacks; index++) {
        if (!preservedRelicIndices.includes(index)) this.createAshPile(oldEntities[index]!)
      }
      tower.relicStacks = recovered
      tower.relicEntities = preservedRelicIndices.map(index => oldEntities[index]!)
      tower.relicEntity = tower.relicEntities[0]
      tower.relicPower = tower.relicEntities.reduce((total, entity) => total + entity.power, 0)
      if (!recovered) {
        tower.relicFamily = undefined
        tower.relicId = undefined
      }
      const message = recovered
        ? `The Arcanist could not align the new relic. ${recovered} of ${oldStacks} old relic${oldStacks === 1 ? '' : 's'} survived; ${oldStacks - recovered} were destroyed.`
        : 'The Arcanist could not align the new relic. Every relic was lost in the ritual.'
      this.message = message
      this.clearDebugRelicSwapState(towerId)
      this.emitState()
      return {
        success: false,
        bindingSucceeded: false,
        incomingName: relic.name,
        oldRelicName: preview.existingName,
        oldStacks,
        recoveredStacks: recovered,
        recoveredRelicPower,
        preservedRelicIndices,
        preserved: recovered > 0,
        message,
        aetherSpent,
        bindingChance,
        preserveChance
      }
    }

    this.relicInventory.splice(this.relicInventory.indexOf(relic), 1)
    for (let index = 0; index < oldStacks; index++) {
      if (!preservedRelicIndices.includes(index)) this.createAshPile(oldEntities[index]!)
    }
    for (const index of preservedRelicIndices) {
      this.relicInventory.push(this.recoverRelicEntity(oldEntities[index]!, recovered === oldStacks ? 1 : 0.7 + 0.3 * recovered / Math.max(1, oldStacks)))
    }
    tower.relicFamily = relic.family
    tower.relicId = relic.id
    tower.relicStacks = 1
    tower.relicPower = relic.power
    tower.relicEntity = relic
    tower.relicEntities = [relic]
    const position = this.gridToScreen(tower)
    this.burst(position, this.relicColor(relic.family), 30, 220)
    this.shockwaves.push({ ...position, radius: 7, maxRadius: 68, life: 0.72, color: this.relicColor(relic.family) })
    const message = recovered
      ? `${relic.name} replaced the old relic. ${recovered === oldStacks ? 'The original stack was fully preserved.' : `${recovered} of ${oldStacks} old relic${oldStacks === 1 ? '' : 's'} survived; ${oldStacks - recovered} were destroyed.`}`
      : `${relic.name} replaced the old relic. The original was lost in the ritual.`
    this.message = message
    this.clearDebugRelicSwapState(towerId)
    this.emitState()
    return {
      success: true,
      bindingSucceeded: true,
      incomingName: relic.name,
      oldRelicName: preview.existingName,
      oldStacks,
      recoveredStacks: recovered,
      recoveredRelicPower,
      preservedRelicIndices,
      preserved: recovered > 0,
      message,
      aetherSpent,
      bindingChance,
      preserveChance
    }
  }

  private clearDebugRelicSwapState(towerId: number) {
    if (this.debugRelicSwapTowerId !== towerId) return
    this.debugRelicSwapTowerId = null
    this.debugForceRelicSwap = false
  }

  private createAshPile(relic: PathwardenRelic) {
    this.ashPiles.push({
      id: this.ashPileId++,
      sourceRelicId: relic.id,
      sourceFamily: relic.family,
      sourceRarity: relic.rarity,
      sourceName: relic.name,
      createdWave: this.wave,
      flakesGenerated: 0
    })
  }

  clearRunRelicState() {
    this.relicInventory = []
    this.ashPiles = []
    this.ashflakes = []
    this.ashflakeAccumulator = 0
    for (const tower of this.towers) {
      tower.relicFamily = undefined
      tower.relicId = undefined
      tower.relicStacks = 0
      tower.relicPower = 0
      tower.relicEntity = undefined
      tower.relicEntities = undefined
    }
    this.emitState()
  }

  sellRelic(instanceId: number) {
    if (!this.canSellRelics || this.phase === 'wave' || this.phase === 'checkpoint') return
    const relic = this.relicInventory.find(candidate => candidate.instanceId === instanceId)
    if (!relic) return
    this.relicInventory.splice(this.relicInventory.indexOf(relic), 1)
    this.aether += relic.sellValue
    this.message = `${relic.name} dissolved · ${relic.sellValue} Aether recovered.`
    this.emitState()
  }

  private relicColor(family?: PathwardenRelicFamily) {
    if (!family) return '#c4b5fd'
    if (family === 'fire' || family === 'blast') return '#fb7185'
    if (family === 'frost') return '#a5f3fc'
    if (family === 'storm' || family === 'chain') return '#fde047'
    if (family === 'venom') return '#86efac'
    if (family === 'radiant') return '#fef3c7'
    if (family === 'leech') return '#f0abfc'
    if (family === 'gale') return '#99f6e4'
    return '#c4b5fd'
  }

  private towerBlueprint(type: PathwardenTowerType) {
    return PATHWARDEN_DEFENSE_BLUEPRINTS.find(defense => defense.id === type) ?? PATHWARDEN_DEFENSE_BLUEPRINTS[0]!
  }

  private towerArchetype(type: PathwardenTowerType): 'bolt' | 'mortar' | 'frost' {
    const archetype: PathwardenDefenseArchetype = this.towerBlueprint(type).archetype
    return archetype === 'ballista' ? 'bolt' : archetype === 'mortar' ? 'mortar' : 'frost'
  }

  private towerRelicFamily(tower: Tower): PathwardenRelicFamily | undefined {
    if (tower.relicFamily) return tower.relicFamily
    const family = this.towerBlueprint(tower.type).family
    if (family === 'ember' || family === 'sun') return 'fire'
    if (family === 'storm') return 'storm'
    if (family === 'dawn' || family === 'prism') return 'radiant'
    if (family === 'winter') return 'frost'
    if (family === 'venom') return 'venom'
    if (family === 'gale') return 'gale'
    if (family === 'siege') return 'blast'
    return undefined
  }

  private towerRelicPower(tower: Tower) {
    return tower.relicFamily ? tower.relicPower : this.towerRelicFamily(tower) ? 1 : 0
  }

  private towerRelicEffects(tower: Tower) {
    const effects = emptyRelicEffects()
    const entities = tower.relicEntities ?? (tower.relicEntity ? [tower.relicEntity] : [])
    for (const entity of entities) addRelicEffects(effects, entity.effects)
    if (entities.length) return effects
    const family = this.towerRelicFamily(tower)
    return family ? relicEffectsFor(family, this.towerRelicPower(tower)) : effects
  }

  private towerRelicColor(tower: Tower) {
    return tower.relicEntity?.color ?? tower.relicEntities?.[0]?.color ?? this.relicColor(this.towerRelicFamily(tower))
  }

  private skinPalette() {
    if (this.skinId === 'ember-court') return { dark: '#450a0a', mid: '#991b1b', light: '#f97316', trim: '#fed7aa', accent: '#ef4444' }
    if (this.skinId === 'verdant-crown') return { dark: '#064e3b', mid: '#047857', light: '#34d399', trim: '#fde68a', accent: '#facc15' }
    if (this.skinId === 'royal-amethyst') return { dark: '#2e1065', mid: '#6d28d9', light: '#a78bfa', trim: '#e2e8f0', accent: '#c084fc' }
    if (this.skinId === 'sun-king') return { dark: '#713f12', mid: '#d97706', light: '#facc15', trim: '#fef3c7', accent: '#2563eb' }
    return { dark: '#475569', mid: '#64748b', light: '#94a3b8', trim: '#cbd5e1', accent: '#06b6d4' }
  }

  private relicDirectDamageBonus(family: PathwardenRelicFamily | undefined, power: number) {
    if (!family || power <= 0) return 0
    const rate: Partial<Record<PathwardenRelicFamily, number>> = {
      fire: 0.06,
      frost: 0.04,
      storm: 0.03,
      venom: 0.03,
      blast: 0.06,
      leech: 0.04,
      pierce: 0.1,
      chain: 0.02,
      gale: 0.02,
      radiant: 0.04
    }
    return (rate[family] ?? 0) * power
  }

  chooseUpgrade(relic: PathwardenRelic) {
    if (this.phase !== 'upgrade') return
    this.noteActivity()
    const entity = 'instanceId' in relic
      ? relic as PathwardenInventoryRelic
      : this.materializeRelic(relic, this.relicInstanceId * 31 + this.wave, 1)
    if (relic.towerSpecific) {
      this.relicInventory.push(entity)
    } else if (relic.family === 'heart') {
      const hearts = Math.max(1, Math.round(3 * entity.power))
      this.maxLives = Math.max(this.maxLives, this.lives + hearts)
      this.lives = Math.min(this.maxLives, this.lives + hearts)
    } else if (relic.family === 'repair') {
      this.killRepairPercent += entity.effects.repairPct / 100
    } else if (relic.family === 'bounty') {
      this.bountyMultiplier *= 1 + entity.effects.aetherBonusPct / 100
    } else if (relic.family === 'haste') {
      this.rateMultiplier *= 1 + entity.effects.attackSpeedPct / 100
    } else if (relic.family === 'range') {
      this.rangeMultiplier *= 1 + entity.effects.rangePct / 100
    }
    if (!relic.towerSpecific) {
      const family = relic.family as PathwardenGlobalRelicFamily
      const current = this.globalRelics[family]
      this.globalRelics[family] = {
        level: (current?.level ?? 0) + 1,
        power: (current?.power ?? 0) + entity.power,
        effects: addRelicEffects(current?.effects ? cloneRelicEffects(current.effects) : emptyRelicEffects(), entity.effects),
        color: entity.color
      }
    }
    this.aether += Math.floor(this.aether * this.interest)
    this.phase = this.wave >= 12 ? 'victory' : 'planning'
    this.message = this.phase === 'victory'
      ? `The realm stands. ${this.coinsEarned} Coins secured!`
      : relic.towerSpecific
        ? `${relic.name} stored. Drag it from the relic belt onto a defense.`
        : `${relic.name} awakened across the realm.`
    this.burst({ x: WIDTH / 2, y: HEIGHT / 2 }, '#fef08a', 32, 260)
    this.emitState()
    if (this.phase === 'victory') this.callbacks.onGameOver(true, this.getSnapshot())
  }

  getSnapshot(): PathwardenSnapshot {
    const selected = this.towers.find(tower => tower.id === this.selectedTowerId)
    return {
      phase: this.phase,
      introStoryActive: this.introStoryActive,
      introStoryIndex: this.introStoryIndex,
      introStoryOpacity: this.introStoryOpacity(),
      activeRunScene: this.activeRunSceneTime > 0,
      activeRunSceneProgress: clamp(this.activeRunSceneTime / this.activeRunSceneDuration, 0, 1),
      openingCinematic: this.openingCinematicActive,
      openingCinematicProgress: clamp(this.openingCinematicTime / this.openingCinematicDuration, 0, 1),
      wave: this.wave,
      lives: this.lives,
      aether: this.aether,
      coinsEarned: this.coinsEarned,
      realm: this.realm,
      flawlessWaves: this.flawlessWaves,
      score: this.score,
      enemies: this.enemies.length + this.spawnLeft,
      towers: this.towers.length,
      streak: this.streak,
      selectedTower: this.selectedTower,
      paused: this.paused,
      relicRanks: { ...this.relicRanks },
      nextWave: this.nextWaveIntel(),
      towerCosts: Object.fromEntries(
        PATHWARDEN_DEFENSE_BLUEPRINTS.map(defense => [defense.id, this.towerCost(defense.id)])
      ),
      message: this.message,
      selectedBuilding: selected ? this.buildingSnapshot(selected) : null,
      relicInventory: this.relicInventory.map(relic => ({ ...relic })),
      canSellRelics: this.canSellRelics
    }
  }

  salvageSelectedBuilding() {
    if (this.phase !== 'planning') return
    const tower = this.towers.find(candidate => candidate.id === this.selectedTowerId)
    if (!tower) return
    const salvage = this.salvageValue(tower)
    this.towers.splice(this.towers.indexOf(tower), 1)
    this.aether += salvage
    this.selectedTowerId = null
    const position = this.gridToScreen(tower)
    this.burst(position, '#5eead4', 18, 140)
    this.message = `${towerStats(tower.type).name} dismantled · ${salvage} Aether recovered.`
    this.emitState()
  }

  clearSelectedBuilding() {
    this.selectedTowerId = null
    this.placementMode = false
    this.emitState()
  }

  private buildingSnapshot(tower: Tower): PathwardenBuilding {
    const stats = towerStats(tower.type)
    const elevation = this.elevations[tower.row]![tower.col]!
    const relicFamily = this.towerRelicFamily(tower)
    const relicPower = this.towerRelicPower(tower)
    const relicEffects = this.towerRelicEffects(tower)
    const relicColor = this.towerRelicColor(tower)
    const relicProfile = relicFamily ? pathwardenRelicProfile(relicFamily, relicPower) : null
    const globalRelics = (['haste', 'range'] as const).flatMap(family => {
      const global = this.globalRelics[family]
      if (!global) return []
      const profile = pathwardenRelicProfile(family, global.power)
      return [{ ...profile, level: global.level, power: global.power, effects: global.effects, color: global.color }]
    })
    return {
      id: tower.id,
      type: tower.type,
      name: stats.name,
      level: tower.level,
      merges: tower.merges,
      invested: tower.invested,
      archetype: this.towerBlueprint(tower.type).archetype,
      family: this.towerBlueprint(tower.type).family,
      tier: this.towerBlueprint(tower.type).tier,
      elevation,
      damage: Math.round(stats.damage * this.damageMultiplier * (1 + (elevation - 1) * 0.16)
        * towerLevelPower(tower.level) * (1 + relicEffects.directDamagePct / 100)),
      range: Math.round(stats.range * this.rangeMultiplier * (1 + (elevation - 1) * 0.09) * (1 + (tower.level - 1) * 0.05)
        * (1 + relicEffects.rangePct / 100)),
      rate: Number((stats.rate / this.rateMultiplier / (1 + relicEffects.attackSpeedPct / 100)).toFixed(2)),
      salvage: this.salvageValue(tower),
      targeting: tower.targeting,
      relicFamily,
      relicStacks: tower.relicFamily ? tower.relicStacks : relicFamily ? 1 : 0,
      relicPower,
      relicName: relicProfile?.name ?? '',
      relicDescription: relicProfile?.description ?? '',
      relicIconIndex: relicProfile?.iconIndex ?? 0,
      relicEntity: tower.relicEntity,
      relicEntities: tower.relicEntities,
      relicEffects,
      relicColor,
      globalRelics
    }
  }

  private nextWaveIntel() {
    const wave = Math.min(12, this.wave + 1)
    const threats = ['Raiders']
    if (wave >= 2) threats.push('Runners')
    if (wave >= 3) threats.push('Brutes')
    if (wave >= 5) threats.push('Shamans')
    if (wave % 4 === 0) threats.push('Guardian')
    return {
      number: wave,
      enemies: this.waveEnemyCount(wave),
      exits: this.enemyExitRoutes().length,
      checkpoint: wave % 4 === 0,
      threats
    }
  }

  private waveEnemyCount(wave: number) {
    const exits = Math.max(1, this.enemyExitRoutes().length)
    const mistVolume = (exits - 1) * (2 + Math.ceil(wave / 3))
    const realmVolume = (this.realm - 1) * (2 + wave)
    return 7 + wave * 3 + mistVolume + realmVolume
  }

  private salvageValue(tower: Tower) {
    return Math.floor(tower.invested * 0.5)
  }

  private towerCost(type: PathwardenTowerType) {
    return Math.ceil(towerStats(type).cost * (1 + (this.towerPurchases[type] ?? 0) * 0.28))
  }

  getDebugState() {
    const roadValidation = this.validateExpansionPlan()
    return {
      ...this.getSnapshot(),
      debugVisuals: this.debugVisuals,
      paused: this.paused,
      camera: {
        x: Number(this.camera.x.toFixed(1)),
        y: Number(this.camera.y.toFixed(1)),
        zoom: Number(this.zoom.toFixed(2)),
        bounds: this.cameraBounds()
      },
      mapSeed: this.mapSeed,
      idleTime: Number(this.idleTime.toFixed(1)),
      ambientEvacuation: Number(this.ambientEvacuation.toFixed(2)),
      pendingWaveStart: this.pendingWaveStart,
      ambientActors: this.ambientActors.map(actor => actor.kind),
      ambientDetails: this.ambientActors.map((actor) => {
        const progress = Number((actor.age / actor.duration).toFixed(3))
        const identity = {
          storyId: actor.storyId,
          family: AMBIENT_FAMILIES[Math.floor((actor.storyId - 1) / 10)]?.name,
          variant: (actor.storyId - 1) % 10 + 1,
          blockKey: actor.blockKey
        }
        if (actor.kind === 'market') {
          return {
            ...identity,
            kind: actor.kind,
            progress,
            stage: progress < 0.18 ? 'building' : progress <= 0.78 ? 'trading' : 'packing'
          }
        }
        if (actor.kind === 'hunt') {
          return {
            ...identity,
            kind: actor.kind,
            progress,
            caught: Math.floor(actor.seed * 997) % 100 < 42,
            stage: progress <= 0.62 ? 'chasing' : 'returning'
          }
        }
        if (actor.kind !== 'crew' || !this.towers.length) return { ...identity, kind: actor.kind, progress }
        const tower = this.towers[Math.floor(actor.seed) % this.towers.length]!
        return {
          ...identity,
          kind: actor.kind,
          target: { col: tower.col, row: tower.row },
          route: this.constructionRoute(tower).map(point => this.worldToCanvas(point))
        }
      }),
      pathLength: this.path.length,
      plannedSections: this.plannedSections.map((section, index) => ({
        index,
        id: section.id,
        parentId: section.parentId,
        depth: section.depth,
        source: { ...section.source },
        cells: section.cells.map(cell => ({ ...cell })),
        active: this.pathChoices.includes(section),
        claimed: this.claimedSections.has(section)
      })),
      mapPlanHash: hashPathwardenMapPlan(this.mapPlan),
      mapRooms: this.mapPlan.rooms.map(room => ({
        id: room.id,
        archetype: room.archetype,
        depth: room.depth,
        claimed: this.plannedSections.some(section =>
          section.roomId === room.id && this.claimedSections.has(section))
      })),
      roadValidation,
      futureExitClearance: this.futureExitClearanceCells().map(point => ({
        ...point,
        screen: this.worldToCanvas(this.gridToScreen(point))
      })),
      buildBlockedCells: this.allBuildBlockedCells().map(point => ({ ...point })),
      placementCells: [...this.revealed].map((key) => {
        const [col, row] = key.split(':').map(Number)
        const point = { col: col!, row: row! }
        return { ...point, ...this.placementStatus(point) }
      }),
      roadCells: this.allRoadCells().map(point => ({ ...point })),
      pathChoices: this.pathChoices.map(choice => ({
        id: choice.id,
        depth: choice.depth,
        source: choice.source,
        anchor: choice.anchor,
        screen: this.worldToCanvas(this.gridToScreen(choice.anchor)),
        cells: choice.cells.map(cell => ({ ...cell }))
      })),
      enemySpawnExits: this.enemyExitRoutes().map(exit => ({
        key: exit.key,
        route: exit.route.map(point => ({ ...point }))
      })),
      towerCells: this.towers.map(tower => ({
        col: tower.col,
        row: tower.row,
        type: tower.type,
        level: tower.level,
        targeting: tower.targeting,
        angle: Number(tower.angle.toFixed(3)),
        screenAngle: Number(this.towerScreenAngle(tower).toFixed(3)),
        anchor: this.worldToCanvas(this.gridToScreen(tower)),
        geometry: Object.fromEntries(Object.entries(this.towerGeometry(tower))
          .map(([key, value]) => [
            key,
            typeof value === 'object' ? this.worldToCanvas(value as Point) : value
          ]))
      })),
      projectiles: this.projectiles.map(projectile => {
        const target = this.enemies.find(enemy => enemy.id === projectile.targetId)
        const targetPosition = target ? this.enemyScreenPosition(target) : projectile
        const progress = clamp(projectile.age / projectile.duration, 0, 1)
        const linearY = projectile.origin.y + (targetPosition.y - projectile.origin.y) * progress
        return {
          type: projectile.type,
          origin: this.worldToCanvas(projectile.origin),
          position: this.worldToCanvas(projectile),
          target: this.worldToCanvas(targetPosition),
          progress: Number(progress.toFixed(3)),
          arcHeight: projectile.arcHeight,
          heightAboveLinear: Number((linearY - projectile.y).toFixed(2))
        }
      }),
      enemyRoutes: this.enemies.map(enemy => ({
        id: enemy.id,
        exitKey: enemy.exitKey,
        progress: Number(enemy.progress.toFixed(2)),
        mistOpacity: Number(this.enemyMistOpacity(enemy).toFixed(2)),
        targetable: this.enemyHasExitedMist(enemy),
        roadAudit: this.validateEnemyRoute(enemy.route),
        route: enemy.route.map(cell => ({ ...cell })),
        screen: this.worldToCanvas(this.enemyScreenPosition(enemy))
      })),
      visibleCells: [...this.revealed].map((key) => {
        const [col, row] = key.split(':').map(Number)
        const point = { col: col!, row: row! }
        return {
          ...point,
          ...this.worldToCanvas(this.gridToScreen(point)),
          elevation: this.elevations[point.row]![point.col]!,
          path: this.path.some(pathCell => cellKey(pathCell) === key)
        }
      })
    }
  }

  private loadAssets() {
    const files: Record<string, string> = {
      grass: 'grass.png',
      grassTall: 'grass-tall.png',
      road: 'road.png',
      tree1: 'tree-1.png',
      tree2: 'tree-2.png',
      rocks: 'rocks.png',
      crystals: 'crystals.png',
      bolt: 'ballista.png',
      mortar: 'mortar.png',
      frost: 'frost.png',
      ember: 'mortar.png',
      storm: 'ballista.png',
      radiant: 'frost.png',
      keep: 'keep.png',
      relics: '../relics.png'
    }
    for (const [name, file] of Object.entries(files)) {
      const image = new Image()
      image.src = `${ASSET_ROOT}/${file}`
      this.assets[name] = image
    }
  }

  private emitState() {
    this.callbacks.onState(this.getSnapshot())
  }

  private noteActivity(clearAmbient = false) {
    this.idleTime = 0
    this.ambientSpawnTimer = Math.max(this.ambientSpawnTimer, 20)
    if (clearAmbient) {
      this.ambientActors = []
      this.ambientEvacuation = 0
      this.pendingWaveStart = false
    } else if (this.ambientActors.some(actor => actor.kind !== 'bird') && this.ambientEvacuation <= 0) {
      this.ambientEvacuation = 0.95
    }
  }

  private spawnAmbientActor() {
    if (this.ambientActors.length >= 4) return
    const storyId = Math.floor(Math.random() * AMBIENT_STORY_COUNT) + 1
    const family = AMBIENT_FAMILIES[Math.floor((storyId - 1) / 10)]!
    if (family.kind === 'crew' && !this.towers.length) {
      this.ambientSpawnTimer = 45 + Math.random() * 90
      return
    }
    const availableBlocks = this.ambientBlockKeys().filter(blockKey =>
      this.ambientActors.filter(actor => actor.blockKey === blockKey).length < 2)
    if (!availableBlocks.length) {
      this.ambientSpawnTimer = 45 + Math.random() * 90
      return
    }
    const blockKey = availableBlocks[Math.floor(Math.random() * availableBlocks.length)]!
    this.ambientActors.push({
      id: this.ambientId++,
      storyId,
      blockKey,
      kind: family.kind,
      age: 0,
      duration: this.ambientDuration(family.kind, storyId),
      seed: storyId * 13.71 + Math.random(),
      countsForProgress: true
    })
    this.ambientSpawnTimer = 75 + Math.random() * 210
  }

  private ambientDuration(kind: AmbientKind, storyId: number) {
    const duration: Record<AmbientKind, number> = {
      market: 150,
      picnic: 210,
      hunt: 125,
      musician: 105,
      children: 80,
      shepherd: 190,
      crew: 95,
      patrol: 75,
      peddler: 110,
      bird: 38,
      cat: 145
    }
    const variant = (storyId - 1) % 10
    return duration[kind] * (0.88 + variant * 0.024)
  }

  private ambientBlockKeys() {
    const roadCells = this.allRoadCells()
      .filter(point => this.revealed.has(cellKey(point)))
      .map(cellKey)
    return roadCells.length ? roadCells : [cellKey(this.path[0]!)]
  }

  private ambientBlockKey(seed: number) {
    const blocks = this.ambientBlockKeys()
    return blocks[Math.abs(Math.floor(seed)) % blocks.length]!
  }

  private frame = (now: number) => {
    if (!this.running || this.destroyed) return
    const delta = Math.min(0.05, (now - this.lastFrame) / 1000)
    const simulationDelta = Math.min(0.05, delta * this.debugTimeScale)
    this.lastFrame = now
    if (!this.introStoryActive && !this.openingCinematicActive) this.updateCamera(delta)
    if (!this.paused) this.updateEffects(simulationDelta)
    if (!this.paused && this.phase === 'wave') this.updateCombat(simulationDelta)
    this.render()
    this.animationFrame = requestAnimationFrame(this.frame)
  }

  private updateCamera(delta: number) {
    if (!this.pointerCanvas || this.towerDrag?.active) return
    const edge = 170
    const minimumSpeed = 120
    const maximumSpeed = 920
    const edgeVelocity = (position: number, size: number) => {
      const distance = Math.min(position, size - position)
      if (distance >= edge) return 0
      const direction = position < size / 2 ? -1 : 1
      const pressure = clamp((edge - distance) / edge, 0, 1)
      return direction * (minimumSpeed + (maximumSpeed - minimumSpeed) * pressure * pressure)
    }
    const xVelocity = edgeVelocity(this.pointerCanvas.x, WIDTH)
    const yVelocity = edgeVelocity(this.pointerCanvas.y, HEIGHT)
    const bounds = this.cameraBounds()
    this.camera.x = clamp(this.camera.x + xVelocity * delta, bounds.minX, bounds.maxX)
    this.camera.y = clamp(this.camera.y + yVelocity * delta, bounds.minY, bounds.maxY)
  }

  private cameraBounds() {
    const bounds = this.revealedScreenBounds()
    if (!bounds) return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
    const halfWidth = WIDTH / (2 * this.zoom)
    const halfHeight = HEIGHT / (2 * this.zoom)
    const left = bounds.minX - WORLD_VIEW_CENTER.x + halfWidth - TILE_WIDTH
    const right = bounds.maxX - WORLD_VIEW_CENTER.x - halfWidth + TILE_WIDTH
    const top = bounds.minY - WORLD_VIEW_CENTER.y + halfHeight - TILE_HEIGHT
    const bottom = bounds.maxY - WORLD_VIEW_CENTER.y - halfHeight + TILE_HEIGHT
    return {
      minX: Math.min(left, right),
      maxX: Math.max(left, right),
      minY: Math.min(top, bottom),
      maxY: Math.max(top, bottom)
    }
  }

  private revealedScreenBounds() {
    const points = [...this.revealed].map((key) => {
      const [col, row] = key.split(':').map(Number)
      return this.gridToScreen({ col: col!, row: row! })
    })
    if (!points.length) return null
    return {
      minX: Math.min(...points.map(point => point.x)),
      maxX: Math.max(...points.map(point => point.x)),
      minY: Math.min(...points.map(point => point.y)),
      maxY: Math.max(...points.map(point => point.y))
    }
  }

  private minimumZoom() {
    const bounds = this.revealedScreenBounds()
    if (!bounds) return DEFAULT_WORLD_SCALE
    const width = bounds.maxX - bounds.minX + TILE_WIDTH * 1.8
    const height = bounds.maxY - bounds.minY + TILE_HEIGHT * 2.5
    return clamp(Math.min((WIDTH - 48) / width, (HEIGHT - 48) / height), 0.12, DEFAULT_WORLD_SCALE)
  }

  private updateEffects(delta: number) {
    if (this.activeRunSceneTime > 0) this.activeRunSceneTime = Math.max(0, this.activeRunSceneTime - delta)
    if (this.introStoryActive) {
      if (!this.introStoryPaused) {
        this.introStoryTime += delta
        if (this.introStoryTime >= this.introStorySlideDuration) {
          if (this.introStoryIndex < this.introStorySlideCount - 1) {
            this.introStoryIndex++
            this.introStoryTime = 0
          } else {
            this.introStoryPaused = false
          }
        }
      }
      this.emitState()
      return
    }
    if (this.openingCinematicActive) {
      this.openingCinematicTime += delta
      if (this.openingCinematicTime >= this.openingCinematicDuration) {
        this.openingCinematicActive = false
        this.openingCinematicPlayed = true
        this.phase = 'planning'
        this.message = 'The mist has settled. Raise your defenses, then call the first wave.'
        this.emitState()
      } else {
        this.emitState()
      }
      return
    }
    this.shake = Math.max(0, this.shake - delta * 24)
    this.redFlash = Math.max(0, this.redFlash - delta * 2.8)
    this.waveBanner = Math.max(0, this.waveBanner - delta)
    const ashflakeCap = 96
    this.ashflakeAccumulator += delta * this.ashPiles.length
    while (this.ashflakeAccumulator >= 1) {
      this.ashflakeAccumulator -= 1
      if (this.ashflakes.length >= ashflakeCap || !this.ashPiles.length) break
      const pile = this.ashPiles[Math.floor(Math.random() * this.ashPiles.length)]!
      pile.flakesGenerated++
      const maxLife = 7 + Math.random() * 5
      this.ashflakes.push({
        x: Math.random() * WIDTH,
        y: 80 + Math.random() * (HEIGHT - 100),
        vx: -12 + Math.random() * 24,
        vy: 8 + Math.random() * 18,
        size: 1.5 + Math.random() * 2.5,
        life: maxLife,
        maxLife,
        rotation: Math.random() * Math.PI * 2,
        spin: -1.2 + Math.random() * 2.4
      })
    }
    for (const flake of [...this.ashflakes]) {
      flake.life -= delta
      flake.x += flake.vx * delta + Math.sin(flake.life * 1.3) * 3 * delta
      flake.y += flake.vy * delta
      flake.rotation += flake.spin * delta
      if (flake.life <= 0 || flake.y > HEIGHT + 12) this.ashflakes.splice(this.ashflakes.indexOf(flake), 1)
    }
    this.streakTimer -= delta
    if (this.streakTimer <= 0) this.streak = 0
    if (this.ambientEvacuation > 0) {
      this.ambientEvacuation = Math.max(0, this.ambientEvacuation - delta)
      if (this.ambientEvacuation <= 0) {
        this.ambientActors = []
        if (this.pendingWaveStart) this.beginWave()
      }
    } else if (this.phase === 'planning' && !this.towerDrag) {
      this.idleTime += delta
      this.ambientSpawnTimer -= delta
      if (this.idleTime >= 20 && this.ambientSpawnTimer <= 0 && this.ambientActors.length < 4) this.spawnAmbientActor()
    } else {
      this.idleTime = 0
    }
    for (const actor of [...this.ambientActors]) {
      if (!this.pendingWaveStart) actor.age += delta
      if (actor.age >= actor.duration) {
        this.ambientActors.splice(this.ambientActors.indexOf(actor), 1)
        if (actor.countsForProgress) this.callbacks.onAmbientStoryComplete?.(actor.storyId)
        this.ambientSpawnTimer = Math.max(this.ambientSpawnTimer, 35 + Math.random() * 90)
      }
    }

    for (const tower of this.towers) tower.recoil = Math.max(0, tower.recoil - delta * 7)
    for (const enemy of this.enemies) {
      enemy.hitFlash = Math.max(0, enemy.hitFlash - delta * 6)
    }
    for (const particle of [...this.particles]) {
      particle.life -= delta
      particle.vy += particle.gravity * delta
      particle.x += particle.vx * delta
      particle.y += particle.vy * delta
      if (particle.life <= 0) this.particles.splice(this.particles.indexOf(particle), 1)
    }
    for (const text of [...this.floatingTexts]) {
      text.life -= delta
      text.y -= delta * 34
      if (text.life <= 0) this.floatingTexts.splice(this.floatingTexts.indexOf(text), 1)
    }
    if (this.failedPlacement) {
      this.failedPlacement.life -= delta
      if (this.failedPlacement.life <= 0) this.failedPlacement = null
    }
    for (const shockwave of [...this.shockwaves]) {
      shockwave.life -= delta
      shockwave.radius += delta * shockwave.maxRadius * 2.8
      if (shockwave.life <= 0) this.shockwaves.splice(this.shockwaves.indexOf(shockwave), 1)
    }
  }

  private introStoryOpacity() {
    if (!this.introStoryActive) return 1
    if (this.introStoryPaused || this.introStoryIndex === this.introStorySlideCount - 1) return 1
    const localTime = this.introStoryTime % this.introStorySlideDuration
    const fadeDuration = 0.7
    return clamp(Math.min(localTime / fadeDuration, (this.introStorySlideDuration - localTime) / fadeDuration), 0.2, 1)
  }

  private updateCombat(delta: number) {
    if (this.spawnLeft > 0) {
      this.spawnTimer -= delta
      if (this.spawnTimer <= 0) {
        this.spawnEnemy()
        this.spawnLeft--
        const exitPressure = Math.max(0, this.enemyExitRoutes().length - 1)
        const realmPressure = 1 - (this.realm - 1) * 0.07
        this.spawnTimer = Math.max(
          0.16,
          (0.76 - this.wave * 0.028) * realmPressure / (1 + exitPressure * 0.08)
        )
      }
    }

    for (const tower of this.towers) {
      tower.cooldown -= delta
      const origin = worldCenter(tower)
      const stats = towerStats(tower.type)
      const elevation = this.elevations[tower.row]![tower.col]!
      const relicEffects = this.towerRelicEffects(tower)
      const range = stats.range * this.rangeMultiplier * (1 + (elevation - 1) * 0.09) * (1 + (tower.level - 1) * 0.05)
        * (1 + relicEffects.rangePct / 100)
      if (this.towerBlueprint(tower.type).family === 'winter') {
        for (const enemy of this.enemies) {
          if (this.enemyHasExitedMist(enemy) && distance(origin, this.enemyWorldPosition(enemy)) <= range) {
            enemy.slow = Math.max(enemy.slow, stats.slow, relicEffects.slowPct / 100)
            enemy.slowTimer = Math.max(enemy.slowTimer, 0.16)
          }
        }
      }
      const target = this.enemies
        .filter(enemy =>
          this.enemyHasExitedMist(enemy)
          && distance(origin, this.enemyWorldPosition(enemy)) <= range)
        .sort((a, b) => {
          if (tower.targeting === 'strong') return b.hp - a.hp
          if (tower.targeting === 'fast') return b.speed - a.speed
          return b.progress / Math.max(1, b.route.length - 1) - a.progress / Math.max(1, a.route.length - 1)
        })[0]
      if (!target) continue
      const targetPosition = this.enemyWorldPosition(target)
      tower.angle = Math.atan2(targetPosition.y - origin.y, targetPosition.x - origin.x)
      if (tower.cooldown > 0) continue
      const geometry = this.towerGeometry(tower)
      const start = geometry.muzzle
      const targetScreen = this.enemyScreenPosition(target)
      const flightDistance = distance(start, targetScreen)
      const archetype = this.towerArchetype(tower.type)
      const relicFamily = this.towerRelicFamily(tower)
      const relicPower = this.towerRelicPower(tower)
      const relicColor = this.towerRelicColor(tower)
      const duration = archetype === 'mortar'
        ? clamp(flightDistance / 260, 0.55, 1.15)
        : Math.max(0.08, flightDistance / stats.projectileSpeed)
      tower.relicShots++
      const echo = relicFamily === 'chain' && relicEffects.echoEveryShots > 0 && tower.relicShots % Math.max(1, Math.round(relicEffects.echoEveryShots)) === 0
      const relicSplash = relicEffects.impactRadius
      let splashFactor = 1
      if (relicFamily === 'radiant') splashFactor = stats.splash > 0 ? 0.34 : Math.min(0.75, relicEffects.impactDamagePct / 100)
      else if (relicFamily === 'blast') splashFactor = 0.55
      this.projectiles.push({
        x: start.x,
        y: start.y - 42 - (elevation - 1) * 11,
        type: tower.type,
        relicFamily,
        relicPower,
        relicEffects,
        echo,
        targetId: target.id,
        damage: stats.damage * this.damageMultiplier * (1 + (elevation - 1) * 0.16) * towerLevelPower(tower.level)
          * (1 + relicEffects.directDamagePct / 100),
        speed: stats.projectileSpeed,
        splash: Math.max(stats.splash, relicSplash),
        splashFactor,
        slow: Math.max(stats.slow, relicEffects.slowPct / 100),
        color: relicFamily ? relicColor : stats.color,
        size: archetype === 'mortar' ? 8 : 5,
        trail: [],
        origin: { ...start },
        age: 0,
        duration,
        arcHeight: archetype === 'mortar' ? clamp(70 + flightDistance * 0.18, 78, 150) : 0
      })
      tower.cooldown = stats.rate / this.rateMultiplier / (1 + relicEffects.attackSpeedPct / 100)
      tower.recoil = 1
      this.burst(start, stats.color, 4, 80)
    }

    for (const projectile of [...this.projectiles]) {
      const target = this.enemies.find(enemy => enemy.id === projectile.targetId)
      if (!target) {
        this.projectiles.splice(this.projectiles.indexOf(projectile), 1)
        continue
      }
      const targetPosition = this.enemyScreenPosition(target)
      projectile.trail.unshift({ x: projectile.x, y: projectile.y })
      if (projectile.trail.length > 7) projectile.trail.pop()
      projectile.age += delta
      if (this.towerArchetype(projectile.type) === 'mortar') {
        const progress = clamp(projectile.age / projectile.duration, 0, 1)
        projectile.x = projectile.origin.x + (targetPosition.x - projectile.origin.x) * progress
        projectile.y = projectile.origin.y + (targetPosition.y - projectile.origin.y) * progress
          - Math.sin(Math.PI * progress) * projectile.arcHeight
        if (progress >= 1) {
          this.hitEnemy(target, projectile)
          this.projectiles.splice(this.projectiles.indexOf(projectile), 1)
        }
        continue
      }
      const gap = distance(projectile, targetPosition)
      if (gap < projectile.speed * delta + target.radius) {
        this.hitEnemy(target, projectile)
        this.projectiles.splice(this.projectiles.indexOf(projectile), 1)
      } else {
        projectile.x += (targetPosition.x - projectile.x) / gap * projectile.speed * delta
        projectile.y += (targetPosition.y - projectile.y) / gap * projectile.speed * delta
      }
    }

    for (const enemy of [...this.enemies]) {
      if (enemy.slowTimer > 0) enemy.slowTimer -= delta
      if (enemy.dotTimer > 0) {
        enemy.dotTimer -= delta
        enemy.dotTick -= delta
        if (enemy.dotTick <= 0) {
          enemy.dotTick = 0.5
          const tickDamage = Math.max(1, Math.round(enemy.dotDamage))
          enemy.hp -= tickDamage
          enemy.hitFlash = 0.45
          const dotPosition = this.enemyScreenPosition(enemy)
          this.floatingTexts.push({
            x: dotPosition.x,
            y: dotPosition.y - enemy.radius,
            text: tickDamage.toString(),
            life: 0.45,
            maxLife: 0.45,
            color: '#86efac',
            size: 11
          })
          if (enemy.hp <= 0) {
            this.killEnemy(enemy)
            continue
          }
        }
      }
      if (enemy.type === 'shaman') {
        enemy.healTimer -= delta
        if (enemy.healTimer <= 0) {
          enemy.healTimer = 2.2
          const position = this.enemyWorldPosition(enemy)
          for (const ally of this.enemies) {
            if (distance(position, this.enemyWorldPosition(ally)) < 150) {
              ally.hp = Math.min(ally.maxHp, ally.hp + ally.maxHp * 0.08)
            }
          }
          const screen = this.enemyScreenPosition(enemy)
          this.shockwaves.push({ ...screen, radius: 6, maxRadius: 48, life: 0.7, color: '#86efac' })
        }
      }
      const gateProgress = enemy.route.length - 1
      if (enemy.progress < gateProgress) {
        enemy.progress = Math.min(
          gateProgress,
          enemy.progress + enemy.speed * (enemy.slowTimer > 0 ? 1 - enemy.slow : 1) * delta
        )
        if (enemy.progress < gateProgress) continue
        enemy.attackTimer = 0.35
      }
      enemy.attackTimer -= delta
      if (enemy.attackTimer > 0) continue
      enemy.attackTimer = enemy.type === 'runner'
        ? 0.85
        : enemy.type === 'boss' ? 1.8 : enemy.type === 'brute' ? 1.45 : 1.15
      const damage = enemy.type === 'boss' ? 5 : enemy.type === 'brute' ? 2 : 1
      this.lives -= damage
      this.shake = enemy.type === 'boss' ? 18 : 9
      this.redFlash = 0.55
      const gatePosition = this.castleGatePosition()
      this.burst(gatePosition, '#fb7185', enemy.type === 'boss' ? 36 : 12, 220)
      this.shockwaves.push({
        ...gatePosition,
        radius: 4,
        maxRadius: enemy.type === 'boss' ? 52 : 28,
        life: 0.35,
        color: '#fb7185'
      })
      this.message = `${Math.max(0, this.lives)} heart${this.lives === 1 ? '' : 's'} remain.`
      if (this.lives <= 0) {
        this.phase = 'defeat'
        this.message = `The keep fell on wave ${this.wave}. ${this.coinsEarned} Coins were secured.`
        this.emitState()
        this.callbacks.onGameOver(false, this.getSnapshot())
        return
      }
    }

    if (this.spawnLeft === 0 && this.enemies.length === 0 && this.phase === 'wave') this.finishWave()
    this.emitState()
  }

  private spawnEnemy() {
    const ordinal = this.spawnTotal - this.spawnLeft
    const exits = this.enemyExitRoutes().filter(exit => this.validateEnemyRoute(exit.route).valid)
    if (!exits.length) {
      this.message = 'Road integrity check stopped an invalid enemy route.'
      if (import.meta.dev) console.error('[Pathwarden] No valid enemy route reaches the keep')
      this.spawnLeft = 0
      return
    }
    const exit = exits[ordinal % exits.length]!
    let type: EnemyType = 'raider'
    if (this.wave % 4 === 0 && this.spawnLeft === 1) type = 'boss'
    else if (this.wave >= 5 && ordinal % 7 === 0) type = 'shaman'
    else if (this.wave >= 3 && ordinal % 5 === 0) type = 'brute'
    else if (this.wave >= 2 && ordinal % 3 === 0) type = 'runner'
    const profile = {
      raider: { hp: 1, speed: 1, reward: 1, radius: 13, color: '#fb923c' },
      runner: { hp: 0.7, speed: 1.62, reward: 1.2, radius: 10, color: '#c4b5fd' },
      brute: { hp: 2.5, speed: 0.72, reward: 2.1, radius: 18, color: '#fb7185' },
      shaman: { hp: 1.5, speed: 0.88, reward: 2.4, radius: 15, color: '#4ade80' },
      boss: { hp: 8.5, speed: 0.58, reward: 9, radius: 29, color: '#facc15' }
    }[type]
    const realmHealth = 1 + (this.realm - 1) * 0.22
    const realmSpeed = 1 + (this.realm - 1) * 0.04
    const realmBounty = 1 + (this.realm - 1) * 0.12
    const maxHp = (95 + this.wave * 28)
      * profile.hp
      * realmHealth
      * pathwardenRouteHealthMultiplier(exit.route.length)
    this.enemies.push({
      id: this.enemyId++,
      type,
      route: exit.route,
      exitKey: exit.key,
      // Spawn several precomputed road cells beyond the revealed boundary.
      // Movement begins while fully concealed and fades naturally through fog.
      progress: 0,
      hp: maxHp,
      maxHp,
      speed: (0.6 + this.wave * 0.014) * profile.speed * realmSpeed,
      reward: Math.round((2.5 + this.wave * 0.5) * profile.reward * realmBounty),
      radius: profile.radius,
      slow: 0,
      slowTimer: 0,
      healTimer: 1.2,
      color: profile.color,
      hitFlash: 0,
      attackTimer: 0,
      dotDamage: 0,
      dotTimer: 0,
      dotTick: 0
    })
  }

  private enemyExitRoutes() {
    const active = this.pathChoices.map((choice) => {
      const roadToSource = this.findRoadRoute(this.path[0]!, choice.source)
      const concealedApproach = this.concealedApproachFor(choice)
      const hiddenCell = concealedApproach[concealedApproach.length - 1]!
      return {
        key: cellKey(hiddenCell),
        route: [...roadToSource, ...concealedApproach]
      }
    })
    const represented = new Set(this.pathChoices.map((choice) => {
      return cellKey(choice.source)
    }))
    const links: RoadLink[] = []
    const linkKeys = new Set<string>()
    const addLink = (from: GridPoint, to: GridPoint) => {
      const key = [cellKey(from), cellKey(to)].sort().join('|')
      if (linkKeys.has(key)) return
      linkKeys.add(key)
      links.push({ from, to })
    }
    for (let index = 1; index < this.path.length; index++) addLink(this.path[index - 1]!, this.path[index]!)
    for (const link of this.branchLinks) addLink(link.from, link.to)
    const degrees = new Map<string, number>()
    for (const link of links) {
      degrees.set(cellKey(link.from), (degrees.get(cellKey(link.from)) ?? 0) + 1)
      degrees.set(cellKey(link.to), (degrees.get(cellKey(link.to)) ?? 0) + 1)
    }
    const keepKey = cellKey(this.initialPath[0]!)
    const terminals = [...degrees]
      .filter(([key, degree]) => degree === 1 && key !== keepKey && !represented.has(key))
      .map(([key]) => {
        const link = links.find(candidate => cellKey(candidate.from) === key || cellKey(candidate.to) === key)!
        const endpoint = cellKey(link.from) === key ? link.from : link.to
        const neighbour = cellKey(link.from) === key ? link.to : link.from
        const direction = {
          col: endpoint.col - neighbour.col,
          row: endpoint.row - neighbour.row
        }
        const hiddenApproach = Array.from({ length: 4 }, (_, index) => ({
          col: endpoint.col + direction.col * (index + 1),
          row: endpoint.row + direction.row * (index + 1)
        }))
        return {
          key: cellKey(hiddenApproach[hiddenApproach.length - 1]!),
          route: [...this.findRoadRoute(this.path[0]!, endpoint), ...hiddenApproach]
        }
      })
    return [...active, ...terminals]
  }

  private concealedApproachFor(choice: PathChoice) {
    const approach = this.plannedChoiceRoute(choice)
    let section = choice
    const visited = new Set([choice.id])
    while (approach.filter(cell => !this.revealed.has(cellKey(cell))).length < 4) {
      const child = this.plannedSections.find(candidate =>
        candidate.parentId === (section.roomId ?? section.id) && !visited.has(candidate.id))
      if (!child) break
      visited.add(child.id)
      approach.push(...this.plannedChoiceRoute(child))
      section = child
    }

    const hiddenCount = approach.filter(cell => !this.revealed.has(cellKey(cell))).length
    if (hiddenCount < 4) {
      const endpoint = approach[approach.length - 1] ?? choice.source
      const previous = approach[approach.length - 2] ?? choice.source
      const direction = {
        col: Math.sign(endpoint.col - previous.col),
        row: Math.sign(endpoint.row - previous.row)
      }
      for (let index = hiddenCount; index < 4; index++) {
        approach.push({
          col: endpoint.col + direction.col * (index - hiddenCount + 1),
          row: endpoint.row + direction.row * (index - hiddenCount + 1)
        })
      }
    }
    return approach
  }

  private plannedChoiceRoute(choice: PathChoice) {
    if (!choice.links?.length) return choice.cells.map(cell => ({ ...cell }))
    const target = choice.exitCells?.[0] ?? choice.cells[choice.cells.length - 1]
    if (!target) return []
    const graph = new Map<string, GridPoint[]>()
    const points = new Map<string, GridPoint>()
    const add = (from: GridPoint, to: GridPoint) => {
      points.set(cellKey(from), from)
      points.set(cellKey(to), to)
      graph.set(cellKey(from), [...(graph.get(cellKey(from)) ?? []), to])
      graph.set(cellKey(to), [...(graph.get(cellKey(to)) ?? []), from])
    }
    for (const link of choice.links) add(link.from, link.to)
    const startKey = cellKey(choice.source)
    const targetKey = cellKey(target)
    const queue = [startKey]
    const previous = new Map<string, string | null>([[startKey, null]])
    while (queue.length) {
      const current = queue.shift()!
      if (current === targetKey) break
      for (const neighbour of graph.get(current) ?? []) {
        const neighbourKey = cellKey(neighbour)
        if (previous.has(neighbourKey)) continue
        previous.set(neighbourKey, current)
        queue.push(neighbourKey)
      }
    }
    if (!previous.has(targetKey)) return choice.cells.map(cell => ({ ...cell }))
    const route: GridPoint[] = []
    let cursor: string | null = targetKey
    while (cursor && cursor !== startKey) {
      route.unshift({ ...points.get(cursor)! })
      cursor = previous.get(cursor) ?? null
    }
    return route
  }

  private finishWave() {
    this.aether += 30 + this.wave * 5
    const checkpoint = this.wave === 4 || this.wave === 8 || this.wave === 12
    if (this.lives === this.waveStartingLives) {
      this.flawlessWaves++
      const flawlessScore = 300 * this.wave * this.realm
      this.score += flawlessScore
      this.floatingTexts.push({
        x: WIDTH / 2,
        y: 58,
        text: `FLAWLESS WAVE · +${flawlessScore.toLocaleString()}`,
        life: 2.4,
        maxLife: 2.4,
        color: '#67e8f9',
        size: 18,
        screenSpace: true
      })
    }
    this.phase = checkpoint ? 'checkpoint' : this.pathChoices.length ? 'path' : 'upgrade'
    this.message = checkpoint
      ? `Checkpoint ${this.wave / 4} secured. Bank your Aether or risk it on the next march.`
      : 'The mist retreats. Choose a frontier tile to reveal the next road.'
    if (checkpoint) {
      this.floatingTexts.push({
        x: WIDTH / 2,
        y: 130,
        text: `CHECKPOINT ${this.wave / 4} SECURED`,
        life: 2.8,
        maxLife: 2.8,
        color: '#fde047',
        size: 30,
        screenSpace: true
      })
    }
    if (this.phase === 'path') this.focusFrontierChoices()
    if (this.phase === 'upgrade') this.offerUpgrades()
  }

  private focusFrontierChoices() {
    if (!this.pathChoices.length) return
    const points = this.pathChoices.map(choice => this.gridToScreen(choice.anchor))
    const focus = {
      x: (Math.min(...points.map(point => point.x)) + Math.max(...points.map(point => point.x))) / 2,
      y: (Math.min(...points.map(point => point.y)) + Math.max(...points.map(point => point.y))) / 2
    }
    const bounds = this.cameraBounds()
    this.camera.x = clamp(focus.x - WORLD_VIEW_CENTER.x, bounds.minX, bounds.maxX)
    this.camera.y = clamp(focus.y - WORLD_VIEW_CENTER.y, bounds.minY, bounds.maxY)
  }

  private enemyWorldPosition(enemy: Enemy): Point {
    if (enemy.debugWorldPosition) return enemy.debugWorldPosition
    const reversed = [...enemy.route].reverse()
    const segment = Math.min(reversed.length - 2, Math.floor(enemy.progress))
    const fraction = enemy.progress - segment
    const from = worldCenter(reversed[segment]!)
    const to = worldCenter(reversed[segment + 1]!)
    return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction }
  }

  private enemyGridPosition(enemy: Enemy): Point {
    const world = this.enemyWorldPosition(enemy)
    return { x: world.x / WORLD_CELL - 0.5, y: world.y / WORLD_CELL - 0.5 }
  }

  private enemyScreenPosition(enemy: Enemy): Point {
    if (enemy.debugScreenPosition) return enemy.debugScreenPosition
    const grid = this.enemyGridPosition(enemy)
    const elevation = this.interpolatedElevation(grid.x, grid.y)
    return {
      x: ORIGIN_X + (grid.x - grid.y) * TILE_WIDTH / 2,
      y: ORIGIN_Y + (grid.x + grid.y) * TILE_HEIGHT / 2 - elevation * 13 - enemy.radius * 0.68
    }
  }

  private enemyMistOpacity(enemy: Enemy) {
    // Visibility follows the actual hidden-to-revealed road crossing. A
    // time-since-spawn fade made enemies visible on concealed road cells,
    // which visually read as walking across grass.
    const reversed = [...enemy.route].reverse()
    const firstRevealedIndex = reversed.findIndex(cell => this.revealed.has(cellKey(cell)))
    if (firstRevealedIndex < 0) return 0
    const fadeStart = Math.max(0, firstRevealedIndex - 1.35)
    return clamp((enemy.progress - fadeStart) / 1.35, 0, 1)
  }

  private enemyHasExitedMist(enemy: Enemy) {
    if (this.enemyMistOpacity(enemy) < 1) return false
    const reversed = [...enemy.route].reverse()
    const segment = Math.min(reversed.length - 2, Math.floor(enemy.progress))
    const from = reversed[segment]!
    const to = reversed[segment + 1]!
    // The hidden-to-visible crossing remains behind fog. Targeting starts on
    // the following segment, once both ends of the movement are discovered.
    return this.revealed.has(cellKey(from)) && this.revealed.has(cellKey(to))
  }

  private interpolatedElevation(col: number, row: number) {
    const roundedCol = clamp(Math.round(col), 0, COLS - 1)
    const roundedRow = clamp(Math.round(row), 0, ROWS - 1)
    return this.elevations[roundedRow]![roundedCol]!
  }

  private hitEnemy(target: Enemy, projectile: Projectile) {
    const impact = this.enemyScreenPosition(target)
    const targets = projectile.splash > 0
      ? this.enemies.filter(enemy => distance(this.enemyWorldPosition(enemy), this.enemyWorldPosition(target)) <= projectile.splash)
      : [target]
    for (const enemy of targets) {
      const relicEffects = projectile.relicEffects ?? relicEffectsFor(projectile.relicFamily ?? 'fire', projectile.relicPower)
      const splashScale = enemy === target ? 1 : projectile.splashFactor
      const armoredBonus = projectile.relicFamily === 'pierce' && (enemy.type === 'brute' || enemy.type === 'boss')
        ? 1 + relicEffects.armorPiercePct / 100
        : 1
      const damage = Math.round(projectile.damage * splashScale * armoredBonus)
      enemy.hp -= damage
      enemy.hitFlash = 1
      if (projectile.slow > 0) {
        enemy.slow = projectile.slow
        enemy.slowTimer = 1.9
      }
      if (enemy === target && (projectile.relicFamily === 'fire' || projectile.relicFamily === 'venom')) {
        const duration = relicEffects.burnDuration
        enemy.dotDamage = Math.max(enemy.dotDamage, projectile.damage * relicEffects.burnPct / 100 / Math.max(1, duration * 2))
        enemy.dotTimer = Math.max(enemy.dotTimer, duration)
        enemy.dotTick = Math.min(enemy.dotTick || 0.5, 0.5)
      }
      const position = this.enemyScreenPosition(enemy)
      this.floatingTexts.push({
        x: position.x + (Math.random() - 0.5) * 14,
        y: position.y - enemy.radius,
        text: damage.toString(),
        life: 0.65,
        maxLife: 0.65,
        color: projectile.color,
        size: enemy.type === 'boss' ? 19 : 14
      })
      if (enemy.hp <= 0) this.killEnemy(enemy)
    }
    const relicEffects = projectile.relicEffects ?? relicEffectsFor(projectile.relicFamily ?? 'fire', projectile.relicPower)
    if (projectile.relicFamily === 'storm') {
      const jumps = Math.min(5, Math.max(0, Math.round(relicEffects.chainCount)))
      const nearby = this.enemies
        .filter(enemy => enemy !== target && this.enemyHasExitedMist(enemy)
          && distance(this.enemyWorldPosition(enemy), this.enemyWorldPosition(target)) <= 145)
        .slice(0, jumps)
      let retained = relicEffects.chainRetentionPct / 100
      let from = impact
      for (const enemy of nearby) {
        const jumpDamage = Math.max(1, Math.round(projectile.damage * retained))
        enemy.hp -= jumpDamage
        enemy.hitFlash = 1
        const position = this.enemyScreenPosition(enemy)
        this.shockwaves.push({ ...position, radius: 3, maxRadius: 18, life: 0.25, color: '#fde047' })
        this.particles.push({
          x: (from.x + position.x) / 2,
          y: (from.y + position.y) / 2,
          vx: 0,
          vy: 0,
          life: 0.2,
          maxLife: 0.2,
          size: 5,
          color: '#fde047',
          gravity: 0
        })
        if (enemy.hp <= 0) this.killEnemy(enemy)
        from = position
        retained *= relicEffects.chainRetentionPct / 100
      }
    }
    if (projectile.echo && target.hp > 0) {
      const echoDamage = Math.round(projectile.damage * Math.min(0.8, relicEffects.echoPowerPct / 100))
      target.hp -= echoDamage
      this.shockwaves.push({ ...impact, radius: 5, maxRadius: 34, life: 0.35, color: '#c4b5fd' })
      if (target.hp <= 0) this.killEnemy(target)
    }
    if (projectile.relicFamily === 'leech' && this.lives < this.maxLives) {
      this.lives = Math.min(this.maxLives, this.lives + this.maxLives * 0.0012 * projectile.relicPower)
    }
    if (projectile.splash > 0) {
      this.shake = Math.max(this.shake, 6)
      this.shockwaves.push({ ...impact, radius: 6, maxRadius: projectile.splash * 0.65, life: 0.48, color: projectile.color })
      this.burst(impact, projectile.color, 20, 210)
    } else {
      this.burst(impact, projectile.color, 7, 120)
    }
  }

  private killEnemy(enemy: Enemy) {
    const index = this.enemies.indexOf(enemy)
    if (index < 0) return
    this.enemies.splice(index, 1)
    const reward = Math.floor(enemy.reward * this.bountyMultiplier)
    this.aether += reward
    if (this.killRepairPercent > 0 && this.lives < this.maxLives) {
      this.lives = Math.min(this.maxLives, this.lives + this.maxLives * this.killRepairPercent)
    }
    this.streak++
    this.streakTimer = 2.5
    const multiplier = 1 + Math.min(2, Math.floor(this.streak / 8) * 0.25)
    this.score += Math.round(reward * 10 * multiplier * (1 + (this.realm - 1) * 0.25))
    const position = this.enemyScreenPosition(enemy)
    this.burst(position, enemy.color, enemy.type === 'boss' ? 42 : 14, enemy.type === 'boss' ? 300 : 180)
    if (this.streak > 0 && this.streak % 8 === 0) {
      this.floatingTexts.push({
        x: position.x,
        y: position.y - 38,
        text: `${this.streak} STREAK!`,
        life: 1.15,
        maxLife: 1.15,
        color: '#fef08a',
        size: 23
      })
      this.shake = Math.max(this.shake, 7)
    }
  }

  private precalculateExpansionPlan(rounds: number) {
    if (rounds !== this.mapPlan.metrics.maxDepth) {
      throw new Error(`Pathwarden plan depth ${this.mapPlan.metrics.maxDepth} does not match ${rounds}`)
    }
    const roomById = new Map(this.mapPlan.rooms.map(room => [room.id, room]))
    const expansionSections = this.mapPlan.connections
      .filter(connection => connection.kind === 'expansion')
      .map((connection): PathChoice => {
        const room = roomById.get(connection.toRoomId)!
        const sourceRoom = roomById.get(connection.fromRoomId)!
        const source = sourceRoom.ports.find(port => port.id === connection.fromPortId)!.cell
        const links = this.mapPlan.roadLinks
          .filter(link => link.roomId === room.id)
          .map(link => ({ from: { ...link.from }, to: { ...link.to } }))
        const firstLink = links.find(link => cellKey(link.from) === cellKey(source)) ?? links[0]!
        return {
          id: connection.id,
          parentId: connection.fromRoomId,
          roomId: room.id,
          depth: room.depth,
          source: { ...source },
          anchor: { ...firstLink.to },
          cells: [
            ...room.roadCells,
            ...(room.terminalApproaches ?? []).flatMap(approach => approach.cells)
          ]
            .map(cell => ({ ...cell })),
          links,
          revealCells: room.revealCells.map(cell => ({ ...cell })),
          exitCells: room.ports.filter(port => port.kind === 'exit').map(port => ({ ...port.cell })),
          previewCells: room.roadCells.map(cell => ({ ...cell }))
        }
      })
    const terminalSections = this.mapPlan.rooms
      .filter(room => room.depth + 1 < this.mapPlan.metrics.maxDepth)
      .flatMap(room => (room.terminalApproaches ?? []).map((approach): PathChoice => {
        const port = room.ports.find(candidate => candidate.id === approach.portId)!
        const cells = approach.cells.map(cell => ({ ...cell }))
        const links = cells.map((cell, index) => ({
          from: index === 0 ? { ...port.cell } : { ...cells[index - 1]! },
          to: { ...cell }
        }))
        return {
          id: `terminal:${room.id}:${approach.portId}`,
          terminal: true,
          parentId: room.id,
          depth: room.depth + 1,
          source: { ...port.cell },
          anchor: { ...cells[0]! },
          cells,
          links,
          revealCells: cells.map(cell => ({ ...cell })),
          previewCells: cells.map(cell => ({ ...cell }))
        }
      }))
    this.plannedSections = [...expansionSections, ...terminalSections]
    const validation = this.validateExpansionPlan()
    if (!validation.valid) {
      throw new Error(`Unable to load Pathwarden room plan: ${validation.errors.join(', ')}`)
    }
  }

  private planRandom() {
    this.mapRandomState |= 0
    this.mapRandomState = this.mapRandomState + 0x6D2B79F5 | 0
    let value = Math.imul(this.mapRandomState ^ this.mapRandomState >>> 15, 1 | this.mapRandomState)
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
  }

  private shufflePlan<T>(values: T[]) {
    const copy = [...values]
    for (let index = copy.length - 1; index > 0; index--) {
      const swap = Math.floor(this.planRandom() * (index + 1))
      const current = copy[index]!
      copy[index] = copy[swap]!
      copy[swap] = current
    }
    return copy
  }

  private generateExpansionPlan(rounds: number) {
    const occupied = new Set(this.path.map(cellKey))
    const queue: Array<{ source: GridPoint, depth: number, parentId: string | null }> = [{
      source: { ...this.path[this.path.length - 1]! },
      depth: 0,
      parentId: null
    }]
    // The incoming keep road reaches a true four-way crossroads with three
    // exits. Every surviving branch splits again at staggered depths. With
    // thirteen reveals this produces up to 24 complete campaigns (3 × 2³),
    // while collision checks and full-plan retries keep the network legible.
    const sectionLimit = 200
    let sectionId = 0
    while (queue.length && this.plannedSections.length < sectionLimit) {
      const entry = queue.shift()!
      if (entry.depth >= rounds) continue
      const verticalSteps = this.mapSeed % 2
        ? [
            { col: entry.source.col, row: entry.source.row - 1 },
            { col: entry.source.col, row: entry.source.row + 1 }
          ]
        : [
            { col: entry.source.col, row: entry.source.row + 1 },
            { col: entry.source.col, row: entry.source.row - 1 }
          ]
      const cardinalSteps = [
        { col: entry.source.col + 1, row: entry.source.row },
        ...verticalSteps,
        { col: entry.source.col - 1, row: entry.source.row }
      ]
      const firstSteps = (entry.depth === 0 ? cardinalSteps : this.shufflePlan(cardinalSteps))
        .filter(point => this.validPlannedRoadCell(point, entry.source, occupied, entry.depth >= 1))
      const branchLimit = entry.depth === 0
        ? 3
        : [1, 5, 9].includes(entry.depth) ? 2 : 1
      for (const first of firstSteps.slice(0, branchLimit)) {
        if (!this.validPlannedRoadCell(first, entry.source, occupied, entry.depth >= 1)) continue
        const cells = [first]
        occupied.add(cellKey(first))
        while (cells.length < 2) {
          const current = cells[cells.length - 1]!
          const previous = cells.length > 1 ? cells[cells.length - 2]! : entry.source
          const direction = { col: current.col - previous.col, row: current.row - previous.row }
          const candidates = this.shufflePlan([
            { col: current.col + 1, row: current.row },
            { col: current.col - 1, row: current.row },
            { col: current.col, row: current.row + 1 },
            { col: current.col, row: current.row - 1 }
          ]).filter(point => this.validPlannedRoadCell(point, current, occupied))
          const straight = candidates.find(point =>
            point.col - current.col === direction.col && point.row - current.row === direction.row)
          const next = straight ?? candidates[0]
          if (!next) break
          cells.push(next)
          occupied.add(cellKey(next))
        }
        const section: PathChoice = {
          id: `road-${sectionId++}`,
          parentId: entry.parentId,
          depth: entry.depth + 1,
          source: { ...entry.source },
          anchor: { ...cells[cells.length - 1]! },
          cells: cells.map(cell => ({ ...cell }))
        }
        this.plannedSections.push(section)
        queue.push({
          source: { ...cells[cells.length - 1]! },
          depth: entry.depth + 1,
          parentId: section.id
        })
        if (this.plannedSections.length >= sectionLimit) break
      }
    }
  }

  private validPlannedRoadCell(
    point: GridPoint,
    predecessor: GridPoint,
    occupied: Set<string>,
    allowLateral = false
  ) {
    if (!this.validPathCell(point, occupied, new Set())) return false
    const keep = this.path[0]!
    const predecessorDistance = Math.abs(predecessor.col - keep.col) + Math.abs(predecessor.row - keep.row)
    const pointDistance = Math.abs(point.col - keep.col) + Math.abs(point.row - keep.row)
    if (pointDistance < predecessorDistance || (!allowLateral && pointDistance === predecessorDistance)) return false
    const neighbours = [
      { col: point.col + 1, row: point.row },
      { col: point.col - 1, row: point.row },
      { col: point.col, row: point.row + 1 },
      { col: point.col, row: point.row - 1 }
    ]
    if (!neighbours.every(neighbour =>
      cellKey(neighbour) === cellKey(predecessor) || !occupied.has(cellKey(neighbour)))) return false

    // Reject parallel corridors two cells apart. A single nearby crossing is
    // harmless; matching occupied cells beside both ends means another whole
    // segment is running alongside this one.
    const direction = {
      col: point.col - predecessor.col,
      row: point.row - predecessor.row
    }
    const perpendicular = { col: -direction.row, row: direction.col }
    for (const side of [-2, 2]) {
      const besidePoint = {
        col: point.col + perpendicular.col * side,
        row: point.row + perpendicular.row * side
      }
      const besidePredecessor = {
        col: predecessor.col + perpendicular.col * side,
        row: predecessor.row + perpendicular.row * side
      }
      if (!allowLateral
        && occupied.has(cellKey(besidePoint))
        && occupied.has(cellKey(besidePredecessor))) return false
    }
    return true
  }

  private validateExpansionPlan() {
    return validatePathwardenMapPlan(this.mapPlan)
  }

  private activatePlannedChoices(source: GridPoint | string) {
    for (const section of this.plannedSections) {
      if (this.claimedSections.has(section) || this.pathChoices.includes(section)) continue
      if (typeof source === 'string'
        ? section.parentId === source
        : cellKey(section.source) === cellKey(source)) this.pathChoices.push(section)
    }
  }

  private refreshChoiceAnchors() {
    for (const choice of this.pathChoices.filter(candidate => !candidate.terminal)) {
      const firstHiddenRoadCell = choice.cells.find(cell => !this.revealed.has(cellKey(cell)))
      if (firstHiddenRoadCell) {
        // The control belongs at the discovered/undiscovered transition—not
        // at the remote end of the preview. It now marks the precise place
        // where this permanent planned road disappears into the mist.
        choice.anchor = { ...firstHiddenRoadCell }
        continue
      }

      // A terrain reveal can expose the entire short section. In that case
      // the road is already drawn solid and its genuine endpoint is the only
      // honest control position; never invent an extrapolated fake exit.
      const endpoint = choice.cells[choice.cells.length - 1]!
      choice.anchor = { ...endpoint }
    }
  }

  private validPathCell(point: GridPoint, occupied: Set<string>, towerCells: Set<string>) {
    const keep = this.path[0]!
    const insideKeepFootprint = Math.max(Math.abs(point.col - keep.col), Math.abs(point.row - keep.row)) <= 1
    return point.col >= 1
      && point.col < COLS - 1
      && point.row >= 1
      && point.row < ROWS - 1
      && !insideKeepFootprint
      && !occupied.has(cellKey(point))
      && !towerCells.has(cellKey(point))
  }

  private extendPath(choice: PathChoice) {
    if (this.phase !== 'path' || !this.pathChoices.includes(choice)) return
    this.persistCurrentPathLinks()
    const links = choice.links ?? choice.cells.map((cell, index) => ({
      from: index === 0 ? choice.source : choice.cells[index - 1]!,
      to: cell
    }))
    for (const link of links) {
      this.addCommittedRoadLink(link.from, link.to)
      for (const cell of [link.from, link.to]) {
      if (!this.branchRoads.some(road => cellKey(road) === cellKey(cell))) this.branchRoads.push({ ...cell })
      }
    }
    this.pathChoices.splice(this.pathChoices.indexOf(choice), 1)
    this.claimedSections.add(choice)
    const newEndpoint = choice.exitCells?.[0] ?? choice.cells[choice.cells.length - 1]!
    this.path = this.findRoadRoute(this.path[0]!, newEndpoint)
    this.revealAround(choice.revealCells ?? choice.cells)
    this.activatePlannedChoices(choice.roomId ?? newEndpoint)
    this.refreshChoiceAnchors()
    this.phase = this.debugSandbox ? 'path' : 'upgrade'
    this.message = this.debugSandbox
      ? `${choice.cells.length} road tiles revealed. Choose another frontier.`
      : `${choice.cells.length} road tiles revealed. Claim a relic.`
    if (this.debugSandbox) {
      if (this.pathChoices.length) this.focusFrontierChoices()
      else {
        const end = this.gridToScreen(newEndpoint)
        const bounds = this.cameraBounds()
        this.camera.x = clamp(end.x - WORLD_VIEW_CENTER.x, bounds.minX, bounds.maxX)
        this.camera.y = clamp(end.y - WORLD_VIEW_CENTER.y, bounds.minY, bounds.maxY)
      }
    }
    const end = this.gridToScreen(newEndpoint)
    this.burst(end, '#67e8f9', 28, 240)
    this.shockwaves.push({ ...end, radius: 8, maxRadius: 90, life: 0.85, color: '#67e8f9' })
    this.emitState()
    if (!this.debugSandbox) this.offerUpgrades()
  }

  private persistCurrentPathLinks() {
    for (let index = 1; index < this.path.length; index++) {
      this.addCommittedRoadLink(this.path[index - 1]!, this.path[index]!)
    }
  }

  private addCommittedRoadLink(from: GridPoint, to: GridPoint) {
    const exists = this.branchLinks.some(link =>
      (cellKey(link.from) === cellKey(from) && cellKey(link.to) === cellKey(to))
      || (cellKey(link.from) === cellKey(to) && cellKey(link.to) === cellKey(from)))
    if (!exists) this.branchLinks.push({ from: { ...from }, to: { ...to } })
  }

  private findRoadRoute(start: GridPoint, end: GridPoint) {
    const links = [...this.branchLinks]
    for (let index = 1; index < this.path.length; index++) {
      const from = this.path[index - 1]!
      const to = this.path[index]!
      const exists = links.some(link =>
        (cellKey(link.from) === cellKey(from) && cellKey(link.to) === cellKey(to))
        || (cellKey(link.from) === cellKey(to) && cellKey(link.to) === cellKey(from)))
      if (!exists) links.push({ from, to })
    }
    const queue: GridPoint[][] = [[start]]
    const visited = new Set([cellKey(start)])
    while (queue.length) {
      const route = queue.shift()!
      const current = route[route.length - 1]!
      if (cellKey(current) === cellKey(end)) return route
      for (const link of links) {
        const next = cellKey(link.from) === cellKey(current)
          ? link.to
          : cellKey(link.to) === cellKey(current)
            ? link.from
            : null
        if (!next || visited.has(cellKey(next))) continue
        visited.add(cellKey(next))
        queue.push([...route, next])
      }
    }
    throw new Error(`Disconnected road route: ${cellKey(start)} cannot reach ${cellKey(end)}`)
  }

  private enemyRoadLinks() {
    const links: RoadLink[] = []
    const keys = new Set<string>()
    const add = (from: GridPoint, to: GridPoint) => {
      const key = [cellKey(from), cellKey(to)].sort().join('|')
      if (keys.has(key)) return
      keys.add(key)
      links.push({ from, to })
    }
    for (let index = 1; index < this.path.length; index++) add(this.path[index - 1]!, this.path[index]!)
    for (const link of this.branchLinks) add(link.from, link.to)
    for (const section of this.plannedSections) {
      let previous = section.source
      for (const cell of section.cells) {
        add(previous, cell)
        previous = cell
      }
    }
    return { links, keys }
  }

  private validateEnemyRoute(route: GridPoint[]) {
    const errors: string[] = []
    const { keys } = this.enemyRoadLinks()
    if (route.length < 2) errors.push('route has fewer than two cells')
    for (let index = 1; index < route.length; index++) {
      const from = route[index - 1]!
      const to = route[index]!
      const step = Math.abs(from.col - to.col) + Math.abs(from.row - to.row)
      const key = [cellKey(from), cellKey(to)].sort().join('|')
      if (step !== 1) errors.push(`segment ${index - 1} jumps from ${cellKey(from)} to ${cellKey(to)}`)
      const touchesRevealedWorld = this.revealed.has(cellKey(from)) || this.revealed.has(cellKey(to))
      if (!keys.has(key) && touchesRevealedWorld) errors.push(`segment ${index - 1} is not a preset road link`)
    }
    if (cellKey(route[0]!) !== cellKey(this.path[0]!)) errors.push('route does not terminate at the keep')
    return { valid: errors.length === 0, errors }
  }

  private revealAround(cells: GridPoint[]) {
    for (const cell of cells) {
      for (let rowOffset = -2; rowOffset <= 2; rowOffset++) {
        for (let colOffset = -2; colOffset <= 2; colOffset++) {
          const point = { col: cell.col + colOffset, row: cell.row + rowOffset }
          if (point.col >= 0 && point.col < COLS && point.row >= 0 && point.row < ROWS) {
            this.revealed.add(cellKey(point))
          }
        }
      }
    }
  }

  private allRoadCells() {
    return [...this.path, ...this.branchRoads]
  }

  private allReservedRoadCells() {
    return [
      ...this.allRoadCells(),
      ...this.plannedSections.flatMap(choice => choice.cells)
    ]
  }

  private futureExitClearanceCells() {
    const roadKeys = new Set(this.allReservedRoadCells().map(cellKey))
    const clearance = new Map<string, GridPoint>()
    const activeEndpoints = new Set(this.pathChoices.map(choice =>
      cellKey(choice.cells[choice.cells.length - 1] ?? choice.source)))
    const protectedSections = this.plannedSections.filter(section =>
      this.pathChoices.includes(section) || activeEndpoints.has(cellKey(section.source)))
    for (const section of protectedSections) {
      const endpoint = section.cells[section.cells.length - 1]
      if (!endpoint) continue
      for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
        for (let colOffset = -1; colOffset <= 1; colOffset++) {
          if (rowOffset === 0 && colOffset === 0) continue
          const point = { col: endpoint.col + colOffset, row: endpoint.row + rowOffset }
          if (point.col < 0 || point.col >= COLS || point.row < 0 || point.row >= ROWS) continue
          if (!roadKeys.has(cellKey(point))) clearance.set(cellKey(point), point)
        }
      }
    }
    return [...clearance.values()]
  }

  private allBuildBlockedCells() {
    const keep = this.initialPath[0]!
    const keepScreen = this.gridToScreen(keep)
    const keepClearance: GridPoint[] = []
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const point = { col, row }
        const screen = this.gridToScreen(point)
        const isKeepCell = col === keep.col && row === keep.row
        const intersectsCastleSilhouette = Math.abs(screen.x - keepScreen.x) < 100
          && screen.y - keepScreen.y > -178
          && screen.y - keepScreen.y < 58
        if (isKeepCell || intersectsCastleSilhouette) keepClearance.push(point)
      }
    }
    return [
      ...this.allReservedRoadCells(),
      ...keepClearance,
      ...this.mapPlan.features
        .filter(feature => !['bridge', 'ford', 'clearing'].includes(feature.kind))
        .flatMap(feature => feature.cells)
    ]
  }

  private blockingFeatureAt(point: GridPoint) {
    const key = cellKey(point)
    return this.mapPlan.features.find(feature =>
      !['bridge', 'ford', 'clearing'].includes(feature.kind)
      && feature.cells.some(cell => cellKey(cell) === key)
    )
  }

  private placementPreviewCell() {
    if (this.hoverCell
      && this.revealed.has(cellKey(this.hoverCell))
      && !this.towers.some(tower => tower.col === this.hoverCell!.col && tower.row === this.hoverCell!.row)
      && this.placementStatus(this.hoverCell).allowed) {
      return { ...this.hoverCell }
    }
    for (const key of this.revealed) {
      const [col, row] = key.split(':').map(Number)
      const point = { col: col!, row: row! }
      if (!this.towers.some(tower => tower.col === point.col && tower.row === point.row)
        && this.placementStatus(point).allowed) return point
    }
    return null
  }

  private placementStatus(point: GridPoint) {
    if (!this.revealed.has(cellKey(point))) return { allowed: false, reason: 'The mist still covers that ground.' }
    if (this.allReservedRoadCells().some(road => cellKey(road) === cellKey(point))) {
      const currentRoad = this.allRoadCells().some(road => cellKey(road) === cellKey(point))
      return {
        allowed: false,
        reason: currentRoad
          ? 'Defenses cannot be built on the road.'
          : 'A precharted road will pass through that exact tile.'
      }
    }
    const keep = this.initialPath[0]!
    const keepScreen = this.gridToScreen(keep)
    const screen = this.gridToScreen(point)
    if ((point.col === keep.col && point.row === keep.row)
      || (Math.abs(screen.x - keepScreen.x) < 100
        && screen.y - keepScreen.y > -178
        && screen.y - keepScreen.y < 58)) {
      return { allowed: false, reason: 'The castle courtyard must remain clear.' }
    }
    const feature = this.blockingFeatureAt(point)
    if (feature) {
      const reason: Partial<Record<PathwardenFeatureKind, string>> = {
        river: 'The river is too deep to support a defense.',
        lake: 'Defenses cannot be built in the lake.',
        canyon: 'The canyon floor cannot support a defense.',
        mountain: 'The mountain ridge blocks construction.',
        cliff: 'The cliff face blocks construction.',
        forest: 'The dense forest must remain impassable.'
      }
      return { allowed: false, reason: reason[feature.kind] ?? 'The landscape blocks construction here.' }
    }
    if (this.hasDecoration(point)) return { allowed: false, reason: 'Clear ground is required; rocks and trees cannot hold a defense.' }
    return { allowed: true, reason: 'Open ground.' }
  }

  private offerUpgrades() {
    const rarityRoll = Math.random()
    const rarity: PathwardenRelicRarity = this.wave >= 10 && rarityRoll > 0.9
      ? 'mythic'
      : this.wave >= 7 && rarityRoll > 0.72
        ? 'epic'
        : this.wave >= 4 && rarityRoll > 0.48
          ? 'rare'
          : rarityRoll > 0.24 ? 'uncommon' : 'common'
    const pool = PATHWARDEN_RELICS.filter(relic =>
      relic.rarity === rarity
      && (this.lives < this.maxLives || relic.family !== 'heart'))
    this.callbacks.onUpgrade(shuffle(pool).slice(0, 3).map((relic, index) =>
      this.materializeRelic(relic, this.wave * 97 + index * 31 + Math.floor(rarityRoll * 1000), 1)))
  }

  private gridToScreen(point: GridPoint): Point {
    const elevation = this.elevations[point.row]![point.col]!
    return {
      x: ORIGIN_X + (point.col - point.row) * TILE_WIDTH / 2,
      y: ORIGIN_Y + (point.col + point.row) * TILE_HEIGHT / 2 - elevation * 13
    }
  }

  private castleGatePosition() {
    const center = this.gridToScreen(this.path[0]!)
    const road = this.gridToScreen(this.path[1] ?? this.castleMainExit().cell)
    const gap = Math.hypot(road.x - center.x, road.y - center.y) || 1
    return {
      x: center.x + (road.x - center.x) / gap * 25,
      y: center.y + (road.y - center.y) / gap * 25 - 18
    }
  }

  private towerScreenAngle(tower: Tower) {
    const aimX = Math.cos(tower.angle) - Math.sin(tower.angle)
    const aimY = (Math.cos(tower.angle) + Math.sin(tower.angle)) * TILE_HEIGHT / TILE_WIDTH
    return Math.atan2(aimY, aimX)
  }

  private pointerCell(event: MouseEvent | PointerEvent): GridPoint | null {
    const { x, y } = this.canvasPoint(event)
    let best: GridPoint | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const point = { col, row }
        const screen = this.gridToScreen(point)
        const normalized = Math.abs(x - screen.x) / (TILE_WIDTH / 2) + Math.abs(y - screen.y) / (TILE_HEIGHT / 2)
        if (normalized < bestDistance) {
          bestDistance = normalized
          best = point
        }
      }
    }
    return bestDistance <= 1.25 ? best : null
  }

  private canvasPoint(event: MouseEvent | PointerEvent) {
    const bounds = this.canvas.getBoundingClientRect()
    const canvasX = (event.clientX - bounds.left) / bounds.width * WIDTH
    const canvasY = (event.clientY - bounds.top) / bounds.height * HEIGHT
    return {
      x: WORLD_VIEW_CENTER.x + this.camera.x + (canvasX - WORLD_VIEW_CENTER.x) / this.zoom,
      y: WORLD_VIEW_CENTER.y + this.camera.y + (canvasY - WORLD_VIEW_CENTER.y) / this.zoom
    }
  }

  private worldToCanvas(point: Point) {
    return {
      x: WORLD_VIEW_CENTER.x + (point.x - WORLD_VIEW_CENTER.x - this.camera.x) * this.zoom,
      y: WORLD_VIEW_CENTER.y + (point.y - WORLD_VIEW_CENTER.y - this.camera.y) * this.zoom
    }
  }

  private pointerTower(event: PointerEvent) {
    const pointer = this.canvasPoint(event)
    return [...this.towers]
      .sort((a, b) => this.gridToScreen(b).y - this.gridToScreen(a).y)
      .find((tower) => {
        const geometry = this.towerGeometry(tower)
        return pointer.x >= geometry.screen.x - geometry.width / 2
          && pointer.x <= geometry.screen.x + geometry.width / 2
          // Tall crystals, barrels, and roof ornaments may visually overlap
          // the empty tile behind them in an isometric view. Only the lower
          // body owns drag/select input so that overhang never steals a valid
          // terrain click.
          && pointer.y >= geometry.foot.y - geometry.height * 0.58
          && pointer.y <= geometry.foot.y + 3
      })
  }

  private pointerPathChoice(event: MouseEvent | PointerEvent) {
    const pointer = this.canvasPoint(event)
    let closest: { choice: PathChoice, distance: number } | null = null
    for (const choice of this.pathChoices.filter(candidate => !candidate.terminal)) {
      const screen = this.gridToScreen(choice.anchor)
      const distance = Math.abs(pointer.x - screen.x) / (TILE_WIDTH * 0.62)
        + Math.abs(pointer.y - (screen.y - 8)) / (TILE_HEIGHT * 0.72)
      if (distance <= 1 && (!closest || distance < closest.distance)) closest = { choice, distance }
    }
    return closest?.choice ?? null
  }

  private onPointerMove = (event: PointerEvent) => {
    if (this.introStoryActive || this.openingCinematicActive) return
    const bounds = this.canvas.getBoundingClientRect()
    this.pointerCanvas = {
      x: (event.clientX - bounds.left) / bounds.width * WIDTH,
      y: (event.clientY - bounds.top) / bounds.height * HEIGHT
    }
    this.hoverPathChoice = this.phase === 'path' ? this.pointerPathChoice(event) : null
    this.hoverCell = this.pointerCell(event)
    if (this.towerDrag && !this.towerDrag.active) {
      this.towerDrag.active = Math.hypot(event.clientX - this.towerDrag.startX, event.clientY - this.towerDrag.startY) > 6
    }
  }

  private onPointerLeave = () => {
    this.pointerCanvas = null
    this.hoverPathChoice = null
    if (!this.towerDrag) this.hoverCell = null
  }

  private onWheel = (event: WheelEvent) => {
    if (this.introStoryActive || this.openingCinematicActive) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    const bounds = this.canvas.getBoundingClientRect()
    const pointer = {
      x: (event.clientX - bounds.left) / bounds.width * WIDTH,
      y: (event.clientY - bounds.top) / bounds.height * HEIGHT
    }
    const worldUnderPointer = {
      x: WORLD_VIEW_CENTER.x + this.camera.x + (pointer.x - WORLD_VIEW_CENTER.x) / this.zoom,
      y: WORLD_VIEW_CENTER.y + this.camera.y + (pointer.y - WORLD_VIEW_CENTER.y) / this.zoom
    }
    this.zoom = clamp(this.zoom * Math.exp(-event.deltaY * 0.0012), this.minimumZoom(), 2.35)
    this.camera.x = worldUnderPointer.x - WORLD_VIEW_CENTER.x - (pointer.x - WORLD_VIEW_CENTER.x) / this.zoom
    this.camera.y = worldUnderPointer.y - WORLD_VIEW_CENTER.y - (pointer.y - WORLD_VIEW_CENTER.y) / this.zoom
    const cameraBounds = this.cameraBounds()
    this.camera.x = clamp(this.camera.x, cameraBounds.minX, cameraBounds.maxX)
    this.camera.y = clamp(this.camera.y, cameraBounds.minY, cameraBounds.maxY)
  }

  private onPointerDown = (event: PointerEvent) => {
    if (this.introStoryActive || this.openingCinematicActive) return
    if (event.button !== 0) return
    this.noteActivity()
    if (this.phase !== 'planning') return
    const tower = this.pointerTower(event)
    if (!tower) return
    this.towerDrag = { towerId: tower.id, startX: event.clientX, startY: event.clientY, active: false }
    this.canvas.setPointerCapture(event.pointerId)
  }

  private onPointerUp = (event: PointerEvent) => {
    if (event.button !== 0) return
    if (this.introStoryActive || this.openingCinematicActive) {
      this.towerDrag = null
      return
    }
    if (!this.towerDrag) return
    const drag = this.towerDrag
    const tower = this.towers.find(candidate => candidate.id === drag.towerId)
    const towerUnderPointer = this.pointerTower(event)
    const targetCell = towerUnderPointer && towerUnderPointer.id !== drag.towerId
      ? { col: towerUnderPointer.col, row: towerUnderPointer.row }
      : this.pointerCell(event)
    this.towerDrag = null
    this.suppressClick = true
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    if (!tower) return
    if (!drag.active) {
      const closeProfile = this.selectedTowerId === tower.id
      this.selectedTowerId = closeProfile ? null : tower.id
      this.placementMode = false
      this.message = closeProfile
        ? 'Building profile closed.'
        : `${towerStats(tower.type).name} selected. Drag it to move or combine it.`
      this.emitState()
      return
    }
    this.dropTower(tower, targetCell)
  }

  private onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    if (this.phase !== 'planning') return
    this.callbacks.onOpenBuildingInventory?.()
  }

  private onPointerCancel = () => {
    this.towerDrag = null
  }

  private dropTower(tower: Tower, targetCell: GridPoint | null) {
    if (!targetCell) return
    const target = this.towers.find(candidate =>
      candidate.id !== tower.id && candidate.col === targetCell.col && candidate.row === targetCell.row)
    if (target) {
      if (target.type !== tower.type || target.level !== tower.level) {
        this.message = 'Only equal defenses of the same type and level can be fused.'
      } else if (target.relicFamily !== tower.relicFamily) {
        this.message = 'Only defenses carrying the same relic type can be fused.'
      } else if (target.level >= 3) {
        this.message = 'That defense has already reached its final form.'
      } else {
        this.towers.splice(this.towers.indexOf(tower), 1)
        target.level++
        target.merges += tower.merges + 1
        target.invested += tower.invested
        target.relicStacks += tower.relicStacks
        target.relicPower += tower.relicPower
        this.selectedTowerId = target.id
        const position = this.gridToScreen(target)
        this.burst(position, towerStats(target.type).color, 30, 210)
        this.shockwaves.push({ ...position, radius: 7, maxRadius: 62, life: 0.58, color: towerStats(target.type).color })
        this.message = `${towerStats(target.type).name}s fused into level ${target.level}.`
      }
      this.emitState()
      return
    }
    const placement = this.placementStatus(targetCell)
    if (!placement.allowed) {
      this.message = placement.reason
      this.emitState()
      return
    }
    tower.col = targetCell.col
    tower.row = targetCell.row
    this.selectedTowerId = tower.id
    this.message = `${towerStats(tower.type).name} repositioned.`
    this.emitState()
  }

  private onClick = (event: MouseEvent) => {
    if (this.introStoryActive || this.openingCinematicActive) return
    this.noteActivity()
    if (this.suppressClick) {
      this.suppressClick = false
      return
    }
    if (import.meta.dev && this.debugGallery?.category === 'defense') {
      this.debugFireDefenseAt(event)
      return
    }
    if (this.phase === 'path') {
      const choice = this.pointerPathChoice(event)
      if (choice) this.extendPath(choice)
      return
    }
    const cell = this.pointerCell(event)
    if (!cell) return
    if (this.phase !== 'planning' || !this.revealed.has(cellKey(cell))) return
    const existing = this.towers.find(tower => tower.col === cell.col && tower.row === cell.row)
    if (existing) {
      const closeProfile = this.selectedTowerId === existing.id
      this.selectedTowerId = closeProfile ? null : existing.id
      this.placementMode = false
      this.message = closeProfile
        ? 'Building profile closed.'
        : `${towerStats(existing.type).name} selected. Inspect, combine, or dismantle it.`
      this.emitState()
      return
    }
    this.selectedTowerId = null
    const placement = this.placementStatus(cell)
    const stats = towerStats(this.selectedTower)
    const cost = this.towerCost(this.selectedTower)
    if (!placement.allowed) {
      this.message = placement.reason
    } else if (this.aether < cost) {
      const shortfall = cost - this.aether
      this.failedPlacement = {
        cell: { ...cell },
        type: this.selectedTower,
        shortfall,
        life: 1.15,
        maxLife: 1.15
      }
      this.floatingTexts = this.floatingTexts.filter(text => !text.text.includes('MORE AETHER'))
      const position = this.gridToScreen(cell)
      this.floatingTexts.push({
        x: position.x,
        y: position.y - 78,
        text: `NEED ${shortfall} MORE AETHER`,
        life: 1.35,
        maxLife: 1.35,
        color: '#fb7185',
        size: 15
      })
      this.burst({ x: position.x, y: position.y - 10 }, '#fb7185', 9, 95)
    } else {
      this.aether -= cost
      this.towerPurchases[this.selectedTower] = (this.towerPurchases[this.selectedTower] ?? 0) + 1
      this.towers.push({
        id: this.towerId++,
        ...cell,
        type: this.selectedTower,
        invested: cost,
        cooldown: 0,
        angle: 0,
        level: 1,
        merges: 0,
        recoil: 0,
        targeting: 'first',
        relicStacks: 0,
        relicPower: 0,
        relicShots: 0
      })
      const position = this.gridToScreen(cell)
      this.burst(position, stats.color, 18, 160)
      this.shockwaves.push({ ...position, radius: 5, maxRadius: 52, life: 0.55, color: stats.color })
      this.message = `${stats.name} raised on height ${this.elevations[cell.row]![cell.col]}.`
    }
    this.emitState()
  }

  private burst(position: Point, color: string, amount: number, speed: number) {
    for (let index = 0; index < amount; index++) {
      const angle = Math.random() * Math.PI * 2
      const velocity = speed * (0.25 + Math.random() * 0.75)
      this.particles.push({
        ...position,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - speed * 0.18,
        life: 0.35 + Math.random() * 0.55,
        maxLife: 0.9,
        size: 2 + Math.random() * 4,
        color,
        gravity: 160
      })
    }
  }

  private drawDebugGallery(category: PathwardenGalleryCategory, index: number) {
    const ctx = this.ctx
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT)
    sky.addColorStop(0, '#7d8ba8')
    sky.addColorStop(1, '#293852')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    const center = { x: WIDTH / 2, y: HEIGHT / 2 + 34 }
    const galleryRoadPoint = this.path[Math.min(3, this.path.length - 1)]!
    const idleActor = category === 'idle' ? this.debugIdleActor(index) : null
    const idleAnchor = idleActor ? this.debugIdleAnchor(idleActor) : null
    const sceneAnchor = category === 'scene' && index < 4
      ? { col: this.path[this.path.length - 1]!.col + 1, row: this.path[this.path.length - 1]!.row }
      : this.path[0]!
    const galleryAnchor = category === 'defense'
      ? { col: galleryRoadPoint.col, row: galleryRoadPoint.row + 2 }
      : category === 'scene'
        ? sceneAnchor
        : category === 'idle'
          ? idleAnchor ?? galleryRoadPoint
        : galleryRoadPoint
    const anchor = category === 'idle' && idleAnchor
      ? idleAnchor
      : this.gridToScreen(galleryAnchor as GridPoint)
    const scale = category === 'environment' ? 1.35 : category === 'scene' ? 1.7 : 2.4
    ctx.save()
    ctx.translate(center.x, center.y)
    ctx.scale(scale, scale)
    ctx.translate(-anchor.x, -anchor.y)

    if (category === 'defense' || category === 'idle') this.drawDebugGrasslandBoard(galleryRoadPoint)
    if (idleActor && ['patrol', 'peddler', 'bird'].includes(idleActor.kind)) this.drawRoad()

    if (category === 'defense') {
      const families: PathwardenDefenseFamily[] = ['star', 'sun', 'winter', 'ember', 'storm', 'dawn']
      const family = families[index % families.length]!
      const blueprint = PATHWARDEN_DEFENSE_BLUEPRINTS.find(defense =>
        defense.family === family && defense.tier === this.debugDefenseTier
      ) ?? PATHWARDEN_DEFENSE_BLUEPRINTS.find(defense => defense.family === family)!
      const point = { col: this.path[3]!.col, row: this.path[3]!.row + 2 }
      const angle = this.debugDefenseTarget ? this.debugDefenseAimAngle(point, this.debugDefenseTarget) : -Math.PI / 4
      const tower: Tower = {
        id: -1,
        ...point,
        type: blueprint.id,
        invested: 0,
        cooldown: 0,
        angle,
        level: 1,
        merges: 2,
        recoil: 0,
        targeting: 'first',
        relicStacks: 0,
        relicPower: 0,
        relicShots: 0
      }
      this.drawTower(tower, point)
      if (this.debugDefenseTarget) {
        const ctx = this.ctx
        ctx.save()
        ctx.strokeStyle = '#fef08a'
        ctx.fillStyle = 'rgba(250,204,21,.16)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(this.debugDefenseTarget.x, this.debugDefenseTarget.y, 13, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(this.debugDefenseTarget.x - 19, this.debugDefenseTarget.y)
        ctx.lineTo(this.debugDefenseTarget.x + 19, this.debugDefenseTarget.y)
        ctx.moveTo(this.debugDefenseTarget.x, this.debugDefenseTarget.y - 19)
        ctx.lineTo(this.debugDefenseTarget.x, this.debugDefenseTarget.y + 19)
        ctx.stroke()
        ctx.restore()
      }
      for (const enemy of this.enemies) this.drawEnemy(enemy)
      this.drawProjectiles()
    } else if (category === 'enemy') {
      const types: EnemyType[] = ['raider', 'runner', 'brute', 'shaman', 'boss']
      const enemyType = types[index % types.length]!
      const visuals = {
        raider: { radius: 13, color: '#fb923c' },
        runner: { radius: 10, color: '#c4b5fd' },
        brute: { radius: 18, color: '#fb7185' },
        shaman: { radius: 15, color: '#4ade80' },
        boss: { radius: 29, color: '#facc15' }
      }
      const visual = visuals[enemyType]
      this.drawEnemy({
        id: -1,
        type: enemyType,
        exitKey: 'debug',
        route: this.path,
        progress: Math.min(this.path.length - 1, 3),
        hp: 100,
        maxHp: 100,
        speed: 0,
        reward: 0,
        radius: visual.radius,
        slow: 0,
        slowTimer: 0,
        healTimer: 0,
        color: visual.color,
        hitFlash: 0,
        attackTimer: 0,
        dotDamage: 0,
        dotTimer: 0,
        dotTick: 0
      })
    } else if (category === 'idle') {
      if (idleActor?.kind === 'crew' && !this.towers.length) {
        const savedTowers = this.towers
        this.towers = [{
          id: -1,
          col: this.path[3]!.col,
          row: this.path[3]!.row + 2,
          type: 'bolt',
          recoil: 0,
          invested: 0,
          cooldown: 0,
          angle: -Math.PI / 4,
          level: 1,
          merges: 0,
          targeting: 'first',
          relicStacks: 0,
          relicPower: 0,
          relicShots: 0
        }]
        this.drawAmbientActor(idleActor)
        this.towers = savedTowers
      } else if (idleActor) {
        this.drawAmbientActor(idleActor)
      }
    } else if (category === 'environment') {
      this.drawEnvironmentGallery(index, galleryRoadPoint)
    } else {
      this.revealed.clear()
      this.revealAround(this.path)
      if (index === 4) this.drawKeep()
      else {
        const savedPath = this.path
        const savedBranchLinks = this.branchLinks
        this.path = [savedPath[0]!, savedPath[savedPath.length - 1]!]
        this.branchLinks = []
        this.revealed.clear()
        this.revealAround(this.path)
        this.drawDeadEndSites(index)
        this.path = savedPath
        this.branchLinks = savedBranchLinks
      }
    }
    ctx.restore()
    ctx.fillStyle = 'rgba(8,15,32,.76)'
    ctx.fillRect(24, HEIGHT - 58, WIDTH - 48, 34)
    ctx.fillStyle = '#f8fafc'
    ctx.font = '900 15px sans-serif'
    ctx.textAlign = 'center'
    const label = category === 'defense'
      ? `${category.toUpperCase()} · ${index + 1} · TIER ${this.debugDefenseTier}`
      : category === 'idle'
        ? `${category.toUpperCase()} · ${index + 1} · VARIATION ${this.debugIdleVariation + 1}`
      : `${category.toUpperCase()} · ${index + 1}`
    ctx.fillText(label, WIDTH / 2, HEIGHT - 36)
  }

  private drawDebugGrasslandBoard(center: GridPoint) {
    const tiles: GridPoint[] = []
    for (let row = -6; row <= 6; row++) {
      for (let col = -6; col <= 6; col++) tiles.push({ col: center.col + col, row: center.row + row })
    }
    const savedPath = this.path
    const savedBranchLinks = this.branchLinks
    const savedBranchRoads = this.branchRoads
    const savedPathChoices = this.pathChoices
    const savedRevealed = this.revealed
    this.path = [center]
    this.branchLinks = []
    this.branchRoads = []
    this.pathChoices = []
    this.revealed = new Set(tiles.map(cellKey))
    try {
      for (const tile of tiles) this.drawTile(tile, true, false)
      for (const tile of tiles) {
        if (this.hasDecoration(tile)) this.drawDecoration(tile)
      }
    } finally {
      this.path = savedPath
      this.branchLinks = savedBranchLinks
      this.branchRoads = savedBranchRoads
      this.pathChoices = savedPathChoices
      this.revealed = savedRevealed
    }
  }

  private drawDebugDefenseShot() {
    const shot = this.debugDefenseShot
    if (!shot) {
      if (this.debugDefenseTarget && performance.now() >= this.debugDefenseNextShotAt) this.debugStartDefenseShot(this.debugDefenseTarget)
      return
    }
    const progress = clamp((performance.now() - shot.startedAt) / 1000 / shot.duration, 0, 1)
    if (progress >= 1) {
      this.debugDefenseShot = null
      this.debugDefenseNextShotAt = performance.now() + towerStats(shot.type).rate * 1000
      return
    }
    const target = shot.targetPosition ?? shot
    shot.trail.unshift({ x: shot.x, y: shot.y })
    if (shot.trail.length > 7) shot.trail.pop()
    shot.age = progress * shot.duration
    shot.x = shot.origin.x + (target.x - shot.origin.x) * progress
    shot.y = shot.origin.y + (target.y - shot.origin.y) * progress
      - Math.sin(Math.PI * progress) * shot.arcHeight
    this.projectiles.push(shot)
    this.drawProjectiles()
    this.projectiles.pop()
  }

  private debugIdleActor(index: number): AmbientActor {
    const kinds: AmbientKind[] = ['market', 'picnic', 'hunt', 'musician', 'children', 'shepherd', 'patrol', 'peddler', 'crew', 'cat', 'bird']
    const kind = kinds[index % kinds.length]!
    const duration = kind === 'bird' ? 18 : 36
    return {
      id: -1,
      storyId: index + 1,
      blockKey: cellKey(this.path[3]!),
      kind,
      age: (performance.now() / 1000 + this.debugIdleVariation * 3.5) % duration,
      duration,
      seed: this.debugIdleVariation * 17 + 11,
      countsForProgress: false
    }
  }

  private debugIdleAnchor(actor: AmbientActor) {
    if (['market', 'picnic', 'hunt', 'musician', 'children', 'shepherd'].includes(actor.kind)) {
      return this.ambientMeadowPoint(actor.seed, 0, actor.blockKey)
    }
    if (['patrol', 'peddler', 'bird'].includes(actor.kind)) {
      const progress = actor.kind === 'peddler'
        ? 1 - actor.age / actor.duration
        : 1 - Math.abs((actor.age / actor.duration * 2) % 2 - 1)
      return this.ambientRoadPosition(progress)
    }
    if (actor.kind === 'cat') return this.ambientMeadowPoint(actor.seed, 0, actor.blockKey)
    return this.gridToScreen(this.path[3]!)
  }

  private drawEnvironmentGallery(index: number, center: GridPoint) {
    type EnvironmentVariant = 'grassland' | 'river' | 'lake' | 'canyon' | 'forest' | 'mountain' | 'junction' | 'mist'
    const variants: EnvironmentVariant[] = ['grassland', 'river', 'lake', 'canyon', 'forest', 'mountain', 'junction', 'mist']
    const variant = variants[index % variants.length]!
    const roadPath = Array.from({ length: 5 }, (_, offset) => ({ col: center.col - 2 + offset, row: center.row }))
    const branchLinks: RoadLink[] = variant === 'junction'
      ? [
          { from: center, to: { col: center.col, row: center.row - 2 } },
          { from: center, to: { col: center.col, row: center.row + 2 } }
        ]
      : []
    const roadLinks = [
      ...roadPath.slice(1).map((point, offset) => ({ from: roadPath[offset]!, to: point })),
      ...branchLinks
    ]
    const featureKind = variant === 'lake' ? 'lake' : variant === 'canyon' ? 'canyon' : variant === 'forest' ? 'forest' : variant === 'mountain' ? 'mountain' : null
    const featureCells = featureKind === 'lake'
      ? [
          { col: center.col - 1, row: center.row - 1 },
          { col: center.col, row: center.row - 1 },
          { col: center.col + 1, row: center.row - 1 },
          { col: center.col - 1, row: center.row },
          { col: center.col + 1, row: center.row }
        ]
      : featureKind
          ? [{ col: center.col, row: center.row - 1 }, { col: center.col + 1, row: center.row - 1 }]
          : []
    const features: PathwardenMapPlan['features'] = featureKind
      ? [{ id: `debug-${variant}`, kind: featureKind, roomIds: [], cells: featureCells, ports: [] }]
      : []
    if (variant === 'river') {
      const bridgeCells = [center, { col: center.col + 1, row: center.row }]
      const riverCells: GridPoint[] = []
      for (let col = center.col; col <= center.col + 1; col++) {
        for (let row = center.row - 2; row <= center.row + 1; row++) riverCells.push({ col, row })
      }
      features.push(
        {
          id: 'debug-river',
          kind: 'river',
          roomIds: [],
          cells: riverCells,
          ports: []
        },
        { id: 'debug-bridge', kind: 'bridge', roomIds: [], cells: bridgeCells, ports: [] }
      )
    }
    const tiles: GridPoint[] = []
    for (let row = -3; row <= 3; row++) {
      for (let col = -3; col <= 3; col++) tiles.push({ col: center.col + col, row: center.row + row })
    }
    const savedPath = this.path
    const savedBranchLinks = this.branchLinks
    const savedBranchRoads = this.branchRoads
    const savedPathChoices = this.pathChoices
    const savedRoadLinks = this.mapPlan.roadLinks
    const savedFeatures = this.mapPlan.features
    const savedRevealed = this.revealed
    this.path = roadPath
    this.branchLinks = branchLinks
    this.branchRoads = []
    this.pathChoices = []
    this.mapPlan.roadLinks = roadLinks as unknown as PathwardenMapPlan['roadLinks']
    this.mapPlan.features = features
    this.revealed = new Set(tiles.map(cellKey))
    try {
      const roadKeys = new Set(this.allRoadCells().map(cellKey))
      for (const tile of tiles) this.drawTile(tile, true, roadKeys.has(cellKey(tile)))
      this.drawGroundFeatures()
      this.drawRoad()
      this.drawBridgeDetails()
      for (const feature of features.filter(candidate => ['mountain', 'forest'].includes(candidate.kind))) {
        for (const point of feature.cells) this.drawRaisedFeature(point, feature.kind)
      }
      const decorationRoadKeys = new Set(this.allRoadCells().map(cellKey))
      for (const tile of tiles) {
        if (!decorationRoadKeys.has(cellKey(tile)) && this.hasDecoration(tile)) this.drawDecoration(tile)
      }
      if (variant === 'mist') {
        this.drawUndiscoveredMistField()
      }
    } finally {
      this.path = savedPath
      this.branchLinks = savedBranchLinks
      this.branchRoads = savedBranchRoads
      this.pathChoices = savedPathChoices
      this.mapPlan.roadLinks = savedRoadLinks
      this.mapPlan.features = savedFeatures
      this.revealed = savedRevealed
    }
  }

  private render() {
    if (import.meta.dev && this.debugGallery) {
      this.drawDebugGallery(this.debugGallery.category, this.debugGallery.index)
      return
    }
    const ctx = this.ctx
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT)
    sky.addColorStop(0, '#7d8ba8')
    sky.addColorStop(0.58, '#647590')
    sky.addColorStop(1, '#52647e')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    this.drawBackdrop()

    ctx.save()
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake)
    ctx.translate(WORLD_VIEW_CENTER.x, WORLD_VIEW_CENTER.y)
    ctx.scale(this.zoom, this.zoom)
    ctx.translate(-WORLD_VIEW_CENTER.x - this.camera.x, -WORLD_VIEW_CENTER.y - this.camera.y)
    this.drawBoard()
    this.drawProjectiles()
    this.drawEffects()
    if (import.meta.dev && this.debugVisuals) this.drawVisualGuides()
    ctx.restore()

    this.drawMinimap()
    if (this.introStoryActive) this.drawIntroKingdomScene()
    if (this.activeRunSceneTime > 0) this.drawActiveRunScene()
    if (this.openingCinematicActive) this.drawOpeningCinematic()
    if (this.redFlash > 0) {
      ctx.fillStyle = `rgba(244,63,94,${this.redFlash * 0.28})`
      ctx.fillRect(0, 0, WIDTH, HEIGHT)
    }
    if (this.waveBanner > 0) this.drawWaveBanner()
    if (this.pendingWaveStart) this.drawEvacuationBanner()
    if (this.phase === 'defeat') this.drawDefeatScene()
    if (this.paused) this.drawPauseOverlay()
  }

  private drawIntroKingdomScene() {
    const ctx = this.ctx
    const sway = Math.sin(this.introStoryTime * 2.1) * 3
    const right = WIDTH * 0.72

    ctx.save()
    ctx.fillStyle = '#091523'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    ctx.fillStyle = 'rgba(12, 24, 35, .94)'
    ctx.fillRect(WIDTH * 0.51, 22, WIDTH * 0.43, HEIGHT - 44)

    const drawField = (x: number, y: number, width: number, height: number, rotation: number) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rotation)
      ctx.fillStyle = '#6f8f55'
      ctx.strokeStyle = '#8f7949'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.roundRect(-width / 2, -height / 2, width, height, 16)
      ctx.fill()
      ctx.stroke()
      ctx.strokeStyle = 'rgba(224, 201, 120, .62)'
      ctx.lineWidth = 2
      for (let row = -height / 2 + 15; row < height / 2; row += 16) {
        ctx.beginPath()
        ctx.moveTo(-width / 2 + 12, row)
        ctx.lineTo(width / 2 - 12, row)
        ctx.stroke()
      }
      ctx.restore()
    }

    const drawSeeder = (x: number, y: number, color: string) => {
      ctx.save()
      ctx.translate(x, y + Math.sin(this.introStoryTime * 3.2) * 2)
      ctx.fillStyle = '#e9c39b'
      ctx.beginPath()
      ctx.arc(0, -25, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(-8, -19, 16, 22, 5)
      ctx.fill()
      ctx.strokeStyle = '#3b2b28'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(-3, 3)
      ctx.lineTo(-7, 14)
      ctx.moveTo(3, 3)
      ctx.lineTo(8, 14)
      ctx.moveTo(5, -9)
      ctx.lineTo(25, 8)
      ctx.stroke()
      ctx.fillStyle = '#e8c66b'
      for (let index = 0; index < 4; index++) {
        const seedX = 20 + index * 9 + Math.sin(this.introStoryTime * 4 + index) * 3
        const seedY = 12 + (index % 2) * 7
        ctx.beginPath()
        ctx.arc(seedX, seedY, 2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }

    const drawCow = (x: number, y: number, facing: 1 | -1) => {
      ctx.save()
      ctx.translate(x, y + Math.sin(this.introStoryTime * 1.7 + x) * 2)
      ctx.scale(facing, 1)
      ctx.fillStyle = '#eadfc5'
      ctx.beginPath()
      ctx.ellipse(0, 0, 24, 13, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#6f5948'
      ctx.beginPath()
      ctx.arc(22, 1, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#302426'
      ctx.beginPath()
      ctx.arc(-8, -4, 5, 0, Math.PI * 2)
      ctx.arc(8, 4, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#4b3a31'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(-13, 9)
      ctx.lineTo(-15, 20)
      ctx.moveTo(12, 9)
      ctx.lineTo(14, 20)
      ctx.moveTo(25, -5)
      ctx.lineTo(31, -12)
      ctx.stroke()
      ctx.fillStyle = '#6f8f55'
      ctx.beginPath()
      ctx.moveTo(30, 3)
      ctx.lineTo(46, 8)
      ctx.lineTo(30, 11)
      ctx.fill()
      ctx.restore()
    }

    const drawHarvestedPatch = (x: number, y: number, width: number, height: number, rotation: number) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rotation)
      ctx.beginPath()
      ctx.roundRect(-width / 2, -height / 2, width, height, 16)
      ctx.clip()
      ctx.fillStyle = '#9a7142'
      ctx.fillRect(-width / 2, -height / 2, width * 0.48, height)
      ctx.strokeStyle = 'rgba(239, 194, 94, .8)'
      ctx.lineWidth = 2
      for (let index = 0; index < 12; index++) {
        const stubbleX = -width / 2 + 18 + (index % 6) * 15
        const stubbleY = -height / 2 + 18 + Math.floor(index / 6) * 22
        ctx.beginPath()
        ctx.moveTo(stubbleX, stubbleY + 7)
        ctx.lineTo(stubbleX + 3, stubbleY)
        ctx.stroke()
      }
      ctx.restore()
    }

    const drawScytheFarmer = (x: number, y: number) => {
      ctx.save()
      const swing = Math.sin(this.introStoryTime * 3.5) * 0.35
      ctx.translate(x, y)
      ctx.fillStyle = '#e9c39b'
      ctx.beginPath()
      ctx.arc(0, -26, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#d8a447'
      ctx.beginPath()
      ctx.roundRect(-8, -20, 16, 23, 5)
      ctx.fill()
      ctx.strokeStyle = '#3b2b28'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(-3, 3)
      ctx.lineTo(-7, 15)
      ctx.moveTo(3, 3)
      ctx.lineTo(8, 15)
      ctx.stroke()
      ctx.save()
      ctx.translate(7, -9)
      ctx.rotate(swing)
      ctx.strokeStyle = '#704d2f'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(34, 20)
      ctx.stroke()
      ctx.strokeStyle = '#d7d0aa'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(36, 16, 19, 0.15, 1.25)
      ctx.stroke()
      ctx.restore()
      ctx.restore()
    }

    const drawGuard = (x: number, y: number, offset: number) => {
      ctx.save()
      ctx.translate(x, y + Math.sin(this.introStoryTime * 10 + offset) * 2)
      ctx.fillStyle = '#e9c39b'
      ctx.beginPath()
      ctx.arc(0, -20, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#395b73'
      ctx.fillRect(-7, -14, 14, 20)
      ctx.strokeStyle = '#263746'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(-3, 6)
      ctx.lineTo(-6, 16)
      ctx.moveTo(3, 6)
      ctx.lineTo(7, 16)
      ctx.stroke()
      ctx.strokeStyle = '#c3a05f'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(8, 4)
      ctx.lineTo(8, -43)
      ctx.stroke()
      ctx.fillStyle = '#d8b45b'
      ctx.beginPath()
      ctx.moveTo(8, -43)
      ctx.lineTo(22, -37)
      ctx.lineTo(8, -31)
      ctx.fill()
      ctx.restore()
    }

    const drawGranary = (x: number, y: number) => {
      ctx.save()
      ctx.fillStyle = '#9d7247'
      ctx.fillRect(x - 34, y - 58, 68, 68)
      ctx.fillStyle = '#c39a5b'
      ctx.beginPath()
      ctx.moveTo(x - 44, y - 58)
      ctx.lineTo(x, y - 91)
      ctx.lineTo(x + 44, y - 58)
      ctx.fill()
      ctx.fillStyle = '#4a342b'
      ctx.fillRect(x - 10, y - 30, 20, 40)
      ctx.fillStyle = '#e1ba68'
      ctx.fillRect(x - 25, y - 47, 14, 13)
      ctx.fillRect(x + 11, y - 47, 14, 13)
      ctx.restore()
    }

    const drawPriest = (x: number, y: number, offset: number) => {
      ctx.save()
      ctx.translate(x, y + Math.sin(this.introStoryTime * 12 + offset) * 2)
      ctx.fillStyle = '#e9c39b'
      ctx.beginPath()
      ctx.arc(0, -30, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#f4f1df'
      ctx.beginPath()
      ctx.moveTo(-13, 5)
      ctx.lineTo(-8, -23)
      ctx.lineTo(8, -23)
      ctx.lineTo(13, 5)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#b7ad91'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(-7, 4)
      ctx.lineTo(-13, 17)
      ctx.moveTo(7, 4)
      ctx.lineTo(13, 17)
      ctx.stroke()
      ctx.strokeStyle = '#8b7046'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(8, -17)
      ctx.lineTo(8, -49)
      ctx.moveTo(3, -44)
      ctx.lineTo(13, -44)
      ctx.stroke()
      ctx.restore()
    }

    const drawJeerer = (x: number, y: number, color: string, offset: number) => {
      ctx.save()
      ctx.translate(x, y + Math.sin(this.introStoryTime * 4 + offset) * 2)
      ctx.fillStyle = '#e9c39b'
      ctx.beginPath()
      ctx.arc(0, -22, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(-11, 17)
      ctx.lineTo(-8, -16)
      ctx.lineTo(8, -16)
      ctx.lineTo(13, 17)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#e7bd45'
      ctx.fillRect(-8, -16, 16, 5)
      ctx.fillStyle = '#f4f1df'
      ctx.fillRect(-4, -11, 8, 8)
      ctx.strokeStyle = '#3b2b28'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(-6, -5)
      ctx.lineTo(-23, -23)
      ctx.moveTo(6, -5)
      ctx.lineTo(23, -23)
      ctx.moveTo(-4, 17)
      ctx.lineTo(-8, 28)
      ctx.moveTo(4, 17)
      ctx.lineTo(9, 28)
      ctx.stroke()
      ctx.fillStyle = '#fff8df'
      ctx.beginPath()
      ctx.roundRect(-25, -65, 50, 23, 7)
      ctx.fill()
      ctx.fillStyle = '#8d3e3e'
      ctx.font = '900 12px Georgia, serif'
      ctx.textAlign = 'center'
      ctx.fillText('BOO!', 0, -49)
      ctx.restore()
    }

    const drawTreasureChest = (x: number, y: number) => {
      ctx.save()
      ctx.fillStyle = '#704326'
      ctx.fillRect(x - 45, y - 28, 90, 40)
      ctx.strokeStyle = '#c58b2f'
      ctx.lineWidth = 4
      ctx.strokeRect(x - 45, y - 28, 90, 40)
      ctx.fillStyle = '#f4c84e'
      ctx.beginPath()
      ctx.moveTo(x - 42, y - 28)
      ctx.lineTo(x - 34, y - 70)
      ctx.lineTo(x + 45, y - 57)
      ctx.lineTo(x + 45, y - 28)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#f8d66b'
      for (let index = 0; index < 5; index++) {
        ctx.beginPath()
        ctx.arc(x - 24 + index * 13, y - 42 - (index % 2) * 6, 6, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = '#e6b83e'
      ctx.fillRect(x - 4, y - 17, 8, 13)
      ctx.restore()
    }

    const drawCrownedRuler = (x: number, y: number) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(-0.12)
      ctx.fillStyle = '#e9c39b'
      ctx.beginPath()
      ctx.arc(-3, -48, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#9b4b43'
      ctx.fillRect(-13, -40, 22, 31)
      ctx.fillStyle = '#e7bd45'
      ctx.beginPath()
      ctx.moveTo(-16, -53)
      ctx.lineTo(-11, -70)
      ctx.lineTo(-3, -58)
      ctx.lineTo(6, -70)
      ctx.lineTo(12, -51)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#3b2b28'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(-7, -28)
      ctx.lineTo(-34, -57)
      ctx.moveTo(7, -29)
      ctx.lineTo(-1, -3)
      ctx.stroke()
      ctx.strokeStyle = '#3b2b28'
      ctx.beginPath()
      ctx.moveTo(-7, -9)
      ctx.lineTo(-14, 7)
      ctx.moveTo(7, -9)
      ctx.lineTo(12, 7)
      ctx.stroke()
      const coinCycle = (this.introStoryTime % 1.8) / 1.8
      const coinY = -78 - coinCycle * 34
      ctx.fillStyle = '#f4c84e'
      ctx.globalAlpha = 1 - coinCycle
      ctx.beginPath()
      ctx.arc(23, coinY, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#f4c84e'
      ctx.font = '900 14px Georgia, serif'
      ctx.textAlign = 'left'
      ctx.fillText('+1', 38, coinY + 5)
      ctx.restore()
    }

    const drawStandingKing = (x: number, y: number) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.fillStyle = '#e9c39b'
      ctx.beginPath()
      ctx.arc(0, -46, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#e7bd45'
      ctx.beginPath()
      ctx.moveTo(-15, -51)
      ctx.lineTo(-9, -68)
      ctx.lineTo(0, -57)
      ctx.lineTo(9, -68)
      ctx.lineTo(15, -51)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#9b4b43'
      ctx.fillRect(-12, -38, 24, 34)
      ctx.strokeStyle = '#3b2b28'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(-7, -4)
      ctx.lineTo(-12, 12)
      ctx.moveTo(7, -4)
      ctx.lineTo(12, 12)
      ctx.moveTo(-9, -28)
      ctx.lineTo(-25, -11)
      ctx.moveTo(9, -28)
      ctx.lineTo(25, -15)
      ctx.stroke()
      ctx.restore()
    }

    const drawBuilder = (x: number, y: number, offset: number) => {
      ctx.save()
      ctx.translate(x, y)
      const hammer = Math.sin(this.introStoryTime * 7 + offset) * 0.35
      ctx.fillStyle = '#e9c39b'
      ctx.beginPath()
      ctx.arc(0, -25, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#496b70'
      ctx.fillRect(-7, -19, 14, 22)
      ctx.strokeStyle = '#3b2b28'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(-3, 3)
      ctx.lineTo(-7, 14)
      ctx.moveTo(3, 3)
      ctx.lineTo(7, 14)
      ctx.stroke()
      ctx.save()
      ctx.translate(6, -10)
      ctx.rotate(hammer)
      ctx.strokeStyle = '#704d2f'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(18, -22)
      ctx.stroke()
      ctx.fillStyle = '#9a9da0'
      ctx.fillRect(13, -28, 13, 8)
      ctx.restore()
      ctx.restore()
    }

    const drawPleasureWorker = (x: number, y: number, color: string, offset: number) => {
      ctx.save()
      const bending = x > right + 55 && x < right + 145
      ctx.translate(x, y + Math.sin(this.introStoryTime * 5 + offset) * 2)
      if (bending) ctx.rotate(0.32)
      ctx.fillStyle = '#e9c39b'
      ctx.beginPath()
      ctx.arc(0, -30, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#382b3f'
      ctx.beginPath()
      ctx.arc(-1, -34, 10, Math.PI, Math.PI * 2)
      ctx.arc(-8, -28, 5, 0.5, Math.PI * 1.5)
      ctx.fill()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(-9, 7)
      ctx.lineTo(-7, -22)
      ctx.lineTo(7, -22)
      ctx.lineTo(11, 7)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(104, 54, 72, .68)'
      ctx.beginPath()
      ctx.moveTo(-6, -16)
      ctx.lineTo(-1, -9)
      ctx.lineTo(-9, -9)
      ctx.moveTo(2, -9)
      ctx.lineTo(7, -16)
      ctx.lineTo(10, -9)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#3b2b28'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(-3, 6)
      ctx.lineTo(-6, 18)
      ctx.moveTo(3, 6)
      ctx.lineTo(7, 18)
      ctx.moveTo(-6, -10)
      ctx.lineTo(-19, -1)
      ctx.moveTo(6, -10)
      ctx.lineTo(19, -1)
      ctx.stroke()
      ctx.restore()
    }

    const drawKiss = (x: number, y: number, progress: number) => {
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - progress)
      ctx.fillStyle = '#f38ba8'
      ctx.font = '900 18px Georgia, serif'
      ctx.textAlign = 'center'
      ctx.fillText('♡', x, y - progress * 48)
      ctx.restore()
    }

    const drawStoryRoad = () => {
      ctx.save()
      ctx.strokeStyle = '#3b302b'
      ctx.lineWidth = 22
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(right, 338)
      ctx.lineTo(right, 540)
      ctx.moveTo(right - 190, 452)
      ctx.lineTo(right + 190, 452)
      ctx.stroke()
      ctx.strokeStyle = '#9b774d'
      ctx.lineWidth = 14
      ctx.beginPath()
      ctx.moveTo(right, 338)
      ctx.lineTo(right, 540)
      ctx.moveTo(right - 190, 452)
      ctx.lineTo(right + 190, 452)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(226, 194, 122, .42)'
      ctx.lineWidth = 2
      for (let y = 360; y < 535; y += 24) {
        ctx.beginPath()
        ctx.moveTo(right - 5, y)
        ctx.lineTo(right + 5, y + 8)
        ctx.stroke()
      }
      ctx.restore()
    }

    if (this.introStoryIndex === 0) {
      drawStoryRoad()
      drawField(right - 135, 405, 120, 78, -0.12)
      drawField(right + 135, 405, 120, 78, 0.12)
      drawField(right - 135, 500, 120, 78, -0.12)
      drawField(right + 135, 500, 120, 78, 0.12)
      this.drawStoryCastle(right, 330, '#8a6746', 0.76)
      drawSeeder(right - 135, 412, '#d8a447')
      drawSeeder(right - 135, 507, '#c7774e')
      drawCow(right + 135, 405, -1)
      drawCow(right + 135, 500, 1)
    } else if (this.introStoryIndex === 1) {
      drawStoryRoad()
      drawField(right - 118, 380, 200, 90, -0.1)
      drawHarvestedPatch(right - 118, 380, 200, 90, -0.1)
      this.drawStoryTemple(right, 272, false)
      drawGranary(right + 112, 405)
      drawScytheFarmer(right - 118, 414)
      const march = (this.introStoryTime * 34) % 250
      drawGuard(right - 175 + march, 466, 0)
      drawGuard(right - 95 + march, 466, 1.8)
    } else if (this.introStoryIndex === 2) {
      this.drawStoryTemple(right, 285, true)
      ctx.fillStyle = 'rgba(64, 42, 36, .7)'
      ctx.fillRect(right - 116, 398, 232, 35)
      const chase = (this.introStoryTime * 38) % 230
      const courtChase = Math.min(chase * 0.7, 135)
      drawPriest(right - 15 - chase, 375, 0)
      drawPriest(right + 30 - chase, 390, 1.5)
      drawJeerer(right + 45 - courtChase, 398, '#7b3f59', 0)
      drawJeerer(right + 105 - courtChase, 398, '#315c78', 1.2)
      drawCrownedRuler(right + 140, 414)
      drawTreasureChest(right + 105, 448)
      ctx.fillStyle = '#76512f'
      ctx.fillRect(right - 4, 220, 8, 120)
      ctx.fillStyle = '#bd4d52'
      ctx.beginPath()
      ctx.moveTo(right + 4, 222)
      ctx.lineTo(right + 46, 234)
      ctx.lineTo(right + 4, 247)
      ctx.fill()
    } else {
      this.drawStoryTemple(right, 294, true)
      ctx.fillStyle = '#a9a28d'
      for (const pillarX of [right - 92, right - 48, right + 48, right + 92]) {
        ctx.fillRect(pillarX - 8, 190, 16, 150)
        ctx.fillStyle = '#d5c9a4'
        ctx.fillRect(pillarX - 13, 184, 26, 10)
        ctx.fillRect(pillarX - 13, 338, 26, 10)
        ctx.fillStyle = '#a9a28d'
      }
      ctx.fillStyle = '#b9b09a'
      ctx.beginPath()
      ctx.arc(right, 135, 13, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#c9c0aa'
      ctx.beginPath()
      ctx.moveTo(right - 20, 153)
      ctx.lineTo(right, 126)
      ctx.lineTo(right + 20, 153)
      ctx.lineTo(right + 13, 187)
      ctx.lineTo(right - 13, 187)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#7b5b3b'
      ctx.fillRect(right - 24, 390, 48, 22)
      ctx.fillStyle = '#f0c95d'
      ctx.beginPath()
      ctx.arc(right, 386, 10, 0, Math.PI * 2)
      ctx.fill()
      drawBuilder(right - 112, 390, 0)
      drawBuilder(right - 62, 372, 1.3)
      drawBuilder(right + 67, 374, 2.6)
      drawStandingKing(right + 125, 520)
      const attendantSpeed = 48
      const attendantOffsets = [0, 72, 144, 216, 288]
      const attendantColors = ['#bf6f83', '#8c5b76', '#c28c55', '#a8626b', '#6c668f']
      for (const [index, offset] of attendantOffsets.entries()) {
        const pass = (this.introStoryTime * attendantSpeed + offset) % 360
        const x = right - 205 + pass
        const y = 500 + (index % 2) * 18
        drawPleasureWorker(x, y, attendantColors[index]!, index * 1.1)
        if (pass > 242 && pass < 292) {
          drawKiss(right + 98, 475, (pass - 242) / 50)
        }
      }
      ctx.fillStyle = 'rgba(31, 41, 55, .72)'
      ctx.beginPath()
      ctx.arc(right - 114, 108, 48 + sway, 0, Math.PI * 2)
      ctx.arc(right - 40, 92, 58 - sway, 0, Math.PI * 2)
      ctx.arc(right + 46, 108, 50 + sway, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#d2a24c'
      ctx.font = '900 18px Georgia, serif'
      ctx.fillText('THE KING HAS SPOKEN', right, 555)
    }
    ctx.restore()
  }

  private drawStoryCastle(centerX: number, baseY: number, color: string, scale = 1) {
    const ctx = this.ctx
    ctx.save()
    ctx.translate(centerX, baseY)
    ctx.scale(scale, scale)
    ctx.translate(-centerX, -baseY)
    ctx.fillStyle = color
    ctx.fillRect(centerX - 90, baseY - 70, 180, 96)
    ctx.fillRect(centerX - 122, baseY - 124, 48, 150)
    ctx.fillRect(centerX + 74, baseY - 124, 48, 150)
    ctx.beginPath()
    ctx.moveTo(centerX - 136, baseY - 124)
    ctx.lineTo(centerX - 98, baseY - 170)
    ctx.lineTo(centerX - 60, baseY - 124)
    ctx.moveTo(centerX + 60, baseY - 124)
    ctx.lineTo(centerX + 98, baseY - 170)
    ctx.lineTo(centerX + 136, baseY - 124)
    ctx.fill()
    ctx.fillStyle = '#302426'
    ctx.fillRect(centerX - 20, baseY - 7, 40, 33)
    ctx.fillStyle = '#d8b45b'
    ctx.fillRect(centerX - 4, baseY - 202, 8, 38)
    ctx.restore()
  }

  private drawStoryTemple(centerX: number, baseY: number, damaged: boolean) {
    const ctx = this.ctx
    ctx.fillStyle = damaged ? '#756049' : '#a47f50'
    ctx.fillRect(centerX - 92, baseY - 76, 184, 104)
    ctx.fillStyle = damaged ? '#5a483d' : '#c39b5d'
    ctx.fillRect(centerX - 112, baseY - 108, 224, 20)
    ctx.beginPath()
    ctx.moveTo(centerX - 125, baseY - 108)
    ctx.lineTo(centerX, baseY - 182)
    ctx.lineTo(centerX + 125, baseY - 108)
    ctx.fill()
    ctx.fillStyle = '#34272b'
    ctx.fillRect(centerX - 22, baseY - 40, 44, 68)
    ctx.fillStyle = damaged ? '#5e463a' : '#e9c46a'
    ctx.fillRect(centerX - 62, baseY - 70, 25, 35)
    ctx.fillRect(centerX + 37, baseY - 70, 25, 35)
    if (!damaged) {
      ctx.fillStyle = '#ed8b3d'
      ctx.beginPath()
      ctx.arc(centerX, baseY - 155 + Math.sin(this.introStoryTime * 8) * 4, 12, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  private drawActiveRunScene() {
    const ctx = this.ctx
    const progress = clamp(this.activeRunSceneTime / this.activeRunSceneDuration, 0, 1)
    const opacity = Math.min(0.86, progress * 1.8)
    const centerX = WIDTH * 0.52
    const centerY = HEIGHT * 0.56
    const pulse = Math.sin((this.activeRunSceneDuration - this.activeRunSceneTime) * 7) * 4

    ctx.save()
    ctx.fillStyle = `rgba(19, 13, 28, ${opacity * 0.38})`
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    ctx.fillStyle = `rgba(37, 20, 57, ${opacity * 0.62})`
    ctx.beginPath()
    ctx.arc(centerX, 116, 106 + pulse, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = `rgba(126, 63, 177, ${opacity * 0.72})`
    ctx.beginPath()
    ctx.moveTo(centerX - 54, 140)
    ctx.lineTo(centerX, 238)
    ctx.lineTo(centerX + 54, 140)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = `rgba(88, 61, 51, ${opacity * 0.95})`
    ctx.fillRect(centerX - 122, centerY - 38, 244, 130)
    ctx.fillStyle = `rgba(124, 77, 59, ${opacity})`
    ctx.fillRect(centerX - 164, centerY - 92, 64, 184)
    ctx.fillRect(centerX + 100, centerY - 92, 64, 184)
    ctx.fillStyle = `rgba(31, 23, 31, ${opacity})`
    ctx.fillRect(centerX - 24, centerY + 14, 48, 78)
    ctx.fillStyle = `rgba(201, 169, 80, ${opacity})`
    ctx.fillRect(centerX - 3, centerY - 144, 6, 38)

    const drawFigure = (x: number, y: number, color: string, crouched = false) => {
      ctx.fillStyle = `rgba(232, 191, 145, ${opacity})`
      ctx.beginPath()
      ctx.arc(x, y - (crouched ? 8 : 16), 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(x - 8, y - (crouched ? 4 : 10), 16, crouched ? 13 : 24, 5)
      ctx.fill()
      ctx.strokeStyle = `rgba(27, 24, 35, ${opacity})`
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(x - 3, y + 9)
      ctx.lineTo(x - 10, y + (crouched ? 13 : 24))
      ctx.moveTo(x + 3, y + 9)
      ctx.lineTo(x + 10, y + (crouched ? 13 : 24))
      ctx.stroke()
    }

    drawFigure(centerX - 215, centerY + 96, '#9e704f', true)
    drawFigure(centerX - 178, centerY + 110, '#c48855', true)
    drawFigure(centerX + 184, centerY + 108, '#9e704f', true)
    drawFigure(centerX + 222, centerY + 96, '#c48855', true)
    drawFigure(centerX - 82, centerY + 58, '#41657e')
    drawFigure(centerX + 82, centerY + 58, '#41657e')
    ctx.strokeStyle = `rgba(232, 196, 102, ${opacity})`
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(centerX - 88, centerY + 48)
    ctx.lineTo(centerX - 122, centerY + 8)
    ctx.moveTo(centerX + 88, centerY + 48)
    ctx.lineTo(centerX + 122, centerY + 8)
    ctx.stroke()

    ctx.fillStyle = `rgba(245, 220, 255, ${opacity})`
    ctx.font = '900 18px Cinzel, Georgia, serif'
    ctx.textAlign = 'center'
    ctx.fillText('THE KEEP HOLDS', centerX, HEIGHT - 48)
    ctx.restore()
  }

  private drawOpeningCinematic() {
    const ctx = this.ctx
    const time = this.openingCinematicTime
    const castle = { x: WIDTH * 0.72, y: HEIGHT * 0.57 }
    const gate = { x: castle.x, y: castle.y + 58 }
    const descent = clamp((time - 0.65) / 1.8, 0, 1)
    const curse = clamp((time - 1.85) / 2.2, 0, 1)
    const departure = clamp((time - 4.1) / 1.7, 0, 1)
    const fogClosing = clamp((time - 2.2) / 2.8, 0, 1)
    const reveal = clamp((time - 6.7) / 2.1, 0, 1)
    const fogOpacity = reveal > 0 ? 0.94 * (1 - reveal) : 0.1 + fogClosing * 0.84

    ctx.save()
    ctx.fillStyle = '#091523'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    ctx.fillStyle = '#e8d29b'
    ctx.font = '900 13px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.fillText('THE TEMPLE IS BROKEN', WIDTH * 0.72, 72)
    this.drawStoryCastle(castle.x, castle.y + 28, '#765843')
    ctx.fillStyle = `rgba(8, 15, 32, ${fogOpacity})`
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    const clearRadius = Math.max(0, 190 * (1 - fogClosing))
    if (clearRadius > 0) {
      ctx.globalCompositeOperation = 'destination-out'
      const clear = ctx.createRadialGradient(castle.x, castle.y - 26, 0, castle.x, castle.y - 26, clearRadius)
      clear.addColorStop(0, 'rgba(0,0,0,.9)')
      clear.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = clear
      ctx.beginPath()
      ctx.arc(castle.x, castle.y - 26, clearRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    }
    this.drawCinematicVillagers(gate, curse)
    this.drawCinematicGod(descent, departure, curse)
    if (fogClosing > 0.15 && reveal < 0.9) {
      ctx.globalAlpha = clamp(fogClosing * 1.25, 0, 1)
      for (let index = 0; index < 14; index++) {
        const angle = index * Math.PI * 2 / 14 + time * 0.08
        const radius = 120 + (index % 4) * 76
        const x = castle.x + Math.cos(angle) * radius
        const y = castle.y + Math.sin(angle) * radius * 0.58
        const mist = ctx.createRadialGradient(x, y, 4, x, y, 130 + (index % 3) * 30)
        mist.addColorStop(0, 'rgba(157, 174, 204, .48)')
        mist.addColorStop(0.55, 'rgba(118, 139, 174, .18)')
        mist.addColorStop(1, 'rgba(87, 106, 140, 0)')
        ctx.fillStyle = mist
        ctx.beginPath()
        ctx.arc(x, y, 150, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  private drawCinematicVillagers(gate: Point, curse: number) {
    const ctx = this.ctx
    const origins = [
      { x: gate.x - 230, y: gate.y + 70 },
      { x: gate.x + 190, y: gate.y + 50 },
      { x: gate.x - 150, y: gate.y - 55 },
      { x: gate.x + 250, y: gate.y - 25 },
      { x: gate.x + 20, y: gate.y + 125 }
    ]
    const flee = clamp((this.openingCinematicTime - 2.0) / 2.5, 0, 1)
    for (const [index, origin] of origins.entries()) {
      const travel = clamp((flee - index * 0.08) / (1 - index * 0.08), 0, 1)
      const ease = travel * travel * (3 - 2 * travel)
      const x = origin.x + (gate.x - origin.x) * ease
      const y = origin.y + (gate.y - origin.y) * ease
      ctx.save()
      ctx.globalAlpha = clamp(1 - (curse - 0.7) * 2.2, 0.2, 1)
      ctx.translate(x, y)
      ctx.fillStyle = index % 2 ? '#f59e0b' : '#60a5fa'
      ctx.fillRect(-6, -15, 12, 16)
      ctx.fillStyle = '#e7c39b'
      ctx.beginPath()
      ctx.arc(0, -21, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#172033'
      ctx.lineWidth = 2
      const stride = Math.sin(this.openingCinematicTime * 15 + index) * 4
      ctx.beginPath()
      ctx.moveTo(-3, 1)
      ctx.lineTo(-5 + stride, 9)
      ctx.moveTo(3, 1)
      ctx.lineTo(5 - stride, 9)
      ctx.stroke()
      ctx.restore()
    }
    ctx.save()
    ctx.globalAlpha = clamp((flee - 0.65) * 2, 0, 1)
    const fog = ctx.createRadialGradient(gate.x, gate.y - 12, 8, gate.x, gate.y - 12, 92)
    fog.addColorStop(0, 'rgba(200, 215, 235, .82)')
    fog.addColorStop(1, 'rgba(120, 145, 180, 0)')
    ctx.fillStyle = fog
    ctx.beginPath()
    ctx.arc(gate.x, gate.y - 12, 92, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawCinematicGod(descent: number, departure: number, curse: number) {
    const ctx = this.ctx
    const x = WIDTH * 0.72 + Math.sin(this.openingCinematicTime * 0.9) * 52
    const y = -100 + descent * 285 - departure * 330
    ctx.save()
    ctx.globalAlpha = clamp(1 - departure, 0, 1)
    ctx.translate(x, y)
    ctx.fillStyle = 'rgba(226, 232, 240, .95)'
    ctx.beginPath()
    ctx.ellipse(0, 30, 94, 25, 0, 0, Math.PI * 2)
    ctx.ellipse(-55, 34, 48, 18, 0, 0, Math.PI * 2)
    ctx.ellipse(57, 34, 48, 18, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ddd6fe'
    ctx.beginPath()
    ctx.moveTo(-27, 18)
    ctx.lineTo(27, 18)
    ctx.lineTo(18, -72)
    ctx.lineTo(-18, -72)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#f4d0b0'
    ctx.beginPath()
    ctx.arc(0, -84, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#312e81'
    ctx.beginPath()
    ctx.moveTo(-20, -94)
    ctx.lineTo(0, -119)
    ctx.lineTo(20, -94)
    ctx.lineTo(13, -88)
    ctx.lineTo(-13, -88)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#fde68a'
    ctx.beginPath()
    ctx.arc(0, -117, 4, 0, Math.PI * 2)
    ctx.fill()
    if (curse > 0 && curse < 1) {
      ctx.globalAlpha = clamp(curse * 1.2, 0, 1)
      const beam = ctx.createLinearGradient(0, 15, 0, 360)
      beam.addColorStop(0, 'rgba(196, 181, 253, .9)')
      beam.addColorStop(0.45, 'rgba(129, 140, 248, .32)')
      beam.addColorStop(1, 'rgba(71, 85, 160, 0)')
      ctx.fillStyle = beam
      ctx.beginPath()
      ctx.moveTo(-13, 16)
      ctx.lineTo(13, 16)
      ctx.lineTo(92, 360)
      ctx.lineTo(-92, 360)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  private drawMinimap() {
    const minimumZoom = this.minimumZoom()
    if (this.zoom <= minimumZoom * 1.16) return
    const bounds = this.revealedScreenBounds()
    if (!bounds) return
    const ctx = this.ctx
    const radius = 70
    const center = { x: WIDTH - radius - 18, y: HEIGHT - radius - 18 }
    const padding = 12
    const spanX = Math.max(1, bounds.maxX - bounds.minX)
    const spanY = Math.max(1, bounds.maxY - bounds.minY)
    const scale = Math.min((radius * 2 - padding * 2) / spanX, (radius * 2 - padding * 2) / spanY)
    const mapPoint = (point: Point) => ({
      x: center.x + (point.x - (bounds.minX + bounds.maxX) / 2) * scale,
      y: center.y + (point.y - (bounds.minY + bounds.maxY) / 2) * scale
    })

    ctx.save()
    ctx.beginPath()
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = 'rgba(8, 15, 28, .88)'
    ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2)
    ctx.strokeStyle = 'rgba(250, 204, 21, .48)'
    ctx.lineWidth = 2
    for (const link of this.mapPlan.roadLinks) {
      if (!this.revealed.has(cellKey(link.from)) || !this.revealed.has(cellKey(link.to))) continue
      const from = mapPoint(this.gridToScreen(link.from))
      const to = mapPoint(this.gridToScreen(link.to))
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
    }
    const castle = this.mapPlan.rooms.find(room => room.id === this.mapPlan.castleRoomId)
    if (castle) {
      const position = mapPoint(this.gridToScreen(castle.origin))
      ctx.fillStyle = '#67e8f9'
      ctx.beginPath()
      ctx.arc(position.x, position.y, 4, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const enemy of this.enemies) {
      const position = mapPoint(this.enemyScreenPosition(enemy))
      ctx.fillStyle = enemy.type === 'boss' ? '#facc15' : '#fb7185'
      ctx.beginPath()
      ctx.arc(position.x, position.y, enemy.type === 'boss' ? 3.6 : 2.3, 0, Math.PI * 2)
      ctx.fill()
    }
    const viewportHalfWidth = WIDTH / (2 * this.zoom)
    const viewportHalfHeight = HEIGHT / (2 * this.zoom)
    const viewportCenter = {
      x: WORLD_VIEW_CENTER.x + this.camera.x,
      y: WORLD_VIEW_CENTER.y + this.camera.y
    }
    const topLeft = mapPoint({
      x: viewportCenter.x - viewportHalfWidth,
      y: viewportCenter.y - viewportHalfHeight
    })
    ctx.strokeStyle = 'rgba(255, 255, 255, .72)'
    ctx.lineWidth = 1
    ctx.strokeRect(topLeft.x, topLeft.y, viewportHalfWidth * 2 * scale, viewportHalfHeight * 2 * scale)
    ctx.restore()

    ctx.strokeStyle = 'rgba(103, 232, 249, .72)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2)
    ctx.stroke()
  }

  private drawDefeatScene() {
    const ctx = this.ctx
    const time = performance.now() / 1000
    const glow = ctx.createLinearGradient(0, 0, 0, HEIGHT)
    glow.addColorStop(0, '#111827')
    glow.addColorStop(0.48, '#3f1d20')
    glow.addColorStop(1, '#120b0d')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    // Broken great hall: rear wall, cracked arches, and a floor drawing the
    // eye toward the breached gate.
    ctx.fillStyle = '#334155'
    ctx.fillRect(80, 120, WIDTH - 160, 430)
    ctx.fillStyle = '#475569'
    for (let x = 105; x < WIDTH - 100; x += 92) {
      ctx.fillRect(x, 145, 64, 250)
      ctx.fillStyle = '#1f2937'
      ctx.beginPath()
      ctx.arc(x + 32, 205, 22, Math.PI, 0)
      ctx.lineTo(x + 54, 310)
      ctx.lineTo(x + 10, 310)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#475569'
    }
    ctx.fillStyle = '#1e293b'
    ctx.beginPath()
    ctx.moveTo(80, 550)
    ctx.lineTo(WIDTH - 80, 550)
    ctx.lineTo(WIDTH, HEIGHT)
    ctx.lineTo(0, HEIGHT)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(148,163,184,.18)'
    ctx.lineWidth = 2
    for (let lane = -4; lane <= 4; lane++) {
      ctx.beginPath()
      ctx.moveTo(WIDTH / 2 + lane * 58, 550)
      ctx.lineTo(WIDTH / 2 + lane * 125, HEIGHT)
      ctx.stroke()
    }

    const drawFire = (x: number, y: number, scale: number) => {
      const flicker = Math.sin(time * 8 + x) * 5
      ctx.fillStyle = 'rgba(249,115,22,.22)'
      ctx.beginPath()
      ctx.arc(x, y - 28, 55 * scale, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ef4444'
      ctx.beginPath()
      ctx.moveTo(x - 20 * scale, y)
      ctx.quadraticCurveTo(x - 32 * scale, y - 42 * scale, x - 5 * scale, y - 68 * scale + flicker)
      ctx.quadraticCurveTo(x + 3 * scale, y - 34 * scale, x + 18 * scale, y - 55 * scale - flicker)
      ctx.quadraticCurveTo(x + 32 * scale, y - 22 * scale, x + 20 * scale, y)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#fbbf24'
      ctx.beginPath()
      ctx.moveTo(x - 10 * scale, y)
      ctx.quadraticCurveTo(x - 12 * scale, y - 30 * scale, x + 2 * scale, y - 44 * scale - flicker)
      ctx.quadraticCurveTo(x + 18 * scale, y - 20 * scale, x + 10 * scale, y)
      ctx.closePath()
      ctx.fill()
      for (let smoke = 0; smoke < 4; smoke++) {
        const rise = (time * 24 + smoke * 29 + x) % 105
        ctx.fillStyle = `rgba(15,23,42,${0.42 - rise / 360})`
        ctx.beginPath()
        ctx.arc(x + Math.sin(time + smoke) * 14, y - 65 - rise, 15 + rise * 0.16, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    drawFire(175, 585, 1.15)
    drawFire(965, 560, 1.35)
    drawFire(760, 445, 0.8)

    const drawFigure = (x: number, y: number, color: string, direction: number, armed = false) => {
      const run = Math.sin(time * 9 + x) * 8
      ctx.strokeStyle = '#1f2937'
      ctx.lineWidth = 7
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x - 4, y)
      ctx.lineTo(x - 8 + run, y + 25)
      ctx.moveTo(x + 4, y)
      ctx.lineTo(x + 8 - run, y + 25)
      ctx.stroke()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(x - 13, y - 34, 26, 38, 8)
      ctx.fill()
      ctx.fillStyle = '#d6b08a'
      ctx.beginPath()
      ctx.arc(x, y - 43, 10, 0, Math.PI * 2)
      ctx.fill()
      if (armed) {
        ctx.strokeStyle = '#cbd5e1'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.moveTo(x + direction * 8, y - 25)
        ctx.lineTo(x + direction * 38, y - 52 + Math.sin(time * 7 + x) * 10)
        ctx.stroke()
      }
    }
    // Citizens flee toward the foreground while invaders press inward.
    drawFigure(350 + Math.sin(time * 1.7) * 32, 560, '#2563eb', -1)
    drawFigure(455 + Math.sin(time * 1.4 + 2) * 28, 625, '#db2777', -1)
    drawFigure(545 + Math.sin(time * 1.9 + 4) * 35, 525, '#ca8a04', -1)
    drawFigure(835, 515, '#b91c1c', -1, true)
    drawFigure(900, 625, '#7f1d1d', -1, true)
    drawFigure(720, 585, '#ea580c', -1, true)

    for (let ember = 0; ember < 42; ember++) {
      const x = (ember * 97 + time * (13 + ember % 5)) % WIDTH
      const y = HEIGHT - ((ember * 47 + time * 38) % 520)
      ctx.fillStyle = ember % 3 ? '#fb923c' : '#fef08a'
      ctx.globalAlpha = 0.35 + (ember % 5) * 0.12
      ctx.fillRect(x, y, 2 + ember % 3, 2 + ember % 3)
    }
    ctx.globalAlpha = 1

    ctx.fillStyle = 'rgba(2,6,23,.82)'
    ctx.fillRect(0, 0, WIDTH, 112)
    ctx.fillStyle = '#fca5a5'
    ctx.font = '900 44px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('CASTLE LOST', WIDTH / 2, 54)
    ctx.fillStyle = '#f8fafc'
    ctx.font = '800 20px sans-serif'
    ctx.fillText(`ALL IS LOST · ${this.coinsEarned.toLocaleString()} COINS WON`, WIDTH / 2, 88)
  }

  private drawBackdrop() {
    const ctx = this.ctx
    const glow = ctx.createRadialGradient(WIDTH / 2, HEIGHT * 0.42, 80, WIDTH / 2, HEIGHT * 0.42, 650)
    glow.addColorStop(0, 'rgba(226,232,240,.16)')
    glow.addColorStop(1, 'rgba(71,85,105,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    ctx.save()
    ctx.globalAlpha = 0.42
    ctx.fillStyle = '#d6d3d1'
    for (const flake of this.ashflakes) {
      ctx.save()
      ctx.translate(flake.x, flake.y)
      ctx.rotate(flake.rotation)
      ctx.beginPath()
      ctx.moveTo(0, -flake.size)
      ctx.lineTo(flake.size * 0.65, 0)
      ctx.lineTo(0, flake.size)
      ctx.lineTo(-flake.size * 0.65, 0)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    ctx.restore()
  }

  private drawBoard() {
    const pathKeys = new Set(this.allRoadCells().map(cellKey))
    const reservedPathKeys = new Set(this.allBuildBlockedCells().map(cellKey))

    // Terrain is one connected height field. Drawing it as a separate pass
    // prevents buildings from becoming trapped between neighboring tiles.
    for (let depth = 0; depth <= COLS + ROWS - 2; depth++) {
      for (let row = 0; row < ROWS; row++) {
        const col = depth - row
        if (col < 0 || col >= COLS) continue
        const point = { col, row }
        const revealed = this.revealed.has(cellKey(point))
        this.drawTile(point, revealed, pathKeys.has(cellKey(point)))
      }
    }

    this.drawGroundFeatures()
    this.drawRoad()
    this.drawDeadEndSites()
    this.drawBridgeDetails()
    this.drawFrostFields()
    this.drawTowerRangePreview()
    this.drawHover()

    // Every object shares a single painter's-order queue. A tower south-east
    // of the keep must cover it; a tower north-west must pass behind it.
    const renderables: Array<{ y: number, draw: () => void }> = []
    for (const feature of this.mapPlan.features) {
      if (!['mountain', 'cliff', 'forest'].includes(feature.kind)) continue
      for (const point of feature.cells) {
        if (!this.revealed.has(cellKey(point))) continue
        renderables.push({
          y: this.gridToScreen(point).y,
          draw: () => this.drawRaisedFeature(point, feature.kind)
        })
      }
    }
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const point = { col, row }
        if (!this.revealed.has(cellKey(point)) || reservedPathKeys.has(cellKey(point))) continue
        if (this.hasDecoration(point)) {
          renderables.push({ y: this.gridToScreen(point).y, draw: () => this.drawDecoration(point) })
        }
      }
    }
    for (const tower of this.towers) {
      const renderPoint = this.towerDrag?.active && this.towerDrag.towerId === tower.id && this.hoverCell
        ? this.hoverCell
        : tower
      renderables.push({ y: this.gridToScreen(renderPoint).y + 2, draw: () => this.drawTower(tower, renderPoint) })
    }
    if (this.phase === 'planning'
      && this.placementMode
      && this.hoverCell
      && this.revealed.has(cellKey(this.hoverCell))
      && !this.towers.some(tower => tower.col === this.hoverCell!.col && tower.row === this.hoverCell!.row)) {
      const placementCell = { ...this.hoverCell }
      renderables.push({
        y: this.gridToScreen(placementCell).y + 3,
        draw: () => this.drawPlacementPreview(placementCell)
      })
    }
    if (this.failedPlacement) {
      const failed = this.failedPlacement
      renderables.push({
        y: this.gridToScreen(failed.cell).y + 3,
        draw: () => this.drawFailedPlacement(failed)
      })
    }
    for (const enemy of this.enemies.filter(candidate => this.enemyHasExitedMist(candidate))) {
      renderables.push({ y: this.enemyScreenPosition(enemy).y + enemy.radius, draw: () => this.drawEnemy(enemy) })
    }
    for (const actor of this.ambientActors.filter(candidate => candidate.kind !== 'bird')) {
      renderables.push({ y: this.ambientActorDepth(actor), draw: () => this.drawAmbientActor(actor) })
    }
    const keepCell = this.path[0]!
    renderables.push({ y: this.gridToScreen(keepCell).y + 1, draw: () => this.drawKeep() })

    // Approaching enemies occupy the precomputed hidden road and are painted
    // behind the entire mist volume. Revealed-world objects are deliberately
    // painted after it, preventing fog behind the keep from washing over the
    // castle, towers, or citizens in the foreground.
    for (const enemy of this.enemies
      .filter(candidate => !this.enemyHasExitedMist(candidate))
      .sort((a, b) => this.enemyScreenPosition(a).y - this.enemyScreenPosition(b).y)) {
      this.drawEnemy(enemy)
    }
    this.drawUndiscoveredMistField()
    this.drawMapEdgeFog()
    this.drawActiveRoadMouthFog()

    renderables.sort((a, b) => a.y - b.y)
    for (const renderable of renderables) renderable.draw()

    for (const bird of this.ambientActors.filter(actor => actor.kind === 'bird')) this.drawBird(bird)
    if (import.meta.dev && this.debugVisuals) this.drawTerminalSpawnMarkers()
    this.drawPathChoices()
  }

  private drawTerminalSpawnMarkers() {
    const claimedRoomIds = new Set([...this.claimedSections]
      .map(section => section.roomId)
      .filter(roomId => roomId !== undefined))
    const approaches = this.mapPlan.rooms
      .filter(room => room.id === this.mapPlan.castleRoomId || claimedRoomIds.has(room.id))
      .flatMap(room => room.terminalApproaches ?? [])
    const ctx = this.ctx
    for (const approach of approaches) {
      const firstHidden = approach.cells.find(cell => !this.revealed.has(cellKey(cell)))
      if (!firstHidden) continue
      const screen = this.gridToScreen(firstHidden)
      ctx.save()
      ctx.translate(screen.x, screen.y - 7)
      ctx.fillStyle = 'rgba(127,29,29,.82)'
      ctx.strokeStyle = '#fca5a5'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(0, -14)
      ctx.lineTo(22, 0)
      ctx.lineTo(0, 14)
      ctx.lineTo(-22, 0)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#fff1f2'
      ctx.font = '900 8px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('SPAWN', 0, 3)
      ctx.restore()
    }
  }

  private drawUndiscoveredMistField() {
    const ctx = this.ctx
    const drift = performance.now() / 1000
    ctx.save()

    // Cut the discovered island out of one continuous veil. Individual
    // translucent tile fills overlap at their edges and reveal an artificial
    // diamond grid; an even-odd clip keeps the unknown world seamless.
    const revealedScreens: Point[] = []
    for (const key of this.revealed) {
      const [col, row] = key.split(':').map(Number)
      const screen = this.gridToScreen({ col: col!, row: row! })
      revealedScreens.push(screen)
      // Intersect one outside-of-diamond clip at a time. A single even-odd
      // path toggles overlapping reveal diamonds back on and creates a dark
      // lattice; sequential clips form the true union of all revealed land.
      ctx.beginPath()
      ctx.rect(-8000, -8000, 16000, 16000)
      // Push the opaque veil well behind the visible tile boundary. The
      // radial edge-fog pass below owns the transition; allowing this hard
      // mask to touch a road produced a straight dark "shadow" across it.
      ctx.moveTo(screen.x, screen.y - TILE_HEIGHT * 0.88)
      ctx.lineTo(screen.x + TILE_WIDTH * 0.88, screen.y)
      ctx.lineTo(screen.x, screen.y + TILE_HEIGHT * 0.88)
      ctx.lineTo(screen.x - TILE_WIDTH * 0.88, screen.y)
      ctx.closePath()
      ctx.clip('evenodd')
    }
    ctx.fillStyle = 'rgba(91,107,133,.68)'
    ctx.fillRect(-8000, -8000, 16000, 16000)

    const minX = Math.min(...revealedScreens.map(point => point.x), WORLD_VIEW_CENTER.x) - 900
    const maxX = Math.max(...revealedScreens.map(point => point.x), WORLD_VIEW_CENTER.x) + 900
    const minY = Math.min(...revealedScreens.map(point => point.y), WORLD_VIEW_CENTER.y) - 650
    const maxY = Math.max(...revealedScreens.map(point => point.y), WORLD_VIEW_CENTER.y) + 650
    for (let index = 0; index < 42; index++) {
      const baseX = minX + ((index * 337) % 997) / 997 * (maxX - minX)
      const baseY = minY + ((index * 191) % 613) / 613 * (maxY - minY)
      const x = baseX + Math.sin(drift * 0.08 + index * 1.7) * 46
      const y = baseY + Math.cos(drift * 0.055 + index * 0.9) * 22
      const radius = 105 + index % 5 * 24
      const cloud = ctx.createRadialGradient(x, y, 8, x, y, radius)
      cloud.addColorStop(0, 'rgba(226,232,240,.2)')
      cloud.addColorStop(0.5, 'rgba(148,163,184,.13)')
      cloud.addColorStop(1, 'rgba(100,116,139,0)')
      ctx.fillStyle = cloud
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
    }
    ctx.restore()
  }

  private drawMapEdgeFog() {
    const ctx = this.ctx
    const fogPoints = new Map<string, Point>()
    for (const key of this.revealed) {
      const [col, row] = key.split(':').map(Number)
      const cell = { col: col!, row: row! }
      const center = this.gridToScreen(cell)
      for (const neighbour of [
        { col: cell.col + 1, row: cell.row },
        { col: cell.col - 1, row: cell.row },
        { col: cell.col, row: cell.row + 1 },
        { col: cell.col, row: cell.row - 1 }
      ]) {
        if (this.revealed.has(cellKey(neighbour))) continue
        const outside = neighbour.col < 0 || neighbour.col >= COLS || neighbour.row < 0 || neighbour.row >= ROWS
        const neighbourScreen = outside
          ? {
              x: center.x + (neighbour.col - cell.col - (neighbour.row - cell.row)) * TILE_WIDTH / 2,
              y: center.y + (neighbour.col - cell.col + neighbour.row - cell.row) * TILE_HEIGHT / 2
            }
          : this.gridToScreen(neighbour)
        const point = {
          x: (center.x + neighbourScreen.x) / 2,
          y: (center.y + neighbourScreen.y) / 2
        }
        fogPoints.set(`${Math.round(point.x / 24)}:${Math.round(point.y / 18)}`, point)
      }
    }
    ctx.save()
    for (const point of fogPoints.values()) {
      const fog = ctx.createRadialGradient(point.x, point.y, 5, point.x, point.y, 58)
      fog.addColorStop(0, 'rgba(113,128,154,.72)')
      fog.addColorStop(0.5, 'rgba(125,140,166,.4)')
      fog.addColorStop(1, 'rgba(100,116,139,0)')
      ctx.fillStyle = fog
      ctx.fillRect(point.x - 60, point.y - 60, 120, 120)
    }
    ctx.restore()
  }

  private drawFrostFields() {
    const ctx = this.ctx
    for (const tower of this.towers.filter(candidate => candidate.type === 'frost')) {
      const screen = this.gridToScreen(tower)
      const elevation = this.elevations[tower.row]![tower.col]!
      const range = towerStats('frost').range * this.rangeMultiplier * (1 + (elevation - 1) * 0.09)
      const radiusCells = range / WORLD_CELL
      const radiusX = radiusCells * TILE_WIDTH * 0.52
      const radiusY = radiusCells * TILE_HEIGHT * 0.52
      const pulse = 0.96 + Math.sin(performance.now() / 520 + tower.id) * 0.035
      ctx.save()
      ctx.translate(screen.x, screen.y + 2)
      ctx.scale(radiusX * pulse, radiusY * pulse)
      const frost = ctx.createRadialGradient(0, 0, 0.08, 0, 0, 1)
      frost.addColorStop(0, 'rgba(224,242,254,.28)')
      frost.addColorStop(0.58, 'rgba(165,243,252,.16)')
      frost.addColorStop(0.86, 'rgba(196,181,253,.08)')
      frost.addColorStop(1, 'rgba(196,181,253,0)')
      ctx.fillStyle = frost
      ctx.beginPath()
      ctx.arc(0, 0, 1, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      ctx.save()
      ctx.strokeStyle = 'rgba(224,242,254,.35)'
      ctx.lineWidth = 1.5
      for (let index = 0; index < 12; index++) {
        const angle = index * Math.PI * 2 / 12 + tower.id
        const spread = 0.25 + ((index * 37) % 60) / 100
        const x = screen.x + Math.cos(angle) * radiusX * spread
        const y = screen.y + Math.sin(angle) * radiusY * spread
        ctx.beginPath()
        ctx.moveTo(x - 4, y)
        ctx.lineTo(x + 4, y)
        ctx.moveTo(x, y - 3)
        ctx.lineTo(x, y + 3)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  private drawAmbientActor(actor: AmbientActor) {
    const ctx = this.ctx
    const life = actor.age / actor.duration
    const lifeAlpha = clamp(Math.min(life / 0.045, (1 - life) / 0.065), 0, 1)
    ctx.save()
    ctx.globalAlpha = lifeAlpha
    if (actor.kind === 'cat') this.drawCat(actor)
    else if (actor.kind === 'crew') this.drawConstructionCrew(actor)
    else if (actor.kind === 'market') this.drawMarketDay(actor)
    else if (actor.kind === 'picnic') this.drawPicnic(actor)
    else if (actor.kind === 'hunt') this.drawHunt(actor)
    else if (actor.kind === 'musician') this.drawMusician(actor)
    else if (actor.kind === 'children') this.drawChildren(actor)
    else if (actor.kind === 'shepherd') this.drawShepherd(actor)
    else this.drawRoadTraveler(actor)
    ctx.restore()
  }

  private ambientActorDepth(actor: AmbientActor) {
    if (actor.kind === 'cat') return this.gridToScreen(this.path[0]!).y + 42
    if (actor.kind === 'crew' && this.towers.length) {
      const tower = this.towers[Math.floor(actor.seed) % this.towers.length]!
      const travel = actor.age / actor.duration
      const routeProgress = travel < 0.3
        ? travel / 0.3
        : travel < 0.72
          ? 1
          : 1 - (travel - 0.72) / 0.28
      return this.routePosition(this.constructionRoute(tower), routeProgress).y + 16
    }
    if (['market', 'picnic', 'hunt', 'musician', 'children', 'shepherd'].includes(actor.kind)) {
      return this.ambientMeadowPoint(actor.seed, 0, actor.blockKey).y + 28
    }
    const travel = actor.age / actor.duration
    const progress = actor.kind === 'peddler' ? 1 - travel : 1 - Math.abs((travel * 2) % 2 - 1)
    return this.ambientRoadPosition(progress).y + 16
  }

  private ambientRoadPosition(progress: number) {
    const endpoint = this.path[this.path.length - 1]!
    const frontier = this.pathChoices.find(choice => cellKey(choice.source) === cellKey(endpoint))
    const visibleFrontier = frontier?.cells.filter(point => this.revealed.has(cellKey(point))) ?? []
    const route = [
      this.castleGatePosition(),
      ...this.path.slice(1).map(point => this.gridToScreen(point)),
      ...visibleFrontier.map(point => this.gridToScreen(point)),
      this.mistRoadPosition()
    ]
    const scaled = clamp(progress, 0, 0.999) * (route.length - 1)
    const index = Math.floor(scaled)
    const fraction = scaled - index
    const from = route[index]!
    const to = route[Math.min(route.length - 1, index + 1)]!
    return {
      x: from.x + (to.x - from.x) * fraction,
      y: from.y + (to.y - from.y) * fraction
    }
  }

  private ambientMeadowPoint(seed: number, alternate = 0, blockKey?: string) {
    const [blockCol, blockRow] = (blockKey ?? cellKey(this.path[0]!)).split(':').map(Number)
    const candidates = [...this.revealed]
      .map((key) => {
        const [col, row] = key.split(':').map(Number)
        return { col: col!, row: row! }
      })
      .filter(point =>
        !this.allRoadCells().some(road => cellKey(road) === cellKey(point))
        && !this.towers.some(tower => tower.col === point.col && tower.row === point.row)
        && !this.hasDecoration(point)
        && Math.max(Math.abs(point.col - this.path[0]!.col), Math.abs(point.row - this.path[0]!.row)) > 1
        && Math.max(Math.abs(point.col - blockCol!), Math.abs(point.row - blockRow!)) <= 3)
      .sort((a, b) => cellKey(a).localeCompare(cellKey(b)))
    const point = candidates[Math.abs(Math.floor(seed + alternate * 7)) % Math.max(1, candidates.length)]
      ?? { col: this.path[0]!.col - 2, row: this.path[0]!.row + 2 }
    return this.gridToScreen(point)
  }

  private evacuationOffset(origin: Point, actor: AmbientActor, spread = 0) {
    if (this.ambientEvacuation <= 0) return { x: 0, y: 0, alpha: 1 }
    const duration = this.pendingWaveStart ? 1.35 : 0.95
    const progress = 1 - this.ambientEvacuation / duration
    const gate = this.castleGatePosition()
    const direction = actor.seed % 3 < 1 && actor.kind !== 'cat' ? this.mistRoadPosition() : gate
    const stagger = clamp(progress * 1.3 - spread, 0, 1)
    const easing = 1 - Math.pow(1 - stagger, 2)
    return {
      x: (direction.x - origin.x) * easing,
      y: (direction.y - origin.y) * easing - Math.abs(Math.sin(progress * 24 + spread * 8)) * 5,
      alpha: clamp((1 - stagger) * 2.8, 0, 1)
    }
  }

  private drawVillager(x: number, y: number, color: string, actor: AmbientActor, offsetIndex = 0, pose: 'stand' | 'sit' | 'run' = 'stand') {
    const ctx = this.ctx
    const flee = this.evacuationOffset({ x, y }, actor, offsetIndex * 0.08)
    const running = this.ambientEvacuation > 0 || pose === 'run'
    const step = running ? Math.sin(actor.age * 8 + actor.seed + offsetIndex) * 5 : 0
    ctx.save()
    ctx.globalAlpha *= flee.alpha
    ctx.translate(x + flee.x, y + flee.y)
    if (pose === 'sit' && this.ambientEvacuation <= 0) ctx.translate(0, 5)
    ctx.fillStyle = 'rgba(15,23,42,.22)'
    ctx.beginPath()
    ctx.ellipse(0, 12, 7, 2.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#4b3621'
    ctx.lineWidth = 2.2
    ctx.beginPath()
    if (pose === 'sit' && !running) {
      ctx.moveTo(-3, 5)
      ctx.lineTo(-8, 10)
      ctx.lineTo(-3, 12)
      ctx.moveTo(3, 5)
      ctx.lineTo(8, 10)
      ctx.lineTo(3, 12)
    } else {
      ctx.moveTo(-2, 5)
      ctx.lineTo(-3 + step, 13)
      ctx.moveTo(2, 5)
      ctx.lineTo(3 - step, 13)
    }
    ctx.stroke()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(-6, -5)
    ctx.lineTo(6, -5)
    ctx.lineTo(5, 7)
    ctx.lineTo(-5, 7)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#d6b08a'
    ctx.beginPath()
    ctx.arc(0, -10, 4.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawRoadTraveler(actor: AmbientActor) {
    const ctx = this.ctx
    const travel = actor.age / actor.duration
    const progress = actor.kind === 'peddler' ? 1 - travel : 1 - Math.abs((travel * 2) % 2 - 1)
    const position = this.ambientRoadPosition(progress)
    const step = Math.sin(actor.age * 8 + actor.seed)
    const travelers = actor.kind === 'patrol' ? 2 : 1
    for (let index = 0; index < travelers; index++) {
      const flee = this.evacuationOffset(position, actor, index)
      ctx.save()
      ctx.globalAlpha = clamp(Math.min(travel, 1 - travel) * 10, 0, 1) * flee.alpha
      ctx.translate(position.x + flee.x - index * 13, position.y + flee.y - 13 + Math.abs(step) * 2)
      ctx.fillStyle = 'rgba(15,23,42,.25)'
      ctx.beginPath()
      ctx.ellipse(0, 13, 9, 3, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#4b3621'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(-3, 5)
      ctx.lineTo(-4 + step * 3, 14)
      ctx.moveTo(3, 5)
      ctx.lineTo(4 - step * 3, 14)
      ctx.stroke()
      ctx.fillStyle = actor.kind === 'peddler' ? '#b45309' : '#2563eb'
      ctx.beginPath()
      ctx.moveTo(-7, -5)
      ctx.lineTo(7, -5)
      ctx.lineTo(5, 7)
      ctx.lineTo(-5, 7)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#d6b08a'
      ctx.beginPath()
      ctx.arc(0, -10, 5, 0, Math.PI * 2)
      ctx.fill()
      if (actor.kind === 'peddler') {
        ctx.fillStyle = '#78350f'
        ctx.fillRect(-12, -2, 7, 11)
        ctx.fillStyle = '#fef3c7'
        ctx.font = '700 8px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('wares', 0, -21)
      } else {
        ctx.strokeStyle = '#cbd5e1'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(8, -8)
        ctx.lineTo(13, 9)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  private drawMarketDay(actor: AmbientActor) {
    const ctx = this.ctx
    const center = this.ambientMeadowPoint(actor.seed, 0, actor.blockKey)
    const progress = actor.age / actor.duration
    const buildEnd = 0.18
    const tradeEnd = 0.78
    const construction = progress < buildEnd
      ? clamp(progress / buildEnd, 0, 1)
      : progress > tradeEnd
        ? clamp((1 - progress) / (1 - tradeEnd), 0, 1)
        : 1
    const trading = progress >= buildEnd && progress <= tradeEnd
    const bustle = Math.sin(actor.age * 2.4)
    ctx.save()
    ctx.translate(center.x, center.y)
    ctx.scale(0.72 + construction * 0.28, 0.72 + construction * 0.28)
    ctx.globalAlpha *= clamp(construction * 2, 0, 1)
    ctx.fillStyle = 'rgba(15,23,42,.22)'
    ctx.beginPath()
    ctx.ellipse(0, 17, 34, 8, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#7c2d12'
    ctx.fillRect(-28, -2, 56, 20)
    ctx.strokeStyle = '#78350f'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(-25, -16)
    ctx.lineTo(-25, 18 - 34 * (1 - construction))
    ctx.moveTo(25, -16)
    ctx.lineTo(25, 18 - 34 * (1 - construction))
    ctx.stroke()
    if (construction > 0.45) {
      ctx.globalAlpha *= clamp((construction - 0.45) / 0.3, 0, 1)
      ctx.fillStyle = '#fef3c7'
      for (let index = 0; index < 4; index++) ctx.fillRect(-28 + index * 14, -17, 8, 15)
      ctx.fillStyle = '#ef4444'
      for (let index = 0; index < 4; index++) ctx.fillRect(-20 + index * 14, -17, 6, 15)
    }
    ctx.fillStyle = '#f59e0b'
    ctx.beginPath()
    ctx.arc(-14, 3, 4, 0, Math.PI * 2)
    ctx.arc(0, 5, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#22c55e'
    ctx.beginPath()
    ctx.arc(13, 4, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    this.drawVillager(center.x, center.y - 5, '#b45309', actor, 0)
    if (!trading) {
      const helperX = progress < buildEnd ? center.x - 31 + construction * 12 : center.x + 19 + (1 - construction) * 22
      this.drawVillager(helperX, center.y + 9, '#ca8a04', actor, 1)
    } else {
      const customerCycle = (actor.age / 18) % 1
      const approach = 1 - Math.abs(customerCycle * 2 - 1)
      this.drawVillager(center.x - 58 + approach * 23, center.y + 8 + bustle * 2, '#7c3aed', actor, 1)
      this.drawVillager(center.x + 58 - approach * 20, center.y + 10 - bustle * 2, '#0f766e', actor, 2)
      const exchange = (actor.age / 5) % 1
      if (exchange > 0.48 && exchange < 0.88) {
        const exchangeProgress = (exchange - 0.48) / 0.4
        ctx.save()
        ctx.fillStyle = '#fde047'
        ctx.beginPath()
        ctx.arc(center.x - 28 + exchangeProgress * 25, center.y - 7 - Math.sin(exchangeProgress * Math.PI) * 8, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }
    if (trading && this.ambientEvacuation <= 0 && Math.sin(actor.age * 3) > 0.75) {
      ctx.save()
      ctx.fillStyle = '#fde047'
      ctx.font = '900 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('✦', center.x + 23, center.y - 25)
      ctx.restore()
    }
  }

  private drawPicnic(actor: AmbientActor) {
    const ctx = this.ctx
    const center = this.ambientMeadowPoint(actor.seed, 0, actor.blockKey)
    ctx.save()
    ctx.translate(center.x, center.y + 8)
    ctx.rotate(-0.12)
    ctx.fillStyle = '#fef3c7'
    ctx.fillRect(-25, -12, 50, 28)
    ctx.fillStyle = '#fb7185'
    for (let index = -20; index <= 20; index += 10) ctx.fillRect(index, -12, 5, 28)
    ctx.fillStyle = '#92400e'
    ctx.fillRect(-4, -4, 12, 9)
    ctx.fillStyle = '#ef4444'
    ctx.beginPath()
    ctx.arc(2, -8, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    this.drawVillager(center.x - 14, center.y + 5, '#db2777', actor, 0, 'sit')
    this.drawVillager(center.x + 16, center.y + 5, '#2563eb', actor, 1, 'sit')
    if (this.ambientEvacuation <= 0) {
      // Long quiet eating beats, broken by an occasional shared toast. The
      // diners stay seated; only hands and food move.
      for (const [index, side] of [-1, 1].entries()) {
        const dinerX = center.x + side * 15
        const biteCycle = (actor.age / 9 + index * 0.43) % 1
        const handLift = biteCycle > 0.66 && biteCycle < 0.86
          ? Math.sin((biteCycle - 0.66) / 0.2 * Math.PI)
          : 0
        ctx.save()
        ctx.strokeStyle = '#d6b08a'
        ctx.lineWidth = 2.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(dinerX - side * 2, center.y + 2)
        ctx.lineTo(dinerX - side * (7 - handLift * 5), center.y + 7 - handLift * 13)
        ctx.stroke()
        ctx.fillStyle = index ? '#fbbf24' : '#ef4444'
        ctx.beginPath()
        ctx.arc(dinerX - side * (7 - handLift * 5), center.y + 6 - handLift * 13, 2.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
      const heart = 0.85 + Math.sin(actor.age * 3) * 0.15
      ctx.save()
      ctx.globalAlpha = clamp(Math.sin(actor.age * 1.3) * 2, 0, 0.85)
      ctx.translate(center.x + 2, center.y - 29)
      ctx.scale(heart, heart)
      ctx.fillStyle = '#fb7185'
      ctx.font = '900 16px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('♥', 0, 0)
      ctx.restore()
    }
  }

  private drawHunt(actor: AmbientActor) {
    const ctx = this.ctx
    const start = this.ambientMeadowPoint(actor.seed, 0, actor.blockKey)
    const end = this.ambientMeadowPoint(actor.seed, 2, actor.blockKey)
    const progress = actor.age / actor.duration
    const chaseEnd = 0.62
    const caught = Math.floor(actor.seed * 997) % 100 < 42
    const chase = clamp(progress / chaseEnd, 0, 1)
    const returnProgress = clamp((progress - chaseEnd) / (1 - chaseEnd), 0, 1)
    const gate = this.castleGatePosition()
    const escape = this.mistRoadPosition()
    const chasePosition = {
      x: start.x + (end.x - start.x) * chase,
      y: start.y + (end.y - start.y) * chase
    }
    const destination = caught ? gate : escape
    const deer = progress <= chaseEnd
      ? chasePosition
      : {
          x: end.x + (destination.x - end.x) * returnProgress,
          y: end.y + (destination.y - end.y) * returnProgress
        }
    const direction = Math.sign((progress <= chaseEnd ? end.x : destination.x) - deer.x) || 1
    const leap = progress <= chaseEnd || !caught ? Math.abs(Math.sin(actor.age * 6.2)) * 8 : 0
    const drawDeer = (x: number, y: number, fallen: boolean) => {
      ctx.save()
      ctx.translate(x, y - leap)
      ctx.scale(direction, 1)
      if (fallen) ctx.rotate(1.2)
      ctx.fillStyle = '#b45309'
      ctx.beginPath()
      ctx.ellipse(0, 0, 14, 8, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillRect(8, -12, 5, 12)
      ctx.beginPath()
      ctx.ellipse(14, -14, 7, 5, -0.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#78350f'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(-8, 5)
      ctx.lineTo(-11, 16)
      ctx.moveTo(7, 5)
      ctx.lineTo(10, 16)
      ctx.moveTo(16, -18)
      ctx.lineTo(20, -27)
      ctx.moveTo(16, -18)
      ctx.lineTo(12, -27)
      ctx.stroke()
      ctx.restore()
    }
    drawDeer(deer.x, deer.y, caught && progress > chaseEnd)
    const hunter = progress <= chaseEnd
      ? {
          x: chasePosition.x - direction * (58 - chase * 28),
          y: chasePosition.y + 4
        }
      : caught
        ? { x: deer.x - direction * 25, y: deer.y + 3 }
        : {
            x: end.x + (gate.x - end.x) * returnProgress,
            y: end.y + (gate.y - end.y) * returnProgress
          }
    this.drawVillager(hunter.x, hunter.y, '#166534', actor, 0, progress <= chaseEnd ? 'run' : 'stand')
    ctx.save()
    ctx.translate(hunter.x, hunter.y - 10)
    ctx.scale(direction, 1)
    ctx.strokeStyle = '#92400e'
    ctx.lineWidth = 2
    ctx.beginPath()
    if (caught && progress > chaseEnd) {
      ctx.moveTo(4, 3)
      ctx.lineTo(deer.x - hunter.x, deer.y - hunter.y)
    } else {
      ctx.arc(5, 0, 10, -Math.PI / 2, Math.PI / 2)
      ctx.moveTo(5, -10)
      ctx.lineTo(5, 10)
    }
    ctx.stroke()
    ctx.restore()
    if (caught && progress > chaseEnd && returnProgress < 0.12) {
      ctx.save()
      ctx.fillStyle = '#fef3c7'
      ctx.font = '900 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('HIT!', end.x, end.y - 35)
      ctx.restore()
    }
  }

  private drawMusician(actor: AmbientActor) {
    const ctx = this.ctx
    const center = this.ambientMeadowPoint(actor.seed, 0, actor.blockKey)
    this.drawVillager(center.x, center.y, '#7c3aed', actor, 0)
    if (this.ambientEvacuation > 0) return
    ctx.save()
    ctx.translate(center.x + 8, center.y - 5)
    ctx.rotate(Math.sin(actor.age * 6) * 0.08)
    ctx.fillStyle = '#d97706'
    ctx.beginPath()
    ctx.ellipse(0, 0, 7, 9, 0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#78350f'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(3, -6)
    ctx.lineTo(15, -18)
    ctx.stroke()
    ctx.restore()
    ctx.save()
    ctx.fillStyle = '#fef08a'
    ctx.font = '900 13px sans-serif'
    ctx.fillText('♪', center.x + 20, center.y - 29 - Math.sin(actor.age * 3) * 5)
    ctx.fillText('♫', center.x - 18, center.y - 36 + Math.cos(actor.age * 2) * 5)
    ctx.restore()
  }

  private drawChildren(actor: AmbientActor) {
    const center = this.ambientMeadowPoint(actor.seed, 0, actor.blockKey)
    for (let index = 0; index < 3; index++) {
      const angle = actor.age * (index % 2 ? -1.4 : 1.5) + index * Math.PI * 2 / 3
      const radius = 18 + index * 3
      this.drawVillager(
        center.x + Math.cos(angle) * radius,
        center.y + Math.sin(angle) * radius * 0.45,
        ['#06b6d4', '#f97316', '#a855f7'][index]!,
        actor,
        index,
        'run'
      )
    }
  }

  private drawShepherd(actor: AmbientActor) {
    const ctx = this.ctx
    const first = this.ambientMeadowPoint(actor.seed, 0, actor.blockKey)
    const second = this.ambientMeadowPoint(actor.seed, 1, actor.blockKey)
    const third = this.ambientMeadowPoint(actor.seed, 2, actor.blockKey)
    const progress = actor.age / actor.duration
    const movingIn = progress < 0.16
    const movingOut = progress > 0.8
    const movement = movingIn
      ? clamp(progress / 0.16, 0, 1)
      : movingOut ? clamp((progress - 0.8) / 0.2, 0, 1) : 0
    const from = movingOut ? second : first
    const to = movingOut ? third : second
    const center = movingIn || movingOut
      ? {
          x: from.x + (to.x - from.x) * movement,
          y: from.y + (to.y - from.y) * movement
        }
      : second
    const walking = movingIn || movingOut
    const direction = Math.sign(to.x - from.x) || 1
    for (let index = 0; index < 4; index++) {
      const grazeShift = walking ? 0 : Math.sin(actor.age * 0.18 + index * 2.3) * 2
      const x = center.x + (index % 2) * 19 - 10 + grazeShift
      const y = center.y + Math.floor(index / 2) * 14 + (walking ? Math.abs(Math.sin(actor.age * 5 + index)) * 2 : 0)
      const flee = this.evacuationOffset({ x, y }, actor, index * 0.06)
      ctx.save()
      ctx.globalAlpha = flee.alpha
      ctx.translate(x + flee.x, y + flee.y)
      ctx.scale(direction, 1)
      ctx.fillStyle = '#f8fafc'
      ctx.beginPath()
      ctx.arc(-5, 0, 6, 0, Math.PI * 2)
      ctx.arc(1, -2, 7, 0, Math.PI * 2)
      ctx.arc(7, 1, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#334155'
      ctx.beginPath()
      const grazing = !walking && (Math.floor(actor.age / 11 + index) % 3 !== 0)
      ctx.arc(10, grazing ? 7 : 1, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    const shepherdX = center.x - direction * 32
    const shepherdY = center.y + 9
    this.drawVillager(shepherdX, shepherdY, '#ca8a04', actor, 0, walking ? 'run' : 'stand')
    if (this.ambientEvacuation <= 0) {
      ctx.save()
      ctx.strokeStyle = '#78350f'
      ctx.lineWidth = 2
      const staffWave = !walking && (actor.age % 37) > 33
        ? Math.sin((actor.age % 37 - 33) / 4 * Math.PI) * 9
        : 0
      ctx.beginPath()
      ctx.moveTo(shepherdX + direction * 8, shepherdY - 12 - staffWave)
      ctx.lineTo(shepherdX + direction * 14, shepherdY + 18)
      ctx.stroke()
      ctx.restore()
    }
  }

  private constructionRoute(tower: Tower) {
    const start = this.path[0]!
    const blocked = new Set(this.towers.map(cellKey))
    const targets = [
      { col: tower.col + 1, row: tower.row },
      { col: tower.col - 1, row: tower.row },
      { col: tower.col, row: tower.row + 1 },
      { col: tower.col, row: tower.row - 1 }
    ].filter(point =>
      point.col >= 0 && point.col < COLS && point.row >= 0 && point.row < ROWS
      && this.revealed.has(cellKey(point))
      && !blocked.has(cellKey(point))
      && !this.hasDecoration(point))
    const targetKeys = new Set(targets.map(cellKey))
    const roadKeys = new Set([
      ...this.allRoadCells(),
      ...this.pathChoices.flatMap(choice => choice.cells)
    ].map(cellKey))
    const costs = new Map([[cellKey(start), 0]])
    const previous = new Map<string, GridPoint>()
    const frontier: Array<{ point: GridPoint, cost: number }> = [{ point: start, cost: 0 }]
    let destination: GridPoint | null = null
    while (frontier.length) {
      frontier.sort((a, b) => a.cost - b.cost)
      const current = frontier.shift()!
      if (current.cost !== costs.get(cellKey(current.point))) continue
      if (targetKeys.has(cellKey(current.point))) {
        destination = current.point
        break
      }
      const neighbours = [
        { col: current.point.col + 1, row: current.point.row },
        { col: current.point.col - 1, row: current.point.row },
        { col: current.point.col, row: current.point.row + 1 },
        { col: current.point.col, row: current.point.row - 1 }
      ]
      for (const next of neighbours) {
        const key = cellKey(next)
        if (next.col < 0 || next.col >= COLS || next.row < 0 || next.row >= ROWS
          || !this.revealed.has(key) || blocked.has(key) || this.hasDecoration(next)) continue
        const nextCost = current.cost + (roadKeys.has(key) ? 0.45 : 2.6)
        if (nextCost >= (costs.get(key) ?? Number.POSITIVE_INFINITY)) continue
        costs.set(key, nextCost)
        previous.set(key, current.point)
        frontier.push({ point: next, cost: nextCost })
      }
    }
    if (!destination) return [this.castleGatePosition()]
    const cells = [destination]
    while (cellKey(cells[0]!) !== cellKey(start)) {
      const prior = previous.get(cellKey(cells[0]!))
      if (!prior) break
      cells.unshift(prior)
    }
    return cells.map((cell, index) => index === 0 ? this.castleGatePosition() : this.gridToScreen(cell))
  }

  private routePosition(route: Point[], progress: number) {
    if (route.length === 1) return route[0]!
    const lengths = route.slice(1).map((point, index) => distance(route[index]!, point))
    const total = lengths.reduce((sum, length) => sum + length, 0)
    let remaining = clamp(progress, 0, 1) * total
    for (let index = 0; index < lengths.length; index++) {
      const length = lengths[index]!
      if (remaining <= length) {
        const from = route[index]!
        const to = route[index + 1]!
        const fraction = length > 0 ? remaining / length : 0
        return {
          x: from.x + (to.x - from.x) * fraction,
          y: from.y + (to.y - from.y) * fraction
        }
      }
      remaining -= length
    }
    return route[route.length - 1]!
  }

  private drawConstructionCrew(actor: AmbientActor) {
    if (!this.towers.length) return
    const tower = this.towers[Math.floor(actor.seed) % this.towers.length]!
    const route = this.constructionRoute(tower)
    const travel = actor.age / actor.duration
    const routeProgress = travel < 0.3
      ? travel / 0.3
      : travel < 0.72
        ? 1
        : 1 - (travel - 0.72) / 0.28
    const center = this.routePosition(route, routeProgress)
    const hammer = Math.abs(Math.sin(actor.age * 5))
    for (let index = 0; index < 2; index++) {
      const side = index === 0 ? -1 : 1
      const x = center.x + side * 11
      const y = center.y + 7 + index * 4
      const flee = this.evacuationOffset({ x, y }, actor, index)
      const ctx = this.ctx
      ctx.save()
      ctx.globalAlpha = clamp(Math.min(travel, 1 - travel) * 12, 0, 1) * flee.alpha
      ctx.translate(x + flee.x, y + flee.y)
      ctx.fillStyle = '#f59e0b'
      ctx.fillRect(-6, -13, 12, 15)
      ctx.fillStyle = '#d6b08a'
      ctx.beginPath()
      ctx.arc(0, -18, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fbbf24'
      ctx.fillRect(-7, -23, 14, 4)
      if (routeProgress >= 0.99) {
        ctx.save()
        ctx.translate(side * 7, -8)
        ctx.rotate(side * (-0.5 + hammer * 1.15))
        ctx.strokeStyle = '#6b4423'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(0, -14)
        ctx.stroke()
        ctx.fillStyle = '#64748b'
        ctx.fillRect(-5, -17, 10, 5)
        ctx.restore()
        if (hammer > 0.92) {
          ctx.fillStyle = '#fde68a'
          ctx.fillRect(side * 14, -14, 3, 3)
        }
      } else {
        const step = Math.sin(actor.age * 10 + index) * 3
        ctx.strokeStyle = '#4b3621'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(-3, 1)
        ctx.lineTo(-3 + step, 8)
        ctx.moveTo(3, 1)
        ctx.lineTo(3 - step, 8)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  private drawBird(actor: AmbientActor) {
    const ctx = this.ctx
    const progress = actor.age / actor.duration
    const x = -50 + progress * (WIDTH + 100)
    const y = 105 + Math.sin(progress * Math.PI * 3 + actor.seed) * 35
    const flap = Math.sin(actor.age * 11) * 9
    ctx.save()
    ctx.globalAlpha = clamp(Math.min(progress / 0.08, (1 - progress) / 0.08), 0, 1)
    ctx.translate(x, y)
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(-18, flap)
    ctx.quadraticCurveTo(-8, -8, 0, 1)
    ctx.quadraticCurveTo(8, -8, 18, flap)
    ctx.stroke()
    ctx.restore()
  }

  private drawCat(actor: AmbientActor) {
    const ctx = this.ctx
    const gate = this.castleGatePosition()
    const perch = this.ambientMeadowPoint(actor.seed, 0, actor.blockKey)
    const mouseHole = this.ambientMeadowPoint(actor.seed, 1, actor.blockKey)
    const progress = actor.age / actor.duration
    let from = gate
    let to = perch
    let travel = clamp(progress / 0.16, 0, 1)
    let moving = progress < 0.16
    let grooming = progress >= 0.2 && progress < 0.52
    if (progress >= 0.52 && progress < 0.67) {
      from = perch
      to = mouseHole
      travel = clamp((progress - 0.52) / 0.15, 0, 1)
      moving = true
      grooming = false
    } else if (progress >= 0.67 && progress < 0.88) {
      from = mouseHole
      to = mouseHole
      travel = 1
      moving = false
      grooming = progress > 0.78
    } else if (progress >= 0.88) {
      from = mouseHole
      to = gate
      travel = clamp((progress - 0.88) / 0.12, 0, 1)
      moving = true
      grooming = false
    }
    const x = from.x + (to.x - from.x) * travel
    const y = from.y + (to.y - from.y) * travel + (moving ? Math.abs(Math.sin(actor.age * 7)) * 2 : 0)
    const direction = Math.sign(to.x - from.x) || 1
    const flee = this.evacuationOffset({ x, y }, actor)
    ctx.save()
    ctx.globalAlpha = flee.alpha
    ctx.translate(x + flee.x, y + flee.y)
    ctx.scale(direction, 1)
    if (grooming) ctx.rotate(Math.sin(actor.age * 0.7) * 0.05)
    ctx.fillStyle = '#f1f5f9'
    ctx.beginPath()
    ctx.ellipse(0, 0, 10, 6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(8, -6, 5, 0, Math.PI * 2)
    ctx.moveTo(5, -10)
    ctx.lineTo(6, -17)
    ctx.lineTo(10, -11)
    ctx.moveTo(10, -11)
    ctx.lineTo(14, -17)
    ctx.lineTo(13, -9)
    ctx.fill()
    ctx.strokeStyle = '#f1f5f9'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(-8, -1)
    ctx.quadraticCurveTo(-17, -12, -12, -18)
    ctx.stroke()
    if (grooming) {
      const paw = Math.sin(actor.age * 2.2) * 2
      ctx.beginPath()
      ctx.moveTo(5, -1)
      ctx.lineTo(9 + paw, -8)
      ctx.stroke()
    }
    if (actor.age > 2.2 && actor.age < 3.5) {
      ctx.fillStyle = 'rgba(248,250,252,.92)'
      ctx.beginPath()
      ctx.roundRect(12, -35, 36, 18, 8)
      ctx.fill()
      ctx.fillStyle = '#334155'
      ctx.font = '800 9px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('MEOW', 30, -23)
    }
    ctx.restore()
  }

  private drawTile(point: GridPoint, revealed: boolean, path: boolean) {
    const ctx = this.ctx
    const screen = this.gridToScreen(point)
    const elevation = this.elevations[point.row]![point.col]!

    // Reserved roads exist in the precomputed world but their terrain blocks
    // remain entirely hidden. Drawing a hidden path cell exposed its diamond
    // edge and vertical bank beneath the mist as a rectangular road “break”.
    if (!revealed) return

    const east = point.col + 1 < COLS ? { col: point.col + 1, row: point.row } : null
    const south = point.row + 1 < ROWS ? { col: point.col, row: point.row + 1 } : null
    // Never build a slope toward hidden terrain. Exposed boundaries need one
    // clean vertical bank; using the hidden neighbour's height created stray
    // wedges and doubled corners at the edge of the revealed map.
    if (east && this.revealed.has(cellKey(east))) this.drawSlope(point, east, 'east')
    else this.drawOuterBank(screen, 'east', elevation)
    if (south && this.revealed.has(cellKey(south))) this.drawSlope(point, south, 'south')
    else this.drawOuterBank(screen, 'south', elevation)

    const shade = (point.col * 19 + point.row * 13) % 4
    const grass = elevation === 3
      ? ['#60c957', '#66d15d', '#59c252', '#6ad260'][shade]!
      : elevation === 2
        ? ['#57bd51', '#5fc558', '#51b84c', '#63c85b'][shade]!
        : ['#4eae49', '#56b650', '#49a845', '#5abb53'][shade]!
    ctx.save()
    ctx.fillStyle = grass
    this.diamondPath(screen)
    ctx.fill()
    const light = ctx.createLinearGradient(screen.x, screen.y - TILE_HEIGHT / 2, screen.x, screen.y + TILE_HEIGHT / 2)
    light.addColorStop(0, 'rgba(255,255,255,.13)')
    light.addColorStop(1, 'rgba(13,74,34,.06)')
    ctx.fillStyle = light
    this.diamondPath(screen)
    ctx.fill()
    ctx.strokeStyle = 'rgba(220,252,231,.1)'
    ctx.lineWidth = 1
    this.diamondPath(screen)
    ctx.stroke()
    this.drawGrassTexture(point, screen, path)
    ctx.restore()
  }

  private drawGroundFeatures() {
    const ctx = this.ctx
    const roadKeys = new Set(this.allRoadCells().map(cellKey))
    ctx.save()
    this.clipToRevealedTerrain()
    for (const feature of this.mapPlan.features) {
      if (!['river', 'lake', 'canyon'].includes(feature.kind)) continue
      for (const point of feature.cells) {
        if (!this.revealed.has(cellKey(point)) || roadKeys.has(cellKey(point))) continue
        const screen = this.gridToScreen(point)
        const water = feature.kind !== 'canyon'
        ctx.fillStyle = water
          ? feature.kind === 'lake' ? '#256b9c' : '#2f83b8'
          : '#60443c'
        this.diamondPath(screen, 2)
        ctx.fill()
        ctx.strokeStyle = water ? 'rgba(186,230,253,.58)' : 'rgba(30,20,18,.48)'
        ctx.lineWidth = water ? 2 : 3
        ctx.beginPath()
        ctx.moveTo(screen.x - TILE_WIDTH * 0.3, screen.y + (point.col % 2 ? 3 : -2))
        ctx.quadraticCurveTo(screen.x, screen.y - 5, screen.x + TILE_WIDTH * 0.3, screen.y + 2)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  private drawDeadEndSites(onlyVariant?: number) {
    const roadLinks: RoadLink[] = []
    const linkKeys = new Set<string>()
    const addLink = (from: GridPoint, to: GridPoint) => {
      const key = [cellKey(from), cellKey(to)].sort().join('|')
      if (linkKeys.has(key)) return
      linkKeys.add(key)
      roadLinks.push({ from, to })
    }
    for (let index = 1; index < this.path.length; index++) addLink(this.path[index - 1]!, this.path[index]!)
    for (const link of this.branchLinks) addLink(link.from, link.to)

    const degrees = new Map<string, number>()
    for (const link of roadLinks) {
      degrees.set(cellKey(link.from), (degrees.get(cellKey(link.from)) ?? 0) + 1)
      degrees.set(cellKey(link.to), (degrees.get(cellKey(link.to)) ?? 0) + 1)
    }
    const keepKey = cellKey(this.initialPath[0]!)
    const activeSources = new Set(this.pathChoices.map(choice => cellKey(choice.source)))
    const roadKeys = new Set(this.allRoadCells().map(cellKey))
    const ctx = this.ctx
    let renderedSite = false

    for (const [key, degree] of degrees) {
      if (degree !== 1 || key === keepKey || activeSources.has(key)) continue
      const [col, row] = key.split(':').map(Number)
      const endpoint = { col: col!, row: row! }
      if (!this.revealed.has(key)) continue
      const neighbours = [
        { col: endpoint.col + 1, row: endpoint.row },
        { col: endpoint.col - 1, row: endpoint.row },
        { col: endpoint.col, row: endpoint.row + 1 },
        { col: endpoint.col, row: endpoint.row - 1 }
      ].filter(point => {
        const pointKey = cellKey(point)
        return this.revealed.has(pointKey)
          && !roadKeys.has(pointKey)
          && !this.blockingFeatureAt(point)
          && !this.hasDecoration(point)
      })
      const site = neighbours[0]
      if (!site) continue
      const screen = this.gridToScreen(site)
      const variant = onlyVariant ?? (endpoint.col * 17 + endpoint.row * 11) % 4
      if (renderedSite) continue
      ctx.save()
      ctx.globalAlpha = 0.96

      if (variant === 0) {
        ctx.fillStyle = '#9a7142'
        this.diamondPath(screen, 3)
        ctx.fill()
        const roofY = screen.y - 54
        ctx.fillStyle = '#70482f'
        ctx.beginPath()
        ctx.moveTo(screen.x - 27, roofY + 13)
        ctx.lineTo(screen.x, roofY)
        ctx.lineTo(screen.x, screen.y)
        ctx.lineTo(screen.x - 27, screen.y - 11)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#8b5a38'
        ctx.beginPath()
        ctx.moveTo(screen.x, roofY)
        ctx.lineTo(screen.x + 27, roofY + 13)
        ctx.lineTo(screen.x + 27, screen.y - 11)
        ctx.lineTo(screen.x, screen.y)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#b9824c'
        ctx.beginPath()
        ctx.moveTo(screen.x - 35, roofY + 14)
        ctx.lineTo(screen.x - 8, roofY - 16)
        ctx.lineTo(screen.x + 3, roofY - 10)
        ctx.lineTo(screen.x + 16, roofY - 14)
        ctx.lineTo(screen.x + 35, roofY + 14)
        ctx.lineTo(screen.x + 28, roofY + 21)
        ctx.lineTo(screen.x + 12, roofY - 4)
        ctx.lineTo(screen.x + 2, roofY - 1)
        ctx.lineTo(screen.x - 9, roofY - 6)
        ctx.lineTo(screen.x - 28, roofY + 21)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = '#6b4228'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.strokeStyle = '#d6a15d'
        ctx.lineWidth = 1.5
        for (let index = -2; index <= 2; index++) {
          ctx.beginPath()
          ctx.moveTo(screen.x + index * 11 - 24, roofY + 11 + (index % 2) * 3)
          ctx.lineTo(screen.x + index * 10 - (index % 2) * 3, roofY - 7 - (index === 0 ? 5 : 0))
          ctx.stroke()
        }
        ctx.fillStyle = '#3b241b'
        ctx.fillRect(screen.x - 18, screen.y - 19, 10, 19)
        ctx.fillStyle = '#dbeafe'
        ctx.fillRect(screen.x - 20, screen.y - 29, 8, 10)
        ctx.strokeStyle = '#334155'
        ctx.strokeRect(screen.x - 20, screen.y - 29, 8, 10)
      } else if (variant === 1) {
        ctx.fillStyle = '#789451'
        this.diamondPath(screen, 3)
        ctx.fill()
        ctx.strokeStyle = '#d6c28b'
        ctx.lineWidth = 2
        for (const offset of [-16, 0, 16]) {
          ctx.beginPath()
          ctx.moveTo(screen.x + offset - 13, screen.y - 3)
          ctx.lineTo(screen.x + offset + 13, screen.y + 9)
          ctx.stroke()
        }
        ctx.strokeStyle = '#d6c28b'
        ctx.strokeRect(screen.x - 22, screen.y - 25, 44, 25)
        ctx.fillStyle = '#eadfc5'
        ctx.beginPath()
        ctx.ellipse(screen.x + 8, screen.y - 13, 11, 7, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#6f5948'
        ctx.beginPath()
        ctx.arc(screen.x + 18, screen.y - 14, 5, 0, Math.PI * 2)
        ctx.fill()
        const farm = neighbours[1]
        if (farm) {
          const farmScreen = this.gridToScreen(farm)
          const farmTop = farmScreen.y - 43
          ctx.fillStyle = '#70482f'
          ctx.beginPath()
          ctx.moveTo(farmScreen.x - 18, farmTop + 8)
          ctx.lineTo(farmScreen.x, farmTop)
          ctx.lineTo(farmScreen.x, farmScreen.y)
          ctx.lineTo(farmScreen.x - 18, farmScreen.y - 7)
          ctx.closePath()
          ctx.fill()
          ctx.fillStyle = '#8b5a38'
          ctx.beginPath()
          ctx.moveTo(farmScreen.x, farmTop)
          ctx.lineTo(farmScreen.x + 18, farmTop + 8)
          ctx.lineTo(farmScreen.x + 18, farmScreen.y - 7)
          ctx.lineTo(farmScreen.x, farmScreen.y)
          ctx.closePath()
          ctx.fill()
          ctx.fillStyle = '#b9824c'
          ctx.beginPath()
          ctx.moveTo(farmScreen.x - 23, farmTop + 8)
          ctx.lineTo(farmScreen.x - 3, farmTop - 10)
          ctx.lineTo(farmScreen.x + 23, farmTop + 8)
          ctx.lineTo(farmScreen.x + 17, farmTop + 14)
          ctx.lineTo(farmScreen.x - 3, farmTop - 3)
          ctx.lineTo(farmScreen.x - 17, farmTop + 14)
          ctx.closePath()
          ctx.fill()
          ctx.fillStyle = '#3b241b'
          ctx.fillRect(farmScreen.x - 13, farmScreen.y - 16, 8, 16)
          ctx.fillStyle = '#dbeafe'
          ctx.fillRect(farmScreen.x + 6, farmScreen.y - 25, 7, 8)
        }
      } else if (variant === 2) {
        ctx.fillStyle = '#7c5a3d'
        this.diamondPath(screen, 3)
        ctx.fill()
        ctx.fillStyle = '#8b5a38'
        ctx.beginPath()
        ctx.moveTo(screen.x - 16, screen.y - 5)
        ctx.lineTo(screen.x - 11, screen.y - 58)
        ctx.lineTo(screen.x + 11, screen.y - 58)
        ctx.lineTo(screen.x + 16, screen.y - 5)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#b7794b'
        ctx.beginPath()
        ctx.moveTo(screen.x - 11, screen.y - 58)
        ctx.lineTo(screen.x, screen.y - 72)
        ctx.lineTo(screen.x + 11, screen.y - 58)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#3b241b'
        ctx.fillRect(screen.x - 5, screen.y - 24, 10, 19)
        ctx.fillStyle = '#dbeafe'
        ctx.fillRect(screen.x - 8, screen.y - 49, 7, 9)
        ctx.strokeStyle = '#334155'
        ctx.strokeRect(screen.x - 8, screen.y - 49, 7, 9)
        const vaneAngle = performance.now() / 1800
        ctx.save()
        ctx.translate(screen.x, screen.y - 57)
        ctx.rotate(vaneAngle)
        ctx.strokeStyle = '#6b4228'
        ctx.lineWidth = 4
        for (let index = 0; index < 4; index++) {
          ctx.rotate(Math.PI / 2)
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.lineTo(0, -31)
          ctx.stroke()
          ctx.fillStyle = '#d9a45f'
          ctx.beginPath()
          ctx.moveTo(-3, -8)
          ctx.lineTo(3, -8)
          ctx.lineTo(8, -30)
          ctx.lineTo(-8, -30)
          ctx.closePath()
          ctx.fill()
        }
        ctx.fillStyle = '#f4c95d'
        ctx.beginPath()
        ctx.arc(0, 0, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      } else {
        ctx.fillStyle = '#6b4b3a'
        this.diamondPath(screen, 3)
        ctx.fill()
        ctx.fillStyle = '#895b43'
        ctx.beginPath()
        ctx.moveTo(screen.x - 22, screen.y - 50)
        ctx.lineTo(screen.x, screen.y - 42)
        ctx.lineTo(screen.x, screen.y)
        ctx.lineTo(screen.x - 22, screen.y - 9)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#a66f4e'
        ctx.beginPath()
        ctx.moveTo(screen.x, screen.y - 42)
        ctx.lineTo(screen.x + 22, screen.y - 50)
        ctx.lineTo(screen.x + 22, screen.y - 9)
        ctx.lineTo(screen.x, screen.y)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#dbeafe'
        ctx.fillRect(screen.x - 12, screen.y - 27, 7, 9)
        ctx.fillRect(screen.x + 5, screen.y - 27, 7, 9)
        ctx.fillRect(screen.x - 12, screen.y - 43, 7, 9)
        ctx.fillRect(screen.x + 5, screen.y - 43, 7, 9)
        ctx.fillStyle = '#e6b86a'
        ctx.beginPath()
        ctx.moveTo(screen.x - 30, screen.y - 50)
        ctx.lineTo(screen.x - 7, screen.y - 72)
        ctx.lineTo(screen.x + 4, screen.y - 67)
        ctx.lineTo(screen.x + 28, screen.y - 52)
        ctx.lineTo(screen.x + 21, screen.y - 43)
        ctx.lineTo(screen.x, screen.y - 59)
        ctx.lineTo(screen.x - 22, screen.y - 42)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#3b241b'
        ctx.fillRect(screen.x - 5, screen.y - 17, 10, 16)
        ctx.strokeStyle = '#6b4228'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(screen.x - 5, screen.y - 25)
        ctx.lineTo(screen.x - 25, screen.y - 37)
        ctx.stroke()
        ctx.fillStyle = '#f4c95d'
        ctx.beginPath()
        ctx.roundRect(screen.x - 42, screen.y - 51, 28, 15, 3)
        ctx.fill()
        ctx.strokeStyle = '#7c4a2b'
        ctx.stroke()
        ctx.fillStyle = '#5b3926'
        ctx.font = '900 8px Georgia, serif'
        ctx.textAlign = 'center'
        ctx.fillText('INN', screen.x - 28, screen.y - 40)
      }
      ctx.restore()
      renderedSite = true
    }
  }

  private drawBridgeDetails() {
    const ctx = this.ctx
    const roadKeys = new Set(this.allRoadCells().map(cellKey))
    const bridgeCells = this.mapPlan.features
      .filter(feature => feature.kind === 'bridge')
      .flatMap(feature => feature.cells)
      .filter(point => this.revealed.has(cellKey(point)) && roadKeys.has(cellKey(point)))
    if (!bridgeCells.length) return
    const bridgeKeys = new Set(bridgeCells.map(cellKey))
    const bridgeLinks = this.mapPlan.roadLinks.filter(link =>
      bridgeKeys.has(cellKey(link.from)) || bridgeKeys.has(cellKey(link.to)))
    ctx.save()
    this.clipToRevealedTerrain()
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'round'
    const strokeBridgeLinks = (color: string, width: number) => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      for (const link of bridgeLinks) {
        const from = this.gridToScreen(link.from)
        const to = this.gridToScreen(link.to)
        ctx.moveTo(from.x, from.y + 4)
        ctx.lineTo(to.x, to.y + 4)
      }
      ctx.stroke()
    }
    strokeBridgeLinks('#4b2d1b', 38)
    strokeBridgeLinks('#8a572f', 32)
    strokeBridgeLinks('#a86e3d', 25)
    for (const point of bridgeCells) {
      const screen = this.gridToScreen(point)
      const link = bridgeLinks.find(candidate =>
        cellKey(candidate.from) === cellKey(point) || cellKey(candidate.to) === cellKey(point))
      if (!link) continue
      const neighbour = cellKey(link.from) === cellKey(point) ? link.to : link.from
      const neighbourScreen = this.gridToScreen(neighbour)
      const length = Math.hypot(neighbourScreen.x - screen.x, neighbourScreen.y - screen.y) || 1
      const along = {
        x: (neighbourScreen.x - screen.x) / length,
        y: (neighbourScreen.y - screen.y) / length
      }
      const across = { x: -along.y, y: along.x }
      ctx.strokeStyle = 'rgba(62,34,18,.72)'
      ctx.lineWidth = 2.4
      for (const offset of [-18, -9, 0, 9, 18]) {
        const center = {
          x: screen.x + along.x * offset,
          y: screen.y + 4 + along.y * offset
        }
        ctx.beginPath()
        ctx.moveTo(center.x - across.x * 15, center.y - across.y * 15)
        ctx.lineTo(center.x + across.x * 15, center.y + across.y * 15)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  private drawRaisedFeature(point: GridPoint, kind: PathwardenFeatureKind) {
    const ctx = this.ctx
    const screen = this.gridToScreen(point)
    const variation = (point.col * 13 + point.row * 7) % 5
    ctx.save()
    ctx.fillStyle = 'rgba(15,23,42,.2)'
    ctx.beginPath()
    ctx.ellipse(screen.x, screen.y + 5, 30, 8, 0, 0, Math.PI * 2)
    ctx.fill()
    if (kind === 'forest') {
      const height = 42 + variation * 3
      ctx.fillStyle = '#235c38'
      ctx.fillRect(screen.x - 4, screen.y - 13, 8, 19)
      ctx.fillStyle = variation % 2 ? '#257449' : '#2f8553'
      for (const offset of [-14, 0, 14]) {
        ctx.beginPath()
        ctx.moveTo(screen.x + offset, screen.y - height)
        ctx.lineTo(screen.x + offset + 18, screen.y - 5)
        ctx.lineTo(screen.x + offset - 18, screen.y - 5)
        ctx.closePath()
        ctx.fill()
      }
    } else {
      const height = kind === 'cliff' ? 38 : 48 + variation * 4
      ctx.fillStyle = kind === 'cliff' ? '#6b625a' : '#7b807d'
      ctx.beginPath()
      ctx.moveTo(screen.x - 37, screen.y + 5)
      ctx.lineTo(screen.x - 8, screen.y - height)
      ctx.lineTo(screen.x + 5, screen.y - height * 0.55)
      ctx.lineTo(screen.x + 19, screen.y - height * 0.82)
      ctx.lineTo(screen.x + 38, screen.y + 5)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(241,245,249,.44)'
      ctx.beginPath()
      ctx.moveTo(screen.x - 8, screen.y - height)
      ctx.lineTo(screen.x + 5, screen.y - height * 0.55)
      ctx.lineTo(screen.x - 2, screen.y - height * 0.45)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  private diamondPath(screen: Point, inset = 0) {
    const halfWidth = TILE_WIDTH / 2 - inset
    const halfHeight = TILE_HEIGHT / 2 - inset * 0.54
    this.ctx.beginPath()
    this.ctx.moveTo(screen.x, screen.y - halfHeight)
    this.ctx.lineTo(screen.x + halfWidth, screen.y)
    this.ctx.lineTo(screen.x, screen.y + halfHeight)
    this.ctx.lineTo(screen.x - halfWidth, screen.y)
    this.ctx.closePath()
  }

  private drawSlope(from: GridPoint, to: GridPoint, side: 'east' | 'south') {
    const fromScreen = this.gridToScreen(from)
    const toScreen = this.gridToScreen(to)
    const fromElevation = this.elevations[from.row]![from.col]!
    const toElevation = this.elevations[to.row]![to.col]!
    if (fromElevation === toElevation) return
    const ctx = this.ctx
    const fromA = side === 'east'
      ? { x: fromScreen.x + TILE_WIDTH / 2, y: fromScreen.y }
      : { x: fromScreen.x - TILE_WIDTH / 2, y: fromScreen.y }
    const fromB = { x: fromScreen.x, y: fromScreen.y + TILE_HEIGHT / 2 }
    const toA = side === 'east'
      ? { x: toScreen.x, y: toScreen.y - TILE_HEIGHT / 2 }
      : { x: toScreen.x, y: toScreen.y - TILE_HEIGHT / 2 }
    const toB = side === 'east'
      ? { x: toScreen.x - TILE_WIDTH / 2, y: toScreen.y }
      : { x: toScreen.x + TILE_WIDTH / 2, y: toScreen.y }
    const gradient = ctx.createLinearGradient(fromScreen.x, fromScreen.y, toScreen.x, toScreen.y)
    gradient.addColorStop(0, side === 'east' ? '#2f8f43' : '#277c39')
    gradient.addColorStop(0.55, '#359b48')
    gradient.addColorStop(1, '#236b34')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(fromA.x, fromA.y)
    ctx.lineTo(fromB.x, fromB.y)
    ctx.lineTo(toB.x, toB.y)
    ctx.lineTo(toA.x, toA.y)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(35,24,18,.16)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  private drawOuterBank(screen: Point, side: 'east' | 'south', elevation: number) {
    const ctx = this.ctx
    const depth = 10 + elevation * 5
    const edgeA = side === 'east'
      ? { x: screen.x + TILE_WIDTH / 2, y: screen.y }
      : { x: screen.x - TILE_WIDTH / 2, y: screen.y }
    const edgeB = { x: screen.x, y: screen.y + TILE_HEIGHT / 2 }
    ctx.fillStyle = side === 'east' ? '#2d853f' : '#246f36'
    ctx.beginPath()
    ctx.moveTo(edgeA.x, edgeA.y)
    ctx.lineTo(edgeB.x, edgeB.y)
    ctx.lineTo(edgeB.x, edgeB.y + depth)
    ctx.lineTo(edgeA.x, edgeA.y + depth)
    ctx.closePath()
    ctx.fill()
  }

  private drawGrassTexture(point: GridPoint, screen: Point, path: boolean) {
    if (path) return
    const ctx = this.ctx
    const seed = point.col * 37 + point.row * 61
    ctx.strokeStyle = 'rgba(220,252,231,.18)'
    ctx.lineWidth = 1.2
    for (let index = 0; index < 3; index++) {
      const x = screen.x + ((seed + index * 29) % 58) - 29
      const y = screen.y + ((seed + index * 17) % 22) - 8
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.quadraticCurveTo(x + 1, y - 5, x + 4, y - 7)
      ctx.moveTo(x, y)
      ctx.quadraticCurveTo(x - 1, y - 4, x - 3, y - 5)
      ctx.stroke()
    }
  }

  private drawRoad() {
    if (this.path.length < 2) return
    const ctx = this.ctx
    const links: RoadLink[] = []
    const linkKeys = new Set<string>()
    const addLink = (link: RoadLink) => {
      const ends = [cellKey(link.from), cellKey(link.to)].sort()
      const key = `${ends[0]}|${ends[1]}`
      if (linkKeys.has(key)) return
      linkKeys.add(key)
      links.push(link)
    }
    for (let index = 1; index < this.path.length; index++) {
      addLink({ from: this.path[index - 1]!, to: this.path[index]! })
    }
    for (const link of this.branchLinks) addLink(link)
    const frontierNodes = new Set<string>()
    for (const choice of this.pathChoices) {
      const choiceLinks = choice.links ?? choice.cells.map((cell, index) => ({
        from: index === 0 ? choice.source : choice.cells[index - 1]!,
        to: cell
      }))
      for (const link of choiceLinks) {
        const fromVisible = this.revealed.has(cellKey(link.from))
        const toVisible = this.revealed.has(cellKey(link.to))
        if (!fromVisible && !toVisible) continue
        addLink(link)
        if (fromVisible !== toVisible) {
          frontierNodes.add(cellKey(fromVisible ? link.from : link.to))
        }
      }
    }
    const roadNodes = new Map<string, Point>()
    const roadNodeDegrees = new Map<string, number>()
    for (const link of links) {
      for (const point of [link.from, link.to]) {
        const key = cellKey(point)
        roadNodes.set(key, key === cellKey(this.path[0]!)
          ? this.castleGatePosition()
          : this.gridToScreen(point))
        roadNodeDegrees.set(key, (roadNodeDegrees.get(key) ?? 0) + 1)
      }
    }
    const keepKey = cellKey(this.path[0]!)
    roadNodeDegrees.set(keepKey, (roadNodeDegrees.get(keepKey) ?? 0) + 1)
    const strokeLinks = () => {
      ctx.beginPath()
      for (const link of links) {
        const from = cellKey(link.from) === cellKey(this.path[0]!)
          ? this.castleGatePosition()
          : this.gridToScreen(link.from)
        const to = this.gridToScreen(link.to)
        ctx.moveTo(from.x, from.y + 4)
        const curve = (link.from.col - link.to.col) * (link.from.row - link.to.row) === 0 ? 0 : 8
        ctx.quadraticCurveTo((from.x + to.x) / 2, (from.y + to.y) / 2 + curve, to.x, to.y + 4)
      }
      ctx.stroke()
    }
    const fillNodes = (color: string, radius: number) => {
      ctx.fillStyle = color
      ctx.beginPath()
      for (const [key, point] of roadNodes) {
        if ((roadNodeDegrees.get(key) ?? 0) < 2 || frontierNodes.has(key)) continue
        ctx.moveTo(point.x + radius, point.y + 4)
        ctx.arc(point.x, point.y + 4, radius, 0, Math.PI * 2)
      }
      ctx.fill()
    }
    ctx.save()
    this.clipToRevealedTerrain()
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(107,79,36,.28)'
    ctx.lineWidth = 38
    strokeLinks()
    fillNodes('rgba(107,79,36,.28)', 19)
    ctx.strokeStyle = '#d8b96d'
    ctx.lineWidth = 32
    strokeLinks()
    fillNodes('#d8b96d', 16)
    ctx.strokeStyle = '#fff0a6'
    ctx.lineWidth = 25
    strokeLinks()
    fillNodes('#fff0a6', 12.5)
    ctx.restore()
  }

  private drawTerminalRoadMist(links: RoadLink[], degrees: Map<string, number>) {
    const activeEnds = new Set(this.pathChoices.map((choice) => {
      const visible = choice.cells.filter(cell => this.revealed.has(cellKey(cell)))
      return cellKey(visible[visible.length - 1] ?? choice.source)
    }))
    const keepKey = cellKey(this.initialPath[0]!)
    for (const [key, degree] of degrees) {
      if (degree !== 1 || key === keepKey || activeEnds.has(key)) continue
      const link = links.find(candidate => cellKey(candidate.from) === key || cellKey(candidate.to) === key)
      if (!link) continue
      const endCell = cellKey(link.from) === key ? link.from : link.to
      const neighbourCell = cellKey(link.from) === key ? link.to : link.from
      const end = this.gridToScreen(endCell)
      const neighbour = this.gridToScreen(neighbourCell)
      const outwardCell = {
        col: endCell.col + endCell.col - neighbourCell.col,
        row: endCell.row + endCell.row - neighbourCell.row
      }
      const mouth = this.roadMouthRay(endCell, outwardCell)
      this.ctx.save()
      this.clipToRevealedTerrain()
      this.ctx.lineCap = 'butt'
      const stroke = (color: string, width: number) => {
        this.ctx.strokeStyle = color
        this.ctx.lineWidth = width
        this.ctx.beginPath()
        this.ctx.moveTo(neighbour.x, neighbour.y + 4)
        this.ctx.lineTo(end.x, end.y + 4)
        this.ctx.lineTo(mouth.outside.x, mouth.outside.y + 4)
        this.ctx.stroke()
      }
      stroke('rgba(107,79,36,.28)', 38)
      stroke('#d8b96d', 32)
      stroke('#fff0a6', 25)
      this.ctx.restore()
      this.drawRoadMouthFog(mouth.boundary)
    }
  }

  private drawFrontierRoads() {
    const ctx = this.ctx
    const drawRoadPaths = (paths: Point[][], frontierNodes: Set<string>) => {
      const drawablePaths = paths.filter(points => points.length >= 2)
      if (!drawablePaths.length) return
      const nodeDegrees = new Map<string, number>()
      const nodes = new Map<string, Point>()
      for (const points of drawablePaths) {
        for (let index = 1; index < points.length; index++) {
          const from = points[index - 1]!
          const to = points[index]!
          for (const point of [from, to]) {
            const key = `${point.x}:${point.y}`
            nodes.set(key, point)
            nodeDegrees.set(key, (nodeDegrees.get(key) ?? 0) + 1)
          }
        }
      }
      const stroke = () => {
        ctx.beginPath()
        for (const points of drawablePaths) {
          points.forEach((point, index) =>
            index === 0 ? ctx.moveTo(point.x, point.y + 4) : ctx.lineTo(point.x, point.y + 4))
        }
        ctx.stroke()
      }
      const fillJunctions = (color: string, radius: number) => {
        ctx.fillStyle = color
        ctx.beginPath()
        for (const [key, point] of nodes) {
          if ((nodeDegrees.get(key) ?? 0) < 2 || frontierNodes.has(key)) continue
          ctx.moveTo(point.x + radius, point.y + 4)
          ctx.arc(point.x, point.y + 4, radius, 0, Math.PI * 2)
        }
        ctx.fill()
      }
      ctx.save()
      this.clipToRevealedTerrain()
      ctx.lineCap = 'butt'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = 'rgba(107,79,36,.28)'
      ctx.lineWidth = 38
      stroke()
      fillJunctions('rgba(107,79,36,.28)', 19)
      ctx.strokeStyle = '#d8b96d'
      ctx.lineWidth = 32
      stroke()
      fillJunctions('#d8b96d', 16)
      ctx.strokeStyle = '#fff0a6'
      ctx.lineWidth = 25
      stroke()
      fillJunctions('#fff0a6', 12.5)
      ctx.restore()
    }

    const plannedPaths = this.pathChoices.map(section => [
      this.gridToScreen(section.source),
      ...(section.previewCells ?? section.cells).map(cell => this.gridToScreen(cell))
    ])
    const frontierNodes = new Set<string>()
    for (const section of this.pathChoices) {
      const cells = [section.source, ...(section.previewCells ?? section.cells)]
      for (let index = 1; index < cells.length; index++) {
        const from = cells[index - 1]!
        const to = cells[index]!
        const fromRevealed = this.revealed.has(cellKey(from))
        const toRevealed = this.revealed.has(cellKey(to))
        if (fromRevealed === toRevealed) continue
        const frontierCell = fromRevealed ? from : to
        const point = this.gridToScreen(frontierCell)
        frontierNodes.add(`${point.x}:${point.y}`)
      }
    }

    // Planned geometry exists beyond the frontier for pathfinding, but it is
    // never painted there. The road graph is clipped to discovered terrain and
    // the global mist softens that exact cut. Junction nodes are filled once,
    // while degree-one ends remain butt-clipped at the world border.
    drawRoadPaths(plannedPaths, frontierNodes)
  }

  private roadMouthRay(fromCell: GridPoint, towardCell: GridPoint) {
    const direction = {
      col: Math.sign(towardCell.col - fromCell.col),
      row: Math.sign(towardCell.row - fromCell.row)
    }
    let lastRevealed = { ...fromCell }
    let outside = {
      col: lastRevealed.col + direction.col,
      row: lastRevealed.row + direction.row
    }
    while (this.revealed.has(cellKey(outside))) {
      lastRevealed = outside
      outside = {
        col: lastRevealed.col + direction.col,
        row: lastRevealed.row + direction.row
      }
    }
    const lastScreen = this.gridToScreen(lastRevealed)
    const outsideScreen = outside.col >= 0 && outside.col < COLS && outside.row >= 0 && outside.row < ROWS
      ? this.gridToScreen(outside)
      : {
          x: lastScreen.x + direction.col * TILE_WIDTH / 2 - direction.row * TILE_WIDTH / 2,
          y: lastScreen.y + (direction.col + direction.row) * TILE_HEIGHT / 2
        }
    const delta = {
      x: outsideScreen.x - lastScreen.x,
      y: outsideScreen.y - lastScreen.y
    }
    const boundaryScale = 1 / (Math.abs(delta.x) / (TILE_WIDTH / 2) + Math.abs(delta.y) / (TILE_HEIGHT / 2))
    return {
      outside: outsideScreen,
      boundary: {
        x: lastScreen.x + delta.x * boundaryScale,
        y: lastScreen.y + delta.y * boundaryScale
      }
    }
  }

  private drawRoadMouthFog(boundary: Point) {
    const ctx = this.ctx
    const fog = ctx.createRadialGradient(boundary.x, boundary.y, 2, boundary.x, boundary.y, 72)
    fog.addColorStop(0, 'rgba(113,128,154,.94)')
    fog.addColorStop(0.28, 'rgba(121,137,163,.78)')
    fog.addColorStop(0.62, 'rgba(139,154,179,.35)')
    fog.addColorStop(1, 'rgba(100,116,139,0)')
    ctx.fillStyle = fog
    ctx.fillRect(boundary.x - 74, boundary.y - 74, 148, 148)
  }

  private drawActiveRoadMouthFog() {
    for (const choice of this.pathChoices) {
      const cells = [choice.source, ...choice.cells]
      const hiddenIndex = cells.findIndex(cell => !this.revealed.has(cellKey(cell)))
      if (hiddenIndex <= 0) continue
      const lastRevealed = cells[hiddenIndex - 1]!
      const firstHidden = cells[hiddenIndex]!
      this.drawRoadMouthFog(this.roadMouthRay(lastRevealed, firstHidden).boundary)
    }
  }

  private clipToRevealedTerrain() {
    const ctx = this.ctx
    ctx.beginPath()
    for (const key of this.revealed) {
      const [col, row] = key.split(':').map(Number)
      const screen = this.gridToScreen({ col: col!, row: row! })
      const halfWidth = TILE_WIDTH / 2 + 0.75
      const halfHeight = TILE_HEIGHT / 2 + 0.75
      ctx.moveTo(screen.x, screen.y - halfHeight)
      ctx.lineTo(screen.x + halfWidth, screen.y)
      ctx.lineTo(screen.x, screen.y + halfHeight)
      ctx.lineTo(screen.x - halfWidth, screen.y)
      ctx.closePath()
    }
    ctx.clip()
  }

  private extrapolatedFrontierCell(choice: PathChoice) {
    const end = choice.cells[choice.cells.length - 1] ?? choice.source
    const previous = choice.cells[choice.cells.length - 2] ?? choice.source
    return {
      col: end.col + end.col - previous.col,
      row: end.row + end.row - previous.row
    }
  }

  private mistRoadPosition() {
    const endpoint = this.path[this.path.length - 1]!
    const frontier = this.pathChoices.find(choice => cellKey(choice.source) === cellKey(endpoint))
    if (frontier) {
      const hiddenIndex = frontier.cells.findIndex(cell => !this.revealed.has(cellKey(cell)))
      const visibleCells = hiddenIndex < 0 ? frontier.cells : frontier.cells.slice(0, hiddenIndex)
      const previous = this.gridToScreen(visibleCells[visibleCells.length - 1] ?? frontier.source)
      const hiddenCell = hiddenIndex < 0
        ? this.extrapolatedFrontierCell(frontier)
        : frontier.cells[hiddenIndex]!
      const hidden = this.gridToScreen(hiddenCell)
      return {
        x: previous.x + (hidden.x - previous.x) * 0.5,
        y: previous.y + (hidden.y - previous.y) * 0.5
      }
    }
    const end = this.gridToScreen(this.path[this.path.length - 1]!)
    const previous = this.gridToScreen(this.path[this.path.length - 2]!)
    return {
      x: end.x + (end.x - previous.x) * 2.35,
      y: end.y + (end.y - previous.y) * 2.35
    }
  }

  private hasDecoration(point: GridPoint) {
    const hash = (point.col * 17 + point.row * 31) % 19
    return [11, 15].includes(hash)
      && !this.towers.some(tower => tower.col === point.col && tower.row === point.row)
  }

  private drawDecoration(point: GridPoint) {
    const hash = (point.col * 17 + point.row * 31) % 19
    const screen = this.gridToScreen(point)
    const name = hash === 11 ? 'rocks' : 'crystals'
    const image = this.assets[name]
    if (!image?.complete) return
    const sourceX = name === 'rocks' ? 41 : 44
    const sourceWidth = name === 'rocks' ? 52 : 46
    const sourceHeight = name === 'rocks' ? 70 : 76
    const width = sourceWidth * 0.55
    const height = sourceHeight * 0.55
    const ctx = this.ctx
    ctx.save()
    ctx.fillStyle = 'rgba(15,23,42,.18)'
    ctx.beginPath()
    ctx.ellipse(screen.x, screen.y + 5, width * 0.55, 6, 0, 0, Math.PI * 2)
    ctx.fill()
    // Crop away Kenney's square terrain pedestal. Decorations now sit on the
    // shared height field instead of looking like blocks stacked on blocks.
    ctx.globalAlpha = 0.88
    ctx.drawImage(image, sourceX, 0, sourceWidth, sourceHeight, screen.x - width / 2, screen.y - height + 7, width, height)
    ctx.restore()
  }

  private drawKeep() {
    const ctx = this.ctx
    const palette = this.skinPalette()
    const screen = this.gridToScreen(this.path[0]!)
    const gate = this.castleGatePosition()
    const pulse = Math.sin(performance.now() / 420) * 0.08
    const drawTower = (x: number, y: number, scale = 1) => {
      const width = 25 * scale
      const height = 37 * scale
      ctx.fillStyle = palette.mid
      ctx.fillRect(x - width / 2, y - height, width, height)
      ctx.fillStyle = palette.light
      ctx.beginPath()
      ctx.moveTo(x - width / 2, y - height)
      ctx.lineTo(x, y - height - 9 * scale)
      ctx.lineTo(x + width / 2, y - height)
      ctx.lineTo(x, y - height + 7 * scale)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = palette.trim
      for (let index = -1; index <= 1; index++) {
        ctx.fillRect(x + index * 9 * scale - 3 * scale, y - height - 8 * scale, 6 * scale, 9 * scale)
      }
      ctx.fillStyle = palette.dark
      ctx.fillRect(x - width / 2, y - 6 * scale, width / 2, 6 * scale)
    }
    ctx.save()

    ctx.translate(screen.x, screen.y)
    ctx.fillStyle = palette.dark
    ctx.beginPath()
    ctx.moveTo(-49, -55)
    ctx.lineTo(0, -31)
    ctx.lineTo(0, 0)
    ctx.lineTo(-49, -25)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = palette.mid
    ctx.beginPath()
    ctx.moveTo(0, -31)
    ctx.lineTo(49, -55)
    ctx.lineTo(49, -25)
    ctx.lineTo(0, 0)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = palette.light
    ctx.beginPath()
    ctx.moveTo(0, -82)
    ctx.lineTo(49, -55)
    ctx.lineTo(0, -31)
    ctx.lineTo(-49, -55)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = palette.trim
    for (let index = -2; index <= 2; index++) {
      ctx.fillRect(index * 18 - 4, -67 + Math.abs(index) * 5, 8, 12)
    }

    drawTower(-34, -48, 1.05)
    drawTower(34, -48, 1.05)
    drawTower(-18, -72, 0.9)
    drawTower(18, -72, 0.9)
    drawTower(0, -82, 1.15)

    // Premium liveries alter the citadel's architecture, not just its paint.
    if (this.skinId === 'ember-court') {
      ctx.fillStyle = palette.accent
      for (const x of [-31, 0, 31]) {
        ctx.beginPath()
        ctx.moveTo(x - 7, -91)
        ctx.quadraticCurveTo(x - 13, -119, x, -132)
        ctx.quadraticCurveTo(x + 15, -111, x + 7, -91)
        ctx.closePath()
        ctx.fill()
      }
    } else if (this.skinId === 'verdant-crown') {
      ctx.fillStyle = palette.dark
      for (const x of [-31, 31]) {
        ctx.beginPath()
        ctx.arc(x, -91, 18, Math.PI, 0)
        ctx.fill()
      }
      ctx.strokeStyle = palette.trim
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(-16, -95)
      ctx.quadraticCurveTo(0, -119, 16, -95)
      ctx.stroke()
    } else if (this.skinId === 'royal-amethyst') {
      ctx.fillStyle = palette.accent
      ctx.strokeStyle = palette.trim
      ctx.lineWidth = 2
      for (const [x, height] of [[-28, 31], [0, 49], [28, 35]] as const) {
        ctx.beginPath()
        ctx.moveTo(x, -88 - height)
        ctx.lineTo(x + 11, -91)
        ctx.lineTo(x, -75)
        ctx.lineTo(x - 11, -91)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    } else if (this.skinId === 'sun-king') {
      ctx.fillStyle = palette.trim
      ctx.fillRect(-38, -112, 18, 38)
      ctx.fillRect(20, -112, 18, 38)
      ctx.fillRect(-11, -135, 22, 58)
      ctx.fillStyle = palette.accent
      ctx.beginPath()
      ctx.arc(0, -139, 10, 0, Math.PI * 2)
      ctx.fill()
    }

    const localGate = { x: gate.x - screen.x, y: gate.y - screen.y }
    ctx.fillStyle = '#1e293b'
    ctx.beginPath()
    ctx.moveTo(localGate.x - 11, localGate.y + 2)
    ctx.lineTo(localGate.x - 11, localGate.y - 10)
    ctx.arc(localGate.x, localGate.y - 10, 11, Math.PI, 0)
    ctx.lineTo(localGate.x + 11, localGate.y + 2)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = '#78350f'
    ctx.fillRect(localGate.x - 7, localGate.y - 9, 14, 11)
    ctx.strokeStyle = '#d97706'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(localGate.x, localGate.y - 9)
    ctx.lineTo(localGate.x, localGate.y + 2)
    ctx.stroke()

    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, -132)
    ctx.lineTo(0, -91)
    ctx.stroke()
    ctx.fillStyle = palette.accent
    ctx.beginPath()
    ctx.moveTo(1, -130)
    ctx.lineTo(25, -121)
    ctx.lineTo(1, -112)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = `rgba(103,232,249,${0.75 + pulse})`
    ctx.beginPath()
    ctx.arc(0, -92, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    const healthRatio = clamp(this.lives / Math.max(1, this.maxLives), 0, 1)
    const barWidth = 96
    const barY = screen.y - 160
    ctx.fillStyle = 'rgba(15,23,42,.9)'
    ctx.beginPath()
    ctx.roundRect(screen.x - barWidth / 2 - 3, barY - 3, barWidth + 6, 16, 7)
    ctx.fill()
    ctx.fillStyle = healthRatio > 0.5 ? '#4ade80' : healthRatio > 0.25 ? '#fbbf24' : '#fb7185'
    ctx.beginPath()
    ctx.roundRect(screen.x - barWidth / 2, barY, barWidth * healthRatio, 10, 5)
    ctx.fill()
    ctx.fillStyle = '#f8fafc'
    ctx.font = '800 10px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`KEEP · ${Math.max(0, this.lives)}/${this.maxLives}`, screen.x, barY - 7)
  }

  private drawPathChoices() {
    if (this.phase !== 'path') return
    const ctx = this.ctx
    for (const choice of this.pathChoices.filter(choice => !choice.terminal)) {
      const screen = this.gridToScreen(choice.anchor)
      const hovered = this.hoverPathChoice === choice
      const pulse = 1 + Math.sin(performance.now() / 230 + choice.anchor.col) * 0.08
      ctx.save()
      ctx.translate(screen.x, screen.y - 8)
      ctx.scale(pulse, pulse)
      ctx.fillStyle = hovered ? 'rgba(251,191,36,.34)' : 'rgba(34,211,238,.2)'
      ctx.strokeStyle = hovered ? '#fbbf24' : '#67e8f9'
      ctx.lineWidth = hovered ? 4 : 3
      ctx.beginPath()
      ctx.moveTo(0, -TILE_HEIGHT * 0.48)
      ctx.lineTo(TILE_WIDTH * 0.42, 0)
      ctx.lineTo(0, TILE_HEIGHT * 0.48)
      ctx.lineTo(-TILE_WIDTH * 0.42, 0)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = hovered ? '#fffbeb' : '#ecfeff'
      ctx.font = '900 22px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('?', 0, 8)
      ctx.font = '700 9px sans-serif'
      ctx.fillText('REVEAL', 0, 22)
      ctx.restore()
    }
  }

  private drawTower(tower: Tower, renderPoint: GridPoint = tower) {
    const ctx = this.ctx
    const geometry = this.towerGeometry(tower, renderPoint)
    const { screen, foot, weaponPivot, width, height } = geometry
    const stats = towerStats(tower.type)
    const footY = foot.y
    const hovered = this.hoverCell?.col === renderPoint.col && this.hoverCell?.row === renderPoint.row
    ctx.save()
    if (this.towerDrag?.active && this.towerDrag.towerId === tower.id) ctx.globalAlpha = 0.82
    ctx.shadowColor = hovered ? stats.color : 'transparent'
    ctx.shadowBlur = hovered ? 9 + tower.level * 2 : 0
    this.drawTowerStructure(tower, screen.x, footY, width, height)
    const nativeFamily = !tower.relicFamily ? this.towerRelicFamily(tower) : undefined
    if (this.skinId !== 'warden-stone' || nativeFamily) {
      const palette = this.skinPalette()
      ctx.fillStyle = nativeFamily ? this.relicColor(nativeFamily) : palette.accent
      ctx.strokeStyle = palette.trim
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(screen.x - width * 0.24, footY - height * 0.72)
      ctx.lineTo(screen.x, footY - height * 0.82)
      ctx.lineTo(screen.x + width * 0.24, footY - height * 0.72)
      ctx.lineTo(screen.x, footY - height * 0.63)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    ctx.shadowBlur = 0
    this.drawTowerWeapon(tower, weaponPivot.x, weaponPivot.y)
    if (hovered) {
      ctx.strokeStyle = stats.color
      ctx.globalAlpha = 0.48
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.ellipse(screen.x, screen.y + 5, width * 0.43, 13, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    if (tower.level > 1) {
      ctx.fillStyle = '#fff'
      ctx.font = '800 10px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`★${tower.level}`, screen.x, footY - 8)
    }
    if (tower.relicFamily) {
      const relicProfile = pathwardenRelicProfile(tower.relicFamily, tower.relicPower)
      const badgeX = screen.x
      const badgeY = footY - height - 12
      const badgeRadius = 11
      const relics = this.assets.relics
      ctx.fillStyle = this.towerRelicColor(tower)
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      if (relics?.complete && relics.naturalWidth > 0) {
        const sourceWidth = relics.naturalWidth / 5
        const sourceHeight = relics.naturalHeight / 3
        const sourceCol = relicProfile.iconIndex % 5
        const sourceRow = Math.floor(relicProfile.iconIndex / 5)
        ctx.save()
        ctx.beginPath()
        ctx.arc(badgeX, badgeY, badgeRadius - 2, 0, Math.PI * 2)
        ctx.clip()
        ctx.drawImage(
          relics,
          sourceCol * sourceWidth,
          sourceRow * sourceHeight,
          sourceWidth,
          sourceHeight,
          badgeX - 9,
          badgeY - 9,
          18,
          18
        )
        ctx.restore()
      } else {
        ctx.fillStyle = '#0f172a'
        ctx.font = '900 12px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('✦', badgeX, badgeY + 4)
      }
      if (tower.relicStacks > 1) {
        ctx.fillStyle = '#0f172a'
        ctx.strokeStyle = '#f8fafc'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(badgeX + 8, badgeY + 8, 6, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#f8fafc'
        ctx.font = '900 7px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(`${tower.relicStacks}`, badgeX + 8, badgeY + 10)
      }
    }
    ctx.restore()
  }

  private drawFailedPlacement(failed: FailedPlacement) {
    const ctx = this.ctx
    const screen = this.gridToScreen(failed.cell)
    const progress = 1 - failed.life / failed.maxLife
    const fade = clamp(failed.life * 2.8, 0, 0.78)
    const shakeX = Math.sin(progress * Math.PI * 18) * (8 * (1 - progress))
    const shakeY = Math.sin(progress * Math.PI * 11) * 2
    const height = failed.type === 'frost' ? 84 : 68
    const width = failed.type === 'mortar' ? 72 : 62

    ctx.save()
    ctx.translate(screen.x + shakeX, screen.y + shakeY)
    ctx.globalAlpha = fade
    ctx.fillStyle = '#ef4444'
    ctx.strokeStyle = '#fecaca'
    ctx.lineWidth = 3
    ctx.shadowColor = '#ef4444'
    ctx.shadowBlur = 18
    ctx.beginPath()
    ctx.moveTo(-width / 2, -12)
    ctx.lineTo(0, 5)
    ctx.lineTo(width / 2, -12)
    ctx.lineTo(width / 2, -height + 16)
    ctx.lineTo(0, -height)
    ctx.lineTo(-width / 2, -height + 16)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#7f1d1d'
    ctx.beginPath()
    ctx.arc(0, -height + 7, failed.type === 'mortar' ? 17 : 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#fff1f2'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(-10, -height - 3)
    ctx.lineTo(10, -height + 17)
    ctx.moveTo(10, -height - 3)
    ctx.lineTo(-10, -height + 17)
    ctx.stroke()
    ctx.restore()
  }

  private drawPlacementPreview(point: GridPoint) {
    const ctx = this.ctx
    const preview: Tower = {
      id: -1,
      ...point,
      type: this.selectedTower,
      invested: 0,
      cooldown: 0,
      angle: -Math.PI / 2,
      level: 1,
      merges: 0,
      recoil: 0,
      targeting: 'first',
      relicStacks: 0,
      relicPower: 0,
      relicShots: 0
    }
    const geometry = this.towerGeometry(preview)
    const allowed = this.placementStatus(point).allowed
    const cost = this.towerCost(preview.type)
    const affordable = this.aether >= cost
    const color = allowed && affordable ? '#facc15' : '#fb7185'

    ctx.save()
    ctx.globalAlpha = 0.46
    ctx.shadowColor = color
    ctx.shadowBlur = 18
    this.drawTowerStructure(preview, geometry.screen.x, geometry.foot.y, geometry.width, geometry.height)
    ctx.shadowBlur = 0
    this.drawTowerWeapon(preview, geometry.weaponPivot.x, geometry.weaponPivot.y)
    ctx.restore()

    ctx.save()
    const label = `${cost} AETHER`
    const labelY = geometry.foot.y - geometry.height - 15
    ctx.font = '900 12px sans-serif'
    ctx.textAlign = 'center'
    const labelWidth = ctx.measureText(label).width + 18
    ctx.fillStyle = 'rgba(15,23,42,.88)'
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(geometry.screen.x - labelWidth / 2, labelY - 15, labelWidth, 22, 7)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = color
    ctx.fillText(label, geometry.screen.x, labelY)
    ctx.restore()
  }

  private drawTowerStructure(tower: Tower, x: number, footY: number, width: number, height: number) {
    const ctx = this.ctx
    const blueprint = this.towerBlueprint(tower.type)
    const skin = this.skinPalette()
    const accent = blueprint.color
    const tier = blueprint.tier
    const left = colorMix(skin.dark, accent, 0.18)
    const right = colorMix(skin.mid, accent, 0.22)
    const top = colorMix(skin.light, accent, 0.3)
    const trim = this.skinId === 'warden-stone' ? skin.trim : colorMix(skin.trim, accent, 0.16)
    const bodyBottom = footY
    const bodyTop = footY - height * (0.56 + tier * 0.035)
    const half = width * (0.34 + Math.min(3, tier) * 0.018)

    const prism = (centerX: number, topY: number, bottomY: number, radius: number) => {
      ctx.fillStyle = left
      ctx.beginPath()
      ctx.moveTo(centerX - radius, topY)
      ctx.lineTo(centerX, topY + radius * 0.42)
      ctx.lineTo(centerX, bottomY)
      ctx.lineTo(centerX - radius, bottomY - radius * 0.42)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = right
      ctx.beginPath()
      ctx.moveTo(centerX + radius, topY)
      ctx.lineTo(centerX, topY + radius * 0.42)
      ctx.lineTo(centerX, bottomY)
      ctx.lineTo(centerX + radius, bottomY - radius * 0.42)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = top
      ctx.beginPath()
      ctx.moveTo(centerX, topY - radius * 0.42)
      ctx.lineTo(centerX + radius, topY)
      ctx.lineTo(centerX, topY + radius * 0.42)
      ctx.lineTo(centerX - radius, topY)
      ctx.closePath()
      ctx.fill()
    }

    ctx.save()
    if (blueprint.family === 'star') {
      prism(x, bodyTop, bodyBottom, half)
      ctx.fillStyle = trim
      for (let index = -tier; index <= tier; index++) {
        const bx = x + index * (half * 1.6 / Math.max(2, tier * 2))
        ctx.fillRect(bx - 3, bodyTop - 10 + Math.abs(index) * 2, 6, 12)
      }
      if (tier >= 3) {
        prism(x - half * 0.82, bodyTop + 17, bodyBottom - 3, half * 0.28)
        prism(x + half * 0.82, bodyTop + 17, bodyBottom - 3, half * 0.28)
      }
    } else if (blueprint.family === 'sun') {
      ctx.fillStyle = left
      ctx.beginPath()
      ctx.ellipse(x, bodyBottom - 13, half, 15, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillRect(x - half, bodyTop + 8, half * 2, bodyBottom - bodyTop - 21)
      ctx.fillStyle = right
      ctx.beginPath()
      ctx.ellipse(x, bodyTop + 8, half, 15, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = trim
      ctx.lineWidth = 4
      for (let ring = 0; ring < tier; ring++) {
        const y = bodyBottom - 18 - ring * ((bodyBottom - bodyTop - 25) / Math.max(1, tier))
        ctx.beginPath()
        ctx.ellipse(x, y, half, 10, 0, 0, Math.PI)
        ctx.stroke()
      }
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.arc(x, bodyTop - 2, 10 + tier * 2, 0, Math.PI * 2)
      ctx.fill()
    } else if (blueprint.family === 'winter') {
      ctx.fillStyle = left
      ctx.beginPath()
      ctx.moveTo(x - half * 0.75, bodyBottom)
      ctx.lineTo(x - half * 0.45, bodyTop + 25)
      ctx.lineTo(x, bodyTop - 22 - tier * 5)
      ctx.lineTo(x + half * 0.52, bodyTop + 23)
      ctx.lineTo(x + half * 0.78, bodyBottom)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = top
      for (let shard = 0; shard < tier + 2; shard++) {
        const sx = x + (shard - (tier + 1) / 2) * 10
        const sy = bodyTop + 12 - (shard % 2) * 10
        ctx.beginPath()
        ctx.moveTo(sx, sy - 20 - tier * 2)
        ctx.lineTo(sx + 7, sy + 7)
        ctx.lineTo(sx - 6, sy + 12)
        ctx.closePath()
        ctx.fill()
      }
    } else if (blueprint.family === 'ember') {
      prism(x, bodyTop + 7, bodyBottom, half)
      ctx.fillStyle = '#1c1917'
      ctx.beginPath()
      ctx.arc(x, bodyBottom - 17, 10 + tier, Math.PI, 0)
      ctx.lineTo(x + 10 + tier, bodyBottom - 4)
      ctx.lineTo(x - 10 - tier, bodyBottom - 4)
      ctx.closePath()
      ctx.fill()
      for (let stack = 0; stack < Math.min(3, tier); stack++) {
        const sx = x + (stack - 1) * half * 0.68
        ctx.fillStyle = skin.dark
        ctx.fillRect(sx - 6, bodyTop - 17 - stack * 3, 12, 30)
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.moveTo(sx - 5, bodyTop - 19 - stack * 3)
        ctx.quadraticCurveTo(sx, bodyTop - 36 - tier * 2, sx + 5, bodyTop - 19 - stack * 3)
        ctx.fill()
      }
    } else if (blueprint.family === 'storm') {
      ctx.fillStyle = left
      ctx.beginPath()
      ctx.moveTo(x - half * 0.62, bodyBottom)
      ctx.lineTo(x - half * 0.38, bodyTop + 5)
      ctx.lineTo(x - 8, bodyTop - 18 - tier * 4)
      ctx.lineTo(x, bodyTop + 3)
      ctx.lineTo(x + 10, bodyTop - 25 - tier * 5)
      ctx.lineTo(x + half * 0.42, bodyTop + 7)
      ctx.lineTo(x + half * 0.65, bodyBottom)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = accent
      ctx.lineWidth = 3 + tier
      ctx.beginPath()
      ctx.moveTo(x - 6, bodyBottom - 8)
      ctx.lineTo(x + 8, bodyTop + 32)
      ctx.lineTo(x - 5, bodyTop + 17)
      ctx.lineTo(x + 8, bodyTop - 9)
      ctx.stroke()
    } else if (blueprint.family === 'dawn') {
      prism(x, bodyTop + 18, bodyBottom, half)
      ctx.fillStyle = top
      ctx.beginPath()
      ctx.arc(x, bodyTop + 18, half * 0.72, Math.PI, 0)
      ctx.fill()
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.arc(x, bodyTop - tier * 4, 8 + tier * 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = trim
      ctx.lineWidth = 3
      for (let ray = 0; ray < tier + 3; ray++) {
        const angle = ray / (tier + 3) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(x + Math.cos(angle) * 12, bodyTop - tier * 4 + Math.sin(angle) * 12)
        ctx.lineTo(x + Math.cos(angle) * (19 + tier * 2), bodyTop - tier * 4 + Math.sin(angle) * (19 + tier * 2))
        ctx.stroke()
      }
    } else if (blueprint.family === 'venom') {
      ctx.strokeStyle = left
      ctx.lineCap = 'round'
      ctx.lineWidth = 17 + tier * 2
      ctx.beginPath()
      ctx.moveTo(x, bodyBottom)
      ctx.bezierCurveTo(x - 18, bodyBottom - 28, x + 20, bodyTop + 31, x - 3, bodyTop)
      ctx.stroke()
      ctx.fillStyle = right
      for (let branch = 0; branch < tier + 3; branch++) {
        const angle = branch / (tier + 3) * Math.PI * 2
        ctx.beginPath()
        ctx.ellipse(x + Math.cos(angle) * (20 + tier * 2), bodyTop + 5 + Math.sin(angle) * 14, 13, 7, angle, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.arc(x, bodyTop + 3, 11 + tier, 0, Math.PI * 2)
      ctx.fill()
    } else if (blueprint.family === 'gale') {
      ctx.fillStyle = left
      ctx.beginPath()
      ctx.moveTo(x - half * 0.72, bodyBottom)
      ctx.lineTo(x - half * 0.42, bodyTop)
      ctx.lineTo(x + half * 0.42, bodyTop)
      ctx.lineTo(x + half * 0.72, bodyBottom)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = trim
      ctx.fillRect(x - 5, bodyTop - 8, 10, 34)
      ctx.save()
      ctx.translate(x, bodyTop + 5)
      ctx.rotate(performance.now() / (1050 - tier * 80))
      for (let blade = 0; blade < 4 + (tier >= 4 ? 2 : 0); blade++) {
        ctx.rotate(Math.PI * 2 / (4 + (tier >= 4 ? 2 : 0)))
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.moveTo(3, -4)
        ctx.lineTo(28 + tier * 4, -8)
        ctx.lineTo(35 + tier * 4, 3)
        ctx.lineTo(3, 4)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
    } else if (blueprint.family === 'prism') {
      ctx.fillStyle = left
      ctx.beginPath()
      ctx.moveTo(x, bodyTop - 30 - tier * 5)
      ctx.lineTo(x + half, bodyTop + 20)
      ctx.lineTo(x + half * 0.6, bodyBottom)
      ctx.lineTo(x - half * 0.6, bodyBottom)
      ctx.lineTo(x - half, bodyTop + 20)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = top
      ctx.beginPath()
      ctx.moveTo(x, bodyTop - 30 - tier * 5)
      ctx.lineTo(x + half, bodyTop + 20)
      ctx.lineTo(x, bodyTop + 9)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = trim
      ctx.lineWidth = 2
      for (let facet = 1; facet < tier; facet++) {
        ctx.beginPath()
        ctx.moveTo(x - half + facet * (half * 2 / tier), bodyTop + 20)
        ctx.lineTo(x, bodyBottom)
        ctx.stroke()
      }
    } else {
      const squatTop = bodyTop + 22
      prism(x, squatTop, bodyBottom, half * 1.18)
      ctx.fillStyle = skin.dark
      ctx.fillRect(x - half, squatTop - 17, half * 2, 20)
      ctx.fillStyle = trim
      const crenels = tier + 3
      for (let index = 0; index < crenels; index++) {
        ctx.fillRect(x - half + index * (half * 2 / (crenels - 1)) - 4, squatTop - 25, 8, 11)
      }
      if (tier >= 3) {
        prism(x - half * 0.85, squatTop + 15, bodyBottom, half * 0.34)
        prism(x + half * 0.85, squatTop + 15, bodyBottom, half * 0.34)
      }
    }

    // Every tier receives a different footprint and heraldic count.
    ctx.fillStyle = accent
    for (let badge = 0; badge < tier; badge++) {
      const bx = x + (badge - (tier - 1) / 2) * 10
      ctx.beginPath()
      ctx.arc(bx, bodyBottom - 10, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    if (tier >= 2) {
      ctx.strokeStyle = trim
      ctx.lineWidth = 2
      for (const side of [-1, 1]) {
        const flagX = x + side * half * 0.72
        ctx.beginPath()
        ctx.moveTo(flagX, bodyTop + 13)
        ctx.lineTo(flagX, bodyTop - 10 - tier * 2)
        ctx.stroke()
        ctx.fillStyle = side < 0 ? accent : skin.accent
        ctx.beginPath()
        ctx.moveTo(flagX, bodyTop - 10 - tier * 2)
        ctx.lineTo(flagX + side * (10 + tier * 2), bodyTop - 5 - tier * 2)
        ctx.lineTo(flagX, bodyTop + 1 - tier * 2)
        ctx.closePath()
        ctx.fill()
      }
    }
    if (tier >= 3 && !['star', 'siege'].includes(blueprint.family)) {
      prism(x - half * 0.82, bodyTop + 32, bodyBottom - 1, half * 0.2)
      prism(x + half * 0.82, bodyTop + 32, bodyBottom - 1, half * 0.2)
    }
    if (tier >= 4) {
      ctx.strokeStyle = accent
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.ellipse(x, bodyTop + 14, half * 1.04, 13, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (tier === 5) {
      ctx.fillStyle = trim
      ctx.beginPath()
      ctx.moveTo(x, bodyTop - 33)
      ctx.lineTo(x + 8, bodyTop - 17)
      ctx.lineTo(x + 25, bodyTop - 14)
      ctx.lineTo(x + 12, bodyTop - 2)
      ctx.lineTo(x + 15, bodyTop + 15)
      ctx.lineTo(x, bodyTop + 7)
      ctx.lineTo(x - 15, bodyTop + 15)
      ctx.lineTo(x - 12, bodyTop - 2)
      ctx.lineTo(x - 25, bodyTop - 14)
      ctx.lineTo(x - 8, bodyTop - 17)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  private drawTowerWeapon(tower: Tower, x: number, y: number) {
    const ctx = this.ctx
    const archetype = this.towerArchetype(tower.type)
    const blueprint = this.towerBlueprint(tower.type)
    const palette = this.skinPalette()
    const metal = this.skinId === 'warden-stone' ? '#64748b' : colorMix(palette.mid, blueprint.color, 0.28)
    const weaponAccent = this.skinId === 'warden-stone' ? blueprint.color : colorMix(palette.accent, blueprint.color, 0.4)
    const kick = tower.recoil * 6
    const screenAngle = this.towerScreenAngle(tower)
    const planeScale = 0.58
    const planeAngle = Math.atan2(Math.sin(screenAngle) / planeScale, Math.cos(screenAngle))
    ctx.save()
    ctx.translate(x, y)
    if (archetype === 'bolt') {
      ctx.fillStyle = '#334155'
      ctx.beginPath()
      ctx.ellipse(0, 5, 17, 8, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = metal
      ctx.beginPath()
      ctx.ellipse(0, 2, 15, 7, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.scale(1, planeScale)
      ctx.rotate(planeAngle)
      ctx.translate(-kick, 0)
      ctx.strokeStyle = '#3f2d22'
      ctx.lineWidth = 7
      ctx.beginPath()
      ctx.moveTo(-13, 3)
      ctx.lineTo(19, 3)
      ctx.stroke()
      ctx.strokeStyle = palette.trim
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(-8, -10)
      ctx.quadraticCurveTo(-18, 3, -8, 16)
      ctx.moveTo(8, -10)
      ctx.quadraticCurveTo(18, 3, 8, 16)
      ctx.stroke()
      ctx.strokeStyle = '#f8fafc'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(-8, -10)
      ctx.lineTo(-2, 3)
      ctx.lineTo(-8, 16)
      ctx.moveTo(8, -10)
      ctx.lineTo(2, 3)
      ctx.lineTo(8, 16)
      ctx.stroke()
      ctx.fillStyle = '#e2e8f0'
      ctx.fillRect(-3, 1, 28, 3)
      ctx.fillStyle = weaponAccent
      ctx.beginPath()
      ctx.moveTo(28, 2.5)
      ctx.lineTo(20, -2)
      ctx.lineTo(20, 7)
      ctx.closePath()
      ctx.fill()
    } else if (archetype === 'mortar') {
      // A centered, raised turntable. The barrel is drawn directly in screen
      // space so its elevation remains visible instead of being flattened into
      // the isometric roof plane.
      ctx.fillStyle = '#334155'
      ctx.beginPath()
      ctx.ellipse(0, 7, 19, 9, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = metal
      ctx.fillRect(-16, -2, 32, 9)
      ctx.beginPath()
      ctx.ellipse(0, -2, 16, 7, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.ellipse(0, -3, 13, 5.5, 0, 0, Math.PI * 2)
      ctx.stroke()

      const direction = { x: Math.cos(screenAngle), y: Math.sin(screenAngle) }
      const normal = { x: -direction.y, y: direction.x }
      const recoil = kick * 0.65
      const breech = {
        x: -direction.x * (9 + recoil),
        y: -direction.y * (9 + recoil) + 1
      }
      const muzzle = {
        x: direction.x * (27 - recoil),
        y: direction.y * (27 - recoil) - 13
      }

      // Raised trunnions make the mounting point readable from every angle.
      for (const side of [-1, 1]) {
        const supportX = normal.x * side * 8
        const supportY = normal.y * side * 5 - 5
        ctx.fillStyle = palette.dark
        ctx.beginPath()
        ctx.ellipse(supportX, supportY, 5, 7, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = weaponAccent
        ctx.beginPath()
        ctx.ellipse(supportX, supportY - 2, 3, 4, 0, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.lineCap = 'round'
      ctx.strokeStyle = '#1e293b'
      ctx.lineWidth = 13
      ctx.beginPath()
      ctx.moveTo(breech.x, breech.y)
      ctx.lineTo(muzzle.x, muzzle.y)
      ctx.stroke()
      ctx.strokeStyle = metal
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.moveTo(breech.x, breech.y - 2)
      ctx.lineTo(muzzle.x, muzzle.y - 2)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(226,232,240,.55)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(breech.x + normal.x * 2, breech.y + normal.y * 2 - 4)
      ctx.lineTo(muzzle.x + normal.x * 2, muzzle.y + normal.y * 2 - 4)
      ctx.stroke()

      ctx.save()
      ctx.translate(muzzle.x, muzzle.y)
      ctx.rotate(screenAngle)
      ctx.fillStyle = '#1e293b'
      ctx.beginPath()
      ctx.ellipse(0, 0, 4, 7, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#020617'
      ctx.beginPath()
      ctx.ellipse(1, 0, 2.2, 4.5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    } else {
      const pulse = 1 + Math.sin(performance.now() / 180 + tower.id) * 0.08
      ctx.scale(pulse, pulse)
      ctx.fillStyle = colorMix(blueprint.color, palette.light, 0.3)
      ctx.beginPath()
      ctx.moveTo(0, -20)
      ctx.lineTo(10, -2)
      ctx.lineTo(4, 13)
      ctx.lineTo(-8, 8)
      ctx.lineTo(-11, -5)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = weaponAccent
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawTowerRangePreview() {
    if (this.phase !== 'planning') return
    const selectedTower = this.towers.find(tower => tower.id === this.selectedTowerId)
    if (selectedTower) {
      const renderPoint = this.towerDrag?.active && this.towerDrag.towerId === selectedTower.id && this.hoverCell
        ? this.hoverCell
        : selectedTower
      this.drawTowerRange(selectedTower.type, renderPoint, selectedTower.level)
      return
    }
    if (!this.hoverCell || !this.revealed.has(cellKey(this.hoverCell))) return
    this.drawTowerRange(this.selectedTower, this.hoverCell, 1)
  }

  private drawTowerRange(type: PathwardenTowerType, point: GridPoint, level: number) {
    const ctx = this.ctx
    const screen = this.gridToScreen(point)
    const elevation = this.elevations[point.row]![point.col]!
    const range = towerStats(type).range
      * this.rangeMultiplier
      * (1 + (elevation - 1) * 0.09)
      * (1 + (level - 1) * 0.05)
    const radiusCells = range / WORLD_CELL
    const radiusX = radiusCells * TILE_WIDTH * 0.52
    const radiusY = radiusCells * TILE_HEIGHT * 0.52
    const pulse = 0.98 + Math.sin(performance.now() / 460) * 0.02

    ctx.save()
    ctx.translate(screen.x, screen.y + 2)
    ctx.scale(radiusX * pulse, radiusY * pulse)
    const glow = ctx.createRadialGradient(0, 0, 0.05, 0, 0, 1)
    glow.addColorStop(0, 'rgba(250,204,21,.2)')
    glow.addColorStop(0.58, 'rgba(250,204,21,.11)')
    glow.addColorStop(0.86, 'rgba(250,204,21,.05)')
    glow.addColorStop(1, 'rgba(250,204,21,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(0, 0, 1, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(250,204,21,.82)'
    ctx.lineWidth = 1.8 / Math.max(radiusX, radiusY)
    ctx.setLineDash([0.035, 0.025])
    ctx.beginPath()
    ctx.arc(0, 0, 0.92, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  private towerGeometry(tower: Tower, renderPoint: GridPoint = tower): TowerGeometry {
    const screen = this.gridToScreen(renderPoint)
    const blueprint = this.towerBlueprint(tower.type)
    const archetype = this.towerArchetype(tower.type)
    const familyWidth: Partial<Record<typeof blueprint.family, number>> = {
      star: 74,
      sun: 82,
      winter: 68,
      ember: 78,
      storm: 66,
      dawn: 80,
      venom: 76,
      gale: 82,
      prism: 66,
      siege: 88
    }
    const width = (familyWidth[blueprint.family] ?? 74) + blueprint.tier * 2
    const height = (blueprint.family === 'winter' || blueprint.family === 'storm' || blueprint.family === 'prism'
      ? 96
      : blueprint.family === 'siege' || blueprint.family === 'sun'
        ? 74
        : 84) + blueprint.tier * 4
    const foot = { x: screen.x, y: screen.y + 10 }
    const weaponPivot = {
      x: screen.x,
      y: archetype === 'mortar' ? foot.y - height * 0.7 : foot.y - height * 0.63
    }
    const screenAngle = this.towerScreenAngle(tower)
    const recoil = tower.recoil * 6 * 0.65
    const muzzle = archetype === 'mortar'
      ? {
          x: weaponPivot.x + Math.cos(screenAngle) * (27 - recoil),
          y: weaponPivot.y + Math.sin(screenAngle) * (27 - recoil) - 13
        }
      : {
          x: weaponPivot.x + Math.cos(screenAngle) * 28,
          y: weaponPivot.y + Math.sin(screenAngle) * 28 * 0.58
        }
    return { screen, foot, weaponPivot, muzzle, width, height }
  }

  private drawVisualGuides() {
    const ctx = this.ctx
    ctx.save()
    ctx.lineWidth = 1.5
    ctx.font = '700 9px monospace'
    ctx.textAlign = 'left'
    for (const tower of this.towers) {
      const geometry = this.towerGeometry(tower)
      ctx.strokeStyle = '#22d3ee'
      ctx.strokeRect(
        geometry.screen.x - geometry.width / 2,
        geometry.foot.y - geometry.height,
        geometry.width,
        geometry.height
      )
      ctx.beginPath()
      ctx.moveTo(geometry.screen.x, geometry.screen.y - 12)
      ctx.lineTo(geometry.screen.x, geometry.weaponPivot.y)
      ctx.stroke()
      for (const [point, color] of [
        [geometry.screen, '#22d3ee'],
        [geometry.foot, '#fbbf24'],
        [geometry.weaponPivot, '#a78bfa'],
        [geometry.muzzle, '#fb7185']
      ] as Array<[Point, string]>) {
        ctx.strokeStyle = color
        ctx.beginPath()
        ctx.moveTo(point.x - 5, point.y)
        ctx.lineTo(point.x + 5, point.y)
        ctx.moveTo(point.x, point.y - 5)
        ctx.lineTo(point.x, point.y + 5)
        ctx.stroke()
      }
      ctx.fillStyle = '#0f172a'
      ctx.fillText(`T${tower.id}`, geometry.foot.x + 7, geometry.foot.y + 3)
    }
    for (const section of this.plannedSections) {
      ctx.strokeStyle = this.claimedSections.has(section)
        ? '#4ade80'
        : this.pathChoices.includes(section) ? '#fbbf24' : '#38bdf8'
      ctx.setLineDash(this.claimedSections.has(section) ? [] : [4, 3])
      ctx.beginPath()
      const points = [section.source, ...section.cells].map(point => this.gridToScreen(point))
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y))
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(251,146,60,.14)'
    ctx.strokeStyle = 'rgba(251,146,60,.8)'
    ctx.setLineDash([2, 3])
    for (const point of this.futureExitClearanceCells()) {
      const screen = this.gridToScreen(point)
      ctx.beginPath()
      ctx.moveTo(screen.x, screen.y - TILE_HEIGHT / 2)
      ctx.lineTo(screen.x + TILE_WIDTH / 2, screen.y)
      ctx.lineTo(screen.x, screen.y + TILE_HEIGHT / 2)
      ctx.lineTo(screen.x - TILE_WIDTH / 2, screen.y)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    ctx.setLineDash([])
    for (const projectile of this.projectiles.filter(projectile => this.towerArchetype(projectile.type) === 'mortar')) {
      const target = this.enemies.find(enemy => enemy.id === projectile.targetId)
      if (!target) continue
      const targetPosition = this.enemyScreenPosition(target)
      ctx.strokeStyle = '#fb7185'
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      for (let step = 0; step <= 24; step++) {
        const progress = step / 24
        const x = projectile.origin.x + (targetPosition.x - projectile.origin.x) * progress
        const y = projectile.origin.y + (targetPosition.y - projectile.origin.y) * progress
          - Math.sin(Math.PI * progress) * projectile.arcHeight
        if (step) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      }
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.restore()
  }

  private drawEnemy(enemy: Enemy) {
    const ctx = this.ctx
    const position = this.enemyScreenPosition(enemy)
    const attacking = enemy.progress >= enemy.route.length - 1
    const walk = performance.now() / (attacking ? 62 : enemy.type === 'runner' ? 85 : 130) + enemy.id
    const bob = attacking ? Math.sin(walk) * 1.5 : Math.abs(Math.sin(walk)) * 3
    const stride = attacking ? 0 : Math.sin(walk) * Math.min(7, enemy.radius * 0.42)
    const scale = enemy.radius / 14
    ctx.save()
    ctx.globalAlpha = this.enemyMistOpacity(enemy)
    ctx.translate(position.x, position.y + bob)
    ctx.scale(scale, scale)
    ctx.fillStyle = 'rgba(15,23,42,.35)'
    ctx.beginPath()
    ctx.ellipse(0, 12, 13, 5, 0, 0, Math.PI * 2)
    ctx.fill()

    const armor = enemy.hitFlash > 0 ? '#fff' : enemy.color
    ctx.lineCap = 'round'
    ctx.strokeStyle = enemy.type === 'shaman' ? '#713f12' : '#3f2d28'
    ctx.lineWidth = enemy.type === 'boss' ? 6 : 4
    ctx.beginPath()
    ctx.moveTo(-4, 5)
    ctx.lineTo(-5 + stride, 13)
    ctx.moveTo(4, 5)
    ctx.lineTo(5 - stride, 13)
    ctx.stroke()
    ctx.strokeStyle = armor
    ctx.beginPath()
    ctx.moveTo(-6, -3)
    ctx.lineTo(-10 - stride * 0.45, 5)
    ctx.moveTo(6, -3)
    ctx.lineTo(10 + stride * 0.45, 5)
    ctx.stroke()
    ctx.fillStyle = armor
    ctx.beginPath()
    ctx.moveTo(-8, -7)
    ctx.lineTo(8, -7)
    ctx.lineTo(6, 7)
    ctx.lineTo(-6, 7)
    ctx.closePath()
    ctx.fill()
    if (enemy.type === 'runner') {
      ctx.fillStyle = '#a78bfa'
      ctx.beginPath()
      ctx.moveTo(-6, -6)
      ctx.quadraticCurveTo(-20 - stride, -4, -24 - stride, 5)
      ctx.lineTo(-15 - stride, 2)
      ctx.lineTo(-4, 1)
      ctx.closePath()
      ctx.fill()
    } else if (enemy.type === 'brute') {
      ctx.fillStyle = '#475569'
      ctx.beginPath()
      ctx.arc(-8, -5, 6, 0, Math.PI * 2)
      ctx.arc(8, -5, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#991b1b'
      ctx.beginPath()
      ctx.arc(-12, 1, 10, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#fca5a5'
      ctx.lineWidth = 2
      ctx.stroke()
    } else if (enemy.type === 'shaman') {
      const glow = 0.5 + Math.sin(performance.now() / 180 + enemy.id) * 0.25
      ctx.fillStyle = `rgba(134,239,172,${glow})`
      for (let index = 0; index < 3; index++) {
        const angle = performance.now() / 500 + index * Math.PI * 2 / 3 + enemy.id
        ctx.beginPath()
        ctx.arc(Math.cos(angle) * 15, -5 + Math.sin(angle) * 9, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (enemy.type === 'boss') {
      ctx.fillStyle = '#facc15'
      ctx.fillRect(-9, -5, 18, 4)
      ctx.fillStyle = '#7f1d1d'
      ctx.beginPath()
      ctx.moveTo(-8, -7)
      ctx.lineTo(-17, -2)
      ctx.lineTo(-13, 8)
      ctx.lineTo(-6, 4)
      ctx.closePath()
      ctx.moveTo(8, -7)
      ctx.lineTo(17, -2)
      ctx.lineTo(13, 8)
      ctx.lineTo(6, 4)
      ctx.closePath()
      ctx.fill()
    } else {
      ctx.fillStyle = '#fbbf24'
      ctx.fillRect(-7, 1, 14, 3)
    }
    ctx.fillStyle = enemy.type === 'shaman' ? '#bbf7d0' : '#d6b08a'
    ctx.beginPath()
    ctx.arc(0, -13, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = enemy.type === 'runner' ? '#ddd6fe' : enemy.type === 'brute' ? '#7f1d1d' : '#334155'
    ctx.beginPath()
    ctx.moveTo(-8, -15)
    ctx.lineTo(0, -23)
    ctx.lineTo(8, -15)
    ctx.lineTo(6, -9)
    ctx.lineTo(-6, -9)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(-3.5, -14, 2, 2)
    ctx.fillRect(1.5, -14, 2, 2)
    this.drawEnemyWeapon(enemy, walk)
    if (enemy.type === 'shaman') {
      ctx.strokeStyle = '#dcfce7'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(0, -4, 17, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (enemy.type === 'boss') {
      ctx.fillStyle = '#fef08a'
      ctx.font = '900 16px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('♛', 0, -25)
    }
    ctx.restore()

    if (enemy.hp < enemy.maxHp || enemy.type === 'boss') {
      ctx.save()
      ctx.globalAlpha = this.enemyMistOpacity(enemy)
      ctx.fillStyle = 'rgba(15,23,42,.9)'
      ctx.beginPath()
      ctx.roundRect(position.x - 22, position.y - enemy.radius * 1.7 - 20, 44, 6, 3)
      ctx.fill()
      ctx.fillStyle = enemy.hp / enemy.maxHp > 0.45 ? '#4ade80' : '#fb7185'
      ctx.beginPath()
      ctx.roundRect(position.x - 22, position.y - enemy.radius * 1.7 - 20, 44 * Math.max(0, enemy.hp / enemy.maxHp), 6, 3)
      ctx.fill()
      ctx.restore()
    }
  }

  private drawEnemyWeapon(enemy: Enemy, walk: number) {
    const ctx = this.ctx
    const swing = Math.sin(walk) * 0.24
    ctx.save()
    ctx.translate(9, -1)
    ctx.rotate(-0.58 + swing)
    ctx.lineCap = 'round'
    if (enemy.type === 'shaman') {
      ctx.strokeStyle = '#6b4423'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(0, -13)
      ctx.lineTo(0, 18)
      ctx.stroke()
      ctx.fillStyle = '#86efac'
      ctx.beginPath()
      ctx.moveTo(0, -20)
      ctx.lineTo(6, -13)
      ctx.lineTo(0, -7)
      ctx.lineTo(-6, -13)
      ctx.closePath()
      ctx.fill()
    } else if (enemy.type === 'brute' || enemy.type === 'boss') {
      ctx.strokeStyle = '#6b4423'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(0, -13)
      ctx.lineTo(0, 18)
      ctx.stroke()
      ctx.fillStyle = enemy.type === 'boss' ? '#fbbf24' : '#94a3b8'
      ctx.beginPath()
      ctx.moveTo(-10, -15)
      ctx.lineTo(0, -24)
      ctx.lineTo(10, -15)
      ctx.lineTo(3, -8)
      ctx.lineTo(-3, -8)
      ctx.closePath()
      ctx.fill()
    } else {
      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = enemy.type === 'runner' ? 2 : 3
      ctx.beginPath()
      ctx.moveTo(0, -15)
      ctx.lineTo(0, 13)
      ctx.stroke()
      ctx.fillStyle = '#cbd5e1'
      ctx.beginPath()
      ctx.moveTo(0, -21)
      ctx.lineTo(5, -13)
      ctx.lineTo(-5, -13)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#92400e'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(-5, 8)
      ctx.lineTo(5, 8)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawProjectiles() {
    const ctx = this.ctx
    for (const projectile of this.projectiles) {
      for (let index = projectile.trail.length - 1; index >= 0; index--) {
        const point = projectile.trail[index]!
        ctx.globalAlpha = (projectile.trail.length - index) / projectile.trail.length * 0.28
        ctx.fillStyle = projectile.color
        ctx.beginPath()
        ctx.arc(point.x, point.y, projectile.size * 0.6, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      const target = this.enemies.find(enemy => enemy.id === projectile.targetId)
      const targetPosition = projectile.targetPosition ?? (target ? this.enemyScreenPosition(target) : projectile)
      const angle = Math.atan2(targetPosition.y - projectile.y, targetPosition.x - projectile.x)
      ctx.save()
      ctx.translate(projectile.x, projectile.y)
      ctx.rotate(angle)
      ctx.shadowColor = projectile.color
      ctx.shadowBlur = 12
      const archetype = this.towerArchetype(projectile.type)
      if (archetype === 'bolt') {
        ctx.strokeStyle = '#e2e8f0'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(-13, 0)
        ctx.lineTo(10, 0)
        ctx.stroke()
        ctx.fillStyle = '#67e8f9'
        ctx.beginPath()
        ctx.moveTo(14, 0)
        ctx.lineTo(7, -4)
        ctx.lineTo(7, 4)
        ctx.closePath()
        ctx.fill()
      } else if (archetype === 'mortar') {
        ctx.fillStyle = '#fbbf24'
        ctx.beginPath()
        ctx.arc(0, 0, 8, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#fff7ed'
        ctx.beginPath()
        ctx.arc(-2, -2, 3, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.fillStyle = '#c4b5fd'
        ctx.beginPath()
        ctx.moveTo(13, 0)
        ctx.lineTo(-5, -6)
        ctx.lineTo(-11, 0)
        ctx.lineTo(-5, 6)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
      ctx.shadowBlur = 0
    }
  }

  private drawEffects() {
    const ctx = this.ctx
    for (const shockwave of this.shockwaves) {
      ctx.globalAlpha = clamp(shockwave.life * 1.6, 0, 1)
      ctx.strokeStyle = shockwave.color
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(shockwave.x, shockwave.y, Math.max(0, shockwave.radius), 0, Math.PI * 2)
      ctx.stroke()
    }
    for (const particle of this.particles) {
      ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1)
      ctx.fillStyle = particle.color
      ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size)
    }
    for (const text of this.floatingTexts) {
      const position = text.screenSpace
        ? {
            x: WORLD_VIEW_CENTER.x + this.camera.x + (text.x - WORLD_VIEW_CENTER.x) / this.zoom,
            y: WORLD_VIEW_CENTER.y + this.camera.y + (text.y - WORLD_VIEW_CENTER.y) / this.zoom
          }
        : text
      ctx.globalAlpha = clamp(text.life / text.maxLife * 1.5, 0, 1)
      ctx.fillStyle = text.color
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 4
      ctx.font = `900 ${text.size}px sans-serif`
      ctx.textAlign = 'center'
      ctx.strokeText(text.text, position.x, position.y)
      ctx.fillText(text.text, position.x, position.y)
    }
    ctx.globalAlpha = 1
  }

  private drawHover() {
    if (!this.hoverCell || (this.phase !== 'planning' && this.phase !== 'path')) return
    if (this.phase === 'path') return
    const ctx = this.ctx
    const screen = this.gridToScreen(this.hoverCell)
    const allowed = this.placementStatus(this.hoverCell).allowed
    ctx.strokeStyle = allowed ? '#67e8f9' : '#fb7185'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(screen.x, screen.y - TILE_HEIGHT / 2)
    ctx.lineTo(screen.x + TILE_WIDTH / 2, screen.y)
    ctx.lineTo(screen.x, screen.y + TILE_HEIGHT / 2)
    ctx.lineTo(screen.x - TILE_WIDTH / 2, screen.y)
    ctx.closePath()
    ctx.stroke()
  }

  private drawWaveBanner() {
    const ctx = this.ctx
    const progress = clamp(this.waveBanner / 1.4, 0, 1)
    const alpha = Math.min(1, progress * 3)
    const boxWidth = 360
    const boxHeight = 72
    const boxX = (WIDTH - boxWidth) / 2
    const boxY = 74
    ctx.globalAlpha = alpha
    ctx.fillStyle = 'rgba(8,21,45,.88)'
    ctx.strokeStyle = this.wave % 4 === 0 ? '#facc15' : '#67e8f9'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 18)
    ctx.fill()
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.fillStyle = this.wave % 4 === 0 ? '#fde047' : '#ecfeff'
    ctx.font = '900 27px sans-serif'
    ctx.fillText(this.wave % 4 === 0 ? `CHECKPOINT ${this.wave / 4}` : `WAVE ${this.wave}`, WIDTH / 2, boxY + 31)
    ctx.font = '700 11px sans-serif'
    ctx.fillStyle = '#a5f3fc'
    ctx.fillText(this.wave % 4 === 0 ? 'A GUARDIAN ENTERS THE ROAD' : 'THE MIST STIRS', WIDTH / 2, boxY + 53)
    ctx.globalAlpha = 1
  }

  private drawEvacuationBanner() {
    const ctx = this.ctx
    const pulse = 0.82 + Math.sin(performance.now() / 85) * 0.18
    ctx.save()
    ctx.globalAlpha = clamp(this.ambientEvacuation * 1.8, 0, 1)
    ctx.fillStyle = 'rgba(69,26,3,.9)'
    ctx.strokeStyle = `rgba(251,191,36,${pulse})`
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.roundRect(WIDTH / 2 - 230, 64, 460, 72, 18)
    ctx.fill()
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.fillStyle = '#fef3c7'
    ctx.font = '900 25px sans-serif'
    ctx.fillText('⚠  THE WARNING BELL RINGS', WIDTH / 2, 94)
    ctx.fillStyle = '#fcd34d'
    ctx.font = '800 12px sans-serif'
    ctx.fillText('CLEAR THE ROAD · SEEK SHELTER', WIDTH / 2, 117)
    ctx.restore()
  }

  private drawPauseOverlay() {
    const ctx = this.ctx
    ctx.fillStyle = 'rgba(2,6,23,.76)'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.font = '900 44px sans-serif'
    ctx.fillText('TIME HELD', WIDTH / 2, HEIGHT / 2)
    ctx.font = '500 15px sans-serif'
    ctx.fillStyle = '#a5f3fc'
    ctx.fillText('Press pause to release the horde', WIDTH / 2, HEIGHT / 2 + 32)
  }
}
