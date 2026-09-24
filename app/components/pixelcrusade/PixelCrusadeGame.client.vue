<script setup lang="ts">
import { CrusadeGame, type CrusadeSnapshot } from '~/utils/pixelcrusade/engine'
import {
    CLASSES, UPGRADES, affordable, upgradeCostN,
    type ClassId, type UpgradeDef, type UpgradeId
} from '~/utils/pixelcrusade/economy'

const stage = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const canvasSize = ref({ width: 0, height: 0 })

const game = new CrusadeGame()
const snap = shallowRef<CrusadeSnapshot | null>(null)
const buyMode = ref<1 | 10 | 0>(1)
const picked = ref<ClassId | null>(null)
const confirming = ref(false)

let poll: ReturnType<typeof setInterval> | undefined
let observer: ResizeObserver | undefined

function refresh() {
    snap.value = game.snapshot()
}

function fit() {
    if (!stage.value) return
    const r = stage.value.getBoundingClientRect()
    canvasSize.value = game.resize(r.width, r.height, window.devicePixelRatio || 1)
}

function onKey(e: KeyboardEvent) {
    if (e.code !== 'Space' || (e.target as HTMLElement)?.closest('input, textarea, button')) return
    e.preventDefault()
    game.tap()
}

onMounted(() => {
    game.mount(canvas.value!)
    if (import.meta.dev) (window as unknown as { __pixelCrusade: CrusadeGame }).__pixelCrusade = game
    observer = new ResizeObserver(fit)
    observer.observe(stage.value!)
    fit()
    refresh()
    poll = setInterval(refresh, 120)
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', game.persist.bind(game))
})

onBeforeUnmount(() => {
    clearInterval(poll)
    observer?.disconnect()
    window.removeEventListener('keydown', onKey)
    game.unmount()
})

// ------------------------------------------------------------ upgrades

const UPGRADE_ICON: Record<UpgradeId, string> = {
    damage: 'i-lucide-sword',
    speed: 'i-lucide-zap',
    crit: 'i-lucide-crosshair',
    critPower: 'i-lucide-flame',
    special: 'i-lucide-sparkles'
}

interface Row {
    def: UpgradeDef
    level: number
    effect: string
    qty: number
    cost: number
    maxed: boolean
    canBuy: boolean
}

const rows = computed<Row[]>(() => {
    const s = snap.value
    if (!s) return []
    return UPGRADES.map((def) => {
        const level = s.levels[def.id]
        const room = def.max - level
        const maxed = room <= 0
        let qty = buyMode.value === 0 ? affordable(def, level, s.gold) : Math.min(buyMode.value, room)
        if (qty <= 0) qty = maxed ? 0 : 1
        const cost = qty > 0 ? upgradeCostN(def, level, qty) : 0
        return { def, level, effect: effectText(def.id, s), qty, cost, maxed, canBuy: !maxed && cost <= s.gold }
    })
})

function effectText(id: UpgradeId, s: CrusadeSnapshot): string {
    switch (id) {
        case 'damage': return `${formatNumber(s.hit)} per hit`
        case 'speed': return `${s.rate.toFixed(2)} hits/s`
        case 'crit': return `${Math.round(s.crit * 100)}% chance`
        case 'critPower': return `x${s.critMult.toFixed(2)} crits`
        case 'special': return `x${s.specialMult.toFixed(1)} special`
    }
}

function buy(row: Row) {
    if (!row.canBuy) return
    game.buy(row.def.id, row.qty)
    refresh()
}

// ------------------------------------------------------------ classes & prestige

const currentClass = computed(() => CLASSES.find(c => c.id === snap.value?.classId) ?? CLASSES[0]!)

function classState(id: ClassId): 'current' | 'unlocked' | 'ready' | 'locked' {
    const s = snap.value
    if (!s) return 'locked'
    if (s.classId === id) return 'current'
    if (s.unlocked.includes(id)) return 'unlocked'
    const c = CLASSES.find(x => x.id === id)!
    return s.maxStage >= c.unlockStage ? 'ready' : 'locked'
}

function pick(id: ClassId) {
    const st = classState(id)
    if (st === 'locked') return
    picked.value = id
    confirming.value = false
}

const target = computed<ClassId>(() => picked.value ?? snap.value?.classId ?? 'warrior')

function prestige() {
    if (!snap.value?.canPrestige) return
    if (!confirming.value) {
        confirming.value = true
        return
    }
    game.prestige(target.value)
    confirming.value = false
    picked.value = null
    refresh()
}

function fightBoss() {
    game.fightBoss()
    refresh()
}
</script>

<template>
  <div class="pc-root p-3 sm:p-4 max-w-[1400px] mx-auto flex flex-col gap-3">
    <!-- stage -->
    <div
      ref="stage"
      class="pc-stage relative w-full aspect-video max-h-[74vh] rounded-lg overflow-hidden flex items-center justify-center select-none"
    >
      <canvas
        ref="canvas"
        class="pc-canvas block cursor-crosshair"
        :style="{ width: `${canvasSize.width}px`, height: `${canvasSize.height}px` }"
        @pointerdown.prevent="game.tap()"
      />
      <button
        v-if="snap?.farming"
        class="pc-font pc-boss-btn absolute top-3 right-3"
        @click="fightBoss"
      >
        Fight boss
      </button>
      <div class="pc-font absolute bottom-2 right-3 text-[10px] text-white/50 pointer-events-none hidden sm:block">
        Click or space to strike
      </div>
    </div>

    <div
      v-if="snap"
      class="grid gap-3 lg:grid-cols-[240px_1fr_320px]"
    >
      <!-- hero -->
      <section class="pc-panel">
        <div class="flex items-baseline justify-between">
          <h2 class="pc-font text-lg text-highlighted">
            {{ currentClass.name }}
          </h2>
          <span class="pc-font text-xs text-muted">P{{ snap.prestiges }}</span>
        </div>
        <p class="text-xs text-muted mb-3">
          {{ currentClass.blurb }}
        </p>
        <dl class="pc-stats">
          <dt>DPS</dt><dd class="text-primary">
            {{ formatNumber(snap.dps) }}
          </dd>
          <dt>Hit</dt><dd>{{ formatNumber(snap.hit) }}</dd>
          <dt>Speed</dt><dd>{{ snap.rate.toFixed(2) }}/s</dd>
          <dt>Crit</dt><dd>{{ Math.round(snap.crit * 100) }}% · x{{ snap.critMult.toFixed(2) }}</dd>
          <dt>{{ currentClass.special }}</dt><dd>x{{ snap.specialMult.toFixed(1) }} · every {{ currentClass.specialEvery }}</dd>
          <dt>Souls</dt><dd>{{ snap.souls }} · +{{ snap.souls * 10 }}%</dd>
          <dt>Best</dt><dd>stage {{ snap.bestStage }}</dd>
        </dl>
      </section>

      <!-- upgrades -->
      <section class="pc-panel">
        <div class="flex items-center justify-between mb-2">
          <h2 class="pc-font text-sm text-highlighted">
            Upgrades
          </h2>
          <div class="pc-seg">
            <button
              v-for="m in ([1, 10, 0] as const)"
              :key="m"
              :class="{ on: buyMode === m }"
              @click="buyMode = m"
            >
              {{ m === 0 ? 'Max' : `x${m}` }}
            </button>
          </div>
        </div>
        <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <button
            v-for="row in rows"
            :key="row.def.id"
            class="pc-up"
            :class="{ can: row.canBuy, maxed: row.maxed }"
            :disabled="!row.canBuy"
            @click="buy(row)"
          >
            <UIcon
              :name="UPGRADE_ICON[row.def.id]"
              class="size-5 shrink-0 text-primary"
            />
            <span class="flex-1 min-w-0 text-left">
              <span class="flex items-baseline gap-1.5">
                <span class="pc-font text-xs text-highlighted truncate">{{ row.def.name }}</span>
                <span class="text-[10px] text-muted">Lv {{ row.level }}</span>
              </span>
              <span class="block text-[11px] text-muted truncate">{{ row.effect }}</span>
            </span>
            <span class="pc-cost">
              <template v-if="row.maxed">MAX</template>
              <template v-else>
                <span
                  v-if="row.qty > 1"
                  class="text-muted"
                >x{{ row.qty }}</span>
                <span class="pc-coin" />{{ formatNumber(row.cost) }}
              </template>
            </span>
          </button>
        </div>
      </section>

      <!-- prestige -->
      <section class="pc-panel">
        <div class="flex items-baseline justify-between mb-2">
          <h2 class="pc-font text-sm text-highlighted">
            Prestige
          </h2>
          <span class="text-[11px] text-muted">from stage 20</span>
        </div>
        <div class="grid grid-cols-2 gap-1.5 mb-3">
          <button
            v-for="c in CLASSES"
            :key="c.id"
            class="pc-class"
            :class="[classState(c.id), { picked: target === c.id }]"
            :disabled="classState(c.id) === 'locked'"
            @click="pick(c.id)"
          >
            <span class="pc-font text-xs">{{ c.name }}</span>
            <span class="text-[10px] opacity-75">
              <template v-if="classState(c.id) === 'locked'">Stage {{ c.unlockStage }}</template>
              <template v-else>x{{ c.dmgMult }} dmg · {{ c.special }}</template>
            </span>
          </button>
        </div>
        <button
          class="pc-prestige pc-font"
          :disabled="!snap.canPrestige"
          @click="prestige"
        >
          <template v-if="!snap.canPrestige">
            Reach stage 20 · now {{ snap.maxStage }}
          </template>
          <template v-else-if="confirming">
            Confirm: reset for +{{ snap.soulsOnPrestige }} souls
          </template>
          <template v-else>
            Prestige as {{ CLASSES.find(c => c.id === target)!.name }} · +{{ snap.soulsOnPrestige }} souls
          </template>
        </button>
        <p class="text-[11px] text-muted mt-2">
          Resets stage, gold and upgrades. Each soul adds 10% damage for good.
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pc-font {
  font-family: 'Silkscreen', ui-monospace, monospace;
  letter-spacing: 0.02em;
}

.pc-stage {
  background: #0d0a14;
  box-shadow: inset 0 0 0 1px var(--ui-border);
}

.pc-canvas {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  touch-action: manipulation;
}

.pc-panel {
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  padding: 12px;
}

.pc-stats {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: 12px;
}

.pc-stats dt {
  color: var(--ui-text-muted);
}

.pc-stats dd {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text-highlighted);
}

.pc-seg {
  display: flex;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  overflow: hidden;
}

.pc-seg button {
  font-family: 'Silkscreen', ui-monospace, monospace;
  font-size: 11px;
  padding: 2px 9px;
  color: var(--ui-text-muted);
}

.pc-seg button.on {
  background: var(--ui-primary);
  color: var(--ui-bg);
}

.pc-up {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--ui-border);
  background: var(--ui-bg);
  opacity: 0.6;
  transition: transform 80ms, border-color 120ms, opacity 120ms;
}

.pc-up.can {
  opacity: 1;
  border-color: color-mix(in oklab, var(--ui-primary) 55%, var(--ui-border));
  cursor: pointer;
}

.pc-up.can:hover {
  border-color: var(--ui-primary);
}

.pc-up.can:active {
  transform: translateY(1px) scale(0.99);
}

.pc-up.maxed {
  opacity: 0.8;
}

.pc-cost {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text-highlighted);
  white-space: nowrap;
}

.pc-coin {
  width: 8px;
  height: 8px;
  background: var(--ui-warning);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--ui-warning) 50%, black);
}

.pc-class {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--ui-border);
  background: var(--ui-bg);
  text-align: left;
  color: var(--ui-text-highlighted);
}

.pc-class.locked {
  opacity: 0.45;
  cursor: not-allowed;
}

.pc-class.ready {
  border-style: dashed;
  border-color: var(--ui-primary);
}

.pc-class.current::after {
  content: 'active';
  font-size: 9px;
  color: var(--ui-primary);
}

.pc-class.picked {
  border-color: var(--ui-primary);
  box-shadow: 0 0 0 1px var(--ui-primary);
}

.pc-prestige {
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  background: var(--ui-primary);
  color: var(--ui-bg);
}

.pc-prestige:disabled {
  background: var(--ui-bg-accented);
  color: var(--ui-text-muted);
  cursor: not-allowed;
}

.pc-boss-btn {
  font-size: 13px;
  padding: 6px 12px;
  color: var(--ui-bg);
  background: var(--ui-error);
  border-radius: 4px;
  box-shadow: 0 2px 0 color-mix(in oklab, var(--ui-error) 50%, black);
}

.pc-boss-btn:hover {
  filter: brightness(1.1);
}
</style>
