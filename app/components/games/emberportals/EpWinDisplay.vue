<script setup lang="ts">
// The big win counter under the board. The parent counts `amount` up; every
// bump of `pulse` pops it, and flying chips (parent-driven) land on `target`.
const props = defineProps<{
  amount: number
  label: string
  pulse: number
  /** Tier glow colour while a win is showing. */
  glow: string
  hot: boolean
}>()

const target = ref<HTMLElement>()
const popping = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

watch(() => props.pulse, () => {
  popping.value = false
  clearTimeout(timer)
  requestAnimationFrame(() => {
    popping.value = true
    timer = setTimeout(() => { popping.value = false }, 420)
  })
})

onBeforeUnmount(() => clearTimeout(timer))

defineExpose({ target })
</script>

<template>
  <div class="ep-wd" :class="{ 'is-hot': hot && amount > 0, 'is-pop': popping }" :style="{ '--wd-glow': glow }">
    <span class="ep-wd__label">{{ label }}</span>
    <span ref="target" class="ep-wd__amount" aria-live="off">
      {{ amount > 0 ? formatNumber(amount) : '' }}
    </span>
  </div>
</template>

<style scoped>
/* No box: the win is lettered straight onto the scene under the board, the
   label stacked over the value so both sit on the board's centre axis. The
   row keeps its height when empty so nothing below jumps. */
.ep-wd {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: calc(4px * var(--ep-s, 1));
  height: calc(80px * var(--ep-s, 1));
  text-align: center;
}

.ep-wd__label {
  font-family: var(--ep-ui);
  font-size: calc(11px * var(--ep-s, 1));
  font-weight: 800;
  letter-spacing: 0.34em;
  /* Balance the trailing letter-spacing so the word sits truly centred. */
  padding-left: 0.34em;
  text-transform: uppercase;
  color: rgba(232, 181, 74, 0.4);
  transition: color 0.3s;
}

.is-hot .ep-wd__label { color: rgba(232, 181, 74, 0.85); }

.ep-wd__amount {
  font-family: var(--ep-number);
  font-size: calc(clamp(34px, 4.4vw, 56px) * var(--ep-s, 1));
  font-weight: 900;
  line-height: 1.05;
  min-height: 1.05em;
  font-variant-numeric: tabular-nums;
  background: linear-gradient(180deg, #fffbe6 10%, #ffd873 45%, #e9a53a 70%, #b8661a 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 3px 0 #0a0406) drop-shadow(0 0 14px var(--wd-glow));
}

.is-hot .ep-wd__amount { animation: ep-wd-glow 1.6s ease-in-out infinite; }
.is-pop .ep-wd__amount { animation: ep-wd-pop 0.42s cubic-bezier(0.2, 1.8, 0.4, 1); }

@keyframes ep-wd-pop {
  0% { transform: scale(1); }
  35% { transform: scale(1.22); }
  100% { transform: scale(1); }
}

@keyframes ep-wd-glow {
  0%, 100% { filter: drop-shadow(0 3px 0 #0a0406) drop-shadow(0 0 12px var(--wd-glow)); }
  50% { filter: drop-shadow(0 3px 0 #0a0406) drop-shadow(0 0 26px var(--wd-glow)); }
}

@media (max-width: 480px) {
  .ep-wd { height: 62px; gap: 2px; }
}

@media (prefers-reduced-motion: reduce) {
  .is-hot .ep-wd__amount, .is-pop .ep-wd__amount { animation: none; }
}
</style>
