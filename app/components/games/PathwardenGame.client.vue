<script setup lang="ts">
import {
  PathwardenEngine,
  type PathwardenInventoryRelic,
  type PathwardenEngineRestore,
  type PathwardenRelic,
  type PathwardenRelicRarity,
  type PathwardenSnapshot,
  type PathwardenTargeting,
  type PathwardenTowerType
} from '~/utils/pathwarden-engine'
import type { PathwardenGameState, PathwardenMapPlan } from '#shared/types/pathwarden-save'
import {
  PATHWARDEN_DEFENSE_BLUEPRINTS,
  type PathwardenDefenseArchetype,
  pathwardenAetherCashoutBonus,
  pathwardenCheckpointRate,
  pathwardenCheckpointReward,
  pathwardenBoostEffects,
  pathwardenMaxAetherAtCheckpoint
} from '#shared/utils/gamelogic/pathwarden'
import {
  runPathwardenSimulations,
  type PathwardenSimulationDifficulty,
  type PathwardenSimulationResult,
  type PathwardenSimulationStrategy,
  type PathwardenSimulationWaveResult
} from '#shared/utils/gamelogic/pathwarden-simulator'

const introStory = [
  {
    kicker: 'Before the mist',
    title: 'A kingdom in bloom',
    body: 'Pathwarden prospered beneath a watchful god. Its fields were full, its granaries deep, and its people safe behind the keep.'
  },
  {
    kicker: 'The temple flame',
    title: 'Protected by grace',
    body: 'Farmers worked in peace while the wardens watched the roads. The temple guarded every harvest, every child, every stone.'
  },
  {
    kicker: 'The court forgets',
    title: 'Arrogance takes root',
    body: 'Prosperity made the court careless. They decided the kingdom no longer needed the god who protected it.'
  },
  {
    kicker: 'The king’s decree',
    title: 'Defile the temple',
    body: 'The king ordered the temple stripped and remade as his own pleasure palace. The first stone was lifted. The sky went dark.'
  }
] as const

definePageMeta({ title: 'Pathwarden' })

const canvas = ref<HTMLCanvasElement | null>(null)
const snapshot = ref<PathwardenSnapshot>({
  phase: 'planning',
  introStoryActive: false,
  introStoryIndex: 0,
  introStoryOpacity: 1,
  activeRunScene: false,
  activeRunSceneProgress: 0,
  openingCinematic: false,
  openingCinematicProgress: 0,
  wave: 0,
  lives: 20,
  aether: 205,
  coinsEarned: 0,
  realm: 1,
  flawlessWaves: 0,
  score: 0,
  enemies: 0,
  towers: 0,
  streak: 0,
  selectedTower: 'bolt',
  paused: false,
  relicRanks: { damage: 0, range: 0, interest: 0, haste: 0, bounty: 0 },
  nextWave: { number: 1, enemies: 8, exits: 1, checkpoint: false, threats: ['Raiders'] },
  towerCosts: { bolt: 55, mortar: 90, frost: 75, ember: 115, storm: 135, radiant: 155 },
  message: 'Build your defenses, then call the first wave.',
  selectedBuilding: null,
  relicInventory: [],
  canSellRelics: false
})
const inspectedUpgradeFamily = ref<string | null>(null)

const selectedUpgrade = computed(() => {
  const building = snapshot.value.selectedBuilding
  if (!building) return null
  const upgrades = [
    ...(building.relicFamily
      ? [{
          family: building.relicFamily,
          name: building.relicName,
          description: building.relicDescription,
          level: building.relicStacks,
          power: building.relicPower,
          iconIndex: building.relicIconIndex,
          global: false
        }]
      : []),
    ...building.globalRelics.map(relic => ({ ...relic, global: true }))
  ]
  return upgrades.find(upgrade => upgrade.family === inspectedUpgradeFamily.value) ?? null
})
const upgradeChoices = ref<PathwardenRelic[]>([])
const boostShopOpen = ref(false)
const defenseInventoryOpen = ref(false)
const abandonOpen = ref(false)
const simulatorOpen = ref(false)
const simulatorRunning = ref(false)
const simulationDifficulty = ref<PathwardenSimulationDifficulty>(1)
const simulationStrategy = ref<PathwardenSimulationStrategy>('balanced')
const simulationResult = ref<PathwardenSimulationResult | null>(null)
const abandoning = ref(false)
const buyingBoost = ref<string | null>(null)
const buyingSurge = ref(false)
const buyingDefense = ref<string | null>(null)
const buyingSkin = ref<string | null>(null)
const clearingDebugCache = ref(false)
const useSurge = ref(false)
const hintsEnabled = ref(true)
const runActive = ref(false)
const claimedCheckpointWaves = new Set<number>()
const checkpointClaims = new Map<number, Promise<void>>()
const settling = ref(false)
const rushingCooldown = ref(false)
const nowMs = ref(Date.now())
const toast = useToast()
const { fetchSession } = useAuth()
const isDev = import.meta.dev
const devGuidesEnabled = ref(false)
const selectedIdleStoryId = ref(1)
type DefenseInventoryTab = 'all' | PathwardenDefenseArchetype
type DefenseInventorySort = 'power' | 'cost'
const defenseInventoryTab = ref<DefenseInventoryTab>('all')
const defenseInventorySort = ref<DefenseInventorySort>('power')
const defenseInventoryTabs = [
  { label: 'All defenses', value: 'all', icon: 'i-lucide-layout-grid' },
  { label: 'Ballista', value: 'ballista', icon: 'i-lucide-crosshair' },
  { label: 'Mortar', value: 'mortar', icon: 'i-lucide-bomb' },
  { label: 'Spire', value: 'spire', icon: 'i-lucide-tower-control' }
]
const defenseInventorySorts = [
  { label: 'Strongest first', value: 'power' },
  { label: 'Lowest Aether cost', value: 'cost' }
]
const defenseArchetypeLabels: Record<PathwardenDefenseArchetype, string> = {
  ballista: 'Ballista',
  mortar: 'Mortar',
  spire: 'Spire'
}
const defenseLore: Record<string, string> = {
  bolt: 'The first Star Ballista was made from a fallen constellation’s pinion: simple, honest, and deadly when a single raider matters.',
  'star-2': 'Comet Repeaters added a second firing rail after wardens learned that one marked target is rarely alone at a frontier breach.',
  'star-3': 'Astral Arbalests carry mirrored sights cut by the observatory, keeping their aim true through bends and broken ground.',
  'star-4': 'Celestial Scorpions are fortress-grade ballistae whose counterweights let them punish commanders before the rank-and-file.',
  'star-5': 'Heavenpiercers are reserved for the keep’s final oath: every bolt is named, fletched, and loosed as if it were the last shot of the realm.',
  mortar: 'The first Sun Mortar was a temple brazier turned inside out, teaching the wardens that one well-placed shell can answer an entire crowd.',
  'sun-2': 'Solar Bombards use mirrored plates to hold the noon heat longer, making every blast a brighter warning to enemies on a shared road.',
  'sun-3': 'Helios Howitzers were cast from bell bronze and tuned to the keep’s alarm, their shells arriving like a second thunderclap.',
  'sun-4': 'Daystar Cannons carry a lens of captive dawn, burning through the haze where ordinary bombard crews lose their target.',
  'sun-5': 'Noonfall Engines are the reliquary’s great sun: too magnificent for a village wall, and precisely why the oldest wardens still build them.',
  frost: 'The Winter Spire began as a shepherd’s marker that could freeze a boot to the road, buying the keep its first precious breaths.',
  'winter-2': 'Rime Monoliths draw cold from deep stone, widening the hush around them so a whole patrol feels the season change.',
  'winter-3': 'Glacier Beacons preserve the names of every frozen pass; their crystal cores make haste itself seem foolish to an invader.',
  'winter-4': 'Permafrost Crowns are crowned with ice that never melts, turning their ground into a patient trap for the swiftest horde.',
  'winter-5': 'Whiteout Sanctums do not merely slow an army—they make the road forget where forward was, until the keep chooses who may pass.',
  ember: 'Ember Bastions were raised above the old furnace vents, where their first wardens learned that stubborn armor fears a hotter argument.',
  'ember-2': 'Cinder Redoubts line their chambers with slag from the temple purge, holding enough heat to keep fighting after the torches fail.',
  'ember-3': 'Furnace Keeps were designed by smiths who lost a city gate; each shell carries their answer to every shield that once held.',
  'ember-4': 'Caldera Citadels vent through twin chimneys, feeding a controlled inferno that makes prolonged engagements their natural theatre.',
  'ember-5': 'Worldfire Bastions are living foundries, their ammunition forged between waves so the enemy faces an ever-renewed furnace.',
  storm: 'The Tempest Obelisk was first struck by lightning during a coronation and has never stopped humming for the king it outlived.',
  'storm-2': 'Thunder Pylons split the first charge across a braided copper crown, letting one crackle leap from a mistake to its neighbours.',
  'storm-3': 'Stormcall Needles were tuned by sailors who read weather in rigging, finding the exact instant a formation becomes a conductor.',
  'storm-4': 'Skybreaker Coils bottle pressure from high clouds, releasing it in disciplined bursts rather than the wild fury of a natural storm.',
  'storm-5': 'Godspark Obelisks are the wardens’ most audacious theft from the heavens: a controlled tempest that makes clustering an act of surrender.',
  radiant: 'The Dawn Chapel was built around a single clear window, giving tired defenders a place where one ray could still mean morning.',
  'dawn-2': 'Aurora Shrines lace that window with colored glass, spreading their blessing across a wider road without losing its gentle precision.',
  'dawn-3': 'Radiant Basilicas house choirs whose bells keep the light aligned, cleansing formations that would overwhelm a lone chapel.',
  'dawn-4': 'Seraphic Lanterns were carried through the plague years and learned to shine beyond smoke, ash, and the fear beneath both.',
  'dawn-5': 'Firstlight Cathedrals open their roofs to the horizon, making the first beam of every morning a weapon with the reach of a prayer.',
  venom: 'The Briar Slinger began as a hunter’s bow strung with living vine, meant to make a dangerous beast reconsider its next step.',
  'venom-2': 'Adder Nests cultivate two strains of poison: one finds the blood, the other waits for the armor to crack.',
  'venom-3': 'Nightshade Bowerys are tended like orchards, with each dark blossom bred for a different enemy temperament.',
  'venom-4': 'Basilisk Roosts keep their venom in cold glass and release it only at the moment a champion believes itself safe.',
  'venom-5': 'Widowmaker Groves are silent gardens of accumulated grudges, where every dart carries generations of patient instruction.',
  gale: 'The Gale Fan was built from a mill wheel and proved that a gentle wind, aimed well, could turn a road into a wall.',
  'gale-2': 'Zephyr Mills add counter-rotating sails, shaping the air so fast attackers spend their strength before reaching the gate.',
  'gale-3': 'Cyclone Turrets were engineered by bridgewrights who learned to make pressure hold a span; their bursts hold a formation just as surely.',
  'gale-4': 'Hurricane Looms weave several currents together, punishing every enemy that tries to exploit an opening beside its companion.',
  'gale-5': 'Worldwind Engines make the battlefield feel larger than it is, folding distance back on every enemy who thought speed was victory.',
  prism: 'The Prism Ward was a glassmaker’s experiment that found enemies hiding beyond the reach of ordinary watchtowers.',
  'prism-2': 'Glasslight Lenses grind three colors into one sightline, making distant armor show its seams before it reaches the road bend.',
  'prism-3': 'Spectrum Towers were raised after the first mist eclipse; their refracted beams keep working when the sky refuses to give a true horizon.',
  'prism-4': 'Aurora Arrays use suspended crystal plates to divide one judgment across multiple lanes without diluting its purpose.',
  'prism-5': 'Thousand-Ray Prisms are less a tower than a treaty with light, seeing through distance, weather, and the lies of heavy armor.',
  siege: 'The Iron Bombard was dragged from a ruined gate and taught the keep that a road can be defended by making its far end afraid.',
  'siege-2': 'Castle Crackers gained a longer chamber and heavier shot after the first siege beasts learned to shrug off ordinary shells.',
  'siege-3': 'Titan Culverins require a foundation of black stone, but repay the effort with impacts that reshape the enemy’s entire approach.',
  'siege-4': 'Kingfall Cannons were built for tyrants who trusted walls; their crews aim past the vanguard and speak directly to whatever commands it.',
  'siege-5': 'Dreadnought Batteries are mobile legends assembled from five conquered fortresses, a final argument no ordinary road can carry quietly.'
}
const simulationStrategies = [
  { label: 'Balanced', value: 'balanced' },
  { label: 'Max Aether preserve', value: 'aether-reserve' },
  { label: 'Max life preserve', value: 'life-preserve' },
  { label: 'Damage rush', value: 'damage-rush' },
  { label: 'Crowd control', value: 'control' }
]
const idleStoryFamilies = [
  'Market day',
  'Hunter and deer',
  'Lovers’ picnic',
  'Travelling musician',
  'Children at play',
  'Shepherd’s crossing',
  'Guard patrol',
  'Peddler',
  'Construction crew',
  'Cat business',
  'Bird life',
  'Dog and courier',
  'Bakers’ delivery',
  'Fisher’s tale',
  'Lost chicken',
  'Knight training',
  'Herbalist',
  'Pilgrim procession',
  'Rainy scramble',
  'Festival rehearsal',
  'Scholar and apprentice',
  'Beekeeper',
  'Tiny creatures',
  'Royal inspection',
  'Midnight oddities'
]
const idleStoryItems = idleStoryFamilies.flatMap((family, familyIndex) =>
  Array.from({ length: 10 }, (_, variantIndex) => {
    const storyId = familyIndex * 10 + variantIndex + 1
    return {
      label: `${String(storyId).padStart(3, '0')} · ${family} · variant ${variantIndex + 1}`,
      value: storyId
    }
  }))
const { data: boostState, refresh: refreshBoosts } = await useFetch('/api/pathwarden/state')
const skipIntro = ref(Boolean(boostState.value?.skipIntro))
const savingPreferences = ref(false)
let engine: PathwardenEngine | null = null
let unregisterDevBridge = () => {}
let cooldownClock: ReturnType<typeof setInterval> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveRevision = 0
let saveInFlight = false
let saveDirty = false
let restoredRun: { mapPlan: PathwardenMapPlan, gameState: PathwardenGameState } | undefined

const towerTypes = computed(() => (boostState.value?.defenses
  ?.filter(defense => defense.owned)
  .map(defense => defense.id) ?? ['bolt', 'mortar', 'frost']) as PathwardenTowerType[])
const targetingModes: PathwardenTargeting[] = ['first', 'strong', 'fast']
const permanentBalance = computed(() => Number(boostState.value?.balance ?? 0))
const canAbandon = computed(() => runActive.value
  && ['planning', 'checkpoint', 'path', 'upgrade'].includes(snapshot.value.phase))
const selectedRealm = ref(1)
const unlockedRealm = ref(1)
const checkpointReward = computed(() => pathwardenCheckpointReward(snapshot.value.wave, snapshot.value.realm))
const checkpointAetherBonus = computed(() => pathwardenAetherCashoutBonus(
  Math.min(
    snapshot.value.aether,
    boostState.value
      ? pathwardenMaxAetherAtCheckpoint(snapshot.value.wave, boostState.value.levels, useSurge.value)
      : snapshot.value.aether
  ),
  snapshot.value.wave,
  snapshot.value.realm
))
const checkpointOffer = checkpointAetherBonus
const checkpointRate = computed(() => pathwardenCheckpointRate(snapshot.value.wave, snapshot.value.realm))
const cooldownRemainingMs = computed(() => {
  const until = boostState.value?.runCooldown?.until
  return until ? Math.max(0, new Date(until).getTime() - nowMs.value) : 0
})
const coolingDown = computed(() => cooldownRemainingMs.value > 0)
const cooldownLabel = computed(() => {
  const seconds = Math.ceil(cooldownRemainingMs.value / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':')
})
const phaseLabel = computed(() => ({
  planning: 'Build phase',
  wave: 'Wave in progress',
  checkpoint: 'Checkpoint secured',
  path: 'Expand the road',
  upgrade: 'Choose a relic',
  cashout: 'March concluded',
  victory: 'Realm defended',
  defeat: 'Keep destroyed'
}[snapshot.value.phase]))

function selectTower(type: PathwardenTowerType) {
  engine?.selectTower(type)
}

function openBuildingInventory() {
  engine?.enterPlacementMode()
  defenseInventoryOpen.value = true
}

function towerBlueprint(type: PathwardenTowerType) {
  return PATHWARDEN_DEFENSE_BLUEPRINTS.find(defense => defense.id === type)
    ?? PATHWARDEN_DEFENSE_BLUEPRINTS[0]!
}

const defenseBoostEffects = computed(() => boostState.value?.effects ?? {
  damageMultiplier: 1,
  rangeMultiplier: 1,
  rateMultiplier: 1,
  startingAether: 205,
  startingLives: 20,
  bountyMultiplier: 1
})

function defensePower(defense: typeof PATHWARDEN_DEFENSE_BLUEPRINTS[number]) {
  const effects = defenseBoostEffects.value
  const damage = defense.damage * effects.damageMultiplier
  const rate = defense.rate / effects.rateMultiplier
  return damage / rate + defense.splash * 0.35 + defense.slow * 100 + defense.range * 0.08
}

const inventoryDefenses = computed(() => {
  const defenses = towerTypes.value
    .map(type => towerBlueprint(type))
    .filter(defense => defenseInventoryTab.value === 'all' || defense.archetype === defenseInventoryTab.value)
  return [...defenses].sort((a, b) => defenseInventorySort.value === 'cost'
    ? (snapshot.value.towerCosts[a.id] ?? a.aetherCost) - (snapshot.value.towerCosts[b.id] ?? b.aetherCost)
    : defensePower(b) - defensePower(a))
})

const selectedInventoryDefense = computed(() => towerBlueprint(snapshot.value.selectedTower))

const selectedInventoryStats = computed(() => {
  const defense = selectedInventoryDefense.value
  const effects = defenseBoostEffects.value
  return {
    damage: Math.round(defense.damage * effects.damageMultiplier),
    range: Math.round(defense.range * effects.rangeMultiplier),
    rate: Number((defense.rate / effects.rateMultiplier).toFixed(2)),
    dps: (defense.damage * effects.damageMultiplier / (defense.rate / effects.rateMultiplier)).toFixed(1),
    cost: snapshot.value.towerCosts[defense.id] ?? defense.aetherCost
  }
})

function defenseAdvice(defense: typeof PATHWARDEN_DEFENSE_BLUEPRINTS[number]) {
  if (defense.archetype === 'ballista') return 'Place near a long straight or a priority lane. Its reliable single-target fire is strongest when it can keep one dangerous enemy in sight.'
  if (defense.archetype === 'mortar') return 'Place beside a junction or bend. Splash damage compounds when several roads overlap, while the slower reload rewards patient placement.'
  return 'Place where routes remain in range for a long time. Control and reach matter more than raw damage, especially before a crowded wave.'
}

function chooseInventoryDefense(type: PathwardenTowerType) {
  selectTower(type)
  defenseInventoryOpen.value = false
}

function sellRelic(instanceId: number) {
  engine?.sellRelic(instanceId)
}

function togglePause() {
  engine?.togglePause()
}

function toggleRoadLaboratory() {
  engine?.debugToggleSandbox()
}

function triggerRandomIdleStory() {
  engine?.debugTriggerAmbient()
}

function toggleDevGuides() {
  engine?.debugToggleVisuals()
  devGuidesEnabled.value = !devGuidesEnabled.value
}

function revealEntireMap() {
  engine?.debugRevealFullMap()
}

function playSelectedIdleStory() {
  engine?.debugTriggerAmbient(selectedIdleStoryId.value)
}

function previewSelectedIdleStory() {
  engine?.debugPreviewAmbientStory(selectedIdleStoryId.value, 0.55)
}

async function clearDebugCache() {
  if (!isDev || clearingDebugCache.value) return
  clearingDebugCache.value = true
  try {
    await $fetch('/api/pathwarden/debug-clear-cache', { method: 'POST' })
    runActive.value = false
    restoredRun = undefined
    saveRevision = 0
    saveDirty = false
    saveInFlight = false
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    localStorage.removeItem('pathwarden-hints')
    hintsEnabled.value = true
    await refreshBoosts()
    restart()
    toast.add({
      title: 'Pathwarden cache cleared',
      description: 'The persisted active march was removed for this profile.',
      color: 'warning'
    })
  } catch (error: unknown) {
    toast.add({ title: apiErrorMessage(error, 'Could not clear the Pathwarden cache'), color: 'error' })
  } finally {
    clearingDebugCache.value = false
  }
}

async function setSkipIntro(enabled: boolean) {
  if (savingPreferences.value || enabled === skipIntro.value) return
  const previous = skipIntro.value
  skipIntro.value = enabled
  savingPreferences.value = true
  try {
    await $fetch('/api/pathwarden/preferences', { method: 'PUT', body: { skipIntro: enabled } })
  } catch (error: unknown) {
    skipIntro.value = previous
    toast.add({ title: 'Could not save intro preference', description: apiErrorMessage(error, 'Try again in a moment.'), color: 'error' })
  } finally {
    savingPreferences.value = false
  }
}

function claimCheckpointReward(wave: number) {
  if (!([4, 8, 12] as number[]).includes(wave) || claimedCheckpointWaves.has(wave)) return Promise.resolve()
  const existing = checkpointClaims.get(wave)
  if (existing) return existing

  const request = (async () => {
    try {
      await saveRun()
      const result = await $fetch('/api/pathwarden/checkpoint', {
        method: 'POST',
        body: { wave }
      })
      claimedCheckpointWaves.add(wave)
      if (!result.alreadyClaimed && result.reward > 0) {
        toast.add({
          title: `Checkpoint ${wave / 4} reward secured`,
          description: `${formatNumber(result.reward, false)} Coins added. Aether cash-out is still available as a bonus.`,
          color: 'success'
        })
      }
      await Promise.all([refreshBoosts(), fetchSession()])
    } catch (error: unknown) {
      toast.add({ title: 'Checkpoint reward pending', description: apiErrorMessage(error, 'We will retry when you choose a checkpoint action.'), color: 'warning' })
    } finally {
      checkpointClaims.delete(wave)
    }
  })()
  checkpointClaims.set(wave, request)
  return request
}

async function runSimulator() {
  if (simulatorRunning.value) return
  simulatorRunning.value = true
  await new Promise(resolve => setTimeout(resolve, 20))
  simulationResult.value = runPathwardenSimulations({
    difficulty: simulationDifficulty.value,
    strategy: simulationStrategy.value,
    runs: 1000,
    seed: Date.now()
  })
  simulatorRunning.value = false
}

const simulationChartX = (wave: PathwardenSimulationWaveResult) => wave.wave
const simulationChartY = (wave: PathwardenSimulationWaveResult) => wave.averageProgress * 100
const simulationChartTick = (wave: number) => `W${wave}`
const simulationChartTooltip = (wave: PathwardenSimulationWaveResult) =>
  `Wave ${wave.wave}: ${(wave.averageProgress * 100).toFixed(1)}% advance`

async function startWave() {
  upgradeChoices.value = []
  if (!await ensureRunStarted()) return
  engine?.startWave()
}

async function ensureRunStarted() {
  if (runActive.value) return true
  try {
    await $fetch('/api/pathwarden/start-run', {
      method: 'POST',
      body: {
        realm: selectedRealm.value,
        useSurge: useSurge.value,
        seed: engine?.exportMapPlan().seed
      }
    })
    runActive.value = true
    saveRevision = 0
    scheduleSave()
    await refreshBoosts()
    return true
  } catch (error: unknown) {
    toast.add({ title: apiErrorMessage(error, 'Could not start the run'), color: 'error' })
    return false
  }
}

async function defileTemple() {
  upgradeChoices.value = []
  if (!await ensureRunStarted()) return
  engine?.defileTemple()
}

function continueDefense() {
  engine?.continueDefense()
}

function nextIntroStory() {
  engine?.nextIntroStory()
}

function previousIntroStory() {
  engine?.previousIntroStory()
}

const introStorySlide = computed(() => {
  const index = Number.isFinite(snapshot.value.introStoryIndex)
    ? Math.max(0, Math.min(snapshot.value.introStoryIndex, introStory.length - 1))
    : 0
  return introStory[index]!
})
const showDefileTemple = computed(() => snapshot.value.introStoryIndex === introStory.length - 1 && snapshot.value.introStoryOpacity > 0.35)

async function rushCooldown() {
  if (rushingCooldown.value) return
  rushingCooldown.value = true
  try {
    const response = await $fetch('/api/pathwarden/rush-cooldown', { method: 'POST' })
    await Promise.all([refreshBoosts(), fetchSession()])
    toast.add({
      title: 'The wardens are ready',
      description: `${response.cost} Gem${response.cost === 1 ? '' : 's'} cleared the remaining recovery.`,
      color: 'success'
    })
  } catch (error) {
    toast.add({ title: apiErrorMessage(error, 'Could not rush recovery'), color: 'error' })
  } finally {
    rushingCooldown.value = false
  }
}

async function abandonRun(currency: 'gems' | 'coins') {
  if (!canAbandon.value || abandoning.value) return
  abandoning.value = true
  try {
    const result = await $fetch('/api/pathwarden/abandon', {
      method: 'POST',
      body: { currency }
    })
    runActive.value = false
    saveDirty = false
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    abandonOpen.value = false
    await Promise.all([refreshBoosts(), fetchSession()])
    restart()
    toast.add({
      title: 'March abandoned',
      description: `${formatNumber(result.cost, false)} ${result.currency === 'gems' ? 'Gems' : 'Coins'} paid. A fresh map is ready.`,
      color: 'warning'
    })
  } catch (error: unknown) {
    toast.add({ title: apiErrorMessage(error, 'Could not abandon the march'), color: 'error' })
  } finally {
    abandoning.value = false
  }
}

function chooseUpgrade(upgrade: PathwardenRelic) {
  upgradeChoices.value = []
  engine?.chooseUpgrade(upgrade)
}

function relicIconStyle(relic: { iconIndex: number }) {
  const col = relic.iconIndex % 5
  const row = Math.floor(relic.iconIndex / 5)
  return {
    backgroundImage: 'url(/games/pathwarden/relics.png)',
    backgroundSize: '500% 300%',
    backgroundPosition: `${col * 25}% ${row * 50}%`
  }
}

function inspectUpgrade(family: string) {
  inspectedUpgradeFamily.value = family
}

function rarityClass(rarity: PathwardenRelicRarity) {
  return {
    common: 'border-default text-muted',
    uncommon: 'border-success/60 text-success',
    rare: 'border-info/60 text-info',
    epic: 'border-primary/60 text-primary',
    mythic: 'border-warning/70 text-warning'
  }[rarity]
}

function dragRelic(event: DragEvent, relic: PathwardenInventoryRelic) {
  closeBuildingProfile()
  event.dataTransfer?.setData('application/x-pathwarden-relic', String(relic.instanceId))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function dropRelic(event: DragEvent) {
  const instanceId = Number(event.dataTransfer?.getData('application/x-pathwarden-relic'))
  if (!instanceId) return
  engine?.applyRelicToTowerAt(instanceId, event.clientX, event.clientY)
}

function restart() {
  engine?.destroy()
  upgradeChoices.value = []
  useSurge.value = false
  createGame()
}

function chooseRealm(realm: number) {
  if (realm > unlockedRealm.value || realm === selectedRealm.value) return
  selectedRealm.value = realm
  restart()
}

function toggleSurge(enabled: boolean) {
  if (snapshot.value.wave > 0 || runActive.value) return
  useSurge.value = enabled
  engine?.destroy()
  createGame()
}

function salvageBuilding() {
  engine?.salvageSelectedBuilding()
}

function closeBuildingProfile() {
  engine?.clearSelectedBuilding()
}

function setTargeting(targeting: PathwardenTargeting) {
  engine?.setSelectedTargeting(targeting)
}

function boostSpriteStyle(sprite: { col: number, row: number }) {
  return {
    backgroundImage: 'url(/games/pathwarden/boosts.png)',
    backgroundSize: '300% 200%',
    backgroundPosition: `${sprite.col * 50}% ${sprite.row * 100}%`
  }
}

async function buyBoost(boostId: string) {
  buyingBoost.value = boostId
  try {
    await $fetch('/api/pathwarden/boost', { method: 'POST', body: { boostId } })
    await Promise.all([refreshBoosts(), fetchSession()])
  } catch (error) {
    toast.add({ title: apiErrorMessage(error, 'Boost purchase failed'), color: 'error' })
  } finally {
    buyingBoost.value = null
  }
}

async function buySurge() {
  buyingSurge.value = true
  try {
    await $fetch('/api/pathwarden/surge', { method: 'POST', body: { count: 1 } })
    await Promise.all([refreshBoosts(), fetchSession()])
  } catch (error) {
    toast.add({ title: apiErrorMessage(error, 'Could not prepare Mist Surge'), color: 'error' })
  } finally {
    buyingSurge.value = false
  }
}

async function buyDefense(defenseId: string) {
  buyingDefense.value = defenseId
  try {
    await $fetch('/api/pathwarden/defenses/buy', { method: 'POST', body: { defenseId } })
    await Promise.all([refreshBoosts(), fetchSession()])
  } finally {
    buyingDefense.value = null
  }
}

async function buySkin(skinId: string) {
  buyingSkin.value = skinId
  try {
    await $fetch('/api/pathwarden/skins/buy', { method: 'POST', body: { skinId } })
    await Promise.all([refreshBoosts(), fetchSession()])
    restart()
  } finally {
    buyingSkin.value = null
  }
}

async function equipSkin(skinId: string) {
  buyingSkin.value = skinId
  try {
    await $fetch('/api/pathwarden/skins/equip', { method: 'POST', body: { skinId } })
    await refreshBoosts()
    restart()
  } finally {
    buyingSkin.value = null
  }
}

async function settleRun(reason: 'cashout' | 'victory' | 'defeat') {
  if (!runActive.value || settling.value) return null
  settling.value = true
  try {
    const response = await $fetch('/api/pathwarden/finish-run', {
      method: 'POST',
      body: {
        reason,
        wave: snapshot.value.wave,
        aether: snapshot.value.aether,
        score: snapshot.value.score,
        flawless: snapshot.value.flawlessWaves
      }
    })
    runActive.value = false
    unlockedRealm.value = response.maxUnlockedRealm
    engine?.settleRun(
      response.coins,
      reason === 'cashout'
        ? `${formatNumber(response.coins, false)} Coins secured at checkpoint ${snapshot.value.wave / 4}.`
        : undefined,
      reason === 'cashout'
    )
    await Promise.all([refreshBoosts(), fetchSession()])
    return response
  } catch (error: unknown) {
    toast.add({ title: apiErrorMessage(error, 'Run settlement failed'), color: 'error' })
    return null
  } finally {
    settling.value = false
  }
}

async function cashOut() {
  await claimCheckpointReward(snapshot.value.wave)
  const result = await settleRun('cashout')
  if (!result) return
  toast.add({
    title: `${formatNumber(result.coins, false)} Coins secured`,
    description: `${formatNumber(result.aetherCounted, false)} Aether crossed the checkpoint.`,
    color: 'success'
  })
}

async function continueCheckpoint() {
  await claimCheckpointReward(snapshot.value.wave)
  engine?.continueCheckpoint()
}

function scheduleSave() {
  if (!runActive.value || !engine) return
  saveDirty = true
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveRun()
  }, 750)
}

async function saveRun() {
  if (!runActive.value || !engine || saveInFlight || !saveDirty) return
  saveInFlight = true
  saveDirty = false
  const gameState = engine.exportGameState()
  try {
    const saved = await $fetch('/api/pathwarden/run', {
      method: 'PUT',
      body: { revision: saveRevision, gameState }
    })
    saveRevision = saved.revision
  } catch (error: unknown) {
    saveDirty = true
    if ((error as { statusCode?: number }).statusCode === 409) {
      toast.add({
        title: 'March opened elsewhere',
        description: 'This tab stopped saving to protect the newer Pathwarden state.',
        color: 'warning'
      })
      runActive.value = false
    }
  } finally {
    saveInFlight = false
    if (saveDirty && runActive.value) scheduleSave()
  }
}

function createGame(restore?: PathwardenEngineRestore) {
  if (!canvas.value) return
  engine = new PathwardenEngine(canvas.value, {
    onState: (state) => {
      snapshot.value = state
      scheduleSave()
    },
    onUpgrade: choices => { upgradeChoices.value = choices },
    onAmbientStoryComplete: async (storyId) => {
      try {
        const progress = await $fetch('/api/pathwarden/ambient', {
          method: 'POST',
          body: { storyId }
        })
        if (progress.achievementUnlocked) {
          toast.add({
            title: 'Village Chronicler unlocked',
            description: 'You witnessed all 250 village stories. Your next permanent upgrade is free.',
            color: 'success'
          })
        }
        await refreshBoosts()
      } catch {
        // Ambient theatre must never interrupt a run when progress syncing fails.
      }
    },
    onGameOver: async (won) => {
      await settleRun(won ? 'victory' : 'defeat')
    }
  }, boostState.value
    ? pathwardenBoostEffects(boostState.value.levels, useSurge.value)
    : undefined, selectedRealm.value, boostState.value?.equippedSkinId ?? 'warden-stone', restore, skipIntro.value)
  engine.start()
}

onMounted(async () => {
  cooldownClock = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
  hintsEnabled.value = localStorage.getItem('pathwarden-hints') !== 'off'
  if (boostState.value?.activeRun) {
    const response = await $fetch('/api/pathwarden/run')
    if (response.run?.gameState) {
      runActive.value = true
      saveRevision = response.run.revision
      selectedRealm.value = response.run.realm
      restoredRun = {
        mapPlan: response.run.mapPlan,
        gameState: response.run.gameState
      }
    }
  }
  unlockedRealm.value = boostState.value?.progression.maxUnlockedRealm ?? 1
  createGame(restoredRun)
  if (import.meta.dev) {
    const { registerGameDevBridge } = await import('~/utils/game-dev-bridge')
    unregisterDevBridge = registerGameDevBridge({
      id: 'pathwarden',
      kind: 'canvas-2d',
      canvas: () => canvas.value,
      state: () => engine?.getDebugState(),
      actions: {
        startWave: { description: 'Start the next enemy wave', run: () => engine?.startWave() },
        selectBallista: { description: 'Select the Ballista tower', run: () => engine?.selectTower('bolt') },
        inspectFrontier: { description: 'Enter frontier selection for development inspection', run: () => engine?.debugOpenFrontier() },
        claimFrontier: { description: 'Claim a preplanned frontier by index', run: input => engine?.debugClaimFrontier(Number(input) || 0) },
        revealFullMap: { description: 'Reveal the full planned map in development', run: () => engine?.debugRevealFullMap() },
        clearCache: { description: 'Clear the persisted active Pathwarden run in development', run: () => clearDebugCache() },
        toggleVisualGuides: { description: 'Toggle geometry, road, and trajectory guides', run: () => engine?.debugToggleVisuals() },
        spawnCrew: { description: 'Spawn a construction crew for development inspection', run: () => engine?.debugSpawnCrew() },
        populateVillage: { description: 'Populate every ambient village vignette', run: () => engine?.debugPopulateVillage() },
        marketBuild: { description: 'Preview the market-stall construction stage', run: () => engine?.debugPreviewAmbient('market', 0.1) },
        marketTrade: { description: 'Preview the market trading stage', run: () => engine?.debugPreviewAmbient('market', 0.48) },
        marketPack: { description: 'Preview the market-stall dismantling stage', run: () => engine?.debugPreviewAmbient('market', 0.9) },
        huntChase: { description: 'Preview the active hunter and deer chase', run: () => engine?.debugPreviewAmbient('hunt', 0.4) },
        huntSuccess: { description: 'Preview a successful hunt returning to the castle', run: () => engine?.debugPreviewAmbient('hunt', 0.76, true) },
        huntMiss: { description: 'Preview a failed hunt returning empty-handed', run: () => engine?.debugPreviewAmbient('hunt', 0.76, false) },
        triggerIdleStory: { description: 'Trigger an ambient story by ID (1–250), or a random one', run: input => engine?.debugTriggerAmbient(Number(input) || 0) },
        previewIdleStory: {
          description: 'Preview an ambient story at an exact normalized progress',
          run: input => {
            const preview = input as { storyId?: number, progress?: number }
            engine?.debugPreviewAmbientStory(Number(preview?.storyId) || 1, Number(preview?.progress) || 0.5)
          }
        },
        grantAether: { description: 'Grant audit Aether in development', run: input => engine?.debugGrantAether(Number(input) || 1000) },
        buildLoadout: { description: 'Build a balanced development loadout', run: () => engine?.debugBuildLoadout() },
        spendEconomically: { description: 'Invest only currently available Aether in a balanced loadout', run: () => engine?.debugSpendEconomically() },
        toggleRoadLab: { description: 'Toggle unlimited Aether and frontier claims', run: () => engine?.debugToggleSandbox() },
        setTimeScale: { description: 'Set development simulation speed from 1–10', run: input => engine?.debugSetTimeScale(Number(input) || 1) },
        previewLateWave: { description: 'Prepare a mixed guardian wave for art inspection', run: () => engine?.debugPreviewLateWave() },
        offerRelics: { description: 'Open a deterministic relic draft for UI and drag testing', run: () => engine?.debugOfferRelics() },
        togglePause: { description: 'Pause or resume the simulation', run: () => engine?.togglePause() },
        restart: { description: 'Start a fresh run', run: restart }
      }
    })
  }
})

onBeforeUnmount(() => {
  if (cooldownClock) clearInterval(cooldownClock)
  if (saveTimer) clearTimeout(saveTimer)
  void saveRun()
  unregisterDevBridge()
  engine?.destroy()
})

watch(hintsEnabled, enabled => localStorage.setItem('pathwarden-hints', enabled ? 'on' : 'off'))
watch(() => [snapshot.value.phase, snapshot.value.wave] as const, ([phase, wave]) => {
  if (phase === 'checkpoint') void claimCheckpointReward(wave)
})
</script>

<template>
  <div class="pathwarden-shell min-h-full p-3 sm:p-5">
    <div class="mx-auto max-w-[1600px] space-y-4">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div class="mb-1 flex items-center gap-2">
          <UBadge color="primary" variant="subtle">The Shrouded March</UBadge>
          <UBadge color="warning" variant="subtle">Realm {{ snapshot.realm }}</UBadge>
          <UBadge color="neutral" variant="outline">Coins settle later</UBadge>
        </div>
        <h1 class="pathwarden-title text-2xl font-black text-default sm:text-4xl">PATHWARDEN</h1>
        <p class="mt-1 max-w-2xl text-sm text-muted">
          Reveal the frontier. Bend the road. Break the horde.
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <UButton to="/pathwarden/wiki" size="sm" color="neutral" variant="soft" icon="i-lucide-book-open">
            Wiki
          </UButton>
          <UButton to="/pathwarden/shop" size="sm" color="primary" variant="soft" icon="i-lucide-store">
            Shop
          </UButton>
          <UButton to="/pathwarden/leaderboard" size="sm" color="neutral" variant="soft" icon="i-lucide-trophy">
            Rankings
          </UButton>
          <UButton size="sm" color="neutral" variant="soft" icon="i-lucide-flask-conical" @click="simulatorOpen = true">
            Battle simulator
          </UButton>
        </div>
        <div v-if="isDev" class="mt-3 flex flex-wrap items-center gap-2">
          <UButton size="xs" color="error" variant="soft" icon="i-lucide-trash-2" :loading="clearingDebugCache" @click="clearDebugCache">
            Clear cache
          </UButton>
          <UButton size="xs" color="warning" variant="soft" icon="i-lucide-map" @click="revealEntireMap">
            Reveal map
          </UButton>
          <UButton
            size="xs"
            color="neutral"
            :variant="devGuidesEnabled ? 'solid' : 'soft'"
            icon="i-lucide-ruler"
            @click="toggleDevGuides"
          >
            Toggle guides
          </UButton>
          <div class="flex min-w-[20rem] flex-1 flex-wrap items-center gap-2">
            <USelect
              v-model="selectedIdleStoryId"
              :items="idleStoryItems"
              value-key="value"
              class="min-w-[18rem] flex-1"
              size="xs"
            />
            <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-clapperboard" @click="previewSelectedIdleStory">
              Preview idle
            </UButton>
            <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-trees" @click="playSelectedIdleStory">
              Play idle
            </UButton>
          </div>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
        <div class="hud-stat rounded-lg border border-default bg-elevated/90 px-3 py-2">
          <p class="text-xs text-muted">Wave</p>
          <p class="font-bold tabular-nums">{{ snapshot.wave }}/12</p>
        </div>
        <div v-if="!snapshot.introStoryActive && !snapshot.openingCinematic" class="hud-stat rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
          <p class="text-xs text-muted">Aether</p>
          <p class="font-bold tabular-nums text-primary">{{ formatNumber(snapshot.aether, false) }}</p>
        </div>
        <div class="hud-stat rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
          <p class="text-xs text-muted">Aether bonus</p>
          <p class="font-bold tabular-nums text-warning">{{ formatNumber(checkpointOffer) }}</p>
        </div>
        <div class="hud-stat rounded-lg border border-default bg-elevated/90 px-3 py-2">
          <p class="text-xs text-muted">Enemies</p>
          <p class="font-bold tabular-nums">{{ snapshot.enemies }}</p>
        </div>
        <div class="hud-stat rounded-lg border border-default bg-elevated/90 px-3 py-2">
          <p class="text-xs text-muted">{{ snapshot.streak > 1 ? 'Streak' : 'Score' }}</p>
          <p class="font-bold tabular-nums" :class="{ 'text-warning': snapshot.streak > 1 }">
            {{ snapshot.streak > 1 ? `${snapshot.streak}×` : formatNumber(snapshot.score) }}
          </p>
        </div>
      </div>
    </div>

    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_292px]">
      <div class="battlefield-frame relative self-start overflow-hidden rounded-2xl border border-primary/30 bg-elevated shadow-2xl">
        <canvas
          ref="canvas"
          class="block aspect-[30/19] h-auto w-full cursor-crosshair touch-none"
          aria-label="Pathwarden tower defense battlefield"
          @dragover.prevent
          @drop.prevent="dropRelic"
        />
        <div v-if="snapshot.introStoryActive || snapshot.openingCinematic" class="story-book pointer-events-auto absolute inset-0 z-30 p-3 sm:p-8">
          <div class="story-book-pages mx-auto grid h-full max-w-5xl grid-cols-1 overflow-hidden rounded-[1.4rem] border border-amber-200/35 shadow-2xl sm:grid-cols-2">
            <article class="story-page relative flex flex-col justify-center px-7 py-10 sm:px-12">
              <div v-if="snapshot.openingCinematic" class="story-page-text">
                <p class="text-[10px] font-black uppercase tracking-[0.24em] text-amber-700/80">The holy war</p>
                <h2 class="mt-3 font-serif text-3xl font-black leading-tight tracking-wide text-amber-950 sm:text-5xl">The god descends in fury</h2>
                <p class="mt-5 max-w-md text-sm leading-7 text-amber-950/80 sm:text-base">He covered the lands in fog and summoned loyal armies to carry his judgment beyond the temple walls.</p>
              </div>
              <div v-else class="story-page-text">
                <p class="text-[10px] font-black uppercase tracking-[0.24em] text-amber-700/80">{{ introStorySlide.kicker }}</p>
                <h2 class="mt-3 font-serif text-3xl font-black leading-tight tracking-wide text-amber-950 sm:text-5xl">{{ introStorySlide.title }}</h2>
                <p class="mt-5 max-w-md text-sm leading-7 text-amber-950/80 sm:text-base">{{ introStorySlide.body }}</p>
              </div>
              <button
                v-if="snapshot.introStoryActive && snapshot.introStoryIndex > 0"
                type="button"
                aria-label="Previous story page"
                class="page-ear page-ear-left bottom-0 left-0"
                @click.stop="previousIntroStory"
              >
                <span class="sr-only">Turn to the previous page</span>
              </button>
            </article>
            <article class="story-page story-illustration relative min-h-52">
              <div :key="snapshot.introStoryIndex" class="page-turn-leaf" aria-hidden="true" />
              <span v-if="!snapshot.openingCinematic" class="absolute right-5 top-5 z-10 text-[9px] font-black uppercase tracking-[0.24em] text-amber-900/45">Illustration {{ snapshot.introStoryIndex + 1 }}/{{ introStory.length }}</span>
              <button
                v-if="snapshot.introStoryActive && !showDefileTemple"
                type="button"
                aria-label="Next story page"
                class="page-ear page-ear-right bottom-0 right-0"
                @click.stop="nextIntroStory"
              >
                <span class="sr-only">Turn to the next page</span>
              </button>
              <button
                v-if="snapshot.introStoryActive && showDefileTemple"
                type="button"
                aria-label="Defile the Temple"
                class="page-ear page-ear-right page-ear-action bottom-0 right-0"
                @click.stop="defileTemple"
              >
                <UIcon name="i-lucide-flame" class="size-5" />
              </button>
            </article>
          </div>
        </div>
        <div
          v-if="snapshot.activeRunScene"
          class="pointer-events-auto absolute inset-0 z-30 flex items-end justify-center bg-transparent p-4 sm:p-8"
        >
          <div class="w-full max-w-md rounded-2xl border border-violet-200/30 bg-slate-950/75 p-5 text-center shadow-2xl backdrop-blur-md">
            <p class="text-[10px] font-black uppercase tracking-[0.24em] text-violet-200/80">The defense continues</p>
            <p class="mt-2 text-sm leading-6 text-slate-200">The keep is under assault. Farmers shelter inside while the wardens hold the gate beneath the god’s furious gaze.</p>
            <UButton class="mt-4" color="primary" size="lg" icon="i-lucide-shield" @click.stop="continueDefense">
              Continue the Defense
            </UButton>
          </div>
        </div>
        <div v-if="!snapshot.introStoryActive && !snapshot.openingCinematic" class="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-xl border border-primary/40 bg-background/85 px-3 py-2 shadow-xl backdrop-blur-md">
          <span class="relative flex size-9 items-center justify-center rounded-lg border border-primary/40 bg-primary/15 shadow-[0_0_18px_rgba(34,211,238,0.2)]">
            <PathwardenAetherIcon class="size-7 text-primary drop-shadow-[0_0_5px_currentColor]" />
          </span>
          <span>
            <span class="block text-[10px] font-black uppercase tracking-[0.18em] text-muted">Aether</span>
            <strong class="block text-lg leading-none tabular-nums text-primary">{{ formatNumber(snapshot.aether, false) }}</strong>
          </span>
        </div>
        <div v-if="!snapshot.introStoryActive && !snapshot.openingCinematic" class="pointer-events-auto absolute left-3 top-[4.75rem] z-20">
          <UTooltip text="Open building inventory">
            <UButton
              class="building-shop-button relative gap-2 shadow-lg"
              :class="{ 'building-shop-button-active': snapshot.phase === 'planning' }"
              :color="snapshot.phase === 'planning' ? 'warning' : 'neutral'"
              :variant="snapshot.phase === 'planning' ? 'solid' : 'soft'"
              size="sm"
              icon="i-lucide-hammer"
              aria-label="Open building inventory"
              @click.stop="openBuildingInventory"
            >
              Open shop
              <UIcon v-if="snapshot.phase === 'planning'" name="i-lucide-sparkles" class="size-3.5" />
            </UButton>
          </UTooltip>
        </div>
        <div
          v-if="snapshot.relicInventory.length"
          class="absolute left-3 top-[4.75rem] max-w-[min(26rem,calc(100%-1.5rem))] rounded-xl border border-default bg-background/85 p-2 shadow-xl backdrop-blur-md"
        >
          <div class="mb-1 flex items-center justify-between gap-4">
            <span class="text-[10px] font-black uppercase tracking-[0.16em] text-muted">Relic belt · drag onto a defense</span>
            <span v-if="snapshot.canSellRelics" class="text-[10px] text-warning">Checkpoint selling open</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <div
              v-for="relic in snapshot.relicInventory"
              :key="relic.instanceId"
              class="group relative"
            >
              <button
                type="button"
                draggable="true"
                class="size-12 rounded-lg border-2 bg-elevated shadow-lg transition hover:-translate-y-1"
                :class="rarityClass(relic.rarity)"
                :title="`${relic.name}: ${relic.description}`"
                :style="relicIconStyle(relic)"
                @dragstart="dragRelic($event, relic)"
              />
              <button
                v-if="snapshot.canSellRelics"
                type="button"
                class="absolute -right-1 -top-1 hidden size-5 items-center justify-center rounded-full bg-warning text-[9px] font-black text-inverted shadow group-hover:flex"
                :title="`Sell for ${relic.sellValue} Aether`"
                @click="sellRelic(relic.instanceId)"
              >
                {{ relic.sellValue }}
              </button>
            </div>
          </div>
        </div>
        <div
          v-if="snapshot.selectedBuilding"
          class="pointer-events-auto absolute right-3 top-3 z-20 max-h-[calc(100%-1.5rem)] w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-primary/40 bg-elevated/95 p-4 shadow-2xl backdrop-blur-md"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs font-bold uppercase tracking-wider text-primary">Building profile</p>
              <h3 class="mt-1 font-black">{{ snapshot.selectedBuilding.name }}</h3>
            </div>
            <div class="flex items-center gap-2">
              <UBadge color="primary" variant="subtle">★ {{ snapshot.selectedBuilding.level }}</UBadge>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                aria-label="Close building profile"
                @click.stop="closeBuildingProfile"
              />
            </div>
          </div>
          <p class="mt-1 text-xs text-muted">Drag to move, or drop onto an equal defense to fuse.</p>
          <div class="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div class="rounded-md bg-background/70 p-2"><span class="block text-muted">Type</span><strong class="capitalize">{{ snapshot.selectedBuilding.archetype }}</strong></div>
            <div class="rounded-md bg-background/70 p-2"><span class="block text-muted">Blueprint tier</span><strong>Tier {{ snapshot.selectedBuilding.tier }}</strong></div>
            <div class="rounded-md bg-background/70 p-2"><span class="block text-muted">Merges</span><strong>{{ snapshot.selectedBuilding.merges }}</strong></div>
            <div class="rounded-md bg-background/70 p-2"><span class="block text-muted">Invested</span><strong class="text-primary">{{ snapshot.selectedBuilding.invested }} Aether</strong></div>
            <div class="rounded-md bg-background/70 p-2"><span class="block text-muted">Elevation</span><strong>+{{ snapshot.selectedBuilding.elevation }}</strong></div>
            <div class="rounded-md bg-background/70 p-2"><span class="block text-muted">Family</span><strong class="capitalize">{{ snapshot.selectedBuilding.family }}</strong></div>
          </div>
          <div v-if="snapshot.selectedBuilding.relicFamily" class="mt-3 rounded-md border border-primary/30 bg-primary/10 p-2">
            <p class="mb-1 text-[10px] font-black uppercase tracking-wider text-primary">Bound upgrade</p>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-md p-1 text-left transition hover:bg-primary/10"
              :class="inspectedUpgradeFamily === snapshot.selectedBuilding.relicFamily ? 'bg-primary/15' : ''"
              @click="inspectUpgrade(snapshot.selectedBuilding.relicFamily)"
            >
              <span
                class="block size-10 shrink-0 rounded-lg border-2 border-primary/50 bg-elevated bg-no-repeat shadow-lg"
                :style="relicIconStyle({ iconIndex: snapshot.selectedBuilding.relicIconIndex })"
              />
              <span class="min-w-0">
                <strong class="block truncate text-xs text-primary">{{ snapshot.selectedBuilding.relicName }}</strong>
                <span class="block text-[11px] text-muted">Level {{ snapshot.selectedBuilding.relicStacks }} · power {{ snapshot.selectedBuilding.relicPower.toFixed(2) }}</span>
              </span>
            </button>
          </div>
          <div v-if="snapshot.selectedBuilding.globalRelics.length" class="mt-3 rounded-md border border-info/30 bg-info/10 p-2">
            <p class="mb-1 text-[10px] font-black uppercase tracking-wider text-info">Global relics affecting defenses</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="relic in snapshot.selectedBuilding.globalRelics"
                :key="relic.family"
                type="button"
                class="rounded-lg border-2 border-info/50 bg-elevated bg-no-repeat p-1 shadow-lg transition hover:-translate-y-0.5"
                :class="inspectedUpgradeFamily === relic.family ? 'ring-2 ring-info' : ''"
                :style="relicIconStyle(relic)"
                :title="`${relic.name} · level ${relic.level}`"
                :aria-label="`Inspect ${relic.name}`"
                @click="inspectUpgrade(relic.family)"
              >
                <span class="block size-8" />
              </button>
            </div>
          </div>
          <div v-if="selectedUpgrade" class="mt-3 rounded-md border border-default bg-background/70 p-3">
            <div class="flex items-start gap-2">
              <span
                class="block size-11 shrink-0 rounded-lg border-2 border-primary/50 bg-elevated bg-no-repeat shadow-lg"
                :style="relicIconStyle(selectedUpgrade)"
              />
              <div class="min-w-0">
                <p class="text-[10px] font-black uppercase tracking-wider text-muted">{{ selectedUpgrade.global ? 'Global effect' : 'Tower upgrade' }}</p>
                <strong class="block text-sm">{{ selectedUpgrade.name }}</strong>
                <p class="text-[11px] text-muted">Level {{ selectedUpgrade.level }} · total boost power {{ selectedUpgrade.power.toFixed(2) }}</p>
              </div>
            </div>
            <p class="mt-2 text-xs leading-5 text-default">{{ selectedUpgrade.description }}</p>
          </div>
          <div class="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div class="rounded-md bg-background/70 p-2"><span class="block text-muted">Damage</span><strong>{{ snapshot.selectedBuilding.damage }}</strong></div>
            <div class="rounded-md bg-background/70 p-2"><span class="block text-muted">Range</span><strong>{{ snapshot.selectedBuilding.range }}</strong></div>
            <div class="rounded-md bg-background/70 p-2"><span class="block text-muted">Cooldown</span><strong>{{ snapshot.selectedBuilding.rate }}s</strong></div>
          </div>
          <div class="mt-3">
            <p class="mb-1 text-xs font-bold uppercase tracking-wider text-muted">Target priority</p>
            <div class="grid grid-cols-3 gap-1">
              <UButton
                v-for="targeting in targetingModes"
                :key="targeting"
                size="xs"
                :color="snapshot.selectedBuilding.targeting === targeting ? 'primary' : 'neutral'"
                :variant="snapshot.selectedBuilding.targeting === targeting ? 'solid' : 'soft'"
                :disabled="snapshot.phase !== 'planning'"
                @click="setTargeting(targeting)"
              >
                {{ targeting === 'first' ? 'First' : targeting === 'strong' ? 'Strong' : 'Fast' }}
              </UButton>
            </div>
          </div>
          <UButton class="mt-3" color="neutral" variant="outline" block icon="i-lucide-hammer" :disabled="snapshot.phase !== 'planning'" @click="salvageBuilding">
            Dismantle · +{{ snapshot.selectedBuilding.salvage }} Aether
          </UButton>
        </div>
        <div
          v-if="snapshot.phase === 'checkpoint'"
          class="absolute inset-0 flex items-center justify-center bg-background/80 p-4 backdrop-blur-md"
        >
          <UCard class="w-full max-w-xl border-warning/40 bg-elevated/95 text-center">
            <UIcon name="i-lucide-landmark" class="mx-auto size-11 text-warning" />
            <p class="mt-3 text-xs font-black uppercase tracking-[0.3em] text-warning">Checkpoint {{ snapshot.wave / 4 }}</p>
            <h2 class="mt-1 text-3xl font-black">{{ snapshot.wave === 12 ? 'THE REALM STANDS' : 'CHECKPOINT SECURED' }}</h2>
            <div class="mx-auto mt-3 max-w-md space-y-2 text-sm text-muted">
              <p class="rounded-lg border border-success/30 bg-success/10 px-3 py-2">
                <strong class="text-success">{{ formatNumber(checkpointReward, false) }} Coins</strong>
                checkpoint reward secured for reaching this milestone.
              </p>
              <p>
                Your {{ formatNumber(snapshot.aether, false) }} remaining Aether can add
                <strong class="text-warning">{{ formatNumber(checkpointAetherBonus, false) }} bonus Coins</strong>
                at {{ formatNumber(checkpointRate, false) }} Coins per Aether.
              </p>
              <p class="text-xs">Continuing risks only the Aether bonus; the checkpoint reward is yours.</p>
            </div>
            <div class="mt-5 grid gap-2 sm:grid-cols-2">
              <UButton
                v-if="snapshot.wave < 12"
                color="warning"
                variant="soft"
                block
                icon="i-lucide-landmark"
                :loading="settling"
                @click="cashOut"
              >
                Cash out Aether bonus · {{ formatNumber(checkpointAetherBonus) }}
              </UButton>
              <UButton
                color="primary"
                block
                :class="{ 'sm:col-span-2': snapshot.wave === 12 }"
                :icon="snapshot.wave === 12 ? 'i-lucide-crown' : 'i-lucide-route'"
                @click="continueCheckpoint"
              >
                {{ snapshot.wave === 12 ? 'Claim victory' : 'Continue the march' }}
              </UButton>
            </div>
          </UCard>
        </div>
        <div
          v-if="snapshot.phase === 'upgrade'"
          class="absolute inset-0 flex items-center justify-center bg-background/75 p-4 backdrop-blur-md"
        >
          <div class="w-full max-w-3xl">
            <p class="mb-1 text-center text-xs font-bold uppercase tracking-[0.3em] text-primary">The road remembers</p>
            <h2 class="mb-5 text-center text-3xl font-black">CLAIM A RELIC</h2>
            <div class="grid gap-3 md:grid-cols-3">
              <UButton
                v-for="upgrade in upgradeChoices"
                :key="upgrade.id"
                color="neutral"
                variant="outline"
                class="relic-card h-44 justify-center bg-elevated/95 text-center"
                :class="rarityClass(upgrade.rarity)"
                @click="chooseUpgrade(upgrade)"
              >
                <span>
                  <span
                    class="mx-auto mb-2 block size-16 rounded-xl bg-contain bg-no-repeat"
                    :style="relicIconStyle(upgrade)"
                  />
                  <span class="mb-1 block text-[10px] font-black uppercase tracking-[0.18em]">{{ upgrade.rarity }}</span>
                  <strong class="block">{{ upgrade.name }}</strong>
                  <span class="mt-1 block text-xs text-muted">{{ upgrade.description }}</span>
                </span>
              </UButton>
            </div>
          </div>
        </div>
        <div
          v-if="snapshot.phase === 'victory' || snapshot.phase === 'cashout'"
          class="absolute inset-0 flex items-center justify-center bg-background/85 p-4 backdrop-blur-md"
        >
          <div class="text-center">
            <UIcon :name="snapshot.phase === 'victory' ? 'i-lucide-crown' : 'i-lucide-landmark'" class="mx-auto mb-3 size-12 text-primary" />
            <h2 class="text-3xl font-bold">{{ snapshot.phase === 'victory' ? 'Realm defended' : 'March concluded' }}</h2>
            <p class="mt-2 text-muted">
              Score {{ formatNumber(snapshot.score, false) }} · {{ formatNumber(snapshot.coinsEarned, false) }} Coins secured
            </p>
            <UButton class="mt-5" icon="i-lucide-rotate-ccw" @click="restart">New run</UButton>
          </div>
        </div>
        <div
          v-if="snapshot.phase === 'defeat'"
          class="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center"
        >
          <UButton
            class="pointer-events-auto shadow-2xl"
            color="error"
            size="xl"
            icon="i-lucide-rotate-ccw"
            @click="restart"
          >
            Raise another keep
          </UButton>
        </div>
      </div>

      <aside class="space-y-3">
        <div v-if="snapshot.wave === 0 && snapshot.phase === 'planning'" class="rounded-xl border border-warning/30 bg-elevated/90 p-4 shadow-lg">
          <div class="flex items-center justify-between">
            <p class="text-xs font-black uppercase tracking-wider text-warning">Realm challenge</p>
            <span class="text-xs text-muted">Unlocked {{ unlockedRealm }}/5</span>
          </div>
          <div class="mt-3 grid grid-cols-5 gap-1">
            <UButton
              v-for="realm in 5"
              :key="realm"
              size="sm"
              :color="selectedRealm === realm ? 'warning' : 'neutral'"
              :variant="selectedRealm === realm ? 'solid' : 'soft'"
              :disabled="realm > unlockedRealm"
              :icon="realm > unlockedRealm ? 'i-lucide-lock' : undefined"
              @click="chooseRealm(realm)"
            >
              {{ realm }}
            </UButton>
          </div>
          <p class="mt-2 text-xs text-muted">Defend all 12 waves to unlock the next Realm. Higher Realms harden enemies and multiply score.</p>
          <div class="mt-3 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-2">
            <div>
              <p class="text-xs font-bold text-primary">Mist Surge</p>
              <p class="text-[11px] text-muted">{{ boostState?.surgeCharges ?? 0 }} prepared · +25% starting Aether, +10% damage</p>
            </div>
            <USwitch
              :model-value="useSurge"
              :disabled="(boostState?.surgeCharges ?? 0) < 1"
              @update:model-value="toggleSurge"
            />
          </div>
        </div>

        <div class="rounded-xl border border-primary/30 bg-elevated/90 p-4 shadow-lg">
          <div class="flex items-center justify-between gap-2">
            <p class="font-bold">{{ phaseLabel }}</p>
            <UBadge :color="snapshot.phase === 'wave' ? 'error' : 'primary'" variant="subtle">
              {{ snapshot.phase === 'wave' ? 'HORDE' : snapshot.phase === 'path' ? 'FRONTIER' : 'READY' }}
            </UBadge>
          </div>
          <p class="mt-2 min-h-10 text-sm text-muted">{{ snapshot.message }}</p>
          <UAlert
            v-if="hintsEnabled && snapshot.wave === 0"
            class="mt-2"
            color="info"
            variant="subtle"
            icon="i-lucide-lightbulb"
            title="Start with two complementary defenses. Saving Aether improves checkpoint value, but an undefended keep earns nothing."
          />
          <div v-if="snapshot.phase === 'planning'" class="rounded-lg border border-default bg-background/60 p-2 text-xs">
            <div class="flex items-center justify-between gap-2">
              <strong :class="snapshot.nextWave.checkpoint ? 'text-warning' : 'text-primary'">
                {{ snapshot.nextWave.checkpoint ? 'Checkpoint' : `Wave ${snapshot.nextWave.number}` }}
              </strong>
              <span class="text-muted">{{ snapshot.nextWave.enemies }} foes · {{ snapshot.nextWave.exits }} exits</span>
            </div>
            <p class="mt-1 truncate text-muted">{{ snapshot.nextWave.threats.join(' · ') }}</p>
            <p class="mt-1 text-primary">{{ snapshot.flawlessWaves }} flawless wave{{ snapshot.flawlessWaves === 1 ? '' : 's' }}</p>
          </div>
          <UButton
            v-if="snapshot.phase === 'planning'"
            block
            class="mt-3"
            icon="i-lucide-swords"
            :disabled="snapshot.introStoryActive || snapshot.activeRunScene || snapshot.openingCinematic || snapshot.towers === 0 || (snapshot.wave === 0 && coolingDown)"
            @click="startWave"
          >
            {{ snapshot.openingCinematic ? 'The mist is gathering…' : `Call wave ${snapshot.wave + 1}` }}
          </UButton>
          <UAlert
            v-if="snapshot.wave === 0 && coolingDown"
            class="mt-3"
            color="warning"
            variant="soft"
            icon="i-lucide-hourglass"
            title="Wardens recovering"
            :description="`Next march in ${cooldownLabel}. Rush one started 10-minute block per Gem.`"
          >
            <template #actions>
              <UButton
                size="sm"
                color="primary"
                icon="i-lucide-gem"
                :loading="rushingCooldown"
                :disabled="!boostState?.debugMode && (boostState?.gems ?? 0) < (boostState?.runCooldown?.rushCost ?? 0)"
                @click="rushCooldown"
              >
                Ready now · {{ boostState?.runCooldown?.rushCost ?? 0 }}
              </UButton>
            </template>
          </UAlert>
          <UAlert
            v-else-if="snapshot.phase === 'path'"
            class="mt-3"
            color="info"
            icon="i-lucide-route"
            title="Choose a ? tile to reveal a road section"
          />
        </div>

        <UButton color="neutral" variant="ghost" block :icon="snapshot.paused ? 'i-lucide-play' : 'i-lucide-pause'" :disabled="snapshot.phase !== 'wave'" @click="togglePause">
          {{ snapshot.paused ? 'Resume battle' : 'Pause battle' }}
        </UButton>
        <UButton to="/pathwarden/shop" color="primary" variant="soft" block icon="i-lucide-store">
          Open Reliquary shop
        </UButton>
        <UButton
          v-if="runActive"
          color="error"
          variant="soft"
          block
          icon="i-lucide-flag"
          :disabled="!canAbandon"
          @click="abandonOpen = true"
        >
          {{ canAbandon ? 'Abandon march' : 'Retreat locked during battle' }}
        </UButton>
        <div class="flex items-center justify-between px-2">
          <span class="text-xs text-muted">Optional hints</span>
          <USwitch v-model="hintsEnabled" size="sm" />
        </div>
        <div class="flex items-center justify-between px-2">
          <span class="text-xs text-muted">Skip intro on new marches</span>
          <USwitch :model-value="skipIntro" :loading="savingPreferences" size="sm" @update:model-value="setSkipIntro" />
        </div>
        <UButton
          v-if="isDev"
          color="warning"
          variant="outline"
          block
          icon="i-lucide-flask-conical"
          @click="toggleRoadLaboratory"
        >
          Toggle road laboratory
        </UButton>
        <UButton
          v-if="isDev"
          color="primary"
          variant="outline"
          block
          icon="i-lucide-trees"
          @click="triggerRandomIdleStory"
        >
          Trigger random idle story
        </UButton>
        <p class="px-2 text-center text-[10px] text-muted">
          Isometric environment and character assets by Kenney · CC0
        </p>
      </aside>
    </div>

    <UModal
      v-model:open="defenseInventoryOpen"
      title="Warden’s building inventory"
      description="Choose a defense, compare its battlefield role, and inspect the effects of your permanent upgrades."
      :ui="{ content: 'sm:max-w-6xl' }"
    >
      <template #body>
        <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="text-xs font-black uppercase tracking-[.18em] text-primary">Arm the frontier</p>
                <p class="mt-1 text-sm text-muted">Owned defenses are sorted by their current march performance.</p>
              </div>
              <USelect
                v-model="defenseInventorySort"
                :items="defenseInventorySorts"
                value-key="value"
                class="w-48"
                size="sm"
              />
            </div>
            <UTabs v-model="defenseInventoryTab" :items="defenseInventoryTabs" class="mt-4" />
            <div v-if="inventoryDefenses.length" class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div
                v-for="defense in inventoryDefenses"
                :key="defense.id"
                role="button"
                tabindex="0"
                class="tower-button rounded-xl border p-2 text-left transition"
                :class="snapshot.selectedTower === defense.id ? 'border-primary bg-primary/10' : 'border-default hover:border-primary/50'"
                @click="selectTower(defense.id)"
                @keydown.enter="selectTower(defense.id)"
                @keydown.space.prevent="selectTower(defense.id)"
              >
                <div class="arsenal-preview h-28 overflow-hidden rounded-lg bg-background">
                  <PathwardenDefensePreview :defense="defense" compact />
                </div>
                <div class="mt-2 flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <strong class="block truncate text-sm">{{ defense.name }}</strong>
                    <span class="text-[11px] text-muted">{{ defenseArchetypeLabels[defense.archetype] }} · Tier {{ defense.tier }}</span>
                  </div>
                </div>
                <UButton
                  class="mt-2"
                  block
                  size="xs"
                  color="primary"
                  variant="soft"
                  :disabled="snapshot.phase !== 'planning'"
                  @click.stop="chooseInventoryDefense(defense.id)"
                >
                  Place for
                  <PathwardenAetherIcon class="size-3.5" />
                  {{ snapshot.towerCosts[defense.id] ?? defense.aetherCost }}
                </UButton>
              </div>
            </div>
            <UAlert
              v-else
              class="mt-4"
              color="info"
              variant="soft"
              icon="i-lucide-lock-keyhole"
              title="No defenses in this category"
              description="Unlock another blueprint in the Reliquary to expand this tab."
            />
          </div>

          <UCard class="h-fit border-primary/30 bg-elevated/80" :ui="{ body: 'p-4 sm:p-4' }">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-xs font-black uppercase tracking-[.18em] text-primary">Side profile</p>
                <h3 class="mt-1 text-xl font-black">{{ selectedInventoryDefense.name }}</h3>
                <p class="mt-1 text-xs text-muted">{{ defenseArchetypeLabels[selectedInventoryDefense.archetype] }} · Tier {{ selectedInventoryDefense.tier }}</p>
              </div>
              <UIcon name="i-lucide-hammer" class="size-6 shrink-0 text-primary" />
            </div>
            <div class="mt-3 overflow-hidden rounded-xl bg-background">
              <PathwardenDefensePreview :defense="selectedInventoryDefense" />
            </div>
            <p class="mt-3 text-sm leading-6 text-muted">{{ defenseLore[selectedInventoryDefense.id] }}</p>
            <p class="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-default">
              <strong class="text-primary">Warden’s advice:</strong> {{ defenseAdvice(selectedInventoryDefense) }}
            </p>
            <div class="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
              <div class="rounded-lg bg-background/70 p-2"><span class="block text-muted">Damage</span><strong class="text-base">{{ selectedInventoryStats.damage }}</strong><span class="block text-[10px] text-primary">{{ Math.round((defenseBoostEffects.damageMultiplier - 1) * 100) }}% boost</span></div>
              <div class="rounded-lg bg-background/70 p-2"><span class="block text-muted">Range</span><strong class="text-base">{{ selectedInventoryStats.range }}</strong><span class="block text-[10px] text-primary">{{ Math.round((defenseBoostEffects.rangeMultiplier - 1) * 100) }}% boost</span></div>
              <div class="rounded-lg bg-background/70 p-2"><span class="block text-muted">Reload</span><strong class="text-base">{{ selectedInventoryStats.rate }}s</strong><span class="block text-[10px] text-primary">{{ Math.round((defenseBoostEffects.rateMultiplier - 1) * 100) }}% faster</span></div>
              <div class="rounded-lg bg-background/70 p-2"><span class="block text-muted">Sustained DPS</span><strong class="text-base">{{ selectedInventoryStats.dps }}</strong><span class="block text-[10px] text-muted">before relics</span></div>
              <div class="rounded-lg bg-background/70 p-2"><span class="block text-muted">Splash</span><strong class="text-base">{{ selectedInventoryDefense.splash || '—' }}</strong><span class="block text-[10px] text-muted">impact radius</span></div>
              <div class="rounded-lg bg-background/70 p-2"><span class="block text-muted">Slow</span><strong class="text-base">{{ selectedInventoryDefense.slow ? `${Math.round(selectedInventoryDefense.slow * 100)}%` : '—' }}</strong><span class="block text-[10px] text-muted">control effect</span></div>
            </div>
            <div class="mt-4 space-y-2 border-t border-default pt-3 text-xs">
              <div class="flex justify-between gap-3"><span class="text-muted">Base profile</span><span class="tabular-nums">{{ selectedInventoryDefense.damage }} damage · {{ selectedInventoryDefense.range }} range</span></div>
              <div class="flex justify-between gap-3"><span class="text-muted">Current cost</span><strong class="text-primary tabular-nums">{{ selectedInventoryStats.cost }} Aether</strong></div>
              <div class="flex justify-between gap-3"><span class="text-muted">Available now</span><span class="tabular-nums" :class="snapshot.aether >= selectedInventoryStats.cost ? 'text-success' : 'text-error'">{{ snapshot.aether >= selectedInventoryStats.cost ? 'Affordable' : 'Save more Aether' }}</span></div>
            </div>
          </UCard>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="boostShopOpen" title="Warden’s Reliquary" description="Permanent upgrades bought with account Coins or Gems.">
      <template #body>
        <div v-if="boostState" class="space-y-4">
          <UAlert
            v-if="boostState.ambientProgress.freeBoostCredits > 0"
            color="success"
            variant="soft"
            icon="i-lucide-gift"
            title="Village Chronicler reward ready"
            description="Your next permanent upgrade is free—including a Gem upgrade."
          />
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-default bg-elevated p-3">
            <p class="text-sm text-muted">Upgrades apply when a new run begins.</p>
            <div class="flex items-center gap-3 text-sm font-black">
              <span class="text-warning"><UIcon name="i-lucide-coins" /> {{ formatNumber(permanentBalance) }}</span>
              <span class="text-primary"><UIcon name="i-lucide-gem" /> {{ formatNumber(boostState.gems, false) }}</span>
            </div>
          </div>
          <UCard class="overflow-hidden border-primary/30">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div class="boost-sprite size-20 shrink-0" :style="boostSpriteStyle({ col: 2, row: 1 })" />
              <div class="min-w-0 flex-1">
                <h3 class="font-black">Mist Surge charge</h3>
                <p class="mt-1 text-xs text-muted">One-run supercharge: +25% starting Aether, +10% damage and +5% attack speed. Charges are consumed when wave 1 begins.</p>
                <p class="mt-1 text-xs font-bold text-primary">{{ boostState.surgeCharges }} prepared</p>
              </div>
              <UButton
                color="primary"
                variant="soft"
                icon="i-lucide-gem"
                :loading="buyingSurge"
                :disabled="boostState.gems < boostState.surgeCostGems"
                @click="buySurge"
              >
                {{ boostState.surgeCostGems }}
              </UButton>
            </div>
          </UCard>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <UCard
              v-for="boost in boostState.boosts"
              :key="boost.id"
              class="boost-card relative overflow-hidden"
              :ui="{ body: 'p-4 sm:p-4' }"
            >
              <div>
                <div class="boost-sprite size-20 shrink-0" :style="boostSpriteStyle(boost.sprite)" />
                <UBadge
                  color="neutral"
                  variant="subtle"
                  class="absolute right-3 top-3 whitespace-nowrap tabular-nums"
                >
                  Lv. {{ boost.level }}/{{ boost.maxLevel }}
                </UBadge>
              </div>
              <h3 class="mt-3 font-black">{{ boost.name }}</h3>
              <p class="mt-1 min-h-10 text-xs leading-relaxed text-muted">{{ boost.description }}</p>
              <UButton
                class="mt-4 w-full justify-center"
                :color="boost.currency === 'gems' ? 'primary' : 'warning'"
                variant="soft"
                size="sm"
                :icon="boost.currency === 'gems' ? 'i-lucide-gem' : 'i-lucide-coins'"
                :loading="buyingBoost === boost.id"
                :disabled="boost.cost === null || buyingBoost !== null || (boost.currency === 'gems' ? boostState.gems < (boost.cost ?? 0) : permanentBalance < (boost.cost ?? 0))"
                @click="buyBoost(boost.id)"
              >
                {{ boost.cost === null ? 'Maximum level' : formatNumber(boost.cost, false) }}
              </UButton>
            </UCard>
          </div>
          <div>
            <h3 class="text-lg font-black">Defense blueprints</h3>
            <p class="mb-3 text-xs text-muted">Permanent Coin unlocks add tactical choices to the in-run arsenal. Their Aether costs still rise during each march.</p>
            <div class="grid gap-3 sm:grid-cols-3">
              <UCard v-for="defense in boostState.defenses.filter(defense => defense.coinCost > 0)" :key="defense.id">
                <UIcon :name="defense.id === 'ember' ? 'i-lucide-flame' : defense.id === 'storm' ? 'i-lucide-zap' : 'i-lucide-sun'" class="size-8 text-warning" />
                <h4 class="mt-2 font-black">{{ defense.name }}</h4>
                <p class="mt-1 min-h-10 text-xs text-muted">{{ defense.description }}</p>
                <UButton
                  class="mt-3"
                  block
                  color="warning"
                  variant="soft"
                  icon="i-lucide-coins"
                  :loading="buyingDefense === defense.id"
                  :disabled="defense.owned || permanentBalance < defense.coinCost || runActive"
                  @click="buyDefense(defense.id)"
                >
                  {{ defense.owned ? 'Owned' : formatNumber(defense.coinCost, false) }}
                </UButton>
              </UCard>
            </div>
          </div>
          <div>
            <h3 class="text-lg font-black">Citadel liveries</h3>
            <p class="mb-3 text-xs text-muted">Gem cosmetics are pure bragging rights. They never alter damage, Aether, health, odds, or settlement.</p>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <UCard v-for="skin in boostState.skins" :key="skin.id" class="text-center">
                <div
                  class="mx-auto size-16 rounded-xl border border-default shadow-inner"
                  :class="skin.palette === 'ember' ? 'bg-gradient-to-br from-red-950 to-orange-400' : skin.palette === 'verdant' ? 'bg-gradient-to-br from-emerald-950 to-yellow-400' : skin.palette === 'amethyst' ? 'bg-gradient-to-br from-violet-950 to-slate-200' : skin.palette === 'sun' ? 'bg-gradient-to-br from-yellow-300 to-blue-600' : 'bg-gradient-to-br from-slate-700 to-cyan-400'"
                />
                <h4 class="mt-2 text-sm font-black">{{ skin.name }}</h4>
                <p class="mt-1 min-h-12 text-[11px] text-muted">{{ skin.description }}</p>
                <UButton
                  class="mt-2"
                  block
                  size="xs"
                  :color="skin.equipped ? 'success' : 'primary'"
                  :variant="skin.equipped ? 'soft' : 'outline'"
                  :icon="skin.owned ? 'i-lucide-shirt' : 'i-lucide-gem'"
                  :loading="buyingSkin === skin.id"
                  :disabled="skin.equipped || runActive || (!skin.owned && boostState.gems < skin.gemCost)"
                  @click="skin.owned ? equipSkin(skin.id) : buySkin(skin.id)"
                >
                  {{ skin.equipped ? 'Equipped' : skin.owned ? 'Equip' : formatNumber(skin.gemCost, false) }}
                </UButton>
              </UCard>
            </div>
          </div>
        </div>
        <USkeleton v-else class="h-96 w-full rounded-xl" />
      </template>
    </UModal>
    <UModal
      v-model:open="simulatorOpen"
      title="Pathwarden battle simulator"
      description="Run 1,000 software-only randomized defenses without changing your active march."
      :ui="{ content: 'sm:max-w-5xl' }"
    >
      <template #body>
        <div class="space-y-5">
          <div class="grid gap-3 rounded-xl border border-default bg-elevated/60 p-4 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
            <UFormField label="Difficulty" description="Realm pressure, 1–5">
              <UInputNumber v-model="simulationDifficulty" :min="1" :max="5" />
            </UFormField>
            <UFormField label="Doctrine" description="Controls spending reserves and relic priorities">
              <USelect v-model="simulationStrategy" :items="simulationStrategies" class="w-full" />
            </UFormField>
            <UButton
              icon="i-lucide-play"
              :loading="simulatorRunning"
              :disabled="simulatorRunning"
              @click="runSimulator"
            >
              Run 1,000 marches
            </UButton>
          </div>

          <template v-if="simulationResult">
            <div class="grid gap-3 sm:grid-cols-4">
              <div class="rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p class="text-xs uppercase tracking-wide text-muted">Run success</p>
                <p class="mt-1 text-2xl font-black text-primary">{{ (simulationResult.successRate * 100).toFixed(1) }}%</p>
              </div>
              <div class="rounded-xl border border-default bg-elevated/60 p-3">
                <p class="text-xs uppercase tracking-wide text-muted">Final hearts</p>
                <p class="mt-1 text-2xl font-black">{{ simulationResult.averageFinalLives.toFixed(1) }}</p>
              </div>
              <div class="rounded-xl border border-default bg-elevated/60 p-3">
                <p class="text-xs uppercase tracking-wide text-muted">Aether preserved</p>
                <p class="mt-1 text-2xl font-black">{{ formatNumber(simulationResult.averageAetherPreserved, false) }}</p>
              </div>
              <div class="rounded-xl border border-default bg-elevated/60 p-3">
                <p class="text-xs uppercase tracking-wide text-muted">Enemy advance</p>
                <p class="mt-1 text-2xl font-black text-error">{{ (simulationResult.averageEnemyProgress * 100).toFixed(1) }}%</p>
              </div>
            </div>

            <div class="rounded-xl border border-default bg-elevated/40 p-4">
              <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 class="font-bold">Average enemy advance by wave</h3>
                  <p class="text-xs text-muted">Higher percentages mean enemies travelled closer to the keep.</p>
                </div>
                <div class="flex flex-wrap gap-1">
                  <UBadge v-for="priority in simulationResult.upgradePriorities" :key="priority" color="primary" variant="subtle">
                    {{ priority }}
                  </UBadge>
                </div>
              </div>
              <div class="overflow-x-auto">
                <ChartLine
                  :data="simulationResult.waves"
                  :x="simulationChartX"
                  :y="simulationChartY"
                  color="var(--ui-primary)"
                  :width="840"
                  height="h-56"
                  :tick-format="simulationChartTick"
                  :tooltip-template="simulationChartTooltip"
                />
              </div>
            </div>

            <div class="max-h-80 overflow-auto rounded-xl border border-default">
              <table class="w-full text-sm">
                <thead class="sticky top-0 bg-elevated text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th class="px-3 py-2">Wave</th>
                    <th class="px-3 py-2">Survival</th>
                    <th class="px-3 py-2">Hearts</th>
                    <th class="px-3 py-2">Aether</th>
                    <th class="px-3 py-2">Damage</th>
                    <th class="px-3 py-2">Advance</th>
                    <th class="px-3 py-2">Leaks</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr v-for="wave in simulationResult.waves" :key="wave.wave">
                    <td class="px-3 py-2 font-bold">{{ wave.wave }}</td>
                    <td class="px-3 py-2">{{ (wave.survivalRate * 100).toFixed(1) }}%</td>
                    <td class="px-3 py-2">{{ wave.averageLives.toFixed(1) }}</td>
                    <td class="px-3 py-2">{{ formatNumber(wave.averageAether, false) }}</td>
                    <td class="px-3 py-2">{{ formatNumber(wave.averageDamage) }}</td>
                    <td class="px-3 py-2">{{ (wave.averageProgress * 100).toFixed(1) }}%</td>
                    <td class="px-3 py-2">{{ wave.averageLeaks.toFixed(2) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
          <UAlert
            v-else
            color="info"
            variant="subtle"
            icon="i-lucide-cpu"
            title="Ready for a software-only run"
            description="Each run randomizes road length, defense placement, enemy profiles, and attack exposure using live defense stats."
          />
        </div>
      </template>
    </UModal>
    <UModal v-model:open="abandonOpen" title="Abandon this march?">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            The current map, buildings, Aether, and wave progress will be lost. Retreat is only available during a strategic phase.
          </p>
          <div class="grid gap-2 sm:grid-cols-2">
            <UButton
              color="primary"
              variant="soft"
              icon="i-lucide-gem"
              :loading="abandoning"
              :disabled="!boostState || boostState.gems < (boostState.abandonCost?.gems ?? 3)"
              @click="abandonRun('gems')"
            >
              Pay {{ boostState?.abandonCost?.gems ?? 3 }} Gems
            </UButton>
            <UButton
              color="warning"
              variant="soft"
              icon="i-lucide-coins"
              :loading="abandoning"
              :disabled="!boostState || permanentBalance < (boostState.abandonCost?.coins ?? 0)"
              @click="abandonRun('coins')"
            >
              Pay {{ formatNumber(boostState?.abandonCost?.coins ?? 0, false) }} Coins
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
    </div>
  </div>
</template>

<style scoped>
.pathwarden-shell {
  background:
    radial-gradient(circle at 50% 10%, color-mix(in srgb, var(--ui-primary) 11%, transparent), transparent 42%),
    linear-gradient(180deg, color-mix(in srgb, var(--ui-bg) 94%, #08152d), var(--ui-bg));
}

.pathwarden-title {
  letter-spacing: .08em;
  text-shadow: 0 0 28px color-mix(in srgb, var(--ui-primary) 35%, transparent);
}

.battlefield-frame {
  box-shadow:
    0 24px 70px rgb(2 6 23 / .48),
    0 0 0 1px color-mix(in srgb, var(--ui-primary) 15%, transparent),
    inset 0 0 40px rgb(2 6 23 / .35);
}

.hud-stat,
.tower-button,
.relic-card {
  backdrop-filter: blur(12px);
}

.tower-button:not(:disabled):hover,
.relic-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--ui-primary) 12%, transparent);
}

.arsenal-preview :deep(.defense-preview) {
  width: 100%;
  height: 100%;
  min-height: 0;
  border-radius: 0;
}

.arsenal-preview :deep(svg) {
  min-height: 0;
}

.arsenal-preview :deep(.preview-tier) {
  right: .2rem;
  top: .2rem;
  padding: .1rem .25rem;
  font-size: .5rem;
}

.building-shop-button-active {
  box-shadow: 0 0 0 1px rgb(251 191 36 / .45), 0 8px 24px rgb(251 191 36 / .2);
  animation: building-shop-glow 3.2s ease-in-out infinite;
}

.building-shop-button-active::after {
  position: absolute;
  top: .2rem;
  right: .2rem;
  width: .28rem;
  height: .28rem;
  border-radius: 9999px;
  background: rgb(254 243 199 / .95);
  box-shadow: 0 0 7px rgb(254 243 199 / .95);
  content: '';
  animation: building-shop-spark 2.4s ease-in-out infinite;
}

@keyframes building-shop-glow {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.08); }
}

@keyframes building-shop-spark {
  0%, 100% { opacity: .25; transform: scale(.7) translate(0, 0); }
  50% { opacity: 1; transform: scale(1.2) translate(-.1rem, .1rem); }
}

.boost-sprite {
  background-repeat: no-repeat;
}

.boost-card {
  background:
    radial-gradient(circle at 16% 10%, color-mix(in srgb, var(--ui-primary) 12%, transparent), transparent 42%),
    var(--ui-bg-elevated);
}

.story-book {
  background: rgb(8 15 28 / .18);
}

.story-book-pages {
  background: transparent;
  box-shadow: inset 0 0 0 5px rgb(91 60 28 / .22), 0 24px 60px rgb(2 6 23 / .5);
}

.story-page {
  background:
    radial-gradient(circle at 20% 12%, rgb(255 248 214 / .6), transparent 38%),
    linear-gradient(135deg, #f3e2b4, #d7b56f);
}

.story-page:first-child {
  border-right: 1px solid rgb(91 60 28 / .28);
}

.story-illustration {
  background: transparent;
}

.story-illustration-copy {
  max-width: 23rem;
  text-shadow: 0 2px 12px rgb(2 6 23 / .8);
}

.story-page-text {
  opacity: 1 !important;
}

.page-turn-leaf {
  position: absolute;
  inset: 0;
  z-index: 15;
  pointer-events: none;
  transform-origin: left center;
  background:
    linear-gradient(90deg, rgb(255 248 214 / .95), rgb(224 193 126 / .92) 78%, rgb(131 88 43 / .78)),
    #d9bd7b;
  box-shadow: -12px 0 22px rgb(68 42 18 / .22), inset 5px 0 12px rgb(255 255 255 / .22);
  animation: page-turn-leaf .62s cubic-bezier(.22, .72, .24, 1) both;
}

.page-ear {
  position: absolute;
  z-index: 20;
  display: flex;
  height: 4.25rem;
  width: 4.25rem;
  align-items: center;
  justify-content: center;
  color: rgb(77 48 23 / .72);
  background: transparent;
  box-shadow: none;
  transition: transform .2s ease, background-color .2s ease;
}

.page-ear-left {
  transform-origin: bottom left;
}

.page-ear::before {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 3.75rem;
  height: 3.75rem;
  content: '';
  background: linear-gradient(135deg, #b98c4f 0%, #d9bd7b 48%, #8d6339 49%, #6e4928 100%);
  box-shadow: 0 8px 18px rgb(35 22 10 / .2);
  clip-path: polygon(100% 0, 0 100%, 100% 100%);
}

.page-ear-left::before {
  right: auto;
  left: 0;
  background: linear-gradient(45deg, #b98c4f 0%, #d9bd7b 48%, #8d6339 49%, #6e4928 100%);
  clip-path: polygon(0 0, 0 100%, 100% 100%);
}

.page-ear:hover {
  transform: scale(1.08);
}

.page-ear-action {
  color: #271805;
}

.page-ear-action::before {
  background: linear-gradient(135deg, #f1bb34 0%, #f8d979 48%, #b77913 49%, #8a5707 100%);
}

.page-ear-action > * {
  position: absolute;
  right: .7rem;
  bottom: .7rem;
  z-index: 1;
}

@keyframes page-turn-leaf {
  0% { opacity: .98; transform: perspective(1400px) rotateY(0deg); }
  72% { opacity: .94; transform: perspective(1400px) rotateY(-76deg); }
  100% { opacity: 0; transform: perspective(1400px) rotateY(-90deg); }
}
</style>
