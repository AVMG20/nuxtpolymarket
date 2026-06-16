<script setup lang="ts">
import { tierLabel, tierColor, plantColor, plantCardBg, levelTextColor, getPlant, getArtifact, getMutation, breedDuration, effectiveGrowTime } from '#shared/utils/xeno'
import { formatCountdown, progressPct, isDone, formatDuration } from '~/utils/xeno-format'

const {
  state, breederSlots, inventory, freeArtifacts,
  unlockBreederSlot, startBreed, cancelBreed, collectBreed,
  attachBreederArtifact, removeBreederArtifact,
} = useXeno()

const now = ref(Date.now())
onMounted(() => {
  const t = setInterval(() => { now.value = Date.now() }, 1000)
  onUnmounted(() => clearInterval(t))
})

// Per-slot selected parents (inventory stack items)
const slotParents = ref<Record<string, { p1: any; p2: any }>>({})

function getSlotParents(slotId: string) {
  if (!slotParents.value[slotId]) slotParents.value[slotId] = { p1: null, p2: null }
  return slotParents.value[slotId]!
}

function getParent(slotId: string, num: 1 | 2) {
  return getSlotParents(slotId)[num === 1 ? 'p1' : 'p2']
}

function clearParent(slotId: string, num: 1 | 2) {
  getSlotParents(slotId)[num === 1 ? 'p1' : 'p2'] = null
}

const plantPickerOpen = ref(false)
const activePickerSlotId = ref<string | null>(null)
const activePickerNum = ref<1 | 2>(1)

function openPicker(slotId: string, num: 1 | 2) {
  activePickerSlotId.value = slotId
  activePickerNum.value = num
  plantPickerOpen.value = true
}

function pickParent(item: any) {
  if (!activePickerSlotId.value) return
  const parents = getSlotParents(activePickerSlotId.value)
  if (activePickerNum.value === 1) parents.p1 = item
  else parents.p2 = item
  plantPickerOpen.value = false
}

function mutationForParents(p1: any, p2: any) {
  if (!p1 || !p2) return null
  return getMutation(p1.typeId, p2.typeId)
}

function mutationPlantFor(p1: any, p2: any) {
  const m = mutationForParents(p1, p2)
  return m ? getPlant(m.offspring) : null
}

function breedTimeForParents(p1: any, p2: any): string {
  if (!p1 || !p2) return '—'
  const secs = breedDuration(
    { baseTime: p1.baseTime, speed: p1.speed },
    { baseTime: p2.baseTime, speed: p2.speed },
  )
  return formatDuration(secs)
}

// Artifact picker
const breederArtifacts = computed(() =>
  freeArtifacts.value.filter((a: any) => getArtifact(a.typeId)?.effect.type.startsWith('breeder_')),
)
const artifactPickerSlotId = ref<string | null>(null)
const artifactPickerOpen = computed({
  get: () => !!artifactPickerSlotId.value,
  set: (v) => { if (!v) artifactPickerSlotId.value = null },
})

async function selectArtifact(artifactId: string) {
  if (!artifactPickerSlotId.value) return
  await attachBreederArtifact(artifactPickerSlotId.value, artifactId)
  artifactPickerSlotId.value = null
}

const starting = ref(new Set<string>())
const cancelling = ref(new Set<string>())
const collecting = ref(new Set<string>())
const unlocking = ref(false)

async function doCancel(slotId: string) {
  cancelling.value.add(slotId)
  try { await cancelBreed(slotId) } finally { cancelling.value.delete(slotId) }
}

async function doStart(slot: any) {
  const p1 = getParent(slot.id, 1)
  const p2 = getParent(slot.id, 2)
  if (!p1 || !p2) return
  starting.value.add(slot.id)
  try {
    await startBreed(slot.id, p1.typeId, p1.speed, p1.yield, p2.typeId, p2.speed, p2.yield)
    slotParents.value[slot.id] = { p1: null, p2: null }
  } finally { starting.value.delete(slot.id) }
}

async function doCollect(slotId: string) {
  collecting.value.add(slotId)
  try { await collectBreed(slotId) } finally { collecting.value.delete(slotId) }
}

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
</script>

<template>
  <UContainer>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold flex items-center gap-2"><span>🧬</span> Breeder</h1>
        <p class="text-sm text-muted mt-0.5">Combine two plants to create new varieties. Rare pairs may mutate.</p>
      </div>
    </div>

    <div v-if="!state" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <USkeleton v-for="i in 3" :key="i" class="h-72 rounded-xl" />
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <!-- ── Breeder slots ── -->
      <div
        v-for="slot in breederSlots"
        :key="slot.id"
        class="rounded-xl border border-default bg-elevated flex flex-col gap-0 overflow-hidden"
      >
        <!-- ── Active breeding ── -->
        <template v-if="slot.startedAt && !slot.collected">
          <!-- ── Result reveal (ready to collect) ── -->
          <template v-if="slot.completesAt && isDone(slot.completesAt) && slot.resultTypeId">
            <div
              class="flex flex-col flex-1 relative overflow-hidden rounded-xl"
              :class="slot.wasMutation
                ? 'ring-2 ring-warning/60 bg-gradient-to-b from-warning/10 to-transparent'
                : 'ring-2 ring-success/40 bg-gradient-to-b from-success/5 to-transparent'"
            >
              <!-- Mutation banner -->
              <div
                v-if="slot.wasMutation"
                class="flex items-center justify-center gap-1.5 py-2 bg-warning/20 border-b border-warning/30"
              >
                <span class="text-sm animate-bounce">✨</span>
                <p class="text-xs font-black text-warning uppercase tracking-widest">Mutation!</p>
                <span class="text-sm animate-bounce">✨</span>
              </div>

              <!-- Result plant -->
              <div class="flex flex-col items-center justify-center gap-3 p-6 flex-1">
                <div
                  class="text-8xl leading-none select-none"
                  :class="slot.wasMutation ? 'animate-pulse' : ''"
                >
                  {{ getPlant(slot.resultTypeId)?.emoji }}
                </div>
                <div class="text-center space-y-1">
                  <p class="text-xl font-black tracking-tight">{{ getPlant(slot.resultTypeId)?.name }}</p>
                  <span
                    class="inline-block text-xs font-bold"
                    :class="tierColor(getPlant(slot.resultTypeId)?.tier ?? 1)"
                  >
                    {{ tierLabel(getPlant(slot.resultTypeId)?.tier ?? 1) }}
                  </span>
                </div>

                <!-- Stats -->
                <div class="flex items-center gap-2">
                  <div class="flex flex-col items-center rounded-lg bg-black/20 px-3 py-2 min-w-[52px]">
                    <p class="text-xs text-muted uppercase tracking-wider font-semibold">Speed</p>
                    <p class="text-lg font-black leading-tight">{{ slot.resultSpeed }}</p>
                  </div>
                  <div class="flex flex-col items-center rounded-lg bg-black/20 px-3 py-2 min-w-[52px]">
                    <p class="text-xs text-muted uppercase tracking-wider font-semibold">Yield</p>
                    <p class="text-lg font-black leading-tight">{{ slot.resultYield }}</p>
                  </div>
                  <div
                    class="flex flex-col items-center rounded-lg px-3 py-2 min-w-[52px]"
                    :class="slot.wasMutation ? 'bg-warning/20' : 'bg-black/20'"
                  >
                    <p class="text-xs text-muted uppercase tracking-wider font-semibold">Qty</p>
                    <p class="text-lg font-black leading-tight" :class="slot.wasMutation ? 'text-warning' : ''">
                      ×{{ slot.resultQuantity }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Collect button -->
              <div class="px-4 pb-4">
                <UButton
                  :label="slot.wasMutation ? '✨ Collect Mutation!' : 'Collect'"
                  block
                  :color="slot.wasMutation ? 'warning' : 'success'"
                  :loading="collecting.has(slot.id)"
                  @click="doCollect(slot.id)"
                />
              </div>
            </div>
          </template>

          <!-- ── In progress ── -->
          <template v-else>
            <div class="p-4 flex flex-col gap-4 flex-1">
              <!-- Status -->
              <div class="flex items-center justify-between">
                <p class="text-xs font-bold text-muted uppercase tracking-wider">Breeding in progress</p>
              </div>

              <!-- Parents -->
              <div class="flex items-center gap-3">
                <div class="flex-1 flex flex-col items-center gap-1 rounded-lg bg-background/40 border border-default/40 p-3">
                  <span class="text-3xl leading-none">{{ slot.parent1 ? getPlant(slot.parent1.typeId)?.emoji : '?' }}</span>
                  <p class="text-sm font-semibold mt-1">{{ slot.parent1 ? getPlant(slot.parent1.typeId)?.name : '?' }}</p>
                  <div v-if="slot.parent1" class="flex items-center gap-1">
                    <XenoLevelBadge prefix="S" :level="slot.parent1.speed" />
                    <XenoLevelBadge prefix="Y" :level="slot.parent1.yield" />
                  </div>
                </div>
                <UIcon name="i-lucide-plus" class="size-4 text-muted shrink-0" />
                <div class="flex-1 flex flex-col items-center gap-1 rounded-lg bg-background/40 border border-default/40 p-3">
                  <span class="text-3xl leading-none">{{ slot.parent2 ? getPlant(slot.parent2.typeId)?.emoji : '?' }}</span>
                  <p class="text-sm font-semibold mt-1">{{ slot.parent2 ? getPlant(slot.parent2.typeId)?.name : '?' }}</p>
                  <div v-if="slot.parent2" class="flex items-center gap-1">
                    <XenoLevelBadge prefix="S" :level="slot.parent2.speed" />
                    <XenoLevelBadge prefix="Y" :level="slot.parent2.yield" />
                  </div>
                </div>
              </div>

              <!-- Progress -->
              <div class="space-y-1.5">
                <div class="h-1.5 rounded-full bg-black/20 overflow-hidden">
                  <div
                    class="h-full bg-primary rounded-full"
                    :style="{ width: `${slot.completesAt ? progressPct(slot.startedAt!, slot.completesAt, now) : 0}%` }"
                  />
                </div>
                <div class="flex items-center justify-between">
                  <p class="text-xs text-muted">{{ slot.completesAt ? formatCountdown(slot.completesAt, now) : '…' }}</p>
                  <div v-if="slot.artifact" class="flex items-center gap-1 text-xs text-muted">
                    <span>{{ getArtifact(slot.artifact.typeId)?.emoji }}</span>
                    <span>{{ slot.artifact.chargesRemaining }}×</span>
                    <button class="hover:text-default ml-1" @click="removeBreederArtifact(slot.id)">✕</button>
                  </div>
                </div>
              </div>

              <div class="flex items-center justify-between">
                <p class="text-xs text-muted">Ready when timer hits zero</p>
                <UButton
                  label="Cancel"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  :loading="cancelling.has(slot.id)"
                  @click="doCancel(slot.id)"
                />
              </div>
            </div>
          </template>
        </template>

        <!-- ── Setup ── -->
        <template v-else>
          <div class="p-4 flex flex-col gap-4 flex-1">
            <p class="text-xs font-bold text-muted uppercase tracking-wider">Breed Setup</p>

            <!-- Parent pickers — big and prominent -->
            <div class="grid grid-cols-2 gap-2">
              <div
                v-for="num in [1, 2] as const"
                :key="num"
                class="relative rounded-xl border-2 border-dashed flex flex-col items-center gap-2 p-4 cursor-pointer transition-all min-h-[120px] justify-center text-center"
                :class="getParent(slot.id, num)
                  ? 'border-default bg-background/40 hover:bg-background/60'
                  : 'border-default/50 hover:border-primary/50 hover:bg-primary/5'"
                @click="openPicker(slot.id, num)"
              >
                <template v-if="getParent(slot.id, num)">
                  <button
                    class="absolute top-1.5 right-1.5 size-5 flex items-center justify-center rounded bg-black/30 hover:bg-black/60 z-10 text-white/60 hover:text-white"
                    @click.stop="clearParent(slot.id, num)"
                  >
                    <UIcon name="i-lucide-x" class="size-3" />
                  </button>
                  <span class="text-4xl leading-none">{{ getParent(slot.id, num).emoji }}</span>
                  <p class="text-sm font-bold leading-tight">{{ getParent(slot.id, num).name }}</p>
                  <div class="flex items-center gap-1">
                    <XenoLevelBadge prefix="S" :level="getParent(slot.id, num).speed" />
                    <XenoLevelBadge prefix="Y" :level="getParent(slot.id, num).yield" />
                  </div>
                </template>
                <template v-else>
                  <UIcon name="i-lucide-plus" class="size-6 text-muted/50" />
                  <p class="text-xs text-muted">Plant {{ num }}</p>
                </template>
              </div>
            </div>

            <!-- Result preview -->
            <template v-if="getParent(slot.id, 1) && getParent(slot.id, 2)">
              <!-- Mutation preview -->
              <UTooltip
                v-if="mutationForParents(getParent(slot.id, 1), getParent(slot.id, 2))"
                :delay-duration="200"
              >
                <template #content>
                  <div class="w-56 p-3 space-y-3 bg-elevated border border-default rounded-xl shadow-xl">
                    <div class="flex items-center gap-2">
                      <span class="text-2xl leading-none">{{ mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.emoji }}</span>
                      <div>
                        <p class="font-bold text-sm">{{ mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.name }}</p>
                        <span class="text-xs font-bold uppercase tracking-wider" :class="tierColor(mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.tier ?? 1)">
                          {{ tierLabel(mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.tier ?? 1) }} · Mutation
                        </span>
                      </div>
                    </div>
                    <USeparator />
                    <div class="space-y-1.5">
                      <XenoStatLevel label="Speed" :level="mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.speed ?? 0" color="bg-warning" />
                      <XenoStatLevel label="Yield" :level="mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.yield ?? 0" color="bg-info" />
                    </div>
                    <USeparator />
                    <div class="space-y-1">
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Effective time</span>
                        <span class="font-mono">{{ mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2)) ? formatDuration(effectiveGrowTime(mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))!)) : '—' }}</span>
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Yield</span>
                        <span class="font-mono">1–{{ 1 + (mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.yield ?? 0) }} units</span>
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-muted uppercase tracking-wider font-semibold">Value</span>
                        <span class="font-mono" :class="plantColor(mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.color ?? '')">
                          ${{ formatNumber(mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.value ?? 0, false) }}
                        </span>
                      </div>
                    </div>
                    <p v-if="mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.description" class="text-xs text-muted/70 italic">
                      {{ mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.description }}
                    </p>
                  </div>
                </template>

                <div class="rounded-xl border border-warning/30 bg-warning/5 p-3 space-y-2 cursor-help">
                  <div class="flex items-center justify-between">
                    <p class="text-xs font-bold text-warning uppercase tracking-wider">Possible Mutation</p>
                    <span class="text-xs font-bold text-warning">
                      {{ (mutationForParents(getParent(slot.id, 1), getParent(slot.id, 2))!.chance * 100).toFixed(0) }}% chance
                    </span>
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="text-3xl leading-none">{{ mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.emoji }}</span>
                    <div>
                      <p class="font-bold text-sm">{{ mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.name }}</p>
                      <span class="text-xs font-bold" :class="tierColor(mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.tier ?? 1)">
                        {{ tierLabel(mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.tier ?? 1) }}
                      </span>
                    </div>
                  </div>
                </div>
              </UTooltip>

              <!-- No mutation -->
              <div v-else class="rounded-xl border border-default/40 bg-background/30 px-3 py-2.5">
                <p class="text-xs text-muted">No mutation for this pair — offspring inherits 50/50 stats from both parents.</p>
              </div>

              <!-- Breed time -->
              <div class="flex items-center gap-2 text-sm text-muted">
                <UIcon name="i-lucide-clock" class="size-4 shrink-0" />
                <span>Est. time:</span>
                <span class="font-semibold text-default">{{ breedTimeForParents(getParent(slot.id, 1), getParent(slot.id, 2)) }}</span>
              </div>
            </template>

            <!-- Artifact slot -->
            <div class="border-t border-default/40 pt-3">
              <div v-if="slot.artifact" class="flex items-center gap-2 text-sm">
                <span class="text-lg">{{ getArtifact(slot.artifact.typeId)?.emoji }}</span>
                <span class="flex-1 text-muted truncate text-xs">{{ getArtifact(slot.artifact.typeId)?.name }}</span>
                <span class="text-xs text-muted">{{ slot.artifact.chargesRemaining }}×</span>
                <button class="text-muted hover:text-default text-xs" @click="removeBreederArtifact(slot.id)">✕</button>
              </div>
              <button
                v-else-if="breederArtifacts.length"
                class="text-xs text-muted hover:text-default underline"
                @click="artifactPickerSlotId = slot.id"
              >
                + attach artifact
              </button>
            </div>
          </div>

          <div class="px-4 pb-4">
            <UButton
              label="Start Breeding"
              icon="i-lucide-dna"
              block
              :disabled="!getParent(slot.id, 1) || !getParent(slot.id, 2)"
              :loading="starting.has(slot.id)"
              @click="doStart(slot)"
            />
          </div>
        </template>
      </div>

      <!-- ── Unlock slot ── -->
      <div
        v-if="state.breeder.unlockedCount < state.breeder.maxSlots"
        class="rounded-xl border border-dashed border-default bg-elevated/50 p-4 flex flex-col items-center justify-center gap-3 min-h-[200px]"
      >
        <UIcon name="i-lucide-lock" class="size-6 text-muted" />
        <div class="text-center">
          <p class="text-sm font-medium">New Breeder Slot</p>
          <p class="text-xs text-muted">${{ formatNumber(state.breeder.nextSlotCost, false) }}</p>
        </div>
        <UButton
          label="Unlock"
          size="sm"
          variant="soft"
          color="neutral"
          :loading="unlocking"
          :disabled="balance < state.breeder.nextSlotCost"
          @click="async () => { unlocking = true; try { await unlockBreederSlot() } finally { unlocking = false } }"
        />
      </div>
    </div>
  </UContainer>

  <!-- Plant picker modal -->
  <UModal v-model:open="plantPickerOpen" title="Select Parent Plant">
    <template #body>
      <div class="space-y-1.5 max-h-96 overflow-y-auto p-1">
        <p v-if="!inventory.length" class="text-sm text-muted py-4 text-center">No plants available.</p>
        <button
          v-for="item in inventory"
          :key="`${item.typeId}:${item.speed}:${item.yield}`"
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-default transition-all text-left overflow-hidden"
          :class="plantCardBg(item.color)"
          @click="pickParent(item)"
        >
          <span class="text-3xl leading-none shrink-0">{{ item.emoji }}</span>
          <div class="flex-1 min-w-0">
            <p class="font-bold text-sm truncate">{{ item.name }}</p>
            <span class="text-xs font-bold" :class="tierColor(item.tier)">{{ tierLabel(item.tier) }}</span>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-zap" class="size-3" :class="levelTextColor(item.speed)" />
              <span class="text-xs font-black" :class="levelTextColor(item.speed)">{{ item.speed }}</span>
            </div>
            <div class="flex items-center gap-1">
              <UIcon name="i-lucide-gem" class="size-3" :class="levelTextColor(item.yield)" />
              <span class="text-xs font-black" :class="levelTextColor(item.yield)">{{ item.yield }}</span>
            </div>
            <span class="text-sm font-black text-success">×{{ item.quantity }}</span>
          </div>
        </button>
      </div>
    </template>
  </UModal>

  <!-- Artifact picker modal -->
  <UModal v-model:open="artifactPickerOpen" title="Attach Breeder Artifact">
    <template #body>
      <div class="space-y-1.5">
        <p v-if="!breederArtifacts.length" class="text-sm text-muted text-center py-4">No breeder artifacts available.</p>
        <button
          v-for="a in breederArtifacts"
          :key="a.id"
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-default bg-elevated hover:bg-background transition-colors text-left"
          @click="selectArtifact(a.id)"
        >
          <span class="text-xl">{{ getArtifact(a.typeId)?.emoji }}</span>
          <div class="flex-1">
            <p class="text-sm font-semibold">{{ getArtifact(a.typeId)?.name }}</p>
            <p class="text-xs text-muted">{{ getArtifact(a.typeId)?.description }}</p>
          </div>
          <span class="text-xs text-muted">{{ a.chargesRemaining }}×</span>
        </button>
      </div>
    </template>
  </UModal>
</template>
