<script setup lang="ts">
import {
  tierColor, plantColor, plantCardBg, plantRing, levelTextColor,
  ARTIFACT_TYPES, getArtifact, getPlant,
  effectiveGrowTime,
  type ArtifactType,
} from '#shared/utils/xeno'
import { formatDuration } from '~/utils/xeno-format'

const props = defineProps<{
  inventory: any[]
  freeArtifacts: any[]
  selectedPlantKey?: string | null
  selectedArtifactId?: string | null
}>()

const emit = defineEmits<{
  selectPlant: [payload: { typeId: string; speed: number; yield: number; name: string; emoji: string; tier: number } | null]
  selectArtifact: [payload: { id: string; typeId: string; chargesRemaining: number } | null]
}>()

const activeTab = ref<'seeds' | 'artifacts'>('seeds')
const { virtualEl: cursorEl, track: trackCursor } = useTooltipCursor()

function onSelectPlant(item: any) {
  const key = `${item.typeId}:${item.speed}:${item.yield}`
  if (props.selectedPlantKey === key) {
    emit('selectPlant', null)
  } else {
    emit('selectPlant', { typeId: item.typeId, speed: item.speed, yield: item.yield, name: item.name, emoji: item.emoji, tier: item.tier })
  }
}

// ── Artifact stacking ──────────────────────────────────────────────────────
// Group free artifacts by (typeId + chargesRemaining). Same charges = same stack.
const stackedArtifacts = computed(() => {
  const groups = new Map<string, { typeId: string; chargesRemaining: number; ids: string[]; count: number }>()
  for (const a of props.freeArtifacts) {
    const key = `${a.typeId}:${a.chargesRemaining}`
    const group = groups.get(key)
    if (group) {
      group.ids.push(a.id)
      group.count++
    } else {
      groups.set(key, { typeId: a.typeId, chargesRemaining: a.chargesRemaining, ids: [a.id], count: 1 })
    }
  }
  return [...groups.values()]
})

function onSelectStack(stack: { typeId: string; chargesRemaining: number; ids: string[] }) {
  if (props.selectedArtifactId != null && stack.ids.includes(props.selectedArtifactId)) {
    emit('selectArtifact', null)
  } else {
    emit('selectArtifact', { id: stack.ids[0]!, typeId: stack.typeId, chargesRemaining: stack.chargesRemaining })
  }
}

function isStackSelected(stack: { ids: string[] }): boolean {
  return props.selectedArtifactId != null && stack.ids.includes(props.selectedArtifactId)
}

function ownedQty(plantTypeId: string): number {
  return props.inventory
    .filter(i => i.typeId === plantTypeId)
    .reduce((sum, i) => sum + i.quantity, 0)
}

const sortedInventory = computed(() =>
  [...props.inventory].sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier
    if (b.yield !== a.yield) return b.yield - a.yield
    return b.speed - a.speed
  }),
)

function effectLabel(art: ArtifactType | undefined): string {
  if (!art) return ''
  return art.effects.map(e => {
    switch (e.type) {
      case 'grid_speed_boost': return `−${Math.round(e.value * 100)}% grow time`
      case 'grid_yield_bonus': return `+${e.value} yield/harvest`
      case 'breeder_extra_yield': return `+${e.value} extra plant`
      case 'breeder_mutation_boost': return `+${Math.round(e.value * 100)}% mutation`
      default: return ''
    }
  }).filter(Boolean).join(' & ')
}

function effectTarget(art: ArtifactType | undefined): string {
  if (!art) return ''
  return art.effects.some(e => e.type.startsWith('grid_')) ? 'Grid' : 'Breeder'
}

function getArtifactDef(typeId: string) {
  return ARTIFACT_TYPES.find(a => a.id === typeId)
}
</script>

<template>
  <!-- Tabs -->
  <div class="flex border-b border-default shrink-0">
    <button
      class="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all duration-100"
      :class="activeTab === 'seeds' ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-default'"
      @click="activeTab = 'seeds'"
    >
      Seeds
    </button>
    <button
      class="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all duration-100 relative"
      :class="activeTab === 'artifacts' ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-default'"
      @click="activeTab = 'artifacts'"
    >
      Artifacts
      <span v-if="freeArtifacts.length" class="absolute top-1.5 right-3 size-4 flex items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
        {{ freeArtifacts.length }}
      </span>
    </button>
  </div>

  <!-- ── Seeds tab ─────────────────────────────────────────── -->
  <div v-if="activeTab === 'seeds'" class="flex-1 overflow-y-auto">
    <div v-if="!inventory.length" class="py-12 text-center px-4">
      <UIcon name="i-lucide-sprout" class="size-8 text-muted/30 mx-auto mb-2" />
      <p class="text-sm text-muted">No plants yet.</p>
      <p class="text-xs text-muted/50 mt-1">Harvest from the grid first.</p>
    </div>

    <div v-else class="p-2 grid grid-cols-3 gap-1.5">
      <UTooltip
        v-for="item in sortedInventory"
        :key="`${item.typeId}:${item.speed}:${item.yield}`"
        :delay-duration="300"
        :reference="cursorEl"
        :content="{ side: 'bottom', sideOffset: 12 }"
      >
        <template #content>
          <div class="w-56 p-3 space-y-3 bg-elevated border border-default rounded-xl shadow-xl">
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="font-bold text-sm">{{ item.name }}</p>
                <p class="text-xs font-bold uppercase tracking-wider mt-0.5" :class="plantColor(item.color)">
                  {{ item.quantity }} remaining
                </p>
              </div>
              <XenoTierLabel :tier="item.tier" class="bg-elevated border border-default rounded-full px-2 py-0.5 shrink-0" />
            </div>

            <USeparator />

            <div class="space-y-1.5">
              <XenoStatLevel label="Speed" :level="item.speed" color="bg-warning" />
              <XenoStatLevel label="Yield" :level="item.yield" color="bg-info" />
            </div>

            <USeparator />

            <div class="space-y-1">
              <div class="flex justify-between text-xs">
                <span class="text-muted uppercase tracking-wider font-semibold">Growth</span>
                <span class="font-mono">{{ formatDuration(effectiveGrowTime({ baseTime: item.baseTime, speed: item.speed })) }}</span>
              </div>
              <div class="flex justify-between text-xs">
                <span class="text-muted uppercase tracking-wider font-semibold">Yield</span>
                <span class="font-mono">1–{{ 1 + item.yield }} units</span>
              </div>
              <div class="flex justify-between text-xs">
                <span class="text-muted uppercase tracking-wider font-semibold">Value</span>
                <span class="font-mono">
                  ${{ formatNumber(item.value, false) }}–${{ formatNumber(item.value * (1 + item.yield), false) }}
                </span>
              </div>
            </div>

            <p v-if="item.description" class="text-xs text-muted/70 italic">{{ item.description }}</p>
          </div>
        </template>

        <button
          class="relative flex flex-col rounded-xl border border-default aspect-square w-full overflow-hidden transition-all duration-100"
          :class="[plantCardBg(item.color), selectedPlantKey === `${item.typeId}:${item.speed}:${item.yield}` ? plantRing(item.color) : '']"
          @click="onSelectPlant(item)"
          @mousemove.passive="trackCursor"
        >
          <!-- Tier + qty header -->
          <div class="flex items-center justify-between px-1.5 pt-1.5 shrink-0">
            <XenoTierLabel :tier="item.tier" />
            <span class="text-xs font-black text-success leading-none">×{{ item.quantity }}</span>
          </div>

          <!-- Emoji -->
          <div class="flex-1 flex items-center justify-center">
            <span class="text-3xl leading-none select-none">{{ item.emoji }}</span>
          </div>

          <!-- Name -->
          <p class="text-xs font-bold text-center px-1 mb-1 truncate" :class="plantColor(item.color)">{{ item.name }}</p>

          <!-- Stat strip -->
          <div class="flex divide-x border-t bg-black/15 dark:bg-black/35"
               style="border-color: rgba(0,0,0,0.12)">
            <div class="flex-1 flex items-center justify-center gap-0.5 py-1">
              <UIcon name="i-lucide-zap" class="size-2.5 shrink-0" :class="levelTextColor(item.speed)" />
              <span class="text-xs font-black tabular-nums" :class="levelTextColor(item.speed)">{{ item.speed }}</span>
            </div>
            <div class="flex-1 flex items-center justify-center gap-0.5 py-1">
              <UIcon name="i-lucide-gem" class="size-2.5 shrink-0" :class="levelTextColor(item.yield)" />
              <span class="text-xs font-black tabular-nums" :class="levelTextColor(item.yield)">{{ item.yield }}</span>
            </div>
          </div>
        </button>
      </UTooltip>
    </div>
  </div>

  <!-- ── Artifacts tab ──────────────────────────────────────── -->
  <div v-else class="flex-1 overflow-y-auto p-3 space-y-2">
    <div v-if="!stackedArtifacts.length" class="py-12 text-center px-4">
      <UIcon name="i-lucide-flask-conical" class="size-8 text-muted/30 mx-auto mb-2" />
      <p class="text-sm text-muted">No artifacts.</p>
      <p class="text-xs text-muted/50 mt-1">Craft them in the Artifacts shop.</p>
    </div>

    <div
      v-for="stack in stackedArtifacts"
      :key="`${stack.typeId}:${stack.chargesRemaining}`"
      class="rounded-xl border cursor-pointer transition-all duration-100 overflow-hidden"
      :class="isStackSelected(stack)
        ? 'border-primary bg-primary/5 ring-1 ring-primary'
        : 'border-default bg-elevated hover:border-default/80 hover:bg-elevated/80'"
      @click="onSelectStack(stack)"
    >
      <!-- Artifact header -->
      <div class="flex items-center gap-2.5 px-3 pt-3 pb-2">
        <span class="text-xl leading-none">{{ getArtifact(stack.typeId)?.emoji }}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <p class="text-xs font-semibold truncate">{{ getArtifact(stack.typeId)?.name }}</p>
            <span
              v-if="(getArtifact(stack.typeId)?.effects.length ?? 0) > 1"
              class="text-xs font-bold px-1 py-0.5 rounded bg-primary/10 text-primary leading-none shrink-0"
            >Hybrid</span>
          </div>
          <p class="text-xs text-muted">{{ effectTarget(getArtifact(stack.typeId)) }}</p>
        </div>
        <!-- Stack count + charges -->
        <div class="text-right shrink-0">
          <p class="text-xs font-bold" :class="stack.chargesRemaining <= 2 ? 'text-error' : 'text-default'">
            {{ stack.chargesRemaining }}/{{ getArtifactDef(stack.typeId)?.maxCharges }}
          </p>
          <p class="text-xs text-muted">{{ stack.count > 1 ? `×${stack.count} · ` : '' }}uses</p>
        </div>
      </div>

      <!-- Spec list -->
      <div class="mx-3 mb-2 rounded-lg bg-background/40 border border-default/40 overflow-hidden">
        <div class="flex items-center justify-between px-2.5 py-1.5 border-b border-default/30">
          <span class="text-xs text-muted uppercase tracking-wider font-semibold">Effect</span>
          <span class="text-xs font-bold text-primary text-right">
            {{ effectLabel(getArtifact(stack.typeId)) }}
          </span>
        </div>
        <div class="flex items-center justify-between px-2.5 py-1.5">
          <span class="text-xs text-muted uppercase tracking-wider font-semibold">Charges left</span>
          <div class="flex items-center gap-0.5">
            <div
              v-for="n in (getArtifactDef(stack.typeId)?.maxCharges ?? 1)"
              :key="n"
              class="size-2 rounded-full"
              :class="n <= stack.chargesRemaining ? 'bg-primary' : 'bg-elevated border border-default/40'"
            />
          </div>
        </div>
      </div>

      <!-- Re-craft cost tracking -->
      <div v-if="getArtifactDef(stack.typeId)?.cost.length" class="mx-3 mb-3">
        <p class="text-xs text-muted uppercase tracking-wider font-semibold mb-1.5">Re-craft needs</p>
        <div class="space-y-1">
          <div
            v-for="c in getArtifactDef(stack.typeId)?.cost"
            :key="c.plantTypeId"
            class="flex items-center justify-between"
          >
            <div class="flex items-center gap-1.5">
              <span class="text-sm leading-none">{{ getPlant(c.plantTypeId)?.emoji }}</span>
              <span class="text-xs text-muted truncate">{{ getPlant(c.plantTypeId)?.name }}</span>
            </div>
            <span
              class="text-xs font-bold tabular-nums"
              :class="ownedQty(c.plantTypeId) >= c.quantity ? 'text-success' : 'text-error'"
            >
              {{ ownedQty(c.plantTypeId) }}/{{ c.quantity }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
