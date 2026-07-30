<script setup lang="ts">
import {
  PathwardenEngine,
  type PathwardenBoostEffects,
  type PathwardenRelicSwapDebugScenario,
  type PathwardenRelicSwapFocus,
  type PathwardenRelicSwapPreview,
  type PathwardenRelicSwapResult,
  type PathwardenSnapshot
} from '~/utils/pathwarden-engine'
import { PATHWARDEN_RELICS, pathwardenRelicProfile } from '~/utils/pathwarden-engine'

const props = withDefaults(defineProps<{
  liveMode?: boolean
  liveEngine?: PathwardenEngine | null
}>(), {
  liveMode: false,
  liveEngine: null
})

const canvas = ref<HTMLCanvasElement | null>(null)
const snapshot = ref<PathwardenSnapshot | null>(null)
const preview = ref<PathwardenRelicSwapPreview | null>(null)
const result = ref<PathwardenRelicSwapResult | null>(null)
const workbenchOpen = ref(false)
const workbenchCanvas = ref<HTMLCanvasElement | null>(null)
const oddsCanvas = ref<HTMLCanvasElement | null>(null)
const ritualCanvas = ref<HTMLCanvasElement | null>(null)
const ritualActive = ref(false)
type RitualEntity = {
  kind: 'old' | 'incoming' | 'ash-old' | 'ash-incoming'
  index: number
  x: number
  y: number
  radius: number
  title: string
  beforeName: string
  afterName: string
  beforeEffect: string
  afterEffect: string
  beforePower: number
  afterPower: number
  beforeState: string
  afterState: string
  degraded: boolean
}
const ritualEntities: RitualEntity[] = []
const selectedRitualEntity = ref<RitualEntity | null>(null)
let relicIconSheet: HTMLImageElement | null = null
type SettledCrystal = {
  id: number
  side: 'binding' | 'preservation'
  xOffset: number
  layer: number
  rotation: number
  scale: number
  color: string
  active: boolean
}
type AetherParticle = {
  side: 'binding' | 'preservation'
  mode: 'rain' | 'out' | 'transfer'
  progress: number
  startX: number
  startY: number
  endX: number
  endY: number
  color: string
  scale: number
  rotation?: number
  rotationSpeed?: number
  landed?: SettledCrystal
  settledAdded?: boolean
}

const oddsAnimation = {
  binding: 0,
  preservation: 0,
  targetBinding: 0,
  targetPreservation: 0,
  startedAt: 0,
  duration: 900,
  particles: [] as AetherParticle[],
  settled: [] as SettledCrystal[],
  crystalPool: [] as SettledCrystal[]
}
let oddsAnimationFrame: number | null = null
let oddsFlameFrame: number | null = null
let ritualFrame: number | null = null
let ritualStartedAt = 0
const ritualDuration = 7200
const arcanistInvestment = ref(0)
const arcanistOfferBonus = ref(0)
const arcanistFocus = ref<PathwardenRelicSwapFocus>('both')
const arcanistFocusOptions: Array<{ label: string, value: PathwardenRelicSwapFocus }> = [
  { label: 'Improve binding odds', value: 'binding' },
  { label: 'Split between both', value: 'both' },
  { label: 'Improve preservation odds', value: 'preservation' }
]
const arcanistInvestmentTiers = [
  { amount: 0, bonus: 0, label: 'No extra Aether', result: 'Base odds' },
  { amount: 5, bonus: 0.05, label: 'Use 5 Aether', result: '+5% odds' },
  { amount: 15, bonus: 0.10, label: 'Use 15 Aether', result: '+10% odds' },
  { amount: 30, bonus: 0.15, label: 'Use 30 Aether', result: '+15% odds' },
  { amount: 50, bonus: 0.20, label: 'Use 50 Aether', result: '+20% odds' }
]
const firstUnavailableTier = computed(() => {
  const balance = preview.value?.availableAether ?? 0
  return arcanistInvestmentTiers.find(tier => tier.amount > 0 && tier.amount > balance)
})
const hasExactInvestmentTier = computed(() => {
  const balance = preview.value?.availableAether ?? 0
  return arcanistInvestmentTiers.some(tier => tier.amount === balance)
})
function arcanistTierBonus(tier: typeof arcanistInvestmentTiers[number]) {
  const amount = arcanistTierAmount(tier)
  const isAdjustedTier = !hasExactInvestmentTier.value && firstUnavailableTier.value?.amount === tier.amount
  const requestedBonus = isAdjustedTier ? amount / 50 * 0.20 : tier.bonus
  const nextPreview = preview.value
  const oddsCap = nextPreview
    ? Math.max(0, 0.98 - Math.max(nextPreview.bindChance, nextPreview.preserveChance))
    : 0.20
  return Math.max(0, Math.min(0.20, requestedBonus, oddsCap))
}
const arcanistInvestmentBonus = computed(() => arcanistOfferBonus.value)
const arcanistBindingChance = computed(() => {
  const nextPreview = preview.value
  if (!nextPreview) return 0
  const bonus = arcanistFocus.value === 'preservation' ? 0 : arcanistInvestmentBonus.value * (arcanistFocus.value === 'both' ? 0.5 : 1)
  return Math.min(0.98, nextPreview.bindChance + bonus)
})
const arcanistPreserveChance = computed(() => {
  const nextPreview = preview.value
  if (!nextPreview) return 0
  const bonus = arcanistFocus.value === 'binding' ? 0 : arcanistInvestmentBonus.value * (arcanistFocus.value === 'both' ? 0.5 : 1)
  return Math.min(0.98, nextPreview.preserveChance + bonus)
})
const existingRelicId = ref('fire-common')
const incomingRelicId = ref('blast-common')
const towerLevel = ref(1)
const stacks = ref(1)
const arcanistLevel = ref(0)
const debugAetherBalance = ref(5_000)
let engine: PathwardenEngine | null = null

const relicOptions = PATHWARDEN_RELICS
  .filter(relic => relic.towerSpecific && relic.rarity === 'common')
  .map(relic => ({ label: `${relic.name} · ${relic.element}`, value: relic.id }))
const levelOptions = Array.from({ length: 5 }, (_, index) => ({ label: `Tower level ${index + 1}`, value: index + 1 }))
const stackOptions = Array.from({ length: 5 }, (_, index) => ({ label: `${index + 1} relic stack${index ? 's' : ''}`, value: index + 1 }))
const arcanistOptions = Array.from({ length: 11 }, (_, index) => ({ label: `Arcanist level ${index}`, value: index }))
const existingRelic = computed(() => PATHWARDEN_RELICS.find(relic => relic.id === existingRelicId.value)!)
const incomingRelic = computed(() => PATHWARDEN_RELICS.find(relic => relic.id === incomingRelicId.value)!)
const sameElement = computed(() => existingRelic.value?.element === incomingRelic.value?.element)
const sameRelicType = computed(() => existingRelicId.value === incomingRelicId.value)

function handleWorkbench(nextPreview: PathwardenRelicSwapPreview) {
  preview.value = nextPreview
  result.value = null
  selectedRitualEntity.value = null
  arcanistInvestment.value = 0
  arcanistOfferBonus.value = 0
  arcanistFocus.value = 'both'
  oddsAnimation.binding = nextPreview.bindChance
  oddsAnimation.preservation = nextPreview.preserveChance
  oddsAnimation.targetBinding = nextPreview.bindChance
  oddsAnimation.targetPreservation = nextPreview.preserveChance
  oddsAnimation.particles = []
  oddsAnimation.settled = []
  for (const crystal of oddsAnimation.crystalPool) crystal.active = false
  workbenchOpen.value = true
  void nextTick(() => {
    drawWorkbench()
    drawOdds()
  })
}

function drawWorkbench() {
  const canvas = workbenchCanvas.value
  const nextPreview = preview.value
  if (!canvas || !nextPreview) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const width = canvas.width
  const height = canvas.height
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, '#111b46')
  gradient.addColorStop(0.58, '#172554')
  gradient.addColorStop(1, '#080f27')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  const drawRune = (x: number, y: number, radius: number, color: string, rotation = 0) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rotation)
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.72
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([4, 7])
    ctx.beginPath()
    ctx.arc(0, 0, radius - 7, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    for (let index = 0; index < 6; index++) {
      const angle = index * Math.PI / 3
      ctx.beginPath()
      ctx.moveTo(Math.cos(angle) * (radius - 3), Math.sin(angle) * (radius - 3))
      ctx.lineTo(Math.cos(angle) * (radius + 5), Math.sin(angle) * (radius + 5))
      ctx.stroke()
    }
    ctx.restore()
  }

  const drawRelic = (x: number, y: number, iconIndex: number, color: string, stackIndex: number) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate((stackIndex - 1) * 0.08)
    ctx.shadowColor = color
    ctx.shadowBlur = 16
    ctx.fillStyle = `${color}33`
    ctx.beginPath()
    ctx.arc(0, 0, 24, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    if (relicIconSheet?.complete && relicIconSheet.naturalWidth > 0) {
      const sourceWidth = relicIconSheet.naturalWidth / 5
      const sourceHeight = relicIconSheet.naturalHeight / 3
      const sourceColumn = iconIndex % 5
      const sourceRow = Math.floor(iconIndex / 5)
      ctx.save()
      ctx.beginPath()
      ctx.arc(0, 0, 26, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(
        relicIconSheet,
        sourceColumn * sourceWidth,
        sourceRow * sourceHeight,
        sourceWidth,
        sourceHeight,
        -26,
        -26,
        52,
        52
      )
      ctx.restore()
      ctx.restore()
      return
    }
    ctx.fillStyle = color
    ctx.strokeStyle = '#f8fafc'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, -18)
    ctx.lineTo(13, -7)
    ctx.lineTo(10, 14)
    ctx.lineTo(0, 21)
    ctx.lineTo(-10, 14)
    ctx.lineTo(-13, -7)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,.78)'
    ctx.beginPath()
    ctx.moveTo(-5, -11)
    ctx.lineTo(0, -16)
    ctx.lineTo(2, 7)
    ctx.lineTo(-5, 12)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#172554'
    ctx.font = '900 11px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.fillText(String((iconIndex % 9) + 1), 0, 5)
    ctx.restore()
  }

  const drawSlot = (x: number, y: number, color: string, iconIndex: number, stackIndex: number) => {
    ctx.fillStyle = 'rgba(8, 15, 40, .86)'
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, 30, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    drawRune(x, y, 25, color, stackIndex * 0.15)
    drawRelic(x, y, iconIndex, color, stackIndex)
  }

  ctx.fillStyle = 'rgba(14, 116, 144, .16)'
  ctx.fillRect(0, height * 0.67, width, height * 0.33)
  for (let index = 0; index < 16; index++) {
    const x = 28 + index * 58
    ctx.strokeStyle = 'rgba(103, 232, 249, .12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, height * 0.67)
    ctx.lineTo(x + 26, height)
    ctx.stroke()
  }

  ctx.fillStyle = '#fef3c7'
  ctx.font = '900 22px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText('ARCANIST WORKBENCH', width / 2, 31)
  ctx.font = '700 11px sans-serif'
  ctx.fillStyle = '#bae6fd'
  ctx.fillText('SLOT THE OLD RELIC · CHOOSE THE NEW BINDING · BEGIN THE RITUAL', width / 2, 49)

  const leftColor = '#fda4af'
  const rightColor = '#86efac'
  const leftCount = Math.max(1, Math.min(5, nextPreview.existingStacks))
  const leftStart = width * 0.12
  const rightX = width * 0.88
  for (let index = 0; index < leftCount; index++) {
    drawSlot(leftStart + index * 48, 135, leftColor, nextPreview.existingIconIndex, index)
  }
  drawSlot(rightX, 135, rightColor, nextPreview.incomingIconIndex, 0)

  ctx.strokeStyle = 'rgba(250, 204, 21, .62)'
  ctx.lineWidth = 2
  ctx.setLineDash([5, 8])
  ctx.beginPath()
  ctx.moveTo(leftStart + Math.max(0, leftCount - 1) * 48 + 34, 135)
  ctx.bezierCurveTo(width * 0.34, 88, width * 0.66, 88, rightX - 34, 135)
  ctx.stroke()
  ctx.setLineDash([])
  drawRune(width / 2, 135, 39, '#facc15', performance.now() / 2800)
  ctx.fillStyle = '#facc15'
  ctx.font = '900 26px serif'
  ctx.fillText('✦', width / 2, 143)
  ctx.fillStyle = '#fecaca'
  ctx.font = '900 13px sans-serif'
  ctx.fillText(nextPreview.existingName, width * 0.2, 198)
  ctx.fillStyle = '#bbf7d0'
  ctx.fillText(nextPreview.incomingName, width * 0.8, 198)
  ctx.font = '700 10px sans-serif'
  ctx.fillStyle = '#94a3b8'
  ctx.fillText(`${leftCount} OLD SOCKET${leftCount === 1 ? '' : 'S'}`, width * 0.2, 216)
  ctx.fillText('1 NEW SOCKET', width * 0.8, 216)
  ctx.fillStyle = '#facc15'
  ctx.font = '900 11px sans-serif'
  ctx.fillText('RITUAL READY · THE RUNES ARE LISTENING', width / 2, 238)
}

function selectArcanistOffering(tier: typeof arcanistInvestmentTiers[number]) {
  const amount = arcanistTierAmount(tier)
  if (!preview.value || amount > preview.value.availableAether) return
  arcanistInvestment.value = amount
  arcanistOfferBonus.value = arcanistTierBonus(tier)
}

function arcanistTierAmount(tier: typeof arcanistInvestmentTiers[number]) {
  const balance = preview.value?.availableAether ?? 0
  return !hasExactInvestmentTier.value && firstUnavailableTier.value?.amount === tier.amount && balance > 0
    ? balance
    : tier.amount
}

function arcanistTierUnavailable(tier: typeof arcanistInvestmentTiers[number]) {
  const amount = arcanistTierAmount(tier)
  return amount > (preview.value?.availableAether ?? 0)
    || (tier.amount !== 0 && arcanistTierBonus(tier) <= 0)
}

function selectArcanistFocus(focus: PathwardenRelicSwapFocus) {
  arcanistFocus.value = focus
}

function acquireCrystal(side: SettledCrystal['side'], color: string) {
  let entity = oddsAnimation.crystalPool.find(crystal => !crystal.active)
  if (!entity && oddsAnimation.crystalPool.length < 40) {
    entity = {
      id: oddsAnimation.crystalPool.length,
      side,
      xOffset: 0,
      layer: 0,
      rotation: 0,
      scale: 0.55,
      color,
      active: false
    }
    oddsAnimation.crystalPool.push(entity)
  }
  if (!entity) return null
  entity.side = side
  entity.xOffset = -19 + Math.random() * 38
  entity.layer = Math.floor(Math.random() * 3)
  entity.rotation = Math.random() * Math.PI * 2
  entity.scale = 0.48 + Math.random() * 0.18
  entity.color = color
  entity.active = true
  return entity
}

function drawAetherCrystal(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, alpha: number, color: string, rotation = 0, sparkle = 0) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.translate(-32 * scale, -32 * scale)
  ctx.scale(scale, scale)
  ctx.fillStyle = color
  ctx.strokeStyle = '#fef3c7'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(25, 53)
  ctx.lineTo(17, 32)
  ctx.lineTo(24, 9)
  ctx.lineTo(36, 16)
  ctx.lineTo(40, 36)
  ctx.lineTo(33, 53)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = `${color}aa`
  ctx.beginPath()
  ctx.moveTo(36, 16)
  ctx.lineTo(45, 7)
  ctx.lineTo(53, 27)
  ctx.lineTo(40, 36)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,.72)'
  ctx.beginPath()
  ctx.moveTo(17, 32)
  ctx.lineTo(25, 11)
  ctx.lineTo(37, 18)
  ctx.lineTo(25, 32)
  ctx.closePath()
  ctx.fill()
  if (sparkle > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.45 + sparkle * 0.4})`
    ctx.beginPath()
    ctx.moveTo(46, 8 - sparkle * 3)
    ctx.lineTo(48, 14)
    ctx.lineTo(54, 16)
    ctx.lineTo(48, 18)
    ctx.lineTo(46, 24 + sparkle * 3)
    ctx.lineTo(44, 18)
    ctx.lineTo(38, 16)
    ctx.lineTo(44, 14)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function drawRiskFlame(ctx: CanvasRenderingContext2D, x: number, y: number, risk: number, now: number) {
  if (risk <= 0.01) return
  const flicker = 0.82 + Math.sin(now / 80 + x) * 0.12
  const size = (10 + risk * 27) * flicker
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.shadowColor = '#fb4f3f'
  ctx.shadowBlur = 10 + risk * 24
  ctx.fillStyle = `rgba(239, 68, 68, ${0.2 + risk * 0.45})`
  ctx.beginPath()
  ctx.arc(x, y - size * 0.3, size, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#ef4444'
  ctx.beginPath()
  ctx.moveTo(x, y + size * 0.55)
  ctx.lineTo(x - size * 0.68, y + size * 0.1)
  ctx.lineTo(x - size * 0.34, y - size * 0.15)
  ctx.lineTo(x - size * 0.45, y - size * 0.82)
  ctx.lineTo(x - size * 0.05, y - size * 0.48)
  ctx.lineTo(x + size * 0.14, y - size)
  ctx.lineTo(x + size * 0.3, y - size * 0.28)
  ctx.lineTo(x + size * 0.76, y - size * 0.55)
  ctx.lineTo(x + size * 0.5, y + size * 0.18)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#facc15'
  ctx.beginPath()
  ctx.moveTo(x, y + size * 0.36)
  ctx.lineTo(x - size * 0.34, y - size * 0.06)
  ctx.lineTo(x - size * 0.06, y - size * 0.72)
  ctx.lineTo(x + size * 0.18, y - size * 0.25)
  ctx.lineTo(x + size * 0.42, y - size * 0.48)
  ctx.lineTo(x + size * 0.23, y + size * 0.28)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#fef08a'
  ctx.lineWidth = 1.5 + risk * 2
  const bolts = Math.round(1 + risk * 4)
  for (let index = 0; index < bolts; index++) {
    const direction = index % 2 ? -1 : 1
    const boltX = x + direction * (size * 0.45 + index * 4)
    const boltY = y - size * 0.55 - index * 5
    ctx.beginPath()
    ctx.moveTo(boltX, boltY)
    ctx.lineTo(boltX + direction * size * 0.18, boltY - size * 0.24)
    ctx.lineTo(boltX + direction * size * 0.06, boltY - size * 0.18)
    ctx.lineTo(boltX + direction * size * 0.28, boltY - size * 0.48)
    ctx.stroke()
  }
  if (risk > 0.55) {
    ctx.fillStyle = '#fde68a'
    for (let index = 0; index < Math.round(risk * 8); index++) {
      const angle = index * 2.4 + now / 500
      const distance = size * (1.05 + (index % 3) * 0.28)
      ctx.beginPath()
      ctx.arc(x + Math.cos(angle) * distance, y - size * 0.25 + Math.sin(angle) * distance, 1.5 + risk * 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

function relicElementColor(element: string) {
  return {
    fire: '#fb7185',
    frost: '#93c5fd',
    lightning: '#facc15',
    poison: '#a3e635',
    sun: '#fde68a',
    arcane: '#c4b5fd'
  }[element] ?? '#67e8f9'
}

function mixHex(first: string, second: string, amount: number) {
  const parse = (value: string) => {
    const hex = value.replace('#', '')
    return [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))
  }
  const a = parse(first)
  const b = parse(second)
  const t = Math.max(0, Math.min(1, amount))
  return `#${a.map((channel, index) => Math.round(channel + (b[index]! - channel) * t).toString(16).padStart(2, '0')).join('')}`
}

function oddsSeverityColor(odds: number, _accent: string) {
  return mixHex('#ef4444', '#bae6fd', odds)
}

function drawScaleRelicIcon(ctx: CanvasRenderingContext2D, x: number, y: number, iconIndex: number, color: string, now = performance.now(), iconScale = 0.78) {
  const rotation = (iconIndex % 5 - 2) * 0.12
  const pulse = 0.5 + Math.sin(now / 320 + iconIndex) * 0.5
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.scale(iconScale, iconScale)
  ctx.shadowColor = color
  ctx.shadowBlur = 16 + pulse * 14
  ctx.globalAlpha = 0.18 + pulse * 0.12
  ctx.strokeStyle = color
  ctx.lineWidth = 2 + pulse * 2
  ctx.beginPath()
  ctx.arc(0, 0, 28 + pulse * 5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = 'rgba(8, 15, 40, .94)'
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(0, 0, 24, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = `${color}66`
  ctx.beginPath()
  ctx.moveTo(0, -17)
  ctx.lineTo(13, -7)
  ctx.lineTo(10, 13)
  ctx.lineTo(0, 19)
  ctx.lineTo(-10, 13)
  ctx.lineTo(-13, -7)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  if (relicIconSheet?.complete && relicIconSheet.naturalWidth > 0) {
    const sourceWidth = relicIconSheet.naturalWidth / 5
    const sourceHeight = relicIconSheet.naturalHeight / 3
    const sourceColumn = iconIndex % 5
    const sourceRow = Math.floor(iconIndex / 5)
    ctx.save()
    ctx.beginPath()
    ctx.arc(0, 0, 25, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(
      relicIconSheet,
      sourceColumn * sourceWidth,
      sourceRow * sourceHeight,
      sourceWidth,
      sourceHeight,
      -25,
      -25,
      50,
      50
    )
    ctx.restore()
    ctx.restore()
    return
  }
  ctx.beginPath()
  if (iconIndex % 3 === 0) {
    ctx.arc(0, 1, 8, 0, Math.PI * 2)
  } else if (iconIndex % 3 === 1) {
    ctx.moveTo(0, -10)
    ctx.lineTo(9, 8)
    ctx.lineTo(-9, 8)
    ctx.closePath()
  } else {
    ctx.moveTo(0, -10)
    ctx.lineTo(9, 0)
    ctx.lineTo(0, 10)
    ctx.lineTo(-9, 0)
    ctx.closePath()
  }
  ctx.stroke()
  ctx.restore()
}

function drawOdds() {
  const canvas = oddsCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const now = performance.now()
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const drawScale = (x: number, label: string, odds: number, color: string, elementColor: string, iconIndex: number) => {
    const severityColor = oddsSeverityColor(odds, color)
    const tilt = (odds - 0.5) * 0.72
    const beamY = 126
    const panY = 183
    const successOffset = Math.sin(tilt) * 38
    const riskOffset = -successOffset
    const side = label === 'BINDING' ? 'binding' : 'preservation'
    const drawPan = (panX: number, panOffset: number, isSuccess: boolean, elementColor: string, iconIndex: number) => {
      const panTop = panY + panOffset
      const drawPanPath = () => {
        ctx.beginPath()
        ctx.moveTo(panX - 34, panTop)
        ctx.quadraticCurveTo(panX, panTop + 18, panX + 34, panTop)
        ctx.lineTo(panX + 28, panTop + 8)
        ctx.quadraticCurveTo(panX, panTop + 25, panX - 28, panTop + 8)
        ctx.closePath()
      }
      ctx.strokeStyle = severityColor
      ctx.lineWidth = 3
      drawPanPath()
      ctx.stroke()
      ctx.fillStyle = isSuccess ? `${severityColor}32` : `${severityColor}4a`
      drawPanPath()
      ctx.fill()
      ctx.strokeStyle = `${severityColor}cc`
      ctx.lineWidth = 2
      const beamAnchorY = (anchorX: number) => beamY + (anchorX - x) * Math.sin(tilt)
      ctx.beginPath()
      ctx.moveTo(panX - 22, panY + panOffset)
      ctx.lineTo(panX - 34, beamAnchorY(panX - 34))
      ctx.moveTo(panX + 22, panY + panOffset)
      ctx.lineTo(panX + 34, beamAnchorY(panX + 34))
      ctx.stroke()
      if (isSuccess) {
        drawScaleRelicIcon(ctx, panX, panTop - 3, iconIndex, elementColor, now)
        for (const crystal of oddsAnimation.settled) {
          if (!crystal.active || crystal.side !== side) continue
          const panCurve = Math.abs(crystal.xOffset / 22) * 4
          drawAetherCrystal(
            ctx,
            panX + crystal.xOffset,
            panTop + 7 - panCurve - crystal.layer * 7,
            crystal.scale,
            0.96,
            crystal.color,
            crystal.rotation,
            Math.sin(now / 180 + crystal.rotation) > 0.25 ? 1 : 0
          )
        }
        ctx.strokeStyle = severityColor
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(panX - 34, panTop)
        ctx.quadraticCurveTo(panX, panTop + 18, panX + 34, panTop)
        ctx.stroke()
      } else {
        drawRiskFlame(ctx, panX, panTop + 2, 1 - odds, now)
      }
    }

    ctx.save()
    ctx.translate(x, beamY)
    ctx.rotate(tilt)
    ctx.strokeStyle = severityColor
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(-112, 0)
    ctx.lineTo(112, 0)
    ctx.stroke()
    ctx.fillStyle = severityColor
    ctx.beginPath()
    ctx.arc(0, 0, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = `${severityColor}cc`
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(0, 8)
    ctx.lineTo(0, 54)
    ctx.stroke()
    ctx.restore()
    drawPan(x - 68, riskOffset, false, color, iconIndex)
    drawPan(x + 68, successOffset, true, elementColor, iconIndex)
    ctx.fillStyle = `${severityColor}aa`
    ctx.beginPath()
    ctx.moveTo(x - 15, 180)
    ctx.lineTo(x + 15, 180)
    ctx.lineTo(x + 27, 222)
    ctx.lineTo(x - 27, 222)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = severityColor
    ctx.fillRect(x - 52, 220, 104, 8)
    ctx.font = '900 15px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#f8fafc'
    ctx.fillText(label, x, 30)
    ctx.font = '900 26px sans-serif'
    ctx.fillStyle = severityColor
    ctx.fillText(`${Math.round(odds * 100)}%`, x, 78)
    ctx.font = '700 11px sans-serif'
    ctx.fillStyle = '#94a3b8'
    ctx.fillText('RISK', x - 76, 238)
    ctx.fillText('SUCCESS', x + 76, 238)
  }
  const nextPreview = preview.value
  drawScale(225, 'BINDING', oddsAnimation.binding || arcanistBindingChance.value, '#38bdf8', relicElementColor(nextPreview?.incomingElement ?? 'arcane'), nextPreview?.incomingIconIndex ?? 0)
  drawScale(675, 'PRESERVE RELICS', oddsAnimation.preservation || arcanistPreserveChance.value, '#86efac', relicElementColor(nextPreview?.existingElement ?? 'arcane'), nextPreview?.existingIconIndex ?? 0)
  for (const particle of oddsAnimation.particles) {
    if (particle.settledAdded) continue
    const progress = Math.min(1, particle.progress)
    const eased = progress * progress * (3 - 2 * progress)
    const physicsY = particle.startY + (particle.endY - particle.startY) * eased + (particle.mode === 'transfer' ? Math.sin(progress * Math.PI) * -22 : progress * progress * 14)
    const rotation = (particle.rotation ?? 0) + (particle.rotationSpeed ?? 0) * progress
    const sparkle = 0.5 + Math.max(0, Math.sin(progress * 18 + (particle.rotation ?? 0) * 3)) * 0.5
    drawAetherCrystal(ctx, particle.startX + (particle.endX - particle.startX) * eased, physicsY, particle.scale, 1 - Math.max(0, progress - 0.8) * 5, particle.color, rotation, sparkle)
  }
}

function animateOddsTransition() {
  const nextBinding = arcanistBindingChance.value
  const nextPreservation = arcanistPreserveChance.value
  oddsAnimation.targetBinding = nextBinding
  oddsAnimation.targetPreservation = nextPreservation
  oddsAnimation.startedAt = performance.now()
  for (const particle of oddsAnimation.particles) {
    if (particle.landed && !particle.settledAdded) particle.landed.active = false
  }
  oddsAnimation.particles = []
  const crystalsForPercentage = (percentage: number) => Math.min(20, Math.max(0, Math.round(Math.abs(percentage) * 100)))
  const baseBinding = preview.value?.bindChance ?? nextBinding
  const basePreservation = preview.value?.preserveChance ?? nextPreservation
  const currentBinding = oddsAnimation.settled.filter(crystal => crystal.active && crystal.side === 'binding').length
  const currentPreservation = oddsAnimation.settled.filter(crystal => crystal.active && crystal.side === 'preservation').length
  const desiredBinding = crystalsForPercentage(nextBinding - baseBinding)
  const desiredPreservation = crystalsForPercentage(nextPreservation - basePreservation)
  const bindingUp = Math.max(0, desiredBinding - currentBinding)
  const preservationUp = Math.max(0, desiredPreservation - currentPreservation)
  const bindingDown = Math.max(0, currentBinding - desiredBinding)
  const preservationDown = Math.max(0, currentPreservation - desiredPreservation)
  const transferCount = Math.min(bindingUp + preservationUp, bindingDown + preservationDown)
  const addParticles = (side: 'binding' | 'preservation', delta: number, mode: 'rain' | 'out', requestedCount = crystalsForPercentage(delta)) => {
    const count = requestedCount
    const panX = side === 'binding' ? 293 : 743
    for (let index = 0; index < count; index++) {
      const landed = mode === 'rain' ? acquireCrystal(side, index % 2 ? '#67e8f9' : '#fde68a') : null
      if (mode === 'rain' && !landed) continue
      oddsAnimation.particles.push({
        side,
        mode,
        progress: index / count,
        startX: mode === 'rain' ? panX + (index % 5) * 10 : panX,
        startY: mode === 'rain' ? 54 - index * 3 : 184,
        endX: mode === 'rain' ? panX + landed!.xOffset : panX + (side === 'binding' ? -150 : 150),
        endY: mode === 'rain' ? 190 - landed!.layer * 7 : 70 + index * 3,
        color: landed?.color ?? (index % 2 ? '#67e8f9' : '#fde68a'),
        scale: 0.55 + (index % 3) * 0.08,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 2.8,
        landed: landed ?? undefined
      })
    }
  }
  const removeSettled = (side: 'binding' | 'preservation', count: number) => {
    let remaining = count
    oddsAnimation.settled = oddsAnimation.settled.filter(crystal => {
      if (crystal.side !== side || remaining <= 0) return true
      crystal.active = false
      remaining--
      return false
    })
  }
  if (transferCount > 0) {
    const fromBinding = bindingDown > 0
    const count = transferCount
    removeSettled('binding', bindingDown)
    removeSettled('preservation', preservationDown)
    for (let index = 0; index < count; index++) {
      oddsAnimation.particles.push({
        side: fromBinding ? 'preservation' : 'binding',
        mode: 'transfer',
        progress: index / count,
        startX: fromBinding ? 293 : 743,
        startY: 184,
        endX: fromBinding ? 743 : 293,
        endY: 184,
        color: index % 2 ? '#67e8f9' : '#fde68a',
        scale: 0.55 + (index % 3) * 0.08,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 2.8,
        landed: acquireCrystal(fromBinding ? 'preservation' : 'binding', index % 2 ? '#67e8f9' : '#fde68a') ?? undefined
      })
    }
    if (bindingUp > transferCount) addParticles('binding', (bindingUp - transferCount) / 100, 'rain', bindingUp - transferCount)
    if (preservationUp > transferCount) addParticles('preservation', (preservationUp - transferCount) / 100, 'rain', preservationUp - transferCount)
    if (bindingDown > transferCount) addParticles('binding', -(bindingDown - transferCount) / 100, 'out', bindingDown - transferCount)
    if (preservationDown > transferCount) addParticles('preservation', -(preservationDown - transferCount) / 100, 'out', preservationDown - transferCount)
  } else {
    if (bindingUp > 0) addParticles('binding', bindingUp / 100, 'rain', bindingUp)
    if (bindingDown > 0) {
      addParticles('binding', -bindingDown / 100, 'out', bindingDown)
      removeSettled('binding', bindingDown)
    }
    if (preservationUp > 0) addParticles('preservation', preservationUp / 100, 'rain', preservationUp)
    if (preservationDown > 0) {
      addParticles('preservation', -preservationDown / 100, 'out', preservationDown)
      removeSettled('preservation', preservationDown)
    }
  }
  if (oddsAnimationFrame !== null) cancelAnimationFrame(oddsAnimationFrame)
  const frame = (now: number) => {
    const progress = Math.min(1, (now - oddsAnimation.startedAt) / oddsAnimation.duration)
    const eased = progress * progress * (3 - 2 * progress)
    oddsAnimation.binding = oddsAnimation.binding + (oddsAnimation.targetBinding - oddsAnimation.binding) * eased
    oddsAnimation.preservation = oddsAnimation.preservation + (oddsAnimation.targetPreservation - oddsAnimation.preservation) * eased
    for (const particle of oddsAnimation.particles) particle.progress += 0.035
    for (const particle of oddsAnimation.particles) {
      if (!particle.landed || particle.settledAdded || particle.progress < 1) continue
      const sideCount = oddsAnimation.settled.filter(crystal => crystal.side === particle.landed!.side).length
      if (sideCount < 20) {
        particle.landed.active = true
        oddsAnimation.settled.push(particle.landed)
      } else {
        particle.landed.active = false
      }
      particle.settledAdded = true
    }
    drawOdds()
    if (progress < 1 || oddsAnimation.particles.some(particle => particle.progress < 1)) {
      oddsAnimationFrame = requestAnimationFrame(frame)
    } else {
      oddsAnimation.binding = oddsAnimation.targetBinding
      oddsAnimation.preservation = oddsAnimation.targetPreservation
      oddsAnimation.particles = []
      oddsAnimationFrame = null
      drawOdds()
    }
  }
  oddsAnimationFrame = requestAnimationFrame(frame)
}

function startOddsFlameAnimation() {
  if (oddsFlameFrame !== null) return
  const frame = () => {
    if (!workbenchOpen.value) {
      oddsFlameFrame = null
      return
    }
    drawOdds()
    oddsFlameFrame = requestAnimationFrame(frame)
  }
  oddsFlameFrame = requestAnimationFrame(frame)
}

watch([arcanistFocus, arcanistOfferBonus], () => {
  if (workbenchOpen.value) animateOddsTransition()
})

watch(workbenchOpen, (open) => {
  if (open) {
    startOddsFlameAnimation()
  } else if (oddsFlameFrame !== null) {
    cancelAnimationFrame(oddsFlameFrame)
    oddsFlameFrame = null
  }
})

function createEngine() {
  if (props.liveMode) {
    engine = props.liveEngine
    return
  }
  if (!canvas.value) return
  const boosts: PathwardenBoostEffects = {
    startingLives: 20,
    startingAether: 5_000,
    damageMultiplier: 1,
    rangeMultiplier: 1,
    rateMultiplier: 1,
    bountyMultiplier: 1,
    arcanistLevel: arcanistLevel.value
  }
  engine?.destroy()
  engine = new PathwardenEngine(canvas.value, {
    onState: next => { snapshot.value = next },
    onUpgrade: () => {},
    onGameOver: async () => {},
    onOpenArcanistWorkbench: handleWorkbench
  }, boosts, 1, 'warden-stone', undefined, true)
  engine.start()
}

function prepareScenario() {
  if (props.liveMode) return
  if (!engine) createEngine()
  engine?.debugSetAether(debugAetherBalance.value)
  engine?.debugSetArcanistLevel(arcanistLevel.value)
  const scenario: PathwardenRelicSwapDebugScenario = {
    existingRelicId: existingRelicId.value,
    incomingRelicId: incomingRelicId.value,
    towerLevel: towerLevel.value,
    stacks: stacks.value
  }
  preview.value = engine?.debugPrepareRelicSwapScenario(scenario) ?? null
  result.value = null
  workbenchOpen.value = false
}

function openWorkbench() {
  engine?.debugOpenRelicSwapWorkbench()
}

function openLiveWorkbench(nextPreview: PathwardenRelicSwapPreview, nextEngine?: PathwardenEngine | null) {
  if (!props.liveMode) return
  engine = nextEngine ?? props.liveEngine
  handleWorkbench(nextPreview)
}

defineExpose({ openLiveWorkbench })

function ritualColor(element: string) {
  return relicElementColor(element)
}

function registerRitualEntity(kind: RitualEntity['kind'], index: number, x: number, y: number, _degraded = false) {
  const nextPreview = preview.value
  const nextResult = result.value
  if (!nextPreview || !nextResult) return
  const oldStackPower = nextPreview.existingPower / Math.max(1, nextResult.oldStacks)
  const isOld = kind === 'old' || kind === 'ash-old'
  const isAsh = kind === 'ash-old' || kind === 'ash-incoming'
  const beforePower = isOld ? oldStackPower : nextPreview.incomingPower
  const afterPower = isAsh ? 0 : isOld ? nextResult.recoveredRelicPower : nextPreview.incomingPower
  const family = isOld ? nextPreview.existingFamily : nextPreview.incomingFamily
  const beforeEffect = pathwardenRelicProfile(family, beforePower).description
  const afterEffect = isAsh ? 'No effect · the relic was destroyed.' : pathwardenRelicProfile(family, afterPower).description
  ritualEntities.push({
    kind,
    index,
    x,
    y,
    radius: isAsh ? 54 : 62,
    title: isAsh
      ? `Ashes · ${isOld ? nextPreview.existingName : nextPreview.incomingName}`
      : `${isOld ? nextPreview.existingName : nextPreview.incomingName}${isOld ? ` · relic ${index + 1}` : ''}`,
    beforeName: isOld ? nextPreview.existingName : nextPreview.incomingName,
    afterName: isAsh ? 'Ash pile' : isOld ? (nextResult.success ? `Recovered ${nextPreview.existingName}` : nextPreview.existingName) : nextPreview.incomingName,
    beforeEffect,
    afterEffect,
    beforePower,
    afterPower,
    beforeState: isOld ? 'Bound to the defense' : 'Held in the incoming slot',
    afterState: isAsh ? 'Destroyed · reduced to ash' : kind === 'old' ? (nextResult.success ? 'Recovered to the belt' : 'Still bound to the defense') : 'Bound to the defense',
    degraded: isOld && !isAsh && nextResult.recoveredRelicPower < oldStackPower
  })
}

function drawRitualRelic(ctx: CanvasRenderingContext2D, x: number, y: number, iconIndex: number, color: string, scale: number, rotation: number, scorch = 0, alpha = 1, degraded = false) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.scale(scale, scale)
  ctx.shadowColor = color
  ctx.shadowBlur = 18 + (1 - scorch) * 12
  ctx.fillStyle = 'rgba(8, 15, 40, .94)'
  ctx.beginPath()
  ctx.arc(0, 0, 30, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.shadowBlur = 0
  if (relicIconSheet?.complete && relicIconSheet.naturalWidth > 0) {
    const sourceWidth = relicIconSheet.naturalWidth / 5
    const sourceHeight = relicIconSheet.naturalHeight / 3
    ctx.save()
    ctx.beginPath()
    ctx.arc(0, 0, 28, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(relicIconSheet, (iconIndex % 5) * sourceWidth, Math.floor(iconIndex / 5) * sourceHeight, sourceWidth, sourceHeight, -28, -28, 56, 56)
    ctx.restore()
  }
  if (scorch > 0) {
    ctx.globalAlpha = alpha * scorch
    ctx.strokeStyle = '#171717'
    ctx.fillStyle = 'rgba(23, 23, 23, .72)'
    ctx.lineWidth = 4 + scorch * 3
    for (let index = 0; index < 3; index++) {
      const angle = index * 2.2 + iconIndex
      ctx.beginPath()
      ctx.moveTo(Math.cos(angle) * 8, Math.sin(angle) * 8)
      ctx.lineTo(Math.cos(angle + 0.25) * 27, Math.sin(angle + 0.25) * 27)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(-10, 10, 6 + scorch * 5, 0, Math.PI * 2)
    ctx.fill()
  }
  if (degraded) {
    ctx.globalAlpha = alpha * 0.95
    ctx.strokeStyle = '#e2e8f0'
    ctx.shadowColor = '#0f172a'
    ctx.shadowBlur = 5
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.moveTo(-4, -25)
    ctx.lineTo(1, -11)
    ctx.lineTo(-7, 0)
    ctx.lineTo(5, 12)
    ctx.lineTo(1, 25)
    ctx.stroke()
    ctx.fillStyle = '#020617'
    ctx.beginPath()
    ctx.moveTo(18, -18)
    ctx.lineTo(29, -11)
    ctx.lineTo(22, -2)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function ritualLightning(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, color: string, seed: number, alpha = 1, progress = 1, fade = 0) {
  ctx.save()
  const reveal = Math.max(0, Math.min(1, progress))
  const haloAlpha = alpha * Math.max(0, 1 - fade * 0.52)
  const coreAlpha = alpha * Math.max(0, 1 - fade * 1.9)
  ctx.strokeStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 28
  ctx.globalAlpha = haloAlpha * (reveal < 1 ? 0.96 : 0.76)
  ctx.lineWidth = 8 + alpha * 5
  ctx.beginPath()
  ctx.moveTo(fromX, fromY)
  const segments = 7
  const visibleSegments = Math.max(1, Math.ceil(segments * reveal))
  for (let index = 1; index <= visibleSegments; index++) {
    const progress = index / segments
    if (progress > reveal) {
      const partial = reveal * segments - (index - 1)
      const segmentProgress = Math.max(0, Math.min(1, partial))
      const jitter = Math.sin(seed * 4.3 + index * 9.7) * 22
      const endX = fromX + (toX - fromX) * ((index - 1 + segmentProgress) / segments) + jitter * segmentProgress
      const endY = fromY + (toY - fromY) * ((index - 1 + segmentProgress) / segments) - jitter * 0.5 * segmentProgress
      ctx.lineTo(endX, endY)
      break
    }
    const jitter = Math.sin(seed * 4.3 + index * 9.7) * 22
    ctx.lineTo(fromX + (toX - fromX) * progress + jitter, fromY + (toY - fromY) * progress - jitter * 0.5)
  }
  if (reveal >= 1) ctx.lineTo(toX, toY)
  ctx.stroke()
  ctx.globalAlpha = coreAlpha * (reveal < 1 ? 1 : 0.88)
  ctx.strokeStyle = '#fff7ed'
  ctx.shadowColor = color
  ctx.shadowBlur = 12
  ctx.lineWidth = 2.2 + alpha * 1.3
  ctx.stroke()
  if (reveal >= 1 && fade < 0.7) {
    ctx.globalAlpha = haloAlpha * 0.3
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.stroke()
  }
  ctx.restore()
}

function drawRitualExplosion(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, progress: number, now: number) {
  const reveal = Math.max(0, Math.min(1, progress))
  const radius = 18 + reveal * 150
  const fade = Math.max(0, (reveal - 0.74) / 0.26)
  ctx.save()
  ctx.translate(x, y)
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.5 * (1 - fade)
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 42
  ctx.beginPath()
  ctx.arc(0, 0, radius * 0.38, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = Math.max(0, 1 - reveal * 3.8)
  ctx.fillStyle = '#fff7ed'
  ctx.shadowColor = '#fff7ed'
  ctx.shadowBlur = 34
  ctx.beginPath()
  ctx.arc(0, 0, 9 + reveal * 13, 0, Math.PI * 2)
  ctx.fill()
  for (let index = 0; index < 10; index++) {
    const angle = index * 2.399 + now / (220 + index * 7)
    const distance = radius * (0.62 + (index % 5) * 0.16)
    const startX = Math.cos(angle) * radius * 0.16
    const startY = Math.sin(angle) * radius * 0.16
    const endX = Math.cos(angle) * distance
    const endY = Math.sin(angle) * distance * 0.72
    ritualLightning(ctx, startX, startY, endX, endY, color, now / 300 + index, 0.85 * (1 - fade), 1, fade)
  }
  ctx.globalAlpha = 0.8 * (1 - fade)
  for (let index = 0; index < 14; index++) {
    const angle = index * 1.93 + now / (160 + index * 5)
    const distance = radius * (0.62 + (index % 6) * 0.12)
    const sparkSize = 1.8 + (index % 3) * 1.1
    ctx.fillStyle = index % 4 === 0 ? '#fff7ed' : color
    ctx.beginPath()
    ctx.arc(Math.cos(angle) * distance, Math.sin(angle) * distance * 0.72, sparkSize, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawSealImpact(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, intensity: number, now: number, seed: number) {
  if (intensity <= 0.55) return
  const pulse = Math.max(0, Math.min(1, (intensity - 0.55) / 0.45))
  ctx.save()
  ctx.translate(x, y)
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 24
  ctx.lineWidth = 4 + pulse * 3
  for (let index = 0; index < 5; index++) {
    const angle = seed + index * Math.PI * 2 / 5 + now / (540 + index * 35)
    const radius = 32 + pulse * 34 + index * 7
    ctx.beginPath()
    ctx.ellipse(0, 0, radius, radius * 0.42, angle, -0.55, 0.55)
    ctx.stroke()
  }
  for (let index = 0; index < 5; index++) {
    const angle = seed + index * Math.PI * 2 / 5
    const endX = Math.cos(angle) * (38 + pulse * 42)
    const endY = Math.sin(angle) * (38 + pulse * 42) * 0.62
    ritualLightning(ctx, 0, 0, endX, endY, color, seed * 3 + index, pulse, 1, 1 - pulse)
  }
  ctx.globalAlpha = pulse
  ctx.fillStyle = '#fff7ed'
  ctx.shadowColor = '#fff7ed'
  ctx.shadowBlur = 28
  ctx.beginPath()
  ctx.arc(0, 0, 7 + pulse * 10, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawCobraStrike(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, targetX: number, targetY: number, intensity: number, now: number, seed: number) {
  if (intensity <= 0.42) return
  const progress = Math.max(0.18, Math.min(1, (intensity - 0.42) / 0.58))
  const strikeFade = Math.max(0, 1 - intensity * 1.08)
  for (let branch = 0; branch < 3; branch++) {
    const branchSeed = seed + branch * 4.7
    ritualLightning(ctx, fromX, fromY, targetX, targetY, branch % 2 ? '#fff7ed' : '#fb7185', branchSeed, 0.72 + branch * 0.12, progress, strikeFade)
  }
  const headX = fromX + (targetX - fromX) * progress
  const headY = fromY + (targetY - fromY) * progress
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = '#fff7ed'
  ctx.shadowColor = '#fb7185'
  ctx.shadowBlur = 26
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.arc(headX, headY, 5 + progress * 8, 0, Math.PI * 2)
  ctx.fill()
  for (let fork = 0; fork < 4; fork++) {
    const angle = seed + fork * Math.PI / 2 + now / 180
    ritualLightning(ctx, headX, headY, headX + Math.cos(angle) * 28, headY + Math.sin(angle) * 18, '#fef08a', seed + fork, 0.85, 1, strikeFade)
  }
  ctx.restore()
}

function drawAshCloud(ctx: CanvasRenderingContext2D, x: number, y: number, pileX: number, pileY: number, progress: number, now: number, seed: number) {
  const gather = Math.max(0, Math.min(1, progress))
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  for (let index = 0; index < 32; index++) {
    const phase = (now / (420 + index * 31) + seed * 0.17 + index * 0.23) % 1
    const drift = Math.sin(now / (230 + index * 17) + index) * 18 * (1 - gather)
    const pileSpread = 32 + (index % 5) * 5
    const settledX = pileX + Math.cos(index * 2.41 + seed) * pileSpread
    const settledY = pileY + Math.sin(index * 1.83 + seed) * pileSpread * 0.32
    const xPosition = x + (settledX - x) * gather * phase + drift
    const yPosition = y + (settledY - y) * gather * phase - Math.sin(phase * Math.PI) * (30 + index * 2)
    ctx.fillStyle = index % 3 === 0 ? '#020617' : '#111827'
    ctx.globalAlpha = (0.42 + (index % 4) * 0.13) * (0.45 + gather * 0.55)
    ctx.beginPath()
    ctx.arc(xPosition, yPosition, 3 + (index % 4) * 1.2, 0, Math.PI * 2)
    ctx.fill()
  }
  if (gather > 0.6) {
    ctx.globalAlpha = (gather - 0.6) * 2.8
    ctx.fillStyle = '#111827'
    ctx.beginPath()
    ctx.moveTo(pileX - 38, pileY + 12)
    ctx.quadraticCurveTo(pileX, pileY - 22, pileX + 38, pileY + 12)
    ctx.quadraticCurveTo(pileX, pileY + 24, pileX - 38, pileY + 12)
    ctx.fill()
    ctx.fillStyle = '#4b5563'
    ctx.globalAlpha *= 0.8
    ctx.beginPath()
    ctx.ellipse(pileX, pileY + 10, 28, 7, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawSettlementSigil(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, count: number, progress: number, now: number) {
  if (progress <= 0.01) return
  ctx.save()
  ctx.globalAlpha = progress * 0.55
  ctx.strokeStyle = '#fef08a'
  ctx.shadowColor = '#fef08a'
  ctx.shadowBlur = 14
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(x, y, radius, radius * 0.5, now / 2400, 0, Math.PI * 2)
  ctx.stroke()
  if (count > 2) {
    ctx.beginPath()
    for (let index = 0; index <= count; index++) {
      const angle = now / 3200 + index * Math.PI * 2 / count
      const pointX = x + Math.cos(angle) * radius
      const pointY = y + Math.sin(angle) * radius * 0.5
      if (index === 0) ctx.moveTo(pointX, pointY)
      else ctx.lineTo(pointX, pointY)
    }
    ctx.stroke()
  }
  ctx.restore()
}

function drawRitualFlame(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, intensity: number, now: number, phase: number) {
  if (intensity <= 0.03) return
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1.1 + intensity * 0.18, 1.1 + intensity * 0.18)
  ctx.globalCompositeOperation = 'lighter'
  const pulse = 0.84 + Math.sin(now / 120 + phase) * 0.12
  const coreRadius = 7 + intensity * 4
  const core = ctx.createRadialGradient(0, 0, 1, 0, 0, coreRadius * 3.2)
  core.addColorStop(0, '#fff7ed')
  core.addColorStop(0.18, '#fef08a')
  core.addColorStop(0.46, '#fb7185')
  core.addColorStop(1, 'rgba(251, 113, 133, 0)')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(0, 0, coreRadius * 3.2, 0, Math.PI * 2)
  ctx.fill()

  for (let index = 0; index < 7; index++) {
    const tongueAngle = rotation + index * Math.PI * 2 / 7 + Math.sin(now / (180 + index * 17) + phase * 2.4 + index) * 0.3
    const tongueScale = (0.62 + Math.abs(Math.sin(now / (150 + index * 23) + index * 1.7)) * 0.56) * pulse
    const tongueLength = (18 + (index % 3) * 6) * tongueScale
    const tongueWidth = (4 + (index % 2) * 2) * tongueScale
    const lean = Math.sin(now / (205 + index * 19) + index) * 5
    ctx.save()
    ctx.rotate(tongueAngle)
    ctx.translate(lean, -tongueLength * 0.25)
    ctx.globalAlpha = 0.62 + tongueScale * 0.32
    ctx.shadowColor = '#fb7185'
    ctx.shadowBlur = 8 + tongueScale * 9
    ctx.fillStyle = index % 3 === 0 ? '#fef08a' : '#fb7185'
    ctx.beginPath()
    ctx.moveTo(-tongueWidth, 5)
    ctx.quadraticCurveTo(-tongueWidth * 1.4, -tongueLength * 0.3, 0, -tongueLength)
    ctx.quadraticCurveTo(tongueWidth * 1.5, -tongueLength * 0.38, tongueWidth, 5)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  ctx.save()
  ctx.globalAlpha = 0.96
  ctx.fillStyle = '#fff7ed'
  ctx.shadowColor = '#fef08a'
  ctx.shadowBlur = 14
  ctx.beginPath()
  ctx.arc(0, 0, coreRadius * 0.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.restore()
}

function drawVortexVeins(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, width: number, height: number, now: number) {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let vein = 0; vein < 13; vein++) {
    const angle = vein * Math.PI * 2 / 13 + Math.sin(vein * 4.2) * 0.18
    const reach = Math.max(width, height) * (0.46 + (vein % 4) * 0.07)
    ctx.strokeStyle = vein % 3 === 0 ? 'rgba(103, 232, 249, .28)' : 'rgba(129, 140, 248, .2)'
    ctx.shadowColor = vein % 3 === 0 ? '#67e8f9' : '#818cf8'
    ctx.shadowBlur = 10
    ctx.lineWidth = 1.2 + (vein % 3) * 0.7
    ctx.beginPath()
    for (let step = 0; step <= 12; step++) {
      const progress = step / 12
      const radius = 28 + reach * progress
      const wobble = Math.sin(now / 850 + vein * 1.7 + step * 1.3) * (8 + progress * 16)
      const x = centerX + Math.cos(angle) * radius + Math.cos(angle + Math.PI / 2) * wobble
      const y = centerY + Math.sin(angle) * radius * 0.58 + Math.sin(angle + Math.PI / 2) * wobble * 0.58
      if (step === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    const pulse = (now / 900 + vein * 0.31) % 1
    const pulseRadius = 28 + reach * pulse
    const pulseWobble = Math.sin(now / 850 + vein * 1.7 + pulse * 15) * (8 + pulse * 16)
    ctx.fillStyle = '#dbeafe'
    ctx.globalAlpha = 0.24 + Math.abs(Math.sin(now / 160 + vein)) * 0.4
    ctx.beginPath()
    ctx.arc(
      centerX + Math.cos(angle) * pulseRadius + Math.cos(angle + Math.PI / 2) * pulseWobble,
      centerY + Math.sin(angle) * pulseRadius * 0.58 + Math.sin(angle + Math.PI / 2) * pulseWobble * 0.58,
      1.5 + (vein % 2),
      0,
      Math.PI * 2
    )
    ctx.fill()
  }
  ctx.restore()
}

function drawRitual(now: number) {
  const canvas = ritualCanvas.value
  const nextPreview = preview.value
  const nextResult = result.value
  if (!canvas || !nextPreview || !nextResult) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const elapsed = now - ritualStartedAt
  const progress = Math.min(1, elapsed / ritualDuration)
  const width = canvas.width
  const height = canvas.height
  const centerX = width / 2
  const centerY = height * 0.47
  const ritualScale = 1.5
  const oldColor = ritualColor(nextPreview.existingElement)
  const incomingColor = ritualColor(nextPreview.incomingElement)
  const oldCount = nextResult.oldStacks
  const recoveredCount = nextResult.success ? nextResult.recoveredStacks : oldCount
  const preservedOldRelicIndices = new Set(nextResult.preservedRelicIndices)
  const battle = Math.min(1, Math.max(0, (progress - 0.12) / 0.55))
  const outcome = Math.min(1, Math.max(0, (progress - 0.67) / 0.18))
  const settle = Math.min(1, Math.max(0, (progress - 0.8) / 0.2))
  const fireDamping = 1 - settle
  const summary = progress > 0.88
  ritualEntities.length = 0
  ctx.save()

  const background = ctx.createRadialGradient(centerX, centerY, 15, centerX, centerY, width * 0.7)
  background.addColorStop(0, '#18245a')
  background.addColorStop(0.55, '#0d1639')
  background.addColorStop(1, '#050914')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)

  drawVortexVeins(ctx, centerX, centerY, width, height, now)

  const orbit = 285 - outcome * 120
  const orbitAngle = now / 620 + Math.sin(now / 380) * 0.35
  const oldX = centerX + Math.cos(orbitAngle) * orbit
  const oldY = centerY + Math.sin(orbitAngle) * orbit * 0.5
  const incomingOrbitAngle = orbitAngle + Math.PI + now / 980
  const incomingOrbitRadius = orbit + Math.sin(now / 710) * 18
  const incomingX = centerX + Math.cos(incomingOrbitAngle) * incomingOrbitRadius
  const incomingY = centerY + Math.sin(incomingOrbitAngle) * incomingOrbitRadius * 0.5
  const relicOrbitOffsets = [27, 172, 264, 343, 108]
  const oldRelics = Array.from({ length: oldCount }, (_, index) => {
    const startingAngle = (relicOrbitOffsets[index % relicOrbitOffsets.length]! * Math.PI) / 180
    const angularVelocity = now / (760 + index * 137)
    const relicAngle = orbitAngle + startingAngle + angularVelocity + Math.sin(now / (430 + index * 43) + index * 1.9) * 0.13
    const relicRadius = orbit + Math.sin(now / (610 + index * 47) + index) * (12 + index * 3)
    return {
      x: centerX + Math.cos(relicAngle) * relicRadius,
      y: centerY + Math.sin(relicAngle) * relicRadius * 0.5,
      rotation: relicAngle + Math.sin(now / (300 + index * 23) + index) * 0.3,
      index
    }
  })
  const targetOldRelicIndex = oldCount ? Math.floor(now / 1180) % oldCount : 0
  const targetOldRelic = oldRelics[targetOldRelicIndex] ?? { x: oldX, y: oldY, rotation: orbitAngle, index: 0 }
  const flameOrbitX = 385 + Math.sin(now / 470) * 28
  const flameOrbitY = 210 + Math.sin(now / 610) * 18
  const oldFlameAngle = now / 560 + Math.sin(now / 760) * 0.5
  const incomingFlameAngle = -now / 625 + Math.sin(now / 610 + 2) * 0.42
  const oldAttack = Math.max(0, Math.sin(now / 390 + 0.8)) * battle * (1 - outcome) * fireDamping
  const incomingAttack = Math.max(0, Math.sin(now / 335 + 2.1)) * battle * (1 - outcome) * fireDamping
  const oldTargetsRelic = Math.floor(now / 1420) % 3 !== 1
  const incomingTargetsRelic = Math.floor((now + 420) / 1260) % 3 !== 1
  const oldFlameX = centerX + Math.cos(oldFlameAngle) * flameOrbitX + (centerX - oldX) * oldAttack * 0.16
  const oldFlameY = centerY + Math.sin(oldFlameAngle) * flameOrbitY
  const incomingFlameX = centerX + Math.cos(incomingFlameAngle) * flameOrbitX + (centerX - incomingX) * incomingAttack * 0.16
  const incomingFlameY = centerY + Math.sin(incomingFlameAngle) * flameOrbitY
  const oldAirTarget = { x: centerX + Math.cos(oldFlameAngle + 1.4) * 145, y: centerY + Math.sin(oldFlameAngle + 1.4) * 78 }
  const incomingAirTarget = { x: centerX + Math.cos(incomingFlameAngle - 1.2) * 145, y: centerY + Math.sin(incomingFlameAngle - 1.2) * 78 }
  const oldTarget = oldTargetsRelic ? { x: targetOldRelic.x, y: targetOldRelic.y } : oldAirTarget
  const incomingTarget = incomingTargetsRelic ? { x: incomingX, y: incomingY } : incomingAirTarget
  const lightningHit = Math.max(oldTargetsRelic ? oldAttack : 0, incomingTargetsRelic ? incomingAttack : 0)
  const lightningImpact = Math.max(0, lightningHit - 0.84) / 0.16
  const explosionImpact = nextResult.success && !nextResult.preserved
    ? Math.max(0, Math.sin((outcome * 8.6 + 0.18) * Math.PI))
    : 0
  const shakeStrength = Math.min(2.8, Math.max(lightningImpact * 1.4, explosionImpact * 2.2))
  ctx.translate(Math.sin(now / 19) * shakeStrength, Math.cos(now / 23) * shakeStrength * 0.7)
  const flameIntensity = (0.72 + Math.sin(now / 110) * 0.2) * fireDamping
  drawRitualFlame(ctx, oldFlameX, oldFlameY, oldFlameAngle, flameIntensity, now, 1)
  drawRitualFlame(ctx, incomingFlameX, incomingFlameY, incomingFlameAngle, flameIntensity, now, 2)

  // The flames periodically close in and strike their seals. Aether crystals
  // are physical interceptors placed along those attack lines.
  const crystalCount = Math.min(20, Math.max(0, nextResult.aetherSpent))
  const crystals = Array.from({ length: crystalCount }, (_, index) => {
    const side = arcanistFocus.value === 'binding'
      ? 'incoming'
      : arcanistFocus.value === 'preservation'
        ? 'old'
        : index % 2 === 0 ? 'old' : 'incoming'
    const flameX = side === 'old' ? oldFlameX : incomingFlameX
    const flameY = side === 'old' ? oldFlameY : incomingFlameY
    const oldRelicIndex = side === 'old' ? Math.floor(index / (arcanistFocus.value === 'both' ? 2 : 1)) % Math.max(1, oldCount) : -1
    const targetRelic = side === 'old' ? oldRelics[oldRelicIndex] ?? targetOldRelic : { x: incomingX, y: incomingY, index: -1 }
    const sealX = targetRelic.x
    const sealY = targetRelic.y
    const targetsRelic = side === 'old' ? oldTargetsRelic : incomingTargetsRelic
    const attack = side === 'old' ? oldAttack : incomingAttack
    const attackPeriod = side === 'old' ? 530 : 465
    const attackCycle = (now / attackPeriod + index * 0.61) % 1
    const hit = targetsRelic && attack > 0.22 && attackCycle > 0.52 && attackCycle < 0.72
    const completedHits = Math.max(0, Math.floor((elapsed - 1300 - (index % 4) * 180) / (attackPeriod * 1.35)))
    const burn = Math.min(1, completedHits / 6 + (hit ? 0.08 : 0))
    const progress = 0.34 + (index % 5) * 0.1
    const offset = Math.sin(now / 280 + index * 2.4) * (7 + index % 3 * 4)
    const dx = sealX - flameX
    const dy = sealY - flameY
    const length = Math.max(1, Math.hypot(dx, dy))
    return {
      x: flameX + dx * progress - dy / length * offset,
      y: flameY + dy * progress + dx / length * offset,
      color: index % 3 ? '#67e8f9' : '#fde68a',
      rotation: now / (110 + index * 17) + index * 1.71 + Math.sin(now / (190 + index * 11) + index) * 0.45,
      scale: (0.38 + (index % 3) * 0.06) * ritualScale,
      hit,
      side,
      relicIndex: targetRelic.index,
      burn,
      burned: burn >= 1,
      flameX,
      flameY
    }
  })

  const oldShield = crystals.find(crystal => crystal.side === 'old' && crystal.relicIndex === targetOldRelic.index && !crystal.burned)
  const incomingShield = crystals.find(crystal => crystal.side === 'incoming' && !crystal.burned)
  if (oldTargetsRelic && oldAttack > 0.3) {
    const targetX = oldTargetsRelic ? oldShield?.x ?? oldTarget.x : oldTarget.x
    const targetY = oldTargetsRelic ? oldShield?.y ?? oldTarget.y : oldTarget.y
    ritualLightning(ctx, oldFlameX, oldFlameY, targetX, targetY, '#fb7185', now / 1000, oldAttack, Math.min(1, oldAttack * 1.35), Math.max(0, 1 - oldAttack * 1.25))
    drawCobraStrike(ctx, oldFlameX, oldFlameY, targetX, targetY, oldAttack, now, 1.4)
  }
  if (incomingTargetsRelic && incomingAttack > 0.3) {
    const targetX = incomingTargetsRelic ? incomingShield?.x ?? incomingTarget.x : incomingTarget.x
    const targetY = incomingTargetsRelic ? incomingShield?.y ?? incomingTarget.y : incomingTarget.y
    ritualLightning(ctx, incomingFlameX, incomingFlameY, targetX, targetY, '#fb7185', now / 870, incomingAttack, Math.min(1, incomingAttack * 1.35), Math.max(0, 1 - incomingAttack * 1.25))
    drawCobraStrike(ctx, incomingFlameX, incomingFlameY, targetX, targetY, incomingAttack, now, 2.8)
  }
  if (oldTargetsRelic) drawSealImpact(ctx, targetOldRelic.x, targetOldRelic.y, oldColor, oldAttack, now, targetOldRelic.index + 0.4)
  if (incomingTargetsRelic) drawSealImpact(ctx, incomingX, incomingY, incomingColor, incomingAttack, now, 2.1)

  for (const crystal of crystals) {
    if (crystal.burned) continue
    if (crystal.hit) {
      ritualLightning(ctx, crystal.flameX, crystal.flameY, crystal.x, crystal.y, '#fef08a', crystal.rotation, 0.92)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = '#fb923c'
      ctx.globalAlpha = 0.7
      ctx.beginPath()
      ctx.arc(crystal.x, crystal.y, 5 + Math.sin(now / 75 + crystal.rotation) * 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    const crystalAlpha = (crystal.hit ? 0.44 : 0.9 - crystal.burn * 0.35) * fireDamping
    if (crystalAlpha > 0.02) drawAetherCrystal(ctx, crystal.x, crystal.y, crystal.scale * (1 - crystal.burn * 0.34), crystalAlpha, crystal.color, crystal.rotation, crystal.hit ? 1.2 : 0.35)
  }

  if (oldTargetsRelic && oldAttack > 0.8) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = '#fef08a'
    ctx.globalAlpha = (oldAttack - 0.8) * 4
    ctx.beginPath()
    ctx.arc(targetOldRelic.x, targetOldRelic.y, 8 + oldAttack * 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  if (incomingTargetsRelic && incomingAttack > 0.8) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = '#fef08a'
    ctx.globalAlpha = (incomingAttack - 0.8) * 4
    ctx.beginPath()
    ctx.arc(incomingX, incomingY, 8 + incomingAttack * 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  for (let index = 0; index < 28; index++) {
    const angle = index * 0.92 + now / (index % 2 ? 410 : -530)
    const radius = 90 + (index % 7) * 23 + Math.sin(now / 260 + index) * 10
    const sparkX = centerX + Math.cos(angle) * radius
    const sparkY = centerY + Math.sin(angle) * radius * 0.52
    ctx.fillStyle = index % 2 ? '#fef08a' : '#a5f3fc'
    ctx.globalAlpha = 0.35 + Math.abs(Math.sin(now / 170 + index)) * 0.65
    ctx.beginPath()
    ctx.arc(sparkX, sparkY, 1.5 + (index % 3), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  const oldSurvivorCount = preservedOldRelicIndices.size
  const incomingSurvivorCount = nextResult.success ? 1 : 0
  const survivorCount = oldSurvivorCount + incomingSurvivorCount
  const destroyedOldCount = oldCount - oldSurvivorCount
  const destroyedIncomingCount = nextResult.success ? 0 : 1
  const settlementCount = survivorCount + destroyedOldCount + destroyedIncomingCount
  const settlementCenter = { x: centerX, y: centerY + 8 }
  const settlementPosition = (slot: number) => {
    const angle = -Math.PI / 2 + slot * Math.PI * 2 / Math.max(1, settlementCount)
    return {
      x: settlementCenter.x + Math.cos(angle) * (82 + settlementCount * 4),
      y: settlementCenter.y + Math.sin(angle) * (42 + settlementCount * 2)
    }
  }
  drawSettlementSigil(ctx, settlementCenter.x, settlementCenter.y, 100 + settlementCount * 4, settlementCount, settle, now)

  for (let index = 0; index < oldCount; index++) {
    const relic = oldRelics[index] ?? targetOldRelic
    const lost = !preservedOldRelicIndices.has(index)
    const relicDestruction = lost ? Math.max(0, Math.min(1, (outcome - 0.08 - index * 0.09) / 0.42)) : 0
    const strikeScorch = oldTargetsRelic && relic.index === targetOldRelic.index ? Math.max(0, (oldAttack - 0.78) * 3.2) : 0
    const scorch = Math.max(strikeScorch, lost ? Math.min(1, relicDestruction * 1.3) : nextResult.success && recoveredCount < oldCount ? outcome * 0.65 : 0)
    const survives = !lost
    const survivorSlot = survives
      ? oldRelics.slice(0, index).filter((_, previousIndex) => preservedOldRelicIndices.has(previousIndex)).length
      : 0
    const target = settlementPosition(survivorSlot)
    const drawX = survives ? relic.x + (target.x - relic.x) * settle : relic.x
    const drawY = survives ? relic.y + (target.y - relic.y) * settle : relic.y
    const alpha = lost ? 1 - relicDestruction : 1
    const degraded = survives && nextResult.recoveredRelicPower < nextPreview.existingPower / Math.max(1, nextResult.oldStacks)
    drawRitualRelic(ctx, drawX, drawY, nextPreview.existingIconIndex, oldColor, 0.72 * ritualScale, relic.rotation, scorch, alpha, degraded)
    if (survives) registerRitualEntity('old', index, drawX, drawY, degraded)
    if (lost && relicDestruction > 0) {
      const ashProgress = Math.max(0, Math.min(1, (settle - 0.12) / 0.88))
      const ashSlot = survivorCount + oldRelics.slice(0, index).filter((_, previousIndex) => !preservedOldRelicIndices.has(previousIndex)).length
      const ashTarget = settlementPosition(ashSlot)
      drawAshCloud(ctx, relic.x, relic.y, ashTarget.x, ashTarget.y, ashProgress, now, index + 1)
      registerRitualEntity('ash-old', index, ashTarget.x, ashTarget.y)
    }
  }
  const incomingDestroyed = !nextResult.success
  const incomingAlpha = incomingDestroyed ? 1 - outcome : 1
  const incomingStrikeScorch = incomingTargetsRelic ? Math.max(0, (incomingAttack - 0.78) * 3.2) : 0
  const incomingTargetPosition = settlementPosition(oldSurvivorCount)
  const incomingDrawX = incomingDestroyed ? incomingX : incomingX + (incomingTargetPosition.x - incomingX) * settle
  const incomingDrawY = incomingDestroyed ? incomingY : incomingY + (incomingTargetPosition.y - incomingY) * settle
  drawRitualRelic(ctx, incomingDrawX, incomingDrawY, nextPreview.incomingIconIndex, incomingColor, 0.82 * ritualScale, -orbitAngle + Math.sin(now / 287) * 0.28, Math.max(incomingStrikeScorch, incomingDestroyed ? outcome * 1.15 : 0), incomingAlpha)
  if (!incomingDestroyed) registerRitualEntity('incoming', 0, incomingDrawX, incomingDrawY)
  if (incomingDestroyed && outcome > 0) {
    const ashProgress = Math.max(0, Math.min(1, (settle - 0.12) / 0.88))
    const ashTarget = settlementPosition(survivorCount + destroyedOldCount)
    drawAshCloud(ctx, incomingX, incomingY, ashTarget.x, ashTarget.y, ashProgress, now, 9)
    registerRitualEntity('ash-incoming', 0, ashTarget.x, ashTarget.y)
  }

  if (destroyedOldCount > 0 && outcome > 0.05) {
    for (const relic of oldRelics.filter(candidate => !preservedOldRelicIndices.has(candidate.index))) {
      const explosionProgress = Math.max(0, Math.min(1, (outcome - 0.08 - relic.index * 0.09) / 0.42))
      if (explosionProgress > 0) drawRitualExplosion(ctx, relic.x, relic.y, oldColor, explosionProgress, now + relic.index * 120)
    }
  }

  ctx.fillStyle = '#fef3c7'
  ctx.textAlign = 'center'
  ctx.font = '900 28px Georgia, serif'
  ctx.fillText(summary ? (nextResult.success ? 'THE RITUAL IS COMPLETE' : 'THE MAELSTROM HAS SPOKEN') : 'ARCANIST RITUAL · RELICS IN CONFLICT', centerX, 43)
  ctx.font = '700 12px sans-serif'
  ctx.fillStyle = '#bae6fd'
  ctx.fillText(summary ? 'RESULTS SEALED INTO THE RELIQUARY' : 'THE RELICS STRUGGLE THROUGH THE MAELSTROM', centerX, 65)

  if (summary) {
    ctx.fillStyle = 'rgba(3, 7, 18, .82)'
    ctx.strokeStyle = nextResult.success ? '#86efac' : '#fb7185'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(centerX - 300, height - 190, 600, 130, 18)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = nextResult.success ? '#86efac' : '#fda4af'
    ctx.font = '900 22px sans-serif'
    ctx.fillText(nextResult.success ? 'REBINDING SUCCEEDED' : 'REBINDING FAILED', centerX, height - 145)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '700 14px sans-serif'
    const lines = nextResult.success
      ? [
          `${nextPreview.incomingName} now empowers the defense.`,
          `${nextResult.recoveredStacks} of ${nextResult.oldStacks} old relic${nextResult.oldStacks === 1 ? '' : 's'} returned to the belt; ${nextResult.oldStacks - nextResult.recoveredStacks} destroyed.`
        ]
      : [
          `${nextPreview.incomingName} was eroded by the maelstrom.`,
          `${nextResult.recoveredStacks} of ${nextResult.oldStacks} old relic${nextResult.oldStacks === 1 ? '' : 's'} survived; ${nextResult.oldStacks - nextResult.recoveredStacks} were destroyed.`
        ]
    lines.forEach((line, index) => ctx.fillText(line, centerX, height - 108 + index * 24))
  }
  ctx.restore()
}

function startRitual() {
  ritualActive.value = true
  ritualStartedAt = performance.now()
  void nextTick(() => {
    if (ritualFrame !== null) cancelAnimationFrame(ritualFrame)
    const frame = (now: number) => {
      if (!ritualActive.value) return
      drawRitual(now)
      ritualFrame = requestAnimationFrame(frame)
    }
    ritualFrame = requestAnimationFrame(frame)
  })
}

function inspectRitual(event: MouseEvent) {
  const canvas = ritualCanvas.value
  if (!canvas || !result.value) return
  const bounds = canvas.getBoundingClientRect()
  const x = (event.clientX - bounds.left) * canvas.width / bounds.width
  const y = (event.clientY - bounds.top) * canvas.height / bounds.height
  selectedRitualEntity.value = [...ritualEntities].reverse().find(entity => Math.hypot(entity.x - x, entity.y - y) <= entity.radius) ?? null
}

function finishRitual() {
  ritualActive.value = false
  if (ritualFrame !== null) {
    cancelAnimationFrame(ritualFrame)
    ritualFrame = null
  }
}

function clearWorkbenchInputs() {
  arcanistInvestment.value = 0
  arcanistOfferBonus.value = 0
  arcanistFocus.value = 'both'
  oddsAnimation.particles = []
  oddsAnimation.settled = []
  for (const crystal of oddsAnimation.crystalPool) crystal.active = false
}

function resetAfterRitual() {
  finishRitual()
  result.value = null
  selectedRitualEntity.value = null
  clearWorkbenchInputs()
  if (props.liveMode) {
    workbenchOpen.value = false
    return
  }
  prepareScenario()
}

function attemptRebind() {
  if (!preview.value || ritualActive.value) return
  result.value = engine?.resolveRelicSwap(preview.value.towerId, preview.value.relicInstanceId, {
    amount: arcanistInvestment.value,
    focus: arcanistFocus.value,
    bonus: arcanistOfferBonus.value
  }) ?? null
  if (result.value) startRitual()
}

function closeWorkbench() {
  const hadResult = Boolean(result.value)
  finishRitual()
  clearWorkbenchInputs()
  result.value = null
  selectedRitualEntity.value = null
  workbenchOpen.value = false
  if (hadResult) prepareScenario()
}

watch(workbenchOpen, (open) => {
  if (open) return
  if (result.value) resetAfterRitual()
  else clearWorkbenchInputs()
})

onMounted(() => {
  relicIconSheet = new Image()
  relicIconSheet.onload = () => {
    drawWorkbench()
    drawOdds()
  }
  relicIconSheet.src = '/games/pathwarden/relics.png'
  if (props.liveMode) return
  createEngine()
  prepareScenario()
})

watch([existingRelicId, incomingRelicId, towerLevel, stacks, arcanistLevel, debugAetherBalance], () => {
  if (engine) prepareScenario()
})

onBeforeUnmount(() => {
  if (oddsFlameFrame !== null) cancelAnimationFrame(oddsFlameFrame)
  if (oddsAnimationFrame !== null) cancelAnimationFrame(oddsAnimationFrame)
  if (ritualFrame !== null) cancelAnimationFrame(ritualFrame)
  relicIconSheet = null
  if (!props.liveMode) engine?.destroy()
})
</script>

<template>
  <div class="space-y-5">
    <template v-if="!props.liveMode">
    <UCard>
      <template #header>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-[10px] font-black uppercase tracking-[0.24em] text-error">Development only</p>
            <h1 class="mt-1 text-2xl font-black">Arcanist swap laboratory</h1>
            <p class="mt-1 max-w-2xl text-sm text-muted">Exercise the real relic binding rules with controlled tower levels, stack counts, families, and permanent Arcanist upgrades.</p>
          </div>
          <UBadge color="info" variant="soft">Options rebuild automatically</UBadge>
        </div>
      </template>

      <div class="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div class="space-y-3">
          <UFormField label="Existing relic type">
            <USelect v-model="existingRelicId" :items="relicOptions" class="w-full" />
          </UFormField>
          <UFormField label="Incoming relic type">
            <USelect v-model="incomingRelicId" :items="relicOptions" class="w-full" />
          </UFormField>
          <UAlert
            v-if="sameRelicType"
            color="info"
            variant="soft"
            icon="i-lucide-flask-conical"
            title="Same relic type test"
            description="This debug case will still open the workbench; normal stacking is disabled here."
          />
          <UAlert
            v-else-if="sameElement"
            color="success"
            variant="soft"
            icon="i-lucide-flame"
            title="Same element, different effect"
            description="This gets the stronger same-element preservation odds, but still requires rebinding."
          />
          <UFormField label="Tower level">
            <USelect v-model="towerLevel" :items="levelOptions" class="w-full" />
          </UFormField>
          <UFormField label="Existing stack count">
            <USelect v-model="stacks" :items="stackOptions" class="w-full" />
          </UFormField>
          <UFormField label="Arcanist upgrade level">
            <USelect v-model="arcanistLevel" :items="arcanistOptions" class="w-full" />
          </UFormField>
          <UFormField label="Available Aether">
            <UInputNumber v-model="debugAetherBalance" :min="0" :max="10000" />
          </UFormField>
          <UButton block color="warning" icon="i-lucide-wand-sparkles" @click="openWorkbench">Open Arcanist workbench</UButton>
        </div>

        <div class="min-w-0 rounded-xl border border-primary/30 bg-background p-2">
          <canvas ref="canvas" width="1200" height="760" class="block aspect-[1200/760] w-full rounded-lg bg-slate-900" aria-label="Relic swap debug battlefield" />
          <div class="mt-2 flex flex-wrap justify-between gap-2 px-1 text-xs text-muted">
            <span>{{ sameElement ? 'Same-element rebinding case' : 'Different-element rebinding case' }}</span>
            <span>Level {{ towerLevel }} · {{ stacks }} stack{{ stacks === 1 ? '' : 's' }} · Arcanist {{ arcanistLevel }}</span>
          </div>
        </div>
      </div>
    </UCard>

    <UCard v-if="preview">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <div><h2 class="font-black">{{ sameElement ? 'Same-element rebinding test' : 'Different-element rebinding test' }}</h2><p class="text-xs text-muted">{{ preview.existingName }} → {{ preview.incomingName }}</p></div>
          <UBadge color="warning">Workbench required</UBadge>
        </div>
      </template>
      <div class="grid gap-2 text-center text-xs sm:grid-cols-3">
        <div class="rounded-lg bg-background p-3"><span class="block text-muted">Bind chance</span><strong class="mt-1 block text-lg text-primary">{{ Math.round(preview.bindChance * 100) }}%</strong></div>
        <div class="rounded-lg bg-background p-3"><span class="block text-muted">Relics preserved</span><strong class="mt-1 block text-lg text-success">{{ Math.round(preview.preserveChance * 100) }}%</strong></div>
        <div class="rounded-lg bg-background p-3"><span class="block text-muted">Stack loss risk</span><strong class="mt-1 block text-lg text-warning">{{ Math.round(preview.stackedLossChance * 100) }}%</strong></div>
      </div>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <UButton color="warning" icon="i-lucide-wand-sparkles" @click="openWorkbench">Open Arcanist workbench</UButton>
      </div>
    </UCard>

    <UAlert
      v-if="result"
      :color="result.success ? (result.preserved ? 'success' : 'warning') : 'error'"
      variant="soft"
      :icon="result.success ? (result.preserved ? 'i-lucide-shield-check' : 'i-lucide-triangle-alert') : 'i-lucide-x-circle'"
      :title="result.success ? (result.preserved ? 'Rebinding succeeded · old relics recovered' : 'Rebinding succeeded · old relics destroyed') : (result.preserved ? 'Rebinding failed · some old relics survived' : 'Rebinding failed · old relics destroyed')"
      :description="result.message"
    >
      <template #description>
        <span>{{ result.message }}</span>
        <span v-if="result.preserved" class="mt-1 block font-semibold">Recovered {{ result.recoveredStacks }} of {{ result.oldStacks }} old relics; {{ result.oldStacks - result.recoveredStacks }} destroyed.</span>
        <span v-else class="mt-1 block font-semibold">All old relics were destroyed.</span>
      </template>
    </UAlert>

    </template>

    <UModal v-model:open="workbenchOpen" title="The Arcanist’s workbench" description="Attempt the controlled rebind, then inspect the exact result." :ui="{ content: 'sm:max-w-6xl' }">
      <template #body>
        <div v-if="ritualActive && result" class="space-y-3">
          <canvas ref="ritualCanvas" width="1100" height="700" class="block h-auto w-full cursor-pointer rounded-2xl border border-primary/30 bg-slate-950 shadow-2xl" aria-label="Animated Arcanist relic binding ritual" @click="inspectRitual" />
          <UCard v-if="selectedRitualEntity" class="border-primary/30 bg-primary/5" :ui="{ body: 'p-3 sm:p-3' }">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-xs font-black uppercase text-primary">Selected ritual entity</p>
                <h3 class="font-semibold">{{ selectedRitualEntity.title }}</h3>
              </div>
              <UButton size="xs" color="neutral" variant="ghost" @click="selectedRitualEntity = null">Close</UButton>
            </div>
            <div class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div class="rounded-lg bg-background p-3">
                <p class="mb-1 text-xs font-bold uppercase text-muted">Before ritual</p>
                <p>Name: <strong>{{ selectedRitualEntity.beforeName }}</strong></p>
                <p>Power: <strong>{{ selectedRitualEntity.beforePower.toFixed(2) }}</strong></p>
                <p class="text-muted">Effect: {{ selectedRitualEntity.beforeEffect }}</p>
                <p class="text-muted">{{ selectedRitualEntity.beforeState }}</p>
              </div>
              <div class="rounded-lg bg-background p-3">
                <p class="mb-1 text-xs font-bold uppercase text-muted">After ritual</p>
                <p>Name: <strong>{{ selectedRitualEntity.afterName }}</strong></p>
                <p>Power: <strong>{{ selectedRitualEntity.afterPower.toFixed(2) }}</strong></p>
                <p class="text-muted">Effect: {{ selectedRitualEntity.afterEffect }}</p>
                <p class="text-muted">{{ selectedRitualEntity.afterState }}<span v-if="selectedRitualEntity.degraded" class="text-warning"> · weakened</span></p>
              </div>
            </div>
          </UCard>
          <div class="flex justify-end">
            <UButton color="neutral" variant="outline" @click="resetAfterRitual">Reset and try again</UButton>
          </div>
        </div>
        <div v-else-if="preview" class="space-y-4">
          <canvas ref="workbenchCanvas" width="900" height="260" class="h-auto w-full rounded-xl border border-primary/30 bg-background shadow-inner" aria-label="Arcanist workbench debug preview" />
          <canvas ref="oddsCanvas" width="900" height="260" class="h-auto w-full rounded-xl border border-primary/30 bg-background shadow-inner" aria-label="Arcanist binding and preservation odds scales" />
          <UCard v-if="!result" class="border-primary/30 bg-primary/5" :ui="{ body: 'p-3 sm:p-3' }">
            <div class="space-y-2">
              <p class="text-xs font-semibold text-muted">Spend it toward</p>
              <div class="grid gap-2 sm:grid-cols-3">
                <UButton
                  v-for="option in arcanistFocusOptions"
                  :key="option.value"
                  block
                  :color="arcanistFocus === option.value ? 'primary' : 'neutral'"
                  :variant="arcanistFocus === option.value ? 'solid' : 'soft'"
                  @click="selectArcanistFocus(option.value)"
                >
                  {{ option.label }}
                </UButton>
              </div>
            </div>
            <div class="mt-3 grid gap-2 sm:grid-cols-5">
              <UButton
                v-for="tier in arcanistInvestmentTiers"
                :key="tier.amount"
                :color="arcanistTierUnavailable(tier) ? 'neutral' : 'warning'"
                class="justify-center text-center"
                :class="arcanistTierUnavailable(tier) ? 'cursor-not-allowed opacity-45 grayscale' : ''"
                :variant="arcanistInvestment === arcanistTierAmount(tier) ? 'solid' : 'soft'"
                :disabled="arcanistTierUnavailable(tier)"
                @click="selectArcanistOffering(tier)"
              >
                <span class="flex flex-col items-center"><span>{{ tier.amount === 0 ? tier.label : `Use ${arcanistTierAmount(tier)} Aether` }}</span><span class="text-[10px] opacity-80">{{ tier.amount === 0 ? tier.result : `+${Math.round(arcanistTierBonus(tier) * 100)}% odds` }}</span></span>
              </UButton>
            </div>
            <p class="mt-2 text-xs text-muted">Aether pile: {{ preview.availableAether }} available. Each higher offer costs more crystals for the next 5% improvement.</p>
          </UCard>
          <UAlert v-if="!result" color="warning" variant="soft" title="The ritual is irreversible" description="Every relic entering the ritual is exposed to arcane pressure. Each individual relic can survive, return weakened, or be burned to dust; stacked relics face the risk separately. Same-affinity relics reduce the pressure, and stabilizing crystals improve the protection odds." />
          <UAlert v-else :color="result.success ? (result.preserved ? 'success' : 'warning') : 'error'" variant="soft" :title="result.success ? (result.preserved ? 'Rebind succeeded · relic recovered' : 'Rebind succeeded · relic destroyed') : (result.preserved ? 'Rebind failed · some relics survived' : 'Rebind failed · relics destroyed')" :description="result.message">
            <template #description>
              <span>{{ result.message }}</span>
              <span class="mt-1 block">{{ result.aetherSpent }} Aether spent · {{ Math.round(result.bindingChance * 100) }}% binding · {{ Math.round(result.preserveChance * 100) }}% preservation.</span>
            </template>
          </UAlert>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="outline" @click="closeWorkbench">Close</UButton>
            <UButton v-if="!result" color="warning" icon="i-lucide-wand-sparkles" @click="attemptRebind">Attempt rebind</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
