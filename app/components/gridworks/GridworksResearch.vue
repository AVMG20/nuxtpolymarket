<script setup lang="ts">
import { RESEARCH, TIER_GATE, researchAvailable, tierOpen, type Branch, type ItemId, type ResearchNode, type Stock } from '#shared/utils/gridworks/defs'
import type { GridState } from '#shared/utils/gridworks/game'
import { fmt } from '~/utils/gridworks/engine'

const props = defineProps<{ state: GridState | null, stock: Stock }>()
const emit = defineEmits<{ research: [id: string] }>()
const open = defineModel<boolean>('open', { default: false })

const BRANCHES: { id: Branch, label: string, color: string }[] = [
    { id: 'production', label: 'Production', color: 'text-sky-300' },
    { id: 'logistics', label: 'Logistics', color: 'text-amber-300' },
    { id: 'idle', label: 'Idle', color: 'text-emerald-300' }
]
const tiers = [1, 2, 3, 4, 5]
const done = computed(() => props.state?.done ?? [])

function status(n: ResearchNode): 'done' | 'active' | 'open' | 'locked' {
    if (done.value.includes(n.id)) return 'done'
    if (props.state?.queue.includes(n.id)) return 'active'
    return researchAvailable(n.id, done.value) ? 'open' : 'locked'
}

function pct(n: ResearchNode) {
    const got = props.state?.progress[n.id] ?? {}
    const parts = Object.entries(n.cost) as [ItemId, number][]
    if (!parts.length) return 0
    return parts.reduce((a, [k, v]) => a + Math.min(1, (got[k] ?? 0) / v), 0) / parts.length
}

function gateText(tier: number) {
    const need = TIER_GATE[tier] ?? 0
    const have = RESEARCH.filter(n => n.tier === tier - 1 && done.value.includes(n.id)).length
    return `${Math.min(have, need)}/${need} of tier ${tier - 1}`
}

const itemUrl = (id: string) => `/gridworks/sprites/items/${id}.svg`
</script>

<template>
  <UModal v-model:open="open" title="Research" description="Pick one, then belt its items into a lab. Progress is kept when you switch." :ui="{ content: 'max-w-5xl' }">
    <template #body>
      <div class="overflow-x-auto">
        <div class="grid min-w-[860px] grid-cols-[96px_repeat(5,1fr)] gap-2">
          <div />
          <div v-for="t in tiers" :key="t" class="pb-1 text-center">
            <div class="text-xs font-semibold uppercase tracking-wider text-muted">
              Tier {{ t }}
            </div>
            <div v-if="t > 1 && !tierOpen(t, done)" class="text-[11px] text-dimmed">
              <UIcon name="i-lucide-lock" class="size-3 align-[-2px]" /> {{ gateText(t) }}
            </div>
          </div>
          <template v-for="b in BRANCHES" :key="b.id">
            <div class="pt-2 text-xs font-semibold uppercase tracking-wider" :class="b.color">
              {{ b.label }}
            </div>
            <div v-for="t in tiers" :key="t" class="flex flex-col gap-1.5">
              <button
                v-for="n in RESEARCH.filter(r => r.branch === b.id && r.tier === t)"
                :key="n.id"
                class="relative overflow-hidden rounded-lg border p-2 text-left transition active:scale-[0.97]"
                :class="{
                  'border-emerald-500/40 bg-emerald-500/10': status(n) === 'done',
                  'border-violet-400 bg-violet-500/15 ring-2 ring-violet-400/30': status(n) === 'active',
                  'border-default bg-elevated hover:border-accented hover:bg-accented/40': status(n) === 'open',
                  'cursor-not-allowed border-default opacity-40': status(n) === 'locked'
                }"
                :disabled="status(n) !== 'open'"
                @click="emit('research', n.id)"
              >
                <div class="flex items-center gap-1 text-xs font-semibold">
                  <UIcon v-if="status(n) === 'done'" name="i-lucide-check" class="size-3.5 text-emerald-400" />
                  <UIcon v-else-if="status(n) === 'active'" name="i-lucide-flask-conical" class="size-3.5 text-violet-300" />
                  {{ n.name }}
                </div>
                <div class="mt-0.5 text-[11px] leading-tight text-muted">
                  {{ n.desc }}
                </div>
                <div v-if="status(n) !== 'done'" class="mt-1 flex flex-wrap gap-x-2 text-[11px]">
                  <span v-for="[k, v] in Object.entries(n.cost)" :key="k" class="flex items-center gap-0.5">
                    <img :src="itemUrl(k)" class="size-3.5" alt="">{{ fmt(v) }}
                  </span>
                </div>
                <div v-if="status(n) !== 'done' && pct(n) > 0" class="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
                  <div class="h-full bg-violet-400" :style="{ width: `${pct(n) * 100}%` }" />
                </div>
              </button>
            </div>
          </template>
        </div>
      </div>
    </template>
  </UModal>
</template>
