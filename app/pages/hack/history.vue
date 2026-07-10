<script setup lang="ts">
import { formatDistanceToNow } from 'date-fns'
import {
  OP_TEMPLATES, RARITY_STYLE,
  type HackRarity
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
  const totalMin = Math.max(1, Math.round(ms / 60_000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h >= 24) {
    const d = Math.floor(h / 24)
    const rem = h % 24
    return rem ? `${d}d ${rem}h` : `${d}d`
  }
  if (h >= 1) return `${h}h ${m.toString().padStart(2, '0')}m`
  return `${m}m`
}
// Relative time is computed against "now", which differs between the SSR
// render and hydration — guard it behind mount so the first client render
// matches the server's and Vue doesn't flag a hydration mismatch.
const mounted = ref(false)
onMounted(() => { mounted.value = true })
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
      `${name} didn't pan out. We'll get the next one.`
    ])
  }
  if (op.itemRarity && (op.itemRarity === 'elite' || op.itemRarity === 'phantom')) {
    return pick(op.id, [
      `${name} paid off, and then some. That gear alone was worth the risk.`,
      `Clean in, clean out — and we walked away with something special.`
    ])
  }
  if (op.gems > 0) {
    return pick(op.id, [
      `${name} went smooth. Cash and gems both — don't get used to it.`,
      `Good night's work. Money's moving, and there's a little extra in it.`
    ])
  }
  return pick(op.id, [
    `${name} went clean. Money's already moving.`,
    `No surprises on this one. That's how we like it.`
  ])
}

const expandedId = ref<string | null>(null)
function toggle(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}
</script>

<template>
  <div class="p-6 pb-12 overflow-y-auto h-full">
    <div class="mb-5">
      <p class="hack-eyebrow">
        // field reports
      </p>
      <h1 class="text-2xl font-bold mt-1.5">
        History
      </h1>
    </div>

    <!-- Lifetime totals -->
    <div
      v-if="pending"
      class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6"
    >
      <USkeleton
        v-for="i in 4"
        :key="i"
        class="h-24 rounded-xl"
      />
    </div>
    <div
      v-else
      class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6"
    >
      <HackFrame class="p-4">
        <p class="hack-eyebrow">
          Lifetime cash
        </p>
        <p
          class="hack-stat-value-lg text-yellow-400 mt-1.5"
          style="font-size: 22px;"
        >
          ${{ formatNumber(data?.totals.cash ?? 0, true) }}
        </p>
      </HackFrame>
      <HackFrame class="p-4">
        <p class="hack-eyebrow">
          Lifetime gems
        </p>
        <p
          class="hack-stat-value-lg text-cyan-400 mt-1.5"
          style="font-size: 22px;"
        >
          {{ formatNumber(data?.totals.gems ?? 0, true) }}
        </p>
      </HackFrame>
      <HackFrame class="p-4">
        <p class="hack-eyebrow">
          Ops completed
        </p>
        <p
          class="hack-stat-value-lg mt-1.5"
          style="font-size: 22px;"
        >
          {{ formatNumber(data?.totals.ops ?? 0, true) }}
        </p>
      </HackFrame>
      <HackFrame class="p-4">
        <p class="hack-eyebrow">
          Success rate
        </p>
        <p
          class="hack-stat-value-lg text-success mt-1.5"
          style="font-size: 22px;"
        >
          {{ successRate }}%
        </p>
      </HackFrame>
    </div>

    <p class="hack-stat-label-md flex items-center gap-2.5 mb-3.5">
      After-action reports
      <span class="flex-1 h-px bg-(--hack-border)" />
    </p>

    <!-- Report rows — all inside one frame, separated by hairlines -->
    <div
      v-if="pending"
      class="space-y-2"
    >
      <USkeleton
        v-for="i in 6"
        :key="i"
        class="h-20 rounded-lg"
      />
    </div>

    <HackFrame v-else-if="data?.history.length">
      <div
        v-for="op in (data.history as HistoryOp[])"
        :key="op.id"
        class="p-4 border-b border-default last:border-b-0 cursor-pointer hover:bg-elevated transition-colors"
        :class="expandedId === op.id && 'bg-elevated'"
        @click="toggle(op.id)"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-4 min-w-0 flex-wrap">
            <span
              class="font-mono font-bold text-[11.5px] tracking-wider px-2.5 py-1 border-2 border-current -rotate-4 shrink-0"
              :class="op.success ? 'text-success' : 'text-error'"
            >
              {{ op.success ? 'SUCCESS' : 'FAILED' }}
            </span>
            <b class="text-[15px] truncate">{{ template(op.templateId)?.name ?? op.templateId }}</b>
          </div>
          <UIcon
            name="i-lucide-chevron-right"
            class="size-4 text-muted shrink-0 transition-transform"
            :class="expandedId === op.id && 'rotate-90'"
          />
        </div>

        <div class="flex items-center gap-2 flex-wrap my-2.5">
          <template v-if="op.success">
            <span class="font-mono text-xs px-2.5 py-1 border border-default bg-elevated text-yellow-400">+${{ formatNumber(op.cash, true) }}</span>
            <span
              v-if="op.gems > 0"
              class="font-mono text-xs px-2.5 py-1 border border-default bg-elevated text-cyan-400"
            >+{{ op.gems }} gems</span>
            <span
              v-if="op.itemName"
              class="font-mono text-xs px-2.5 py-1 border border-default bg-elevated"
              :class="RARITY_STYLE[op.itemRarity as HackRarity]?.text"
            >{{ op.itemName }}</span>
          </template>
          <template v-else>
            <span class="font-mono text-xs px-2.5 py-1 border border-default bg-elevated text-muted">No reward</span>
            <span class="font-mono text-xs px-2.5 py-1 border border-default bg-elevated text-violet-400">Partial XP only</span>
          </template>
        </div>

        <div class="flex items-center gap-4 text-muted font-mono text-[11.5px]">
          <span>{{ op.agentCount }} agent{{ op.agentCount === 1 ? '' : 's' }}</span>
          <span>{{ formatDuration(op.durationMs) }}</span>
          <span v-if="mounted">{{ relativeTime(op.createdAt) }}</span>
        </div>

        <div
          v-if="expandedId === op.id"
          class="mt-3 pt-3 border-t border-dashed border-default text-[13px] leading-relaxed text-muted"
        >
          "{{ debriefLine(op) }}" — RELAY
        </div>
      </div>
    </HackFrame>

    <UEmpty
      v-else
      icon="i-lucide-history"
      description="No operations collected yet — deploy a crew on the Ops tab."
    />
  </div>
</template>
