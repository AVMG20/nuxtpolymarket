<script setup lang="ts">
import { formatDistanceToNow } from 'date-fns'
import {
  OP_TEMPLATES, RARITY_COLOR, RARITY_LABEL,
  type HackRarity,
} from '#shared/utils/hack-config'

type HistoryOp = {
  id: string
  templateId: string
  success: boolean
  cash: number
  gems: number
  itemName: string | null
  itemRarity: string | null
  agentCount: number
  durationMs: number
  createdAt: string
}

const { data, pending } = await useFetch('/api/hack/history')

const templateMap = new Map(OP_TEMPLATES.map(t => [t.id, t]))
function template(id: string) {
  return templateMap.get(id)
}

function formatDuration(ms: number) {
  const h = Math.round(ms / 3_600_000)
  if (h >= 24) {
    const d = Math.floor(h / 24)
    const rem = h % 24
    return rem ? `${d}d ${rem}h` : `${d}d`
  }
  if (h >= 1) return `${h}h`
  return `${Math.max(1, Math.round(ms / 60_000))}m`
}
function relativeTime(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

const successRate = computed(() => {
  const t = data.value?.totals
  if (!t || t.ops === 0) return 0
  return Math.round((t.successes / t.ops) * 100)
})

// ── Debrief one-liner — RELAY's voice, generated client-side from the outcome
// data (no new content needed per op, per PLAN.md §6.8). A small fixed pool of
// variants keyed by outcome shape, picked deterministically off the op id so
// the line doesn't change on every re-render.
function pick(id: string, options: string[]) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return options[hash % options.length]!
}
function debriefLine(op: HistoryOp): string {
  const name = template(op.templateId)?.name ?? 'the job'
  if (!op.success) {
    return pick(op.id, [
      `${name} went sideways. Everyone made it back — that's the count that matters.`,
      `We lost this one. No cash, no gear, but nobody's in a hole in the ground.`,
      `${name} didn't pan out. We'll get the next one.`,
    ])
  }
  if (op.itemRarity && (op.itemRarity === 'elite' || op.itemRarity === 'phantom')) {
    return pick(op.id, [
      `${name} paid off, and then some. That gear alone was worth the risk.`,
      `Clean in, clean out — and we walked away with something special.`,
    ])
  }
  if (op.gems > 0) {
    return pick(op.id, [
      `${name} went smooth. Cash and gems both — don't get used to it.`,
      `Good night's work. Money's moving, and there's a little extra in it.`,
    ])
  }
  return pick(op.id, [
    `${name} went clean. Money's already moving.`,
    `No surprises on this one. That's how we like it.`,
  ])
}

const expandedId = ref<string | null>(null)
function toggle(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}
</script>

<template>
  <div class="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 pb-12">
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-history" class="size-6 text-primary" />
        Debrief Log
      </h1>
      <p class="hack-eyebrow mt-1.5">// lifetime record — every op you've collected</p>
    </div>

    <!-- Totals -->
    <div v-if="pending" class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <USkeleton v-for="i in 4" :key="i" class="h-24 rounded-xl" />
    </div>
    <div v-else class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <HackFrame tight class="p-4">
        <div class="flex items-center gap-2 text-muted mb-1.5">
          <UIcon name="i-lucide-banknote" class="size-4 text-yellow-400" />
          <span class="hack-stat-label-md">Cash earned</span>
        </div>
        <p class="hack-stat-value-lg text-yellow-400">
          <CoinBalance :value="data?.totals.cash ?? 0" :show-icon="false" />
        </p>
      </HackFrame>
      <HackFrame tight class="p-4">
        <div class="flex items-center gap-2 text-muted mb-1.5">
          <UIcon name="i-lucide-gem" class="size-4 text-cyan-400" />
          <span class="hack-stat-label-md">Gems earned</span>
        </div>
        <p class="hack-stat-value-lg text-cyan-400">
          <GemBalance :value="data?.totals.gems ?? 0" :show-icon="false" />
        </p>
      </HackFrame>
      <HackFrame tight class="p-4">
        <div class="flex items-center gap-2 text-muted mb-1.5">
          <UIcon name="i-lucide-package" class="size-4 text-warning" />
          <span class="hack-stat-label-md">Items found</span>
        </div>
        <p class="hack-stat-value-lg text-warning">{{ formatNumber(data?.totals.items ?? 0, true) }}</p>
      </HackFrame>
      <HackFrame tight class="p-4">
        <div class="flex items-center gap-2 text-muted mb-1.5">
          <UIcon name="i-lucide-check-circle" class="size-4 text-success" />
          <span class="hack-stat-label-md">Ops done</span>
        </div>
        <p class="hack-stat-value-lg text-success">{{ formatNumber(data?.totals.ops ?? 0, true) }}</p>
        <p class="text-[11px] text-muted mt-0.5">{{ successRate }}% success</p>
      </HackFrame>
    </div>

    <!-- History list -->
    <div v-if="pending" class="space-y-2">
      <USkeleton v-for="i in 6" :key="i" class="h-16 rounded-lg" />
    </div>

    <div v-else-if="data?.history.length" class="space-y-2">
      <HackFrame
        v-for="op in (data.history as HistoryOp[])"
        :key="op.id"
        tight
        class="cursor-pointer"
        @click="toggle(op.id)"
      >
        <div class="flex items-center gap-3 p-3">
          <!-- Op icon -->
          <div class="size-9 rounded-lg flex items-center justify-center shrink-0"
            :class="op.success ? 'bg-success/10' : 'bg-error/10'">
            <UIcon :name="template(op.templateId)?.icon ?? 'i-lucide-terminal'"
              class="size-4.5" :class="op.success ? 'text-success' : 'text-error'" />
          </div>

          <!-- Name + meta -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-sm truncate">{{ template(op.templateId)?.name ?? op.templateId }}</span>
              <span class="hack-stamp-sm" :class="op.success ? 'text-success' : 'text-error'">
                {{ op.success ? 'Success' : 'Failed' }}
              </span>
            </div>
            <p class="text-xs text-muted mt-1 flex items-center gap-2 flex-wrap">
              <span class="flex items-center gap-1"><UIcon name="i-lucide-users" class="size-3" />{{ op.agentCount }}</span>
              <span class="flex items-center gap-1"><UIcon name="i-lucide-clock" class="size-3" />{{ formatDuration(op.durationMs) }}</span>
              <span>{{ relativeTime(op.createdAt) }}</span>
            </p>
          </div>

          <!-- Rewards -->
          <div class="flex items-center gap-3 shrink-0 text-sm tabular-nums">
            <template v-if="op.success">
              <span class="font-semibold text-yellow-400">
                <CoinBalance :value="op.cash" />
              </span>
              <span v-if="op.gems > 0" class="font-semibold text-cyan-400">
                <GemBalance :value="op.gems" />
              </span>
              <UBadge v-if="op.itemName" size="xs" variant="subtle"
                :color="RARITY_COLOR[op.itemRarity as HackRarity] ?? 'neutral'"
                :label="op.itemName" class="max-w-32 truncate" />
            </template>
            <span v-else class="text-muted text-xs">No loot</span>
          </div>

          <UIcon
            name="i-lucide-chevron-down"
            class="size-4 text-muted shrink-0 transition-transform"
            :class="expandedId === op.id && 'rotate-180'"
          />
        </div>

        <div v-if="expandedId === op.id" class="px-3 pb-3 pt-2 border-t border-default">
          <p class="text-sm text-muted font-mono">{{ debriefLine(op) }}</p>
        </div>
      </HackFrame>
    </div>

    <UEmpty
      v-else
      icon="i-lucide-history"
      description="No operations collected yet — deploy a crew on the Ops tab."
    />
  </div>
</template>
