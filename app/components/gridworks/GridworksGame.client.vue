<script setup lang="ts">
import { BUILDINGS, ITEMS, ITEM_IDS, RECIPES, RESEARCH_BY_ID, isUnlocked, maxMk, upgradeCost, type Category, type ItemId, type Kind, type Stock } from '#shared/utils/gridworks/defs'
import { canAfford } from '#shared/utils/gridworks/game'
import { currentGoal, goalFocus, goalMet, type GoalFocus } from '#shared/utils/gridworks/goals'
import GridworksGuide from './GridworksGuide.vue'
import GridworksResearch from './GridworksResearch.vue'
import { GridEngine, fmt, type HoverInfo, type Selected, type Tool } from '~/utils/gridworks/engine'

const host = ref<HTMLElement | null>(null)
const game = useGridworks()
const { view, stock, cap, sol, progress, loading } = game

let engine: GridEngine | null = null
const eng = shallowRef<GridEngine | null>(null)
const tool = ref<Tool>({ mode: 'select' })
const rotation = ref(0)
const layer = ref(0)
const hover = ref<HoverInfo | null>(null)
const selected = ref<Selected | null>(null)
const muted = ref(false)
const researchOpen = ref(false)
const banner = ref<{ id: string, key: number } | null>(null)
const showHelp = ref(false)

// Cog's goals: the next one to claim, what it points at, and which button glows.
const goal = computed(() => view.value ? currentGoal(view.value) : null)
const goalDone = computed(() => !!goal.value && !!view.value && goalMet(goal.value, view.value, sol.value))
const focus = computed<GoalFocus>(() => !goal.value || !view.value || goalDone.value ? null : goalFocus(goal.value, view.value))
const focusKind = computed(() => focus.value?.startsWith('build:') ? focus.value.slice(6) as Kind : null)
// The marker scans the plot's ore, so it is only worked out again when the goal
// or the layout changes, not on every mined rock or research pick.
let markerMemo: { key: string, marker: { x: number, y: number, w: number, h: number } | null } = { key: '', marker: null }
const guideMarker = computed(() => {
    const g = goal.value
    const v = view.value
    if (!g || !v || goalDone.value) return null
    const key = `${g.id}|${v.seed}|${v.layout}|${v.entities.length}|${v.chunks.length}`
    if (key !== markerMemo.key) markerMemo = { key, marker: g.marker?.(v) ?? null }
    return markerMemo.marker
})
watch([guideMarker, eng], ([m]) => eng.value?.setGuide(m))
// Game shortcuts stay off while the research tree covers the plot.
watch([researchOpen, eng], ([open]) => eng.value?.setInputLocked(open))

function claimGoal(id: string) {
    engine?.sfx.unlock()
    const [err] = game.commit([{ op: 'goal', id }])
    if (err) engine?.sfx.invalid()
    else engine?.sfx.goal()
}

const CATEGORIES: { id: Category, label: string, icon: string }[] = [
    { id: 'logistics', label: 'Logistics', icon: 'i-lucide-route' },
    { id: 'production', label: 'Production', icon: 'i-lucide-factory' },
    { id: 'storage', label: 'Storage', icon: 'i-lucide-package' },
    { id: 'power', label: 'Boost', icon: 'i-lucide-zap' }
]
const category = ref<Category>('production')

const done = computed(() => view.value?.done ?? [])
const kindsIn = (c: Category) => (Object.keys(BUILDINGS) as Kind[]).filter(k => BUILDINGS[k].category === c && isUnlocked(k, done.value))
const bar = computed(() => kindsIn(category.value))
const categories = computed(() => CATEGORIES.filter(c => kindsIn(c.id).length))

const items = computed(() => {
    const rates = sol.value?.store ?? {}
    return ITEM_IDS
        .filter(id => (stock.value[id] ?? 0) >= 1 || (rates[id] ?? 0) > 0)
        .map(id => ({ id, amount: stock.value[id] ?? 0, rate: (rates[id] ?? 0) * 60, full: (stock.value[id] ?? 0) >= cap.value - 0.5 }))
})

const active = computed(() => {
    const id = view.value?.queue[0]
    const node = id ? RESEARCH_BY_ID[id] : null
    if (!node) return null
    const lab = sol.value?.lab ?? {}
    return {
        node,
        parts: (Object.entries(node.cost) as [ItemId, number][]).map(([k, total]) => ({
            id: k, total, got: Math.min(total, progress.value[k] ?? 0), rate: (lab[k] ?? 0) * 60
        }))
    }
})

function spriteUrl(k: Kind) {
    const s = BUILDINGS[k].sprite
    return s ? `/gridworks/sprites/${s}` : ''
}
const itemUrl = (id: ItemId) => `/gridworks/sprites/items/${id}.svg`

function affordable(cost: Stock) {
    return canAfford(stock.value, cost)
}

function pick(k: Kind) {
    if (!engine) return
    if (tool.value.mode === 'build' && tool.value.kind === k) engine.setTool({ mode: 'select' })
    else engine.setTool({ mode: 'build', kind: k })
}

function setMode(mode: 'select' | 'remove') {
    engine?.setTool({ mode })
}

function onKey(ev: KeyboardEvent) {
    const t = ev.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return
    // With the research tree open, only T (which closes it) still counts.
    if (researchOpen.value && ev.key.toLowerCase() !== 't') return
    if (/^[1-9]$/.test(ev.key)) {
        const k = bar.value[Number(ev.key) - 1]
        if (k) pick(k)
        return
    }
    if (ev.key === 'Tab') {
        ev.preventDefault()
        const list = categories.value
        const i = list.findIndex(c => c.id === category.value)
        category.value = list[(i + (ev.shiftKey ? list.length - 1 : 1)) % list.length]!.id
        engine?.sfx.tool()
        return
    }
    if (ev.key.toLowerCase() === 't') researchOpen.value = !researchOpen.value
}

function toggleMute() {
    muted.value = !muted.value
    engine?.sfx.setMuted(muted.value)
}

function research(id: string) {
    engine?.sfx.unlock()
    const [err] = game.commit([{ op: 'research', id }])
    if (err) engine?.sfx.invalid()
    else engine?.sfx.select()
}

// Selection panel helpers.
const selDef = computed(() => selected.value ? BUILDINGS[selected.value.e.k] : null)
const selRecipe = computed(() => {
    const s = selected.value
    if (!s || !selDef.value?.recipes) return null
    return s.e.recipe ?? selDef.value.recipes[0]!
})
const selUpgrade = computed(() => {
    const s = selected.value
    if (!s) return null
    const mk = s.e.mk ?? 1
    const max = maxMk(s.e.k, done.value)
    if (BUILDINGS[s.e.k].role !== 'belt' && BUILDINGS[s.e.k].role !== 'machine' && BUILDINGS[s.e.k].role !== 'source') return null
    return { mk, max, cost: mk < max ? upgradeCost(s.e.k, mk + 1) : null }
})
const recipeLocked = (r: string) => RECIPES[r]?.out === 'chip' && !done.value.includes('electronics')

function costEntries(c: Stock) {
    return Object.entries(c) as [ItemId, number][]
}

let unmounted = false
let bannerTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
    if (!host.value) return
    const created = new GridEngine(host.value, {
        commit: ops => game.commit(ops),
        stock: () => game.currentStock(),
        onSelect: s => { selected.value = s },
        onHover: h => { hover.value = h },
        onTool: (t, r) => {
            tool.value = t
            rotation.value = r
            if (t.mode === 'build') category.value = BUILDINGS[t.kind].category
        },
        onLayer: l => { layer.value = l }
    })
    engine = created
    muted.value = engine.sfx.muted
    game.onView((v, animate) => engine?.setState(v, { animate }))
    game.onSolution((s, ents) => engine?.setSolution(s, ents))
    game.onWorld(plots => engine?.setWorld(plots, game.me.value))
    game.onResearch((id) => {
        engine?.sfx.research()
        banner.value = { id, key: Date.now() }
        if (bannerTimer) clearTimeout(bannerTimer)
        bannerTimer = setTimeout(() => { banner.value = null }, 3200)
    })
    // The page may be left while the sprites or the plot load: stop at each step.
    await created.init()
    if (unmounted) return
    eng.value = created
    await game.start()
    if (unmounted) return
    if (game.world.value.length) created.setWorld(game.world.value, game.me.value)
    if (view.value) created.setState(view.value, { animate: false })
    if (sol.value) created.setSolution(sol.value, game.solEntities())
    window.addEventListener('keydown', onKey)
    showHelp.value = localStorage.getItem('gridworks:help') === '1'
})

onBeforeUnmount(() => {
    unmounted = true
    if (bannerTimer) clearTimeout(bannerTimer)
    window.removeEventListener('keydown', onKey)
    game.stop()
    engine?.destroy()
    engine = null
    eng.value = null
})

function toggleHelp() {
    showHelp.value = !showHelp.value
    localStorage.setItem('gridworks:help', showHelp.value ? '1' : '0')
}
</script>

<template>
  <div class="gw-root relative h-full min-h-[560px] w-full select-none overflow-hidden bg-[#15181d] text-sm text-white">
    <div ref="host" class="absolute inset-0" />

    <div v-if="loading" class="absolute inset-0 grid place-items-center bg-[#15181d]">
      <div class="flex items-center gap-3 text-white/70">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
        Loading your factory…
      </div>
    </div>

    <!-- Research: top left -->
    <div class="pointer-events-none absolute left-3 top-3 flex w-72 flex-col gap-2">
      <div class="pointer-events-auto rounded-xl border border-white/10 bg-[#0f1115]/85 p-3 shadow-xl backdrop-blur">
        <div class="mb-2 flex items-center justify-between">
          <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/50">
            <UIcon name="i-lucide-flask-conical" class="size-4" /> Research
          </div>
          <button class="rounded-md bg-white/10 px-2 py-1 text-xs font-medium transition hover:bg-white/20 active:scale-95" :class="{ 'gw-guide': focus === 'research' }" @click="researchOpen = true">
            Tree <UKbd class="ml-1" value="T" size="sm" />
          </button>
        </div>
        <template v-if="active">
          <div class="mb-1.5 font-semibold">
            {{ active.node.name }}
          </div>
          <div v-for="p in active.parts" :key="p.id" class="mb-1 flex items-center gap-2">
            <img :src="itemUrl(p.id)" class="size-5" alt="">
            <div class="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10">
              <div class="absolute inset-y-0 left-0 rounded-full bg-violet-400 transition-[width] duration-300" :style="{ width: `${(p.got / p.total) * 100}%` }" />
            </div>
            <span class="w-20 text-right font-mono text-xs tabular-nums text-white/70">{{ fmt(p.got) }}/{{ fmt(p.total) }}</span>
          </div>
          <div v-if="active.parts.every(p => p.rate <= 0)" class="mt-1 text-xs text-amber-300/90">
            Belt these items into a lab to research.
          </div>
        </template>
        <div v-else class="text-xs text-white/60">
          Pick a research, then belt its items into a lab.
        </div>
      </div>
    </div>

    <!-- Resources: top right -->
    <div class="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2">
      <div class="pointer-events-auto w-60 rounded-xl border border-white/10 bg-[#0f1115]/85 p-3 shadow-xl backdrop-blur">
        <div class="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-white/50">
          <span class="flex items-center gap-2"><UIcon name="i-lucide-package" class="size-4" /> Storage</span>
          <span class="font-mono normal-case tracking-normal text-white/40">max {{ fmt(cap) }} each</span>
        </div>
        <TransitionGroup name="gw-row" tag="div" class="gw-storage flex flex-col gap-1 overflow-y-auto overflow-x-hidden" :class="{ 'gw-storage-short': selected }">
          <div v-for="it in items" :key="it.id" class="flex items-center gap-2" :title="ITEMS[it.id].name">
            <img :src="itemUrl(it.id)" class="size-5" alt="">
            <div class="flex-1">
              <div class="flex items-baseline justify-between">
                <span class="font-mono font-semibold tabular-nums" :class="it.full ? 'text-amber-300' : ''">{{ fmt(it.amount) }}</span>
                <span v-if="it.rate > 0" class="font-mono text-xs tabular-nums text-emerald-400">+{{ fmt(it.rate) }}/m</span>
              </div>
              <div class="h-0.5 overflow-hidden rounded-full bg-white/5">
                <div class="h-full rounded-full transition-[width] duration-300" :class="it.full ? 'bg-amber-300' : 'bg-white/25'" :style="{ width: `${Math.min(100, (it.amount / Math.max(1, cap)) * 100)}%` }" />
              </div>
            </div>
          </div>
        </TransitionGroup>
        <div v-if="!items.length" class="text-xs text-white/50">
          Empty
        </div>
      </div>
      <div class="pointer-events-auto flex gap-1.5">
        <button class="grid size-8 place-items-center rounded-lg border border-white/10 bg-[#0f1115]/85 transition hover:bg-white/10 active:scale-90" title="Back to my plot (H)" @click="eng?.focusPlot()">
          <UIcon name="i-lucide-house" class="size-4" />
        </button>
        <button class="grid size-8 place-items-center rounded-lg border border-white/10 bg-[#0f1115]/85 transition hover:bg-white/10 active:scale-90" :title="muted ? 'Sound off' : 'Sound on'" @click="toggleMute">
          <UIcon :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" class="size-4" />
        </button>
      </div>
    </div>

    <!-- Selected building -->
    <Transition name="gw-pop">
      <div v-if="selected && selDef" class="absolute bottom-32 right-3 w-64 rounded-xl border border-white/10 bg-[#0f1115]/90 p-3 shadow-2xl backdrop-blur">
        <div class="mb-2 flex items-center gap-2">
          <img v-if="spriteUrl(selected.e.k)" :src="spriteUrl(selected.e.k)" class="size-9 object-contain" alt="">
          <div class="flex-1">
            <div class="font-semibold">
              {{ selDef.name }} <span v-if="(selected.e.mk ?? 1) > 1" class="text-amber-300">Mk{{ selected.e.mk }}</span>
            </div>
            <div class="text-xs text-white/50">
              <template v-if="selDef.role === 'machine' || selDef.role === 'source'">
                {{ Math.round(selected.busy * 100) }}% busy
              </template>
              <template v-else-if="selected.flow > 0">
                {{ fmt(selected.flow * 60) }} items/min
              </template>
              <template v-else>
                Idle
              </template>
            </div>
          </div>
        </div>
        <div v-if="selDef.recipes && selDef.recipes.length > 1" class="mb-2">
          <div class="mb-1 text-xs text-white/50">
            Recipe
          </div>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="r in selDef.recipes"
              :key="r"
              :disabled="recipeLocked(r)"
              class="flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition active:scale-95 disabled:opacity-40"
              :class="selRecipe === r ? 'border-sky-400 bg-sky-400/20' : 'border-white/10 hover:bg-white/10'"
              @click="eng?.act('recipe', r)"
            >
              <img :src="itemUrl(RECIPES[r]!.out)" class="size-4" alt=""> {{ ITEMS[RECIPES[r]!.out].name }}
            </button>
          </div>
        </div>
        <div v-if="selRecipe" class="mb-2 flex items-center gap-1 text-xs text-white/60">
          <template v-for="([k, v], i) in costEntries(RECIPES[selRecipe]!.inputs)" :key="k">
            <span v-if="i" class="text-white/30">+</span>
            <img :src="itemUrl(k)" class="size-4" alt="">{{ v }}
          </template>
          <UIcon name="i-lucide-arrow-right" class="mx-0.5 size-3.5 text-white/40" />
          <img :src="itemUrl(RECIPES[selRecipe]!.out)" class="size-4" alt="">{{ RECIPES[selRecipe]!.outQty }}
          <span class="ml-auto text-white/40">{{ RECIPES[selRecipe]!.time }}s</span>
        </div>
        <div v-if="selected.e.k === 'smart-splitter'" class="mb-2">
          <div class="mb-1 text-xs text-white/50">
            Sends sideways
          </div>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="id in ITEM_IDS"
              :key="id"
              class="grid size-7 place-items-center rounded-md border transition active:scale-90"
              :class="selected.e.filter === id ? 'border-amber-300 bg-amber-300/20' : 'border-white/10 hover:bg-white/10'"
              :title="ITEMS[id].name"
              @click="eng?.act('filter', selected.e.filter === id ? null : id)"
            >
              <img :src="itemUrl(id)" class="size-5" alt="">
            </button>
          </div>
        </div>
        <div v-if="selUpgrade && selUpgrade.max > 1" class="mb-2">
          <button
            v-if="selUpgrade.cost"
            class="flex w-full items-center justify-between rounded-lg border border-amber-300/40 bg-amber-300/10 px-2 py-1.5 text-xs transition hover:bg-amber-300/20 active:scale-[0.98] disabled:opacity-40"
            :disabled="!affordable(selUpgrade.cost)"
            @click="eng?.act('upgrade')"
          >
            <span class="font-semibold text-amber-200">Upgrade to Mk{{ selUpgrade.mk + 1 }}</span>
            <span class="flex items-center gap-1">
              <template v-for="[k, v] in costEntries(selUpgrade.cost)" :key="k">
                <img :src="itemUrl(k)" class="size-4" alt="">{{ fmt(v) }}
              </template>
            </span>
          </button>
          <div v-else class="text-xs text-white/40">
            Max Mk for your research
          </div>
        </div>
        <div class="flex gap-1.5">
          <button class="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white/10 py-1.5 text-xs transition hover:bg-white/20 active:scale-95" @click="eng?.act('rotate')">
            <UIcon name="i-lucide-rotate-cw" class="size-3.5" /> Rotate <UKbd value="R" size="sm" />
          </button>
          <button class="flex flex-1 items-center justify-center gap-1 rounded-lg bg-red-500/15 py-1.5 text-xs text-red-300 transition hover:bg-red-500/25 active:scale-95" @click="eng?.act('remove')">
            <UIcon name="i-lucide-trash-2" class="size-3.5" /> Remove
          </button>
        </div>
      </div>
    </Transition>

    <!-- Build bar: bottom -->
    <div class="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-1.5">
      <div class="pointer-events-auto flex items-center gap-1 rounded-xl border border-white/10 bg-[#0f1115]/85 p-1 shadow-xl backdrop-blur">
        <button
          v-for="c in categories"
          :key="c.id"
          class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition active:scale-95"
          :class="[category === c.id ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white', focusKind && category !== c.id && BUILDINGS[focusKind].category === c.id && isUnlocked(focusKind, done) ? 'gw-guide' : '']"
          @click="category = c.id; eng?.sfx.tool()"
        >
          <UIcon :name="c.icon" class="size-3.5" /> {{ c.label }}
        </button>
        <span class="ml-1 text-[10px] text-white/30">Tab</span>
      </div>
      <div class="pointer-events-auto flex items-end gap-1.5 rounded-2xl border border-white/10 bg-[#0f1115]/90 p-2 shadow-2xl backdrop-blur">
        <button
          class="gw-slot"
          :class="tool.mode === 'select' ? 'gw-slot-on' : ''"
          title="Select and move (Esc)"
          @click="setMode('select')"
        >
          <UIcon name="i-lucide-mouse-pointer-2" class="size-6" />
          <span class="gw-key">Esc</span>
        </button>
        <button
          class="gw-slot"
          :class="tool.mode === 'remove' ? 'gw-slot-on gw-slot-red' : ''"
          title="Remove (X), or right-click anything"
          @click="setMode(tool.mode === 'remove' ? 'select' : 'remove')"
        >
          <UIcon name="i-lucide-trash-2" class="size-6" />
          <span class="gw-key">X</span>
        </button>
        <div class="mx-1 h-12 w-px self-center bg-white/10" />
        <TransitionGroup name="gw-slot" tag="div" class="flex items-end gap-1.5">
          <div v-for="(k, i) in bar" :key="k">
          <UTooltip :delay-duration="150" :content="{ side: 'top', sideOffset: 10 }" :ui="{ content: 'h-auto px-3 py-2' }">
            <button
              class="gw-slot"
              :class="[tool.mode === 'build' && tool.kind === k ? 'gw-slot-on' : '', affordable(BUILDINGS[k].cost) ? '' : 'gw-slot-poor', focusKind === k && !(tool.mode === 'build' && tool.kind === k) ? 'gw-guide' : '']"
              @click="pick(k)"
            >
              <img
                v-if="spriteUrl(k)"
                :src="spriteUrl(k)"
                class="max-h-10 max-w-10 object-contain transition-transform duration-150"
                :style="tool.mode === 'build' && tool.kind === k ? { transform: `rotate(${rotation * 90}deg)` } : {}"
                alt=""
              >
              <svg v-else viewBox="0 0 64 64" class="size-10 transition-transform duration-150" :style="tool.mode === 'build' && tool.kind === k ? { transform: `rotate(${rotation * 90}deg)` } : {}">
                <rect x="0" y="12" width="64" height="40" fill="#5d6570" />
                <rect x="0" y="12" width="64" height="5" fill="#9aa3ae" />
                <rect x="0" y="47" width="64" height="5" fill="#9aa3ae" />
                <path d="M20 25 L28 32 L20 39 M38 25 L46 32 L38 39" stroke="#d9dee5" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span class="gw-key">{{ i + 1 }}</span>
            </button>
            <template #content>
              <div class="text-xs leading-snug">
                <div class="font-semibold">
                  {{ BUILDINGS[k].name }}
                </div>
                <div class="mt-1.5 flex items-center gap-2">
                  <span v-for="[c, v] in costEntries(BUILDINGS[k].cost)" :key="c" class="flex items-center gap-1" :class="(stock[c] ?? 0) >= v ? '' : 'text-red-400'">
                    <img :src="itemUrl(c)" class="size-4" alt="">{{ fmt(v) }}
                  </span>
                </div>
              </div>
            </template>
          </UTooltip>
          </div>
        </TransitionGroup>
        <template v-if="done.includes('bridges')">
          <div class="mx-1 h-12 w-px self-center bg-white/10" />
          <button class="gw-slot" title="Belt layer (L)" @click="eng?.setLayer(layer >= (done.includes('skyway') ? 2 : 1) ? 0 : layer + 1)">
            <div class="flex flex-col-reverse gap-0.5">
              <div v-for="l in (done.includes('skyway') ? 3 : 2)" :key="l" class="h-1.5 w-7 rounded-sm transition" :class="l - 1 === layer ? 'bg-sky-400' : 'bg-white/20'" />
            </div>
            <span class="gw-key">L</span>
          </button>
        </template>
      </div>
    </div>

    <!-- Cog and controls: bottom left -->
    <div class="gw-corner pointer-events-none absolute left-3 flex flex-col items-start gap-2">
      <Transition name="gw-pop">
        <div v-if="showHelp" class="pointer-events-auto w-56 rounded-xl border border-white/10 bg-[#0f1115]/85 p-3 text-xs text-white/70 shadow-xl backdrop-blur">
          <div class="mb-1.5 flex items-center justify-between font-semibold text-white">
            Controls
            <button class="text-white/40 hover:text-white" @click="toggleHelp">
              <UIcon name="i-lucide-x" class="size-3.5" />
            </button>
          </div>
          <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <span class="text-white/40">Click ore</span><span>Mine by hand</span>
            <span class="text-white/40">Drag</span><span>Lay belts / move</span>
            <span class="text-white/40">R</span><span>Rotate</span>
            <span class="text-white/40">Right-click</span><span>Remove (drag for many)</span>
            <span class="text-white/40">Q</span><span>Copy building</span>
            <span class="text-white/40">Ctrl+Z</span><span>Undo</span>
            <span class="text-white/40">WASD / drag</span><span>Pan · wheel zooms</span>
          </div>
        </div>
      </Transition>
      <GridworksGuide v-if="view && goal" :goal="goal" :state="view" :sol="sol" :sfx="eng?.sfx" @claim="claimGoal" @help="toggleHelp" />
      <button v-else-if="view" class="pointer-events-auto grid size-9 place-items-center rounded-xl border border-white/10 bg-[#0f1115]/85 text-white/60 shadow-xl backdrop-blur transition hover:text-white" title="Controls" @click="toggleHelp">
        <UIcon name="i-lucide-keyboard" class="size-4" />
      </button>
    </div>

    <!-- Cursor tooltip -->
    <div
      v-if="hover && !researchOpen"
      class="pointer-events-none fixed z-50 max-w-60 rounded-lg border border-white/10 bg-[#0f1115]/95 px-2.5 py-1.5 text-xs shadow-xl"
      :style="{ left: `${hover.x + 18}px`, top: `${hover.y + 18}px` }"
    >
      <div class="font-semibold">
        {{ hover.title }}
      </div>
      <div v-for="l in hover.lines" :key="l" class="text-white/60">
        {{ l }}
      </div>
      <div v-if="hover.error" class="text-red-400">
        {{ hover.error }}
      </div>
    </div>

    <!-- Research done -->
    <Transition name="gw-banner">
      <div v-if="banner" :key="banner.key" class="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-2xl border border-violet-300/40 bg-violet-500/20 px-6 py-3 text-center shadow-2xl backdrop-blur">
        <div class="text-xs font-semibold uppercase tracking-widest text-violet-200">
          Research complete
        </div>
        <div class="text-lg font-bold">
          {{ RESEARCH_BY_ID[banner.id]?.name }}
        </div>
      </div>
    </Transition>

    <GridworksResearch v-model:open="researchOpen" :state="view" :stock="stock" @research="research" />
  </div>
</template>

<style scoped>
/* Sizes below follow the game's own box, not the window: the site's sidebar takes a share of it. */
.gw-root { container-type: size; }
/* Cog sits above the build bar, and drops into the corner once the widest bar leaves room beside it. */
.gw-corner { bottom: 8.25rem; }
@container (min-width: 1640px) {
  .gw-corner { bottom: 0.75rem; }
}
/* The storage list scrolls before it reaches the build bar, or the selected building's panel. */
.gw-storage { max-height: max(7rem, calc(100cqh - 17rem)); scrollbar-width: thin; }
.gw-storage-short { max-height: max(7rem, calc(100cqh - 37rem)); }
.gw-slot {
  position: relative;
  display: grid;
  place-items: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 0.75rem;
  border: 1px solid rgb(255 255 255 / 0.08);
  background: rgb(255 255 255 / 0.04);
  transition: transform 140ms cubic-bezier(.3, 1.6, .5, 1), background 120ms, border-color 120ms, box-shadow 120ms;
}
.gw-slot:hover { background: rgb(255 255 255 / 0.1); transform: translateY(-3px); }
.gw-slot:active { transform: translateY(0) scale(0.92); }
.gw-slot-on {
  background: rgb(96 165 250 / 0.2);
  border-color: rgb(96 165 250 / 0.8);
  box-shadow: 0 0 0 3px rgb(96 165 250 / 0.2), 0 8px 18px -6px rgb(96 165 250 / 0.6);
  transform: translateY(-6px);
}
.gw-slot-on:hover { transform: translateY(-7px); }
.gw-slot-red {
  background: rgb(248 113 113 / 0.18);
  border-color: rgb(248 113 113 / 0.8);
  box-shadow: 0 0 0 3px rgb(248 113 113 / 0.2);
}
.gw-slot-poor img, .gw-slot-poor svg { opacity: 0.4; filter: grayscale(0.6); }
.gw-guide { animation: gw-guide 1.3s ease-in-out infinite; }
@keyframes gw-guide {
  0%, 100% { box-shadow: 0 0 0 2px rgb(94 234 212 / 0.9), 0 0 0 4px rgb(94 234 212 / 0.15); }
  50% { box-shadow: 0 0 0 2px rgb(94 234 212 / 0.9), 0 0 14px 6px rgb(94 234 212 / 0.45); }
}
.gw-key {
  position: absolute;
  right: 3px;
  top: 2px;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  color: rgb(255 255 255 / 0.45);
}
.gw-pop-enter-active, .gw-pop-leave-active { transition: opacity 160ms, transform 200ms cubic-bezier(.3, 1.4, .5, 1); }
.gw-pop-enter-from, .gw-pop-leave-to { opacity: 0; transform: translateY(8px) scale(0.97); }
.gw-banner-enter-active { transition: opacity 250ms, transform 450ms cubic-bezier(.3, 1.6, .5, 1); }
.gw-banner-leave-active { transition: opacity 400ms, transform 400ms; }
.gw-banner-enter-from { opacity: 0; transform: translate(-50%, -16px) scale(0.85); }
.gw-banner-leave-to { opacity: 0; transform: translate(-50%, -8px); }
.gw-row-enter-active { transition: opacity 250ms, transform 300ms cubic-bezier(.3, 1.4, .5, 1); }
.gw-row-enter-from { opacity: 0; transform: translateX(12px); }
.gw-slot-enter-active { transition: opacity 250ms, transform 350ms cubic-bezier(.3, 1.6, .5, 1); }
.gw-slot-enter-from { opacity: 0; transform: translateY(14px) scale(0.6); }
</style>
