<script setup lang="ts">
import type { FireSymbol } from '#shared/utils/gamelogic/fireinthehole'
import { FITH_BONUS_SHEET_H, FITH_BONUS_SHEET_W, FITH_BONUS_SPRITE_SRC, FITH_BONUS_SYMBOL_META, FITH_SHEET_H, FITH_SHEET_W, FITH_SPRITE_SRC, FITH_SYMBOL_META } from '~/utils/fireinthehole-sprite'

// One symbol cropped out of the sprite sheets as a CSS background, sized to
// fit a `size` px square.
const props = defineProps<{ symbol: FireSymbol, size: number }>()

const style = computed(() => {
    const base = FITH_SYMBOL_META[props.symbol as keyof typeof FITH_SYMBOL_META]
    const bonus = FITH_BONUS_SYMBOL_META[props.symbol as keyof typeof FITH_BONUS_SYMBOL_META]
    const meta = base ?? bonus
    if (!meta) return {}
    const [x, y, w, h] = meta.rect
    const src = base ? FITH_SPRITE_SRC : FITH_BONUS_SPRITE_SRC
    const sheetW = base ? FITH_SHEET_W : FITH_BONUS_SHEET_W
    const sheetH = base ? FITH_SHEET_H : FITH_BONUS_SHEET_H
    const scale = props.size / Math.max(w, h)
    return {
        width: `${Math.round(w * scale)}px`,
        height: `${Math.round(h * scale)}px`,
        backgroundImage: `url(${src})`,
        backgroundSize: `${sheetW * scale}px ${sheetH * scale}px`,
        backgroundPosition: `-${x * scale}px -${y * scale}px`
    }
})
</script>

<template>
  <span
    class="fith-symbol-icon"
    :style="style"
    aria-hidden="true"
  />
</template>

<style scoped>
.fith-symbol-icon {
  display: inline-block;
  flex-shrink: 0;
  background-repeat: no-repeat;
}
</style>
