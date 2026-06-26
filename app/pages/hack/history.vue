<script setup lang="ts">
import { formatDistanceToNow } from 'date-fns'
import {
  OP_TEMPLATES, RARITY_COLOR, RARITY_LABEL,
  type HackRarity,
} from '#shared/utils/hack-config'

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
</script>

<template>
  <div class="flex-1 min-h-0 overflow-y-auto">
    <UContainer class="py-6 space-y-6 pb-12">
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-history" class="size-6 text-primary" />
        Operation History
      </h1>
      <p class="text-sm text-muted mt-0.5">A log of every op you've collected, and your lifetime haul.</p>
    </div>

    <!-- Totals -->
    <div v-if="pending" class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <USkeleton v-for="i in 4" :key="i" class="h-24 rounded-xl" />
    </div>
    <div v-else class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="p-4 rounded-xl border border-default bg-elevated/40">
        <div class="flex items-center gap-2 text-muted mb-1">
          <UIcon name="i-lucide-banknote" class="size-4 text-yellow-400" />
          <span class="text-xs">Cash earned</span>
        </div>
        <p class="text-xl font-bold text-yellow-400">
          <CoinBalance :value="data?.totals.cash ?? 0" :show-icon="false" />
        </p>
      </div>
      <div class="p-4 rounded-xl border border-default bg-elevated/40">
        <div class="flex items-center gap-2 text-muted mb-1">
          <UIcon name="i-lucide-gem" class="size-4 text-cyan-400" />
          <span class="text-xs">Gems earned</span>
        </div>
        <p class="text-xl font-bold text-cyan-400">
          <GemBalance :value="data?.totals.gems ?? 0" :show-icon="false" />
        </p>
      </div>
      <div class="p-4 rounded-xl border border-default bg-elevated/40">
        <div class="flex items-center gap-2 text-muted mb-1">
          <UIcon name="i-lucide-package" class="size-4 text-warning" />
          <span class="text-xs">Items found</span>
        </div>
        <p class="text-xl font-bold text-warning">{{ formatNumber(data?.totals.items ?? 0, true) }}</p>
      </div>
      <div class="p-4 rounded-xl border border-default bg-elevated/40">
        <div class="flex items-center gap-2 text-muted mb-1">
          <UIcon name="i-lucide-check-circle" class="size-4 text-success" />
          <span class="text-xs">Ops done</span>
        </div>
        <p class="text-xl font-bold text-success">{{ formatNumber(data?.totals.ops ?? 0, true) }}</p>
        <p class="text-[11px] text-muted mt-0.5">{{ successRate }}% success</p>
      </div>
    </div>

    <!-- History list -->
    <div v-if="pending" class="space-y-2">
      <USkeleton v-for="i in 6" :key="i" class="h-16 rounded-lg" />
    </div>

    <div v-else-if="data?.history.length" class="space-y-2">
      <div
        v-for="op in data.history"
        :key="op.id"
        class="flex items-center gap-3 px-4 py-3 rounded-lg border border-default bg-elevated/30"
      >
        <!-- Op icon -->
        <div class="size-9 rounded-lg flex items-center justify-center shrink-0"
          :class="op.success ? 'bg-success/10' : 'bg-error/10'">
          <UIcon :name="template(op.templateId)?.icon ?? 'i-lucide-terminal'"
            class="size-4.5" :class="op.success ? 'text-success' : 'text-error'" />
        </div>

        <!-- Name + meta -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-sm truncate">{{ template(op.templateId)?.name ?? op.templateId }}</span>
            <UBadge size="xs" variant="subtle" :color="op.success ? 'success' : 'error'"
              :label="op.success ? 'Success' : 'Failed'" />
          </div>
          <p class="text-xs text-muted mt-0.5 flex items-center gap-2 flex-wrap">
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
      </div>
    </div>

      <UEmpty
        v-else
        icon="i-lucide-history"
        description="No operations collected yet — deploy a crew on the Ops tab."
      />
    </UContainer>
  </div>
</template>
