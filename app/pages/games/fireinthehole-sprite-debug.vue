<script setup lang="ts">
import type { FireBonusSymbol } from '#shared/utils/gamelogic/fireinthehole'
import type { FireBaseSymbol } from '~/utils/fireinthehole-sprite'

type SymRect = [number, number, number, number]
type SymMeta<S extends string> = Record<S, { name: string, rect: SymRect }>

function useSpriteTuner<S extends string>(
  symbols: S[],
  initialMeta: SymMeta<S>,
  spriteSrc: string,
  sheetW: number,
  sheetH: number,
  metaVarName: string,
  recordTypeName: string
) {
  function cloneRects(): Record<S, SymRect> {
    return symbols.reduce((acc, s) => {
      acc[s] = [...initialMeta[s].rect] as SymRect
      return acc
    }, {} as Record<S, SymRect>)
  }

  const rects = reactive(cloneRects()) as Record<S, SymRect>

  function nudge(sym: S, index: number, delta: number) {
    const r = rects[sym]
    r[index] = Math.max(0, r[index]! + delta)
  }

  function resetOne(sym: S) {
    rects[sym] = [...initialMeta[sym].rect] as SymRect
  }

  function resetAll() {
    for (const s of symbols) resetOne(s)
  }

  function cropStyle(sym: S, w: number): Record<string, string> {
    const [x, y, tw, th] = rects[sym]
    const h = Math.round(w * th / tw)
    const sx = w / tw
    const sy = h / th
    return {
      width: `${w}px`,
      height: `${h}px`,
      backgroundImage: `url(${spriteSrc})`,
      backgroundSize: `${Math.round(sheetW * sx)}px ${Math.round(sheetH * sy)}px`,
      backgroundPosition: `-${Math.round(x * sx)}px -${Math.round(y * sy)}px`,
      backgroundRepeat: 'no-repeat'
    }
  }

  const SHEET_DISPLAY_W = 1024
  const SHEET_DISPLAY_H = Math.round(SHEET_DISPLAY_W * sheetH / sheetW)
  const SHEET_SCALE = SHEET_DISPLAY_W / sheetW

  const PALETTE = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#34d399', '#22d3ee', '#60a5fa', '#a78bfa', '#e879f9', '#f472b6']

  function overlayStyle(sym: S, i: number): Record<string, string> {
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
      const { name } = initialMeta[s]
      return `    ${s}: { name: '${name}', rect: [${x}, ${y}, ${w}, ${h}] },`
    })
    return `export const ${metaVarName}: Record<${recordTypeName}, { name: string, rect: [number, number, number, number] }> = {\n${lines.join('\n')}\n}`.replace(/,\n}/, '\n}')
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

  return {
    rects,
    nudge,
    resetOne,
    resetAll,
    cropStyle,
    overlayStyle,
    showOverlay,
    generatedCode,
    copied,
    copyCode,
    SHEET_DISPLAY_W,
    SHEET_DISPLAY_H
  }
}

const baseSymbols = Object.keys(FITH_SYMBOL_META) as FireBaseSymbol[]
const base = useSpriteTuner(baseSymbols, FITH_SYMBOL_META, FITH_SPRITE_SRC, FITH_SHEET_W, FITH_SHEET_H, 'FITH_SYMBOL_META', 'FireBaseSymbol')

const bonusSymbols = Object.keys(FITH_BONUS_SYMBOL_META) as FireBonusSymbol[]
const bonus = useSpriteTuner(bonusSymbols, FITH_BONUS_SYMBOL_META, FITH_BONUS_SPRITE_SRC, FITH_BONUS_SHEET_W, FITH_BONUS_SHEET_H, 'FITH_BONUS_SYMBOL_META', 'FireBonusSymbol')
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 py-6">
    <div class="mb-6">
      <h1 class="text-xl font-black">
        Fire in the Hole — sprite tuner
      </h1>
      <p class="text-sm text-muted">
        Adjust each symbol's crop rect until the preview and the overlay line up cleanly, then copy the generated code back into <code>app/utils/fireinthehole-sprite.ts</code>.
      </p>
    </div>

    <!-- Base game sheet -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-black">
        Base game — sprite.png
      </h2>
      <div class="flex gap-2">
        <UButton
          color="neutral"
          variant="soft"
          @click="base.showOverlay.value = !base.showOverlay.value"
        >
          {{ base.showOverlay.value ? 'Hide' : 'Show' }} overlay
        </UButton>
        <UButton
          color="error"
          variant="soft"
          @click="base.resetAll"
        >
          Reset all
        </UButton>
      </div>
    </div>

    <div class="mb-6 overflow-x-auto rounded-lg border border-default bg-elevated/40 p-3">
      <div
        class="relative"
        :style="{ width: `${base.SHEET_DISPLAY_W}px`, height: `${base.SHEET_DISPLAY_H}px` }"
      >
        <img
          :src="FITH_SPRITE_SRC"
          class="pointer-events-none absolute inset-0"
          :style="{ width: `${base.SHEET_DISPLAY_W}px`, height: `${base.SHEET_DISPLAY_H}px` }"
          alt="Fire in the Hole base sprite sheet"
        >
        <template v-if="base.showOverlay.value">
          <div
            v-for="(sym, i) in baseSymbols"
            :key="sym"
            class="absolute box-border border-2"
            :style="base.overlayStyle(sym, i)"
          >
            <span class="absolute -top-[18px] left-0 whitespace-nowrap text-[10px] font-black uppercase tracking-wide">{{ sym }}</span>
          </div>
        </template>
      </div>
    </div>

    <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <UCard
        v-for="sym in baseSymbols"
        :key="sym"
      >
        <div class="flex flex-col items-center gap-2">
          <p class="text-xs font-black uppercase tracking-wide text-muted">
            {{ sym }}
          </p>
          <p class="text-[11px] text-muted">
            {{ FITH_SYMBOL_META[sym].name }}
          </p>

          <div
            class="rounded-md border border-default"
            :style="base.cropStyle(sym, 120)"
          />

          <div class="grid w-full grid-cols-2 gap-x-2 gap-y-1.5">
            <div
              v-for="(label, idx) in ['x', 'y', 'w', 'h']"
              :key="label"
              class="flex items-center gap-1"
            >
              <span class="w-3 text-[10px] font-bold uppercase text-muted">{{ label }}</span>
              <UInput
                v-model.number="base.rects[sym][idx]"
                type="number"
                size="xs"
                class="w-full font-mono"
              />
              <div class="flex flex-col">
                <button
                  class="fith-debug-nudge"
                  @click="base.nudge(sym, idx, 1)"
                >
                  ▲
                </button>
                <button
                  class="fith-debug-nudge"
                  @click="base.nudge(sym, idx, -1)"
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
            @click="base.resetOne(sym)"
          >
            Reset
          </UButton>
        </div>
      </UCard>
    </div>

    <div class="mb-10">
      <div class="mb-2 flex items-center justify-between">
        <p class="text-xs font-black uppercase tracking-wide text-muted">
          Generated FITH_SYMBOL_META
        </p>
        <UButton
          size="xs"
          :color="base.copied.value ? 'success' : 'primary'"
          variant="soft"
          @click="base.copyCode"
        >
          {{ base.copied.value ? 'Copied!' : 'Copy to clipboard' }}
        </UButton>
      </div>
      <pre class="overflow-x-auto rounded-lg border border-default bg-elevated/60 p-3 text-xs">{{ base.generatedCode.value }}</pre>
    </div>

    <!-- Bonus round sheet -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-black">
        Bonus spins — bonus.png
      </h2>
      <div class="flex gap-2">
        <UButton
          color="neutral"
          variant="soft"
          @click="bonus.showOverlay.value = !bonus.showOverlay.value"
        >
          {{ bonus.showOverlay.value ? 'Hide' : 'Show' }} overlay
        </UButton>
        <UButton
          color="error"
          variant="soft"
          @click="bonus.resetAll"
        >
          Reset all
        </UButton>
      </div>
    </div>

    <div class="mb-6 overflow-x-auto rounded-lg border border-default bg-elevated/40 p-3">
      <div
        class="relative"
        :style="{ width: `${bonus.SHEET_DISPLAY_W}px`, height: `${bonus.SHEET_DISPLAY_H}px` }"
      >
        <img
          :src="FITH_BONUS_SPRITE_SRC"
          class="pointer-events-none absolute inset-0"
          :style="{ width: `${bonus.SHEET_DISPLAY_W}px`, height: `${bonus.SHEET_DISPLAY_H}px` }"
          alt="Fire in the Hole bonus sprite sheet"
        >
        <template v-if="bonus.showOverlay.value">
          <div
            v-for="(sym, i) in bonusSymbols"
            :key="sym"
            class="absolute box-border border-2"
            :style="bonus.overlayStyle(sym, i)"
          >
            <span class="absolute -top-[18px] left-0 whitespace-nowrap text-[10px] font-black uppercase tracking-wide">{{ sym }}</span>
          </div>
        </template>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <UCard
        v-for="sym in bonusSymbols"
        :key="sym"
      >
        <div class="flex flex-col items-center gap-2">
          <p class="text-xs font-black uppercase tracking-wide text-muted">
            {{ sym }}
          </p>
          <p class="text-[11px] text-muted">
            {{ FITH_BONUS_SYMBOL_META[sym].name }}
          </p>

          <div
            class="rounded-md border border-default"
            :style="bonus.cropStyle(sym, 120)"
          />

          <div class="grid w-full grid-cols-2 gap-x-2 gap-y-1.5">
            <div
              v-for="(label, idx) in ['x', 'y', 'w', 'h']"
              :key="label"
              class="flex items-center gap-1"
            >
              <span class="w-3 text-[10px] font-bold uppercase text-muted">{{ label }}</span>
              <UInput
                v-model.number="bonus.rects[sym][idx]"
                type="number"
                size="xs"
                class="w-full font-mono"
              />
              <div class="flex flex-col">
                <button
                  class="fith-debug-nudge"
                  @click="bonus.nudge(sym, idx, 1)"
                >
                  ▲
                </button>
                <button
                  class="fith-debug-nudge"
                  @click="bonus.nudge(sym, idx, -1)"
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
            @click="bonus.resetOne(sym)"
          >
            Reset
          </UButton>
        </div>
      </UCard>
    </div>

    <div class="mt-6">
      <div class="mb-2 flex items-center justify-between">
        <p class="text-xs font-black uppercase tracking-wide text-muted">
          Generated FITH_BONUS_SYMBOL_META
        </p>
        <UButton
          size="xs"
          :color="bonus.copied.value ? 'success' : 'primary'"
          variant="soft"
          @click="bonus.copyCode"
        >
          {{ bonus.copied.value ? 'Copied!' : 'Copy to clipboard' }}
        </UButton>
      </div>
      <pre class="overflow-x-auto rounded-lg border border-default bg-elevated/60 p-3 text-xs">{{ bonus.generatedCode.value }}</pre>
    </div>
  </div>
</template>

<style scoped>
.fith-debug-nudge {
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

.fith-debug-nudge:hover {
  color: var(--ui-text);
  border-color: var(--ui-primary);
}
</style>
