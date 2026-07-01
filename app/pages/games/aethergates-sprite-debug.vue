<script setup lang="ts">
import type { AetherSymbol } from '#shared/utils/gamelogic/aethergates'

type SymRect = [number, number, number, number]

const symbols = Object.keys(AETHER_SYMBOL_META) as AetherSymbol[]

function cloneRects(): Record<AetherSymbol, SymRect> {
  return symbols.reduce((acc, s) => {
    acc[s] = [...AETHER_SYMBOL_META[s].rect] as SymRect
    return acc
  }, {} as Record<AetherSymbol, SymRect>)
}

const initial = cloneRects()
const rects = reactive<Record<AetherSymbol, SymRect>>(cloneRects())

function nudge(sym: AetherSymbol, index: number, delta: number) {
  const r = rects[sym]
  r[index] = Math.max(0, r[index]! + delta)
}

function resetOne(sym: AetherSymbol) {
  rects[sym] = [...initial[sym]] as SymRect
}

function resetAll() {
  for (const s of symbols) resetOne(s)
}

// Live-cropped preview swatch for one symbol at a given display width.
function cropStyle(sym: AetherSymbol, w: number): Record<string, string> {
  const [x, y, tw, th] = rects[sym]
  const h = Math.round(w * th / tw)
  const sx = w / tw
  const sy = h / th
  return {
    width: `${w}px`,
    height: `${h}px`,
    backgroundImage: `url(${AETHER_SPRITE_SRC})`,
    backgroundSize: `${Math.round(AETHER_SHEET_W * sx)}px ${Math.round(AETHER_SHEET_H * sy)}px`,
    backgroundPosition: `-${Math.round(x * sx)}px -${Math.round(y * sy)}px`,
    backgroundRepeat: 'no-repeat'
  }
}

// Full-sheet overlay so every crop rect can be checked in context at once.
const SHEET_DISPLAY_W = 1024
const SHEET_DISPLAY_H = Math.round(SHEET_DISPLAY_W * AETHER_SHEET_H / AETHER_SHEET_W)
const SHEET_SCALE = SHEET_DISPLAY_W / AETHER_SHEET_W

const PALETTE = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#34d399', '#22d3ee', '#60a5fa', '#a78bfa', '#e879f9', '#f472b6']

function overlayStyle(sym: AetherSymbol, i: number): Record<string, string> {
  const [x, y, w, h] = rects[sym]
  return {
    left: `${Math.round(x * SHEET_SCALE)}px`,
    top: `${Math.round(y * SHEET_SCALE)}px`,
    width: `${Math.round(w * SHEET_SCALE)}px`,
    height: `${Math.round(h * SHEET_SCALE)}px`,
    borderColor: PALETTE[i % PALETTE.length]!,
    color: PALETTE[i % PALETTE.length]!
  }
}

const showOverlay = ref(true)

const generatedCode = computed(() => {
  const lines = symbols.map((s) => {
    const [x, y, w, h] = rects[s]
    const { name } = AETHER_SYMBOL_META[s]
    return `    ${s}: { name: '${name}', rect: [${x}, ${y}, ${w}, ${h}] },`
  })
  return `export const AETHER_SYMBOL_META: Record<AetherSymbol, { name: string, rect: [number, number, number, number] }> = {\n${lines.join('\n')}\n}`.replace(/,\n}/, '\n}')
})

const copied = ref(false)
async function copyCode() {
  if (!import.meta.client) return
  await navigator.clipboard.writeText(generatedCode.value)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1500)
}
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 py-6">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-black">
          Aether Gates — sprite tuner
        </h1>
        <p class="text-sm text-muted">
          Adjust each symbol's crop rect until the preview and the overlay line up cleanly, then copy the code back into <code>app/utils/aethergates-sprite.ts</code>.
        </p>
      </div>
      <div class="flex gap-2">
        <UButton
          color="neutral"
          variant="soft"
          @click="showOverlay = !showOverlay"
        >
          {{ showOverlay ? 'Hide' : 'Show' }} overlay
        </UButton>
        <UButton
          color="error"
          variant="soft"
          @click="resetAll"
        >
          Reset all
        </UButton>
      </div>
    </div>

    <!-- Full sheet with every symbol's crop rect drawn on top -->
    <div class="mb-6 overflow-x-auto rounded-lg border border-default bg-elevated/40 p-3">
      <div
        class="relative"
        :style="{ width: `${SHEET_DISPLAY_W}px`, height: `${SHEET_DISPLAY_H}px` }"
      >
        <img
          :src="AETHER_SPRITE_SRC"
          class="pointer-events-none absolute inset-0"
          :style="{ width: `${SHEET_DISPLAY_W}px`, height: `${SHEET_DISPLAY_H}px` }"
          alt="Aether Gates sprite sheet"
        >
        <template v-if="showOverlay">
          <div
            v-for="(sym, i) in symbols"
            :key="sym"
            class="absolute box-border border-2"
            :style="overlayStyle(sym, i)"
          >
            <span class="absolute -top-[18px] left-0 whitespace-nowrap text-[10px] font-black uppercase tracking-wide">{{ sym }}</span>
          </div>
        </template>
      </div>
    </div>

    <!-- Per-symbol tuning cards -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <UCard
        v-for="sym in symbols"
        :key="sym"
      >
        <div class="flex flex-col items-center gap-2">
          <p class="text-xs font-black uppercase tracking-wide text-muted">
            {{ sym }}
          </p>
          <p class="text-[11px] text-muted">
            {{ AETHER_SYMBOL_META[sym].name }}
          </p>

          <div
            class="rounded-md border border-default"
            :style="cropStyle(sym, 120)"
          />

          <div class="grid w-full grid-cols-2 gap-x-2 gap-y-1.5">
            <div
              v-for="(label, idx) in ['x', 'y', 'w', 'h']"
              :key="label"
              class="flex items-center gap-1"
            >
              <span class="w-3 text-[10px] font-bold uppercase text-muted">{{ label }}</span>
              <UInput
                v-model.number="rects[sym][idx]"
                type="number"
                size="xs"
                class="w-full font-mono"
              />
              <div class="flex flex-col">
                <button
                  class="ag-debug-nudge"
                  @click="nudge(sym, idx, 1)"
                >
                  ▲
                </button>
                <button
                  class="ag-debug-nudge"
                  @click="nudge(sym, idx, -1)"
                >
                  ▼
                </button>
              </div>
            </div>
          </div>

          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            block
            @click="resetOne(sym)"
          >
            Reset
          </UButton>
        </div>
      </UCard>
    </div>

    <!-- Generated code, ready to paste back -->
    <div class="mt-6">
      <div class="mb-2 flex items-center justify-between">
        <p class="text-xs font-black uppercase tracking-wide text-muted">
          Generated symbolMeta
        </p>
        <UButton
          size="xs"
          :color="copied ? 'success' : 'primary'"
          variant="soft"
          @click="copyCode"
        >
          {{ copied ? 'Copied!' : 'Copy to clipboard' }}
        </UButton>
      </div>
      <pre class="overflow-x-auto rounded-lg border border-default bg-elevated/60 p-3 text-xs">{{ generatedCode }}</pre>
    </div>
  </div>
</template>

<style scoped>
.ag-debug-nudge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 11px;
  line-height: 1;
  font-size: 8px;
  border: 1px solid var(--ui-border);
  border-radius: 3px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
}

.ag-debug-nudge:hover {
  color: var(--ui-text);
  border-color: var(--ui-primary);
}
</style>
