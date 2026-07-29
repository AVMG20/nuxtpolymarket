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
import { PATHWARDEN_RELICS } from '~/utils/pathwarden-engine'

const canvas = ref<HTMLCanvasElement | null>(null)
const snapshot = ref<PathwardenSnapshot | null>(null)
const preview = ref<PathwardenRelicSwapPreview | null>(null)
const result = ref<PathwardenRelicSwapResult | null>(null)
const workbenchOpen = ref(false)
const workbenchCanvas = ref<HTMLCanvasElement | null>(null)
const oddsCanvas = ref<HTMLCanvasElement | null>(null)
let rainUntil = 0
const arcanistInvestment = ref(0)
const arcanistOfferBonus = ref(0)
const arcanistFocus = ref<PathwardenRelicSwapFocus>('both')
const arcanistFocusOptions = [
  { label: 'Improve binding odds', value: 'binding' },
  { label: 'Improve preservation odds', value: 'preservation' },
  { label: 'Split between both', value: 'both' }
]
const arcanistInvestmentTiers = [
  { amount: 5, bonus: 0.05, label: 'Use 5 Aether', result: '+5% odds' },
  { amount: 15, bonus: 0.10, label: 'Use 15 Aether', result: '+10% odds' },
  { amount: 30, bonus: 0.15, label: 'Use 30 Aether', result: '+15% odds' },
  { amount: 50, bonus: 0.20, label: 'Use 50 Aether', result: '+20% odds' }
]
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
  arcanistInvestment.value = 0
  arcanistOfferBonus.value = 0
  arcanistFocus.value = 'both'
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
  const center = { x: width / 2, y: height / 2 + 6 }
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, '#172554')
  gradient.addColorStop(1, '#0f172a')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(14, 116, 144, 0.18)'
  ctx.fillRect(0, height * 0.68, width, height * 0.32)
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.72)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(center.x, center.y, 72, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.7)'
  ctx.lineWidth = 2
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4
    ctx.beginPath()
    ctx.moveTo(center.x + Math.cos(angle) * 78, center.y + Math.sin(angle) * 78)
    ctx.lineTo(center.x + Math.cos(angle) * 94, center.y + Math.sin(angle) * 94)
    ctx.stroke()
  }
  ctx.fillStyle = '#a16207'
  ctx.fillRect(52, height * 0.68, width - 104, 36)
  ctx.fillStyle = '#d6a15d'
  ctx.fillRect(52, height * 0.66, width - 104, 9)
  ctx.fillStyle = '#fef3c7'
  ctx.font = '900 22px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText('ARCANIST WORKBENCH', center.x, 42)
  ctx.font = '700 13px sans-serif'
  ctx.fillStyle = '#bae6fd'
  ctx.fillText('The old binding is tested before the new one takes hold.', center.x, 64)
  ctx.font = '900 15px sans-serif'
  ctx.fillStyle = '#fecaca'
  ctx.fillText(nextPreview.existingName, 170, height * 0.79)
  ctx.fillStyle = '#bbf7d0'
  ctx.fillText(nextPreview.incomingName, width - 170, height * 0.79)
  ctx.strokeStyle = '#facc15'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(270, height * 0.76)
  ctx.quadraticCurveTo(center.x, height * 0.42, width - 270, height * 0.76)
  ctx.stroke()
  ctx.fillStyle = '#facc15'
  ctx.font = '900 26px serif'
  ctx.fillText('✦', center.x, center.y + 9)
}

function selectArcanistOffering(tier: typeof arcanistInvestmentTiers[number]) {
  if (!preview.value || tier.amount > preview.value.availableAether) return
  arcanistInvestment.value = tier.amount
  arcanistOfferBonus.value = tier.bonus
  animateCrystals()
}

function drawOdds() {
  const canvas = oddsCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const drawScale = (x: number, label: string, odds: number, color: string) => {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.8)'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(x, 174, 74, Math.PI, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = color
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.arc(x, 174, 74, Math.PI, Math.PI + Math.PI * odds)
    ctx.stroke()
    const angle = Math.PI + Math.PI * odds
    ctx.strokeStyle = '#f8fafc'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(x, 174)
    ctx.lineTo(x + Math.cos(angle) * 62, 174 + Math.sin(angle) * 62)
    ctx.stroke()
    ctx.fillStyle = '#f8fafc'
    ctx.beginPath()
    ctx.arc(x, 174, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = '900 15px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#f8fafc'
    ctx.fillText(label, x, 30)
    ctx.font = '900 26px sans-serif'
    ctx.fillStyle = color
    ctx.fillText(`${Math.round(odds * 100)}%`, x, 78)
    ctx.font = '700 11px sans-serif'
    ctx.fillStyle = '#94a3b8'
    ctx.fillText('failure', x - 76, 205)
    ctx.fillText('SUCCESS', x + 76, 205)
  }
  drawScale(225, 'BINDING', arcanistBindingChance.value, '#38bdf8')
  drawScale(675, 'PRESERVE OLD RELIC', arcanistPreserveChance.value, '#86efac')
  ctx.font = '700 12px sans-serif'
  ctx.fillStyle = '#facc15'
  ctx.fillText('AETHER SCALES · CRYSTALS TIP THE NEEDLE TOWARD SUCCESS', 450, 238)
  const rainProgress = Math.max(0, Math.min(1, 1 - (rainUntil - performance.now()) / 900))
  if (rainProgress > 0 && rainProgress < 1) {
    for (let index = 0; index < 12; index++) {
      const x = 105 + (index * 71) % 690
      const y = 92 + ((rainProgress * 250 + index * 31) % 88)
      ctx.fillStyle = index % 2 ? '#67e8f9' : '#fde68a'
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(index * 0.6)
      ctx.fillRect(-5, -8, 10, 16)
      ctx.restore()
    }
  }
}

function animateCrystals() {
  rainUntil = performance.now() + 900
  const frame = () => {
    drawOdds()
    if (performance.now() < rainUntil) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

watch([arcanistFocus, arcanistOfferBonus], () => {
  if (workbenchOpen.value) void nextTick(drawOdds)
})

function createEngine() {
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
  if (!engine) createEngine()
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

function attemptRebind() {
  if (!preview.value) return
  result.value = engine?.resolveRelicSwap(preview.value.towerId, preview.value.relicInstanceId, {
    amount: arcanistInvestment.value,
    focus: arcanistFocus.value,
    bonus: arcanistOfferBonus.value
  }) ?? null
}

function closeWorkbench() {
  workbenchOpen.value = false
}

onMounted(() => {
  createEngine()
  prepareScenario()
})

watch([existingRelicId, incomingRelicId, towerLevel, stacks, arcanistLevel], () => {
  if (engine) prepareScenario()
})

onBeforeUnmount(() => engine?.destroy())
</script>

<template>
  <div class="space-y-5">
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
        <div class="rounded-lg bg-background p-3"><span class="block text-muted">Old relic preserved</span><strong class="mt-1 block text-lg text-success">{{ Math.round(preview.preserveChance * 100) }}%</strong></div>
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
      :title="result.success ? (result.preserved ? 'Rebinding succeeded · old relic preserved' : 'Rebinding succeeded · old relic destroyed') : 'Rebinding failed · nothing changed'"
      :description="result.message"
    >
      <template #description>
        <span>{{ result.message }}</span>
        <span v-if="result.success && result.preserved" class="mt-1 block font-semibold">Recovered {{ result.recoveredStacks }} of {{ result.oldStacks }} old stack{{ result.oldStacks === 1 ? '' : 's' }}.</span>
        <span v-else-if="result.success" class="mt-1 block font-semibold">No displaced relic returned to the reliquary.</span>
      </template>
    </UAlert>

    <UModal v-model:open="workbenchOpen" title="The Arcanist’s workbench" description="Attempt the controlled rebind, then inspect the exact result.">
      <template #body>
        <div v-if="preview" class="space-y-4">
          <canvas ref="workbenchCanvas" width="900" height="260" class="h-auto w-full rounded-xl border border-primary/30 bg-background shadow-inner" aria-label="Arcanist workbench debug preview" />
          <canvas ref="oddsCanvas" width="900" height="260" class="h-auto w-full rounded-xl border border-primary/30 bg-background shadow-inner" aria-label="Arcanist binding and preservation odds scales" />
          <div class="grid gap-3 sm:grid-cols-2">
            <UCard class="border-error/30 bg-error/5"><p class="text-[10px] font-black uppercase text-error">Existing</p><strong>{{ preview.existingName }}</strong><p class="text-xs text-muted">{{ preview.existingStacks }} stacks · {{ preview.existingPower.toFixed(2) }} power</p></UCard>
            <UCard class="border-success/30 bg-success/5"><p class="text-[10px] font-black uppercase text-success">Incoming</p><strong>{{ preview.incomingName }}</strong><p class="text-xs text-muted">{{ preview.incomingPower.toFixed(2) }} power</p></UCard>
          </div>
          <div class="grid gap-2 text-center text-xs sm:grid-cols-3">
            <div class="rounded-lg bg-background p-3"><span class="block text-muted">Binding</span><strong class="text-lg text-primary">{{ Math.round(arcanistBindingChance * 100) }}%</strong></div>
            <div class="rounded-lg bg-background p-3"><span class="block text-muted">Preserve old</span><strong class="text-lg text-success">{{ Math.round(arcanistPreserveChance * 100) }}%</strong></div>
            <div class="rounded-lg bg-background p-3"><span class="block text-muted">Stack loss</span><strong class="text-lg text-warning">{{ Math.round(preview.stackedLossChance * 100) }}%</strong></div>
          </div>
          <UCard v-if="!result" class="border-primary/30 bg-primary/5" :ui="{ body: 'p-3 sm:p-3' }">
            <div class="flex flex-wrap items-end gap-3">
              <UFormField label="Spend it toward" class="min-w-56 flex-1">
                <USelect v-model="arcanistFocus" :items="arcanistFocusOptions" class="w-full" />
              </UFormField>
            </div>
            <div class="mt-3 grid gap-2 sm:grid-cols-4">
              <UButton
                v-for="tier in arcanistInvestmentTiers"
                :key="tier.amount"
                color="warning"
                :variant="arcanistInvestment === tier.amount ? 'solid' : 'soft'"
                :disabled="tier.amount > preview.availableAether"
                @click="selectArcanistOffering(tier)"
              >
                <span class="flex flex-col items-center"><span>{{ tier.label }}</span><span class="text-[10px] opacity-80">{{ tier.result }}</span></span>
              </UButton>
            </div>
            <p class="mt-2 text-xs text-muted">Aether pile: {{ preview.availableAether }} available. Each higher offer costs more crystals for the next 5% improvement.</p>
          </UCard>
          <UAlert v-if="!result" color="warning" variant="soft" title="The ritual is irreversible" description="The new relic is consumed only if binding succeeds. The old relic can return weakened or be destroyed." />
          <UAlert v-else :color="result.success ? (result.preserved ? 'success' : 'warning') : 'error'" variant="soft" :title="result.success ? (result.preserved ? 'Rebind succeeded · relic recovered' : 'Rebind succeeded · relic destroyed') : 'Rebind failed · no changes'" :description="result.message">
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
