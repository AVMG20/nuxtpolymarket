<script setup lang="ts">
import { useElementBounding, useElementSize, useEventListener, useMediaQuery, useResizeObserver } from '@vueuse/core'
import { PLANT_TYPES, MUTATIONS, MUTATION_OFFSPRING, getPlant, xenoMutationBoost } from '#shared/utils/xeno'
import { TIER_NAMES, roman, tierClass } from '~/lib/xeno-ui'

const route = useRoute()
const { unlockedTypeIds, inventory, upgrades } = useXeno()
const sound = useXenoSound()

// A species is discovered once it has ever been unlocked — permanent.
const discovered = computed(() => new Set(unlockedTypeIds.value))
const ownedByType = computed(() => {
  const m = new Map<string, number>()
  for (const i of inventory.value as any[]) m.set(i.typeId, (m.get(i.typeId) ?? 0) + i.quantity)
  return m
})

/** Undiscovered species whose recipe parents are both discovered. */
const withinReach = computed(() => {
  const d = discovered.value
  return new Set(PLANT_TYPES
    .filter(p => !d.has(p.id) && MUTATIONS.some(m => m.offspring === p.id && d.has(m.parent1) && d.has(m.parent2)))
    .map(p => p.id))
})

type Status = 'known' | 'reach' | 'unknown'
function status(id: string): Status {
  return discovered.value.has(id) ? 'known' : withinReach.value.has(id) ? 'reach' : 'unknown'
}

// ── Filters ──────────────────────────────────────────────────────────────────
type Filter = 'all' | 'known' | 'reach' | 'unknown'
const filter = ref<Filter>('all')
const search = ref('')
const filters = computed(() => [
  { id: 'all' as const, label: 'All', n: PLANT_TYPES.length },
  { id: 'known' as const, label: 'Discovered', n: discoveredCount.value },
  { id: 'reach' as const, label: 'Within reach', n: withinReach.value.size },
  { id: 'unknown' as const, label: 'Unknown', n: PLANT_TYPES.length - discoveredCount.value - withinReach.value.size }
])
function setFilter(f: Filter) {
  if (filter.value === f) return
  filter.value = f
  sound.play('select')
}
function matches(p: { id: string, name: string }) {
  const q = search.value.trim().toLowerCase()
  if (q && !p.name.toLowerCase().includes(q)) return false
  return filter.value === 'all' || status(p.id) === filter.value
}

const allTiers = [...new Set(PLANT_TYPES.map(p => p.tier))].sort((a, b) => a - b)
const tierBars = computed(() => allTiers.map((t) => {
  const all = PLANT_TYPES.filter(p => p.tier === t)
  const have = all.filter(p => discovered.value.has(p.id)).length
  return { tier: t, have, total: all.length }
}))
const tiers = computed(() => allTiers
  .map(t => ({ tier: t, plants: PLANT_TYPES.filter(p => p.tier === t && matches(p)), bar: tierBars.value.find(b => b.tier === t)! }))
  .filter(t => t.plants.length))

const discoveredCount = computed(() => PLANT_TYPES.filter(p => discovered.value.has(p.id)).length)

// ── Entry ────────────────────────────────────────────────────────────────────
const fromQuery = String(route.query.species ?? '')
const isWide = useMediaQuery('(min-width: 1280px)')
// Until the player picks a species (or links to one), the entry shows the first
// species within reach, which follows the state once it has loaded.
const pickedId = ref<string | null>(getPlant(fromQuery) ? fromQuery : null)
const selectedId = computed(() => pickedId.value ?? PLANT_TYPES.find(p => withinReach.value.has(p.id))?.id ?? PLANT_TYPES[0]!.id)
const entryOpen = ref(false)
// Below xl the entry lives in a sheet, so a ?species= link opens it.
onMounted(() => {
  if (pickedId.value && !window.matchMedia('(min-width: 1280px)').matches) entryOpen.value = true
})
/** A tile reads as selected only where its entry is visible. */
const showSelected = (id: string) => selectedId.value === id && (isWide.value || entryOpen.value)
function pick(id: string) {
  pickedId.value = id
  sound.play('select')
  if (!window.matchMedia('(min-width: 1280px)').matches) entryOpen.value = true
}
const entry = computed(() => getPlant(selectedId.value)!)
const entryStatus = computed(() => status(entry.value.id))
const mutationBoost = computed(() => xenoMutationBoost(upgrades.value.mutation))
const bredFrom = computed(() => MUTATIONS.filter(m => m.offspring === entry.value.id))
const breedsInto = computed(() => MUTATIONS
  .filter(m => m.parent1 === entry.value.id || m.parent2 === entry.value.id)
  .map(m => ({ ...m, other: m.parent1 === entry.value.id ? m.parent2 : m.parent1 })))
// Bottom fade on the entry while there is more of it below the fold.
const entryEl = ref<HTMLElement | null>(null)
const entryFade = ref(false)
function measureEntry() {
  const el = entryEl.value
  entryFade.value = !!el && el.scrollHeight - el.scrollTop - el.clientHeight > 4
}
watch(selectedId, () => nextTick(measureEntry))
useResizeObserver(entryEl, measureEntry)

// The entry follows the scroll on desktop. The site layout scrolls the document
// past an overflow container, so `position: sticky` never engages: shift the
// entry down by hand, keeping it inside the list's row.
const rowEl = ref<HTMLElement | null>(null)
const asideEl = ref<HTMLElement | null>(null)
const row = useElementBounding(rowEl)
const { height: asideHeight } = useElementSize(asideEl, undefined, { box: 'border-box' })
useEventListener(document, 'scroll', row.update, { capture: true, passive: true })
const entryOffset = computed(() => Math.round(Math.min(Math.max(0, 16 - row.top.value), Math.max(0, row.height.value - asideHeight.value))))

const statusLabel = computed(() => ({
  known: { text: 'Discovered', color: 'var(--xg-accent-text)' },
  reach: { text: 'Within reach', color: 'var(--xg-uv)' },
  unknown: { text: 'Unknown', color: 'var(--xg-faint)' }
})[entryStatus.value])
</script>

<template>
  <div class="mx-auto max-w-[1440px] px-4 md:px-6 pt-5 md:pt-6 flex flex-col gap-4">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="xg-label">Xenopedia</p>
        <h1 class="xg-h text-2xl md:text-3xl mt-1">
          <span class="xg-num">{{ discoveredCount }}</span>
          <span class="text-(--xg-muted) font-medium"> of {{ PLANT_TYPES.length }} species</span>
        </h1>
        <p v-if="withinReach.size" class="text-[13px] text-(--xg-muted) mt-1">
          <b class="text-(--xg-ink)">{{ withinReach.size }}</b> undiscovered species can be bred from parents you have found.
        </p>
      </div>
      <!-- Per-tier completion -->
      <div class="grid grid-cols-9 gap-1.5 w-full sm:w-auto sm:grid-cols-[repeat(9,48px)]" aria-label="Discovered per tier">
        <div v-for="b in tierBars" :key="b.tier" class="flex flex-col items-center gap-1" :title="`Tier ${roman(b.tier)}: ${b.have} of ${b.total}`">
          <span class="xg-meter !h-[5px] w-full"><span :style="{ width: b.have ? `max(6px, ${(b.have / b.total) * 100}%)` : '0', background: `var(--xg-t${b.tier})` }" /></span>
          <span class="xg-tier !text-[11px]" :class="tierClass(b.tier)">{{ roman(b.tier) }}</span>
          <span class="xg-num text-[11.5px] font-bold text-(--xg-muted)">{{ b.have }}/{{ b.total }}</span>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <UInput v-model="search" placeholder="Search species" icon="i-lucide-search" size="lg" class="flex-[0_1_300px] min-w-0" :ui="{ base: 'rounded-full' }" aria-label="Search species" />
      <button
        v-for="f in filters"
        :key="f.id"
        type="button"
        class="xg-filter"
        :class="filter === f.id ? 'on' : ''"
        :aria-pressed="filter === f.id"
        @click="setFilter(f.id)"
      >
        {{ f.label }} <span class="xg-faint xg-num">{{ f.n }}</span>
      </button>
    </div>

    <div ref="rowEl" class="flex gap-6 items-start">
      <section class="flex-1 min-w-0 flex flex-col gap-5">
        <p v-if="!tiers.length" class="xg-well text-center text-sm text-(--xg-muted) py-12">No species match.</p>
        <div v-for="t in tiers" :key="t.tier">
          <div class="flex items-baseline gap-2.5 mb-2">
            <span class="xg-tier !text-sm !text-(--xg-ink)" :class="tierClass(t.tier)">Tier {{ roman(t.tier) }}</span>
            <span class="text-xs text-(--xg-muted)">{{ TIER_NAMES[t.tier] }}</span>
            <span class="xg-num text-xs text-(--xg-faint)">{{ t.bar.have }} of {{ t.bar.total }}</span>
          </div>
          <div class="grid gap-2 grid-cols-[repeat(auto-fill,minmax(100px,1fr))]">
            <button
              v-for="p in t.plants"
              :key="p.id"
              type="button"
              class="relative flex flex-col items-center gap-1 px-1.5 pt-2.5 pb-2 rounded-[18px_18px_18px_5px] border text-center transition-colors"
              :class="[
                showSelected(p.id) ? '!border-solid !border-(--xg-accent) shadow-[inset_0_0_0_1px_var(--xg-accent)]' : '',
                status(p.id) === 'known' ? 'bg-(--xg-surface2) border-(--xg-edge) hover:border-(--xg-edge2)'
                : status(p.id) === 'reach' ? 'bg-(--xg-surface2) border-dashed border-(--xg-uv-edge) hover:border-(--xg-uv)'
                  : 'bg-transparent border-dashed border-(--xg-edge2) text-(--xg-faint)'
              ]"
              :aria-pressed="showSelected(p.id)"
              :aria-label="status(p.id) === 'unknown' ? `Unknown tier ${p.tier} species` : `${p.name}, ${status(p.id) === 'known' ? 'discovered' : 'within reach'}`"
              @click="pick(p.id)"
            >
              <span class="size-16 flex items-center justify-center">
                <span v-if="status(p.id) === 'unknown'" class="size-11 rounded-[14px_14px_14px_4px] border-[1.5px] border-dashed border-(--xg-edge2) flex items-center justify-center font-bold text-lg text-(--xg-faint)">?</span>
                <XenoPlantIcon v-else :id="p.id" :size="64" stage="ready" :silhouette="status(p.id) === 'reach'" />
              </span>
              <b class="text-xs leading-tight line-clamp-2">{{ status(p.id) === 'unknown' ? '???' : p.name }}</b>
              <span class="text-[11.5px] font-bold" :class="status(p.id) === 'known' ? 'text-(--xg-muted)' : status(p.id) === 'reach' ? 'text-(--xg-uv)' : 'text-(--xg-faint)'">
                <template v-if="status(p.id) === 'known'">{{ p.voidPlant ? 'Void' : MUTATION_OFFSPRING.has(p.id) ? 'Mutation' : p.isStarter ? 'Starter' : 'Found' }}<template v-if="ownedByType.get(p.id)"> · ×{{ formatNumber(ownedByType.get(p.id)!) }}</template></template>
                <template v-else-if="status(p.id) === 'reach'">Within reach</template>
                <template v-else>Unknown</template>
              </span>
            </button>
          </div>
        </div>
      </section>

      <!-- Entry (xl+) -->
      <!-- Sized to its content; only a very long entry scrolls, with a fade at the cut. -->
      <aside ref="asideEl" class="hidden xl:flex xg-pane xg-pane-r flex-col w-[420px] 2xl:w-[460px] shrink-0 max-h-[calc(100svh-2rem)] overflow-hidden will-change-transform" :style="{ transform: `translateY(${entryOffset}px)` }" aria-label="Species entry">
        <div
          ref="entryEl"
          class="flex flex-col gap-3.5 p-5 min-h-0 overflow-y-auto"
          :style="entryFade ? { maskImage: 'linear-gradient(to bottom, #000 calc(100% - 48px), transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 48px), transparent)' } : undefined"
          @scroll.passive="measureEntry"
        >
          <XenoEncyclopediaEntry
            :plant="entry"
            :status="entryStatus"
            :status-label="statusLabel"
            :owned="ownedByType.get(entry.id) ?? 0"
            :bred-from="bredFrom"
            :breeds-into="breedsInto"
            :discovered="discovered"
            :mutation-boost="mutationBoost"
            @pick="pick"
          />
        </div>
      </aside>
    </div>
  </div>

  <USlideover
    v-model:open="entryOpen"
    title="Xenopedia"
    side="right"
    :ui="{ content: 'xeno max-w-md bg-(--xg-surface)', header: 'border-(--xg-edge)', body: 'flex flex-col gap-3.5' }"
  >
    <template #body>
      <XenoEncyclopediaEntry
        :plant="entry"
        :status="entryStatus"
        :status-label="statusLabel"
        :owned="ownedByType.get(entry.id) ?? 0"
        :bred-from="bredFrom"
        :breeds-into="breedsInto"
        :discovered="discovered"
        :mutation-boost="mutationBoost"
        @pick="pick"
      />
    </template>
  </USlideover>
</template>
