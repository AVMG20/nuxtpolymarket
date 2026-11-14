<script setup lang="ts">
import { RESEARCH, TIER_GATE, researchAvailable, tierOpen, type Branch, type ItemId, type ResearchNode, type Stock } from '#shared/utils/gridworks/defs'
import type { GridState } from '#shared/utils/gridworks/game'
import { fmt } from '~/utils/gridworks/engine'

const props = defineProps<{ state: GridState | null, stock: Stock }>()
const emit = defineEmits<{ research: [id: string] }>()
const open = defineModel<boolean>('open', { default: false })

const BRANCHES: { id: Branch, label: string, icon: string, text: string, rgb: string }[] = [
    { id: 'production', label: 'Production', icon: 'i-lucide-factory', text: 'text-sky-300', rgb: '56 189 248' },
    { id: 'logistics', label: 'Logistics', icon: 'i-lucide-route', text: 'text-amber-300', rgb: '252 211 77' },
    { id: 'idle', label: 'Idle', icon: 'i-lucide-moon-star', text: 'text-emerald-300', rgb: '110 231 183' }
]
const tiers = [1, 2, 3, 4, 5]
const done = computed(() => props.state?.done ?? [])
const doneCount = computed(() => done.value.length)

type Status = 'done' | 'active' | 'open' | 'locked'
function status(n: ResearchNode): Status {
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

function gate(tier: number) {
    const need = TIER_GATE[tier] ?? 0
    const have = RESEARCH.filter(n => n.tier === tier - 1 && done.value.includes(n.id)).length
    return { need, have: Math.min(have, need), open: tierOpen(tier, done.value) }
}

const nodes = (b: Branch, t: number) => RESEARCH.filter(r => r.branch === b && r.tier === t)
const iconUrl = (id: string) => `/gridworks/sprites/research/${id}.svg`
const itemUrl = (id: string) => `/gridworks/sprites/items/${id}.svg`
// Progress ring around the active badge (r = 30 in a 64 box).
const RING = 2 * Math.PI * 30
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'max-w-6xl bg-[#0d0f13] ring-1 ring-white/10 text-white', header: 'border-white/10', body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <div class="flex w-full items-center gap-3">
        <div class="grid size-9 place-items-center rounded-xl bg-violet-500/20 ring-1 ring-violet-400/40">
          <UIcon name="i-lucide-flask-conical" class="size-5 text-violet-200" />
        </div>
        <div class="min-w-0">
          <div class="font-semibold">
            Research
          </div>
          <div class="text-xs text-white/50">
            Pick one, then belt its items into a lab. Progress is kept when you switch.
          </div>
        </div>
        <div class="ml-auto flex items-center gap-3">
          <div class="text-right text-xs text-white/50">
            <span class="text-base font-semibold tabular-nums text-white">{{ doneCount }}</span>/{{ RESEARCH.length }} done
          </div>
          <button class="grid size-8 place-items-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white" @click="open = false">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </div>
      </div>
    </template>

    <template #body>
      <div class="gw-tree overflow-x-auto p-4">
        <div class="grid min-w-[980px] grid-cols-[110px_repeat(5,1fr)] gap-x-3 gap-y-3">
          <!-- Tier headers with the gate to open each one -->
          <div />
          <div v-for="t in tiers" :key="t" class="flex flex-col items-center gap-1 pb-1">
            <div class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em]" :class="gate(t).open ? 'text-white/80' : 'text-white/30'">
              <UIcon v-if="!gate(t).open" name="i-lucide-lock" class="size-3" />
              Tier {{ t }}
            </div>
            <div v-if="t > 1 && !gate(t).open" class="flex items-center gap-1" :title="`Finish ${gate(t).need} tier ${t - 1} researches`">
              <span
                v-for="i in gate(t).need"
                :key="i"
                class="size-1.5 rounded-full"
                :class="i <= gate(t).have ? 'bg-violet-300' : 'bg-white/15'"
              />
              <span class="ml-1 text-[10px] tabular-nums text-white/40">{{ gate(t).have }}/{{ gate(t).need }}</span>
            </div>
            <div v-else class="h-1 w-10 rounded-full" :class="t === 1 || gate(t).open ? 'bg-violet-400/40' : ''" />
          </div>

          <template v-for="b in BRANCHES" :key="b.id">
            <div class="gw-lane-label flex flex-col justify-center gap-1 rounded-xl px-3" :style="{ '--c': b.rgb }">
              <UIcon :name="b.icon" class="size-5" :class="b.text" />
              <div class="text-xs font-bold uppercase tracking-wider" :class="b.text">
                {{ b.label }}
              </div>
            </div>
            <div v-for="t in tiers" :key="t" class="gw-lane flex flex-col gap-2 rounded-xl p-1.5" :style="{ '--c': b.rgb }">
              <button
                v-for="n in nodes(b.id, t)"
                :key="n.id"
                class="gw-node group relative flex items-start gap-2.5 rounded-xl border p-2 text-left"
                :class="`gw-${status(n)}`"
                :style="{ '--c': b.rgb }"
                :disabled="status(n) !== 'open'"
                @click="emit('research', n.id)"
              >
                <div class="relative size-12 shrink-0">
                  <div class="gw-badge absolute inset-0 grid place-items-center rounded-xl">
                    <img :src="iconUrl(n.id)" class="size-10 transition-transform duration-200 group-hover:scale-110" alt="">
                  </div>
                  <svg v-if="status(n) === 'active'" viewBox="0 0 64 64" class="pointer-events-none absolute -inset-1.5 size-[3.75rem] -rotate-90">
                    <circle cx="32" cy="32" r="30" fill="none" stroke="rgb(255 255 255 / 0.1)" stroke-width="3" />
                    <circle
                      cx="32" cy="32" r="30" fill="none" stroke="rgb(196 181 253)" stroke-width="3" stroke-linecap="round"
                      :stroke-dasharray="RING" :stroke-dashoffset="RING * (1 - pct(n))" class="transition-[stroke-dashoffset] duration-700"
                    />
                  </svg>
                  <div v-if="status(n) === 'done'" class="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-emerald-400 text-emerald-950 shadow">
                    <UIcon name="i-lucide-check" class="size-3.5" />
                  </div>
                  <div v-else-if="status(n) === 'locked'" class="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-[#2a2f38] text-white/70 shadow ring-1 ring-white/10">
                    <UIcon name="i-lucide-lock" class="size-3" />
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1 text-[13px] font-semibold leading-tight">
                    {{ n.name }}
                    <span v-if="status(n) === 'active'" class="ml-auto rounded bg-violet-400/20 px-1 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                      {{ Math.floor(pct(n) * 100) }}%
                    </span>
                  </div>
                  <div class="mt-0.5 text-[11px] leading-tight text-white/55">
                    {{ n.desc }}
                  </div>
                  <div v-if="status(n) !== 'done'" class="mt-1.5 flex flex-wrap gap-1">
                    <span
                      v-for="[k, v] in Object.entries(n.cost)"
                      :key="k"
                      class="flex items-center gap-0.5 rounded-md bg-black/30 px-1 py-px text-[11px] tabular-nums"
                    >
                      <img :src="itemUrl(k)" class="size-3.5" alt="">{{ fmt(v) }}
                    </span>
                  </div>
                </div>
              </button>
            </div>
          </template>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.gw-tree {
  background-color: #0d0f13;
  background-image: radial-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px);
  background-size: 18px 18px;
}
.gw-lane-label {
  background: linear-gradient(90deg, rgb(var(--c) / 0.14), rgb(var(--c) / 0.02));
  border: 1px solid rgb(var(--c) / 0.18);
}
.gw-lane { background: rgb(var(--c) / 0.03); }
.gw-node {
  transition: transform 160ms cubic-bezier(.3, 1.5, .5, 1), border-color 140ms, background 140ms, box-shadow 160ms;
}
.gw-badge {
  background: radial-gradient(circle at 35% 30%, rgb(var(--c) / 0.35), rgb(var(--c) / 0.08) 70%);
  box-shadow: inset 0 0 0 1px rgb(var(--c) / 0.35);
}
.gw-open {
  border-color: rgb(var(--c) / 0.35);
  background: linear-gradient(160deg, rgb(var(--c) / 0.12), rgb(15 17 21 / 0.9) 60%);
}
.gw-open:hover {
  transform: translateY(-2px);
  border-color: rgb(var(--c) / 0.8);
  box-shadow: 0 10px 24px -10px rgb(var(--c) / 0.6);
}
.gw-open:active { transform: scale(0.97); }
.gw-active {
  border-color: rgb(167 139 250);
  background: linear-gradient(160deg, rgb(139 92 246 / 0.28), rgb(15 17 21 / 0.9) 70%);
  animation: gw-active 2.2s ease-in-out infinite;
}
@keyframes gw-active {
  0%, 100% { box-shadow: 0 0 0 1px rgb(167 139 250 / 0.4), 0 0 18px -4px rgb(139 92 246 / 0.5); }
  50% { box-shadow: 0 0 0 1px rgb(167 139 250 / 0.7), 0 0 28px -2px rgb(139 92 246 / 0.8); }
}
.gw-done {
  border-color: rgb(52 211 153 / 0.25);
  background: rgb(16 185 129 / 0.07);
}
.gw-done .gw-badge { filter: saturate(0.7); }
.gw-locked {
  cursor: not-allowed;
  border-color: rgb(255 255 255 / 0.06);
  background: rgb(255 255 255 / 0.02);
  opacity: 0.7;
}
.gw-locked .gw-badge img { filter: grayscale(0.8) brightness(0.8); }
</style>
